import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateNativeAutoFillProviderProfile } from "./native-autofill-provider-profile.mjs";

function certificate(root, name, team = "K7LY92JY96") {
  const key = join(root, `${name}.key`);
  const der = join(root, `${name}.der`);
  execFileSync("/usr/bin/openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", `/CN=Developer ID Application: Fixture (${team})/OU=${team}/O=Fixture/C=US`,
    "-keyout", key, "-out", der, "-outform", "DER",
  ], { stdio: "ignore" });
  return readFileSync(der);
}

function profile(certificateDer) {
  return {
    TeamIdentifier: ["K7LY92JY96"],
    ProvisionsAllDevices: true,
    ExpirationDate: new Date(Date.now() + 86_400_000).toISOString(),
    DeveloperCertificates: [certificateDer.toString("base64")],
    Entitlements: {
      "com.apple.application-identifier": "K7LY92JY96.com.sommir.barwarden.credential-provider",
      "com.apple.developer.authentication-services.autofill-credential-provider": true,
      "com.apple.developer.team-identifier": "K7LY92JY96",
      "com.apple.security.app-sandbox": true,
      "com.apple.security.application-groups": ["K7LY92JY96.com.sommir.barwarden.autofill"],
    },
  };
}

test("accepts an exact unexpired Provider profile whose leaf certificate and public key match the signer", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-profile-"));
  try {
    const signer = certificate(root, "signer");
    assert.deepEqual(validateNativeAutoFillProviderProfile(profile(signer), signer), {
      applicationIdentifierKey: "com.apple.application-identifier",
      certificateMatchesSigner: true,
      entitlementKeys: [
        "com.apple.application-identifier",
        "com.apple.developer.authentication-services.autofill-credential-provider",
        "com.apple.developer.team-identifier",
        "com.apple.security.app-sandbox",
        "com.apple.security.application-groups",
      ],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects extra profile capabilities and a signer not present in DeveloperCertificates", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-profile-reject-"));
  try {
    const signer = certificate(root, "signer");
    const other = certificate(root, "other");
    const extra = profile(signer);
    extra.Entitlements["get-task-allow"] = false;
    assert.throws(() => validateNativeAutoFillProviderProfile(extra, signer), /NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID/);
    assert.throws(() => validateNativeAutoFillProviderProfile(profile(other), signer), /NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
