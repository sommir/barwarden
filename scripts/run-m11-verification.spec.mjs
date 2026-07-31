import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const verifierUrl = new URL("./run-m11-verification.mjs", import.meta.url).href;
const verifier = await import(verifierUrl);
const { defaultGates, runVerification } = verifier;
const vendorRevision = "f47b6946e01aed474875789081966d311d5b8289";

test("M11 verifier can be imported without running gates", () => {
  const isolatedDirectory = mkdtempSync(join(tmpdir(), "m11-verifier-import-"));
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `const module = await import(${JSON.stringify(verifierUrl)});\n` +
      `if (typeof module.runVerification !== "function") process.exit(2);`,
  ], {
    cwd: isolatedDirectory,
    encoding: "utf8",
    timeout: 5_000,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("default gates retain the plan order and force read-only evidence mode", () => {
  assert.deepEqual(defaultGates.map(({ name }) => name), [
    "vitest",
    "generator-chromium",
    "generator-webkit",
    "playwright-full",
    "typecheck-official-components",
    "typecheck-official-login",
    "typecheck-official-personal",
    "typecheck-official-recovery",
    "typecheck-official-generator",
    "web-production-build",
    "production-bundle-audit-fixtures",
    "production-bundle-audit",
    "rust-tests",
    "rust-build",
    "diff-check",
    "vendor-unchanged",
  ]);
  assert.ok(defaultGates.every(({ env }) => env.UPDATE_EVIDENCE === "false"));
});

test("streams large output, records exact summaries in order, and hashes artifacts", async (t) => {
  const fixture = createRepository(t);
  writeFileSync(fixture.failureReceiptPath, "stale receipt\n");
  const largeOutput = `
    import { appendFileSync } from "node:fs";
    import { once } from "node:events";
    const chunk = "x".repeat(1024 * 1024);
    for (let index = 0; index < 64; index += 1) {
      if (!process.stdout.write(chunk)) await once(process.stdout, "drain");
      if (!process.stderr.write(chunk)) await once(process.stderr, "drain");
    }
    appendFileSync(${JSON.stringify(fixture.orderPath)}, "vitest\\n");
    process.stdout.write("\\n Test Files  1 failed (1)\\n      Tests  1 failed (1)\\nnot the final summary\\n");
    process.stdout.write("\\n Test Files  118 passed (118)\\n      Tests  2304 passed | 7 skipped (2311)\\n");
  `;
  const playwrightOutput = `
    import { appendFileSync, writeFileSync } from "node:fs";
    appendFileSync(${JSON.stringify(fixture.orderPath)}, "playwright\\n");
    writeFileSync(${JSON.stringify(fixture.environmentPath)}, process.env.UPDATE_EVIDENCE ?? "missing");
    process.stdout.write("1 failed\\nthis earlier output is not the final summary\\n");
    process.stdout.write("  3 skipped\\n  394 passed (10.2s)\\n");
  `;
  const cargoOutput = `
    import { appendFileSync } from "node:fs";
    appendFileSync(${JSON.stringify(fixture.orderPath)}, "cargo\\n");
    process.stdout.write("test result: ok. 33 passed; 0 failed; 1 ignored; 0 measured; 2 filtered out; finished in 0.1s\\n");
    process.stdout.write("test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.1s\\n");
  `;

  const artifact = await runVerification({
    ...fixture.options,
    environment: { ...process.env, UPDATE_EVIDENCE: "inherited-value" },
    gates: [
      nodeGate("vitest", largeOutput, "vitest"),
      nodeGate("playwright", playwrightOutput, "playwright"),
      nodeGate("cargo", cargoOutput, "cargo"),
    ],
  });

  assert.equal(existsSync(fixture.failureReceiptPath), false);
  assert.equal(readFileSync(fixture.orderPath, "utf8"), "vitest\nplaywright\ncargo\n");
  assert.equal(readFileSync(fixture.environmentPath, "utf8"), "false");
  assert.deepEqual(artifact.results.map(({ name }) => name), ["vitest", "playwright", "cargo"]);
  assert.deepEqual(artifact.results[0].summary, {
    kind: "vitest",
    testFiles: { passed: 118, failed: 0, skipped: 0, total: 118 },
    tests: { passed: 2304, failed: 0, skipped: 7, total: 2311 },
  });
  assert.deepEqual(artifact.results[1].summary, {
    kind: "playwright",
    passed: 394,
    failed: 0,
    skipped: 3,
    flaky: 0,
    interrupted: 0,
    didNotRun: 0,
    total: 397,
  });
  assert.deepEqual(artifact.results[2].summary, {
    kind: "cargo",
    passed: 37,
    failed: 0,
    ignored: 1,
    measured: 0,
    filteredOut: 2,
    total: 38,
    suites: 2,
  });
  assert.equal(artifact.sourceHead, git(fixture.root, "rev-parse", "HEAD"));
  assert.equal(artifact.vendorRevision, vendorRevision);
  assert.deepEqual(artifact.hashes, Object.fromEntries(fixture.artifactFiles.map((relativePath) => [
    relativePath,
    sha256(join(fixture.root, relativePath)),
  ])));
  assert.deepEqual(JSON.parse(readFileSync(fixture.artifactPath, "utf8")), artifact);
});

test("writes bounded stdout and stderr failure context and stops at the first failure", async (t) => {
  const fixture = createRepository(t);
  const skippedMarker = join(fixture.support, "must-not-run");
  const noisyFailure = `
    import { once } from "node:events";
    const stdoutChunk = "stdout-noise-".repeat(8192);
    const stderrChunk = "stderr-noise-".repeat(8192);
    for (let index = 0; index < 32; index += 1) {
      if (!process.stdout.write(stdoutChunk)) await once(process.stdout, "drain");
      if (!process.stderr.write(stderrChunk)) await once(process.stderr, "drain");
    }
    process.stdout.write("STDOUT_FAILURE_SENTINEL\\n");
    process.stderr.write("STDERR_FAILURE_SENTINEL\\n");
    process.exitCode = 7;
  `;

  await assert.rejects(runVerification({
    ...fixture.options,
    tailBytes: 4096,
    gates: [
      nodeGate("success", 'process.stdout.write("ok\\n")', "status"),
      nodeGate("failure", noisyFailure, "status"),
      nodeGate("skipped", `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(skippedMarker)}, "ran")`, "status"),
    ],
  }), /failure.*exit code 7/i);

  assert.equal(existsSync(skippedMarker), false);
  const receipt = JSON.parse(readFileSync(fixture.failureReceiptPath, "utf8"));
  assert.equal(receipt.sourceHead, git(fixture.root, "rev-parse", "HEAD"));
  assert.deepEqual(receipt.results.map(({ name }) => name), ["success"]);
  assert.equal(receipt.exitCode, 7);
  assert.equal(receipt.signal, null);
  assert.equal(receipt.timedOut, false);
  assert.equal(receipt.spawnError, null);
  assert.match(receipt.summary.stdoutTail, /STDOUT_FAILURE_SENTINEL/);
  assert.match(receipt.summary.stderrTail, /STDERR_FAILURE_SENTINEL/);
  assert.ok(Buffer.byteLength(receipt.summary.stdoutTail) <= 4096);
  assert.ok(Buffer.byteLength(receipt.summary.stderrTail) <= 4096);
});

test("records timeout separately from exit and signal failures", async (t) => {
  const fixture = createRepository(t);
  await assert.rejects(runVerification({
    ...fixture.options,
    timeoutMs: 100,
    gates: [nodeGate("timeout", `
      process.stdout.write("timeout stdout\\n");
      process.stderr.write("timeout stderr\\n");
      setInterval(() => {}, 1000);
    `, "status")],
  }), /timed out/i);

  const receipt = JSON.parse(readFileSync(fixture.failureReceiptPath, "utf8"));
  assert.equal(receipt.exitCode, null);
  assert.equal(receipt.signal, "SIGTERM");
  assert.equal(receipt.timedOut, true);
  assert.equal(receipt.spawnError, null);
  assert.match(receipt.summary.stdoutTail, /timeout stdout/);
  assert.match(receipt.summary.stderrTail, /timeout stderr/);
});

test("records a child signal without labeling it a timeout", async (t) => {
  const fixture = createRepository(t);
  await assert.rejects(runVerification({
    ...fixture.options,
    gates: [nodeGate("signal", 'process.kill(process.pid, "SIGTERM")', "status")],
  }), /signal SIGTERM/i);

  const receipt = JSON.parse(readFileSync(fixture.failureReceiptPath, "utf8"));
  assert.equal(receipt.exitCode, null);
  assert.equal(receipt.signal, "SIGTERM");
  assert.equal(receipt.timedOut, false);
  assert.equal(receipt.spawnError, null);
});

test("records spawn errors without inventing an exit code", async (t) => {
  const fixture = createRepository(t);
  await assert.rejects(runVerification({
    ...fixture.options,
    gates: [{
      name: "spawn-error",
      file: join(fixture.support, "does-not-exist"),
      args: [],
      env: {},
      summaryKind: "status",
    }],
  }), /spawn.*ENOENT/i);

  const receipt = JSON.parse(readFileSync(fixture.failureReceiptPath, "utf8"));
  assert.equal(receipt.exitCode, null);
  assert.equal(receipt.signal, null);
  assert.equal(receipt.timedOut, false);
  assert.equal(receipt.spawnError.code, "ENOENT");
});

test("deletes a stale receipt and rejects UPDATE_EVIDENCE writer mode before gates", async (t) => {
  const fixture = createRepository(t);
  const marker = join(fixture.support, "writer-gate-ran");
  writeFileSync(fixture.failureReceiptPath, "stale\n");

  await assert.rejects(runVerification({
    ...fixture.options,
    environment: { ...process.env, UPDATE_EVIDENCE: "true" },
    gates: [nodeGate("must-not-run", `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran")`, "status")],
  }), /UPDATE_EVIDENCE=true.*not allowed/i);

  assert.equal(existsSync(fixture.failureReceiptPath), false);
  assert.equal(existsSync(marker), false);
});

test("requires a clean worktree before and after the ordered gates", async (t) => {
  const before = createRepository(t);
  writeFileSync(join(before.root, "dirty-before.txt"), "dirty\n");
  await assert.rejects(runVerification(before.options), /clean source worktree/i);

  const after = createRepository(t);
  await assert.rejects(runVerification({
    ...after.options,
    gates: [nodeGate("dirty-after", 'import { writeFileSync } from "node:fs"; writeFileSync("dirty-after.txt", "dirty\\n")', "status")],
  }), /clean source worktree after verification/i);
  const receipt = JSON.parse(readFileSync(after.failureReceiptPath, "utf8"));
  assert.deepEqual(receipt.results.map(({ name }) => name), ["dirty-after"]);
});

test("pins source HEAD and vendor revision before gates and rechecks them afterward", async (t) => {
  const wrongVendor = createRepository(t);
  writeFileSync(join(wrongVendor.root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"), "wrong-revision\n");
  git(wrongVendor.root, "add", ".");
  git(wrongVendor.root, "commit", "-m", "wrong vendor pin");
  await assert.rejects(runVerification(wrongVendor.options), /vendor revision.*wrong-revision/i);

  const changedHead = createRepository(t);
  await assert.rejects(runVerification({
    ...changedHead.options,
    gates: [{
      name: "move-head",
      file: "git",
      args: ["commit", "--allow-empty", "-m", "move head"],
      env: {},
      summaryKind: "status",
    }],
  }), /source HEAD changed during verification/i);
  const receipt = JSON.parse(readFileSync(changedHead.failureReceiptPath, "utf8"));
  assert.equal(receipt.sourceHead === git(changedHead.root, "rev-parse", "HEAD"), false);
  assert.deepEqual(receipt.results.map(({ name }) => name), ["move-head"]);
});

test("refuses to record a successful test gate without parseable exact counts", async (t) => {
  const fixture = createRepository(t);
  await assert.rejects(runVerification({
    ...fixture.options,
    gates: [nodeGate("unparseable", 'process.stdout.write("arbitrary successful tail\\n")', "playwright")],
  }), /parse.*playwright.*summary/i);
  assert.equal(existsSync(fixture.artifactPath), false);
});

function nodeGate(name, source, summaryKind) {
  return {
    name,
    file: process.execPath,
    args: ["--input-type=module", "--eval", source],
    env: {},
    summaryKind,
  };
}

function createRepository(t) {
  const support = mkdtempSync(join(tmpdir(), "m11-verifier-"));
  const root = join(support, "repository");
  const evidenceDirectory = "evidence";
  const reportPath = "runtime-result.md";
  const artifactPath = join(root, "machine-verification.json");
  const failureReceiptPath = join(support, "failure.json");
  const orderPath = join(support, "order.txt");
  const environmentPath = join(support, "environment.txt");
  mkdirSync(join(root, "vendor/bitwarden-clients"), { recursive: true });
  mkdirSync(join(root, evidenceDirectory), { recursive: true });
  writeFileSync(join(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"), `${vendorRevision}\n`);
  writeFileSync(join(root, evidenceDirectory, "a.txt"), "alpha\n");
  writeFileSync(join(root, evidenceDirectory, "b.txt"), "beta\n");
  writeFileSync(join(root, reportPath), "runtime report\n");
  git(root, "init", "-q");
  git(root, "config", "user.name", "M11 Verifier Test");
  git(root, "config", "user.email", "m11-verifier@example.test");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  t.after(() => rmSync(support, { recursive: true, force: true }));

  const artifactFiles = [
    `${evidenceDirectory}/a.txt`,
    `${evidenceDirectory}/b.txt`,
    reportPath,
  ];
  return {
    artifactFiles,
    artifactPath,
    environmentPath,
    failureReceiptPath,
    options: {
      artifactPath,
      evidenceDirectory,
      expectedVendorRevision: vendorRevision,
      failureReceiptPath,
      gates: [],
      reportPath,
      root,
    },
    orderPath,
    root,
    support,
  };
}

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
