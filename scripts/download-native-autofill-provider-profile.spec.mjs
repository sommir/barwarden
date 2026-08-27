import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { downloadProviderProfile } from "./download-native-autofill-provider-profile.mjs";

test("downloads the newest active Developer ID provider profile atomically", async () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-provider-profile-"));
  const outputPath = join(root, "provider.provisionprofile");
  const profile = Buffer.from([0x30, 0x82, 0x01, 0x00]);
  const requests = [];
  try {
    await downloadProviderProfile({
      outputPath,
      now: new Date("2026-08-28T00:00:00Z"),
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
                profileContent: profile.toString("base64"),
              },
            },
            {
              attributes: {
                name: "new",
                profileType: "MAC_APP_DIRECT",
                profileState: "ACTIVE",
                expirationDate: "2031-01-01T00:00:00Z",
                profileContent: profile.toString("base64"),
              },
            },
          ],
        };
      },
    });
    assert.deepEqual(readFileSync(outputPath), profile);
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
    assert.equal(requests.length, 2);
    assert.match(requests[0], /com\.sommir\.barwarden\.credential-provider/);
    assert.match(requests[1], /\/v1\/bundleIds\/provider-bundle\/profiles/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed when no valid Developer ID provider profile exists", async () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-provider-profile-invalid-"));
  try {
    await assert.rejects(
      downloadProviderProfile({
        outputPath: join(root, "provider.provisionprofile"),
        now: new Date("2026-08-28T00:00:00Z"),
        request: async (path) =>
          path.startsWith("/v1/bundleIds?")
            ? { data: [{ id: "provider-bundle" }] }
            : { data: [{ attributes: { profileType: "MAC_APP_DIRECT", profileState: "INVALID" } }] },
      }),
      /NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
