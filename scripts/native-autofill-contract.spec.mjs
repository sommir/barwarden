import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const nativeContextSource = read("apps/menubar-tauri/src-tauri/src/autofill_ax_context.rs");
const nativeExecutorSource = read("apps/menubar-tauri/src-tauri/src/autofill_detected_fill.rs");
const nativeClassifierSource = read("apps/menubar-tauri/src-tauri/src/autofill_field_context.rs");
const nativeEntrySource = read("apps/menubar-tauri/src-tauri/src/frontmost.rs");
const nativeContextProduction = nativeContextSource.slice(
  0,
  nativeContextSource.lastIndexOf("#[cfg(test)]\nmod tests"),
);
const nativeExecutorProduction = nativeExecutorSource.slice(
  0,
  nativeExecutorSource.lastIndexOf("#[cfg(test)]\nmod tests"),
);
const appRuntimeSources = [
  "apps/menubar-tauri/src/app/autofill/autofill-fill-context.model.ts",
  "apps/menubar-tauri/src/app/autofill/autofill-contextual-candidates.service.ts",
  "apps/menubar-tauri/src/app/autofill/autofill-fill-action.service.ts",
  "apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts",
  "apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts",
  "apps/menubar-tauri/src/host/tauri-host.service.ts",
].map(read).join("\n");

test("native classification has no value-content, selected-text, pixel, OCR, or app-specific source", () => {
  const classificationSource = [nativeContextProduction, nativeClassifierSource, nativeEntrySource].join("\n");
  assert.doesNotMatch(classificationSource, /["']AXSelectedText["']/);
  assert.doesNotMatch(
    classificationSource,
    /CGWindowListCreateImage|SCScreenshotManager|SCStream|VNRecognizeTextRequest|Vision\.|OCR|Tesseract/i,
  );
  assert.doesNotMatch(classificationSource, /Termius|com\.termius/i);

  const valueLiterals = [...nativeContextProduction.matchAll(/"AXValue"/g)];
  assert.equal(valueLiterals.length, 2, "AXValue is permitted only for settable-state query and exact write");
  const settableUse = nativeContextProduction.slice(valueLiterals[0].index, valueLiterals[0].index + 700);
  const writeUse = nativeContextProduction.slice(valueLiterals[1].index, valueLiterals[1].index + 700);
  assert.match(settableUse, /AXUIElementIsAttributeSettable/);
  assert.doesNotMatch(settableUse, /AXUIElementCopyAttributeValue/);
  assert.match(writeUse, /AXUIElementSetAttributeValue/);
  assert.doesNotMatch(writeUse, /AXUIElementCopyAttributeValue/);
});

test("native detected fill exposes only exact writes or Command-V and cannot submit or navigate", () => {
  const fillSource = `${nativeContextProduction}\n${nativeExecutorProduction}`;
  assert.doesNotMatch(
    fillSource,
    /AXUIElementPerformAction|kAXPressAction|kVK_Return|kVK_Tab|PressReturn\(|PressTab\(|PressButton\(|new_mouse_event/i,
  );
  assert.doesNotMatch(fillSource, /Termius|com\.termius/i);

  const keyCodes = [...nativeContextProduction.matchAll(/new_keyboard_event\([\s\S]{0,160}?,\s*(\d+),\s*(?:true|false)\)/g)]
    .map((match) => Number(match[1]));
  assert.deepEqual(keyCodes, [9, 9], "the only synthesized key is V down/up for guarded paste");
});

test("context-aware application runtime contains no application-specific adapter", () => {
  assert.doesNotMatch(appRuntimeSources, /Termius|com\.termius/i);
  assert.doesNotMatch(appRuntimeSources, /screenshot|screen[- ]?capture|OCR|Tesseract|VNRecognizeTextRequest/i);
});
