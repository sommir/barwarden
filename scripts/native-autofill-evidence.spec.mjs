import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
  assert.equal(evidence.artifactHashes.appSha256, null);
  assert.equal(evidence.artifactHashes.dmgSha256, null);
  assert.ok(evidence.codes.includes("NATIVE_AUTOFILL_AGENT_RESTRICTED_ENTITLEMENT_UNPACKAGEABLE"));
  assertNativeAutoFillEvidence(evidence);
  for (const code of [...evidence.codes, ...Object.values(evidence.liveMatrix)]) {
    assert.match(code, /^NATIVE_AUTOFILL_[A-Z0-9_]+$/);
  }
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /\/(?:Users|private|tmp)\//);
  assert.doesNotMatch(serialized, /\.p8|\.pem|-----BEGIN|password|credentialPath/i);
});

test("blocked evidence names every current and macOS 13 live matrix gate", () => {
  const evidence = createBlockedNativeAutoFillEvidence({ osVersion: "26.6" });
  assert.deepEqual(Object.keys(evidence.liveMatrix), [
    "freshInstallCurrent",
    "updateCurrent",
    "freshInstallMacOS13",
    "updateMacOS13",
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
  assert.ok(Object.values(evidence.liveMatrix).every((code) => code === "NATIVE_AUTOFILL_LIVE_BLOCKED_NO_RELEASE_ARTIFACT"));
});

test("PASS is rejected until artifacts and every live gate pass", () => {
  const evidence = createBlockedNativeAutoFillEvidence({ osVersion: "26.6" });
  evidence.status = "PASS";
  assert.throws(() => assertNativeAutoFillEvidence(evidence), /NATIVE_AUTOFILL_EVIDENCE_PASS_INVALID/);
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
