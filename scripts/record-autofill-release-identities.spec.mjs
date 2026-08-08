import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { loadAutoFillSpikeContract } from "./autofill-spike-contract.mjs";
import { recordAutoFillBrowserIdentities } from "./record-autofill-release-identities.mjs";

const fixtureRoots = [];

function write(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(contents, null, 2)}\n`);
}

function createContractFixture() {
  const root = mkdtempSync(join(tmpdir(), "barwarden-autofill-browser-identities-"));
  fixtureRoots.push(root);
  write(root, "package.json", { version: "0.1.2" });
  write(root, "apps/menubar-tauri/src-tauri/tauri.conf.json", {
    identifier: "com.sommir.barwarden",
    bundle: { macOS: { minimumSystemVersion: "13.0" } },
  });
  write(root, "config/autofill-spike-contract.json", {
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
  });
  return root;
}

test.after(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { force: true, recursive: true });
  }
});

test("records allowed browser IDs while preserving the verified native Team ID", () => {
  const root = createContractFixture();
  const contractPath = join(root, "config/autofill-spike-contract.json");
  const calls = [];
  const fileSystem = {
    writeFileSync(path, contents, options) {
      calls.push(`write:${path}`);
      writeFileSync(path, contents, options);
    },
    renameSync(fromPath, toPath) {
      calls.push(`rename:${fromPath}:${toPath}`);
      renameSync(fromPath, toPath);
    },
    rmSync(path, options) {
      calls.push(`remove:${path}`);
      rmSync(path, options);
    },
  };
  const signingCalls = [];
  const chromium = {
    chromeExtensionId: "cccccccccccccccccccccccccccccccc",
    edgeExtensionId: "dddddddddddddddddddddddddddddddd",
  };

  recordAutoFillBrowserIdentities(root, Object.values(chromium), (command, arguments_) => {
    signingCalls.push({ command, arguments_ });
    return "Developer ID Application: Barwarden (K7LY92JY96)";
  }, fileSystem);

  const temporaryPath = `${contractPath}.${process.pid}.tmp`;
  assert.deepEqual(signingCalls, [{
    command: "security",
    arguments_: ["find-identity", "-v", "-p", "codesigning"],
  }]);
  assert.deepEqual(calls, [
    `write:${temporaryPath}`,
    `rename:${temporaryPath}:${contractPath}`,
  ]);
  const contract = loadAutoFillSpikeContract(root, { requireBrowserReleaseIdentities: true });
  assert.equal(contract.teamId, "K7LY92JY96");
  assert.deepEqual(contract.chromium, chromium);
});

test("rejects the former three-argument browser identity form", () => {
  const root = createContractFixture();

  assert.throws(
    () => recordAutoFillBrowserIdentities(root, ["K7LY92JY96", "cccccccccccccccccccccccccccccccc", "dddddddddddddddddddddddddddddddd"]),
    /exactly two browser extension IDs/,
  );
});
