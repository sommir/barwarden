#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const expectedVendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const defaultTimeoutMs = 30 * 60 * 1000;
const finalArtifact = "docs/superpowers/specs/2026-07-19-m12-machine-verification.json";
const evidencePath = "docs/superpowers/screenshots/m12-text-send-2026-07-19";
const runtimePath = "docs/superpowers/specs/2026-07-19-m12-text-send-runtime-result.md";
const screenshotFiles = [
  "send-list-populated-480x600.png",
  "send-list-loading-480x600.png",
  "send-list-empty-480x600.png",
  "send-list-no-results-480x600.png",
  "send-list-disabled-480x600.png",
  "send-view-480x600.png",
  "send-form-add-480x600.png",
  "send-form-edit-480x600.png",
  "send-created-480x600.png",
  "send-mutation-error-480x600.png",
  "send-row-actions-480x600.png",
];

function gate(name, file, args, env = {}, summaryKind = "status", expectedSummary) {
  return { name, file, args, env: { UPDATE_EVIDENCE: "false", ...env }, summaryKind, expectedSummary };
}

const browserEnvironment = { VITE_BW_VAULT_EVIDENCE: "true" };

export const defaultGates = [
  gate("source-precondition", "git", ["diff", "--check"]),
  gate("pinned-vendor", "npm", ["run", "check:official-send:upstream"]),
  gate("send-overlay-guards", "npm", ["test", "--", "--run", "apps/menubar-tauri/src/app/upstream-overlays/send/send-overlay.guard.spec.ts"]),
  gate("text-send-focused", "npm", ["test", "--", "--run", "apps/menubar-tauri/src/app/send", "apps/menubar-tauri/src/app/popup-parity-manifest.spec.ts"]),
  gate("vitest-full", "npm", ["test"], {}, "vitest"),
  gate("official-typechecks", "npm", ["run", "typecheck:m12"]),
  gate("web-production-build", "npm", ["run", "build:web"]),
  gate("production-bundle-audit-fixtures", "npm", ["run", "test:audit-production-bundle"]),
  gate("production-bundle-audit", "npm", ["run", "audit:production-bundle"]),
  gate("send-chromium-writer", "npx", ["playwright", "test", "apps/menubar-tauri/e2e/official-send-workflows.spec.ts", "--project=chromium", "--workers=1", "--reporter=line"], { ...browserEnvironment, UPDATE_EVIDENCE: "true" }, "playwright", { passed: 5, skipped: 0 }),
  gate("send-chromium-read-only", "npx", ["playwright", "test", "apps/menubar-tauri/e2e/official-send-workflows.spec.ts", "--project=chromium", "--workers=1", "--reporter=line"], browserEnvironment, "playwright", { passed: 4, skipped: 1 }),
  gate("send-webkit-read-only", "npx", ["playwright", "test", "apps/menubar-tauri/e2e/official-send-workflows.spec.ts", "--project=webkit", "--workers=1", "--reporter=line"], browserEnvironment, "playwright", { passed: 4, skipped: 1 }),
  gate("playwright-full", "npx", ["playwright", "test", "--workers=1", "--reporter=line"], {}, "playwright", { passed: 416, skipped: 14 }),
  gate("rust-tests", "cargo", ["test", "--manifest-path", "apps/menubar-tauri/src-tauri/Cargo.toml"], {}, "cargo"),
  gate("rust-build", "cargo", ["build", "--manifest-path", "apps/menubar-tauri/src-tauri/Cargo.toml"]),
  gate("final-integrity", "git", ["diff", "--check"]),
];

export async function runVerification(options = {}) {
  const root = resolve(options.root ?? repositoryRoot);
  const environment = options.environment ?? process.env;
  const artifactPath = resolve(options.artifactPath ?? join(root, finalArtifact));
  const runtimeResultPath = resolve(options.runtimePath ?? join(root, runtimePath));
  const controllerOutputs = [artifactPath, runtimeResultPath];
  const failureReceiptPath = resolve(options.failureReceiptPath ?? "/tmp/m12-verification-failure.json");
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const gates = options.gates ?? defaultGates;
  rmSync(failureReceiptPath, { force: true });

  assertNoLiveCredentialFields(environment);
  if (environment.UPDATE_EVIDENCE === "true") {
    throw new Error("verify:m12 owns evidence mode; inherited UPDATE_EVIDENCE=true is forbidden");
  }

  const sourceHead = command(root, "git", ["rev-parse", "HEAD"]);
  if (options.expectedSourceHead && sourceHead !== options.expectedSourceHead) {
    throw new Error(`M12 source HEAD mismatch: expected ${options.expectedSourceHead}; found ${sourceHead}`);
  }
  const dirtyBefore = worktreeStatus(root, controllerOutputs);
  if (dirtyBefore) throw new Error(`verify:m12 requires a clean source worktree:\n${dirtyBefore}`);

  const vendorRevision = readFileSync(join(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"), "utf8").trim();
  if (vendorRevision !== expectedVendorRevision) {
    throw new Error(`M12 vendor revision must be ${expectedVendorRevision}; found ${vendorRevision}`);
  }
  const evidence = validateEvidence(root, sourceHead, vendorRevision);

  const results = [];
  for (const current of gates) {
    process.stdout.write(`[M12 gate] ${current.name}\n`);
    const gateEnvironment = current.name === "send-chromium-writer"
      ? { ...environment, M12_EVIDENCE_SOURCE_REVISION: evidence.sourceRevision }
      : environment;
    const execution = await runGate(current, { root, environment: gateEnvironment, timeoutMs });
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
      throw new Error(`M12 gate failed: ${current.name}`);
    }
    results.push(record);
  }

  validateProductionBundleIdentity(root, evidence.identity.productionBundleTreeSha256);
  const finalHead = command(root, "git", ["rev-parse", "HEAD"]);
  const finalStatus = worktreeStatus(root, controllerOutputs);
  if (finalHead !== sourceHead) throw new Error(`M12 source HEAD changed during verification: ${sourceHead} -> ${finalHead}`);
  if (finalStatus) throw new Error(`verify:m12 requires a clean source worktree after verification:\n${finalStatus}`);
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
  const actual = readdirSync(directory).filter((file) => file.endsWith(".png")).sort();
  const expected = [...screenshotFiles].sort();
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) {
    throw new Error("M12 evidence inventory differs from the exact eleven-authority set");
  }
  const provenance = readFileSync(join(directory, "PROVENANCE.md"), "utf8");
  const recordedSource = single(provenance, /^- Source revision: ([0-9a-f]{40})$/gm, "source revision");
  const recordedVendor = single(provenance, /^- Vendor revision: ([0-9a-f]{40})$/gm, "vendor revision");
  const productionBundleTreeSha256 = single(provenance, /^- Production bundle tree SHA-256: ([0-9a-f]{64})$/gm, "production bundle tree SHA-256");
  const packageLockSha256 = single(provenance, /^- Package lock SHA-256: ([0-9a-f]{64})$/gm, "package lock SHA-256");
  const playwrightVersion = single(provenance, /^- Playwright version: ([^\s]+)$/gm, "Playwright version");
  const hostRuntime = single(provenance, /^- Host runtime: node ([^;\s]+); ([a-z0-9]+)-([a-z0-9_]+)$/gm, "host runtime", 3);
  const authorityBrowser = single(provenance, /^- Authority browser: Chromium ([^;\s]+); executable SHA-256: ([0-9a-f]{64})$/gm, "authority browser", 2);
  const authorityBrowserRuntimeTreeSha256 = single(provenance, /^- Chromium runtime tree SHA-256: ([0-9a-f]{64})$/gm, "Chromium runtime tree SHA-256");
  const runtimeIdentitySha256 = single(provenance, /^- Runtime identity SHA-256: ([0-9a-f]{64})$/gm, "runtime identity SHA-256");
  if (recordedVendor !== vendorRevision) throw new Error("M12 provenance vendor revision is stale");
  try {
    execFileSync("git", ["cat-file", "-e", `${recordedSource}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    throw new Error(`M12 provenance source revision is not a commit: ${recordedSource}`);
  }
  const relevantDiff = execFileSync("git", ["diff", "--name-only", `${recordedSource}..${sourceHead}`, "--", "apps/menubar-tauri", "scripts", "package.json", "package-lock.json", "playwright.config.ts", "tsconfig.json", "postcss.config.cjs", "tailwind.config.cjs", "vendor/bitwarden-clients"], { cwd: root, encoding: "utf8" }).trim();
  if (relevantDiff) throw new Error(`M12 provenance source revision is stale:\n${relevantDiff}`);
  if (sha256File(join(root, "package-lock.json")) !== packageLockSha256) {
    throw new Error("M12 provenance package lock identity is stale");
  }
  const identity = {
    productionBundleTreeSha256,
    packageLockSha256,
    playwrightVersion,
    nodeVersion: hostRuntime[0],
    platform: hostRuntime[1],
    architecture: hostRuntime[2],
    authorityBrowserName: "Chromium",
    authorityBrowserVersion: authorityBrowser[0],
    authorityBrowserExecutableSha256: authorityBrowser[1],
    authorityBrowserRuntimeTreeSha256,
  };
  if (sha256Bytes(JSON.stringify(identity)) !== runtimeIdentitySha256) {
    throw new Error("M12 provenance runtime identity SHA-256 is invalid");
  }

  const rows = [...provenance.matchAll(/^\| (send-[^|]+\.png) \| ([0-9a-f]{64}) \| (\d+x\d+) \| passed \|$/gm)];
  if (rows.length !== screenshotFiles.length || new Set(rows.map((row) => row[1])).size !== screenshotFiles.length) {
    throw new Error("M12 provenance authority rows must be one-to-one");
  }
  const authorityByName = new Map(rows.map((row) => [row[1], { hash: row[2], dimensions: row[3] }]));
  const authorities = screenshotFiles.map((file) => {
    const bytes = readFileSync(join(directory, file));
    const dimensions = pngDimensions(bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const recorded = authorityByName.get(file);
    if (!recorded || recorded.hash !== hash) throw new Error(`M12 authority hash mismatch: ${file}`);
    if (dimensions !== "480x600" || recorded.dimensions !== dimensions) {
      throw new Error(`M12 authority dimensions must be 480x600: ${file}`);
    }
    return { file, sha256: hash, dimensions };
  });
  return { sourceRevision: recordedSource, vendorRevision: recordedVendor, identity: { ...identity, runtimeIdentitySha256 }, authorities };
}

function validateProductionBundleIdentity(root, expectedHash) {
  const actualHash = sha256DirectoryTree(join(root, "apps/menubar-tauri/dist"));
  if (actualHash !== expectedHash) {
    throw new Error(`M12 production bundle identity mismatch: expected ${expectedHash}; found ${actualHash}`);
  }
}

function pngDimensions(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Invalid PNG authority");
  }
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

function single(source, pattern, label, groups = 1) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`M12 provenance requires exactly one ${label}`);
  return groups === 1 ? matches[0][1] : matches[0].slice(1, groups + 1);
}

function assertNoLiveCredentialFields(environment) {
  const fields = Object.entries(environment).filter(([name, value]) =>
    /^(?:BW|BITWARDEN|M12)_.*(?:PASSWORD|TOKEN|SECRET|KEY|CREDENTIAL)/i.test(name) && String(value ?? "").length > 0,
  );
  if (fields.length) throw new Error(`verify:m12 rejects non-empty live credential fields: ${fields.map(([name]) => name).join(", ")}`);
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

function publishArtifacts(artifacts) {
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
      renameSync(artifact.temporaryPath, artifact.path);
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
          renameSync(rollbackPath, artifact.path);
        }
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError([publicationError, ...rollbackErrors], "M12 controller output publication and rollback failed");
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
    .filter((result) => Number.isInteger(result.summary?.skipped))
    .map((result) => `| ${result.name} | ${result.summary.passed} | ${result.summary.skipped} |`)
    .join("\n");
  return `# M12 Text Send Runtime Result\n\n- Evidence source revision: ${evidence.sourceRevision}\n- Vendor revision: ${evidence.vendorRevision}\n- Production bundle tree SHA-256: ${evidence.identity.productionBundleTreeSha256}\n- Package lock SHA-256: ${evidence.identity.packageLockSha256}\n- Runtime identity SHA-256: ${evidence.identity.runtimeIdentitySha256}\n- Controller gates: ${results.length} passed; 0 failed.\n\n| Browser gate | Passed | Skipped |\n| --- | ---: | ---: |\n${browserRows}\n`;
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
  if (!files.length) throw new Error(`M12 production bundle tree is empty: ${directory}`);
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
    if (status.isSymbolicLink()) throw new Error(`M12 production bundle contains a symbolic link: ${relative(root, path)}`);
    if (status.isDirectory()) files.push(...collectRegularFiles(root, path));
    else if (status.isFile()) files.push(path);
    else throw new Error(`M12 production bundle contains an unsupported entry: ${relative(root, path)}`);
  }
  return files;
}

function runGate(current, { root, environment, timeoutMs }) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    let child;
    let settled = false;
    let timedOut = false;
    let timer;
    const finish = (exitCode, signal, spawnError = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({ exitCode, signal, spawnError, timedOut, stdout: stdout.slice(-32768), stderr: stderr.slice(-32768), durationMs: Date.now() - started });
    };
    try {
      child = spawn(current.file, current.args, { cwd: root, env: { ...environment, ...current.env }, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      finish(null, null, error.message);
      return;
    }
    child.stdout.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    child.once("error", (error) => finish(null, null, error.message));
    child.once("close", (code, signal) => finish(code, signal));
    timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
  });
}

function summarize(kind, stdout, stderr) {
  const output = `${stdout}\n${stderr}`.replace(/\u001b\[[0-9;]*m/g, "");
  if (kind === "status") return { passed: 1, failed: 0 };
  const passedMatch = [...output.matchAll(/(\d+) passed/g)].at(-1);
  const failedMatch = [...output.matchAll(/(\d+) failed/g)].at(-1);
  const skippedMatch = [...output.matchAll(/(\d+) skipped/g)].at(-1);
  if (!passedMatch && !failedMatch) throw new Error(`Could not parse ${kind} summary`);
  const summary = {
    passed: Number(passedMatch?.[1] ?? 0),
    failed: Number(failedMatch?.[1] ?? 0),
  };
  if (kind === "playwright") summary.skipped = Number(skippedMatch?.[1] ?? 0);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runVerification();
}
