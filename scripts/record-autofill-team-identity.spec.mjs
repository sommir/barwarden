import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  inspectDeveloperIdCertificate,
  recordAutoFillTeamIdentity,
} from "./record-autofill-team-identity.mjs";

const fixtureRoots = [];

function write(root, relativePath, contents) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(contents, null, 2)}\n`);
}

function createContractFixture() {
  const root = mkdtempSync(join(tmpdir(), "barwarden-autofill-team-identity-"));
  fixtureRoots.push(root);
  write(root, "config/autofill-spike-contract.json", {
    schemaVersion: 1,
    productVersion: "0.1.2",
    appGroup: "K7LY92JY96.com.sommir.barwarden.autofill",
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
  });
  return root;
}

function createMemoryFileSystem(path, initialContents, { failWrite = false } = {}) {
  const files = new Map([[path, initialContents]]);
  const calls = [];
  return {
    calls,
    files,
    fileSystem: {
      readFileSync(filePath) {
        calls.push(`read:${filePath}`);
        return files.get(filePath);
      },
      writeFileSync(filePath, contents) {
        calls.push(`write:${filePath}`);
        if (failWrite) {
          throw new Error("simulated write failure");
        }
        files.set(filePath, contents);
      },
      renameSync(fromPath, toPath) {
        calls.push(`rename:${fromPath}:${toPath}`);
        files.set(toPath, files.get(fromPath));
        files.delete(fromPath);
      },
      rmSync(filePath) {
        calls.push(`remove:${filePath}`);
        files.delete(filePath);
      },
    },
  };
}

test.after(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { force: true, recursive: true });
  }
});

test("inspects the Developer ID certificate through an injected runner", () => {
  const calls = [];
  const result = inspectDeveloperIdCertificate("/external/developer-id.cer", (command, arguments_) => {
    calls.push({ command, arguments_ });
    return [
      "subject=UID=K7LY92JY96, CN = Developer ID Application: Fixture Developer (K7LY92JY96)",
      "notBefore=Aug  1 00:00:00 2026 GMT",
      "notAfter=Aug  1 00:00:00 2031 GMT",
    ].join("\n");
  });

  assert.deepEqual(result, {
    teamId: "K7LY92JY96",
    commonName: "Developer ID Application: Fixture Developer (K7LY92JY96)",
  });
  assert.deepEqual(calls, [{
    command: "openssl",
    arguments_: ["x509", "-inform", "DER", "-in", "/external/developer-id.cer", "-noout", "-subject", "-dates"],
  }]);
});

test("rejects a certificate whose Developer ID team does not match Barwarden", () => {
  assert.throws(
    () => inspectDeveloperIdCertificate("/external/developer-id.cer", () => "subject=UID=ABCDEFGHIJ, CN = Developer ID Application: Fixture Developer (ABCDEFGHIJ)"),
    /certificate Team ID must be K7LY92JY96/,
  );
});

test("rejects a certificate whose subject Team ID disagrees with its common name", () => {
  assert.throws(
    () => inspectDeveloperIdCertificate(
      "/external/developer-id.cer",
      () => "subject=UID=ABCDEFGHIJ, CN=Developer ID Application: Fixture Developer (K7LY92JY96)",
    ),
    /certificate Team ID must match its common name/,
  );
});

test("records only the inspected team ID without releasing browser identities", () => {
  const root = createContractFixture();
  const result = recordAutoFillTeamIdentity(root, "/external/developer-id.cer", () => (
    "subject=UID=K7LY92JY96, CN = Developer ID Application: Fixture Developer (K7LY92JY96)"
  ));
  const recorded = JSON.parse(readFileSync(join(root, "config/autofill-spike-contract.json"), "utf8"));

  assert.deepEqual(result, {
    teamId: "K7LY92JY96",
    commonName: "Developer ID Application: Fixture Developer (K7LY92JY96)",
  });
  assert.equal(recorded.teamId, "K7LY92JY96");
  assert.deepEqual(recorded.chromium, { chromeExtensionId: null, edgeExtensionId: null });
  assert.equal(statSync(join(root, "config/autofill-spike-contract.json")).mode & 0o777, 0o600);
});

test("writes the inspected Team ID to a temporary file before atomically replacing the contract", () => {
  const root = "/synthetic-team-contract";
  const contractPath = join(root, "config/autofill-spike-contract.json");
  const original = JSON.stringify({ teamId: null, chromium: { chromeExtensionId: null, edgeExtensionId: null } });
  const memory = createMemoryFileSystem(contractPath, original);

  recordAutoFillTeamIdentity(root, "/external/developer-id.cer", () => (
    "subject=UID=K7LY92JY96, CN = Developer ID Application: Fixture Developer (K7LY92JY96)"
  ), memory.fileSystem);

  const temporaryPath = `${contractPath}.${process.pid}.tmp`;
  assert.deepEqual(memory.calls, [
    `read:${contractPath}`,
    `write:${temporaryPath}`,
    `rename:${temporaryPath}:${contractPath}`,
  ]);
  assert.deepEqual(JSON.parse(memory.files.get(contractPath)), {
    teamId: "K7LY92JY96",
    chromium: { chromeExtensionId: null, edgeExtensionId: null },
  });
  assert.equal(memory.files.has(temporaryPath), false);
});

test("preserves the final contract and removes the temporary file when its atomic write fails", () => {
  const root = "/synthetic-team-contract-failure";
  const contractPath = join(root, "config/autofill-spike-contract.json");
  const original = JSON.stringify({ teamId: null, chromium: { chromeExtensionId: null, edgeExtensionId: null } });
  const memory = createMemoryFileSystem(contractPath, original, { failWrite: true });

  assert.throws(
    () => recordAutoFillTeamIdentity(root, "/external/developer-id.cer", () => (
      "subject=UID=K7LY92JY96, CN = Developer ID Application: Fixture Developer (K7LY92JY96)"
    ), memory.fileSystem),
    /simulated write failure/,
  );

  const temporaryPath = `${contractPath}.${process.pid}.tmp`;
  assert.deepEqual(memory.calls, [
    `read:${contractPath}`,
    `write:${temporaryPath}`,
    `remove:${temporaryPath}`,
  ]);
  assert.equal(memory.files.get(contractPath), original);
  assert.equal(memory.files.has(temporaryPath), false);
});
