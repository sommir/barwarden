import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function verifyCodesignCommandPolicy(source) {
  const logicalLines = source.replace(/\\\r?\n/gu, " ").split(/\r?\n|;/u);
  for (const line of logicalLines) {
    if (!line.includes("--deep")) continue;
    const isCodesign = /(?:^|\s)\/usr\/bin\/codesign(?:\s|$)/u.test(line);
    const isVerification = /(?:^|\s)--verify(?:\s|$)/u.test(line);
    const isSigning = /(?:^|\s)--sign(?:\s|$)/u.test(line);
    if (!isCodesign || !isVerification || isSigning) {
      throw new Error("NATIVE_AUTOFILL_SIGN_DEEP_FORBIDDEN");
    }
  }
  return true;
}

export function verifyNativeAutoFillBuilderPolicy(source) {
  verifyCodesignCommandPolicy(source);
  const logicalLines = source.replace(/\\\r?\n/gu, " ").split(/\r?\n|;/u);
  const signingArguments = logicalLines.filter(
    (line) => /(?:^|\s)SIGNING_ARGS=\(/u.test(line) && /(?:^|\s)--sign(?:\s|$)/u.test(line),
  );
  const codesignLines = logicalLines.filter((line) =>
    /(?:^|\s)\/usr\/bin\/codesign(?:\s|$)/u.test(line));
  const signingLines = codesignLines.filter(
    (line) =>
      !/(?:^|\s)--verify(?:\s|$)/u.test(line) &&
      !/(?:^|\s)-R(?:\s|$)/u.test(line),
  );
  const notaryArguments = logicalLines.filter((line) =>
    /(?:^|\s)NOTARY_ARGS=\(/u.test(line));
  const notarySubmissions = logicalLines.filter((line) =>
    /(?:^|\s)\/usr\/bin\/xcrun\s+notarytool\s+submit(?:\s|$)/u.test(line));
  const expectedOrder = [
    "NATIVE_AUTOFILL_AGENT_SIGN_FAILED",
    "NATIVE_AUTOFILL_PROVIDER_SIGN_FAILED",
    "NATIVE_AUTOFILL_MAIN_APP_SIGN_FAILED",
    "NATIVE_AUTOFILL_DMG_SIGN_FAILED",
  ];
  if (
    signingArguments.length !== 1 ||
    signingLines.length !== expectedOrder.length ||
    signingLines.some(
      (line, index) =>
        !line.includes('"${SIGNING_ARGS[@]}"') ||
        !line.includes(expectedOrder[index]),
    )
  ) {
    throw new Error("NATIVE_AUTOFILL_SIGN_ORDER_INVALID");
  }
  if (
    !signingLines[0].includes('--identifier "com.sommir.barwarden.autofill-agent"') ||
    signingLines.slice(1).some((line) => /(?:^|\s)--identifier(?:\s|$)/u.test(line))
  ) {
    throw new Error("NATIVE_AUTOFILL_AGENT_IDENTIFIER_INVALID");
  }
  if (
    notarySubmissions.length > 0 && (
      notaryArguments.length !== 1 ||
      !/(?:^|[\s(])--keychain-profile(?:\s|$)/u.test(notaryArguments[0]) ||
      !/(?:^|[\s(])--keychain(?:\s|$)/u.test(notaryArguments[0]) ||
      notarySubmissions.length !== 2 ||
      notarySubmissions.some((line) => !line.includes('"${NOTARY_ARGS[@]}"'))
    )
  ) {
    throw new Error("NATIVE_AUTOFILL_NOTARY_KEYCHAIN_MISSING");
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    if (process.argv.length !== 3) throw new Error("NATIVE_AUTOFILL_ARGUMENT_INVALID");
    verifyNativeAutoFillBuilderPolicy(readFileSync(process.argv[2], "utf8"));
    console.log("NATIVE_AUTOFILL_BUILDER_POLICY_PASS");
  } catch (error) {
    console.error(error?.message?.startsWith("NATIVE_AUTOFILL_") ? error.message : "NATIVE_AUTOFILL_BUILDER_POLICY_INVALID");
    process.exit(1);
  }
}
