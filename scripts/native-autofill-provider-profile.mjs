import { createHash, timingSafeEqual, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function reject(reason = "PROFILE_RULES") {
  throw new Error(`NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID_${reason}`);
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

function extractRequiredPlistValue(path, keyPath, format, reason) {
  try {
    return extractPlistValue(path, keyPath, format);
  } catch {
    reject(`PLIST_${reason}`);
  }
}

function extractRequiredPlistArray(path, keyPath, reason) {
  const values = [];
  for (let index = 0; index < 128; index += 1) {
    try {
      values.push(extractPlistValue(path, `${keyPath}.${index}`, "raw"));
    } catch {
      break;
    }
  }
  if (values.length === 0) {
    reject(`PLIST_${reason}`);
  }
  return values;
}

function parseRequiredJson(value, reason) {
  try {
    return JSON.parse(value);
  } catch {
    reject(`PLIST_${reason}`);
  }
}

function extractRequiredJsonPlistValue(path, keyPath, reason) {
  const root = mkdtempSync(join(tmpdir(), "barwarden-provider-plist-value-"));
  const extractedPath = join(root, "value.plist");
  try {
    execFileSync("/usr/bin/plutil", [
      "-extract", keyPath, "xml1", "-o", extractedPath, path,
    ], { stdio: "ignore" });
    return parseRequiredJson(
      execFileSync("/usr/bin/plutil", [
        "-convert", "json", "-o", "-", extractedPath,
      ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }),
      reason,
    );
  } catch (error) {
    if (error?.message?.startsWith("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID_")) {
      throw error;
    }
    reject(`PLIST_${reason}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function decodeCmsProfile(path) {
  const root = mkdtempSync(join(tmpdir(), "barwarden-provider-profile-"));
  const decodedPath = join(root, "profile.plist");
  try {
    execFileSync("/usr/bin/security", [
      "cms", "-D", "-u", "4", "-i", path, "-o", decodedPath,
    ], { stdio: "ignore" });
    const decoded = readFileSync(decodedPath);
    const xmlStart = decoded.indexOf("<?xml");
    if (
      xmlStart > 0
      && xmlStart <= 64
      && decoded.subarray(0, xmlStart).every((byte) =>
        byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x20)
    ) {
      writeFileSync(decodedPath, decoded.subarray(xmlStart), { mode: 0o600 });
    }
    return {
      path: decodedPath,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
  } catch {
    rmSync(root, { recursive: true, force: true });
    reject("CMS_DECODE");
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
    const provisionsAllDevices = extractRequiredPlistValue(
      decoded.path,
      "ProvisionsAllDevices",
      "raw",
      "PROVISIONS_ALL_DEVICES",
    );
    return {
      TeamIdentifier: extractRequiredPlistArray(
        decoded.path,
        "TeamIdentifier",
        "TEAM_IDENTIFIER",
      ),
      ProvisionsAllDevices: /^(?:1|true|yes)$/iu.test(provisionsAllDevices),
      ExpirationDate: extractRequiredPlistValue(
        decoded.path,
        "ExpirationDate",
        "raw",
        "EXPIRATION_DATE",
      ),
      DeveloperCertificates: developerCertificates,
      Entitlements: extractRequiredJsonPlistValue(
        decoded.path,
        "Entitlements",
        "ENTITLEMENTS",
      ),
    };
  } catch (error) {
    if (error?.message?.startsWith("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID_")) {
      throw error;
    }
    reject("PLIST_PARSE");
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
      reject("SIGNER_RULES");
    }
    const signerKey = publicKeyHash(signer);
    const certificateMatchesSigner = profile.DeveloperCertificates.some((encoded) => {
      const candidateDer = Buffer.from(encoded, "base64");
      const candidate = new X509Certificate(candidateDer);
      const exactCertificate = candidateDer.length === signerDer.length && timingSafeEqual(candidateDer, signerDer);
      const candidateKey = publicKeyHash(candidate);
      return exactCertificate && candidateKey.length === signerKey.length && timingSafeEqual(candidateKey, signerKey);
    });
    if (!certificateMatchesSigner) reject("CERTIFICATE_MATCH");

    return {
      applicationIdentifierKey: "com.apple.application-identifier",
      certificateMatchesSigner,
      entitlementKeys: keys,
    };
  } catch (error) {
    if (error?.message?.startsWith("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID_")) throw error;
    reject();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 4) reject();
    const profile = loadNativeAutoFillProviderProfile(process.argv[2]);
    const summary = validateNativeAutoFillProviderProfile(profile, readFileSync(process.argv[3]));
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    console.error(
      error?.message?.startsWith("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID_")
        ? error.message
        : "NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID_PROFILE_RULES",
    );
    process.exit(1);
  }
}
