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
  });
  return root;
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
