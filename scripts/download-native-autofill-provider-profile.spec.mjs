import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { downloadProviderProfile } from "./download-native-autofill-provider-profile.mjs";

test("downloads the newest active Developer ID provider profile that matches the signer", async () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-provider-profile-"));
  const outputPath = join(root, "provider.provisionprofile");
  const matchingProfile = Buffer.from([0x30, 0x82, 0x01, 0x01]);
  const mismatchedProfile = Buffer.from([0x30, 0x82, 0x01, 0x02]);
  const signerCertificateDer = Buffer.from("signer-certificate");
  const requests = [];
  try {
    await downloadProviderProfile({
      outputPath,
      signerCertificateDer,
      now: new Date("2026-08-28T00:00:00Z"),
      profileMatchesSigner: (profile, signer) =>
        profile.equals(matchingProfile) && signer.equals(signerCertificateDer),
      request: async (path) => {
        requests.push(path);
        if (path.startsWith("/v1/bundleIds?")) {
          return { data: [{ id: "provider-bundle", type: "bundleIds" }] };
        }
        return {
          data: [
            {
              attributes: {
                name: "old",
                profileType: "MAC_APP_DIRECT",
                profileState: "ACTIVE",
                expirationDate: "2027-01-01T00:00:00Z",
                profileContent: matchingProfile.toString("base64"),
              },
            },
            {
              attributes: {
                name: "new",
                profileType: "MAC_APP_DIRECT",
                profileState: "ACTIVE",
                expirationDate: "2031-01-01T00:00:00Z",
                profileContent: mismatchedProfile.toString("base64"),
              },
            },
          ],
        };
      },
    });
    assert.deepEqual(readFileSync(outputPath), matchingProfile);
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
    assert.equal(requests.length, 2);
    assert.match(requests[0], /com\.sommir\.barwarden\.credential-provider/);
    assert.match(requests[1], /\/v1\/bundleIds\/provider-bundle\/profiles/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when no active Developer ID provider profile matches the signer", async () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-provider-profile-invalid-"));
  const profile = Buffer.from([0x30, 0x82, 0x01, 0x00]);
  try {
    await assert.rejects(
      downloadProviderProfile({
        outputPath: join(root, "provider.provisionprofile"),
        signerCertificateDer: Buffer.from("signer-certificate"),
        now: new Date("2026-08-28T00:00:00Z"),
        profileMatchesSigner: () => false,
        request: async (path) => {
          if (path.startsWith("/v1/bundleIds?")) {
            return { data: [{ id: "provider-bundle" }] };
          }
          if (path.includes("/profiles?")) {
            return {
                data: [{
                  attributes: {
                    profileType: "MAC_APP_DIRECT",
                    profileState: "ACTIVE",
                    expirationDate: "2031-01-01T00:00:00Z",
                    profileContent: profile.toString("base64"),
                  },
                }],
              };
          }
          return { data: [] };
        },
      }),
      /NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("creates a Developer ID provider profile for the exact signer when none exists", async () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-provider-profile-create-"));
  const outputPath = join(root, "provider.provisionprofile");
  const signerCertificateDer = Buffer.from([0x30, 0x82, 0x03, 0x01]);
  const createdProfile = Buffer.from([0x30, 0x82, 0x02, 0x01]);
  const requests = [];
  try {
    await downloadProviderProfile({
      outputPath,
      signerCertificateDer,
      now: new Date("2026-08-28T12:34:56Z"),
      profileMatchesSigner: (profile, signer) =>
        profile.equals(createdProfile) && signer.equals(signerCertificateDer),
      request: async (path, options = {}) => {
        requests.push({ path, options });
        if (path.startsWith("/v1/bundleIds?")) {
          return { data: [{ id: "provider-bundle", type: "bundleIds" }] };
        }
        if (path.includes("/profiles?")) return { data: [] };
        if (path.startsWith("/v1/certificates?")) {
          return {
            data: [
              {
                id: "wrong-certificate",
                type: "certificates",
                attributes: {
                  certificateType: "DEVELOPER_ID_APPLICATION",
                  activated: true,
                  expirationDate: "2031-01-01T00:00:00Z",
                  certificateContent: Buffer.from([0x30, 0x82, 0x03, 0x02]).toString("base64"),
                },
              },
              {
                id: "signer-certificate",
                type: "certificates",
                attributes: {
                  certificateType: "DEVELOPER_ID_APPLICATION",
                  activated: true,
                  expirationDate: "2031-01-01T00:00:00Z",
                  certificateContent: signerCertificateDer.toString("base64"),
                },
              },
            ],
          };
        }
        assert.equal(path, "/v1/profiles");
        assert.equal(options.method, "POST");
        return {
          data: {
            attributes: {
              profileContent: createdProfile.toString("base64"),
            },
          },
        };
      },
    });

    assert.deepEqual(readFileSync(outputPath), createdProfile);
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
    const createRequest = requests.find(({ path }) => path === "/v1/profiles");
    assert.deepEqual(createRequest.options.body, {
      data: {
        type: "profiles",
        attributes: {
          name: "Barwarden AutoFill Release 2026-08-28T12:34:56.000Z",
          profileType: "MAC_APP_DIRECT",
        },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: "provider-bundle" } },
          certificates: {
            data: [{ type: "certificates", id: "signer-certificate" }],
          },
        },
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not create a provider profile without an exact active signer certificate", async () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-provider-profile-no-certificate-"));
  let created = false;
  try {
    await assert.rejects(
      downloadProviderProfile({
        outputPath: join(root, "provider.provisionprofile"),
        signerCertificateDer: Buffer.from([0x30, 0x82, 0x03, 0x01]),
        now: new Date("2026-08-28T00:00:00Z"),
        profileMatchesSigner: () => false,
        request: async (path, options = {}) => {
          if (options.method === "POST") created = true;
          if (path.startsWith("/v1/bundleIds?")) {
            return { data: [{ id: "provider-bundle" }] };
          }
          if (path.includes("/profiles?")) return { data: [] };
          return {
            data: [{
              id: "different-certificate",
              attributes: {
                certificateType: "DEVELOPER_ID_APPLICATION",
                activated: true,
                expirationDate: "2031-01-01T00:00:00Z",
                certificateContent: Buffer.from([0x30, 0x82, 0x03, 0x02]).toString("base64"),
              },
            }],
          };
        },
      }),
      /NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING/,
    );
    assert.equal(created, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
