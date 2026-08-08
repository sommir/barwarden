import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadAutoFillSpikeContract } from "./autofill-spike-contract.mjs";

const fixtureRoots = [];
const fixtureChromeExtensionId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const fixtureEdgeExtensionId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function write(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(contents, null, 2)}\n`);
}

function createFixture(mutator = (value) => value) {
  const root = mkdtempSync(join(tmpdir(), "barwarden-autofill-contract-"));
  fixtureRoots.push(root);
  write(root, "package.json", { version: "0.1.2" });
  write(root, "apps/menubar-tauri/src-tauri/tauri.conf.json", {
    identifier: "com.sommir.barwarden",
    bundle: { macOS: { minimumSystemVersion: "13.0" } },
  });
  write(
    root,
    "config/autofill-spike-contract.json",
    mutator({
      schemaVersion: 1,
      productVersion: "0.1.2",
      appGroup: "group.com.sommir.barwarden.autofill",
      teamId: null,
      deploymentTarget: "13.0",
      components: {
        app: { bundleId: "com.sommir.barwarden" },
        credentialProvider: { bundleId: "com.sommir.barwarden.credential-provider" },
        safariExtension: { bundleId: "com.sommir.barwarden.safari-web-extension" },
        agent: { bundleId: "com.sommir.barwarden.autofill-agent" },
        nativeMessagingHost: { bundleId: "com.sommir.barwarden.native-messaging" },
      },
      chromium: { chromeExtensionId: null, edgeExtensionId: null },
    }),
  );
  return root;
}

test.after(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { force: true, recursive: true });
  }
});

test("locks the nested bundle identity and macOS floor", () => {
  const contract = loadAutoFillSpikeContract(process.cwd());
  assert.equal(contract.appGroup, "group.com.sommir.barwarden.autofill");
  assert.equal(contract.deploymentTarget, "13.0");
  assert.deepEqual(
    Object.values(contract.components).map(({ bundleId }) => bundleId),
    [
      "com.sommir.barwarden",
      "com.sommir.barwarden.credential-provider",
      "com.sommir.barwarden.safari-web-extension",
      "com.sommir.barwarden.autofill-agent",
      "com.sommir.barwarden.native-messaging",
    ],
  );
});

test("requires the signing team and distinct Chrome and Edge store IDs", (context) => {
  const structural = loadAutoFillSpikeContract(process.cwd());
  if (!structural.teamId || !structural.chromium.chromeExtensionId || !structural.chromium.edgeExtensionId) {
    context.skip("official release identities have not been recorded");
    return;
  }
  const contract = loadAutoFillSpikeContract(process.cwd(), { requireReleaseIdentities: true });
  assert.match(contract.teamId, /^[A-Z0-9]{10}$/);
  assert.match(contract.chromium.chromeExtensionId, /^[a-p]{32}$/);
  assert.match(contract.chromium.edgeExtensionId, /^[a-p]{32}$/);
  assert.notEqual(contract.chromium.chromeExtensionId, contract.chromium.edgeExtensionId);
});

test("rejects a contract that diverges from the production app identity", () => {
  const root = createFixture((contract) => ({
    ...contract,
    components: { ...contract.components, app: { bundleId: "com.example.wrong" } },
  }));

  assert.throws(() => loadAutoFillSpikeContract(root), /com\.sommir\.barwarden/);
});

test("rejects partial release identities", () => {
  const root = createFixture((contract) => ({
    ...contract,
    teamId: "ABCDEFGHIJ",
  }));

  assert.throws(() => loadAutoFillSpikeContract(root), /release identities/);
});

test("release identity writer rejects fixture and duplicate extension IDs before signing lookup", () => {
  const writer = resolve(process.cwd(), "scripts/record-autofill-release-identities.mjs");
  const fixtureResult = spawnSync(
    process.execPath,
    [writer, "ABCDEFGHIJ", fixtureChromeExtensionId, fixtureEdgeExtensionId],
    { encoding: "utf8" },
  );
  const duplicateResult = spawnSync(
    process.execPath,
    [writer, "ABCDEFGHIJ", "cccccccccccccccccccccccccccccccc", "cccccccccccccccccccccccccccccccc"],
    { encoding: "utf8" },
  );

  assert.notEqual(fixtureResult.status, 0);
  assert.match(fixtureResult.stderr, /fixture/);
  assert.notEqual(duplicateResult.status, 0);
  assert.match(duplicateResult.stderr, /notStrictEqual/);
});
