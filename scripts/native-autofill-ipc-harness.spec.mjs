import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harness = path.join(root, "scripts", "run-native-autofill-ipc-harness.sh");

async function executable(filePath, source) {
  await writeFile(filePath, source, { mode: 0o755 });
  await chmod(filePath, 0o755);
}

async function fakeDeveloperDirectory(fixture, name, marker, exitStatus) {
  const developerDirectory = path.join(fixture, name);
  const bin = path.join(developerDirectory, "usr", "bin");
  await mkdir(bin, { recursive: true });
  await mkdir(path.join(developerDirectory, "Platforms", "MacOSX.platform"), { recursive: true });
  await executable(path.join(bin, "xcodebuild"), `#!/bin/sh
printf selected > '${marker}'
exit ${exitStatus}
`);
  return developerDirectory;
}

function runHarness(environment) {
  const mergedEnvironment = {
    ...process.env,
    RUN_SIGNED_AUTOFILL_IPC_HARNESS: "1",
    AUTOFILL_SIGNING_IDENTITY: "test-only-identity",
    ...environment,
  };
  for (const [key, value] of Object.entries(mergedEnvironment)) {
    if (value === undefined) delete mergedEnvironment[key];
  }
  return spawnSync(harness, [], {
    cwd: root,
    encoding: "utf8",
    env: mergedEnvironment,
  });
}

test("default invocation skips before requiring Xcode or a signing identity", () => {
  const environment = {
    ...process.env,
    RUN_SIGNED_AUTOFILL_IPC_HARNESS: "0",
    DEVELOPER_DIR: "/missing/developer/directory",
    XCODE_SELECT: "/missing/xcode-select",
  };
  delete environment.AUTOFILL_SIGNING_IDENTITY;

  const result = spawnSync(harness, [], { cwd: root, encoding: "utf8", env: environment });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^SKIP:/);
});

test("explicit DEVELOPER_DIR selects its validated xcodebuild", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "barwarden-ipc-xcode-explicit-"));
  const selectedMarker = path.join(fixture, "selected");
  const xcodeSelectMarker = path.join(fixture, "xcode-select-called");
  const developerDirectory = await fakeDeveloperDirectory(
    fixture,
    "ExplicitXcode.app/Contents/Developer",
    selectedMarker,
    41,
  );
  const xcodeSelect = path.join(fixture, "xcode-select");
  await executable(xcodeSelect, `#!/bin/sh
printf called > '${xcodeSelectMarker}'
exit 1
`);

  const result = runHarness({ DEVELOPER_DIR: developerDirectory, XCODE_SELECT: xcodeSelect });

  assert.equal(result.status, 41, result.stderr);
  assert.equal(existsSync(selectedMarker), true);
  assert.equal(existsSync(xcodeSelectMarker), false);
});

test("missing DEVELOPER_DIR uses the overridable xcode-select result", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "barwarden-ipc-xcode-select-"));
  const selectedMarker = path.join(fixture, "selected");
  const developerDirectory = await fakeDeveloperDirectory(
    fixture,
    "SelectedXcode.app/Contents/Developer",
    selectedMarker,
    42,
  );
  const xcodeSelect = path.join(fixture, "xcode-select");
  await executable(xcodeSelect, `#!/bin/sh
printf '%s\n' '${developerDirectory}'
`);
  const result = runHarness({ DEVELOPER_DIR: undefined, XCODE_SELECT: xcodeSelect });

  assert.equal(result.status, 42, result.stderr);
  assert.equal(existsSync(selectedMarker), true);
});

test("opt-in invocation rejects a developer directory without full Xcode", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "barwarden-ipc-xcode-invalid-"));
  const commandLineTools = path.join(fixture, "CommandLineTools");
  await mkdir(commandLineTools);

  const result = runHarness({ DEVELOPER_DIR: commandLineTools });

  assert.equal(result.status, 78);
  assert.match(result.stderr, /full Xcode developer directory/i);
});
