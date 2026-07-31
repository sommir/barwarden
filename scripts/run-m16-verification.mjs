#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BARWARDEN_RELEASE_BRAND } from "./barwarden-brand.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const expectedVendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const reportRelativePath = "docs/superpowers/specs/2026-07-22-m16-machine-verification.json";
const defaultTimeoutMs = 30 * 60 * 1000;
const defaultTerminationGraceMs = 1_000;
const maximumCaptureBytes = 1_048_576;
const expectedProduct = Object.freeze({
  name: BARWARDEN_RELEASE_BRAND.productName,
  identifier: BARWARDEN_RELEASE_BRAND.bundleIdentifier,
  version: "0.1.1",
  minimumMacosVersion: "13.0",
});

export const artifactPaths = Object.freeze({
  app: `apps/menubar-tauri/src-tauri/target/release/bundle/macos/${BARWARDEN_RELEASE_BRAND.productName}.app`,
  executable: `apps/menubar-tauri/src-tauri/target/release/bundle/macos/${BARWARDEN_RELEASE_BRAND.productName}.app/Contents/MacOS/${BARWARDEN_RELEASE_BRAND.executableName}`,
  infoPlist: `apps/menubar-tauri/src-tauri/target/release/bundle/macos/${BARWARDEN_RELEASE_BRAND.productName}.app/Contents/Info.plist`,
  dmg: `apps/menubar-tauri/src-tauri/target/release/bundle/dmg/${BARWARDEN_RELEASE_BRAND.productName}_0.1.1_aarch64.dmg`,
});

const externalBlockerCodes = Object.freeze([
  "apple_release_credentials_absent",
  "second_display_absent",
  "clean_user_session_absent",
  "disposable_second_account_absent",
  "accessibility_confirmation_required",
  "live_service_inputs_absent",
]);

function gate(name, file, args, summaryKind = "status") {
  return { name, file, args, summaryKind };
}

export const defaultGates = Object.freeze([
  { name: "source-precondition", internal: "source-precondition" },
  gate("pinned-vendor-convergence", "npm", ["run", "check:official-client-convergence"]),
  gate("m14-local-contracts", "npm", ["run", "test:live:m14:contract"], "vitest"),
  gate("m14-typechecks", "npm", ["run", "typecheck:m14"]),
  gate("vitest-full", "npm", ["test"], "vitest"),
  { ...gate("playwright-release", "npm", ["run", "test:playwright:release"], "playwright"), expectedTotal: 501 },
  { ...gate("m16-visual-accessibility", "npx", [
    "playwright", "test", "apps/menubar-tauri/e2e/m16-release-visual-accessibility.spec.ts",
    "apps/menubar-tauri/e2e/macos-ui-visual-accessibility.spec.ts",
    "--project=chromium", "--project=webkit", "--workers=1", "--reporter=line",
  ], "playwright"), expectedTotal: 88 },
  gate("web-production-build", "npm", ["run", "build:web"]),
  gate("production-bundle-audit-fixtures", "npm", ["run", "test:audit-production-bundle"]),
  gate("rust-tests", "cargo", [
    "test", "--manifest-path", "apps/menubar-tauri/src-tauri/Cargo.toml",
  ], "cargo"),
  gate("rust-check", "cargo", [
    "check", "--manifest-path", "apps/menubar-tauri/src-tauri/Cargo.toml",
  ]),
  gate("rust-release-build", "cargo", [
    "build", "--release", "--manifest-path", "apps/menubar-tauri/src-tauri/Cargo.toml",
  ]),
  gate("tauri-release-candidate-build", "npm", ["run", "tauri:build"]),
  gate("production-bundle-audit", "npm", ["run", "audit:production-bundle"]),
  { name: "candidate-artifact-identity", internal: "capture-candidate" },
  gate("macos-bundle-audit-fixtures", "npm", ["run", "test:macos-bundle"]),
  gate("macos-bundle-audit", "scripts/verify-macos-bundle.sh", [
    "--app", artifactPaths.app,
    "--dmg", artifactPaths.dmg,
  ]),
  gate("forbidden-surface-scan", "npx", [
    "vitest", "run",
    "apps/menubar-tauri/src/app/app.routes.spec.ts",
    "apps/menubar-tauri/src/app/plan-a-scope.guard.spec.ts",
    "apps/menubar-tauri/src/app/standard-auth-scope.guard.spec.ts",
    "apps/menubar-tauri/src/app/upstream-import-guard.spec.ts",
    "apps/menubar-tauri/src/host/native-command-surface.guard.spec.ts",
  ], "vitest"),
  { name: "license-attribution-inventory", internal: "license-inventory" },
  gate("accidental-secret-scan", "scripts/verify-macos-bundle.sh", ["--inputs-only"]),
  { name: "final-source-vendor-artifact-identity", internal: "final-identity" },
]);

export async function runM16Verification(options = {}) {
  const root = resolve(options.root ?? repositoryRoot);
  const reportPath = resolve(options.reportPath ?? join(root, reportRelativePath));
  const gates = options.gates ?? defaultGates;
  assertExactGateContract(gates);
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const terminationGraceMs = options.terminationGraceMs ?? defaultTerminationGraceMs;
  const sourceEnvironment = options.environment ?? process.env;
  const privateInputs = collectPrivateInputs(sourceEnvironment, options.privateInputs ?? []);
  const childEnvironment = buildChildEnvironment(sourceEnvironment);
  const executeGate = options.executeGate ?? ((current, context) => runProcessGate(current, context));
  const onStatus = options.onStatus ?? ((name, status) => {
    process.stdout.write(`M16 ${name}: ${status}\n`);
  });

  const sourceRevision = command(root, "git", ["rev-parse", "HEAD"]);
  if (options.expectedSourceHead && sourceRevision !== options.expectedSourceHead) {
    throw new Error("M16 source revision does not match the expected committed source");
  }
  assertCommittedSource(root, sourceRevision);
  if (worktreeStatus(root)) throw new Error("verify:m16 requires a clean source worktree");
  assertVendorRevision(root);
  const packageJsonSha256 = sha256File(join(root, "package.json"));
  const product = readProductMetadata(root);
  let candidate = null;
  const results = [];

  for (const current of gates) {
    try {
      let counts = emptyCounts();
      if (current.internal === "source-precondition") {
        assertInitialIdentity(root, sourceRevision, packageJsonSha256);
      } else if (current.internal === "capture-candidate") {
        candidate = captureCandidate(root);
      } else if (current.internal === "license-inventory") {
        assertLicenseInventory(root, product);
      } else if (current.internal === "final-identity") {
        if (!candidate) throw new Error("M16 candidate identity was not captured");
        assertFinalIdentity(root, sourceRevision, packageJsonSha256, candidate);
      } else if (current.internal) {
        throw new Error("M16 gate contract contains an unknown internal gate");
      } else {
        const execution = normalizeExecution(await executeGate(current, {
          root,
          environment: childEnvironment,
          privateInputs,
          timeoutMs: current.timeoutMs ?? timeoutMs,
          terminationGraceMs,
        }));
        if (execution.privateOutputDetected || containsPrivateValue(
          `${execution.stdout}\n${execution.stderr}`,
          privateInputs,
        )) {
          throw new Error("M16 gate output contains private input");
        }
        if (execution.timedOut) throw new Error(`M16 gate timeout: ${current.name}`);
        if (execution.spawnError || execution.terminationError || execution.exitCode !== 0 || execution.signal) {
          throw new Error(`M16 gate failed: ${current.name}`);
        }
        counts = summarize(current.summaryKind, execution.stdout, execution.stderr);
        if (counts.failed !== 0) throw new Error(`M16 gate failed: ${current.name}`);
        if (current.summaryKind !== "status" && counts.passed === 0) {
          throw new Error(`M16 gate summary failed: ${current.name}`);
        }
        if (current.expectedTotal && counts.passed + counts.skipped !== current.expectedTotal) {
          throw new Error(`M16 gate summary failed: ${current.name}`);
        }
      }
      results.push({ name: current.name, status: "passed", counts });
      onStatus(current.name, "passed");
    } catch (error) {
      onStatus(current.name, "failed");
      throw error;
    }
  }

  if (!candidate) throw new Error("M16 candidate identity was not captured");
  const report = buildMachineReport({
    sourceRevision,
    packageJsonSha256,
    product,
    candidate,
    gates: results,
  });
  assertSafeMachineReport(report, privateInputs);
  publishMachineReport(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function assertExactGateContract(gates) {
  if (gates !== defaultGates && JSON.stringify(gates) !== JSON.stringify(defaultGates)) {
    throw new Error("M16 ordered gate contract is invalid");
  }
}

function assertInitialIdentity(root, sourceRevision, packageJsonSha256) {
  if (command(root, "git", ["rev-parse", "HEAD"]) !== sourceRevision) {
    throw new Error("M16 source revision changed during verification");
  }
  if (sha256File(join(root, "package.json")) !== packageJsonSha256) {
    throw new Error("M16 package identity changed during verification");
  }
  assertVendorRevision(root);
  if (worktreeStatus(root)) throw new Error("M16 source-precondition requires a clean source worktree");
}

function assertFinalIdentity(root, sourceRevision, packageJsonSha256, candidate) {
  if (command(root, "git", ["rev-parse", "HEAD"]) !== sourceRevision) {
    throw new Error("M16 source revision changed during verification");
  }
  if (sha256File(join(root, "package.json")) !== packageJsonSha256) {
    throw new Error("M16 package identity changed during verification");
  }
  assertVendorRevision(root);
  const finalCandidate = captureCandidate(root);
  for (const name of ["executable", "infoPlist", "dmg", "app"]) {
    if (finalCandidate[name].sha256 !== candidate[name].sha256) {
      throw new Error(`M16 ${name} identity changed during verification`);
    }
  }
  if (worktreeStatus(root)) throw new Error("M16 final identity requires a clean source worktree");
}

function assertCommittedSource(root, sourceRevision) {
  try {
    execFileSync("git", ["cat-file", "-e", `${sourceRevision}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    throw new Error("M16 source revision is not committed");
  }
}

function assertVendorRevision(root) {
  const revisionPath = join(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT");
  let actual;
  try {
    actual = readFileSync(revisionPath, "utf8").trim();
  } catch {
    throw new Error("M16 vendor revision drift");
  }
  if (actual !== expectedVendorRevision) throw new Error("M16 vendor revision drift");
  const status = command(root, "git", [
    "status", "--porcelain=v1", "--untracked-files=all", "--", "vendor/bitwarden-clients",
  ]);
  if (status) throw new Error("M16 vendor tree drift");
}

function readProductMetadata(root) {
  let packageJson;
  let config;
  try {
    packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    config = JSON.parse(readFileSync(
      join(root, "apps/menubar-tauri/src-tauri/tauri.conf.json"),
      "utf8",
    ));
  } catch {
    throw new Error("M16 product metadata is invalid");
  }
  const product = {
    name: config.productName,
    identifier: config.identifier,
    version: config.version,
    minimumMacosVersion: config.bundle?.macOS?.minimumSystemVersion,
  };
  if (
    packageJson.license !== "GPL-3.0-only" ||
    config.bundle?.license !== "GPL-3.0-only" ||
    JSON.stringify(product) !== JSON.stringify(expectedProduct)
  ) {
    throw new Error("M16 product metadata is invalid");
  }
  return product;
}

function captureCandidate(root) {
  const absolute = Object.fromEntries(
    Object.entries(artifactPaths).map(([name, path]) => [name, join(root, path)]),
  );
  assertArtifactType(absolute.app, "directory", "app");
  assertExclusiveExecutablePayload(absolute.app);
  for (const name of ["executable", "infoPlist", "dmg"]) {
    assertArtifactType(absolute[name], "file", name);
  }
  return {
    app: { path: artifactPaths.app, sha256: sha256Tree(absolute.app) },
    executable: { path: artifactPaths.executable, sha256: sha256File(absolute.executable) },
    infoPlist: { path: artifactPaths.infoPlist, sha256: sha256File(absolute.infoPlist) },
    dmg: { path: artifactPaths.dmg, sha256: sha256File(absolute.dmg) },
  };
}

function assertArtifactType(path, type, name) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error(`M16 ${name} artifact is absent`);
  }
  const valid = type === "directory" ? stat.isDirectory() : stat.isFile();
  if (!valid || stat.isSymbolicLink()) throw new Error(`M16 ${name} artifact type is invalid`);
}

function assertExclusiveExecutablePayload(appPath) {
  const executableDirectory = join(appPath, "Contents/MacOS");
  let entries;
  try {
    entries = readdirSync(executableDirectory).sort();
  } catch {
    throw new Error("M16 app artifact contains unexpected executable payload");
  }
  if (
    entries.length !== 1 ||
    entries[0] !== BARWARDEN_RELEASE_BRAND.executableName
  ) {
    throw new Error("M16 app artifact contains unexpected executable payload");
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Tree(root) {
  const hash = createHash("sha256");
  for (const path of walkEntries(root)) {
    const stat = lstatSync(path);
    hash.update(stat.isDirectory() ? "D\0" : "F\0");
    hash.update(relative(root, path));
    hash.update("\0");
    hash.update((stat.mode & 0o7777).toString(8));
    hash.update("\0");
    if (stat.isFile()) hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function walkEntries(root) {
  return readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(root, entry.name);
      if (entry.isSymbolicLink()) throw new Error("M16 app artifact contains a symbolic link");
      return entry.isDirectory() ? [path, ...walkEntries(path)] : [path];
    });
}

function assertLicenseInventory(root, product) {
  const requiredFiles = [
    "LICENSE",
    "NOTICE.md",
    "vendor/bitwarden-clients/LICENSE.txt",
    "vendor/bitwarden-clients/LICENSE_GPL.txt",
    "vendor/bitwarden-clients/LICENSE_BITWARDEN.txt",
    "vendor/bitwarden-clients/UI_SOURCE_COMMIT",
  ];
  if (requiredFiles.some((path) => !lstatSync(join(root, path)).isFile())) {
    throw new Error("M16 license attribution inventory is incomplete");
  }
  const license = readFileSync(join(root, "LICENSE"), "utf8");
  const notice = readFileSync(join(root, "NOTICE.md"), "utf8");
  if (
    !license.includes("GNU GENERAL PUBLIC LICENSE") ||
    !license.includes("Version 3, 29 June 2007") ||
    !/independent/i.test(notice) ||
    !notice.includes("Bitwarden") ||
    product.identifier !== BARWARDEN_RELEASE_BRAND.bundleIdentifier
  ) {
    throw new Error("M16 license attribution inventory is invalid");
  }
}

function buildMachineReport({ sourceRevision, packageJsonSha256, product, candidate, gates }) {
  const aggregate = gates.reduce((counts, current) => ({
    gatesPassed: counts.gatesPassed + (current.status === "passed" ? 1 : 0),
    gatesFailed: counts.gatesFailed + (current.status === "passed" ? 0 : 1),
    testsPassed: counts.testsPassed + current.counts.passed,
    testsFailed: counts.testsFailed + current.counts.failed,
    testsSkipped: counts.testsSkipped + current.counts.skipped,
  }), {
    gatesPassed: 0,
    gatesFailed: 0,
    testsPassed: 0,
    testsFailed: 0,
    testsSkipped: 0,
  });
  return {
    schema: "m16-release-candidate-verification-v1",
    status: "local_verification_passed_with_external_blockers",
    sourceRevision,
    vendorRevision: expectedVendorRevision,
    packageJsonSha256,
    product,
    artifacts: candidate,
    gates,
    aggregate,
    externalBlockers: [...externalBlockerCodes],
  };
}

export function assertSafeMachineReport(report, privateInputs = []) {
  assertExactKeys(report, [
    "schema", "status", "sourceRevision", "vendorRevision", "packageJsonSha256", "product",
    "artifacts", "gates", "aggregate", "externalBlockers",
  ], "machine report");
  if (report.schema !== "m16-release-candidate-verification-v1") {
    throw new Error("M16 report schema is invalid");
  }
  if (report.status !== "local_verification_passed_with_external_blockers") {
    throw new Error("M16 report status is invalid");
  }
  assertRevision(report.sourceRevision, "source revision");
  if (report.vendorRevision !== expectedVendorRevision) throw new Error("M16 report vendor revision is invalid");
  assertSha256(report.packageJsonSha256, "package hash");
  assertExactKeys(report.product, ["name", "identifier", "version", "minimumMacosVersion"], "product");
  if (JSON.stringify(report.product) !== JSON.stringify(expectedProduct)) {
    throw new Error("M16 report product metadata is invalid");
  }
  assertExactKeys(report.artifacts, ["app", "executable", "infoPlist", "dmg"], "artifacts");
  for (const name of Object.keys(artifactPaths)) {
    const artifact = report.artifacts[name];
    assertExactKeys(artifact, ["path", "sha256"], `${name} artifact`);
    if (artifact.path !== artifactPaths[name]) throw new Error("M16 report artifact path is invalid");
    assertSha256(artifact.sha256, `${name} artifact hash`);
  }
  if (!Array.isArray(report.gates) || report.gates.length !== defaultGates.length) {
    throw new Error("M16 report gate inventory is invalid");
  }
  report.gates.forEach((current, index) => {
    assertExactKeys(current, ["name", "status", "counts"], "gate report");
    if (current.name !== defaultGates[index].name || current.status !== "passed") {
      throw new Error("M16 report gate status is invalid");
    }
    assertCounts(current.counts, "gate counts");
    if (current.counts.failed !== 0) throw new Error("M16 report gate counts are invalid");
    if (defaultGates[index].summaryKind && defaultGates[index].summaryKind !== "status" && current.counts.passed === 0) {
      throw new Error("M16 report gate counts are invalid");
    }
  });
  assertExactKeys(report.aggregate, [
    "gatesPassed", "gatesFailed", "testsPassed", "testsFailed", "testsSkipped",
  ], "aggregate");
  for (const value of Object.values(report.aggregate)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("M16 report aggregate is invalid");
  }
  const expectedAggregate = buildMachineReport({
    sourceRevision: report.sourceRevision,
    packageJsonSha256: report.packageJsonSha256,
    product: report.product,
    candidate: report.artifacts,
    gates: report.gates,
  }).aggregate;
  if (
    JSON.stringify(report.aggregate) !== JSON.stringify(expectedAggregate) ||
    report.aggregate.gatesPassed !== defaultGates.length ||
    report.aggregate.gatesFailed !== 0 ||
    report.aggregate.testsFailed !== 0
  ) {
    throw new Error("M16 report aggregate is invalid");
  }
  if (JSON.stringify(report.externalBlockers) !== JSON.stringify(externalBlockerCodes)) {
    throw new Error("M16 report external blocker inventory is invalid");
  }
  assertSafeText(JSON.stringify(report), privateInputs);
}

function assertCounts(counts, label) {
  assertExactKeys(counts, ["passed", "failed", "skipped"], label);
  for (const value of Object.values(counts)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`M16 report ${label} is invalid`);
  }
}

function assertExactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`M16 report ${label} is invalid`);
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`M16 report ${label} contains a forbidden field`);
  }
}

function assertRevision(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`M16 report ${label} is invalid`);
  }
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`M16 report ${label} is invalid`);
  }
}

function assertSafeText(text, privateInputs) {
  if (containsPrivateValue(text, privateInputs)) throw new Error("M16 report contains private input");
  const forbidden = [
    /\bhttps?:\/\/[^\s"']+/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    throw new Error("M16 report contains a private identifier");
  }
}

export function publishMachineReport(path, contents, fileSystem = {}) {
  const rename = fileSystem.rename ?? renameSync;
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, contents, { flag: "wx", mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    rename(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function runProcessGate(current, {
  root,
  environment,
  privateInputs,
  timeoutMs,
  terminationGraceMs,
}) {
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
      resolveRun({
        exitCode,
        signal,
        spawnError,
        timedOut,
        privateOutputDetected,
        terminationError,
        stdout,
        stderr,
      });
    };
    try {
      child = spawn(current.file, current.args, {
        cwd: root,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch {
      finish(null, null, "spawn_failed");
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
    child.once("error", () => finish(null, null, "spawn_failed"));
    child.once("close", (code, signal) => {
      if (timedOut && cleanupPending) {
        leaderClose = { code, signal };
        return;
      }
      if (process.platform === "win32") {
        finish(code, signal);
        return;
      }
      clearTimeout(timeout);
      cleanupPending = true;
      leaderClose = { code, signal };
      const naturalExitDeadline = Date.now() + terminationGraceMs;
      const inspectNaturalExit = () => {
        const group = inspectProcessGroup(child.pid);
        terminationError ??= group.error;
        if (!group.alive) {
          cleanupPending = false;
          finish(code, signal);
          return;
        }
        if (Date.now() < naturalExitDeadline) {
          cleanupTimer = setTimeout(inspectNaturalExit, 10);
          return;
        }
        terminationError ??= "process_group_remained_after_exit";
        terminateProcessGroup(child, "SIGTERM");
        forceKill = setTimeout(() => {
          terminateProcessGroup(child, "SIGKILL");
          const killDeadline = Date.now() + terminationGraceMs * 2;
          const completeCleanup = () => {
            const remaining = inspectProcessGroup(child.pid);
            if (remaining.alive && Date.now() < killDeadline) {
              cleanupTimer = setTimeout(completeCleanup, 10);
              return;
            }
            if (remaining.alive) terminationError = "process_group_remained_after_sigkill";
            terminationError ??= remaining.error;
            cleanupPending = false;
            finish(code, signal);
          };
          completeCleanup();
        }, terminationGraceMs);
      };
      inspectNaturalExit();
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
          if (group.alive) terminationError ??= "process_group_remained_after_sigkill";
          cleanupPending = false;
          finish(leaderClose?.code ?? null, leaderClose?.signal ?? "SIGKILL");
        };
        if (process.platform === "win32") {
          cleanupPending = false;
          finish(leaderClose?.code ?? null, leaderClose?.signal ?? "SIGKILL");
        } else {
          completeCleanup();
        }
      }, terminationGraceMs);
    }, timeoutMs);
  });
}

function normalizeExecution(execution) {
  return {
    exitCode: execution?.exitCode ?? null,
    signal: execution?.signal ?? null,
    spawnError: execution?.spawnError ?? null,
    terminationError: execution?.terminationError ?? null,
    timedOut: execution?.timedOut ?? false,
    privateOutputDetected: execution?.privateOutputDetected ?? false,
    stdout: execution?.stdout ?? "",
    stderr: execution?.stderr ?? "",
  };
}

function appendCapture(current, chunk) {
  return `${current}${String(chunk)}`.slice(-maximumCaptureBytes);
}

function createPrivateValueScanner(privateInputs) {
  const buffers = privateInputs.map((value) => Buffer.from(value)).filter(({ length }) => length > 0);
  const overlapLength = Math.max(0, ...buffers.map(({ length }) => length - 1));
  let overlap = Buffer.alloc(0);
  return (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const scan = overlap.length ? Buffer.concat([overlap, bytes]) : bytes;
    const detected = buffers.some((value) => scan.indexOf(value) !== -1);
    overlap = overlapLength > 0
      ? scan.subarray(Math.max(0, scan.length - overlapLength))
      : Buffer.alloc(0);
    return detected;
  };
}

function terminateProcessGroup(child, signal) {
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
    return null;
  } catch (error) {
    return error?.code === "ESRCH" ? null : "process_group_termination_failed";
  }
}

function inspectProcessGroup(processGroupId) {
  if (process.platform === "win32" || !processGroupId) return { alive: false, error: null };
  try {
    process.kill(-processGroupId, 0);
    return { alive: true, error: null };
  } catch (error) {
    return error?.code === "ESRCH"
      ? { alive: false, error: null }
      : { alive: false, error: "process_group_inspection_failed" };
  }
}

function summarize(kind, stdout, stderr) {
  if (kind === "status") return emptyCounts();
  const output = `${stdout}\n${stderr}`.replace(/\u001b\[[0-9;]*m/g, "");
  if (kind === "cargo") {
    const matches = [...output.matchAll(
      /test result: [^\n]*?\b(\d+) passed; (\d+) failed; (\d+) ignored;/g,
    )];
    if (!matches.length) throw new Error("M16 could not parse cargo summary");
    return matches.reduce((counts, match) => ({
      passed: counts.passed + Number(match[1]),
      failed: counts.failed + Number(match[2]),
      skipped: counts.skipped + Number(match[3]),
    }), emptyCounts());
  }
  const passed = lastSummaryNumber(output, /(\d+) passed/g);
  const failed = lastSummaryNumber(output, /(\d+) failed/g);
  const skipped = lastSummaryNumber(output, /(\d+) skipped/g);
  if (passed === null && failed === null && skipped === null) {
    throw new Error(`M16 could not parse ${kind} summary`);
  }
  return { passed: passed ?? 0, failed: failed ?? 0, skipped: skipped ?? 0 };
}

function lastSummaryNumber(output, pattern) {
  const match = [...output.matchAll(pattern)].at(-1);
  return match ? Number(match[1]) : null;
}

function emptyCounts() {
  return { passed: 0, failed: 0, skipped: 0 };
}

function collectPrivateInputs(environment, explicit) {
  return [...new Set([
    ...explicit,
    ...Object.entries(environment)
      .filter(([name]) => isSensitiveEnvironmentName(name))
      .map(([, value]) => value),
  ].filter((value) => typeof value === "string" && value !== ""))];
}

function buildChildEnvironment(environment) {
  const child = {};
  for (const [name, value] of Object.entries(environment)) {
    if (!isSensitiveEnvironmentName(name)) child[name] = value;
  }
  child.UPDATE_EVIDENCE = "false";
  return child;
}

function isSensitiveEnvironmentName(name) {
  return name.startsWith("APPLE_") ||
    name.startsWith("BARWARDEN_LIVE_") ||
    name === "BARWARDEN_M16_UPDATE_VISUALS" ||
    name.startsWith("TAURI_SIGNING_PRIVATE_KEY") ||
    name.startsWith("MACOS_CERTIFICATE") ||
    name.startsWith("NOTARY_");
}

function containsPrivateValue(text, privateInputs) {
  return privateInputs.some((value) => value && text.includes(value));
}

function worktreeStatus(root) {
  return command(root, "git", ["status", "--porcelain=v1", "--untracked-files=all"]);
}

function command(root, file, args) {
  return execFileSync(file, args, { cwd: root, encoding: "utf8" }).trim();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runM16Verification();
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith("M16 ")
      ? error.message
      : "M16 verification failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
