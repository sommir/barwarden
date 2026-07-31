#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateRetainedSdkWasm } from "./prepare-retained-sdk-wasm.mjs";

const files = process.argv.slice(2);
if (files.length !== 1) {
  throw new Error(`Production bundle must contain exactly one retained SDK WASM asset; found ${files.length}`);
}

const path = resolve(files[0]);
const result = validateRetainedSdkWasm(readFileSync(path));
process.stdout.write(`Retained SDK WASM audit passed: ${path} (${result.exports} exports)\n`);
