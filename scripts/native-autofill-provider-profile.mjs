import { createHash, timingSafeEqual, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEAM_ID = "K7LY92JY96";
const APP_GROUP = "K7LY92JY96.com.sommir.barwarden.autofill";
const BUNDLE_ID = "com.sommir.barwarden.credential-provider";
const ENTITLEMENT_KEYS = [
  "com.apple.application-identifier",
  "com.apple.developer.authentication-services.autofill-credential-provider",
  "com.apple.developer.team-identifier",
  "com.apple.security.app-sandbox",
  "com.apple.security.application-groups",
];

function reject() {
  throw new Error("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID");
}

function exactArray(value, expected) {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function publicKeyHash(certificate) {
  return createHash("sha256")
    .update(certificate.publicKey.export({ format: "der", type: "spki" }))
    .digest();
}

export function validateNativeAutoFillProviderProfile(profile, signerCertificateDer) {
  try {
    const entitlements = profile?.Entitlements;
    const keys = Object.keys(entitlements ?? {}).sort();
    if (
      !exactArray(profile?.TeamIdentifier, [TEAM_ID]) ||
      profile?.ProvisionsAllDevices !== true ||
      !(Date.parse(profile?.ExpirationDate) > Date.now()) ||
      !exactArray(keys, ENTITLEMENT_KEYS) ||
      entitlements["com.apple.application-identifier"] !== `${TEAM_ID}.${BUNDLE_ID}` ||
      entitlements["com.apple.developer.team-identifier"] !== TEAM_ID ||
      entitlements["com.apple.developer.authentication-services.autofill-credential-provider"] !== true ||
      entitlements["com.apple.security.app-sandbox"] !== true ||
      !exactArray(entitlements["com.apple.security.application-groups"], [APP_GROUP]) ||
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
      !new RegExp(`(?:^|\\n)OU=${TEAM_ID}(?:$|\\n)`, "u").test(signer.subject)
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
    const profile = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const summary = validateNativeAutoFillProviderProfile(profile, readFileSync(process.argv[3]));
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch {
    console.error("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID");
    process.exit(1);
  }
}
