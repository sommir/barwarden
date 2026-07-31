import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync as nativeRenameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const verifier = await import(new URL("./run-m13-verification.mjs", import.meta.url));
const { defaultGates, publishArtifacts, runVerification } = verifier;
const vendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
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
const playwrightContracts = [
  { name: "settings-chromium-writer", expectedSummary: { passed: 5, skipped: 0 } },
  { name: "settings-chromium-read-only", expectedSummary: { passed: 4, skipped: 1 } },
  { name: "settings-webkit-read-only", expectedSummary: { passed: 4, skipped: 1 } },
  { name: "playwright-full", expectedSummary: { passed: 428, skipped: 17 } },
];
const focusedGateContracts = [
  { name: "settings-overlay-guards", summaryKind: "vitest", expectedSummary: { passed: 9, skipped: 0 } },
  { name: "settings-focused", summaryKind: "vitest", expectedSummary: { passed: 133, skipped: 0 } },
  { name: "production-bundle-audit-fixtures", summaryKind: "node-test", expectedSummary: { passed: 3, skipped: 0 } },
];

test("default gates retain the ordered sixteen-stage M13 plan", () => {
  assert.deepEqual(defaultGates.map(({ name }) => name), [
    "source-precondition",
    "pinned-vendor",
    "settings-overlay-guards",
    "settings-focused",
    "vitest-full",
    "official-typechecks",
    "web-production-build",
    "production-bundle-audit-fixtures",
    "production-bundle-audit",
    "settings-chromium-writer",
    "settings-chromium-read-only",
    "settings-webkit-read-only",
    "playwright-full",
    "rust-tests",
    "rust-build",
    "final-integrity",
  ]);
  assert.equal(defaultGates[9].env.UPDATE_EVIDENCE, "true");
  assert.ok(defaultGates.slice(10).every(({ env }) => env.UPDATE_EVIDENCE === "false"));
  assert.deepEqual(
    [defaultGates[2], defaultGates[3], defaultGates[7]]
      .map(({ name, summaryKind, expectedSummary }) => ({ name, summaryKind, expectedSummary })),
    focusedGateContracts,
  );
  assert.deepEqual(defaultGates[4].expectedSummary, { passed: 2643, skipped: 7 });
  assert.deepEqual(defaultGates[13].expectedSummary, { passed: 34, skipped: 1 });
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
  assert.match(runtime, /\| settings-chromium-writer \| 5 \| 0 \|/);
  assert.match(runtime, /\| settings-chromium-read-only \| 4 \| 1 \|/);
  assert.match(runtime, /\| settings-webkit-read-only \| 4 \| 1 \|/);
  assert.match(runtime, /\| playwright-full \| 428 \| 17 \|/);
  assert.doesNotMatch(runtime, /\| vitest-full \|/);
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
  ["wrong evidence writer", (fixture) => mutateProvenance(fixture, (provenance) => {
    provenance.writer.project = "webkit-read-only";
  }), /writer project/i],
  ["wrong evidence dimensions", (fixture) => mutateProvenance(fixture, (provenance) => {
    provenance.authorities[0].width = 479;
  }), /dimensions/i],
  ["wrong runtime identity", (fixture) => mutateProvenance(fixture, (provenance) => {
    provenance.identity.runtimeIdentitySha256 = "0".repeat(64);
  }), /runtime identity/i],
  ["wrong canonical source identity", (fixture) => mutateProvenance(fixture, (provenance) => {
    provenance.authorities[0].canonicalSourceRevision = "0".repeat(40);
    recomputeEvidenceSet(provenance);
  }), /historical authority source/i],
  ["wrong canonical runtime identity", (fixture) => mutateProvenance(fixture, (provenance) => {
    provenance.authorities[0].canonicalRuntimeIdentitySha256 = "0".repeat(64);
    recomputeEvidenceSet(provenance);
  }), /historical authority runtime/i],
  ["wrong canonical attestation", (fixture) => mutateProvenance(fixture, (provenance) => {
    provenance.authorities[0].canonicalAttestationRevision = fixture.evidenceSourceHead;
    recomputeEvidenceSet(provenance);
  }), /historical authority attestation/i],
  ["wrong evidence-set identity", (fixture) => mutateProvenance(fixture, (provenance) => {
    provenance.evidenceSetSha256 = "0".repeat(64);
  }), /evidence set/i],
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
  "package.json",
  "package-lock.json",
  "playwright.config.ts",
  "vitest.config.ts",
  "tsconfig.json",
  "postcss.config.cjs",
  "tailwind.config.cjs",
  "apps/menubar-tauri/vite.config.ts",
  "apps/menubar-tauri/dist/index.html",
  "apps/menubar-tauri/official-settings-source-manifest.json",
  "apps/menubar-tauri/src/app/app.config.ts",
  "apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json",
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

test("Settings workflow freshness scopes include vitest.config.ts and reject omission mutants", () => {
  const workflow = readFileSync(
    new URL("../apps/menubar-tauri/e2e/official-settings-workflows.spec.ts", import.meta.url),
    "utf8",
  );

  assertSettingsWorkflowFreshnessScopes(workflow);
  for (const functionName of [
    "validateRecordedSourceRevision",
    "resolveEvidenceWriterSourceRevision",
  ]) {
    const body = functionSource(workflow, functionName);
    const mutant = workflow.replace(body, body.replace('    "vitest.config.ts",\n', ""));
    assert.throws(
      () => assertSettingsWorkflowFreshnessScopes(mutant),
      new RegExp(`${functionName}.*vitest\\.config\\.ts`),
    );
  }
});

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

for (const failedRename of [1, 2]) {
  test(`rolls back both reports when publication rename ${failedRename} fails`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), "m13-report-publication-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const runtimePath = join(directory, "runtime.md");
    const artifactPath = join(directory, "machine.json");
    writeFileSync(runtimePath, "prior runtime\n");
    writeFileSync(artifactPath, "prior machine\n");
    let renameCount = 0;

    assert.throws(() => publishArtifacts([
      { path: runtimePath, contents: "next runtime\n" },
      { path: artifactPath, contents: "next machine\n" },
    ], {
      renameSync(source, destination) {
        renameCount += 1;
        if (renameCount === failedRename) throw new Error(`rename ${failedRename} rejected`);
        nativeRenameSync(source, destination);
      },
    }), new RegExp(`rename ${failedRename} rejected`));

    assert.equal(readFileSync(runtimePath, "utf8"), "prior runtime\n");
    assert.equal(readFileSync(artifactPath, "utf8"), "prior machine\n");
  });
}

for (const gateName of ["production-bundle-audit", "rust-tests"]) {
  test(`fails closed when ${gateName} fails`, async (t) => {
    const fixture = createRepository(t);
    const gates = [nodeGate(gateName, "process.exit(7)")];
    await assert.rejects(runVerification({ ...fixture.options, gates }), new RegExp(gateName));
    assert.equal(exists(fixture.artifactPath), false);
  });
}

for (const summaryKind of ["playwright", "vitest", "cargo", "node-test"]) {
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

test("bounds timeout cleanup for a SIGTERM-trapping gate and surviving descendant", {
  skip: process.platform === "win32",
}, async (t) => {
  const fixture = createRepository(t);
  const descendantPidPath = join(fixture.root, "descendant.pid");
  const survivorSource = `
    process.on("SIGTERM", () => {});
    setTimeout(() => process.exit(0), 900);
  `;
  const gateSource = `
    import { spawn } from "node:child_process";
    import { writeFileSync } from "node:fs";
    const descendant = spawn(process.execPath, ["--input-type=module", "--eval", ${JSON.stringify(survivorSource)}], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    writeFileSync(${JSON.stringify(descendantPidPath)}, String(descendant.pid));
    process.on("SIGTERM", () => {});
    setTimeout(() => process.exit(0), 900);
  `;
  let descendantPid;
  t.after(() => {
    if (!descendantPid) return;
    try { process.kill(descendantPid, "SIGKILL"); } catch {}
  });

  const started = Date.now();
  await assert.rejects(
    runVerification({
      ...fixture.options,
      gates: [nodeGate("stubborn-timeout", gateSource)],
      timeoutMs: 50,
      terminationGraceMs: 75,
    }),
    /stubborn-timeout/,
  );
  const elapsedMs = Date.now() - started;
  descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
  const receipt = JSON.parse(readFileSync(fixture.failureReceiptPath, "utf8"));

  assert.equal(receipt.failed.timedOut, true);
  assert.equal(receipt.failed.signal, "SIGKILL");
  assert.ok(elapsedMs < 600, `timeout cleanup took ${elapsedMs}ms`);
  assert.throws(
    () => process.kill(descendantPid, 0),
    (error) => error?.code === "ESRCH",
  );
});

test("waits for group escalation when the timed-out leader exits before its descendant", {
  skip: process.platform === "win32",
}, async (t) => {
  const fixture = createRepository(t);
  const descendantPidPath = join(fixture.root, "early-leader-descendant.pid");
  const survivorSource = `
    import { writeFileSync } from "node:fs";
    process.on("SIGTERM", () => {});
    writeFileSync(${JSON.stringify(descendantPidPath)}, String(process.pid));
    setTimeout(() => process.exit(0), 2_000);
  `;
  const gateSource = `
    import { spawn } from "node:child_process";
    spawn(process.execPath, ["--input-type=module", "--eval", ${JSON.stringify(survivorSource)}], {
      stdio: "ignore",
    });
    process.on("SIGTERM", () => process.exit(0));
    setTimeout(() => process.exit(0), 2_000);
  `;
  let descendantPid;
  t.after(() => {
    if (!descendantPid) return;
    try { process.kill(descendantPid, "SIGKILL"); } catch {}
  });

  const started = Date.now();
  await assert.rejects(
    runVerification({
      ...fixture.options,
      gates: [nodeGate("early-leader-timeout", gateSource)],
      timeoutMs: 150,
      terminationGraceMs: 75,
    }),
    /early-leader-timeout/,
  );
  const elapsedMs = Date.now() - started;
  descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
  const receipt = JSON.parse(readFileSync(fixture.failureReceiptPath, "utf8"));

  assert.equal(receipt.failed.timedOut, true);
  assert.equal(receipt.failed.exitCode, 0);
  assert.equal(receipt.failed.signal, null);
  assert.ok(elapsedMs >= 200, `timeout cleanup settled before escalation at ${elapsedMs}ms`);
  assert.ok(elapsedMs < 800, `timeout cleanup took ${elapsedMs}ms`);
  assert.throws(
    () => process.kill(descendantPid, 0),
    (error) => error?.code === "ESRCH",
  );
});

test("accepts the exact focused gate summary contracts", async (t) => {
  const fixture = createRepository(t);
  const gates = focusedGateContracts.map((current) => nodeGate(
    current.name,
    `process.stdout.write(${JSON.stringify(summaryOutput(current.summaryKind, current.expectedSummary))})`,
    current.summaryKind,
    current.expectedSummary,
  ));

  const artifact = await runVerification({ ...fixture.options, gates });

  assert.deepEqual(
    artifact.results.map(({ summary }) => summary),
    focusedGateContracts.map(({ expectedSummary }) => ({ ...expectedSummary, failed: 0 })),
  );
});

for (const current of focusedGateContracts) {
  test(`rejects summary drift for ${current.name}`, async (t) => {
    const fixture = createRepository(t);
    const drifted = { ...current.expectedSummary, passed: current.expectedSummary.passed - 1 };
    const gate = nodeGate(
      current.name,
      `process.stdout.write(${JSON.stringify(summaryOutput(current.summaryKind, drifted))})`,
      current.summaryKind,
      current.expectedSummary,
    );

    await assert.rejects(runVerification({ ...fixture.options, gates: [gate] }), new RegExp(current.name));
    const receipt = JSON.parse(readFileSync(fixture.failureReceiptPath, "utf8"));
    assert.deepEqual(receipt.failed.summary, { ...drifted, failed: 0 });
    assert.match(receipt.failed.summaryError, new RegExp(`expected ${current.expectedSummary.passed} passed`));
  });

  test(`rejects unparsable output for ${current.name}`, async (t) => {
    const fixture = createRepository(t);
    const gate = nodeGate(
      current.name,
      'process.stdout.write("not a test summary\\n")',
      current.summaryKind,
      current.expectedSummary,
    );

    await assert.rejects(runVerification({ ...fixture.options, gates: [gate] }), new RegExp(current.name));
    const receipt = JSON.parse(readFileSync(fixture.failureReceiptPath, "utf8"));
    assert.equal(receipt.failed.summary, null);
    assert.match(receipt.failed.summaryError, /Could not parse/);
  });
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
    { passed: 428, failed: 0, skipped: 17 },
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

test("rejects unexpected Rust test counts", async (t) => {
  const fixture = createRepository(t);
  const gate = nodeGate(
    "rust-tests",
    'process.stdout.write("33 passed; 0 failed; 1 ignored\\n")',
    "cargo",
    { passed: 34, skipped: 1 },
  );

  await assert.rejects(runVerification({ ...fixture.options, gates: [gate] }), /rust-tests/);
  const receipt = JSON.parse(readFileSync(fixture.failureReceiptPath, "utf8"));
  assert.deepEqual(receipt.failed.summary, { passed: 33, failed: 0, skipped: 1 });
  assert.match(receipt.failed.summaryError, /expected 34 passed and 1 skipped/);
});

test("records exact authority hashes and aggregate counts only after all gates pass", async (t) => {
  const fixture = createRepository(t);
  const artifact = await runVerification({
    ...fixture.options,
    gates: [nodeGate("fixture-pass", 'process.stdout.write("ok\\n")')],
  });
  assert.equal(artifact.sourceHead, fixture.head);
  assert.equal(artifact.vendorRevision, vendorRevision);
  assert.equal(artifact.evidence.authorities.length, 9);
  assert.deepEqual(artifact.evidence.authorities[0].canonicalIdentity, {
    sourceRevision: fixture.evidenceSourceHead,
    runtimeIdentitySha256: fixture.runtimeIdentityHash,
    attestationRevision: fixture.canonicalAttestationRevision,
  });
  assert.deepEqual(artifact.aggregate, { gates: 1, passed: 1, failed: 0, screenshots: 9 });
  assert.equal(JSON.parse(readFileSync(fixture.artifactPath, "utf8")).sourceHead, fixture.head);
});

test("passes the validated evidence source revision to the Chromium writer", async (t) => {
  const fixture = createRepository(t);
  const assertion = `
    if (process.env.M13_EVIDENCE_SOURCE_REVISION !== ${JSON.stringify("EXPECTED_SOURCE_REVISION")}) {
      process.exit(7);
    }
  `.replace("EXPECTED_SOURCE_REVISION", fixture.evidenceSourceHead);

  const artifact = await runVerification({
    ...fixture.options,
    gates: [nodeGate("settings-chromium-writer", assertion)],
  });

  assert.equal(artifact.results[0].status, "passed");
});

function createRepository(t) {
  const root = mkdtempSync(join(tmpdir(), "m13-verifier-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "m13-verifier@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "M13 Verifier"], { cwd: root });
  mkdirSync(join(root, "vendor/bitwarden-clients"), { recursive: true });
  writeFileSync(join(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"), `${vendorRevision}\n`);
  writeFileSync(join(root, "vendor/bitwarden-clients/source.ts"), "vendor source\n");
  writeFileSync(join(root, "package.json"), '{"name":"fixture"}\n');
  writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  writeFileSync(join(root, "playwright.config.ts"), "export default {};\n");
  writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
  writeFileSync(join(root, "tsconfig.json"), '{}\n');
  writeFileSync(join(root, "postcss.config.cjs"), "module.exports = {};\n");
  writeFileSync(join(root, "tailwind.config.cjs"), "module.exports = {};\n");
  mkdirSync(join(root, "apps/menubar-tauri/src/app/upstream-overlays/settings"), { recursive: true });
  writeFileSync(join(root, "apps/menubar-tauri/vite.config.ts"), "export default {};\n");
  writeFileSync(join(root, "apps/menubar-tauri/official-settings-source-manifest.json"), '{}\n');
  writeFileSync(join(root, "apps/menubar-tauri/src/app/app.config.ts"), "export const appConfig = {};\n");
  writeFileSync(
    join(root, "apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json"),
    '{}\n',
  );
  const productionDirectory = join(root, "apps/menubar-tauri/dist");
  mkdirSync(productionDirectory, { recursive: true });
  writeFileSync(join(productionDirectory, "index.html"), "production bundle\n");
  const evidenceDirectory = join(root, "docs/superpowers/screenshots/m13-settings-2026-07-20");
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
  const provenancePath = join(evidenceDirectory, "provenance.json");
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
  const authorities = screenshotFiles.map((file) => ({
    file,
    sha256: sha(join(evidenceDirectory, file)),
    width: 480,
    height: 600,
    opaque: true,
    mostlyBlank: false,
    horizontallyClipped: false,
  }));
  const evidenceSetSha256 = createHash("sha256").update(JSON.stringify({
    schema: "m13-settings-evidence-set-v1",
    runtimeIdentitySha256: runtimeIdentityHash,
    authorities: authorities
      .map(({ file, sha256 }) => ({ fileName: file, sha256 }))
      .sort((left, right) => left.fileName.localeCompare(right.fileName)),
  })).digest("hex");
  writeFileSync(provenancePath, `${JSON.stringify({
    schema: "m13-settings-evidence-v1",
    sourceRevision: evidenceSourceHead,
    vendorRevision,
    identity: { ...runtimeIdentity, runtimeIdentitySha256: runtimeIdentityHash },
    evidenceSetSha256,
    writer: { project: "chromium", viewport: { width: 480, height: 600 }, deviceScaleFactor: 1 },
    authorities,
  }, null, 2)}\n`);
  const runtimePath = join(root, "docs/superpowers/specs/2026-07-20-m13-settings-runtime-result.md");
  mkdirSync(join(root, "docs/superpowers/specs"), { recursive: true });
  writeFileSync(runtimePath, `- Source revision: ${evidenceSourceHead}\n- Vendor revision: ${vendorRevision}\n\n| Browser | Result |\n| --- | --- |\n| Chromium writer | passed |\n| Chromium read-only | passed |\n| WebKit | passed |\n`);
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "evidence"], { cwd: root });
  const canonicalAttestationRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const authorityIdentities = authorities.map((authority) => ({
    ...authority,
    canonicalSourceRevision: evidenceSourceHead,
    canonicalRuntimeIdentitySha256: runtimeIdentityHash,
    canonicalAttestationRevision,
  }));
  const authorityEvidenceSetSha256 = createHash("sha256").update(JSON.stringify({
    schema: "m13-settings-evidence-set-v2",
    sourceRevision: evidenceSourceHead,
    runtimeIdentitySha256: runtimeIdentityHash,
    authorities: authorityIdentities
      .map((authority) => ({
        fileName: authority.file,
        sha256: authority.sha256,
        canonicalSourceRevision: authority.canonicalSourceRevision,
        canonicalRuntimeIdentitySha256: authority.canonicalRuntimeIdentitySha256,
        canonicalAttestationRevision: authority.canonicalAttestationRevision,
      }))
      .sort((left, right) => left.fileName.localeCompare(right.fileName)),
  })).digest("hex");
  writeFileSync(provenancePath, `${JSON.stringify({
    schema: "m13-settings-evidence-v2",
    sourceRevision: evidenceSourceHead,
    vendorRevision,
    identity: { ...runtimeIdentity, runtimeIdentitySha256: runtimeIdentityHash },
    evidenceSetSha256: authorityEvidenceSetSha256,
    writer: { project: "chromium", viewport: { width: 480, height: 600 }, deviceScaleFactor: 1 },
    authorities: authorityIdentities,
  }, null, 2)}\n`);
  execFileSync("git", ["add", provenancePath], { cwd: root });
  execFileSync("git", ["commit", "-qm", "authority identities"], { cwd: root });
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const artifactPath = join(root, "machine.json");
  const failureReceiptPath = join(root, "failure.json");
  return {
    root, head, evidenceSourceHead, evidenceDirectory, provenancePath, runtimePath, artifactPath, failureReceiptPath,
    productionBundleHash, packageLockHash, runtimeIdentityHash, canonicalAttestationRevision,
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
    if (current.expectedSummary) {
      return nodeGate(
        current.name,
        `process.stdout.write(${JSON.stringify(summaryOutput(current.summaryKind, current.expectedSummary))})`,
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
    return { name, file: join(tmpdir(), `missing-m13-command-${Date.now()}`), args: [], env: {}, summaryKind, expectedSummary };
  }
  const source = {
    nonzero: "process.exit(7)",
    timeout: "setInterval(() => {}, 1_000)",
    signal: 'process.kill(process.pid, "SIGTERM")',
    "unparsable output": 'process.stdout.write("not a test summary\\n")',
  }[failure];
  return nodeGate(name, source, summaryKind, expectedSummary);
}

function summaryOutput(summaryKind, summary) {
  if (summaryKind === "node-test") {
    return `ℹ pass ${summary.passed}\nℹ fail 0\nℹ skipped ${summary.skipped}\n`;
  }
  const skipLabel = summaryKind === "cargo" ? "ignored" : "skipped";
  return `${summary.passed} passed\n0 failed\n${summary.skipped} ${skipLabel}\n`;
}

function assertSettingsWorkflowFreshnessScopes(source) {
  for (const functionName of [
    "validateRecordedSourceRevision",
    "resolveEvidenceWriterSourceRevision",
  ]) {
    if (!functionSource(source, functionName).includes('"vitest.config.ts"')) {
      throw new Error(`${functionName} must include vitest.config.ts`);
    }
  }
}

function functionSource(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  assert.notEqual(start, -1, `missing ${functionName}`);
  const end = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

function replace(path, before, after) {
  writeFileSync(path, readFileSync(path, "utf8").replace(before, after));
}

function mutateProvenance(fixture, mutate) {
  const provenance = JSON.parse(readFileSync(fixture.provenancePath, "utf8"));
  mutate(provenance);
  writeFileSync(fixture.provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  commitMutation(fixture);
}

function recomputeEvidenceSet(provenance) {
  provenance.evidenceSetSha256 = createHash("sha256").update(JSON.stringify({
    schema: "m13-settings-evidence-set-v2",
    sourceRevision: provenance.sourceRevision,
    runtimeIdentitySha256: provenance.identity.runtimeIdentitySha256,
    authorities: provenance.authorities.map((authority) => ({
      fileName: authority.file,
      sha256: authority.sha256,
      canonicalSourceRevision: authority.canonicalSourceRevision,
      canonicalRuntimeIdentitySha256: authority.canonicalRuntimeIdentitySha256,
      canonicalAttestationRevision: authority.canonicalAttestationRevision,
    })).sort((left, right) => left.fileName.localeCompare(right.fileName)),
  })).digest("hex");
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
