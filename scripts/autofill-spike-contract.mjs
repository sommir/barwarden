import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expectedBundleIds = {
  app: "com.sommir.barwarden",
  credentialProvider: "com.sommir.barwarden.credential-provider",
  safariExtension: "com.sommir.barwarden.safari-web-extension",
  agent: "com.sommir.barwarden.autofill-agent",
  nativeMessagingHost: "com.sommir.barwarden.native-messaging",
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertReleaseIdentities(value) {
  assert.match(value.teamId, /^[A-Z0-9]{10}$/);
  assert.match(value.chromium.chromeExtensionId, /^[a-p]{32}$/);
  assert.match(value.chromium.edgeExtensionId, /^[a-p]{32}$/);
  assert.notEqual(value.chromium.chromeExtensionId, value.chromium.edgeExtensionId);
}

export function loadAutoFillSpikeContract(root, options = {}) {
  const value = readJson(resolve(root, "config/autofill-spike-contract.json"));
  const packageJson = readJson(resolve(root, "package.json"));
  const tauriConfig = readJson(resolve(root, "apps/menubar-tauri/src-tauri/tauri.conf.json"));

  assert.equal(value.schemaVersion, 1);
  assert.equal(value.productVersion, packageJson.version);
  assert.equal(tauriConfig.identifier, expectedBundleIds.app);
  assert.equal(value.components.app.bundleId, tauriConfig.identifier);
  assert.equal(value.appGroup, "group.com.sommir.barwarden.autofill");
  assert.equal(value.deploymentTarget, "13.0");
  assert.equal(value.deploymentTarget, tauriConfig.bundle.macOS.minimumSystemVersion);
  assert.deepEqual(Object.keys(value.components), Object.keys(expectedBundleIds));
  for (const [name, bundleId] of Object.entries(expectedBundleIds)) {
    assert.equal(value.components[name].bundleId, bundleId);
  }
  assert.equal(new Set(Object.values(value.components).map((entry) => entry.bundleId)).size, 5);
  assert.deepEqual(Object.keys(value.chromium), ["chromeExtensionId", "edgeExtensionId"]);

  const releaseIdentityCount = [
    value.teamId,
    value.chromium.chromeExtensionId,
    value.chromium.edgeExtensionId,
  ].filter(Boolean).length;
  assert.ok(releaseIdentityCount === 0 || releaseIdentityCount === 3, "release identities must be all absent or all present");
  if (options.requireReleaseIdentities) {
    assertReleaseIdentities(value);
  }

  return Object.freeze(value);
}
