import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  verifyCodesignCommandPolicy,
  verifyCodesignRequirementPolicy,
} from "./native-autofill-builder-policy.mjs";

export function verifyNativeAutoFillLocalSmokePolicy(source) {
  verifyCodesignCommandPolicy(source);
  verifyCodesignRequirementPolicy(source, 4);

  if (!source.includes('[[ "${NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY:-0}" == 1 ]]')) {
    throw new Error("NATIVE_AUTOFILL_LOCAL_SMOKE_GATE_INVALID");
  }
  if (!source.includes('LOCAL_APP_NAME="Barwarden Local Smoke.app"')) {
    throw new Error("NATIVE_AUTOFILL_LOCAL_OUTPUT_CONTRACT_INVALID");
  }
  if (
    !source.includes('.tauri-native-autofill-local.json.XXXXXX" 2>/dev/null)" || fail NATIVE_AUTOFILL_LOCAL_TEMP_CREATE_FAILED') ||
    !source.includes('/private/tmp/barwarden-native-local-smoke.XXXXXX 2>/dev/null)" || fail NATIVE_AUTOFILL_LOCAL_TEMP_CREATE_FAILED')
  ) {
    throw new Error("NATIVE_AUTOFILL_LOCAL_TEMP_CONTRACT_INVALID");
  }

  const forbiddenReleaseOperations = [
    /(?:^|\s)(?:\/usr\/bin\/)?xcrun\s+(?:notarytool|stapler)(?:\s|$)/mu,
    /(?:^|\s)(?:\/usr\/bin\/)?hdiutil(?:\s|$)/mu,
    /native-autofill-atomic-promotion\.mjs/u,
    /record-native-autofill-evidence\.mjs/u,
    /verify-native-autofill-bundle\.sh/u,
    /NATIVE_AUTOFILL_PRODUCTION_PROMOTED/u,
    /NATIVE_AUTOFILL_RELEASE_(?:BUILD|GATE|VERIFIER)_PASS/u,
    /\.dmg(?:\s|["'])/u,
  ];
  if (forbiddenReleaseOperations.some((pattern) => pattern.test(source))) {
    throw new Error("NATIVE_AUTOFILL_LOCAL_SMOKE_RELEASE_OPERATION_FORBIDDEN");
  }

  const logicalLines = source.replace(/\\\r?\n/gu, " ").split(/\r?\n|;/u);
  const signingArguments = logicalLines.filter(
    (line) => /(?:^|\s)SIGNING_ARGS=\(/u.test(line) && /(?:^|\s)--sign(?:\s|$)/u.test(line),
  );
  const signingLines = logicalLines.filter(
    (line) =>
      /(?:^|\s)\/usr\/bin\/codesign(?:\s|$)/u.test(line) &&
      !/(?:^|\s)--verify(?:\s|$)/u.test(line) &&
      !/(?:^|\s)-R(?:\s|$)/u.test(line),
  );
  const order = [
    "NATIVE_AUTOFILL_LOCAL_AGENT_SIGN_FAILED",
    "NATIVE_AUTOFILL_LOCAL_PROVIDER_SIGN_FAILED",
    "NATIVE_AUTOFILL_LOCAL_APP_SIGN_FAILED",
  ];
  if (
    signingArguments.length !== 1 ||
    signingLines.length !== order.length ||
    signingLines.some((line, index) =>
      !line.includes('"${SIGNING_ARGS[@]}"') || !line.includes(order[index]))
  ) {
    throw new Error("NATIVE_AUTOFILL_SIGN_ORDER_INVALID");
  }
  if (/(?:^|[\s(])--identifier(?:\s|$)/u.test(signingArguments[0])) {
    throw new Error("NATIVE_AUTOFILL_SIGNING_ARGS_IDENTIFIER_FORBIDDEN");
  }
  if (
    !signingLines[0].includes('--identifier "com.sommir.barwarden.autofill-agent"') ||
    signingLines.slice(1).some((line) => /(?:^|\s)--identifier(?:\s|$)/u.test(line))
  ) {
    throw new Error("NATIVE_AUTOFILL_AGENT_IDENTIFIER_INVALID");
  }
  if (
    !source.includes('/usr/bin/codesign --verify --strict --verbose=2 "$OUTPUT_APP"') ||
    !source.includes('/usr/bin/codesign --verify --deep --strict --verbose=2 "$OUTPUT_APP"')
  ) {
    throw new Error("NATIVE_AUTOFILL_LOCAL_OUTPUT_VERIFY_MISSING");
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    if (process.argv.length !== 3) throw new Error("NATIVE_AUTOFILL_ARGUMENT_INVALID");
    verifyNativeAutoFillLocalSmokePolicy(readFileSync(process.argv[2], "utf8"));
    console.log("NATIVE_AUTOFILL_LOCAL_SMOKE_POLICY_PASS");
  } catch (error) {
    console.error(
      error?.message?.startsWith("NATIVE_AUTOFILL_")
        ? error.message
        : "NATIVE_AUTOFILL_BUILDER_POLICY_INVALID",
    );
    process.exit(1);
  }
}
