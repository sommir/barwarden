import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertBrowserReleaseIdentities,
  assertTeamIdentity,
  hasDeferredBrowserReleaseIdentities,
} from "./autofill-spike-release-identities.mjs";

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

export function loadAutoFillSpikeContract(root, options = {}) {
  const value = readJson(resolve(root, "config/autofill-spike-contract.json"));
  const packageJson = readJson(resolve(root, "package.json"));
  const tauriConfig = readJson(resolve(root, "apps/menubar-tauri/src-tauri/tauri.conf.json"));

  assert.equal(value.schemaVersion, 1);
  assert.equal(value.productVersion, packageJson.version);
  assert.equal(tauriConfig.identifier, expectedBundleIds.app);
  assert.equal(value.components.app.bundleId, tauriConfig.identifier);
  assert.equal(value.appGroup, "K7LY92JY96.com.sommir.barwarden.autofill");
  assert.equal(value.deploymentTarget, "13.0");
  assert.equal(value.deploymentTarget, tauriConfig.bundle.macOS.minimumSystemVersion);
  assert.deepEqual(Object.keys(value.components), Object.keys(expectedBundleIds));
  for (const [name, bundleId] of Object.entries(expectedBundleIds)) {
    assert.equal(value.components[name].bundleId, bundleId);
  }
  assert.equal(new Set(Object.values(value.components).map((entry) => entry.bundleId)).size, 5);
  assert.deepEqual(Object.keys(value.chromium), ["chromeExtensionId", "edgeExtensionId"]);

  assertTeamIdentity(value.teamId);
  if (!hasDeferredBrowserReleaseIdentities(value.chromium)) {
    assertBrowserReleaseIdentities(value.chromium);
  }
  if (options.requireBrowserReleaseIdentities || options.requireReleaseIdentities) {
    assertBrowserReleaseIdentities(value.chromium);
  }

  return Object.freeze(value);
}
