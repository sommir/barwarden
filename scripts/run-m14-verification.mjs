#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  playwrightDiagnosticEnvironmentName,
  readSafePlaywrightDiagnostic,
} from "./m14-safe-playwright-reporter.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const expectedVendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const machineReportPath = "docs/superpowers/specs/2026-07-20-m14-machine-verification.json";
const liveResultPath = "docs/superpowers/specs/2026-07-20-m14-live-service-result.md";
const defaultTimeoutMs = 30 * 60 * 1000;
const defaultTerminationGraceMs = 1000;
const liveInputPrefix = "BARWARDEN_LIVE_";
const liveResultEnvironmentName = "BARWARDEN_LIVE_RESULT_PATH";
const publicLiveControlNames = new Set([
  "BARWARDEN_LIVE_CLOUD_REGION",
  "BARWARDEN_LIVE_MUTATION",
]);
const selfHostedInputNames = [
  "BARWARDEN_LIVE_SERVER_URL",
  "BARWARDEN_LIVE_EMAIL",
  "BARWARDEN_LIVE_PASSWORD",
];
const cloudInputNames = [
  "BARWARDEN_LIVE_CLOUD_REGION",
  "BARWARDEN_LIVE_CLOUD_EMAIL",
  "BARWARDEN_LIVE_CLOUD_PASSWORD",
];
const liveFailureServices = ["cloud_us", "cloud_eu", "self_hosted"];
const allowedLiveFailureIds = new Set([
  "chromium_live_matrix_failed",
  ...liveFailureServices.flatMap((service) =>
    ["token", "refresh", "sync"].map((stage) => `live_auth_${service}_${stage}_failed`),
  ),
  ...liveFailureServices.flatMap((service) =>
    ["read_only", "folder", "login", "card", "identity", "secure_note"]
      .map((stage) => `live_vault_${service}_${stage}_failed`),
  ),
  ...liveFailureServices.flatMap((service) =>
    ["text_send", "file_send_non_interference"]
      .map((stage) => `live_text_send_${service}_${stage}_failed`),
  ),
]);
const allowedStatuses = new Set(["passed", "skipped_external", "blocked_external"]);
const allowedServices = new Set(["self-hosted", "cloud-us", "cloud-eu"]);
const allowedModes = new Set(["read-only", "mutation"]);
const allowedStages = new Set([
  "configuration", "prelogin", "kdf", "token", "unwrap", "refresh", "sync",
  "folder", "login", "card", "identity", "secure-note", "text-send",
  "file-send-non-interference", "cleanup",
]);
const allowedReasons = new Set([
  "credentials_absent", "credentials_partial", "mutation_disabled", "service_not_selected",
  "challenge_not_triggered", "challenge_input_absent", "network_unreachable", "tls_rejected",
  "invalid_credentials", "rate_limited", "server_error", "stage_failed", "cleanup_failed",
]);

function gate(name, file, args, summaryKind = "status", expectedSummary) {
  return { name, file, args, summaryKind, expectedSummary };
}

export const defaultGates = [
  gate("source-precondition", "git", ["diff", "--check"]),
  gate("pinned-vendor-convergence", "npm", ["run", "check:official-client-convergence"]),
  gate("protocol-guards", "npx", ["vitest", "run", "apps/menubar-tauri/e2e/live/live-test-protocol.spec.ts"], "vitest"),
  gate("auth-contracts", "npx", [
    "vitest", "run",
    "apps/menubar-tauri/e2e/live/live-auth-contract.spec.ts",
    "apps/menubar-tauri/src/bitwarden-api/bitwarden-api.spec.ts",
    "apps/menubar-tauri/src/auth/password-login.service.spec.ts",
    "apps/menubar-tauri/src/auth/auth-token-refresh.service.spec.ts",
    "apps/menubar-tauri/src/app/auth/auth.facade.spec.ts",
  ], "vitest"),
  gate("vault-scenario-guards", "npx", [
    "vitest", "run",
    "apps/menubar-tauri/e2e/live/live-vault-scenarios.spec.ts",
    "apps/menubar-tauri/src/vault/vault-sync.service.spec.ts",
    "apps/menubar-tauri/src/app/vault/vault-session.service.spec.ts",
    "apps/menubar-tauri/src/auth/live-standard-password-login.spec.ts",
  ], "vitest"),
  gate("text-send-guards", "npx", [
    "vitest", "run",
    "apps/menubar-tauri/e2e/live/live-text-send-scenarios.spec.ts",
    "apps/menubar-tauri/src/app/send/send-request.service.spec.ts",
    "apps/menubar-tauri/src/app/send/send-actions.service.spec.ts",
    "apps/menubar-tauri/src/app/send/text-send-operation.spec.ts",
  ], "vitest"),
  gate("m14-typechecks", "npm", ["run", "typecheck:m14"]),
  gate("web-production-build", "npm", ["run", "build:web"]),
  gate("production-bundle-audit-fixtures", "npm", ["run", "test:audit-production-bundle"], "node-test"),
  gate("production-bundle-audit", "npm", ["run", "audit:production-bundle"]),
  { ...gate("chromium-live-matrix", "npm", ["run", "test:live:m14"], "playwright"), expectedTotal: 24 },
  gate("vitest-full", "npm", ["test"], "vitest"),
  { ...gate("playwright-full", "npm", ["run", "test:playwright:release"], "playwright"), expectedTotal: 501 },
  gate("rust-tests", "cargo", ["test", "--manifest-path", "apps/menubar-tauri/src-tauri/Cargo.toml"], "cargo"),
  gate("rust-build", "cargo", ["build", "--manifest-path", "apps/menubar-tauri/src-tauri/Cargo.toml"]),
  { name: "final-integrity-secret-scan", internal: true },
];

export async function runM14Verification(options = {}) {
  const root = resolve(options.root ?? repositoryRoot);
  const machinePath = resolve(options.machinePath ?? join(root, machineReportPath));
  const livePath = resolve(options.livePath ?? join(root, liveResultPath));
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const terminationGraceMs = options.terminationGraceMs ?? defaultTerminationGraceMs;
  const gates = options.gates ?? defaultGates;
  const sourceEnvironment = options.environment ?? process.env;
  const privateInputs = [...new Set([
    ...(options.privateInputs ?? []),
    ...Object.entries(sourceEnvironment)
      .filter(([name]) => name.startsWith(liveInputPrefix) && !publicLiveControlNames.has(name))
      .map(([, value]) => value),
  ].filter((value) => typeof value === "string" && value !== ""))];
  const scrubbedEnvironment = withoutLiveInputs(sourceEnvironment);
  const onStatus = options.onStatus ?? ((name, status) => {
    process.stdout.write(`M14 ${name}: ${status}\n`);
  });

  const sourceHead = command(root, "git", ["rev-parse", "HEAD"]);
  if (options.expectedSourceHead && sourceHead !== options.expectedSourceHead) {
    throw new Error("M14 source revision does not match the expected committed source");
  }
  assertCommittedSource(root, sourceHead);
  const dirtyBefore = worktreeStatus(root);
  if (dirtyBefore) throw new Error("verify:m14 requires a clean source worktree");
  assertVendorRevision(root);

  const liveResultDirectory = mkdtempSync(join(tmpdir(), "m14-live-gate-"));
  const childLiveResultPath = join(liveResultDirectory, "result.json");
  const playwrightDiagnosticPath = join(liveResultDirectory, "playwright-diagnostic.json");
  let liveRows = buildExternalLiveRows(sourceEnvironment);
  const results = [];
  try {
    for (const current of gates) {
      try {
        if (current.internal || current.name === "final-integrity-secret-scan") {
          const provisionalGates = [
            ...results,
            { name: current.name, status: "passed", exitCode: 0 },
          ];
          assertFinalIntegrity(root, sourceHead);
          const provisional = buildMachineReport(sourceHead, provisionalGates, liveRows);
          assertSafeMachineReport(provisional, privateInputs);
          assertSafeText(buildLiveResult(provisional), privateInputs);
        } else {
          const isLiveGate = current.name === "chromium-live-matrix";
          const isAggregatePlaywrightGate = current.name === "playwright-full";
          const environment = isLiveGate
            ? liveGateEnvironment(sourceEnvironment, scrubbedEnvironment, childLiveResultPath)
            : isAggregatePlaywrightGate
              ? { ...scrubbedEnvironment, [playwrightDiagnosticEnvironmentName]: playwrightDiagnosticPath }
              : scrubbedEnvironment;
          const execution = await runGate(current, {
            root,
            environment,
            privateInputs,
            timeoutMs: current.timeoutMs ?? timeoutMs,
            terminationGraceMs,
          });
          if (execution.privateOutputDetected) {
            throw new Error("M14 gate output contains private input");
          }
          assertNoPrivateValues(`${execution.stdout}\n${execution.stderr}`, privateInputs);
          if (execution.timedOut) throw new Error(`M14 gate timeout: ${current.name}`);
          if (execution.spawnError || execution.exitCode !== 0 || execution.signal) {
            if (isLiveGate) {
              throw new Error(
                `M14 chromium-live-matrix failed: ${readLiveFailureId(childLiveResultPath, privateInputs)}`,
              );
            }
            if (isAggregatePlaywrightGate) {
              throw new Error(
                `M14 playwright-full failed: ${readPlaywrightFailureIdentity(
                  playwrightDiagnosticPath,
                  root,
                  privateInputs,
                )}`,
              );
            }
            throw new Error(`M14 gate failed: ${current.name}`);
          }
          const summary = summarize(current.summaryKind ?? "status", execution.stdout, execution.stderr);
          if (summary.failed !== 0) throw new Error(`M14 gate failed: ${current.name}`);
          if (
            current.expectedSummary &&
            (summary.passed !== current.expectedSummary.passed ||
              summary.skipped !== current.expectedSummary.skipped)
          ) {
            throw new Error(`M14 gate summary failed: ${current.name}`);
          }
          if (current.expectedTotal && summary.passed + summary.skipped !== current.expectedTotal) {
            throw new Error(`M14 gate summary failed: ${current.name}`);
          }
          if (isLiveGate) {
            liveRows = readLiveRows(childLiveResultPath, sourceEnvironment, privateInputs);
          }
        }
        results.push({ name: current.name, status: "passed", exitCode: 0 });
        onStatus(current.name, "passed");
      } catch (error) {
        onStatus(current.name, "failed");
        throw error;
      }
    }

    const report = buildMachineReport(sourceHead, results, liveRows);
    assertSafeMachineReport(report, privateInputs);
    const machineContents = `${JSON.stringify(report, null, 2)}\n`;
    const liveContents = buildLiveResult(report);
    assertSafeText(machineContents, privateInputs);
    assertSafeText(liveContents, privateInputs);
    publishReports([
      { path: machinePath, contents: machineContents },
      { path: livePath, contents: liveContents },
    ]);
    return report;
  } finally {
    rmSync(liveResultDirectory, { recursive: true, force: true });
  }
}

export function buildExternalLiveRows(environment = {}) {
  return ["cloud-us", "cloud-eu", "self-hosted"].flatMap((service) => {
    const readiness = liveServiceReadiness(service, environment);
    const authentication = readiness.status === "ready"
      ? { status: "blocked_external", reasonCode: "stage_failed" }
      : readiness;
    const mutation = readiness.status !== "ready"
      ? readiness
      : environment.BARWARDEN_LIVE_MUTATION === "true"
        ? { status: "blocked_external", reasonCode: "stage_failed" }
        : { status: "skipped_external", reasonCode: "mutation_disabled" };
    return [
      externalRow(service, "read-only", "token", authentication.status, authentication.reasonCode),
      externalRow(service, "read-only", "refresh", authentication.status, authentication.reasonCode),
      externalRow(service, "read-only", "sync", authentication.status, authentication.reasonCode),
      externalRow(service, "read-only", "token", "blocked_external", "challenge_not_triggered"),
      ...["folder", "login", "card", "identity", "secure-note", "text-send", "file-send-non-interference"]
        .map((stage) => externalRow(service, "mutation", stage, mutation.status, mutation.reasonCode)),
    ];
  });
}

function externalRow(service, mode, stage, status, reasonCode) {
  return { service, mode, stage, status, reasonCode };
}

function liveServiceReadiness(service, environment) {
  const names = service === "self-hosted" ? selfHostedInputNames : cloudInputNames;
  const present = names.filter((name) => typeof environment[name] === "string" && environment[name].trim() !== "");
  if (present.length === 0) {
    return { status: "skipped_external", reasonCode: "credentials_absent" };
  }
  if (present.length !== names.length) {
    return { status: "blocked_external", reasonCode: "credentials_partial" };
  }
  if (service !== "self-hosted") {
    const region = environment.BARWARDEN_LIVE_CLOUD_REGION.trim().toUpperCase();
    if (region !== "US" && region !== "EU") {
      return { status: "blocked_external", reasonCode: "stage_failed" };
    }
    const selected = region === "EU" ? "cloud-eu" : "cloud-us";
    if (selected !== service) {
      return { status: "skipped_external", reasonCode: "service_not_selected" };
    }
  }
  return { status: "ready" };
}

function liveGateEnvironment(source, scrubbed, resultPath) {
  const liveInputs = Object.fromEntries(
    Object.entries(source).filter(([name]) => name.startsWith(liveInputPrefix)),
  );
  return { ...scrubbed, ...liveInputs, [liveResultEnvironmentName]: resultPath };
}

function readLiveRows(path, environment, privateInputs) {
  const result = readLiveEnvelope(path, privateInputs);
  if (result.failure !== null) throw new Error("M14 live gate result contains a failure");
  assertLiveRowInventory(result.rows);
  for (const row of result.rows) assertLiveRow(row, false);
  assertLiveReadinessTruth(result.rows, environment);
  return result.rows;
}

function readLiveFailureId(path, privateInputs) {
  try {
    const result = readLiveEnvelope(path, privateInputs);
    return allowedLiveFailureIds.has(result.failure)
      ? result.failure
      : "chromium_live_matrix_failed";
  } catch {
    return "chromium_live_matrix_failed";
  }
}

function readPlaywrightFailureIdentity(path, root, privateInputs) {
  try {
    const failure = readSafePlaywrightDiagnostic(path, root, privateInputs);
    return `${failure.project} ${failure.file}:${failure.line}`;
  } catch {
    return "playwright_full_diagnostic_invalid";
  }
}

function readLiveEnvelope(path, privateInputs) {
  if (!existsSync(path)) throw new Error("M14 live gate result is missing");
  const source = readFileSync(path, "utf8");
  if (Buffer.byteLength(source) > 65_536) throw new Error("M14 live gate result is oversized");
  assertSafeText(source, privateInputs);
  let result;
  try {
    result = JSON.parse(source);
  } catch {
    throw new Error("M14 live gate result is invalid");
  }
  assertExactKeys(result, ["schema", "rows", "failure"], "live gate result");
  if (result.schema !== "m14-live-gate-result-v1" || !Array.isArray(result.rows) || result.rows.length > 33) {
    throw new Error("M14 live gate result is invalid");
  }
  if (result.failure !== null && !allowedLiveFailureIds.has(result.failure)) {
    throw new Error("M14 live gate failure identifier is invalid");
  }
  for (const row of result.rows) assertLiveRow(row, true);
  return result;
}

function assertLiveRowInventory(rows) {
  if (rows.length !== 33) throw new Error("M14 live gate result row inventory is invalid");
  const expectedIdentities = buildExternalLiveRows().map(liveRowIdentity);
  const actualIdentities = rows.map(liveRowIdentity);
  if (JSON.stringify(actualIdentities) !== JSON.stringify(expectedIdentities)) {
    throw new Error("M14 live gate result row inventory is invalid");
  }
}

function assertLiveReadinessTruth(rows, environment) {
  const required = buildExternalLiveRows(environment);
  for (let serviceIndex = 0; serviceIndex < 3; serviceIndex += 1) {
    const offset = serviceIndex * 11;
    const readiness = liveServiceReadiness(rows[offset].service, environment);
    if (readiness.status !== "ready") {
      assertExactLiveRows(rows, required, offset, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      continue;
    }

    const authenticationRows = rows.slice(offset, offset + 3);
    const authenticationPassed = authenticationRows.every(({ status }) => status === "passed");
    const authenticationChallengeBlocked = authenticationRows.every(isChallengeInputAbsentRow);
    if (!authenticationPassed && !authenticationChallengeBlocked) {
      throw new Error("M14 live gate result contradicts input readiness");
    }
    const challenge = rows[offset + 3];
    if (
      (authenticationChallengeBlocked && !isChallengeInputAbsentRow(challenge)) ||
      (authenticationPassed && !(
        challenge.status === "passed" ||
        (challenge.status === "blocked_external" && challenge.reasonCode === "challenge_not_triggered")
      ))
    ) {
      throw new Error("M14 live gate result contradicts input readiness");
    }

    if (environment.BARWARDEN_LIVE_MUTATION === "true") {
      for (const row of rows.slice(offset + 4, offset + 11)) {
        if (row.status !== "passed" && !isChallengeInputAbsentRow(row)) {
          throw new Error("M14 live gate result contradicts input readiness");
        }
      }
    } else {
      assertExactLiveRows(rows, required, offset, [4, 5, 6, 7, 8, 9, 10]);
    }
  }
}

function assertExactLiveRows(rows, required, offset, indexes) {
  for (const index of indexes) {
    if (JSON.stringify(rows[offset + index]) !== JSON.stringify(required[offset + index])) {
      throw new Error("M14 live gate result contradicts input readiness");
    }
  }
}

function isChallengeInputAbsentRow(row) {
  return row.status === "blocked_external" && row.reasonCode === "challenge_input_absent";
}

function liveRowIdentity(row) {
  return { service: row.service, mode: row.mode, stage: row.stage };
}

function buildMachineReport(sourceHead, gates, liveRows) {
  return {
    schema: "m14-live-service-verification-v1",
    sourceHead,
    vendorRevision: expectedVendorRevision,
    gates,
    liveRows,
    aggregate: aggregateRows(liveRows),
  };
}

export function assertSafeMachineReport(report, privateInputs = []) {
  assertExactKeys(report, ["schema", "sourceHead", "vendorRevision", "gates", "liveRows", "aggregate"], "machine report");
  if (report.schema !== "m14-live-service-verification-v1") throw new Error("M14 report schema is invalid");
  if (!/^[0-9a-f]{40}$/.test(report.sourceHead)) throw new Error("M14 report source revision is invalid");
  if (report.vendorRevision !== expectedVendorRevision) throw new Error("M14 report vendor revision is invalid");
  if (!Array.isArray(report.gates) || report.gates.length === 0) throw new Error("M14 report gates are invalid");
  for (const gateResult of report.gates) {
    assertExactKeys(gateResult, ["name", "status", "exitCode"], "gate report");
    if (typeof gateResult.name !== "string" || gateResult.status !== "passed" || gateResult.exitCode !== 0) {
      throw new Error("M14 gate report status is invalid");
    }
  }
  if (!Array.isArray(report.liveRows)) throw new Error("M14 live report rows are invalid");
  assertLiveRowInventory(report.liveRows);
  for (const row of report.liveRows) {
    assertLiveRow(row, false);
  }
  assertExactKeys(report.aggregate, ["passed", "skippedExternal", "blockedExternal", "failed"], "aggregate report");
  const expected = aggregateRows(report.liveRows);
  if (JSON.stringify(report.aggregate) !== JSON.stringify(expected) || report.aggregate.failed !== 0) {
    throw new Error("M14 aggregate report is invalid");
  }
  assertSafeText(JSON.stringify(report), privateInputs);
}

function assertLiveRow(row, allowFailed) {
  const keys = row?.status === "passed"
    ? ["service", "mode", "stage", "status"]
    : ["service", "mode", "stage", "status", "reasonCode"];
  assertExactKeys(row, keys, "live row report");
  if (!allowedServices.has(row.service) || !allowedModes.has(row.mode) || !allowedStages.has(row.stage)) {
    throw new Error("M14 live row field is invalid");
  }
  const statusAllowed = allowedStatuses.has(row.status) || (allowFailed && row.status === "failed");
  if (!statusAllowed || (row.status !== "passed" && !allowedReasons.has(row.reasonCode))) {
    throw new Error("M14 live row status is invalid");
  }
}

function aggregateRows(rows) {
  return {
    passed: rows.filter(({ status }) => status === "passed").length,
    skippedExternal: rows.filter(({ status }) => status === "skipped_external").length,
    blockedExternal: rows.filter(({ status }) => status === "blocked_external").length,
    failed: 0,
  };
}

function buildLiveResult(report) {
  const rows = report.liveRows.map((row) =>
    `| ${row.service} | ${row.mode} | ${row.stage} | ${row.status} | ${row.reasonCode ?? "none"} |`,
  ).join("\n");
  const selfHostedExitPassed = report.liveRows.filter(({ service }) => service === "self-hosted")
    .filter(({ reasonCode }) => reasonCode !== "challenge_not_triggered")
    .every(({ status }) => status === "passed");
  const exitGate = selfHostedExitPassed
    ? "passed by the compatible self-hosted read-only plus mutation rows"
    : "not passed because the compatible self-hosted read-only plus mutation rows are incomplete";
  return `# M14 Live Service Result\n\n- Milestone state: in_progress / implementation_complete-live_external_unverified.\n- Source revision: ${report.sourceHead}\n- Vendor revision: ${report.vendorRevision}\n- Controller gates: ${report.gates.length} passed; 0 failed.\n- Live aggregate: ${report.aggregate.passed} passed; ${report.aggregate.skippedExternal} skipped_external; ${report.aggregate.blockedExternal} blocked_external; 0 failed.\n- Exit gate: ${exitGate}.\n- Live input isolation: live values were available only to chromium-live-matrix; every other child environment was scrubbed.\n\n| Service | Mode | Stage | Status | Reason |\n| --- | --- | --- | --- | --- |\n${rows}\n`;
}

function withoutLiveInputs(input) {
  const output = {};
  for (const name of Object.keys(input)) {
    if (!name.startsWith(liveInputPrefix)) output[name] = input[name];
  }
  return output;
}

function assertCommittedSource(root, sourceHead) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sourceHead}^{commit}`], { cwd: root, stdio: "ignore" });
  } catch {
    throw new Error("M14 source revision is not committed");
  }
}

function assertVendorRevision(root) {
  const actual = readFileSync(join(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"), "utf8").trim();
  if (actual !== expectedVendorRevision) throw new Error("M14 vendor revision drift");
  const vendorStatus = command(root, "git", [
    "status", "--porcelain=v1", "--untracked-files=all", "--", "vendor/bitwarden-clients",
  ]);
  if (vendorStatus) throw new Error("M14 vendor tree drift");
}

function assertFinalIntegrity(root, sourceHead) {
  const finalHead = command(root, "git", ["rev-parse", "HEAD"]);
  if (finalHead !== sourceHead) throw new Error("M14 source revision changed during verification");
  if (worktreeStatus(root)) throw new Error("M14 final integrity requires a clean source worktree");
  assertVendorRevision(root);
}

function worktreeStatus(root) {
  return command(root, "git", ["status", "--porcelain=v1", "--untracked-files=all"]);
}

function command(root, file, args) {
  return execFileSync(file, args, { cwd: root, encoding: "utf8" }).trim();
}

function runGate(current, { root, environment, privateInputs, timeoutMs, terminationGraceMs }) {
  return new Promise((resolveRun) => {
    let stdout = "";
    let stderr = "";
    let privateOutputDetected = false;
    const stdoutScanner = createPrivateValueScanner(privateInputs);
    const stderrScanner = createPrivateValueScanner(privateInputs);
    let child;
    let settled = false;
    let timedOut = false;
    let timeout;
    let forceKill;
    let cleanupTimer;
    let cleanupPending = false;
    let leaderClose = null;
    let terminationError = null;
    const finish = (exitCode, signal, spawnError = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKill);
      clearTimeout(cleanupTimer);
      resolveRun({ exitCode, signal, spawnError, timedOut, privateOutputDetected, stdout, stderr });
    };
    try {
      child = spawn(current.file, current.args, {
        cwd: root,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (error) {
      finish(null, null, error.message);
      return;
    }
    child.stdout.on("data", (chunk) => {
      privateOutputDetected ||= stdoutScanner(chunk);
      stdout = appendCapture(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      privateOutputDetected ||= stderrScanner(chunk);
      stderr = appendCapture(stderr, chunk);
    });
    child.once("error", (error) => finish(null, null, error.message));
    child.once("close", (code, signal) => {
      if (timedOut && cleanupPending) {
        leaderClose = { code, signal };
        return;
      }
      finish(code, signal);
    });
    timeout = setTimeout(() => {
      timedOut = true;
      cleanupPending = true;
      terminationError = terminateProcessGroup(child, "SIGTERM");
      forceKill = setTimeout(() => {
        terminationError ??= terminateProcessGroup(child, "SIGKILL");
        const deadline = Date.now() + terminationGraceMs * 2;
        const completeCleanup = () => {
          const group = inspectProcessGroup(child.pid);
          terminationError ??= group.error;
          if (group.alive && Date.now() < deadline) {
            terminationError ??= terminateProcessGroup(child, "SIGKILL");
            cleanupTimer = setTimeout(completeCleanup, 10);
            return;
          }
          if (group.alive) {
            terminationError ??= "Timed-out M14 gate process group remained after SIGKILL";
          }
          cleanupPending = false;
          finish(leaderClose?.code ?? null, leaderClose?.signal ?? "SIGKILL", terminationError);
        };
        if (process.platform === "win32") {
          cleanupPending = false;
          finish(leaderClose?.code ?? null, leaderClose?.signal ?? "SIGKILL", terminationError);
        } else {
          completeCleanup();
        }
      }, terminationGraceMs);
    }, timeoutMs);
  });
}

function appendCapture(current, chunk) {
  return `${current}${String(chunk)}`.slice(-1_048_576);
}

function createPrivateValueScanner(privateInputs) {
  const privateBuffers = privateInputs.map((value) => Buffer.from(value)).filter(({ length }) => length > 0);
  const overlapLength = Math.max(0, ...privateBuffers.map(({ length }) => length - 1));
  let overlap = Buffer.alloc(0);
  return (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const scan = overlap.length ? Buffer.concat([overlap, bytes]) : bytes;
    const detected = privateBuffers.some((value) => scan.indexOf(value) !== -1);
    overlap = overlapLength > 0 ? scan.subarray(Math.max(0, scan.length - overlapLength)) : Buffer.alloc(0);
    return detected;
  };
}

function terminateProcessGroup(child, signal) {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
    return null;
  } catch (error) {
    if (error?.code === "ESRCH") return null;
    return `Could not terminate M14 gate process group with ${signal}`;
  }
}

function inspectProcessGroup(processGroupId) {
  if (process.platform === "win32" || !processGroupId) return { alive: false, error: null };
  try {
    process.kill(-processGroupId, 0);
    return { alive: true, error: null };
  } catch (error) {
    if (error?.code === "ESRCH") return { alive: false, error: null };
    return { alive: false, error: "Could not inspect M14 gate process group" };
  }
}

function summarize(kind, stdout, stderr) {
  const output = `${stdout}\n${stderr}`.replace(/\u001b\[[0-9;]*m/g, "");
  if (kind === "status") return { passed: 1, failed: 0, skipped: 0 };
  if (kind === "node-test") {
    return {
      passed: summaryNumber(output, /^\s*(?:ℹ\s+)?pass\s+(\d+)\s*$/gm, "node pass"),
      failed: summaryNumber(output, /^\s*(?:ℹ\s+)?fail\s+(\d+)\s*$/gm, "node fail"),
      skipped: summaryNumber(output, /^\s*(?:ℹ\s+)?skipped\s+(\d+)\s*$/gm, "node skipped"),
    };
  }
  const passed = optionalSummaryNumber(output, /(\d+) passed/g);
  const failed = optionalSummaryNumber(output, /(\d+) failed/g);
  const skipped = optionalSummaryNumber(output, kind === "cargo" ? /(\d+) ignored/g : /(\d+) skipped/g);
  if (passed === null && failed === null && skipped === null) {
    throw new Error(`M14 could not parse ${kind} summary`);
  }
  return { passed: passed ?? 0, failed: failed ?? 0, skipped: skipped ?? 0 };
}

function summaryNumber(output, pattern, label) {
  const value = optionalSummaryNumber(output, pattern);
  if (value === null) throw new Error(`M14 could not parse ${label} summary`);
  return value;
}

function optionalSummaryNumber(output, pattern) {
  const match = [...output.matchAll(pattern)].at(-1);
  return match ? Number(match[1]) : null;
}

function assertNoPrivateValues(text, privateInputs) {
  if (privateInputs.some((value) => text.includes(value))) {
    throw new Error("M14 gate output contains private input");
  }
}

function assertSafeText(text, privateInputs) {
  assertNoPrivateValues(text, privateInputs);
  const forbidden = [
    /\bhttps?:\/\/[^\s"']+/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("M14 report contains a private identifier");
  }
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`M14 ${label} is invalid`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`M14 ${label} contains a forbidden field`);
  }
}

export function publishReports(artifacts, fileSystem = {}) {
  const rename = fileSystem.rename ?? renameSync;
  const transaction = `${process.pid}.${Date.now()}`;
  const staged = artifacts.map((artifact, index) => ({
    ...artifact,
    temporaryPath: `${artifact.path}.${transaction}.${index}.tmp`,
    previous: existsSync(artifact.path) ? readFileSync(artifact.path) : null,
  }));
  const published = [];
  try {
    for (const artifact of staged) {
      writeFileSync(artifact.temporaryPath, artifact.contents, { flag: "wx" });
    }
    for (const artifact of staged) {
      rename(artifact.temporaryPath, artifact.path);
      published.push(artifact);
    }
  } catch (publicationError) {
    const rollbackErrors = [];
    for (const artifact of published.reverse()) {
      try {
        if (artifact.previous === null) {
          rmSync(artifact.path, { force: true });
        } else {
          const rollbackPath = `${artifact.temporaryPath}.rollback`;
          writeFileSync(rollbackPath, artifact.previous, { flag: "wx" });
          rename(rollbackPath, artifact.path);
        }
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [publicationError, ...rollbackErrors],
        "M14 report publication and rollback failed",
      );
    }
    throw publicationError;
  } finally {
    for (const artifact of staged) {
      rmSync(artifact.temporaryPath, { force: true });
      rmSync(`${artifact.temporaryPath}.rollback`, { force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runM14Verification();
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("M14 ")
      ? error.message
      : "M14 verification failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
