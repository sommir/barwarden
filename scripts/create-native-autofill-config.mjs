import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { writeJsonAtomically } from "./autofill-spike-atomic-write.mjs";
import { createReleaseConfig } from "./create-updater-release-config.mjs";

export function createNativeAutoFillConfig({
  productionConfig,
  productionEntitlements,
  nativeEntitlements,
  output,
  updaterEndpoint,
  updaterPubkey,
}) {
  const resolvedOutput = resolve(output);
  if (
    resolvedOutput === resolve(productionConfig) ||
    resolvedOutput === resolve(productionEntitlements) ||
    resolvedOutput === resolve(nativeEntitlements)
  ) {
    throw new Error("NATIVE_AUTOFILL_CONFIG_OUTPUT_UNSAFE");
  }

  const configBefore = readFileSync(productionConfig);
  const entitlementsBefore = readFileSync(productionEntitlements);
  let config = JSON.parse(configBefore.toString("utf8"));
  if (updaterEndpoint !== undefined || updaterPubkey !== undefined) {
    config = createReleaseConfig({
      baseConfig: config,
      endpoint: updaterEndpoint,
      pubkey: updaterPubkey,
    });
    delete config.bundle.createUpdaterArtifacts;
  }
  config.bundle = { ...config.bundle, targets: ["app"] };
  config.bundle.macOS = {
    ...config.bundle.macOS,
    entitlements: resolve(nativeEntitlements),
  };
  delete config.bundle.macOS.signingIdentity;
  delete config.bundle.macOS.providerShortName;
  writeJsonAtomically(resolvedOutput, config);

  if (
    !readFileSync(productionConfig).equals(configBefore) ||
    !readFileSync(productionEntitlements).equals(entitlementsBefore)
  ) {
    throw new Error("NATIVE_AUTOFILL_PRODUCTION_INPUT_CHANGED");
  }
  return resolvedOutput;
}

function main() {
  if (process.argv.length !== 3) {
    console.error("NATIVE_AUTOFILL_ARGUMENT_INVALID");
    process.exitCode = 64;
    return;
  }
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const root = resolve(scriptDirectory, "..");
  try {
    createNativeAutoFillConfig({
      productionConfig: resolve(root, "apps/menubar-tauri/src-tauri/tauri.conf.json"),
      productionEntitlements: resolve(root, "apps/menubar-tauri/src-tauri/Entitlements.plist"),
      nativeEntitlements: resolve(
        root,
        "apps/menubar-tauri/src-tauri/Entitlements.native-autofill.plist",
      ),
      output: process.argv[2],
      updaterEndpoint: process.env.BARWARDEN_UPDATER_ENDPOINT,
      updaterPubkey: process.env.BARWARDEN_UPDATER_PUBKEY,
    });
    console.log("NATIVE_AUTOFILL_CONFIG_CREATED");
  } catch (error) {
    console.error(error?.message?.startsWith("NATIVE_AUTOFILL_") ? error.message : "NATIVE_AUTOFILL_CONFIG_FAILED");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
