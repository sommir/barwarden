import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
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

import {
  assertSafeMachineReport,
  buildExternalLiveRows,
  defaultGates,
  publishReports,
  runM14Verification,
} from "./run-m14-verification.mjs";

const vendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const gateNames = [
  "source-precondition",
  "pinned-vendor-convergence",
  "protocol-guards",
  "auth-contracts",
  "vault-scenario-guards",
  "text-send-guards",
  "m14-typechecks",
  "web-production-build",
  "production-bundle-audit-fixtures",
  "production-bundle-audit",
  "chromium-live-matrix",
  "vitest-full",
  "playwright-full",
  "rust-tests",
  "rust-build",
  "final-integrity-secret-scan",
];

test("retains the ordered sixteen-gate M14 controller", () => {
  assert.deepEqual(defaultGates.map(({ name }) => name), gateNames);
  assert.equal(defaultGates.find(({ name }) => name === "playwright-full").expectedTotal, 501);
});

test("builds only truthful absent-input external rows", () => {
  const rows = buildExternalLiveRows();
  assert.equal(rows.length, 33);
  assert.deepEqual(countStatuses(rows), {
    passed: 0,
    skippedExternal: 30,
    blockedExternal: 3,
    failed: 0,
  });
  assert.ok(rows.every(({ status }) => status === "skipped_external" || status === "blocked_external"));
});

test("publishes a strict machine report only after all gates pass", async (t) => {
  const fixture = createFixture(t);
  const events = [];
  const report = await runM14Verification({
    ...fixture.options,
    gates: passingGates(),
    onStatus: (name, status) => events.push(`${name}:${status}`),
  });

  assert.deepEqual(report, JSON.parse(readFileSync(fixture.machinePath, "utf8")));
  assert.equal(report.schema, "m14-live-service-verification-v1");
  assert.equal(report.sourceHead, fixture.head);
  assert.equal(report.vendorRevision, vendorRevision);
  assert.deepEqual(report.gates, gateNames.map((name) => ({ name, status: "passed", exitCode: 0 })));
  assert.deepEqual(report.aggregate, countStatuses(report.liveRows));
  assert.equal(events.length, 16);
  assert.ok(events.every((event) => event.endsWith(":passed")));
  assert.match(readFileSync(fixture.livePath, "utf8"), /implementation_complete-live_external_unverified/);
});

test("scrubs live inputs from every non-live gate and passes them only to the live child", async (t) => {
  const fixture = createFixture(t);
  const environment = configuredSelfHostedEnvironment();
  const liveRows = configuredSelfHostedRows();
  const gates = passingGates({ liveRows, assertEnvironmentIsolation: true });

  const report = await runM14Verification({ ...fixture.options, environment, gates });

  assert.deepEqual(report.liveRows, liveRows);
  const published = `${readFileSync(fixture.machinePath, "utf8")}\n${readFileSync(fixture.livePath, "utf8")}`;
  for (const value of livePrivateValues(environment)) assert.doesNotMatch(published, new RegExp(value));
});

test("uses strict sanitized live child rows in the final report", async (t) => {
  const fixture = createFixture(t);
  const environment = configuredSelfHostedEnvironment();
  const liveRows = configuredSelfHostedRows();

  const report = await runM14Verification({
    ...fixture.options,
    environment,
    gates: passingGates({ liveRows }),
  });

  assert.deepEqual(report.liveRows, liveRows);
  assert.deepEqual(report.aggregate, countStatuses(liveRows));
  assert.equal(report.aggregate.passed, 10);
});

test("preserves partial-input blocked truth from the live child", async (t) => {
  const fixture = createFixture(t);
  const environment = {
    ...process.env,
    BARWARDEN_LIVE_SERVER_URL: "synthetic-private-server",
  };
  const liveRows = partialSelfHostedRows();

  const report = await runM14Verification({
    ...fixture.options,
    environment,
    gates: passingGates({ liveRows }),
  });

  assert.deepEqual(report.liveRows, liveRows);
  assert.equal(
    report.liveRows.filter(({ service, status, reasonCode }) =>
      service === "self-hosted" && status === "blocked_external" && reasonCode === "credentials_partial"
    ).length,
    10,
  );
});

test("rejects ready authentication rows that are neither passed nor challenge-blocked", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const environment = configuredSelfHostedEnvironment();
  const rows = configuredSelfHostedRows();
  rows[22] = { ...rows[22], status: "blocked_external", reasonCode: "stage_failed" };

  await assert.rejects(
    runM14Verification({ ...fixture.options, environment, gates: passingGates({ liveRows: rows }) }),
    /readiness/i,
  );
  assertPriorReports(fixture);
});

test("rejects enabled mutation rows that are neither passed nor challenge-blocked", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const environment = configuredSelfHostedEnvironment();
  const rows = configuredSelfHostedRows();
  rows[26] = { ...rows[26], status: "blocked_external", reasonCode: "stage_failed" };

  await assert.rejects(
    runM14Verification({ ...fixture.options, environment, gates: passingGates({ liveRows: rows }) }),
    /readiness/i,
  );
  assertPriorReports(fixture);
});

test("rejects passed mutation rows when mutation remains disabled", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const environment = configuredSelfHostedEnvironment();
  delete environment.BARWARDEN_LIVE_MUTATION;
  const rows = configuredSelfHostedRows();

  await assert.rejects(
    runM14Verification({ ...fixture.options, environment, gates: passingGates({ liveRows: rows }) }),
    /readiness/i,
  );
  assertPriorReports(fixture);
});

test("rejects malformed live child rows and preserves prior reports", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const invalidRows = buildExternalLiveRows();
  invalidRows[0] = { ...invalidRows[0], detail: "synthetic user title" };

  await assert.rejects(
    runM14Verification({ ...fixture.options, gates: passingGates({ liveRows: invalidRows }) }),
    /live.*result|forbidden field/i,
  );
  assertPriorReports(fixture);
});

test("emits only an allowlisted fixed identifier for a Playwright failure", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const gates = passingGates();
  gates[10] = liveResultGate([], "live_vault_self_hosted_folder_failed", 1);

  await assert.rejects(
    runM14Verification({ ...fixture.options, gates }),
    (error) => {
      assert.equal(error.message, "M14 chromium-live-matrix failed: live_vault_self_hosted_folder_failed");
      return true;
    },
  );
  assertPriorReports(fixture);
});

test("emits only validated project, static spec file, and line for an aggregate Playwright failure", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const gates = passingGates();
  gates[12] = playwrightDiagnosticGate({
    schema: "m14-playwright-diagnostic-v1",
    failure: {
      project: "webkit",
      file: "apps/menubar-tauri/e2e/synthetic.spec.ts",
      line: 2,
    },
  });

  await assert.rejects(
    runM14Verification({ ...fixture.options, gates }),
    (error) => {
      assert.equal(
        error.message,
        "M14 playwright-full failed: webkit apps/menubar-tauri/e2e/synthetic.spec.ts:2",
      );
      return true;
    },
  );
  assertPriorReports(fixture);
});

for (const [label, artifact] of [
  ["path traversal", {
    schema: "m14-playwright-diagnostic-v1",
    failure: { project: "webkit", file: "../../private.spec.ts", line: 1 },
  }],
  ["unknown project", {
    schema: "m14-playwright-diagnostic-v1",
    failure: { project: "private-project", file: "apps/menubar-tauri/e2e/synthetic.spec.ts", line: 1 },
  }],
  ["raw reporter data", {
    schema: "m14-playwright-diagnostic-v1",
    failure: {
      project: "webkit",
      file: "apps/menubar-tauri/e2e/synthetic.spec.ts",
      line: 1,
      title: "synthetic user title",
    },
  }],
]) {
  test(`rejects aggregate Playwright diagnostic ${label} without reflection`, async (t) => {
    const fixture = createFixture(t, { previousReports: true });
    const gates = passingGates();
    gates[12] = playwrightDiagnosticGate(artifact);

    await assert.rejects(
      runM14Verification({ ...fixture.options, gates }),
      (error) => {
        assert.equal(error.message, "M14 playwright-full failed: playwright_full_diagnostic_invalid");
        assert.doesNotMatch(error.message, /private-project|private\.spec|synthetic user title/);
        return true;
      },
    );
    assertPriorReports(fixture);
  });
}

test("rejects an oversized aggregate Playwright diagnostic", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const gates = passingGates();
  gates[12] = playwrightDiagnosticGate(null, '"x".repeat(20_000)');

  await assert.rejects(
    runM14Verification({ ...fixture.options, gates }),
    /playwright_full_diagnostic_invalid/,
  );
  assertPriorReports(fixture);
});

test("rejects a secret-bearing aggregate Playwright diagnostic without reflection", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const secret = "synthetic-private-diagnostic";
  const gates = passingGates();
  gates[12] = playwrightDiagnosticGate({
    schema: "m14-playwright-diagnostic-v1",
    failure: {
      project: "webkit",
      file: "apps/menubar-tauri/e2e/synthetic.spec.ts",
      line: 1,
      detail: secret,
    },
  });

  await assert.rejects(
    runM14Verification({ ...fixture.options, gates, privateInputs: [secret] }),
    (error) => {
      assert.equal(error.message, "M14 playwright-full failed: playwright_full_diagnostic_invalid");
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
  assertPriorReports(fixture);
});

test("delegates the aggregate Playwright gate to the release script", () => {
  assert.equal(defaultGates[12].file, "npm");
  assert.deepEqual(defaultGates[12].args, ["run", "test:playwright:release"]);
});

test("rejects an untrusted Playwright failure title without reflecting it", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const gates = passingGates();
  const privateTitle = "synthetic user supplied test title";
  gates[10] = nodeGate(
    gateNames[10],
    `const {writeFileSync}=await import("node:fs");writeFileSync(process.env.BARWARDEN_LIVE_RESULT_PATH,JSON.stringify({schema:"m14-live-gate-result-v1",rows:[],failure:${JSON.stringify(privateTitle)}}));process.stderr.write(${JSON.stringify(privateTitle)});process.exitCode=1;`,
  );

  await assert.rejects(
    runM14Verification({ ...fixture.options, gates }),
    (error) => {
      assert.equal(error.message, "M14 chromium-live-matrix failed: chromium_live_matrix_failed");
      assert.doesNotMatch(error.message, new RegExp(privateTitle));
      return true;
    },
  );
  assertPriorReports(fixture);
});

for (const status of ["failed", "ready", "unknown"]) {
  test(`rejects live status ${status}`, () => {
    const rows = buildExternalLiveRows().map((row, index) =>
      index === 0 ? { ...row, status } : row,
    );
    assert.throws(() => assertSafeMachineReport(machineReport(rows)), /status/i);
  });
}

for (const [label, value] of [
  ["private value", "synthetic-private-input"],
  ["URL", "https://private.invalid.test"],
  ["email", "operator@example.test"],
  ["UUID", "123e4567-e89b-12d3-a456-426614174000"],
]) {
  test(`rejects a report containing a ${label}`, () => {
    const report = machineReport(buildExternalLiveRows());
    report.liveRows[0] = { ...report.liveRows[0], detail: value };
    assert.throws(
      () => assertSafeMachineReport(report, label === "private value" ? [value] : []),
      /private|report|field/i,
    );
  });
}

for (const field of ["stdout", "stderr", "command", "accessToken"]) {
  test(`rejects raw or token-like report field ${field}`, () => {
    const report = machineReport(buildExternalLiveRows());
    report.gates[0] = { ...report.gates[0], [field]: "synthetic" };
    assert.throws(() => assertSafeMachineReport(report), /field|report/i);
  });
}

for (const stream of ["stdout", "stderr"]) {
  test(`fails and preserves prior reports when a configured secret reaches ${stream}`, async (t) => {
    const fixture = createFixture(t, { previousReports: true });
    const secret = "synthetic-private-input";
    const gates = passingGates();
    gates[3] = nodeGate(
      gateNames[3],
      `process.${stream}.write(${JSON.stringify(secret)})`,
    );

    await assert.rejects(
      runM14Verification({ ...fixture.options, gates, privateInputs: [secret] }),
      /private/i,
    );
    assertPriorReports(fixture);
  });
}

test("detects an early private value before capture truncation", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const environment = secretScanningEnvironment();
  const gates = passingGates();
  gates[3] = nodeGate(
    gateNames[3],
    'process.stdout.write(process.env.M14_TEST_PRIVATE_VALUE);process.stdout.write("x".repeat(1_100_000));',
  );

  await assert.rejects(
    runM14Verification({ ...fixture.options, environment, gates }),
    /private/i,
  );
  assertPriorReports(fixture);
});

test("detects a private value split across output chunks before capture truncation", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const environment = secretScanningEnvironment();
  const gates = passingGates();
  gates[3] = nodeGate(
    gateNames[3],
    'const value=process.env.M14_TEST_PRIVATE_VALUE;const split=Math.floor(value.length/2);process.stdout.write(value.slice(0,split));setTimeout(()=>{process.stdout.write(value.slice(split));process.stdout.write("x".repeat(1_100_000));},20);',
  );

  await assert.rejects(
    runM14Verification({ ...fixture.options, environment, gates }),
    /private/i,
  );
  assertPriorReports(fixture);
});

test("kills a timed-out process group and preserves reports", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const childPidPath = join(fixture.root, "child.pid");
  const gates = passingGates();
  gates[4] = nodeGate(
    gateNames[4],
    `const {spawn}=await import("node:child_process");const {writeFileSync}=await import("node:fs");const child=spawn(process.execPath,["-e","process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:"ignore"});writeFileSync(${JSON.stringify(childPidPath)},String(child.pid));setInterval(()=>{},1000);`,
  );

  await assert.rejects(
    runM14Verification({ ...fixture.options, gates, timeoutMs: 100, terminationGraceMs: 50 }),
    /timeout|failed/i,
  );
  const pid = Number(readFileSync(childPidPath, "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assertPriorReports(fixture);
});

test("rejects a source revision change during verification", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const gates = passingGates();
  gates[5] = nodeGate(
    gateNames[5],
    'const {writeFileSync}=await import("node:fs");const {execFileSync}=await import("node:child_process");writeFileSync("source-change.txt","change\\n");execFileSync("git",["add","."]);execFileSync("git",["commit","-qm","source change"]);',
  );

  await assert.rejects(runM14Verification({ ...fixture.options, gates }), /source.*changed/i);
  assertPriorReports(fixture);
});

test("rejects vendor revision drift during verification", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const gates = passingGates();
  gates[6] = nodeGate(
    gateNames[6],
    'const {writeFileSync}=await import("node:fs");writeFileSync("vendor/bitwarden-clients/UI_SOURCE_COMMIT","wrong\\n");',
  );

  await assert.rejects(runM14Verification({ ...fixture.options, gates }), /vendor|integrity/i);
  assertPriorReports(fixture);
});

test("rejects an uncommitted stale report before running gates", async (t) => {
  const fixture = createFixture(t);
  writeFileSync(fixture.machinePath, '{"schema":"stale"}\n');

  await assert.rejects(
    runM14Verification({ ...fixture.options, gates: passingGates() }),
    /clean source/i,
  );
  assert.equal(readFileSync(fixture.machinePath, "utf8"), '{"schema":"stale"}\n');
});

test("fails final integrity when a gate dirties committed source", async (t) => {
  const fixture = createFixture(t, { previousReports: true });
  const gates = passingGates();
  gates[14] = nodeGate(
    gateNames[14],
    'const {writeFileSync}=await import("node:fs");writeFileSync("dirty.txt","dirty\\n");',
  );

  await assert.rejects(runM14Verification({ ...fixture.options, gates }), /integrity|clean source/i);
  assertPriorReports(fixture);
});

test("rolls back both reports when atomic publication fails", (t) => {
  const fixture = createFixture(t, { previousReports: true });
  let renames = 0;

  assert.throws(() => publishReports([
    { path: fixture.machinePath, contents: "new machine\n" },
    { path: fixture.livePath, contents: "new live\n" },
  ], {
    rename(from, to) {
      renames += 1;
      if (renames === 2) throw new Error("synthetic rename failure");
      return execFileSync("mv", [from, to]);
    },
  }), /rename failure/);
  assertPriorReports(fixture);
});

function createFixture(t, { previousReports = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "m14-controller-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  writeFileSync(join(root, "source.txt"), "source\n");
  mkdirSync(join(root, "apps/menubar-tauri/e2e"), { recursive: true });
  writeFileSync(join(root, "apps/menubar-tauri/e2e/synthetic.spec.ts"), "test line one\ntest line two\n");
  execFileSync("mkdir", ["-p", join(root, "vendor/bitwarden-clients")]);
  writeFileSync(join(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"), `${vendorRevision}\n`);
  const machinePath = join(root, "machine.json");
  const livePath = join(root, "live.md");
  if (previousReports) {
    writeFileSync(machinePath, "prior machine\n");
    writeFileSync(livePath, "prior live\n");
  }
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  return {
    root,
    head,
    machinePath,
    livePath,
    options: { root, machinePath, livePath, expectedSourceHead: head },
  };
}

function passingGates({ liveRows = buildExternalLiveRows(), assertEnvironmentIsolation = false } = {}) {
  return gateNames.map((name, index) => {
    if (name === "chromium-live-matrix") {
      const requiredLiveNames = [
        "BARWARDEN_LIVE_SERVER_URL",
        "BARWARDEN_LIVE_EMAIL",
        "BARWARDEN_LIVE_PASSWORD",
        "BARWARDEN_LIVE_MUTATION",
      ];
      const isolationAssertion = assertEnvironmentIsolation
        ? `if(!${JSON.stringify(requiredLiveNames)}.every((name)=>process.env[name]))process.exit(3);`
        : "";
      return liveResultGate(liveRows, null, 0, isolationAssertion);
    }
    const isolationAssertion = assertEnvironmentIsolation
      ? 'if(Object.keys(process.env).some((name)=>name.startsWith("BARWARDEN_LIVE_")))process.exit(2);'
      : "";
    return nodeGate(name, `${isolationAssertion}process.stdout.write("ok\\n")`);
  });
}

function nodeGate(name, source) {
  return { name, file: process.execPath, args: ["--input-type=module", "--eval", source] };
}

function liveResultGate(rows, failure = null, exitCode = 0, prefix = "") {
  const result = { schema: "m14-live-gate-result-v1", rows, failure };
  return nodeGate(
    "chromium-live-matrix",
    `${prefix}if(process.env.BARWARDEN_LIVE_RESULT_PATH){const {writeFileSync}=await import("node:fs");writeFileSync(process.env.BARWARDEN_LIVE_RESULT_PATH,${JSON.stringify(JSON.stringify(result))});}process.stdout.write("ok\\n");process.exitCode=${exitCode};`,
  );
}

function playwrightDiagnosticGate(artifact, rawExpression = null) {
  const source = rawExpression ?? JSON.stringify(JSON.stringify(artifact));
  return nodeGate(
    "playwright-full",
    `const {writeFileSync}=await import("node:fs");writeFileSync(process.env.BARWARDEN_M14_PLAYWRIGHT_DIAGNOSTIC_PATH,${source});process.exitCode=1;`,
  );
}

function configuredSelfHostedEnvironment() {
  return {
    ...process.env,
    BARWARDEN_LIVE_SERVER_URL: "synthetic-private-server",
    BARWARDEN_LIVE_EMAIL: "synthetic-private-email",
    BARWARDEN_LIVE_PASSWORD: "synthetic-private-password",
    BARWARDEN_LIVE_MUTATION: "true",
  };
}

function secretScanningEnvironment() {
  const value = "synthetic-private-value-that-crosses-chunks";
  return {
    ...process.env,
    BARWARDEN_LIVE_PASSWORD: value,
    M14_TEST_PRIVATE_VALUE: value,
  };
}

function livePrivateValues(environment) {
  return [
    environment.BARWARDEN_LIVE_SERVER_URL,
    environment.BARWARDEN_LIVE_EMAIL,
    environment.BARWARDEN_LIVE_PASSWORD,
  ];
}

function configuredSelfHostedRows() {
  return buildExternalLiveRows().map((row) => {
    if (row.service !== "self-hosted" || row.reasonCode === "challenge_not_triggered") return row;
    return { service: row.service, mode: row.mode, stage: row.stage, status: "passed" };
  });
}

function partialSelfHostedRows() {
  return buildExternalLiveRows().map((row) => {
    if (row.service !== "self-hosted" || row.reasonCode === "challenge_not_triggered") return row;
    return { ...row, status: "blocked_external", reasonCode: "credentials_partial" };
  });
}

function machineReport(rows) {
  return {
    schema: "m14-live-service-verification-v1",
    sourceHead: "1".repeat(40),
    vendorRevision,
    gates: gateNames.map((name) => ({ name, status: "passed", exitCode: 0 })),
    liveRows: rows,
    aggregate: countStatuses(rows),
  };
}

function countStatuses(rows) {
  return {
    passed: rows.filter(({ status }) => status === "passed").length,
    skippedExternal: rows.filter(({ status }) => status === "skipped_external").length,
    blockedExternal: rows.filter(({ status }) => status === "blocked_external").length,
    failed: rows.filter(({ status }) => status === "failed").length,
  };
}

function assertPriorReports(fixture) {
  assert.equal(readFileSync(fixture.machinePath, "utf8"), "prior machine\n");
  assert.equal(readFileSync(fixture.livePath, "utf8"), "prior live\n");
  assert.equal(existsSync(`${fixture.machinePath}.tmp`), false);
  assert.equal(existsSync(`${fixture.livePath}.tmp`), false);
}
