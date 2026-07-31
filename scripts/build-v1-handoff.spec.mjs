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

const handoff = await import("./build-v1-handoff.mjs");
const controller = await import("./run-m16-verification.mjs");
const replayValidator = await import("./m16-live-native-replay-validator.mjs");

test("exports strict runtime validators for machine and replay evidence", () => {
  assert.equal(typeof handoff.assertHandoffMachineReport, "function");
  assert.equal(typeof handoff.assertHandoffReplay, "function");
});

test("installation guidance makes Barwarden trust status conditional on fresh M16 evidence", () => {
  const guide = readFileSync(
    new URL("../docs/superpowers/specs/2026-07-22-v1-installation.md", import.meta.url),
    "utf8",
  );

  assert.match(guide, /No Barwarden candidate (?:signing|trust) status is documented yet/i);
  assert.match(guide, /If (?:that|the) fresh M16 report shows .*not notarized/i);
  assert.doesNotMatch(guide, /The current candidate is unsigned|Because the build is not notarized/i);
});

test("builds deterministic source, app, DMG, and checksum handoff artifacts", (t) => {
  const fixture = createFixture(t);

  const first = handoff.generateV1Handoff(fixture.options);
  const firstHashes = artifactHashes(fixture.root, first.paths);
  const second = handoff.generateV1Handoff(fixture.options);

  assert.deepEqual(artifactHashes(fixture.root, second.paths), firstHashes);
  assert.equal(first.sourceRevision, fixture.sourceRevision);
  assert.deepEqual(first.paths, [
    "dist/Barwarden.app.tar.gz",
    "dist/Barwarden_0.1.0_aarch64.dmg",
    "dist/barwarden-0.1.0-source.tar.gz",
  ]);
  const sourceInventory = execFileSync("tar", ["-tzf", join(fixture.root, first.paths[2])], {
    encoding: "utf8",
  });
  assert.match(sourceInventory, /barwarden-0\.1\.0\/package\.json/);
  assert.match(sourceInventory, /barwarden-0\.1\.0\/vendor\/bitwarden-clients\/UI_SOURCE_COMMIT/);
  assert.doesNotMatch(sourceInventory, /(?:^|\/)\.git(?:\/|$)|node_modules|\/target\/|\/dist\//);
  const extracted = join(fixture.root, "extracted-app");
  mkdirSync(extracted);
  execFileSync("tar", ["-xzf", join(fixture.root, first.paths[0]), "-C", extracted]);
  const extractedExecutable = join(extracted, "Barwarden.app/Contents/MacOS/barwarden");
  assert.equal(statSync(extractedExecutable).mode & 0o777, 0o755);
  assert.equal(
    sha256File(extractedExecutable),
    sha256File(join(fixture.root, fixture.artifacts.executable)),
  );
  const checksum = readFileSync(join(fixture.root, fixture.checksumsPath), "utf8");
  const lines = checksum.trim().split("\n");
  assert.deepEqual(lines, [...lines].sort((left, right) => left.slice(67).localeCompare(right.slice(67))));
  assert.equal(lines.length, 11);
  execFileSync("shasum", ["-a", "256", "-c", fixture.checksumsPath], {
    cwd: fixture.root,
    stdio: "ignore",
  });
});

test("excludes previously tracked handoff artifacts from the source archive", (t) => {
  const fixture = createFixture(t, { trackedDist: true });

  const result = handoff.generateV1Handoff(fixture.options);
  const sourceInventory = execFileSync("tar", ["-tzf", join(fixture.root, result.paths[2])], {
    encoding: "utf8",
  });

  assert.doesNotMatch(sourceInventory, /\/dist\//);
});

test("fails closed when the candidate DMG no longer matches the M16 report", (t) => {
  const fixture = createFixture(t);
  writeFileSync(join(fixture.root, fixture.artifacts.dmg), "mutated dmg\n");

  assert.throws(() => handoff.generateV1Handoff(fixture.options), /dmg identity/i);
});

test("rejects an app with an additional executable payload before writing handoff artifacts", (t) => {
  const fixture = createFixture(t);
  const staleExecutable = join(fixture.root, fixture.artifacts.app, "Contents/MacOS/legacy");
  writeFileSync(staleExecutable, "stale executable\n");
  chmodSync(staleExecutable, 0o755);
  const report = JSON.parse(readFileSync(join(fixture.root, fixture.reportPath), "utf8"));
  report.artifacts.app.sha256 = sha256Tree(join(fixture.root, fixture.artifacts.app));
  writeFileSync(join(fixture.root, fixture.reportPath), `${JSON.stringify(report, null, 2)}\n`);

  assert.throws(
    () => handoff.generateV1Handoff(fixture.options),
    /unexpected executable payload/i,
  );
  assert.equal(existsSync(join(fixture.root, "dist")), false);
});

test("fails closed when the machine report omits controller evidence", (t) => {
  const fixture = createFixture(t);
  const report = JSON.parse(readFileSync(join(fixture.root, fixture.reportPath), "utf8"));
  delete report.gates;
  writeFileSync(join(fixture.root, fixture.reportPath), `${JSON.stringify(report, null, 2)}\n`);

  assert.throws(() => handoff.generateV1Handoff(fixture.options), /report|field|gate/i);
});

test("does not copy artifacts without a passed hardened macOS bundle gate", (t) => {
  const fixture = createFixture(t);
  const report = JSON.parse(readFileSync(join(fixture.root, fixture.reportPath), "utf8"));
  report.gates.find(({ name }) => name === "macos-bundle-audit").status = "failed";
  writeFileSync(join(fixture.root, fixture.reportPath), `${JSON.stringify(report, null, 2)}\n`);

  assert.throws(() => handoff.generateV1Handoff(fixture.options), /report|gate status/i);
  assert.equal(existsSync(join(fixture.root, "dist")), false);
});

test("fails closed when replay evidence is only a schema shell", (t) => {
  const fixture = createFixture(t);
  writeFileSync(join(fixture.root, fixture.replayPath), '{"schema":"m16-live-native-replay-v1"}\n');

  assert.throws(() => handoff.generateV1Handoff(fixture.options), /replay/i);
});

test("fails closed when replay Markdown status or evidence drifts from JSON", (t) => {
  const fixture = createFixture(t);
  const report = JSON.parse(readFileSync(join(fixture.root, fixture.reportPath), "utf8"));
  const replay = JSON.parse(readFileSync(join(fixture.root, fixture.replayPath), "utf8"));
  const markdown = readFileSync(join(fixture.root, fixture.resultPath), "utf8").replace(
    "| `live.cloud-us.auth-token` | `skipped_external` | `credentials_absent` |",
    "| `live.cloud-us.auth-token` | `passed` | `fabricated-evidence` |",
  );

  assert.throws(() => handoff.assertHandoffReplay(replay, report, markdown), /replay.*row/i);
});

test("fails closed when any required evidence file is absent", (t) => {
  const fixture = createFixture(t);
  rmSync(join(fixture.root, "docs/superpowers/specs/2026-07-22-v1-installation.md"));

  assert.throws(() => handoff.generateV1Handoff(fixture.options), /evidence.*absent/i);
});

test("fails closed when commits after the candidate change product source", (t) => {
  const fixture = createFixture(t);
  writeFileSync(join(fixture.root, "product.ts"), "changed\n");
  execFileSync("git", ["add", "product.ts"], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "product drift"], { cwd: fixture.root });

  assert.throws(() => handoff.generateV1Handoff(fixture.options), /post-candidate source drift/i);
});

test("fails closed when uncommitted product source changes after the candidate", (t) => {
  const fixture = createFixture(t);
  writeFileSync(join(fixture.root, "product.ts"), "uncommitted drift\n");

  assert.throws(() => handoff.generateV1Handoff(fixture.options), /worktree source drift/i);
});

test("permits only final machine and replay evidence after the candidate", (t) => {
  const fixture = createFixture(t);
  const replayPath = "docs/superpowers/specs/2026-07-22-m16-live-native-replay.json";
  const resultPath = "docs/superpowers/specs/2026-07-22-m16-live-native-result.md";
  const replay = JSON.parse(readFileSync(join(fixture.root, replayPath), "utf8"));
  writeFileSync(join(fixture.root, replayPath), `${JSON.stringify(replay, null, 2)}\n\n`);
  writeFileSync(
    join(fixture.root, resultPath),
    `${readFileSync(join(fixture.root, resultPath), "utf8")}\n`,
  );
  execFileSync("git", ["add", replayPath, resultPath], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "replay evidence"], { cwd: fixture.root });

  assert.doesNotThrow(() => handoff.generateV1Handoff(fixture.options));
});

function createFixture(t, { trackedDist = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "m16-handoff-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Fixture"], { cwd: root });
  mkdirSync(join(root, "vendor/bitwarden-clients"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "dist/\napps/**/target/\n");
  writeFileSync(join(root, "package.json"), '{"version":"0.1.0","license":"GPL-3.0-only"}\n');
  writeFileSync(join(root, "LICENSE"), "GPL-3.0-only\n");
  writeFileSync(join(root, "NOTICE.md"), "Independent Bitwarden attribution\n");
  writeFileSync(
    join(root, "vendor/bitwarden-clients/UI_SOURCE_COMMIT"),
    "f47b6946e01aed474875789081966d311d5b8289\n",
  );
  writeFileSync(join(root, "product.ts"), "candidate\n");
  const requiredStaticEvidence = [
    "docs/superpowers/screenshots/m16-release-candidate-2026-07-22/manifest.json",
    "docs/superpowers/specs/2026-07-22-v1-release-evidence-index.md",
    "docs/superpowers/specs/2026-07-22-v1-supported-excluded-features.md",
    "docs/superpowers/specs/2026-07-22-v1-installation.md",
    "docs/superpowers/specs/2026-07-22-v1-overlay-inventory.md",
  ];
  for (const path of requiredStaticEvidence) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), path.endsWith(".json") ? "{}\n" : "# Fixture evidence\n");
  }
  execFileSync("git", ["add", "."], { cwd: root });
  if (trackedDist) {
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist/previous-handoff.dmg"), "previous handoff\n");
    execFileSync("git", ["add", "-f", "dist/previous-handoff.dmg"], { cwd: root });
  }
  execFileSync("git", ["commit", "-qm", "candidate"], { cwd: root });
  const sourceRevision = command(root, "git", ["rev-parse", "HEAD"]);

  const artifacts = {
    app: "apps/menubar-tauri/src-tauri/target/release/bundle/macos/Barwarden.app",
    executable: "apps/menubar-tauri/src-tauri/target/release/bundle/macos/Barwarden.app/Contents/MacOS/barwarden",
    infoPlist: "apps/menubar-tauri/src-tauri/target/release/bundle/macos/Barwarden.app/Contents/Info.plist",
    dmg: "apps/menubar-tauri/src-tauri/target/release/bundle/dmg/Barwarden_0.1.0_aarch64.dmg",
  };
  mkdirSync(join(root, artifacts.executable, ".."), { recursive: true });
  mkdirSync(join(root, artifacts.dmg, ".."), { recursive: true });
  writeFileSync(join(root, artifacts.executable), "binary\n");
  chmodSync(join(root, artifacts.executable), 0o755);
  writeFileSync(join(root, artifacts.infoPlist), "plist\n");
  writeFileSync(join(root, artifacts.dmg), "dmg\n");
  const reportPath = "docs/superpowers/specs/2026-07-22-m16-machine-verification.json";
  mkdirSync(join(root, reportPath, ".."), { recursive: true });
  const gates = controller.defaultGates.map((gate) => ({
    name: gate.name,
    status: "passed",
    counts: {
      passed: gate.summaryKind && gate.summaryKind !== "status" ? 1 : 0,
      failed: 0,
      skipped: 0,
    },
  }));
  const aggregate = gates.reduce((result, gate) => ({
    gatesPassed: result.gatesPassed + 1,
    gatesFailed: 0,
    testsPassed: result.testsPassed + gate.counts.passed,
    testsFailed: 0,
    testsSkipped: 0,
  }), { gatesPassed: 0, gatesFailed: 0, testsPassed: 0, testsFailed: 0, testsSkipped: 0 });
  const report = {
    schema: "m16-release-candidate-verification-v1",
    status: "local_verification_passed_with_external_blockers",
    sourceRevision,
    vendorRevision: "f47b6946e01aed474875789081966d311d5b8289",
    packageJsonSha256: sha256File(join(root, "package.json")),
    product: {
      name: "Barwarden",
      identifier: "com.sommir.barwarden",
      version: "0.1.0",
      minimumMacosVersion: "13.0",
    },
    artifacts: {
      app: { path: artifacts.app, sha256: sha256Tree(join(root, artifacts.app)) },
      executable: { path: artifacts.executable, sha256: sha256File(join(root, artifacts.executable)) },
      infoPlist: { path: artifacts.infoPlist, sha256: sha256File(join(root, artifacts.infoPlist)) },
      dmg: { path: artifacts.dmg, sha256: sha256File(join(root, artifacts.dmg)) },
    },
    gates,
    aggregate,
    externalBlockers: [
      "apple_release_credentials_absent",
      "second_display_absent",
      "clean_user_session_absent",
      "disposable_second_account_absent",
      "accessibility_confirmation_required",
      "live_service_inputs_absent",
    ],
  };
  writeFileSync(join(root, reportPath), `${JSON.stringify(report, null, 2)}\n`);
  const replayPath = "docs/superpowers/specs/2026-07-22-m16-live-native-replay.json";
  const replay = {
    schema: "m16-live-native-replay-v1",
    candidate: {
      machineReportPath: reportPath,
      sourceRevision,
      executableSha256: report.artifacts.executable.sha256,
      dmgSha256: report.artifacts.dmg.sha256,
    },
    rows: replayValidator.expectedReplayRowIds.map((id) => ({
      id,
      domain: id.startsWith("live.") ? "live" : "native",
      status: "skipped_external",
      reasonCode: id.startsWith("live.") ? "credentials_absent" : "built_app_observation_absent",
    })),
  };
  writeFileSync(join(root, replayPath), `${JSON.stringify(replay, null, 2)}\n`);
  const resultPath = "docs/superpowers/specs/2026-07-22-m16-live-native-result.md";
  writeFileSync(join(root, resultPath), replayMarkdown(replay));
  execFileSync("git", ["add", reportPath, replayPath, resultPath], { cwd: root });
  execFileSync("git", ["commit", "-qm", "report"], { cwd: root });
  const checksumsPath = "docs/superpowers/specs/2026-07-22-v1-release-checksums.txt";
  return {
    root,
    sourceRevision,
    artifacts,
    reportPath,
    replayPath: "docs/superpowers/specs/2026-07-22-m16-live-native-replay.json",
    resultPath: "docs/superpowers/specs/2026-07-22-m16-live-native-result.md",
    checksumsPath,
    options: { root, reportPath, checksumsPath },
  };
}

function replayMarkdown(replay) {
  const identities = [
    replay.candidate.sourceRevision,
    replay.candidate.executableSha256,
    replay.candidate.dmgSha256,
  ].map((value) => `\`${value}\``).join("\n");
  const rows = replay.rows.map((row) => {
    const detail = row.status === "passed"
      ? `${row.evidence.kind}:${row.evidence.reference}`
      : row.reasonCode;
    return `| \`${row.id}\` | \`${row.status}\` | \`${detail}\` |`;
  }).join("\n");
  return `# Sanitized replay\n\n${identities}\n\n| Row | Status | Reason or evidence |\n| --- | --- | --- |\n${rows}\n`;
}

function artifactHashes(root, paths) {
  return Object.fromEntries(paths.map((path) => [path, sha256File(join(root, path))]));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Tree(root) {
  const hash = createHash("sha256");
  for (const path of walk(root)) {
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

function walk(root) {
  return readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(root, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error("fixture symlink");
      return stat.isDirectory() ? [path, ...walk(path)] : [path];
    });
}

function command(root, file, args) {
  return execFileSync(file, args, { cwd: root, encoding: "utf8" }).trim();
}
