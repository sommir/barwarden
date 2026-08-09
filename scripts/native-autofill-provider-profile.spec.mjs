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

test("accepts absent, exact, or Team-wildcard App Group authorization", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-profile-groups-"));
  try {
    const signer = certificate(root, "signer");
    const absent = profile(signer);
    delete absent.Entitlements["com.apple.security.application-groups"];
    const wildcard = profile(signer);
    wildcard.Entitlements["com.apple.security.application-groups"] = ["K7LY92JY96.*"];
    assert.doesNotThrow(() => validateNativeAutoFillProviderProfile(absent, signer));
    assert.doesNotThrow(() => validateNativeAutoFillProviderProfile(profile(signer), signer));
    assert.doesNotThrow(() => validateNativeAutoFillProviderProfile(wildcard, signer));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts wildcard app authorization and safe Apple-standard profile extras", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-profile-standard-"));
  try {
    const signer = certificate(root, "signer");
    const value = profile(signer);
    value.Entitlements["com.apple.application-identifier"] = "K7LY92JY96.*";
    value.Entitlements["keychain-access-groups"] = ["K7LY92JY96.*"];
    value.Entitlements["get-task-allow"] = false;
    assert.doesNotThrow(() => validateNativeAutoFillProviderProfile(value, signer));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects wrong team, app, capability, expiry, dangerous entitlement, and signer", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-profile-reject-"));
  try {
    const signer = certificate(root, "signer");
    const other = certificate(root, "other");
    const mutations = [
      (value) => { value.TeamIdentifier = ["OTHERTEAM1"]; },
      (value) => { value.Entitlements["com.apple.application-identifier"] = "K7LY92JY96.com.example.other"; },
      (value) => { value.Entitlements["com.apple.developer.authentication-services.autofill-credential-provider"] = false; },
      (value) => { value.ExpirationDate = new Date(Date.now() - 1_000).toISOString(); },
      (value) => { value.Entitlements["com.apple.developer.networking.networkextension"] = ["packet-tunnel-provider"]; },
    ];
    for (const mutate of mutations) {
      const value = profile(signer);
      mutate(value);
      assert.throws(() => validateNativeAutoFillProviderProfile(value, signer), /NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID/);
    }
    assert.throws(() => validateNativeAutoFillProviderProfile(profile(other), signer), /NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
