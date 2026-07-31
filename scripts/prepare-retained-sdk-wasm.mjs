#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultSource = resolve(
  repositoryRoot,
  "node_modules/@bitwarden/sdk-internal/bitwarden_wasm_internal_bg.wasm",
);
const defaultOutput = resolve(
  repositoryRoot,
  "apps/menubar-tauri/.generated/bitwarden_wasm_internal_bg.wasm",
);
const defaultMetadata = resolve(
  repositoryRoot,
  "apps/menubar-tauri/.generated/bitwarden_wasm_internal_bg.json",
);
const defaultWasmOpt = resolve(repositoryRoot, "node_modules/.bin/wasm-opt");

export const requiredRetainedSdkExports = Object.freeze([
  "memory",
  "init_sdk",
  "passwordmanagerclient_new",
  "passwordmanagerclient_generator",
  "__wbg_passwordmanagerclient_free",
  "generatorclient_password",
  "generatorclient_passphrase",
  "__wbg_generatorclient_free",
  "purecrypto_random_number",
  "purecrypto_symmetric_encrypt_string",
  "purecrypto_symmetric_decrypt_bytes",
  "purecrypto_decapsulate_key_unsigned",
  "purecrypto_derive_kdf_material",
  "purecrypto_decrypt_user_key_with_master_key",
]);

export function forbiddenSdkCapability(name) {
  return /send|file/i.test(name);
}

export function validateRetainedSdkWasm(bytes) {
  const module = new WebAssembly.Module(bytes);
  const exports = WebAssembly.Module.exports(module).map(({ name }) => name);
  const forbidden = exports.filter(forbiddenSdkCapability);
  if (forbidden.length > 0) {
    throw new Error(`Retained SDK WASM exposes forbidden Send/File capabilities: ${forbidden.join(", ")}`);
  }
  const missing = requiredRetainedSdkExports.filter((name) => !exports.includes(name));
  if (missing.length > 0) {
    throw new Error(`Retained SDK WASM is missing required exports: ${missing.join(", ")}`);
  }
  return { exports: exports.length, sha256: sha256(bytes) };
}

export function prepareRetainedSdkWasm(options = {}) {
  const source = resolve(options.source ?? defaultSource);
  const output = resolve(options.output ?? defaultOutput);
  const metadataPath = resolve(options.metadataPath ?? defaultMetadata);
  const gluePath = resolve(
    options.gluePath ?? join(dirname(output), "bitwarden_wasm_internal_bg.js"),
  );
  const wasmOpt = resolve(options.wasmOpt ?? defaultWasmOpt);
  const temporary = `${output}.tmp-${process.pid}`;
  const sourceBytes = readFileSync(source);
  const sourceExports = WebAssembly.Module.exports(new WebAssembly.Module(sourceBytes)).map(
    ({ name }) => name,
  );
  if (!sourceExports.some(forbiddenSdkCapability)) {
    throw new Error("Pinned SDK WASM no longer exposes the expected Send/File capability boundary");
  }

  mkdirSync(dirname(output), { recursive: true });
  rmSync(temporary, { force: true });
  try {
    execFileSync(
      wasmOpt,
      [
        source,
        "--remove-exports=*send*",
        "--remove-exports=*Send*",
        "--remove-exports=*file*",
        "--remove-exports=*File*",
        "--remove-unused-module-elements",
        "--strip-debug",
        "-o",
        temporary,
      ],
      { stdio: "inherit" },
    );
    const outputBytes = readFileSync(temporary);
    const retained = validateRetainedSdkWasm(outputBytes);
    renameSync(temporary, output);
    writeFileSync(
      gluePath,
      'export * from "@bitwarden/sdk-internal/bitwarden_wasm_internal_bg.js";\n',
    );
    const metadata = {
      sourceSha256: sha256(sourceBytes),
      outputSha256: retained.sha256,
      sourceExports: sourceExports.length,
      retainedExports: retained.exports,
      removedExports: sourceExports.length - retained.exports,
    };
    const metadataTemporary = `${metadataPath}.tmp-${process.pid}`;
    writeFileSync(metadataTemporary, `${JSON.stringify(metadata, null, 2)}\n`);
    renameSync(metadataTemporary, metadataPath);
    return { output, metadataPath, gluePath, ...metadata };
  } finally {
    rmSync(temporary, { force: true });
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = prepareRetainedSdkWasm();
  process.stdout.write(
    `Prepared retained SDK WASM: ${result.retainedExports}/${result.sourceExports} exports, ${result.outputSha256}\n`,
  );
}
