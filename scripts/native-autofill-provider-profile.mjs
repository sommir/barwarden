import { createHash, timingSafeEqual, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const TEAM_ID = "K7LY92JY96";
const APP_GROUP = "K7LY92JY96.com.sommir.barwarden.autofill";
const BUNDLE_ID = "com.sommir.barwarden.credential-provider";
const REQUIRED_ENTITLEMENT_KEYS = [
  "com.apple.application-identifier",
  "com.apple.developer.authentication-services.autofill-credential-provider",
  "com.apple.developer.team-identifier",
];
const OPTIONAL_STANDARD_ENTITLEMENT_KEYS = new Set([
  "com.apple.security.application-groups",
  "com.apple.security.app-sandbox",
  "get-task-allow",
  "keychain-access-groups",
]);

function reject() {
  throw new Error("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID");
}

function exactArray(value, expected) {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function authorizesTeamValue(value, exact) {
  return value === exact || value === `${TEAM_ID}.*`;
}

function authorizedGroupList(value) {
  return value === undefined || exactArray(value, [APP_GROUP]) || exactArray(value, [`${TEAM_ID}.*`]);
}

function authorizedKeychainGroups(value) {
  return value === undefined || (Array.isArray(value) && value.length > 0
    && value.every((item) => typeof item === "string" && authorizesTeamValue(item, `${TEAM_ID}.${BUNDLE_ID}`)));
}

function publicKeyHash(certificate) {
  return createHash("sha256")
    .update(certificate.publicKey.export({ format: "der", type: "spki" }))
    .digest();
}

function extractPlistValue(path, keyPath, format) {
  return execFileSync("/usr/bin/plutil", [
    "-extract", keyPath, format, "-o", "-", path,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function decodeCmsProfile(path) {
  const root = mkdtempSync(join(tmpdir(), "barwarden-provider-profile-"));
  const decodedPath = join(root, "profile.plist");
  try {
    execFileSync("/usr/bin/security", [
      "cms", "-D", "-i", path, "-o", decodedPath,
    ], { stdio: "ignore" });
    return {
      path: decodedPath,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
  } catch {
    rmSync(root, { recursive: true, force: true });
    reject();
  }
}

export function loadNativeAutoFillProviderProfile(
  path,
  { decodeProfile = decodeCmsProfile } = {},
) {
  let decoded;
  try {
    decoded = decodeProfile(path);
    if (typeof decoded?.path !== "string" || typeof decoded?.cleanup !== "function") {
      reject();
    }
    const developerCertificates = [];
    for (let index = 0; index < 128; index += 1) {
      try {
        developerCertificates.push(
          extractPlistValue(decoded.path, `DeveloperCertificates.${index}`, "raw"),
        );
      } catch {
        break;
      }
    }
    const provisionsAllDevices = extractPlistValue(
      decoded.path,
      "ProvisionsAllDevices",
      "raw",
    );
    return {
      TeamIdentifier: JSON.parse(
        extractPlistValue(decoded.path, "TeamIdentifier", "json"),
      ),
      ProvisionsAllDevices: /^(?:1|true|yes)$/iu.test(provisionsAllDevices),
      ExpirationDate: extractPlistValue(decoded.path, "ExpirationDate", "raw"),
      DeveloperCertificates: developerCertificates,
      Entitlements: JSON.parse(
        extractPlistValue(decoded.path, "Entitlements", "json"),
      ),
    };
  } catch {
    reject();
  } finally {
    try {
      decoded?.cleanup();
    } catch {
      // Cleanup errors must not replace a validation result.
    }
  }
}

export function validateNativeAutoFillProviderProfile(profile, signerCertificateDer) {
  try {
    const entitlements = profile?.Entitlements;
    const keys = Object.keys(entitlements ?? {}).sort();
    const entitlementInventoryValid = REQUIRED_ENTITLEMENT_KEYS.every((key) => keys.includes(key))
      && keys.every((key) => REQUIRED_ENTITLEMENT_KEYS.includes(key) || OPTIONAL_STANDARD_ENTITLEMENT_KEYS.has(key));
    if (
      !exactArray(profile?.TeamIdentifier, [TEAM_ID]) ||
      profile?.ProvisionsAllDevices !== true ||
      !(Date.parse(profile?.ExpirationDate) > Date.now()) ||
      !entitlementInventoryValid ||
      !authorizesTeamValue(entitlements["com.apple.application-identifier"], `${TEAM_ID}.${BUNDLE_ID}`) ||
      entitlements["com.apple.developer.team-identifier"] !== TEAM_ID ||
      entitlements["com.apple.developer.authentication-services.autofill-credential-provider"] !== true ||
      ("com.apple.security.app-sandbox" in entitlements &&
        entitlements["com.apple.security.app-sandbox"] !== true) ||
      !authorizedGroupList(entitlements["com.apple.security.application-groups"]) ||
      !authorizedKeychainGroups(entitlements["keychain-access-groups"]) ||
      ("get-task-allow" in entitlements && entitlements["get-task-allow"] !== false) ||
      !Array.isArray(profile?.DeveloperCertificates) ||
      profile.DeveloperCertificates.length === 0
    ) {
      reject();
    }

    const signerDer = Buffer.from(signerCertificateDer);
    const signer = new X509Certificate(signerDer);
    const now = Date.now();
    if (
      !(Date.parse(signer.validFrom) <= now && Date.parse(signer.validTo) > now) ||
      !new RegExp(`(?:^|\\n)OU=${TEAM_ID}(?:$|\\n)`, "u").test(signer.subject) ||
      !/(?:^|\n)CN=Developer ID Application:/u.test(signer.subject)
    ) {
      reject();
    }
    const signerKey = publicKeyHash(signer);
    const certificateMatchesSigner = profile.DeveloperCertificates.some((encoded) => {
      const candidateDer = Buffer.from(encoded, "base64");
      const candidate = new X509Certificate(candidateDer);
      const exactCertificate = candidateDer.length === signerDer.length && timingSafeEqual(candidateDer, signerDer);
      const candidateKey = publicKeyHash(candidate);
      return exactCertificate && candidateKey.length === signerKey.length && timingSafeEqual(candidateKey, signerKey);
    });
    if (!certificateMatchesSigner) reject();

    return {
      applicationIdentifierKey: "com.apple.application-identifier",
      certificateMatchesSigner,
      entitlementKeys: keys,
    };
  } catch (error) {
    if (error?.message === "NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID") throw error;
    reject();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 4) reject();
    const profile = loadNativeAutoFillProviderProfile(process.argv[2]);
    const summary = validateNativeAutoFillProviderProfile(profile, readFileSync(process.argv[3]));
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch {
    console.error("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID");
    process.exit(1);
  }
}
