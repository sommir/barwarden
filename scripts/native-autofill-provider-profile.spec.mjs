import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadNativeAutoFillProviderProfile,
  validateNativeAutoFillProviderProfile,
} from "./native-autofill-provider-profile.mjs";

test("loads provisioning profile date and certificate data without lossy whole-plist JSON conversion", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-profile-plist-"));
  let cleaned = false;
  try {
    const plistPath = join(root, "profile.plist");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>TeamIdentifier</key><array><string>K7LY92JY96</string></array>
  <key>ProvisionsAllDevices</key><true/>
  <key>ExpirationDate</key><date>2099-01-01T00:00:00Z</date>
  <key>DeveloperCertificates</key><array><data>AQID</data><data>BAUG</data></array>
  <key>Entitlements</key><dict><key>com.apple.security.app-sandbox</key><true/></dict>
</dict></plist>\n`;
    writeFileSync(plistPath, plist);

    assert.deepEqual(loadNativeAutoFillProviderProfile(plistPath, {
      decodeProfile: (sourcePath) => ({
        path: sourcePath,
        cleanup: () => { cleaned = true; },
      }),
    }), {
      TeamIdentifier: ["K7LY92JY96"],
      ProvisionsAllDevices: true,
      ExpirationDate: "2099-01-01T00:00:00Z",
      DeveloperCertificates: ["AQID", "BAUG"],
      Entitlements: { "com.apple.security.app-sandbox": true },
    });
    assert.equal(cleaned, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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

function cmsProfile(root, certificateDer) {
  const key = join(root, "cms-signer.key");
  const certificatePem = join(root, "cms-signer.pem");
  const identity = join(root, "cms-signer.p12");
  const keychain = join(root, "cms-signer.keychain-db");
  const plist = join(root, "provider.plist");
  const signedProfile = join(root, "provider.provisionprofile");
  execFileSync("/usr/bin/openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=Profile Fixture/O=Fixture/C=US",
    "-keyout", key, "-out", certificatePem,
  ], { stdio: "ignore" });
  writeFileSync(plist, `\r\n<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>TeamIdentifier</key><array><string>K7LY92JY96</string></array>
  <key>ProvisionsAllDevices</key><true/>
  <key>ExpirationDate</key><date>${new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d{3}Z$/u, "Z")}</date>
  <key>DeveloperCertificates</key><array><data>${certificateDer.toString("base64")}</data></array>
  <key>Entitlements</key><dict>
    <key>com.apple.application-identifier</key><string>K7LY92JY96.com.sommir.barwarden.credential-provider</string>
    <key>com.apple.developer.authentication-services.autofill-credential-provider</key><true/>
    <key>com.apple.developer.team-identifier</key><string>K7LY92JY96</string>
  </dict>
</dict></plist>\n`);
  execFileSync("/usr/bin/openssl", [
    "pkcs12", "-export", "-inkey", key, "-in", certificatePem,
    "-out", identity, "-passout", "pass:fixture",
  ], { stdio: "ignore" });
  execFileSync("/usr/bin/security", ["create-keychain", "-p", "fixture", keychain]);
  try {
    execFileSync("/usr/bin/security", ["unlock-keychain", "-p", "fixture", keychain]);
    execFileSync("/usr/bin/security", [
      "import", identity, "-k", keychain, "-P", "fixture", "-T", "/usr/bin/security",
    ], { stdio: "ignore" });
    execFileSync("/usr/bin/security", [
      "cms", "-S", "-N", "Profile Fixture", "-k", keychain,
      "-i", plist, "-o", signedProfile,
    ], { stdio: "ignore" });
  } finally {
    execFileSync("/usr/bin/security", ["delete-keychain", keychain], { stdio: "ignore" });
  }
  return signedProfile;
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

test("loads and validates a real CMS-wrapped provisioning profile", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-profile-cms-"));
  try {
    const signer = certificate(root, "provider-signer");
    const signedProfile = cmsProfile(root, signer);
    assert.deepEqual(
      validateNativeAutoFillProviderProfile(
        loadNativeAutoFillProviderProfile(signedProfile),
        signer,
      ),
      {
        applicationIdentifierKey: "com.apple.application-identifier",
        certificateMatchesSigner: true,
        entitlementKeys: [
          "com.apple.application-identifier",
          "com.apple.developer.authentication-services.autofill-credential-provider",
          "com.apple.developer.team-identifier",
        ],
      },
    );
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

test("accepts a Developer ID profile that leaves sandbox enforcement to the signed extension", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-profile-sandbox-"));
  try {
    const signer = certificate(root, "signer");
    const value = profile(signer);
    delete value.Entitlements["com.apple.security.app-sandbox"];
    assert.doesNotThrow(() => validateNativeAutoFillProviderProfile(value, signer));
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
