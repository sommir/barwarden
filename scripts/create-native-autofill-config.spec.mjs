import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createNativeAutoFillConfig } from "./create-native-autofill-config.mjs";

const repositoryRoot = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const productionConfig = join(repositoryRoot, "apps/menubar-tauri/src-tauri/tauri.conf.json");
const productionEntitlements = join(repositoryRoot, "apps/menubar-tauri/src-tauri/Entitlements.plist");
const nativeEntitlements = join(
  repositoryRoot,
  "apps/menubar-tauri/src-tauri/Entitlements.native-autofill.plist",
);

test("creates a private native app-only overlay without changing production inputs", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "barwarden-native-config-"));
  const output = join(temporaryRoot, "native-release.json");
  const configBefore = readFileSync(productionConfig);
  const entitlementsBefore = readFileSync(productionEntitlements);
  try {
    createNativeAutoFillConfig({ productionConfig, productionEntitlements, nativeEntitlements, output });
    const generated = JSON.parse(readFileSync(output, "utf8"));
    assert.deepEqual(generated.bundle.targets, ["app"]);
    assert.equal(generated.bundle.macOS.entitlements, nativeEntitlements);
    assert.equal(generated.bundle.macOS.signingIdentity, undefined);
    assert.equal(generated.bundle.macOS.providerShortName, undefined);
    assert.deepEqual(readFileSync(productionConfig), configBefore);
    assert.deepEqual(readFileSync(productionEntitlements), entitlementsBefore);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(generated).includes("provision"));
    assert.ok(!JSON.stringify(generated).includes("notary"));
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("embeds the validated GitHub updater configuration in release overlays", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "barwarden-native-updater-config-"));
  const output = join(temporaryRoot, "native-release.json");
  try {
    createNativeAutoFillConfig({
      productionConfig,
      productionEntitlements,
      nativeEntitlements,
      output,
      updaterEndpoint: "https://github.com/sommir/barwarden/releases/latest/download/latest.json",
      updaterPubkey: "dGVzdA==",
    });
    const generated = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(generated.plugins.updater.pubkey, "dGVzdA==");
    assert.deepEqual(generated.plugins.updater.endpoints, [
      "https://github.com/sommir/barwarden/releases/latest/download/latest.json",
    ]);
    assert.equal(generated.bundle.createUpdaterArtifacts, undefined);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("rejects overwriting either production input", () => {
  assert.throws(
    () =>
      createNativeAutoFillConfig({
        productionConfig,
        productionEntitlements,
        nativeEntitlements,
        output: productionConfig,
      }),
    /NATIVE_AUTOFILL_CONFIG_OUTPUT_UNSAFE/,
  );
  assert.throws(
    () =>
      createNativeAutoFillConfig({
        productionConfig,
        productionEntitlements,
        nativeEntitlements,
        output: productionEntitlements,
      }),
    /NATIVE_AUTOFILL_CONFIG_OUTPUT_UNSAFE/,
  );
});

test("native app entitlements retain browser URL capture alongside the exact App Group", () => {
  const entitlements = JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", nativeEntitlements], {
      encoding: "utf8",
    }),
  );

  assert.deepEqual(entitlements, {
    "com.apple.security.application-groups": ["K7LY92JY96.com.sommir.barwarden.autofill"],
    "com.apple.security.automation.apple-events": true,
  });
});
