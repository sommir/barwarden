import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  assertNativeAutoFillEvidence,
  createBlockedNativeAutoFillEvidence,
  writeNativeAutoFillEvidence,
} from "./record-native-autofill-evidence.mjs";

const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
const evidencePath = join(root, "docs/autofill/native-autofill-evidence.json");
const schemaPath = join(root, "docs/autofill/native-autofill-evidence.schema.json");

test("checked-in evidence is blocked, fixed-code-only, and schema-shaped", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(evidence.status, "BLOCKED");
  assert.equal(evidence.teamId, "K7LY92JY96");
  assert.equal(evidence.productVersion, "0.1.2");
  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.artifactHashes.appSha256, null);
  assert.equal(evidence.artifactHashes.dmgSha256, null);
  assert.equal(evidence.productionPromoted, false);
  assert.equal(evidence.lowerOsRuntime, "NATIVE_AUTOFILL_LOWER_OS_RUNTIME_UNVERIFIED");
  assert.ok(evidence.codes.includes("NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING"));
  assert.ok(evidence.codes.includes("NATIVE_AUTOFILL_NOTARY_ISSUER_ID_MISSING"));
  assert.ok(evidence.codes.includes("NATIVE_AUTOFILL_TEMP_KEYCHAIN_IDENTITY_PASS"));
  assert.ok(!evidence.codes.includes("NATIVE_AUTOFILL_SIGNING_IDENTITY_MISSING"));
  assert.ok(!evidence.codes.includes("NATIVE_AUTOFILL_PRIVATE_KEY_IMPORT_NOT_AUTHORIZED"));
  assert.ok(!evidence.codes.includes("NATIVE_AUTOFILL_XCODE_AUTOMATIC_PROVISIONING_NOT_AUTHORIZED"));
  assertNativeAutoFillEvidence(evidence);
  for (const code of [...evidence.codes, ...Object.values(evidence.liveMatrix)]) {
    assert.match(code, /^NATIVE_AUTOFILL_[A-Z0-9_]+$/);
  }
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /\/(?:Users|private|tmp)\//);
  assert.doesNotMatch(serialized, /\.p8|\.pem|-----BEGIN|password|credentialPath/i);
});

test("blocked evidence names only the current-mac runtime gates and records lower OS as unverified", () => {
  const evidence = createBlockedNativeAutoFillEvidence({ osVersion: "26.6" });
  assert.deepEqual(Object.keys(evidence.liveMatrix), [
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
  ]);
  assert.equal(evidence.lowerOsRuntime, "NATIVE_AUTOFILL_LOWER_OS_RUNTIME_UNVERIFIED");
  assert.ok(Object.values(evidence.liveMatrix).every((code) => code === "NATIVE_AUTOFILL_LIVE_BLOCKED_NO_RELEASE_ARTIFACT"));
});

test("PASS is rejected until artifacts and every live gate pass", () => {
  const evidence = createBlockedNativeAutoFillEvidence({ osVersion: "26.6" });
  evidence.status = "PASS";
  assert.throws(() => assertNativeAutoFillEvidence(evidence), /NATIVE_AUTOFILL_EVIDENCE_PASS_INVALID/);
});

test("fixed-looking but unknown evidence codes are rejected", () => {
  const evidence = createBlockedNativeAutoFillEvidence({ osVersion: "26.6" });
  evidence.codes.push("NATIVE_AUTOFILL_MADE_UP_BLOCKER");
  assert.throws(() => assertNativeAutoFillEvidence(evidence), /NATIVE_AUTOFILL_EVIDENCE_INVALID/);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(evidence), false);
});

test("JSON Schema rejects PASS without full hashes, pass codes, promotion, and a fully passing matrix", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const evidence = createBlockedNativeAutoFillEvidence({ osVersion: "26.6" });
  evidence.status = "PASS";
  assert.equal(validate(evidence), false);
});

test("PASS requires the explicit productionPromoted boolean in both runtime and JSON Schema validation", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const evidence = createBlockedNativeAutoFillEvidence({ osVersion: "26.6" });
  evidence.status = "PASS";
  evidence.artifactHashes = { appSha256: "a".repeat(64), dmgSha256: "b".repeat(64) };
  evidence.codes = [
    "NATIVE_AUTOFILL_RELEASE_VERIFIER_PASS",
    "NATIVE_AUTOFILL_CURRENT_LIVE_MATRIX_PASS",
    "NATIVE_AUTOFILL_PRODUCTION_PROMOTED",
  ];
  evidence.liveMatrix = Object.fromEntries(
    Object.keys(evidence.liveMatrix).map((key) => [key, "NATIVE_AUTOFILL_LIVE_PASS"]),
  );
  evidence.productionPromoted = false;
  assert.throws(() => assertNativeAutoFillEvidence(evidence), /NATIVE_AUTOFILL_EVIDENCE_PASS_INVALID/);
  assert.equal(validate(evidence), false);
  evidence.productionPromoted = true;
  assert.doesNotThrow(() => assertNativeAutoFillEvidence(evidence));
  assert.equal(validate(evidence), true, JSON.stringify(validate.errors));

  evidence.lowerOsRuntime = "NATIVE_AUTOFILL_LIVE_PASS";
  assert.throws(() => assertNativeAutoFillEvidence(evidence), /NATIVE_AUTOFILL_EVIDENCE_INVALID/);
  assert.equal(validate(evidence), false, "lower OS runtime must remain explicitly unverified");
  evidence.lowerOsRuntime = "NATIVE_AUTOFILL_LOWER_OS_RUNTIME_UNVERIFIED";

  evidence.codes.push("NATIVE_AUTOFILL_TOOLING_IMPLEMENTED");
  assert.throws(() => assertNativeAutoFillEvidence(evidence), /NATIVE_AUTOFILL_EVIDENCE_PASS_INVALID/);
  assert.equal(validate(evidence), false, "PASS must reject any code outside the exact positive set");
});

test("writer emits JSON and Markdown without paths or credential references", () => {
  const directory = mkdtempSync(join(tmpdir(), "barwarden-native-evidence-"));
  try {
    const evidence = createBlockedNativeAutoFillEvidence({ osVersion: "26.6" });
    writeNativeAutoFillEvidence({
      evidence,
      jsonPath: join(directory, "evidence.json"),
      markdownPath: join(directory, "evidence.md"),
    });
    const markdown = readFileSync(join(directory, "evidence.md"), "utf8");
    assert.match(markdown, /Status: BLOCKED/);
    assert.match(markdown, /NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING/);
    assert.doesNotMatch(markdown, /\/(?:Users|private|tmp)\//);
    assert.doesNotMatch(markdown, /\.p8|private key|password|credential path/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
