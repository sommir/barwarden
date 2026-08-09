import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { promoteNativeAutoFillRelease } from "./native-autofill-atomic-promotion.mjs";

test("promotes the complete exact release set in one directory rename", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-promotion-"));
  try {
    const source = join(root, "source");
    const output = join(root, "release");
    mkdirSync(join(source, "Barwarden.app"), { recursive: true });
    writeFileSync(join(source, "Barwarden.app", "marker"), "app");
    writeFileSync(join(source, "Barwarden-0.1.2.dmg"), "dmg");
    writeFileSync(join(source, "native-autofill-assembly-attestation.json"), "attestation");
    writeFileSync(join(source, "native-autofill-evidence.json"), "{}");
    writeFileSync(join(source, "native-autofill-evidence.md"), "evidence");

    promoteNativeAutoFillRelease({ sourceDirectory: source, outputDirectory: output });

    assert.deepEqual(readdirSync(output).sort(), [
      "Barwarden-0.1.2.dmg",
      "Barwarden.app",
      "native-autofill-assembly-attestation.json",
      "native-autofill-evidence.json",
      "native-autofill-evidence.md",
    ]);
    assert.equal(readFileSync(join(output, "Barwarden.app", "marker"), "utf8"), "app");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing source artifact leaves no partial output", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-promotion-missing-"));
  try {
    const source = join(root, "source");
    const output = join(root, "release");
    mkdirSync(join(source, "Barwarden.app"), { recursive: true });
    writeFileSync(join(source, "Barwarden-0.1.2.dmg"), "dmg");

    assert.throws(
      () => promoteNativeAutoFillRelease({ sourceDirectory: source, outputDirectory: output }),
      /NATIVE_AUTOFILL_PROMOTION_INVALID/,
    );
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evidence generation failure leaves no release directory", () => {
  const root = mkdtempSync(join(tmpdir(), "barwarden-promotion-evidence-failure-"));
  try {
    const source = join(root, "private-stage");
    const output = join(root, "release");
    mkdirSync(join(source, "Barwarden.app"), { recursive: true });
    writeFileSync(join(source, "Barwarden-0.1.2.dmg"), "dmg");
    writeFileSync(join(source, "native-autofill-assembly-attestation.json"), "attestation");

    assert.throws(
      () => promoteNativeAutoFillRelease({ sourceDirectory: source, outputDirectory: output }),
      /NATIVE_AUTOFILL_PROMOTION_INVALID/,
    );
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
