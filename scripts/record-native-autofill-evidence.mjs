import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { NATIVE_AUTOFILL_RELEASE_CODES } from "./native-autofill-release-codes.mjs";
import { readReleaseVersion } from "./release-version.mjs";

const PRODUCT_VERSION = readReleaseVersion();

const LIVE_KEYS = [
  "freshInstallCurrent",
  "updateCurrent",
  "providerEnablement",
  "supportedField",
  "unsupportedField",
  "exactMatch",
  "fuzzyMatch",
  "fullSearch",
  "axDenied",
  "axGranted",
  "lock",
  "reprompt",
  "accountSwitch",
  "logout",
  "appRestart",
  "agentRestart",
  "offline",
  "staleGeneration",
];
const CODE = /^NATIVE_AUTOFILL_[A-Z0-9_]+$/u;
const HASH = /^[a-f0-9]{64}$/u;
const PASS_CODES = [
  "NATIVE_AUTOFILL_RELEASE_VERIFIER_PASS",
  "NATIVE_AUTOFILL_CURRENT_LIVE_MATRIX_PASS",
  "NATIVE_AUTOFILL_PRODUCTION_PROMOTED",
];

export function createBlockedNativeAutoFillEvidence({ osVersion }) {
  return {
    schemaVersion: 2,
    status: "BLOCKED",
    productVersion: PRODUCT_VERSION,
    teamId: "K7LY92JY96",
    osVersion,
    productionPromoted: false,
    artifactHashes: { appSha256: null, dmgSha256: null },
    codes: [
      "NATIVE_AUTOFILL_TOOLING_IMPLEMENTED",
      "NATIVE_AUTOFILL_SIGNING_IDENTITY_MISSING",
      "NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING",
      "NATIVE_AUTOFILL_NOTARY_PROFILE_MISSING",
      "NATIVE_AUTOFILL_SIGNED_ARTIFACT_MISSING",
      "NATIVE_AUTOFILL_CURRENT_GUI_SESSION_BLOCKED_LOGINWINDOW",
      "NATIVE_AUTOFILL_PRODUCTION_NOT_PROMOTED",
    ],
    lowerOsRuntime: "NATIVE_AUTOFILL_LOWER_OS_RUNTIME_UNVERIFIED",
    liveMatrix: Object.fromEntries(
      LIVE_KEYS.map((key) => [key, "NATIVE_AUTOFILL_LIVE_BLOCKED_NO_RELEASE_ARTIFACT"]),
    ),
  };
}

export function assertNativeAutoFillEvidence(evidence) {
  const invalid =
    evidence?.schemaVersion !== 2 ||
    !["PASS", "BLOCKED"].includes(evidence?.status) ||
    evidence?.productVersion !== PRODUCT_VERSION ||
    evidence?.teamId !== "K7LY92JY96" ||
    typeof evidence?.productionPromoted !== "boolean" ||
    !/^[0-9]+(?:\.[0-9]+){1,2}$/u.test(evidence?.osVersion ?? "") ||
    !Array.isArray(evidence?.codes) ||
    evidence.codes.length === 0 ||
    new Set(evidence.codes).size !== evidence.codes.length ||
    evidence.codes.some((code) => !CODE.test(code) || !NATIVE_AUTOFILL_RELEASE_CODES.has(code)) ||
    evidence?.lowerOsRuntime !== "NATIVE_AUTOFILL_LOWER_OS_RUNTIME_UNVERIFIED" ||
    JSON.stringify(Object.keys(evidence?.liveMatrix ?? {})) !== JSON.stringify(LIVE_KEYS) ||
    Object.values(evidence.liveMatrix).some(
      (code) => !CODE.test(code) || !NATIVE_AUTOFILL_RELEASE_CODES.has(code),
    );
  if (invalid) throw new Error("NATIVE_AUTOFILL_EVIDENCE_INVALID");

  const appHash = evidence.artifactHashes?.appSha256;
  const dmgHash = evidence.artifactHashes?.dmgSha256;
  if (appHash !== null && !HASH.test(appHash)) throw new Error("NATIVE_AUTOFILL_EVIDENCE_INVALID");
  if (dmgHash !== null && !HASH.test(dmgHash)) throw new Error("NATIVE_AUTOFILL_EVIDENCE_INVALID");
  if (evidence.status === "PASS") {
    if (
      !HASH.test(appHash ?? "") ||
      !HASH.test(dmgHash ?? "") ||
      !/^26(?:\.[0-9]+){1,2}$/u.test(evidence.osVersion) ||
      evidence.productionPromoted !== true ||
      JSON.stringify(evidence.codes) !== JSON.stringify(PASS_CODES) ||
      Object.values(evidence.liveMatrix).some((code) => code !== "NATIVE_AUTOFILL_LIVE_PASS")
    ) {
      throw new Error("NATIVE_AUTOFILL_EVIDENCE_PASS_INVALID");
    }
  }
  return evidence;
}

function markdownFor(evidence) {
  const hash = (value) => value ?? "unavailable";
  const codes = evidence.codes.map((code) => `- \`${code}\``).join("\n");
  const matrix = Object.entries(evidence.liveMatrix)
    .map(([scenario, code]) => `| ${scenario} | \`${code}\` |`)
    .join("\n");
  return `# Native AutoFill release evidence

Status: ${evidence.status}

- Product version: \`${evidence.productVersion}\`
- Team ID: \`${evidence.teamId}\`
- Production promoted: \`${evidence.productionPromoted}\`
- Test OS: \`${evidence.osVersion}\`
- macOS 13–25 runtime: \`${evidence.lowerOsRuntime}\`
- App SHA-256: ${hash(evidence.artifactHashes.appSha256)}
- DMG SHA-256: ${hash(evidence.artifactHashes.dmgSha256)}

## Fixed gate codes

${codes}

## Live matrix

| Scenario | Fixed code |
| --- | --- |
${matrix}
`;
}

function atomicWrite(path, content) {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, content, { mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function writeNativeAutoFillEvidence({ evidence, jsonPath, markdownPath }) {
  assertNativeAutoFillEvidence(evidence);
  atomicWrite(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  atomicWrite(markdownPath, markdownFor(evidence));
}

function main() {
  const mode = process.argv[2];
  const jsonPath = process.argv[3];
  const markdownPath = process.argv[4];
  if (
    mode !== "ARTIFACT_PASS" || process.argv.length !== 5 ||
    !isAbsolute(jsonPath ?? "") || !isAbsolute(markdownPath ?? "") ||
    dirname(jsonPath) !== dirname(markdownPath)
  ) {
    console.error("NATIVE_AUTOFILL_EVIDENCE_MODE_INVALID");
    process.exitCode = 1;
    return;
  }
  try {
    const evidence = createBlockedNativeAutoFillEvidence({
      osVersion: process.env.NATIVE_AUTOFILL_OS_VERSION ?? "0.0",
    });
    evidence.artifactHashes = {
      appSha256: process.env.NATIVE_AUTOFILL_APP_SHA256 ?? null,
      dmgSha256: process.env.NATIVE_AUTOFILL_DMG_SHA256 ?? null,
    };
    evidence.codes = [
      "NATIVE_AUTOFILL_TOOLING_IMPLEMENTED",
      "NATIVE_AUTOFILL_RELEASE_VERIFIER_PASS",
      "NATIVE_AUTOFILL_LIVE_MATRIX_PENDING",
      "NATIVE_AUTOFILL_PRODUCTION_NOT_PROMOTED",
    ];
    writeNativeAutoFillEvidence({
      evidence,
      jsonPath,
      markdownPath,
    });
    console.log("NATIVE_AUTOFILL_EVIDENCE_RECORDED_BLOCKED");
  } catch {
    console.error("NATIVE_AUTOFILL_EVIDENCE_WRITE_FAILED");
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
