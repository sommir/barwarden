#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const expectedVendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const defaultTimeoutMs = 30 * 60 * 1000;
const defaultTerminationGraceMs = 1000;
const finalArtifact = "docs/superpowers/specs/2026-07-20-m13-machine-verification.json";
const evidencePath = "docs/superpowers/screenshots/m13-settings-2026-07-20";
const runtimePath = "docs/superpowers/specs/2026-07-20-m13-settings-runtime-result.md";
const evidenceSetSchema = "m13-settings-evidence-set-v2";
const browserGateNames = new Set([
  "settings-chromium-writer",
  "settings-chromium-read-only",
  "settings-webkit-read-only",
  "playwright-full",
]);
const screenshotFiles = [
  "settings-main-480x600.png",
  "account-security-480x600.png",
  "vault-settings-480x600.png",
  "vault-settings-sync-failure-480x600.png",
  "one-field-settings-480x600.png",
  "appearance-480x600.png",
  "about-480x600.png",
  "about-dialog-480x600.png",
  "change-password-handoff-480x600.png",
];

function gate(name, file, args, env = {}, summaryKind = "status", expectedSummary) {
  return { name, file, args, env: { UPDATE_EVIDENCE: "false", ...env }, summaryKind, expectedSummary };
}

const browserEnvironment = { VITE_BW_VAULT_EVIDENCE: "true" };

export const defaultGates = [
  gate("source-precondition", "git", ["diff", "--check"]),
  gate("pinned-vendor", "npm", ["run", "check:official-settings:upstream"]),
  gate("settings-overlay-guards", "npm", ["test", "--", "--run", "apps/menubar-tauri/src/app/upstream-overlays/settings/settings-overlay.guard.spec.ts"], {}, "vitest", { passed: 9, skipped: 0 }),
  gate("settings-focused", "npm", ["test", "--", "--run", "apps/menubar-tauri/src/app/settings", "apps/menubar-tauri/src/app/app.config.spec.ts", "apps/menubar-tauri/src/app/popup-parity-manifest.spec.ts"], {}, "vitest", { passed: 133, skipped: 0 }),
  gate("vitest-full", "npm", ["test"], {}, "vitest", { passed: 2643, skipped: 7 }),
  gate("official-typechecks", "npm", ["run", "typecheck:m13"]),
  gate("web-production-build", "npm", ["run", "build:web"]),
  gate("production-bundle-audit-fixtures", "npm", ["run", "test:audit-production-bundle"], {}, "node-test", { passed: 3, skipped: 0 }),
  gate("production-bundle-audit", "npm", ["run", "audit:production-bundle"]),
  gate("settings-chromium-writer", "npx", ["playwright", "test", "apps/menubar-tauri/e2e/official-settings-workflows.spec.ts", "--project=chromium", "--workers=1", "--reporter=line"], { ...browserEnvironment, UPDATE_EVIDENCE: "true" }, "playwright", { passed: 5, skipped: 0 }),
  gate("settings-chromium-read-only", "npx", ["playwright", "test", "apps/menubar-tauri/e2e/official-settings-workflows.spec.ts", "--project=chromium-read-only", "--workers=1", "--reporter=line"], browserEnvironment, "playwright", { passed: 4, skipped: 1 }),
  gate("settings-webkit-read-only", "npx", ["playwright", "test", "apps/menubar-tauri/e2e/official-settings-workflows.spec.ts", "--project=webkit-read-only", "--workers=1", "--reporter=line"], browserEnvironment, "playwright", { passed: 4, skipped: 1 }),
  gate("playwright-full", "npx", ["playwright", "test", "--workers=1", "--reporter=line"], {}, "playwright", { passed: 428, skipped: 17 }),
  gate("rust-tests", "cargo", ["test", "--manifest-path", "apps/menubar-tauri/src-tauri/Cargo.toml"], {}, "cargo", { passed: 34, skipped: 1 }),
  gate("rust-build", "cargo", ["build", "--manifest-path", "apps/menubar-tauri/src-tauri/Cargo.toml"]),
  gate("final-integrity", "git", ["diff", "--check"]),
];

export async function runVerification(options = {}) {
  const root = resolve(options.root ?? repositoryRoot);
  const environment = options.environment ?? process.env;
  const artifactPath = resolve(options.artifactPath ?? join(root, finalArtifact));
  const runtimeResultPath = resolve(options.runtimePath ?? join(root, runtimePath));
  const controllerOutputs = [artifactPath, runtimeResultPath];
  const failureReceiptPath = resolve(options.failureReceiptPath ?? "/tmp/m13-verification-failure.json");
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const terminationGraceMs = options.terminationGraceMs ?? defaultTerminationGraceMs;
  const gates = options.gates ?? defaultGates;
  rmSync(failureReceiptPath, { force: true });

  assertNoLiveCredentialFields(environment);
  if (environment.UPDATE_EVIDENCE === "true") {
    throw new Error("verify:m13 owns evidence mode; inherited UPDATE_EVIDENCE=true is forbidden");
  }

  const sourceHead = command(root, "git", ["rev-parse", "HEAD"]);
  if (options.expectedSourceHead && sourceHead !== options.expectedSourceHead) {
    throw new Error(`M13 source HEAD mismatch: expected ${options.expectedSourceHead}; found ${sourceHead}`);
  }
  const dirtyBefore = worktreeStatus(root, controllerOutputs);
  if (dirtyBefore) throw new Error(`verify:m13 requires a clean source worktree:\n${dirtyBefore}`);

  const vendorRevision = readFileSync(join(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"), "utf8").trim();
  if (vendorRevision !== expectedVendorRevision) {
    throw new Error(`M13 vendor revision must be ${expectedVendorRevision}; found ${vendorRevision}`);
  }
  const evidence = validateEvidence(root, sourceHead, vendorRevision);

  const results = [];
  for (const current of gates) {
    process.stdout.write(`[M13 gate] ${current.name}\n`);
    const gateEnvironment = current.name === "settings-chromium-writer"
      ? { ...environment, M13_EVIDENCE_SOURCE_REVISION: evidence.sourceRevision }
      : environment;
    const execution = await runGate(current, {
      root,
      environment: gateEnvironment,
      timeoutMs,
      terminationGraceMs,
    });
    const processPassed = execution.exitCode === 0 && !execution.signal && !execution.timedOut && !execution.spawnError;
    let summary = null;
    let summaryError = null;
    try {
      summary = summarize(current.summaryKind, execution.stdout, execution.stderr);
    } catch (error) {
      summaryError = error.message;
    }
    const expectedSummaryError = summary && current.expectedSummary
      && (summary.passed !== current.expectedSummary.passed
        || summary.skipped !== current.expectedSummary.skipped)
      ? `expected ${current.expectedSummary.passed} passed and ${current.expectedSummary.skipped} skipped; found ${summary.passed} passed and ${summary.skipped} skipped`
      : null;
    const record = {
      name: current.name,
      command: [current.file, ...current.args].join(" "),
      status: processPassed && !summaryError && !expectedSummaryError && summary?.failed === 0
        ? "passed"
        : "failed",
      durationMs: execution.durationMs,
      exitCode: execution.exitCode,
      signal: execution.signal,
      timedOut: execution.timedOut,
      spawnError: execution.spawnError,
      summary,
      summaryError: summaryError ?? expectedSummaryError,
    };
    if (record.status !== "passed") {
      writeFileSync(failureReceiptPath, `${JSON.stringify({ sourceHead, vendorRevision, failed: record, results }, null, 2)}\n`);
      throw new Error(`M13 gate failed: ${current.name}`);
    }
    results.push(record);
  }

  validateProductionBundleIdentity(root, evidence.identity.productionBundleTreeSha256);
  const finalHead = command(root, "git", ["rev-parse", "HEAD"]);
  const finalStatus = worktreeStatus(root, controllerOutputs);
  if (finalHead !== sourceHead) throw new Error(`M13 source HEAD changed during verification: ${sourceHead} -> ${finalHead}`);
  if (finalStatus) throw new Error(`verify:m13 requires a clean source worktree after verification:\n${finalStatus}`);
  execFileSync("git", ["diff", "--exit-code", "--", "vendor/bitwarden-clients"], { cwd: root });

  const runtimeResult = buildRuntimeResult(evidence, results);
  const artifact = {
    sourceHead,
    vendorRevision,
    evidence,
    results,
    runtimeResult: { sha256: sha256Bytes(runtimeResult) },
    aggregate: { gates: results.length, passed: results.length, failed: 0, screenshots: evidence.authorities.length },
  };
  publishArtifacts([
    { path: runtimeResultPath, contents: runtimeResult },
    { path: artifactPath, contents: `${JSON.stringify(artifact, null, 2)}\n` },
  ]);
  return artifact;
}

function validateEvidence(root, sourceHead, vendorRevision) {
  const directory = join(root, evidencePath);
  const actual = readdirSync(directory).sort();
  const expected = [...screenshotFiles, "provenance.json"].sort();
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    throw new Error("M13 evidence inventory differs from nine authorities plus provenance");
  }
  const provenance = parseJson(readFileSync(join(directory, "provenance.json"), "utf8"), "M13 provenance");
  if (provenance.schema !== "m13-settings-evidence-v2") throw new Error("M13 provenance schema is invalid");
  const recordedSource = requireHash(provenance.sourceRevision, 40, "source revision");
  const recordedVendor = requireHash(provenance.vendorRevision, 40, "vendor revision");
  const identity = provenance.identity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw new Error("M13 provenance runtime identity is missing");
  }
  const productionBundleTreeSha256 = requireHash(identity.productionBundleTreeSha256, 64, "production bundle tree SHA-256");
  const packageLockSha256 = requireHash(identity.packageLockSha256, 64, "package lock SHA-256");
  const runtimeIdentitySha256 = requireHash(identity.runtimeIdentitySha256, 64, "runtime identity SHA-256");
  if (recordedVendor !== vendorRevision) throw new Error("M13 provenance vendor revision is stale");
  if (provenance.writer?.project !== "chromium") throw new Error("M13 provenance writer project must be chromium");
  if (provenance.writer?.viewport?.width !== 480
    || provenance.writer?.viewport?.height !== 600
    || provenance.writer?.deviceScaleFactor !== 1) {
    throw new Error("M13 provenance writer dimensions and DPR are invalid");
  }
  try {
    execFileSync("git", ["cat-file", "-e", `${recordedSource}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    throw new Error(`M13 provenance source revision is not a commit: ${recordedSource}`);
  }
  const relevantDiff = execFileSync("git", ["diff", "--name-only", `${recordedSource}..${sourceHead}`, "--", "apps/menubar-tauri", "scripts", "package.json", "package-lock.json", "playwright.config.ts", "vitest.config.ts", "tsconfig.json", "postcss.config.cjs", "tailwind.config.cjs", "vendor/bitwarden-clients"], { cwd: root, encoding: "utf8" }).trim();
  if (relevantDiff) throw new Error(`M13 provenance source revision is stale:\n${relevantDiff}`);
  if (sha256File(join(root, "package-lock.json")) !== packageLockSha256) {
    throw new Error("M13 provenance package lock identity is stale");
  }
  const identityWithoutDigest = {
    productionBundleTreeSha256,
    packageLockSha256,
    playwrightVersion: requireString(identity.playwrightVersion, "Playwright version"),
    nodeVersion: requireString(identity.nodeVersion, "Node version"),
    platform: requireString(identity.platform, "platform"),
    architecture: requireString(identity.architecture, "architecture"),
    authorityBrowserName: requireString(identity.authorityBrowserName, "authority browser name"),
    authorityBrowserVersion: requireString(identity.authorityBrowserVersion, "authority browser version"),
    authorityBrowserExecutableSha256: requireHash(identity.authorityBrowserExecutableSha256, 64, "authority browser executable SHA-256"),
    authorityBrowserRuntimeTreeSha256: requireHash(identity.authorityBrowserRuntimeTreeSha256, 64, "authority browser runtime tree SHA-256"),
  };
  if (identityWithoutDigest.authorityBrowserName !== "Chromium"
    || sha256Bytes(JSON.stringify(identityWithoutDigest)) !== runtimeIdentitySha256) {
    throw new Error("M13 provenance runtime identity SHA-256 is invalid");
  }

  if (!Array.isArray(provenance.authorities)
    || provenance.authorities.length !== screenshotFiles.length
    || new Set(provenance.authorities.map(({ file }) => file)).size !== screenshotFiles.length) {
    throw new Error("M13 provenance authority rows must be one-to-one");
  }
  const authorityByName = new Map(provenance.authorities.map((authority) => [authority.file, authority]));
  const historicalAttestationCache = new Map();
  const authorities = screenshotFiles.map((file) => {
    const bytes = readFileSync(join(directory, file));
    const dimensions = pngDimensions(bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const recorded = authorityByName.get(file);
    if (!recorded || recorded.sha256 !== hash) throw new Error(`M13 authority hash mismatch: ${file}`);
    if (dimensions !== "480x600" || recorded.width !== 480 || recorded.height !== 600) {
      throw new Error(`M13 authority dimensions must be 480x600: ${file}`);
    }
    if (recorded.opaque !== true || recorded.mostlyBlank !== false || recorded.horizontallyClipped !== false) {
      throw new Error(`M13 authority integrity flags are invalid: ${file}`);
    }
    const canonicalIdentity = {
      sourceRevision: requireHash(recorded.canonicalSourceRevision, 40, `historical authority source revision for ${file}`),
      runtimeIdentitySha256: requireHash(recorded.canonicalRuntimeIdentitySha256, 64, `historical authority runtime identity for ${file}`),
      attestationRevision: requireHash(recorded.canonicalAttestationRevision, 40, `historical authority attestation revision for ${file}`),
    };
    validateHistoricalAuthorityAttestation(
      root,
      file,
      hash,
      canonicalIdentity,
      historicalAttestationCache,
    );
    return { file, sha256: hash, dimensions, canonicalIdentity };
  });
  const evidenceSetSha256 = sha256Bytes(JSON.stringify({
    schema: evidenceSetSchema,
    sourceRevision: recordedSource,
    runtimeIdentitySha256,
    authorities: authorities
      .map(({ file, sha256, canonicalIdentity }) => ({
        fileName: file,
        sha256,
        canonicalSourceRevision: canonicalIdentity.sourceRevision,
        canonicalRuntimeIdentitySha256: canonicalIdentity.runtimeIdentitySha256,
        canonicalAttestationRevision: canonicalIdentity.attestationRevision,
      }))
      .sort((left, right) => left.fileName.localeCompare(right.fileName)),
  }));
  if (provenance.evidenceSetSha256 !== evidenceSetSha256) {
    throw new Error("M13 provenance evidence set SHA-256 is invalid");
  }
  return {
    sourceRevision: recordedSource,
    vendorRevision: recordedVendor,
    identity: { ...identityWithoutDigest, runtimeIdentitySha256 },
    evidenceSetSha256,
    authorities,
  };
}

function validateHistoricalAuthorityAttestation(
  root,
  file,
  expectedSha256,
  canonicalIdentity,
  attestationCache,
) {
  const relativeDirectory = evidencePath;
  let historicalBytes;
  let historicalProvenance = attestationCache.get(canonicalIdentity.attestationRevision);
  if (!historicalProvenance) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", canonicalIdentity.attestationRevision, "HEAD"], {
        cwd: root,
        stdio: "ignore",
      });
      historicalProvenance = parseJson(execFileSync("git", [
        "show",
        `${canonicalIdentity.attestationRevision}:${relativeDirectory}/provenance.json`,
      ], { cwd: root, encoding: "utf8" }), "historical M13 provenance");
      attestationCache.set(canonicalIdentity.attestationRevision, historicalProvenance);
    } catch {
      throw new Error(`M13 historical authority attestation content is unavailable: ${file}`);
    }
  }
  try {
    historicalBytes = execFileSync("git", [
      "show",
      `${canonicalIdentity.attestationRevision}:${relativeDirectory}/${file}`,
    ], { cwd: root });
  } catch {
    throw new Error(`M13 historical authority attestation content is unavailable: ${file}`);
  }
  if (sha256Bytes(historicalBytes) !== expectedSha256) {
    throw new Error(`M13 historical authority attestation bytes are invalid: ${file}`);
  }
  if (!Array.isArray(historicalProvenance.authorities)) {
    throw new Error(`M13 historical authority attestation provenance is invalid: ${file}`);
  }
  const historicalRow = historicalProvenance.authorities.find((authority) => authority.file === file);
  if (!historicalRow || historicalRow.sha256 !== expectedSha256) {
    throw new Error(`M13 historical authority attestation row is invalid: ${file}`);
  }
  const historicalSourceRevision = historicalProvenance.schema === "m13-settings-evidence-v1"
    ? historicalProvenance.sourceRevision
    : historicalProvenance.schema === "m13-settings-evidence-v2"
      ? historicalRow.canonicalSourceRevision
      : null;
  const historicalRuntimeIdentitySha256 = historicalProvenance.schema === "m13-settings-evidence-v1"
    ? historicalProvenance.identity?.runtimeIdentitySha256
    : historicalProvenance.schema === "m13-settings-evidence-v2"
      ? historicalRow.canonicalRuntimeIdentitySha256
      : null;
  if (historicalSourceRevision !== canonicalIdentity.sourceRevision) {
    throw new Error(`M13 historical authority source identity is invalid: ${file}`);
  }
  if (historicalRuntimeIdentitySha256 !== canonicalIdentity.runtimeIdentitySha256) {
    throw new Error(`M13 historical authority runtime identity is invalid: ${file}`);
  }
}

function validateProductionBundleIdentity(root, expectedHash) {
  const actualHash = sha256DirectoryTree(join(root, "apps/menubar-tauri/dist"));
  if (actualHash !== expectedHash) {
    throw new Error(`M13 production bundle identity mismatch: expected ${expectedHash}; found ${actualHash}`);
  }
}

function pngDimensions(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Invalid PNG authority");
  }
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

function parseJson(source, label) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

function requireHash(value, length, label) {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`).test(value)) {
    throw new Error(`M13 provenance ${label} is invalid`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`M13 provenance ${label} is invalid`);
  }
  return value;
}

function assertNoLiveCredentialFields(environment) {
  const fields = Object.entries(environment).filter(([name, value]) =>
    /^(?:BW|BITWARDEN|M13)_.*(?:PASSWORD|TOKEN|SECRET|KEY|CREDENTIAL)/i.test(name) && String(value ?? "").length > 0,
  );
  if (fields.length) throw new Error(`verify:m13 rejects non-empty live credential fields: ${fields.map(([name]) => name).join(", ")}`);
}

function command(root, file, args) {
  return execFileSync(file, args, { cwd: root, encoding: "utf8" }).trim();
}

function worktreeStatus(root, controllerOutputs) {
  const args = ["status", "--porcelain", "--untracked-files=all"];
  const exclusions = controllerOutputs.flatMap((path) => {
    const relativePath = relative(root, path);
    const isInsideRoot = relativePath
      && relativePath !== ".."
      && !relativePath.startsWith(`..${sep}`)
      && !isAbsolute(relativePath);
    return isInsideRoot ? [`:(exclude,top)${relativePath.split(sep).join("/")}`] : [];
  });
  if (exclusions.length) {
    args.push("--", ".", ...exclusions);
  }
  return command(root, "git", args);
}

export function publishArtifacts(artifacts, fileSystem = {}) {
  const rename = fileSystem.renameSync ?? renameSync;
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
      throw new AggregateError([publicationError, ...rollbackErrors], "M13 controller output publication and rollback failed");
    }
    throw publicationError;
  } finally {
    for (const artifact of staged) {
      rmSync(artifact.temporaryPath, { force: true });
      rmSync(`${artifact.temporaryPath}.rollback`, { force: true });
    }
  }
}

function buildRuntimeResult(evidence, results) {
  const browserRows = results
    .filter((result) => browserGateNames.has(result.name))
    .map((result) => `| ${result.name} | ${result.summary.passed} | ${result.summary.skipped} |`)
    .join("\n");
  const authorityRows = evidence.authorities
    .map(({ file, sha256, dimensions, canonicalIdentity }) =>
      `| ${file} | ${sha256} | ${dimensions} | ${canonicalIdentity.sourceRevision} | ${canonicalIdentity.runtimeIdentitySha256} | ${canonicalIdentity.attestationRevision} |`)
    .join("\n");
  return `# M13 Settings Runtime Result\n\n- Milestone state: implementation_complete / release_partial.\n- Remaining parity gaps: M15 built-app native proof; M16 release-candidate comparison.\n- Next global milestone: M14 live service convergence.\n- Evidence source revision: ${evidence.sourceRevision}\n- Vendor revision: ${evidence.vendorRevision}\n- Production bundle tree SHA-256: ${evidence.identity.productionBundleTreeSha256}\n- Package lock SHA-256: ${evidence.identity.packageLockSha256}\n- Runtime identity SHA-256: ${evidence.identity.runtimeIdentitySha256}\n- Evidence set SHA-256: ${evidence.evidenceSetSha256}\n- Evidence schema: authority-level canonical source/runtime identity with historical attestation validation.\n- Controller gates: ${results.length} passed; 0 failed.\n- Credentialed external requests: none; evidence is deterministic and local.\n\n| Browser gate | Passed | Skipped |\n| --- | ---: | ---: |\n${browserRows}\n\n| Authority | SHA-256 | Dimensions | Canonical source | Canonical runtime | Attestation |\n| --- | --- | --- | --- | --- | --- |\n${authorityRows}\n`;
}

function sha256File(path) {
  return sha256Bytes(readFileSync(path));
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256DirectoryTree(directory) {
  const root = resolve(directory);
  const files = collectRegularFiles(root, root).sort();
  if (!files.length) throw new Error(`M13 production bundle tree is empty: ${directory}`);
  const hash = createHash("sha256");
  for (const file of files) {
    const relativePath = relative(root, file).split(sep).join("/");
    const contents = readFileSync(file);
    hash.update(`${Buffer.byteLength(relativePath)}:${relativePath}\0${contents.byteLength}:`);
    hash.update(contents);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function collectRegularFiles(root, directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const status = lstatSync(path);
    if (status.isSymbolicLink()) throw new Error(`M13 production bundle contains a symbolic link: ${relative(root, path)}`);
    if (status.isDirectory()) files.push(...collectRegularFiles(root, path));
    else if (status.isFile()) files.push(path);
    else throw new Error(`M13 production bundle contains an unsupported entry: ${relative(root, path)}`);
  }
  return files;
}

function runGate(current, { root, environment, timeoutMs, terminationGraceMs }) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let child;
    let settled = false;
    let timedOut = false;
    let timer;
    let forceKillTimer;
    let groupCleanupTimer;
    let groupCleanupPending = false;
    let leaderCloseResult = null;
    let processGroupId = null;
    let terminationError = null;
    const finish = (exitCode, signal, spawnError = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceKillTimer);
      clearTimeout(groupCleanupTimer);
      resolveRun({
        exitCode,
        signal,
        spawnError: spawnError ?? terminationError,
        timedOut,
        stdout: stdout.slice(-32768),
        stderr: stderr.slice(-32768),
        durationMs: Date.now() - started,
      });
    };
    try {
      child = spawn(current.file, current.args, {
        cwd: root,
        env: { ...environment, ...current.env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      if (process.platform !== "win32") processGroupId = child.pid;
    } catch (error) {
      finish(null, null, error.message);
      return;
    }
    child.stdout.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    child.once("error", (error) => finish(null, null, error.message));
    child.once("close", (code, signal) => {
      if (timedOut && groupCleanupPending) {
        leaderCloseResult = { exitCode: code, signal };
        return;
      }
      finish(code, signal);
    });
    timer = setTimeout(() => {
      timedOut = true;
      groupCleanupPending = true;
      terminationError = terminateGateProcess(child, "SIGTERM", processGroupId);
      forceKillTimer = setTimeout(() => {
        const forceKillError = terminateGateProcess(child, "SIGKILL", processGroupId);
        terminationError ??= forceKillError;
        const cleanupDeadline = Date.now() + terminationGraceMs * 2;
        const completeGroupCleanup = () => {
          const groupStatus = inspectGateProcessGroup(processGroupId);
          terminationError ??= groupStatus.error;
          if (groupStatus.alive && Date.now() < cleanupDeadline) {
            terminationError ??= terminateGateProcess(child, "SIGKILL", processGroupId);
            groupCleanupTimer = setTimeout(completeGroupCleanup, 10);
            return;
          }
          if (groupStatus.alive) {
            terminationError ??= `Timed-out gate process group ${processGroupId} remained after SIGKILL`;
          }
          groupCleanupPending = false;
          if (leaderCloseResult) finish(leaderCloseResult.exitCode, leaderCloseResult.signal);
        };
        if (process.platform === "win32") {
          groupCleanupPending = false;
          if (leaderCloseResult) finish(leaderCloseResult.exitCode, leaderCloseResult.signal);
        } else {
          completeGroupCleanup();
        }
      }, terminationGraceMs);
    }, timeoutMs);
  });
}

function terminateGateProcess(child, signal, processGroupId = child.pid) {
  try {
    if (process.platform !== "win32" && processGroupId) {
      process.kill(-processGroupId, signal);
    } else {
      child.kill(signal);
    }
    return null;
  } catch (error) {
    if (error?.code === "ESRCH") return null;
    return `Could not terminate timed-out gate with ${signal}: ${error.message}`;
  }
}

function inspectGateProcessGroup(processGroupId) {
  if (process.platform === "win32" || !processGroupId) return { alive: false, error: null };
  try {
    process.kill(-processGroupId, 0);
    return { alive: true, error: null };
  } catch (error) {
    if (error?.code === "ESRCH") return { alive: false, error: null };
    return {
      alive: false,
      error: `Could not inspect timed-out gate process group: ${error.message}`,
    };
  }
}

function summarize(kind, stdout, stderr) {
  const output = `${stdout}\n${stderr}`.replace(/\u001b\[[0-9;]*m/g, "");
  if (kind === "status") return { passed: 1, failed: 0 };
  if (kind === "node-test") {
    const passedMatch = [...output.matchAll(/^\s*(?:ℹ\s+)?pass\s+(\d+)\s*$/gm)].at(-1);
    const failedMatch = [...output.matchAll(/^\s*(?:ℹ\s+)?fail\s+(\d+)\s*$/gm)].at(-1);
    const skippedMatch = [...output.matchAll(/^\s*(?:ℹ\s+)?skipped\s+(\d+)\s*$/gm)].at(-1);
    if (!passedMatch || !failedMatch || !skippedMatch) {
      throw new Error("Could not parse node-test summary");
    }
    return {
      passed: Number(passedMatch[1]),
      failed: Number(failedMatch[1]),
      skipped: Number(skippedMatch[1]),
    };
  }
  const passedMatch = [...output.matchAll(/(\d+) passed/g)].at(-1);
  const failedMatch = [...output.matchAll(/(\d+) failed/g)].at(-1);
  const skippedMatch = [...output.matchAll(kind === "cargo" ? /(\d+) ignored/g : /(\d+) skipped/g)].at(-1);
  if (!passedMatch && !failedMatch) throw new Error(`Could not parse ${kind} summary`);
  const summary = {
    passed: Number(passedMatch?.[1] ?? 0),
    failed: Number(failedMatch?.[1] ?? 0),
  };
  if (kind === "playwright" || kind === "vitest" || kind === "cargo") {
    summary.skipped = Number(skippedMatch?.[1] ?? 0);
  }
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runVerification();
}
