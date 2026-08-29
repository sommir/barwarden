import { createPrivateKey, sign } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadNativeAutoFillProviderProfile,
  validateNativeAutoFillProviderProfile,
} from "./native-autofill-provider-profile.mjs";

const PROVIDER_IDENTIFIER = "com.sommir.barwarden.credential-provider";
const PROFILE_FIELDS = "name,profileType,profileState,profileContent,expirationDate";

function encodedJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createAppleApiRequest({ keyPath, keyId, issuerId, fetchImpl = fetch }) {
  if (!keyPath || !keyId || !issuerId) {
    throw new Error("NATIVE_AUTOFILL_APPLE_API_CREDENTIALS_MISSING");
  }
  const privateKey = createPrivateKey(readFileSync(keyPath));

  return async (path) => {
    if (typeof path !== "string" || !path.startsWith("/v1/")) {
      throw new Error("NATIVE_AUTOFILL_APPLE_API_REQUEST_INVALID");
    }
    const now = Math.floor(Date.now() / 1000);
    const header = encodedJson({ alg: "ES256", kid: keyId, typ: "JWT" });
    const payload = encodedJson({
      iss: issuerId,
      iat: now,
      exp: now + 600,
      aud: "appstoreconnect-v1",
    });
    const signingInput = `${header}.${payload}`;
    const signature = sign(null, Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    }).toString("base64url");
    const response = await fetchImpl(`https://api.appstoreconnect.apple.com${path}`, {
      headers: { Authorization: `Bearer ${signingInput}.${signature}` },
    });
    if (!response.ok) throw new Error("NATIVE_AUTOFILL_APPLE_API_REQUEST_FAILED");
    return response.json();
  };
}

function decodeProfileContent(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID");
  }
  const profile = Buffer.from(value, "base64");
  if (profile.length < 4 || profile[0] !== 0x30) {
    throw new Error("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID");
  }
  return profile;
}

function matchesSigner(profileContent, signerCertificateDer, profilePath) {
  validateNativeAutoFillProviderProfile(
    loadNativeAutoFillProviderProfile(profilePath),
    signerCertificateDer,
  );
  return true;
}

export async function downloadProviderProfile({
  outputPath,
  request,
  signerCertificateDer,
  now = new Date(),
  profileMatchesSigner = matchesSigner,
}) {
  if (
    !isAbsolute(outputPath ?? "") ||
    existsSync(outputPath) ||
    !existsSync(dirname(outputPath)) ||
    lstatSync(dirname(outputPath)).isSymbolicLink()
  ) {
    throw new Error("NATIVE_AUTOFILL_PROVIDER_PROFILE_OUTPUT_INVALID");
  }
  if (!Buffer.isBuffer(signerCertificateDer) || signerCertificateDer.length === 0) {
    throw new Error("NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID");
  }

  const bundleQuery = new URLSearchParams({
    "filter[identifier]": PROVIDER_IDENTIFIER,
    limit: "10",
  });
  const bundles = await request(`/v1/bundleIds?${bundleQuery}`);
  if (bundles?.data?.length !== 1 || !bundles.data[0]?.id) {
    throw new Error("NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING");
  }

  const profileQuery = new URLSearchParams({
    "fields[profiles]": PROFILE_FIELDS,
    limit: "200",
  });
  const profiles = await request(
    `/v1/bundleIds/${encodeURIComponent(bundles.data[0].id)}/profiles?${profileQuery}`,
  );
  const candidates = (profiles?.data ?? [])
    .filter(({ attributes }) =>
      attributes?.profileType === "MAC_APP_DIRECT" &&
      attributes?.profileState === "ACTIVE" &&
      Date.parse(attributes?.expirationDate ?? "") > now.getTime() &&
      typeof attributes?.profileContent === "string")
    .sort((left, right) =>
      Date.parse(right.attributes.expirationDate) - Date.parse(left.attributes.expirationDate));

  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  for (const candidate of candidates) {
    let profileContent;
    try {
      profileContent = decodeProfileContent(candidate.attributes.profileContent);
    } catch {
      continue;
    }
    writeFileSync(temporaryPath, profileContent, { flag: "wx", mode: 0o600 });
    try {
      if (await profileMatchesSigner(profileContent, signerCertificateDer, temporaryPath)) {
        renameSync(temporaryPath, outputPath);
        return;
      }
    } catch {
      // Try the next active profile when this candidate does not match the signer.
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  }
  throw new Error("NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING");
}

async function main() {
  const outputPath = process.argv[2];
  const signerCertificatePath = process.argv[3];
  try {
    if (
      process.argv.length !== 4 ||
      !isAbsolute(signerCertificatePath ?? "") ||
      !existsSync(signerCertificatePath) ||
      lstatSync(signerCertificatePath).isSymbolicLink()
    ) {
      throw new Error("NATIVE_AUTOFILL_ARGUMENT_INVALID");
    }
    const request = createAppleApiRequest({
      keyPath: process.env.APPLE_API_KEY_PATH,
      keyId: process.env.APPLE_API_KEY_ID,
      issuerId: process.env.APPLE_API_ISSUER_ID,
    });
    await downloadProviderProfile({
      outputPath,
      request,
      signerCertificateDer: readFileSync(signerCertificatePath),
    });
    console.log("NATIVE_AUTOFILL_PROVIDER_PROFILE_DOWNLOADED");
  } catch (error) {
    console.error(
      error?.message?.startsWith("NATIVE_AUTOFILL_")
        ? error.message
        : "NATIVE_AUTOFILL_PROVIDER_PROFILE_DOWNLOAD_FAILED",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
