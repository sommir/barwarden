import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  forbiddenSdkCapability,
  prepareRetainedSdkWasm,
  requiredRetainedSdkExports,
  validateRetainedSdkWasm,
} from "./prepare-retained-sdk-wasm.mjs";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "node_modules/@bitwarden/sdk-internal/bitwarden_wasm_internal_bg.wasm");
const wasmOpt = resolve(root, "node_modules/.bin/wasm-opt");

test("removes callable Send and File SDK capabilities while retaining required crypto", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "retained-sdk-wasm-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, "retained.wasm");

  const result = prepareRetainedSdkWasm({
    source,
    output,
    metadataPath: `${output}.json`,
    wasmOpt,
  });
  const sourceExports = WebAssembly.Module.exports(
    new WebAssembly.Module(readFileSync(source)),
  ).map(({ name }) => name);
  const retainedExports = WebAssembly.Module.exports(
    new WebAssembly.Module(readFileSync(output)),
  ).map(({ name }) => name);

  assert.ok(sourceExports.some(forbiddenSdkCapability));
  assert.ok(retainedExports.every((name) => !forbiddenSdkCapability(name)));
  assert.ok(requiredRetainedSdkExports.every((name) => retainedExports.includes(name)));
  assert.equal(result.removedExports, sourceExports.length - retainedExports.length);
  assert.deepEqual(validateRetainedSdkWasm(readFileSync(output)), {
    exports: retainedExports.length,
    sha256: sha(readFileSync(output)),
  });
});

test("produces deterministic retained WASM bytes", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "retained-sdk-wasm-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = join(directory, "first.wasm");
  const second = join(directory, "second.wasm");

  prepareRetainedSdkWasm({ source, output: first, metadataPath: `${first}.json`, wasmOpt });
  prepareRetainedSdkWasm({ source, output: second, metadataPath: `${second}.json`, wasmOpt });

  assert.equal(sha(readFileSync(first)), sha(readFileSync(second)));
});

test("boots the retained WASM through the pinned browser bindings", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "retained-sdk-wasm-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, "retained.wasm");
  prepareRetainedSdkWasm({ source, output, metadataPath: `${output}.json`, wasmOpt });

  const bindings = await import("@bitwarden/sdk-internal/bitwarden_wasm_internal_bg.js");
  const bytes = readFileSync(output);
  const module = new WebAssembly.Module(bytes);
  const importModules = [...new Set(WebAssembly.Module.imports(module).map(({ module }) => module))];
  const imports = Object.fromEntries(importModules.map((name) => [name, bindings]));
  const instance = await WebAssembly.instantiate(module, imports);
  bindings.__wbg_set_wasm(instance.exports);
  bindings.init_sdk();

  assert.equal(bindings.PureCrypto.random_number(7, 7), 7);
});

function sha(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
