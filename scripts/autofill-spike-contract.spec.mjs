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
const upstreamChromeExtensionId = "nngceckbapebfimnlniiiahkandclblb";
const upstreamEdgeExtensionId = "jbkfoedolllekgbhcbcoahefnbanhhlh";

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
      teamId: "K7LY92JY96",
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

test("accepts the signed native identity while browser publication is deferred", () => {
  const contract = loadAutoFillSpikeContract(process.cwd(), { requireTeamIdentity: true });
  assert.equal(contract.teamId, "K7LY92JY96");
  assert.deepEqual(contract.chromium, { chromeExtensionId: null, edgeExtensionId: null });
});

test("browser release mode still rejects deferred IDs", () => {
  assert.throws(
    () => loadAutoFillSpikeContract(process.cwd(), { requireBrowserReleaseIdentities: true }),
    /browser release identities/,
  );
});

test("rejects a contract that diverges from the production app identity", () => {
  const root = createFixture((contract) => ({
    ...contract,
    components: { ...contract.components, app: { bundleId: "com.example.wrong" } },
  }));

  assert.throws(() => loadAutoFillSpikeContract(root), /com\.sommir\.barwarden/);
});

test("rejects a native team identity that is not Barwarden's verified Team ID", () => {
  const root = createFixture((contract) => ({ ...contract, teamId: "ABCDEFGHIJ" }));

  assert.throws(() => loadAutoFillSpikeContract(root), /K7LY92JY96/);
});

test("rejects partial browser release identities", () => {
  const root = createFixture((contract) => ({
    ...contract,
    chromium: { chromeExtensionId: fixtureChromeExtensionId, edgeExtensionId: null },
  }));

  assert.throws(() => loadAutoFillSpikeContract(root), /browser release identities/);
});

test("rejects upstream Bitwarden browser store IDs in a complete release identity triple", () => {
  for (const chromium of [
    { chromeExtensionId: upstreamChromeExtensionId, edgeExtensionId: "cccccccccccccccccccccccccccccccc" },
    { chromeExtensionId: "dddddddddddddddddddddddddddddddd", edgeExtensionId: upstreamEdgeExtensionId },
  ]) {
    const root = createFixture((contract) => ({
      ...contract,
      chromium,
    }));

    assert.throws(() => loadAutoFillSpikeContract(root), /forbidden/);
  }
});

test("requires a concrete team ID and exactly null deferred browser IDs", () => {
  for (const values of [
    { teamId: "", chromium: { chromeExtensionId: null, edgeExtensionId: null } },
    { teamId: null, chromium: { chromeExtensionId: "", edgeExtensionId: null } },
    { teamId: "K7LY92JY96", chromium: { chromeExtensionId: null, edgeExtensionId: "" } },
  ]) {
    const root = createFixture((contract) => ({ ...contract, ...values }));

    assert.throws(() => loadAutoFillSpikeContract(root), /(?:team identity|browser release identities)/);
  }
});


test("release identity writer rejects forbidden fixture and duplicate extension IDs before signing lookup", () => {
  const writer = resolve(process.cwd(), "scripts/record-autofill-release-identities.mjs");
  const fixtureResult = spawnSync(
    process.execPath,
    [writer, fixtureChromeExtensionId, fixtureEdgeExtensionId],
    { encoding: "utf8" },
  );
  const duplicateResult = spawnSync(
    process.execPath,
    [writer, "cccccccccccccccccccccccccccccccc", "cccccccccccccccccccccccccccccccc"],
    { encoding: "utf8" },
  );

  assert.notEqual(fixtureResult.status, 0);
  assert.match(fixtureResult.stderr, /forbidden/);
  assert.notEqual(duplicateResult.status, 0);
  assert.match(duplicateResult.stderr, /notStrictEqual/);
});

test("release identity writer rejects upstream Bitwarden store IDs before signing lookup", () => {
  const writer = resolve(process.cwd(), "scripts/record-autofill-release-identities.mjs");
  const chromeResult = spawnSync(
    process.execPath,
    [writer, upstreamChromeExtensionId, "cccccccccccccccccccccccccccccccc"],
    { encoding: "utf8" },
  );
  const edgeResult = spawnSync(
    process.execPath,
    [writer, "dddddddddddddddddddddddddddddddd", upstreamEdgeExtensionId],
    { encoding: "utf8" },
  );

  assert.notEqual(chromeResult.status, 0);
  assert.match(chromeResult.stderr, /forbidden/);
  assert.notEqual(edgeResult.status, 0);
  assert.match(edgeResult.stderr, /forbidden/);
});

test("browser identity writer refuses a caller-supplied Team ID", () => {
  const writer = resolve(process.cwd(), "scripts/record-autofill-release-identities.mjs");
  const result = spawnSync(
    process.execPath,
    [writer, "K7LY92JY96", fixtureChromeExtensionId, fixtureEdgeExtensionId],
    { encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exactly two browser extension IDs/);
});
