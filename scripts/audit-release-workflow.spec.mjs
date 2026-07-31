import assert from "node:assert/strict";
import test from "node:test";

import { auditReleaseWorkflow } from "./audit-release-workflow.mjs";

const checkoutSha = "a".repeat(40);
const setupNodeSha = "b".repeat(40);
const releaseSha = "c".repeat(40);

const safeWorkflow = `name: Release
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
jobs:
  verify:
    runs-on: macos-14
    steps:
      - uses: actions/checkout@${checkoutSha} # v4
      - uses: actions/setup-node@${setupNodeSha} # v4
  release:
    needs: verify
    runs-on: macos-14
    environment: release
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@${checkoutSha} # v4
      - name: Build signed update artifacts
        env:
          BARWARDEN_UPDATER_PUBKEY: \${{ secrets.BARWARDEN_UPDATER_PUBKEY }}
          TAURI_SIGNING_PRIVATE_KEY: \${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: \${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          APPLE_CERTIFICATE: \${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: \${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_API_ISSUER: \${{ secrets.APPLE_API_ISSUER }}
          APPLE_API_KEY: \${{ secrets.APPLE_API_KEY }}
          APPLE_API_KEY_BASE64: \${{ secrets.APPLE_API_KEY_BASE64 }}
        run: |
          api_key_path="$RUNNER_TEMP/notary-api-key.p8"
          printf '%s' "$APPLE_API_KEY_BASE64" | base64 --decode > "$api_key_path"
          APPLE_API_KEY_PATH="$api_key_path" npm run tauri:build:update
          codesign --verify --deep --strict Barwarden.app
          xcrun stapler validate Barwarden.dmg
          spctl -a -vvv -t open --context context:primary-signature Barwarden.dmg
      - name: Publish release
        uses: softprops/action-gh-release@${releaseSha} # v2
`;

test("accepts a least-privilege release workflow", () => {
  assert.deepEqual(auditReleaseWorkflow(safeWorkflow), []);
});

test("rejects workflow-wide write permission", () => {
  const unsafe = safeWorkflow.replace("contents: read", "contents: write");

  assert.match(
    auditReleaseWorkflow(unsafe).join("\n"),
    /workflow permissions must set contents to read/,
  );
});

test("rejects a mutable third-party Action reference", () => {
  const unsafe = safeWorkflow.replace(`actions/checkout@${checkoutSha}`, "actions/checkout@v4");

  assert.match(
    auditReleaseWorkflow(unsafe).join("\n"),
    /actions\/checkout must use a full commit SHA/,
  );
});

test("requires the protected release environment", () => {
  const unsafe = safeWorkflow.replace("    environment: release\n", "");

  assert.match(
    auditReleaseWorkflow(unsafe).join("\n"),
    /release job must use the release environment/,
  );
});

test("rejects signing secrets outside the named build step", () => {
  const unsafe = safeWorkflow.replace(
    "    environment: release\n",
    "    environment: release\n    env:\n      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}\n",
  );

  assert.match(
    auditReleaseWorkflow(unsafe).join("\n"),
    /TAURI_SIGNING_PRIVATE_KEY must be scoped to the Build signed update artifacts step/,
  );
});

test("requires every Apple signing and notarization secret", () => {
  const unsafe = safeWorkflow.replace(
    "          APPLE_API_KEY_BASE64: ${{ secrets.APPLE_API_KEY_BASE64 }}\n",
    "",
  );

  assert.match(
    auditReleaseWorkflow(unsafe).join("\n"),
    /APPLE_API_KEY_BASE64 must be provided to the signed build step/,
  );
});

test("requires signed artifacts to pass notarization and Gatekeeper verification", () => {
  const unsafe = safeWorkflow
    .replace("          codesign --verify --deep --strict Barwarden.app\n", "")
    .replace("          xcrun stapler validate Barwarden.dmg\n", "")
    .replace(
      "          spctl -a -vvv -t open --context context:primary-signature Barwarden.dmg\n",
      "",
    );

  assert.match(
    auditReleaseWorkflow(unsafe).join("\n"),
    /release build must verify Developer ID signing/,
  );
  assert.match(
    auditReleaseWorkflow(unsafe).join("\n"),
    /release build must validate the stapled notarization ticket/,
  );
  assert.match(
    auditReleaseWorkflow(unsafe).join("\n"),
    /release build must pass Gatekeeper assessment/,
  );
});

test("rejects secrets in the verification job", () => {
  const unsafe = safeWorkflow.replace(
    "  verify:\n    runs-on: macos-14",
    "  verify:\n    runs-on: macos-14\n    env:\n      TOKEN: ${{ secrets.UNSAFE_TOKEN }}",
  );

  assert.match(
    auditReleaseWorkflow(unsafe).join("\n"),
    /verify job must not reference repository secrets/,
  );
});
