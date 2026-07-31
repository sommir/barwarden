import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

const controllerUrl = new URL("./run-m16-verification.mjs", import.meta.url);
const controller = await import(controllerUrl);
const vendorRevision = "f47b6946e01aed474875789081966d311d5b8289";
const artifactPaths = {
  app: "apps/menubar-tauri/src-tauri/target/release/bundle/macos/Barwarden.app",
  executable: "apps/menubar-tauri/src-tauri/target/release/bundle/macos/Barwarden.app/Contents/MacOS/barwarden",
  infoPlist: "apps/menubar-tauri/src-tauri/target/release/bundle/macos/Barwarden.app/Contents/Info.plist",
  dmg: "apps/menubar-tauri/src-tauri/target/release/bundle/dmg/Barwarden_0.1.0_aarch64.dmg",
};
const gateNames = [
  "source-precondition",
  "pinned-vendor-convergence",
  "m14-local-contracts",
  "m14-typechecks",
  "vitest-full",
  "playwright-release",
  "m16-visual-accessibility",
  "web-production-build",
  "production-bundle-audit-fixtures",
  "rust-tests",
  "rust-check",
  "rust-release-build",
  "tauri-release-candidate-build",
  "production-bundle-audit",
  "candidate-artifact-identity",
  "macos-bundle-audit-fixtures",
  "macos-bundle-audit",
  "forbidden-surface-scan",
  "license-attribution-inventory",
  "accidental-secret-scan",
  "final-source-vendor-artifact-identity",
];
const blockerCodes = [
  "apple_release_credentials_absent",
  "second_display_absent",
  "clean_user_session_absent",
  "disposable_second_account_absent",
  "accessibility_confirmation_required",
  "live_service_inputs_absent",
];

test("exports the strict M16 controller contract", () => {
  assert.equal(typeof controller.runM16Verification, "function");
  assert.equal(typeof controller.runProcessGate, "function");
  assert.equal(typeof controller.assertSafeMachineReport, "function");
  assert.equal(typeof controller.publishMachineReport, "function");
  assert.deepEqual(controller.artifactPaths, artifactPaths);
});

test("retains the exact ordered release gates without release mutations", () => {
  assert.deepEqual(controller.defaultGates.map(({ name }) => name), gateNames);
  const external = controller.defaultGates.filter(({ internal }) => !internal);
  const commands = external.map(({ file, args }) => [file, ...args].join(" "));

  assert.equal(commands.filter((command) => command === "npm run tauri:build").length, 1);
  assert.ok(commands.includes("npm run test:playwright:release"));
  assert.equal(
    controller.defaultGates.find(({ name }) => name === "playwright-release").expectedTotal,
    501,
  );
  assert.ok(commands.includes(
    "npx playwright test apps/menubar-tauri/e2e/m16-release-visual-accessibility.spec.ts apps/menubar-tauri/e2e/macos-ui-visual-accessibility.spec.ts --project=chromium --project=webkit --workers=1 --reporter=line",
  ));
  assert.ok(commands.includes("npm run test:live:m14:contract"));
  assert.ok(commands.includes(
    "npx vitest run apps/menubar-tauri/src/app/app.routes.spec.ts apps/menubar-tauri/src/app/plan-a-scope.guard.spec.ts apps/menubar-tauri/src/app/standard-auth-scope.guard.spec.ts apps/menubar-tauri/src/app/upstream-import-guard.spec.ts apps/menubar-tauri/src/host/native-command-surface.guard.spec.ts",
  ));
  assert.ok(commands.includes("scripts/verify-macos-bundle.sh --inputs-only"));
  assert.ok(commands.includes(
    `scripts/verify-macos-bundle.sh --app ${artifactPaths.app} --dmg ${artifactPaths.dmg}`,
  ));
  assert.doesNotMatch(
    commands.join("\n"),
    /release:macos-bundle|test:live:m14(?:\s|$)|verify-macos-bundle\.sh --release|sign|notari|stapl|spctl|tccutil/i,
  );
  assert.ok(
    gateNames.indexOf("production-bundle-audit") >
      gateNames.indexOf("tauri-release-candidate-build"),
  );
});

test("rejects a same-name gate contract with a substituted command", async (t) => {
  const fixture = createFixture(t, { previousReport: true });
  const gates = controller.defaultGates.map((gate) => ({ ...gate }));
  const index = gates.findIndex(({ name }) => name === "vitest-full");
  gates[index] = { ...gates[index], file: "true", args: [] };
  let executed = false;

  await assert.rejects(
    controller.runM16Verification({
      ...fixture.options,
      gates,
      executeGate: passingExecutor(() => { executed = true; }),
    }),
    /ordered gate contract is invalid/i,
  );
  assert.equal(executed, false);
  assertPriorReport(fixture);
});

test("publishes exact candidate identity only after every ordered gate passes", async (t) => {
  const fixture = createFixture(t);
  const events = [];
  const report = await controller.runM16Verification({
    ...fixture.options,
    executeGate: passingExecutor(),
    onStatus: (name, status) => events.push(`${name}:${status}`),
  });

  assert.deepEqual(report, JSON.parse(readFileSync(fixture.reportPath, "utf8")));
  assert.equal(report.schema, "m16-release-candidate-verification-v1");
  assert.equal(report.status, "local_verification_passed_with_external_blockers");
  assert.equal(report.sourceRevision, fixture.head);
  assert.equal(report.vendorRevision, vendorRevision);
  assert.equal(report.packageJsonSha256, sha256File(join(fixture.root, "package.json")));
  assert.deepEqual(report.product, {
    name: "Barwarden",
    identifier: "com.sommir.barwarden",
    version: "0.1.0",
    minimumMacosVersion: "13.0",
  });
  assert.deepEqual(Object.fromEntries(
    Object.entries(report.artifacts).map(([name, value]) => [name, value.path]),
  ), artifactPaths);
  assert.equal(report.artifacts.app.sha256, sha256Tree(join(fixture.root, artifactPaths.app)));
  for (const name of ["executable", "infoPlist", "dmg"]) {
    assert.equal(report.artifacts[name].sha256, sha256File(join(fixture.root, artifactPaths[name])));
  }
  assert.deepEqual(report.gates.map(({ name, status }) => ({ name, status })),
    gateNames.map((name) => ({ name, status: "passed" })));
  assert.deepEqual(report.externalBlockers, blockerCodes);
  assert.deepEqual(events, gateNames.map((name) => `${name}:passed`));
  assert.equal(statSync(fixture.reportPath).mode & 0o777, 0o600);
  assert.ok(report.aggregate.testsPassed > 0);
  assert.equal(report.aggregate.testsFailed, 0);
  assert.equal(report.aggregate.gatesPassed, gateNames.length);
});

test("rejects an additional executable payload before publishing a candidate report", async (t) => {
  const fixture = createFixture(t, { previousReport: true });
  const staleExecutable = join(
    fixture.root,
    "apps/menubar-tauri/src-tauri/target/release/bundle/macos/Barwarden.app/Contents/MacOS/legacy",
  );
  writeFileSync(staleExecutable, "stale executable\n");
  chmodSync(staleExecutable, 0o755);

  await assert.rejects(
    controller.runM16Verification({
      ...fixture.options,
      executeGate: passingExecutor(),
    }),
    /unexpected executable payload/i,
  );
  assertPriorReport(fixture);
});

test("scrubs ambient Apple and live-service inputs from every child", async (t) => {
  const fixture = createFixture(t);
  const environment = {
    ...process.env,
    APPLE_API_KEY: "synthetic-private-apple-value",
    APPLE_SIGNING_IDENTITY: "synthetic-private-signing-value",
    BARWARDEN_LIVE_PASSWORD: "synthetic-private-live-value",
    BARWARDEN_LIVE_SERVER_URL: "synthetic-private-host-value",
  };
  let executions = 0;

  const report = await controller.runM16Verification({
    ...fixture.options,
    environment,
    executeGate: passingExecutor(({ childEnvironment }) => {
      executions += 1;
      assert.equal(childEnvironment.UPDATE_EVIDENCE, "false");
      assert.equal(Object.keys(childEnvironment).some((name) => name.startsWith("APPLE_")), false);
      assert.equal(Object.keys(childEnvironment).some((name) => name.startsWith("BARWARDEN_LIVE_")), false);
    }),
  });

  assert.ok(executions > 0);
  const published = readFileSync(fixture.reportPath, "utf8");
  for (const value of Object.values(environment).filter((value) => String(value).startsWith("synthetic-private"))) {
    assert.doesNotMatch(published, new RegExp(value));
  }
  assert.deepEqual(report.externalBlockers, blockerCodes);
});

test("does not publish when a local gate fails", async (t) => {
  const fixture = createFixture(t, { previousReport: true });
  await assert.rejects(
    controller.runM16Verification({
      ...fixture.options,
      executeGate: passingExecutor(({ gate }) => gate.name === "vitest-full"
        ? { exitCode: 1, signal: null, stdout: "", stderr: "private failure title" }
        : undefined),
    }),
    (error) => {
      assert.equal(error.message, "M16 gate failed: vitest-full");
      assert.doesNotMatch(error.message, /private failure title/);
      return true;
    },
  );
  assertPriorReport(fixture);
});

test("rejects private child output without reflecting it", async (t) => {
  const fixture = createFixture(t, { previousReport: true });
  const secret = "synthetic-private-controller-value";
  await assert.rejects(
    controller.runM16Verification({
      ...fixture.options,
      privateInputs: [secret],
      executeGate: passingExecutor(({ gate }) => gate.name === "m14-typechecks"
        ? { exitCode: 0, signal: null, stdout: secret, stderr: "" }
        : undefined),
    }),
    (error) => {
      assert.equal(error.message, "M16 gate output contains private input");
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
  assertPriorReport(fixture);
});

test("rejects a zero-test summary from a test-bearing gate", async (t) => {
  const fixture = createFixture(t, { previousReport: true });
  await assert.rejects(
    controller.runM16Verification({
      ...fixture.options,
      executeGate: passingExecutor(({ gate }) => gate.name === "playwright-release"
        ? { exitCode: 0, signal: null, stdout: "0 passed, 0 skipped, 0 failed\n", stderr: "" }
        : undefined),
    }),
    /gate summary failed: playwright-release/i,
  );
  assertPriorReport(fixture);
});

test("rejects a reduced aggregate Playwright inventory", async (t) => {
  const fixture = createFixture(t, { previousReport: true });
  await assert.rejects(
    controller.runM16Verification({
      ...fixture.options,
      executeGate: passingExecutor(({ gate }) => gate.name === "playwright-release"
        ? { exitCode: 0, signal: null, stdout: "468 passed\n", stderr: "" }
        : undefined),
    }),
    /gate summary failed: playwright-release/i,
  );
  assertPriorReport(fixture);
});

for (const mutation of [
  {
    label: "source",
    expected: /source revision changed/i,
    apply(fixture) {
      writeFileSync(join(fixture.root, "source-change.txt"), "changed\n");
      execFileSync("git", ["add", "."], { cwd: fixture.root });
      execFileSync("git", ["commit", "-qm", "source mutation"], { cwd: fixture.root });
    },
  },
  {
    label: "vendor",
    expected: /vendor revision drift/i,
    apply(fixture) {
      writeFileSync(join(fixture.root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"), "0".repeat(40));
    },
  },
  {
    label: "package",
    expected: /package identity changed/i,
    apply(fixture) {
      writeFileSync(join(fixture.root, "package.json"), '{"license":"private"}\n');
    },
  },
  ...["executable", "infoPlist", "dmg"].map((name) => ({
    label: name,
    expected: new RegExp(`${name} identity changed`, "i"),
    apply(fixture) {
      writeFileSync(join(fixture.root, artifactPaths[name]), `${name} changed\n`);
    },
  })),
  {
    label: "app executable mode",
    expected: /app identity changed/i,
    apply(fixture) {
      chmodSync(join(fixture.root, artifactPaths.executable), 0o644);
    },
  },
  {
    label: "app empty directory",
    expected: /app identity changed/i,
    apply(fixture) {
      mkdirSync(join(fixture.root, artifactPaths.app, "Contents/empty"));
    },
  },
]) {
  test(`fails closed on ${mutation.label} identity mutation and preserves the prior report`, async (t) => {
    const fixture = createFixture(t, { previousReport: true });
    await assert.rejects(
      controller.runM16Verification({
        ...fixture.options,
        executeGate: passingExecutor(({ gate }) => {
          if (gate.name === "accidental-secret-scan") mutation.apply(fixture);
        }),
      }),
      mutation.expected,
    );
    assertPriorReport(fixture);
  });
}

test("rejects an initially dirty source before executing gates", async (t) => {
  const fixture = createFixture(t, { previousReport: true });
  writeFileSync(join(fixture.root, "dirty.txt"), "dirty\n");
  let executed = false;

  await assert.rejects(
    controller.runM16Verification({
      ...fixture.options,
      executeGate: passingExecutor(() => { executed = true; }),
    }),
    /clean source/i,
  );
  assert.equal(executed, false);
  assertPriorReport(fixture);
});

test("rejects an incorrect expected committed HEAD before executing gates", async (t) => {
  const fixture = createFixture(t, { previousReport: true });
  let executed = false;
  await assert.rejects(
    controller.runM16Verification({
      ...fixture.options,
      expectedSourceHead: "0".repeat(40),
      executeGate: passingExecutor(() => { executed = true; }),
    }),
    /expected committed source/i,
  );
  assert.equal(executed, false);
  assertPriorReport(fixture);
});

test("rejects forbidden report fields and non-allowlisted strings", async (t) => {
  const fixture = createFixture(t);
  const report = await controller.runM16Verification({
    ...fixture.options,
    executeGate: passingExecutor(),
  });
  const withCommand = structuredClone(report);
  withCommand.gates[0].command = "npm test";
  assert.throws(() => controller.assertSafeMachineReport(withCommand), /forbidden field/i);

  const withPrivatePath = structuredClone(report);
  withPrivatePath.artifacts.dmg.path = "/private/tmp/candidate.dmg";
  assert.throws(() => controller.assertSafeMachineReport(withPrivatePath), /artifact path/i);

  const withUnknownBlocker = structuredClone(report);
  withUnknownBlocker.externalBlockers[0] = "unknown_external_state";
  assert.throws(() => controller.assertSafeMachineReport(withUnknownBlocker), /blocker/i);
});

test("atomic publication preserves a prior report when rename fails", (t) => {
  const fixture = createFixture(t, { previousReport: true });
  assert.throws(() => controller.publishMachineReport(fixture.reportPath, "new report\n", {
    rename() {
      throw new Error("synthetic rename failure");
    },
  }), /rename failure/);
  assertPriorReport(fixture);
});

test("kills a timed-out process group", { skip: process.platform === "win32" }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "m16-process-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const childPidPath = join(root, "child.pid");
  const source = `const {spawn}=await import("node:child_process");const {writeFileSync}=await import("node:fs");const child=spawn(process.execPath,["-e","process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:"ignore"});writeFileSync(${JSON.stringify(childPidPath)},String(child.pid));process.on("SIGTERM",()=>{});setInterval(()=>{},1000);`;
  const result = await controller.runProcessGate(
    { name: "synthetic-timeout", file: process.execPath, args: ["--input-type=module", "--eval", source] },
    {
      root,
      environment: process.env,
      privateInputs: [],
      timeoutMs: 150,
      terminationGraceMs: 50,
    },
  );

  assert.equal(result.timedOut, true);
  const pid = Number(readFileSync(childPidPath, "utf8"));
  await waitForProcessExit(pid);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("fails and cleans a successful gate that leaves a process-group descendant", {
  skip: process.platform === "win32",
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "m16-residual-process-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const childPidPath = join(root, "child.pid");
  const source = `const {spawn}=await import("node:child_process");const {writeFileSync}=await import("node:fs");const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});child.unref();writeFileSync(${JSON.stringify(childPidPath)},String(child.pid));`;
  const result = await controller.runProcessGate(
    { name: "synthetic-residual", file: process.execPath, args: ["--input-type=module", "--eval", source] },
    {
      root,
      environment: process.env,
      privateInputs: [],
      timeoutMs: 2_000,
      terminationGraceMs: 50,
    },
  );
  const pid = Number(readFileSync(childPidPath, "utf8"));
  t.after(() => {
    try { process.kill(pid, "SIGKILL"); } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.terminationError, "process_group_remained_after_exit");
  await waitForProcessExit(pid);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("package scripts expose only focused tests and the explicit controller", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["test:verify:m16"], "node --test scripts/run-m16-verification.spec.mjs");
  assert.equal(packageJson.scripts["verify:m16"], "node scripts/run-m16-verification.mjs");
});

function createFixture(t, { previousReport = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "m16-controller-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  mkdirSync(join(root, "vendor/bitwarden-clients"), { recursive: true });
  mkdirSync(join(root, "apps/menubar-tauri/src-tauri"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "apps/menubar-tauri/src-tauri/target/\nmachine.json.*.tmp\n");
  writeFileSync(join(root, "source.txt"), "source\n");
  writeFileSync(join(root, "package.json"), '{"license":"GPL-3.0-only"}\n');
  writeFileSync(join(root, "LICENSE"), "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n");
  writeFileSync(join(root, "NOTICE.md"), "Independent GPL project retaining Bitwarden upstream attribution.\n");
  writeFileSync(join(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"), `${vendorRevision}\n`);
  for (const name of ["LICENSE.txt", "LICENSE_GPL.txt", "LICENSE_BITWARDEN.txt"]) {
    writeFileSync(join(root, `vendor/bitwarden-clients/${name}`), "upstream license\n");
  }
  writeFileSync(join(root, "apps/menubar-tauri/src-tauri/tauri.conf.json"), JSON.stringify({
    productName: "Barwarden",
    version: "0.1.0",
    identifier: "com.sommir.barwarden",
    bundle: {
      license: "GPL-3.0-only",
      macOS: { minimumSystemVersion: "13.0" },
    },
  }));
  writeArtifactFixture(root);
  const reportPath = join(root, "machine.json");
  if (previousReport) writeFileSync(reportPath, "prior report\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  return {
    root,
    head,
    reportPath,
    options: { root, reportPath, expectedSourceHead: head, onStatus: () => {} },
  };
}

function writeArtifactFixture(root) {
  mkdirSync(join(root, artifactPaths.executable, ".."), { recursive: true });
  mkdirSync(join(root, artifactPaths.dmg, ".."), { recursive: true });
  writeFileSync(join(root, artifactPaths.executable), "synthetic executable\n");
  chmodSync(join(root, artifactPaths.executable), 0o755);
  writeFileSync(join(root, artifactPaths.infoPlist), "synthetic plist\n");
  writeFileSync(join(root, artifactPaths.dmg), "synthetic dmg\n");
}

function passingExecutor(inspect = () => undefined) {
  return async (gate, context) => {
    const override = inspect({ gate, childEnvironment: context.environment });
    if (override) return override;
    if (gate.summaryKind === "vitest") {
      return { exitCode: 0, signal: null, stdout: "Test Files 1 passed (1)\nTests 2 passed (2)\n", stderr: "" };
    }
    if (gate.summaryKind === "playwright") {
      return gate.name === "m16-visual-accessibility"
        ? { exitCode: 0, signal: null, stdout: "82 passed, 6 skipped\n", stderr: "" }
        : { exitCode: 0, signal: null, stdout: "460 passed, 41 skipped\n", stderr: "" };
    }
    if (gate.summaryKind === "cargo") {
      return { exitCode: 0, signal: null, stdout: "test result: ok. 2 passed; 0 failed; 1 ignored;\n", stderr: "" };
    }
    return { exitCode: 0, signal: null, stdout: "", stderr: "" };
  };
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
      if (entry.isSymbolicLink()) throw new Error("fixture does not permit symlinks");
      return entry.isDirectory() ? [path, ...walkEntries(path)] : [path];
    });
}

function assertPriorReport(fixture) {
  assert.equal(readFileSync(fixture.reportPath, "utf8"), "prior report\n");
  assert.equal(
    readdirSync(fixture.root).some((name) => name.startsWith("machine.json.") && name.endsWith(".tmp")),
    false,
  );
}

async function waitForProcessExit(pid) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
  }
}
