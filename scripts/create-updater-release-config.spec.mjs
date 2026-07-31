import assert from "node:assert/strict";
import test from "node:test";

import { createReleaseConfig } from "./create-updater-release-config.mjs";

const baseConfig = { bundle: { active: true, targets: ["app", "dmg"] } };
const endpoint = "https://github.com/acme/barwarden/releases/latest/download/latest.json";

test("creates a GitHub-only updater configuration", () => {
  const config = createReleaseConfig({ baseConfig, endpoint, pubkey: "dGVzdA==" });

  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.equal(config.plugins.updater.pubkey, "dGVzdA==");
  assert.deepEqual(config.plugins.updater.endpoints, [endpoint]);
});

test("rejects a missing public key and non-GitHub endpoint", () => {
  assert.throws(() => createReleaseConfig({ baseConfig, endpoint, pubkey: "" }), /public key/i);
  assert.throws(() => createReleaseConfig({
    baseConfig,
    endpoint: "https://example.test/latest.json",
    pubkey: "dGVzdA==",
  }), /GitHub Releases/i);
});
