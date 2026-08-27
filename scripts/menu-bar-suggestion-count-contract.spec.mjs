import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rust = readFileSync(
  new URL("../apps/menubar-tauri/src-tauri/src/suggestion_count.rs", import.meta.url),
  "utf8",
);
const macos = readFileSync(
  new URL("../apps/menubar-tauri/src-tauri/src/suggestion_count_macos.rs", import.meta.url),
  "utf8",
);
const frontend = readFileSync(
  new URL("../apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.ts", import.meta.url),
  "utf8",
);

function quotedValues(source, constantName) {
  const match = source.match(new RegExp(
    `const ${constantName}[^=]*=\\s*(?:new Set\\()?\\s*&?\\[([\\s\\S]*?)\\]\\)?;`,
    "u",
  ));
  assert.ok(match, `${constantName} must be an explicit shared-policy constant`);
  return [...match[1].matchAll(/"([^"]+)"/gu)].map((entry) => entry[1]);
}

test("native tray count and visible suggestion section keep the same policy", () => {
  assert.match(rust, /MAX_VISIBLE_SUGGESTIONS:\s*usize\s*=\s*5/u);
  assert.match(frontend, /\.slice\(0,\s*5\)/u);
  assert.deepEqual(quotedValues(rust, "ALLOWED_OTHER_REASONS"), [
    "application_name",
    "application_name_similar",
    "fuzzy_name",
  ]);
  assert.deepEqual(quotedValues(frontend, "CONTEXTUAL_OTHER_REASONS"), [
    "application_name",
    "application_name_similar",
    "fuzzy_name",
  ]);
  const nativeFields = rust.match(/const QUERY_FIELDS[^=]*=\s*\[([\s\S]*?)\];/u);
  assert.ok(nativeFields, "QUERY_FIELDS must be an explicit shared-policy constant");
  assert.deepEqual(
    [...nativeFields[1].matchAll(/AutoFillSecretField::(Username|Password|Totp)/gu)].map((entry) => entry[1]),
    ["Username", "Password", "Totp"],
  );
  assert.deepEqual(quotedValues(frontend, "FIELD_ORDER"), ["username", "password", "totp"]);
});

test("native monitor remains read-only, bounded, and metadata-free", () => {
  assert.doesNotMatch(rust, /replace_target_app|replace_target_app_with_context|TargetAppStore/u);
  assert.doesNotMatch(rust, /println!|eprintln!|dbg!|log::|tracing::/u);
  assert.doesNotMatch(macos, /println!|eprintln!|dbg!|log::|tracing::/u);
  assert.match(rust, /Duration::from_secs\(1\)/u);
  assert.match(rust, /browser_family\(&identity\.bundle_id\)/u);
  assert.match(rust, /service_identifiers:\s*service_identifier\.into_iter\(\)\.collect\(\)/u);
  assert.match(rust, /tray\.set_title\(Some\(title\)\)/u);
});

test("browser context stays fail-closed without application-name fallback", () => {
  assert.match(rust, /normalized_website_url\(value\)/u);
  assert.match(rust, /BrowserUrlDecision::Clear/u);
  assert.doesNotMatch(rust, /registrable|root_domain|domain_only/u);
});
