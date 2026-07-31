#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const expectedVendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const dirtyStatePolicy = "clean before and after (machine artifact excluded)";
const defaultTimeoutMs = 30 * 60 * 1000;
const defaultTailBytes = 32 * 1024;

function gate(name, file, args, summaryKind, env = {}) {
  return {
    name,
    file,
    args,
    summaryKind,
    env: { ...env, UPDATE_EVIDENCE: "false" },
  };
}

const browserEnvironment = { VITE_BW_VAULT_EVIDENCE: "true" };

export const defaultGates = [
  gate("vitest", "npm", ["test"], "vitest"),
  gate("generator-chromium", "npx", [
    "playwright", "test", "apps/menubar-tauri/e2e/official-generator-workflows.spec.ts",
    "--project=chromium", "--workers=1", "--reporter=line",
  ], "playwright", browserEnvironment),
  gate("generator-webkit", "npx", [
    "playwright", "test", "apps/menubar-tauri/e2e/official-generator-workflows.spec.ts",
    "--project=webkit", "--workers=1", "--reporter=line",
  ], "playwright", browserEnvironment),
  gate("playwright-full", "npx", ["playwright", "test", "--workers=1", "--reporter=line"], "playwright"),
  ...["official-components", "official-login", "official-personal", "official-recovery", "official-generator"]
    .map((name) => gate(`typecheck-${name}`, "npm", ["run", `typecheck:${name}`], "status")),
  gate("web-production-build", "npm", ["run", "build:web"], "status"),
  gate("production-bundle-audit-fixtures", "npm", ["run", "test:audit-production-bundle"], "status"),
  gate("production-bundle-audit", "npm", ["run", "audit:production-bundle"], "status"),
  gate("rust-tests", "cargo", ["test", "--manifest-path", "apps/menubar-tauri/src-tauri/Cargo.toml"], "cargo"),
  gate("rust-build", "cargo", ["build", "--manifest-path", "apps/menubar-tauri/src-tauri/Cargo.toml"], "status"),
  gate("diff-check", "git", ["diff", "--check"], "status"),
  gate("vendor-unchanged", "git", ["diff", "--exit-code", "--", "vendor/bitwarden-clients"], "status"),
];

export async function runVerification(options = {}) {
  const root = resolve(options.root ?? repositoryRoot);
  const gates = options.gates ?? defaultGates;
  const environment = options.environment ?? process.env;
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const tailBytes = options.tailBytes ?? defaultTailBytes;
  const requiredVendorRevision = options.expectedVendorRevision ?? expectedVendorRevision;
  const failureReceiptPath = resolve(options.failureReceiptPath ?? "/tmp/m11-verification-failure.json");
  const artifactPath = resolve(options.artifactPath ?? join(
    root,
    "docs/superpowers/specs/2026-07-19-m11-machine-verification.json",
  ));
  const evidenceDirectory = options.evidenceDirectory ?? "docs/superpowers/screenshots/m11-generator-2026-07-19";
  const reportPath = options.reportPath ?? "docs/superpowers/specs/2026-07-19-m11-generator-runtime-result.md";

  rmSync(failureReceiptPath, { force: true });
  if (environment.UPDATE_EVIDENCE === "true") {
    throw new Error("UPDATE_EVIDENCE=true is not allowed during M11 machine verification");
  }

  const sourceHead = commandOutput(root, "git", ["rev-parse", "HEAD"]);
  const vendorRevision = readFileSync(
    join(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"),
    "utf8",
  ).trim();
  const dirtyBefore = commandOutput(root, "git", ["status", "--porcelain"]);
  if (dirtyBefore) {
    throw new Error(`verify:m11 requires a clean source worktree:\n${dirtyBefore}`);
  }
  if (vendorRevision !== requiredVendorRevision) {
    throw new Error(
      `M11 vendor revision must be ${requiredVendorRevision}; found ${vendorRevision}`,
    );
  }

  const results = [];
  for (const current of gates) {
    process.stdout.write(`[M11 gate] ${current.name}\n`);
    const execution = await runGate(current, {
      environment,
      root,
      tailBytes,
      timeoutMs,
    });
    const record = {
      name: current.name,
      command: commandText(current),
      environment: { ...current.env, UPDATE_EVIDENCE: "false" },
      exitCode: execution.exitCode,
      signal: execution.signal,
      timedOut: execution.timedOut,
      spawnError: execution.spawnError,
      durationMs: execution.durationMs,
    };

    if (execution.spawnError || execution.timedOut || execution.signal || execution.exitCode !== 0) {
      const summary = failureSummary(execution);
      writeFailureReceipt(failureReceiptPath, {
        ...record,
        sourceHead,
        vendorRevision,
        dirtyStatePolicy,
        summary,
        results,
      });
      throw new Error(failureMessage(record));
    }

    try {
      record.summary = parseSummary(current.summaryKind, execution.stdoutTail, execution.stderrTail);
    } catch (error) {
      const summary = failureSummary(execution);
      writeFailureReceipt(failureReceiptPath, {
        ...record,
        sourceHead,
        vendorRevision,
        dirtyStatePolicy,
        summary,
        summaryError: error.message,
        results,
      });
      throw new Error(`Could not parse ${current.summaryKind} summary for ${current.name}: ${error.message}`);
    }
    results.push(record);
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }

  const finalStatus = commandOutput(root, "git", ["status", "--porcelain"]);
  const finalHead = commandOutput(root, "git", ["rev-parse", "HEAD"]);
  const finalVendorRevision = readFileSync(
    join(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"),
    "utf8",
  ).trim();
  const integrityFailures = [];
  if (finalStatus) {
    integrityFailures.push(`verify:m11 requires a clean source worktree after verification:\n${finalStatus}`);
  }
  if (finalHead !== sourceHead) {
    integrityFailures.push(`source HEAD changed during verification: ${sourceHead} -> ${finalHead}`);
  }
  if (finalVendorRevision !== vendorRevision) {
    integrityFailures.push(
      `vendor revision changed during verification: ${vendorRevision} -> ${finalVendorRevision}`,
    );
  }
  if (integrityFailures.length > 0) {
    const message = integrityFailures.join("\n");
    writeFailureReceipt(failureReceiptPath, {
      command: null,
      dirtyStatePolicy,
      durationMs: 0,
      exitCode: null,
      signal: null,
      timedOut: false,
      spawnError: null,
      sourceHead,
      vendorRevision,
      summary: { message, stdoutTail: "", stderrTail: "" },
      results,
    });
    throw new Error(message);
  }

  const evidenceFiles = readdirSync(join(root, evidenceDirectory))
    .sort()
    .map((file) => join(evidenceDirectory, file));
  const artifactFiles = [...evidenceFiles, reportPath];
  const artifact = {
    sourceHead,
    vendorRevision,
    dirtyStatePolicy,
    results,
    hashes: Object.fromEntries(artifactFiles.map((file) => [
      file,
      createHash("sha256").update(readFileSync(join(root, file))).digest("hex"),
    ])),
  };
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`[M11 artifact] ${artifactPath}\n`);
  return artifact;
}

function runGate(current, { environment, root, tailBytes, timeoutMs }) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    const stdout = new TailBuffer(tailBytes);
    const stderr = new TailBuffer(tailBytes);
    let child;
    let settled = false;
    let timedOut = false;
    let timeout;
    let forceKillTimeout;

    const finish = (exitCode, signal, spawnError = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(forceKillTimeout);
      resolveRun({
        durationMs: Date.now() - started,
        exitCode,
        signal,
        timedOut,
        spawnError,
        stdoutTail: stdout.text(),
        stderrTail: stderr.text(),
      });
    };

    try {
      child = spawn(current.file, current.args, {
        cwd: root,
        env: { ...environment, ...current.env, UPDATE_EVIDENCE: "false" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish(null, null, serializeSpawnError(error));
      return;
    }

    child.stdout.on("data", (chunk) => stdout.append(chunk));
    child.stderr.on("data", (chunk) => stderr.append(chunk));
    child.once("error", (error) => finish(null, null, serializeSpawnError(error)));
    child.once("close", (exitCode, signal) => finish(exitCode, signal));
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), 1000);
    }, timeoutMs);
  });
}

class TailBuffer {
  constructor(limit) {
    this.limit = limit;
    this.buffer = Buffer.alloc(0);
  }

  append(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (bytes.length >= this.limit) {
      this.buffer = bytes.subarray(bytes.length - this.limit);
      return;
    }
    const overflow = this.buffer.length + bytes.length - this.limit;
    const retained = overflow > 0 ? this.buffer.subarray(overflow) : this.buffer;
    this.buffer = Buffer.concat([retained, bytes], retained.length + bytes.length);
  }

  text() {
    return this.buffer.toString("utf8");
  }
}

function parseSummary(kind, stdout, stderr) {
  const output = stripAnsi(`${stdout}\n${stderr}`);
  if (kind === "status") {
    return { kind: "status", passed: 1, failed: 0, total: 1 };
  }
  if (kind === "vitest") return parseVitestSummary(output);
  if (kind === "playwright") return parsePlaywrightSummary(output);
  if (kind === "cargo") return parseCargoSummary(output);
  throw new Error(`unknown summary kind: ${kind}`);
}

function parseVitestSummary(output) {
  const testFilesLine = [...output.matchAll(/^\s*Test Files\s{2,}(.+)$/gm)].at(-1)?.[1];
  const testsLine = [...output.matchAll(/^\s*Tests\s{2,}(.+)$/gm)].at(-1)?.[1];
  if (!testFilesLine || !testsLine) throw new Error("Vitest count lines were not found");
  return {
    kind: "vitest",
    testFiles: parseCountLine(testFilesLine),
    tests: parseCountLine(testsLine),
  };
}

function parseCountLine(line) {
  const counts = { passed: 0, failed: 0, skipped: 0 };
  for (const match of line.matchAll(/(\d+)\s+(passed|failed|skipped)\b/g)) {
    counts[match[2]] = Number(match[1]);
  }
  const totalMatch = line.match(/\((\d+)\)\s*$/);
  if (!totalMatch) throw new Error(`total count was not found in: ${line}`);
  return { ...counts, total: Number(totalMatch[1]) };
}

function parsePlaywrightSummary(output) {
  const counts = {
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    interrupted: 0,
    didNotRun: 0,
  };
  const countPattern = /^\s*(\d+)\s+(passed|failed|skipped|flaky|interrupted|did not run)\b/;
  const lines = output.split("\n");
  const finalCountIndex = lines.findLastIndex((line) => countPattern.test(line));
  if (finalCountIndex < 0) throw new Error("Playwright count lines were not found");
  const summaryLines = [];
  for (let index = finalCountIndex; index >= 0; index -= 1) {
    if (!countPattern.test(lines[index])) break;
    summaryLines.unshift(lines[index]);
  }
  for (const line of summaryLines) {
    const match = line.match(countPattern);
    const key = match[2] === "did not run" ? "didNotRun" : match[2];
    counts[key] = Number(match[1]);
  }
  return {
    kind: "playwright",
    ...counts,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
  };
}

function parseCargoSummary(output) {
  const totals = {
    passed: 0,
    failed: 0,
    ignored: 0,
    measured: 0,
    filteredOut: 0,
    suites: 0,
  };
  const pattern = /test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;/g;
  for (const match of output.matchAll(pattern)) {
    totals.passed += Number(match[1]);
    totals.failed += Number(match[2]);
    totals.ignored += Number(match[3]);
    totals.measured += Number(match[4]);
    totals.filteredOut += Number(match[5]);
    totals.suites += 1;
  }
  if (totals.suites === 0) throw new Error("Cargo test result lines were not found");
  return {
    kind: "cargo",
    passed: totals.passed,
    failed: totals.failed,
    ignored: totals.ignored,
    measured: totals.measured,
    filteredOut: totals.filteredOut,
    total: totals.passed + totals.failed + totals.ignored + totals.measured,
    suites: totals.suites,
  };
}

function failureSummary(execution) {
  return {
    stdoutTail: stripAnsi(execution.stdoutTail),
    stderrTail: stripAnsi(execution.stderrTail),
  };
}

function writeFailureReceipt(path, receipt) {
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
}

function failureMessage(record) {
  if (record.spawnError) {
    return `${record.name} spawn failed (${record.spawnError.code ?? "unknown"}): ${record.spawnError.message}`;
  }
  if (record.timedOut) return `${record.name} timed out after ${record.durationMs}ms`;
  if (record.signal) return `${record.name} failed with signal ${record.signal}`;
  return `${record.name} failed with exit code ${record.exitCode}`;
}

function serializeSpawnError(error) {
  return {
    code: error.code ?? null,
    message: error.message,
  };
}

function commandText(current) {
  const environment = Object.entries({ ...current.env, UPDATE_EVIDENCE: "false" })
    .map(([key, value]) => `${key}=${value}`);
  return [...environment, current.file, ...current.args].join(" ");
}

function commandOutput(root, file, args) {
  return execFileSync(file, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}

function stripAnsi(value) {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runVerification().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
