import assert from "node:assert/strict";
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

test("native app entitlements expose only the exact App Group", () => {
  const entitlements = readFileSync(nativeEntitlements, "utf8");
  assert.match(entitlements, /K7LY92JY96\.com\.sommir\.barwarden\.autofill/);
  assert.doesNotMatch(entitlements, /keychain-access-groups/);
  assert.doesNotMatch(entitlements, /autofill-credential-provider/);
  assert.doesNotMatch(entitlements, /app-sandbox/);
});
