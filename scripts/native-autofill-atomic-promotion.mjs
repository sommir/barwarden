import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED = [
  "Barwarden-0.1.2.dmg",
  "Barwarden.app",
  "native-autofill-assembly-attestation.json",
];

export function promoteNativeAutoFillRelease({ sourceDirectory, outputDirectory }) {
  const source = resolve(sourceDirectory);
  const output = resolve(outputDirectory);
  if (existsSync(output) || !existsSync(source) || lstatSync(source).isSymbolicLink()) {
    throw new Error("NATIVE_AUTOFILL_PROMOTION_INVALID");
  }
  if (JSON.stringify(readdirSync(source).sort()) !== JSON.stringify(EXPECTED)) {
    throw new Error("NATIVE_AUTOFILL_PROMOTION_INVALID");
  }
  const stage = mkdtempSync(join(dirname(output), `.${basename(output)}.staging-`));
  try {
    for (const name of EXPECTED) {
      const input = join(source, name);
      if (!existsSync(input) || lstatSync(input).isSymbolicLink()) {
        throw new Error("NATIVE_AUTOFILL_PROMOTION_INVALID");
      }
      cpSync(input, join(stage, name), { recursive: true, dereference: false, preserveTimestamps: true });
    }
    renameSync(stage, output);
  } catch (error) {
    rmSync(stage, { force: true, recursive: true });
    throw error?.message?.startsWith("NATIVE_AUTOFILL_")
      ? error
      : new Error("NATIVE_AUTOFILL_PROMOTION_FAILED");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    if (process.argv.length !== 4) throw new Error("NATIVE_AUTOFILL_ARGUMENT_INVALID");
    promoteNativeAutoFillRelease({ sourceDirectory: process.argv[2], outputDirectory: process.argv[3] });
    console.log("NATIVE_AUTOFILL_PROMOTION_PASS");
  } catch (error) {
    console.error(error?.message?.startsWith("NATIVE_AUTOFILL_") ? error.message : "NATIVE_AUTOFILL_INTERNAL_ERROR");
    process.exit(1);
  }
}
