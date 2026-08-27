import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("native identity remains the verified Barwarden team and macOS 13 binary floor", () => {
  const contract = JSON.parse(read("config/autofill-spike-contract.json"));
  assert.equal(contract.teamId, "K7LY92JY96");
  assert.equal(contract.appGroup, "K7LY92JY96.com.sommir.barwarden.autofill");
  assert.equal(contract.deploymentTarget, "13.0");
  assert.equal(contract.components.app.bundleId, "com.sommir.barwarden");
  assert.equal(contract.components.credentialProvider.bundleId, "com.sommir.barwarden.credential-provider");
  assert.equal(contract.components.agent.bundleId, "com.sommir.barwarden.autofill-agent");
});

test("native identity contract keeps browser publication deferred", () => {
  const contract = JSON.parse(read("config/autofill-spike-contract.json"));
  assert.deepEqual(contract.chromium, { chromeExtensionId: null, edgeExtensionId: null });
});
