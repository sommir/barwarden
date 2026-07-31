import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const verifier = await import(new URL("./run-m12-verification.mjs", import.meta.url));
const { defaultGates, runVerification } = verifier;
const vendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
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
const playwrightContracts = [
  { name: "send-chromium-writer", expectedSummary: { passed: 5, skipped: 0 } },
  { name: "send-chromium-read-only", expectedSummary: { passed: 4, skipped: 1 } },
  { name: "send-webkit-read-only", expectedSummary: { passed: 4, skipped: 1 } },
  { name: "playwright-full", expectedSummary: { passed: 416, skipped: 14 } },
];

test("default gates retain the ordered sixteen-stage M12 plan", () => {
  assert.deepEqual(defaultGates.map(({ name }) => name), [
    "source-precondition",
    "pinned-vendor",
    "send-overlay-guards",
    "text-send-focused",
    "vitest-full",
    "official-typechecks",
    "web-production-build",
    "production-bundle-audit-fixtures",
    "production-bundle-audit",
    "send-chromium-writer",
    "send-chromium-read-only",
    "send-webkit-read-only",
    "playwright-full",
    "rust-tests",
    "rust-build",
    "final-integrity",
  ]);
  assert.equal(defaultGates[9].env.UPDATE_EVIDENCE, "true");
  assert.ok(defaultGates.slice(10).every(({ env }) => env.UPDATE_EVIDENCE === "false"));
  assert.deepEqual(
    defaultGates.slice(9, 13).map(({ name, expectedSummary }) => ({ name, expectedSummary })),
    playwrightContracts,
  );
});

test("preserves both modified tracked controller outputs when a precondition fails", async (t) => {
  const fixture = createRepository(t);
  trackMachineArtifact(fixture, "previous successful report\n");
  writeFileSync(fixture.artifactPath, "locally retained report\n");
  writeFileSync(fixture.runtimePath, "locally retained runtime\n");
  writeFileSync(join(fixture.root, "dirty.txt"), "dirty\n");

  await assert.rejects(runVerification(fixture.options), /clean source worktree/i);

  assert.equal(readFileSync(fixture.artifactPath, "utf8"), "locally retained report\n");
  assert.equal(readFileSync(fixture.runtimePath, "utf8"), "locally retained runtime\n");
});

test("replaces stale controller outputs from actual results only after all sixteen gates pass", async (t) => {
  const fixture = createRepository(t);
  trackMachineArtifact(fixture, "previous successful report\n");
  writeFileSync(fixture.artifactPath, "stale local report\n");
  writeFileSync(fixture.runtimePath, "stale runtime preclaim: WebKit passed\n");

  const artifact = await runVerification({
    ...fixture.options,
    gates: passingControllerGates(),
  });

  assert.equal(JSON.parse(readFileSync(fixture.artifactPath, "utf8")).sourceHead, artifact.sourceHead);
  assert.equal(artifact.aggregate.gates, 16);
  const runtime = readFileSync(fixture.runtimePath, "utf8");
  assert.doesNotMatch(runtime, /stale runtime preclaim/);
  assert.match(runtime, new RegExp(`Evidence source revision: ${fixture.evidenceSourceHead}`));
  assert.match(runtime, new RegExp(`Vendor revision: ${vendorRevision}`));
  assert.match(runtime, new RegExp(`Production bundle tree SHA-256: ${fixture.productionBundleHash}`));
  assert.match(runtime, new RegExp(`Package lock SHA-256: ${fixture.packageLockHash}`));
  assert.match(runtime, new RegExp(`Runtime identity SHA-256: ${fixture.runtimeIdentityHash}`));
  assert.match(runtime, /\| send-chromium-writer \| 5 \| 0 \|/);
  assert.match(runtime, /\| send-chromium-read-only \| 4 \| 1 \|/);
  assert.match(runtime, /\| send-webkit-read-only \| 4 \| 1 \|/);
  assert.match(runtime, /\| playwright-full \| 416 \| 14 \|/);
});

for (const [name, mutate, pattern] of [
  ["wrong source HEAD", (fixture) => fixture.options.expectedSourceHead = "0".repeat(40), /source HEAD/i],
  ["wrong vendor commit", (fixture) => {
    writeFileSync(join(fixture.root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"), "deadbeef\n");
    commitMutation(fixture);
  }, /vendor revision/i],
  ["missing screenshot", (fixture) => {
    rmSync(join(fixture.evidenceDirectory, screenshotFiles[0]));
    commitMutation(fixture);
  }, /inventory/i],
  ["wrong authority hash", (fixture) => {
    writeFileSync(join(fixture.evidenceDirectory, screenshotFiles[0]), png(480, 600, 2));
    commitMutation(fixture);
  }, /hash/i],
  ["dirty writer tree", (fixture) => writeFileSync(join(fixture.root, "dirty.txt"), "dirty\n"), /clean source worktree/i],
  ["stale provenance", (fixture) => {
    replace(fixture.provenancePath, fixture.evidenceSourceHead, "1".repeat(40));
    commitMutation(fixture);
  }, /source revision/i],
  ["non-empty live credential field", (fixture) => fixture.options.environment = { ...process.env, BW_TEST_PASSWORD: "not-allowed" }, /credential/i],
]) {
  test(`fails closed for ${name}`, async (t) => {
    const fixture = createRepository(t);
    mutate(fixture);
    await assert.rejects(runVerification(fixture.options), pattern);
    assert.equal(exists(fixture.artifactPath), false);
  });
}

for (const path of [
  "package-lock.json",
  "tsconfig.json",
  "postcss.config.cjs",
  "tailwind.config.cjs",
  "vendor/bitwarden-clients/source.ts",
]) {
  test(`rejects evidence provenance made stale by ${path}`, async (t) => {
    const fixture = createRepository(t);
    writeFileSync(join(fixture.root, path), `changed ${path}\n`);
    commitMutation(fixture);

    await assert.rejects(
      runVerification({ ...fixture.options, gates: [] }),
      /provenance source revision is stale/i,
    );
  });
}

test("preserves both tracked controller outputs when a gate fails", async (t) => {
  const fixture = createRepository(t);
  trackMachineArtifact(fixture, "prior machine report\n");
  writeFileSync(fixture.runtimePath, "prior runtime result\n");

  await assert.rejects(
    runVerification({ ...fixture.options, gates: [nodeGate("failing-gate", "process.exit(7)")] }),
    /failing-gate/,
  );

  assert.equal(readFileSync(fixture.artifactPath, "utf8"), "prior machine report\n");
  assert.equal(readFileSync(fixture.runtimePath, "utf8"), "prior runtime result\n");
});

test("rolls back both tracked controller outputs when publication cannot stage runtime", async (t) => {
  const fixture = createRepository(t);
  trackMachineArtifact(fixture, "prior machine report\n");
  const priorRuntime = readFileSync(fixture.runtimePath, "utf8");
  const runtimeDirectory = join(fixture.runtimePath, "..");
  chmodSync(runtimeDirectory, 0o555);

  try {
    await assert.rejects(
      runVerification({ ...fixture.options, gates: [nodeGate("fixture-pass", 'process.stdout.write("ok\\n")')] }),
    );
  } finally {
    chmodSync(runtimeDirectory, 0o755);
  }

  assert.equal(readFileSync(fixture.artifactPath, "utf8"), "prior machine report\n");
  assert.equal(readFileSync(fixture.runtimePath, "utf8"), priorRuntime);
});

for (const gateName of ["production-bundle-audit", "rust-tests"]) {
  test(`fails closed when ${gateName} fails`, async (t) => {
    const fixture = createRepository(t);
    const gates = [nodeGate(gateName, "process.exit(7)")];
    await assert.rejects(runVerification({ ...fixture.options, gates }), new RegExp(gateName));
    assert.equal(exists(fixture.artifactPath), false);
  });
}

for (const summaryKind of ["playwright", "vitest", "cargo"]) {
  for (const failure of ["nonzero", "timeout", "signal", "spawn error", "unparsable output"]) {
    test(`writes a failure receipt for ${summaryKind} ${failure} without replacing the machine artifact`, async (t) => {
      const fixture = createRepository(t);
      trackMachineArtifact(fixture, "previous successful report\n");
      const retained = "retained after gate failure\n";
      const retainedRuntime = "retained runtime after gate failure\n";
      writeFileSync(fixture.artifactPath, retained);
      writeFileSync(fixture.runtimePath, retainedRuntime);
      const gate = failingSummaryGate(summaryKind, failure);

      await assert.rejects(
        runVerification({ ...fixture.options, gates: [gate], timeoutMs: 25 }),
        new RegExp(gate.name),
      );

      assert.equal(readFileSync(fixture.artifactPath, "utf8"), retained);
      assert.equal(readFileSync(fixture.runtimePath, "utf8"), retainedRuntime);
      const receipt = JSON.parse(readFileSync(fixture.failureReceiptPath, "utf8"));
      assert.equal(receipt.failed.name, gate.name);
      assert.equal(receipt.failed.status, "failed");
    });
  }
}

test("accepts only the exact expected Playwright passed and skipped counts", async (t) => {
  const fixture = createRepository(t);
  const gates = playwrightContracts.map((current) => nodeGate(
    current.name,
    `process.stdout.write(${JSON.stringify(`${current.expectedSummary.passed} passed\n${current.expectedSummary.skipped} skipped\n`)})`,
    "playwright",
    current.expectedSummary,
  ));

  const artifact = await runVerification({ ...fixture.options, gates });

  assert.deepEqual(artifact.results.map(({ summary }) => summary), [
    { passed: 5, failed: 0, skipped: 0 },
    { passed: 4, failed: 0, skipped: 1 },
    { passed: 4, failed: 0, skipped: 1 },
    { passed: 416, failed: 0, skipped: 14 },
  ]);
});

for (const current of playwrightContracts) {
  test(`rejects unexpected Playwright skips for ${current.name}`, async (t) => {
    const fixture = createRepository(t);
    const unexpectedSkipped = current.expectedSummary.skipped + 1;
    const gate = nodeGate(
      current.name,
      `process.stdout.write(${JSON.stringify(`${current.expectedSummary.passed} passed\n${unexpectedSkipped} skipped\n`)})`,
      "playwright",
      current.expectedSummary,
    );

    await assert.rejects(runVerification({ ...fixture.options, gates: [gate] }), new RegExp(current.name));
    const receipt = JSON.parse(readFileSync(fixture.failureReceiptPath, "utf8"));
    assert.deepEqual(receipt.failed.summary, { passed: current.expectedSummary.passed, failed: 0, skipped: unexpectedSkipped });
  });
}

test("records exact authority hashes and aggregate counts only after all gates pass", async (t) => {
  const fixture = createRepository(t);
  const artifact = await runVerification({
    ...fixture.options,
    gates: [nodeGate("fixture-pass", 'process.stdout.write("ok\\n")')],
  });
  assert.equal(artifact.sourceHead, fixture.head);
  assert.equal(artifact.vendorRevision, vendorRevision);
  assert.equal(artifact.evidence.authorities.length, 11);
  assert.deepEqual(artifact.aggregate, { gates: 1, passed: 1, failed: 0, screenshots: 11 });
  assert.equal(JSON.parse(readFileSync(fixture.artifactPath, "utf8")).sourceHead, fixture.head);
});

test("passes the validated evidence source revision to the Chromium writer", async (t) => {
  const fixture = createRepository(t);
  const assertion = `
    if (process.env.M12_EVIDENCE_SOURCE_REVISION !== ${JSON.stringify("EXPECTED_SOURCE_REVISION")}) {
      process.exit(7);
    }
  `.replace("EXPECTED_SOURCE_REVISION", fixture.evidenceSourceHead);

  const artifact = await runVerification({
    ...fixture.options,
    gates: [nodeGate("send-chromium-writer", assertion)],
  });

  assert.equal(artifact.results[0].status, "passed");
});

function createRepository(t) {
  const root = mkdtempSync(join(tmpdir(), "m12-verifier-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "m12-verifier@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "M12 Verifier"], { cwd: root });
  mkdirSync(join(root, "vendor/bitwarden-clients"), { recursive: true });
  writeFileSync(join(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"), `${vendorRevision}\n`);
  writeFileSync(join(root, "vendor/bitwarden-clients/source.ts"), "vendor source\n");
  writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  writeFileSync(join(root, "tsconfig.json"), '{}\n');
  writeFileSync(join(root, "postcss.config.cjs"), "module.exports = {};\n");
  writeFileSync(join(root, "tailwind.config.cjs"), "module.exports = {};\n");
  const productionDirectory = join(root, "apps/menubar-tauri/dist");
  mkdirSync(productionDirectory, { recursive: true });
  writeFileSync(join(productionDirectory, "index.html"), "production bundle\n");
  const evidenceDirectory = join(root, "docs/superpowers/screenshots/m12-text-send-2026-07-19");
  mkdirSync(evidenceDirectory, { recursive: true });
  for (let index = 0; index < screenshotFiles.length; index += 1) {
    writeFileSync(join(evidenceDirectory, screenshotFiles[index]), png(480, 600, index + 1));
  }
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "source fixture"], { cwd: root });
  const evidenceSourceHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const provenancePath = join(evidenceDirectory, "PROVENANCE.md");
  const productionBundleHash = treeSha(productionDirectory, [["index.html", "production bundle\n"]]);
  const packageLockHash = sha(join(root, "package-lock.json"));
  const runtimeIdentity = {
    productionBundleTreeSha256: productionBundleHash,
    packageLockSha256: packageLockHash,
    playwrightVersion: "1.54.2",
    nodeVersion: "v24.13.0",
    platform: "darwin",
    architecture: "arm64",
    authorityBrowserName: "Chromium",
    authorityBrowserVersion: "139.0.7258.5",
    authorityBrowserExecutableSha256: "4".repeat(64),
    authorityBrowserRuntimeTreeSha256: "5".repeat(64),
  };
  const runtimeIdentityHash = createHash("sha256").update(JSON.stringify(runtimeIdentity)).digest("hex");
  const rows = screenshotFiles.map((file) =>
    `| ${file} | ${sha(join(evidenceDirectory, file))} | 480x600 | passed |`,
  ).join("\n");
  writeFileSync(provenancePath, `- Source revision: ${evidenceSourceHead}\n- Vendor revision: ${vendorRevision}\n- Production bundle tree SHA-256: ${productionBundleHash}\n- Package lock SHA-256: ${packageLockHash}\n- Playwright version: ${runtimeIdentity.playwrightVersion}\n- Host runtime: node ${runtimeIdentity.nodeVersion}; ${runtimeIdentity.platform}-${runtimeIdentity.architecture}\n- Authority browser: Chromium ${runtimeIdentity.authorityBrowserVersion}; executable SHA-256: ${runtimeIdentity.authorityBrowserExecutableSha256}\n- Chromium runtime tree SHA-256: ${runtimeIdentity.authorityBrowserRuntimeTreeSha256}\n- Runtime identity SHA-256: ${runtimeIdentityHash}\n\n| Authority | SHA-256 | Dimensions | Geometry |\n| --- | --- | --- | --- |\n${rows}\n`);
  const runtimePath = join(root, "docs/superpowers/specs/2026-07-19-m12-text-send-runtime-result.md");
  mkdirSync(join(root, "docs/superpowers/specs"), { recursive: true });
  writeFileSync(runtimePath, `- Source revision: ${evidenceSourceHead}\n- Vendor revision: ${vendorRevision}\n\n| Browser | Result |\n| --- | --- |\n| Chromium writer | passed |\n| Chromium read-only | passed |\n| WebKit | passed |\n`);
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "evidence"], { cwd: root });
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const artifactPath = join(root, "machine.json");
  const failureReceiptPath = join(root, "failure.json");
  return {
    root, head, evidenceSourceHead, evidenceDirectory, provenancePath, runtimePath, artifactPath, failureReceiptPath,
    productionBundleHash, packageLockHash, runtimeIdentityHash,
    options: { root, artifactPath, runtimePath, failureReceiptPath, environment: process.env, expectedSourceHead: head },
  };
}

function trackMachineArtifact(fixture, contents) {
  writeFileSync(fixture.artifactPath, contents);
  execFileSync("git", ["add", "machine.json"], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "track machine artifact"], { cwd: fixture.root });
  fixture.head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
  fixture.options.expectedSourceHead = fixture.head;
}

function commitMutation(fixture) {
  execFileSync("git", ["add", "-A"], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "mutation"], { cwd: fixture.root });
  fixture.head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fixture.root,
    encoding: "utf8",
  }).trim();
  fixture.options.expectedSourceHead = fixture.head;
}

function nodeGate(name, source, summaryKind = "status", expectedSummary) {
  return { name, file: process.execPath, args: ["--input-type=module", "--eval", source], env: { UPDATE_EVIDENCE: "false" }, summaryKind, expectedSummary };
}

function passingControllerGates() {
  return defaultGates.map((current) => {
    if (current.summaryKind === "playwright") {
      return nodeGate(
        current.name,
        `process.stdout.write(${JSON.stringify(`${current.expectedSummary.passed} passed\n${current.expectedSummary.skipped} skipped\n`)})`,
        current.summaryKind,
        current.expectedSummary,
      );
    }
    if (current.summaryKind === "vitest" || current.summaryKind === "cargo") {
      return nodeGate(current.name, 'process.stdout.write("1 passed\\n0 failed\\n")', current.summaryKind);
    }
    return nodeGate(current.name, 'process.stdout.write("ok\\n")');
  });
}

function failingSummaryGate(summaryKind, failure) {
  const name = `${summaryKind}-${failure.replaceAll(" ", "-")}`;
  const expectedSummary = summaryKind === "playwright" ? { passed: 1, skipped: 0 } : undefined;
  if (failure === "spawn error") {
    return { name, file: join(tmpdir(), `missing-m12-command-${Date.now()}`), args: [], env: {}, summaryKind, expectedSummary };
  }
  const source = {
    nonzero: "process.exit(7)",
    timeout: "setInterval(() => {}, 1_000)",
    signal: 'process.kill(process.pid, "SIGTERM")',
    "unparsable output": 'process.stdout.write("not a test summary\\n")',
  }[failure];
  return nodeGate(name, source, summaryKind, expectedSummary);
}

function replace(path, before, after) {
  writeFileSync(path, readFileSync(path, "utf8").replace(before, after));
}

function exists(path) {
  try { readFileSync(path); return true; } catch { return false; }
}

function sha(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function treeSha(directory, files) {
  const hash = createHash("sha256");
  for (const [relativePath, contents] of files) {
    const bytes = readFileSync(join(directory, relativePath));
    assert.equal(bytes.toString("utf8"), contents);
    hash.update(`${Buffer.byteLength(relativePath)}:${relativePath}\0${bytes.byteLength}:`);
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function png(width, height, seed) {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, Buffer.from([seed])]);
}
