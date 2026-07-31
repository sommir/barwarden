#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
default_source_root="$(cd "$script_dir/.." && pwd)"
source_root="$default_source_root"
inputs_only=false
release_mode=false
sign_only_mode=false
app_path=""
dmg_path=""
mount_dir=""
mounted=false
release_config=""
manifest_dir=""
temp_root="$(mktemp -d)"

expected_identifier="com.sommir.barwarden"
expected_product_name="Barwarden"
expected_package_name="barwarden"
expected_executable_name="barwarden"
expected_version="0.1.0"
expected_architecture="aarch64"
expected_minimum_macos="13.0"
expected_icon_name="icon.icns"
expected_app_basename="${expected_product_name}.app"
expected_dmg_basename="${expected_product_name}_${expected_version}_${expected_architecture}.dmg"
expected_apple_events_description="Barwarden may interact with another app only when you invoke a paste action."

usage() {
  cat <<'USAGE'
Usage: scripts/verify-macos-bundle.sh [--inputs-only] [--source-root PATH]
       scripts/verify-macos-bundle.sh [--source-root PATH] [--app PATH --dmg PATH]
       scripts/verify-macos-bundle.sh --sign-only [--source-root PATH]
       scripts/verify-macos-bundle.sh --release [--source-root PATH]

Default mode only verifies existing local artifacts. It never submits, signs,
staples, or otherwise mutates them. --sign-only creates a Developer ID signed
artifact and requires APPLE_SIGNING_IDENTITY. --release additionally notarizes
and staples, and requires APPLE_NOTARYTOOL_KEYCHAIN_PROFILE.
USAGE
}

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "required file is missing: $1"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

cleanup() {
  local status=$?
  if [[ "$mounted" == true && -n "$mount_dir" ]]; then
    hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 || true
  fi
  [[ -z "$mount_dir" ]] || rmdir "$mount_dir" >/dev/null 2>&1 || true
  [[ -z "$release_config" ]] || rm -f "$release_config"
  [[ -z "$manifest_dir" ]] || rm -rf "$manifest_dir"
  [[ -z "$temp_root" ]] || rm -rf "$temp_root"
  exit "$status"
}
trap cleanup EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --inputs-only)
      inputs_only=true
      shift
      ;;
    --release)
      release_mode=true
      shift
      ;;
    --sign-only)
      sign_only_mode=true
      shift
      ;;
    --source-root)
      [[ $# -ge 2 ]] || fail "--source-root requires a path"
      source_root="$2"
      shift 2
      ;;
    --app)
      [[ $# -ge 2 ]] || fail "--app requires a path"
      app_path="$2"
      shift 2
      ;;
    --dmg)
      [[ $# -ge 2 ]] || fail "--dmg requires a path"
      dmg_path="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "unknown argument: $1"
      ;;
  esac
done

[[ -d "$source_root" ]] || fail "source root is missing: $source_root"
source_root="$(cd "$source_root" && pwd)"

if [[ "$inputs_only" == true && ( "$release_mode" == true || -n "$app_path" || -n "$dmg_path" ) ]]; then
  fail "--inputs-only cannot be combined with release mode or artifact paths"
fi
if [[ "$release_mode" == true && ( -n "$app_path" || -n "$dmg_path" ) ]]; then
  fail "--release builds and verifies its own artifacts; do not pass --app or --dmg"
fi
if [[ -n "$app_path" && -z "$dmg_path" ]] || [[ -z "$app_path" && -n "$dmg_path" ]]; then
  fail "--app and --dmg must be provided together"
fi

require_command node
require_command plutil
require_command cargo

tauri_config="$source_root/apps/menubar-tauri/src-tauri/tauri.conf.json"
cargo_manifest="$source_root/apps/menubar-tauri/src-tauri/Cargo.toml"
entitlements_plist="$source_root/apps/menubar-tauri/src-tauri/Entitlements.plist"
info_plist="$source_root/apps/menubar-tauri/src-tauri/Info.plist"
package_json="$source_root/package.json"
license_file="$source_root/LICENSE"
notice_file="$source_root/NOTICE.md"
privacy_file="$source_root/PRIVACY.md"
third_party_licenses_file="$source_root/THIRD_PARTY_LICENSES.txt"
third_party_notices_file="$source_root/THIRD_PARTY_NOTICES.md"
icon_file="$source_root/apps/menubar-tauri/src-tauri/icons/$expected_icon_name"

for input_file in \
  "$tauri_config" \
  "$cargo_manifest" \
  "$entitlements_plist" \
  "$info_plist" \
  "$package_json" \
  "$license_file" \
  "$notice_file" \
  "$privacy_file" \
  "$third_party_licenses_file" \
  "$third_party_notices_file" \
  "$icon_file"
do
  require_file "$input_file"
done

schema_path="$default_source_root/node_modules/@tauri-apps/cli/config.schema.json"
require_file "$schema_path"

node - \
  "$tauri_config" \
  "$package_json" \
  "$schema_path" \
  "$expected_identifier" \
  "$expected_product_name" \
  "$expected_package_name" \
  "$expected_version" \
  "$expected_minimum_macos" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const packageJson = JSON.parse(readFileSync(process.argv[3], "utf8"));
const schema = JSON.parse(readFileSync(process.argv[4], "utf8"));
const expectedIdentifier = process.argv[5];
const expectedProductName = process.argv[6];
const expectedPackageName = process.argv[7];
const expectedVersion = process.argv[8];
const expectedMinimumMacos = process.argv[9];

assert.equal(config.identifier, expectedIdentifier, "unexpected bundle identifier");
assert.equal(config.productName, expectedProductName, "unexpected product name");
assert.equal(config.version, expectedVersion, "unexpected Tauri version");
assert.deepEqual(config.bundle?.targets, ["app", "dmg"], "bundle targets must be fixed to app and dmg");
assert.deepEqual(config.bundle?.icon, ["icons/icon.icns"], "unexpected bundle icon configuration");
assert.equal(config.bundle?.license, undefined, "DMG license agreement must not be configured");
assert.equal(config.bundle?.licenseFile, undefined, "DMG license agreement must not be configured");
assert.equal(config.bundle?.macOS?.minimumSystemVersion, expectedMinimumMacos, "unexpected macOS floor");
assert.equal(config.bundle?.macOS?.hardenedRuntime, true, "hardened runtime must be explicit");
assert.equal(config.bundle?.macOS?.entitlements, "Entitlements.plist", "unexpected entitlements path");
assert.equal(config.bundle?.macOS?.infoPlist, "Info.plist", "unexpected Info.plist path");
assert.deepEqual(config.bundle?.macOS?.files, {
  "Resources/LICENSE": "../../../LICENSE",
  "Resources/NOTICE.md": "../../../NOTICE.md",
  "Resources/PRIVACY.md": "../../../PRIVACY.md",
  "Resources/THIRD_PARTY_LICENSES.txt": "../../../THIRD_PARTY_LICENSES.txt",
  "Resources/THIRD_PARTY_NOTICES.md": "../../../THIRD_PARTY_NOTICES.md",
}, "license, notice, privacy, and dependency resources must be fixed");
assert.equal(config.app?.windows?.length, 1, "expected one configured main popup");
const [mainWindow] = config.app.windows;
assert.equal(mainWindow.label, "main");
assert.equal(mainWindow.width, 480);
assert.equal(mainWindow.height, 600);
assert.equal(mainWindow.visible, false);
assert.equal(mainWindow.resizable, true);
assert.equal(mainWindow.decorations, false);
assert.equal(mainWindow.fullscreen, false);
assert.equal(mainWindow.skipTaskbar, true);
assert.equal(config.bundle.macOS.signingIdentity, undefined, "signing identity must not be committed");
assert.equal(config.bundle.macOS.providerShortName, undefined, "provider identifier must not be committed");

const bundleProperties = schema.definitions?.BundleConfig?.properties ?? {};
const macProperties = schema.definitions?.MacConfig?.properties ?? {};
for (const key of Object.keys(config.bundle)) {
  assert.ok(Object.hasOwn(bundleProperties, key), "unsupported Tauri bundle key: " + key);
}
for (const key of Object.keys(config.bundle.macOS)) {
  assert.ok(Object.hasOwn(macProperties, key), "unsupported Tauri macOS key: " + key);
}

assert.equal(packageJson.name, expectedPackageName, "unexpected package name");
assert.equal(packageJson.version, expectedVersion, "unexpected package version");
assert.equal(packageJson.license, "GPL-3.0-only", "unexpected package license");
assert.equal(packageJson.scripts?.["verify:macos-bundle"], "scripts/verify-macos-bundle.sh");
assert.equal(packageJson.scripts?.["release:macos-bundle"], "scripts/verify-macos-bundle.sh --release");
assert.equal(packageJson.scripts?.["test:macos-bundle"], "scripts/verify-macos-bundle.test.sh");
NODE

cargo_metadata="$(cargo metadata --manifest-path "$cargo_manifest" --no-deps --format-version 1)"
node - "$expected_package_name" "$expected_version" "$cargo_metadata" <<'NODE'
import assert from "node:assert/strict";

const expectedPackageName = process.argv[2];
const expectedVersion = process.argv[3];
const metadata = JSON.parse(process.argv[4]);
assert.equal(metadata.packages.length, 1, "expected one native package");
const packageMetadata = metadata.packages[0];
assert.equal(packageMetadata.name, expectedPackageName);
assert.equal(packageMetadata.version, expectedVersion);
assert.equal(packageMetadata.license, "GPL-3.0-only");
assert.equal(
  packageMetadata.description,
  "Independent GPL-3.0-only macOS menubar client for Bitwarden-compatible services",
);
assert.deepEqual(packageMetadata.publish, [], "native package must not be publishable");
NODE

plutil -lint "$entitlements_plist" >/dev/null
plutil -lint "$info_plist" >/dev/null

entitlements_json="$(plutil -convert json -o - "$entitlements_plist")"
node - "$entitlements_json" <<'NODE'
import assert from "node:assert/strict";
const entitlements = JSON.parse(process.argv[2]);
assert.deepEqual(entitlements, {}, "local distribution entitlements must be empty");
NODE

apple_events_description="$(plutil -extract NSAppleEventsUsageDescription raw -o - "$info_plist")"
[[ "$apple_events_description" == "$expected_apple_events_description" ]] || \
  fail "unexpected NSAppleEventsUsageDescription"
ls_ui_element="$(plutil -extract LSUIElement raw -o - "$info_plist")"
[[ "$ls_ui_element" == "true" ]] || fail "unexpected LSUIElement"

info_json="$(plutil -convert json -o - "$info_plist")"
node - "$info_json" <<'NODE'
import assert from "node:assert/strict";
const info = JSON.parse(process.argv[2]);
assert.deepEqual(
  Object.keys(info).sort(),
  ["LSUIElement", "NSAppleEventsUsageDescription"],
  "Info.plist fragment contains unexpected keys",
);
NODE

grep -Fq 'GNU GENERAL PUBLIC LICENSE' "$license_file" || fail "GPL license title is missing"
grep -Fq 'Version 3, 29 June 2007' "$license_file" || fail "GPL-3.0 license version is missing"
grep -Fq 'independent GPL-3.0-only project' "$notice_file" || fail "independent-project attribution is missing"
grep -Fq 'It is not an official' "$notice_file" || fail "unofficial-product attribution is missing"
grep -Fq 'Bitwarden product' "$notice_file" || fail "unofficial-product attribution is missing"
grep -Fq 'vendor/bitwarden-clients' "$notice_file" || fail "vendored upstream attribution is missing"
grep -Fq 'Minimum system version: macOS 13.0' "$notice_file" || fail "minimum macOS rationale is missing"

node - \
  "$tauri_config" \
  "$cargo_manifest" \
  "$entitlements_plist" \
  "$info_plist" \
  "$package_json" \
  "$license_file" \
  "$notice_file" \
  "$source_root/scripts/verify-macos-bundle.sh" \
  "$source_root/scripts/verify-macos-bundle.test.sh" <<'NODE'
import { readFileSync } from "node:fs";

const privateBlock = new RegExp([
  "-----BEGIN ",
  "(?:[A-Z ]*PRIVATE KEY|CERTIFICATE)",
  "-----",
].join(""), "i");
const certificatePath = new RegExp("\\." + "(?:p12|p8)" + "\\b", "i");
const sensitive = [
  "APPLE_SIGNING_IDENTITY", "APPLE_NOTARYTOOL_KEYCHAIN_PROFILE",
  "APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_ID",
  "APPLE_PASSWORD", "APPLE_TEAM_ID", "APPLE_PROVIDER_SHORT_NAME",
  "APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH",
];
function normalize(content) {
  let normalized = content;
  let previous;
  do {
    previous = normalized;
    normalized = normalized.replace(
      /(^|[=(:,\s])(["'])([^"'\n]*)\2(["'])([^"'\n]*)\4/gm,
      "$1$2$3$5$2",
    );
  } while (normalized !== previous);
  return normalized;
}
function sensitiveAssignments(content, key) {
  const assignment = new RegExp(
    String.raw`\b${key}\s*=\s*((?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s#;])+)`,
    "g",
  );
  return Array.from(content.matchAll(assignment), (match) => match[1]);
}
function directReference(rhs) {
  if (rhs.startsWith("'") && rhs.endsWith("'")) return false;
  const value = rhs.startsWith('"') && rhs.endsWith('"') ? rhs.slice(1, -1) : rhs;
  return /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*(?:-)?\})$/.test(value);
}
const forbidden = [
  ["private key or certificate block", privateBlock],
  ["committed Apple signing identity value", /\bAPPLE_SIGNING_IDENTITY\s*=\s*(?!["']?\$)[^\s#]+/i],
  ["committed Apple notarization profile value", /\bAPPLE_NOTARYTOOL_KEYCHAIN_PROFILE\s*=\s*(?!["']?\$)[^\s#]+/i],
  ["committed Apple account, password, team, provider, issuer, or API-key value", /\bAPPLE_(?:CERTIFICATE|CERTIFICATE_PASSWORD|ID|PASSWORD|TEAM_ID|PROVIDER_SHORT_NAME|API_ISSUER|API_KEY|API_KEY_PATH)\s*=\s*(?!["']?\$)[^\s#]+/i],
  ["committed signing, team, provider, or issuer value", /\b(?:signingIdentity|providerShortName|teamId|issuer)\s*[:=]\s*["'][^"'$][^"']*["']/i],
  ["inline notarization credential", /(?:--apple-id|--password|--team-id|--issuer|--key)\s+[^$\s][^\s]*/i],
  ["committed certificate or API key path", certificatePath],
];

for (const path of process.argv.slice(2)) {
  const content = normalize(readFileSync(path, "utf8"));
  for (const key of sensitive) {
    for (const rhs of sensitiveAssignments(content, key)) {
      if (!directReference(rhs)) throw new Error("committed sensitive Apple assignment found in " + path);
    }
  }
  for (const [label, pattern] of forbidden) {
    if (pattern.test(content)) {
      throw new Error(label + " found in " + path);
    }
  }
}
NODE

printf 'INPUTS: PASS (identifier=%s version=%s targets=app,dmg minimum-macOS=%s)\n' \
  "$expected_identifier" "$expected_version" "$expected_minimum_macos"

if [[ "$inputs_only" == true ]]; then
  exit 0
fi

set +u
signing_identity="${APPLE_SIGNING_IDENTITY-}"
notary_profile="${APPLE_NOTARYTOOL_KEYCHAIN_PROFILE-}"
set -u

if [[ "$release_mode" == true || "$sign_only_mode" == true ]]; then
  if [[ -z "$signing_identity" ]]; then
    if [[ "$release_mode" == true ]]; then
      fail "--release requires APPLE_SIGNING_IDENTITY"
    fi
    fail "--sign-only requires APPLE_SIGNING_IDENTITY"
  fi
  if [[ "$release_mode" == true ]]; then
    [[ -n "$notary_profile" ]] || fail "--release requires APPLE_NOTARYTOOL_KEYCHAIN_PROFILE"
  fi
  require_command tauri
  require_command codesign
  if [[ "$release_mode" == true ]]; then
    require_command xcrun
    require_command spctl
  fi
  umask 077
  release_config="$(mktemp "$source_root/apps/menubar-tauri/src-tauri/.tauri-release.XXXXXX.json")"
  APPLE_SIGNING_IDENTITY="$signing_identity" node - "$tauri_config" "$release_config" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
config.bundle.macOS.signingIdentity = process.env.APPLE_SIGNING_IDENTITY;
writeFileSync(process.argv[3], JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
NODE
  env -u APPLE_CERTIFICATE -u APPLE_CERTIFICATE_PASSWORD -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID -u APPLE_API_ISSUER \
    -u APPLE_API_KEY -u APPLE_API_KEY_PATH -u APPLE_PROVIDER_SHORT_NAME \
    -u APPLE_NOTARYTOOL_KEYCHAIN_PROFILE \
    APPLE_SIGNING_IDENTITY="$signing_identity" tauri build --config "$release_config"
fi

bundle_root="$source_root/apps/menubar-tauri/src-tauri/target/release/bundle"
if [[ -z "$app_path" ]]; then
  app_path="$bundle_root/macos/$expected_app_basename"
  dmg_path="$bundle_root/dmg/$expected_dmg_basename"
fi

[[ "$(basename "$app_path")" == "$expected_app_basename" ]] || fail "application basename mismatch"
[[ "$(basename "$dmg_path")" == "$expected_dmg_basename" ]] || fail "DMG basename mismatch"
[[ -d "$app_path" && ! -L "$app_path" ]] || fail "application bundle is missing or has an unsupported type: $app_path"
[[ -f "$dmg_path" && ! -L "$dmg_path" ]] || fail "required DMG is missing or has an unsupported type: $dmg_path"

require_command hdiutil
require_command codesign
read_bundle_value() { plutil -extract "$2" raw -o - "$1/Contents/Info.plist"; }
verify_bundle() {
  local bundle="$1" label="$2" executable executable_entry executable_count=0
  require_file "$bundle/Contents/Info.plist"
  [[ "$(read_bundle_value "$bundle" CFBundleIdentifier)" == "$expected_identifier" ]] || fail "$label identifier mismatch"
  [[ "$(read_bundle_value "$bundle" CFBundleName)" == "$expected_product_name" ]] || fail "$label bundle name mismatch"
  [[ "$(read_bundle_value "$bundle" CFBundleShortVersionString)" == "$expected_version" ]] || fail "$label short version mismatch"
  [[ "$(read_bundle_value "$bundle" CFBundleVersion)" == "$expected_version" ]] || fail "$label bundle version mismatch"
  [[ "$(read_bundle_value "$bundle" CFBundleIconFile)" == "$expected_icon_name" ]] || fail "$label application icon metadata mismatch"
  [[ "$(read_bundle_value "$bundle" LSMinimumSystemVersion)" == "$expected_minimum_macos" ]] || fail "$label minimum macOS mismatch"
  [[ "$(read_bundle_value "$bundle" NSAppleEventsUsageDescription)" == "$expected_apple_events_description" ]] || fail "$label Apple Events metadata mismatch"
  [[ "$(read_bundle_value "$bundle" LSUIElement)" == "true" ]] || fail "$label LSUIElement mismatch"
  executable="$(read_bundle_value "$bundle" CFBundleExecutable)"
  [[ "$executable" == "$expected_executable_name" ]] || fail "$label executable name mismatch"
  [[ -d "$bundle/Contents/MacOS" && ! -L "$bundle/Contents/MacOS" ]] || \
    fail "$label Contents/MacOS must contain only $expected_executable_name"
  while IFS= read -r -d '' executable_entry; do
    executable_count=$((executable_count + 1))
    [[ "$(basename "$executable_entry")" == "$expected_executable_name" ]] || \
      fail "$label Contents/MacOS must contain only $expected_executable_name"
  done < <(find -P "$bundle/Contents/MacOS" -mindepth 1 -maxdepth 1 -print0)
  [[ "$executable_count" -eq 1 ]] || fail "$label Contents/MacOS must contain only $expected_executable_name"
  [[ -f "$bundle/Contents/MacOS/$executable" && ! -L "$bundle/Contents/MacOS/$executable" && -x "$bundle/Contents/MacOS/$executable" ]] || \
    fail "$label executable is missing, not executable, or has an unsupported type"
  cmp -s "$license_file" "$bundle/Contents/Resources/LICENSE" || fail "$label bundled GPL license differs from source"
  cmp -s "$notice_file" "$bundle/Contents/Resources/NOTICE.md" || fail "$label bundled notice differs from source"
  cmp -s "$privacy_file" "$bundle/Contents/Resources/PRIVACY.md" || fail "$label bundled privacy disclosure differs from source"
  cmp -s "$third_party_licenses_file" "$bundle/Contents/Resources/THIRD_PARTY_LICENSES.txt" || fail "$label bundled third-party licenses differ from source"
  cmp -s "$third_party_notices_file" "$bundle/Contents/Resources/THIRD_PARTY_NOTICES.md" || fail "$label bundled third-party notices differ from source"
  cmp -s "$icon_file" "$bundle/Contents/Resources/$expected_icon_name" || fail "$label bundled application icon differs from source"
}
classify_signature() {
  local details
  if details="$(codesign -dvvv "$1" 2>&1)"; then
    if grep -Fqx 'Signature=adhoc' <<<"$details"; then printf 'adhoc\n'; elif grep -Fq 'Authority=Developer ID Application:' <<<"$details"; then printf 'developer-id\n'; else fail "unrecognized signed artifact state"; fi
  else
    grep -Fqi 'not signed at all' <<<"$details" || fail "codesign could not classify artifact state"
    printf 'unsigned\n'
  fi
}
classify_bundle_signature() {
  local bundle="$1"
  if [[ ! -f "$bundle/Contents/_CodeSignature/CodeResources" ]]; then
    printf 'unsigned\n'
    return
  fi
  classify_signature "$bundle"
}
verify_linker_signed_executable() {
  local executable="$1" copied
  copied="$(mktemp "$temp_root/linker-executable.XXXXXX")"
  cp "$executable" "$copied"
  chmod 755 "$copied"
  codesign --verify --strict --verbose=4 "$copied"
  verify_signed_entitlements "$copied" adhoc
  rm -f "$copied"
}
verify_signed_entitlements() {
  local output diagnostic status entitlement_file diagnostic_file
  [[ "$2" != unsigned ]] || return 0
  entitlement_file="$(mktemp "$temp_root/entitlements.XXXXXX")"
  diagnostic_file="$(mktemp "$temp_root/diagnostic.XXXXXX")"
  set +e; codesign -d --entitlements :- "$1" >"$entitlement_file" 2>"$diagnostic_file"; status=$?; set -e
  output="$(<"$entitlement_file")"
  diagnostic="$(<"$diagnostic_file")"
  rm -f "$entitlement_file" "$diagnostic_file"
  if [[ "$status" -ne 0 && "$diagnostic" != *"no entitlements"* ]]; then fail "signed artifact entitlements could not be inspected"; fi
  if [[ -z "$output" || "$diagnostic" == *"no entitlements"* ]]; then output='{}'; else output="$(printf '%s' "$output" | plutil -convert json -o - -)" || fail "signed artifact entitlements are not a plist"; fi
  node - "$output" <<'NODE'
import assert from "node:assert/strict";
assert.deepEqual(JSON.parse(process.argv[2]), {}, "built application contains unexpected entitlements");
NODE
}
inspect_signature() {
  local bundle="$1" label="$2" executable bundle_state executable_state
  executable="$(read_bundle_value "$bundle" CFBundleExecutable)"
  bundle_state="$(classify_bundle_signature "$bundle")"
  executable_state="$(classify_signature "$bundle/Contents/MacOS/$executable")"
  if [[ "$bundle_state" == unsigned ]]; then
    [[ "$executable_state" == adhoc ]] || fail "$label unsigned bundle executable must be linker ad-hoc"
    verify_linker_signed_executable "$bundle/Contents/MacOS/$executable"
  else
    [[ "$bundle_state" == "$executable_state" ]] || fail "$label bundle and executable signature states differ"
    verify_signed_entitlements "$bundle" "$bundle_state"
    verify_signed_entitlements "$bundle/Contents/MacOS/$executable" "$executable_state"
    codesign --verify --deep --strict --verbose=4 "$bundle"
    codesign --verify --strict --verbose=4 "$bundle/Contents/MacOS/$executable"
  fi
  printf '%s:%s\n' "$bundle_state" "$executable_state"
}
write_manifest() {
  node - "$1" "$2" <<'NODE'
import { lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
const [root, output] = process.argv.slice(2); const rows = [];
function visit(path) { const stat = lstatSync(path); const name = relative(root, path) || "."; const mode = (stat.mode & 0o7777).toString(8).padStart(4, "0"); if (stat.isDirectory()) { rows.push(name + "\td\t" + mode + "\t-"); for (const entry of readdirSync(path).sort()) visit(join(path, entry)); } else if (stat.isFile()) { rows.push(name + "\tf\t" + mode + "\t" + createHash("sha256").update(readFileSync(path)).digest("hex")); } else if (stat.isSymbolicLink()) { rows.push(name + "\tl\t" + mode + "\t" + readlinkSync(path)); } else throw new Error("unsupported bundle entry: " + name); }
visit(root); writeFileSync(output, rows.join("\n") + "\n");
NODE
}
verify_mounted_application_inventory() {
  local mounted_root="$1" label="$2" candidate inventory_file app_count=0
  local expected_app="$mounted_root/$expected_app_basename"
  inventory_file="$(mktemp "$temp_root/mounted-apps.XXXXXX")"
  if ! find -P "$mounted_root" -mindepth 1 -name '*.app' -print0 >"$inventory_file" 2>/dev/null; then
    rm -f "$inventory_file"
    fail "$label application inventory traversal failed"
  fi
  while IFS= read -r -d '' candidate; do
    app_count=$((app_count + 1))
    [[ "$candidate" == "$expected_app" ]] || fail "$label contains an additional application bundle"
  done <"$inventory_file"
  rm -f "$inventory_file"
  [[ "$app_count" -eq 1 && -d "$expected_app" && ! -L "$expected_app" ]] || \
    fail "$label does not contain exactly $expected_app_basename"
}

verify_bundle "$app_path" "artifact"
app_signature_state="$(inspect_signature "$app_path" "artifact")"
hdiutil verify "$dmg_path" >/dev/null
mount_dir="$(mktemp -d)"
printf 'Y\n' | hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$dmg_path" >/dev/null
mounted=true
verify_mounted_application_inventory "$mount_dir" "DMG"
mounted_app="$mount_dir/$expected_app_basename"
verify_bundle "$mounted_app" "DMG app"
mounted_signature_state="$(inspect_signature "$mounted_app" "DMG app")"
[[ "$mounted_signature_state" == "$app_signature_state" ]] || fail "DMG app signature state differs from standalone app"
manifest_dir="$(mktemp -d)"
write_manifest "$app_path" "$manifest_dir/standalone"
write_manifest "$mounted_app" "$manifest_dir/mounted"
cmp -s "$manifest_dir/standalone" "$manifest_dir/mounted" || fail "DMG app does not match standalone app"
hdiutil detach "$mount_dir" -quiet
mounted=false; rmdir "$mount_dir"; mount_dir=""
rm -rf "$manifest_dir"; manifest_dir=""

if [[ "$release_mode" == true || "$sign_only_mode" == true ]]; then
  [[ "$app_signature_state" == developer-id:developer-id ]] || fail "release artifact is not Developer ID bundle sealed"
  app_details="$(codesign -dvvv "$app_path" 2>&1)" || fail "release artifact signature could not be inspected"
  executable_name="$(read_bundle_value "$app_path" CFBundleExecutable)"
  executable_details="$(codesign -dvvv "$app_path/Contents/MacOS/$executable_name" 2>&1)" || fail "release executable signature could not be inspected"
  grep -Fqx "Authority=$signing_identity" <<<"$app_details" || fail "Developer ID signature does not match APPLE_SIGNING_IDENTITY"
  grep -Fqx "Authority=$signing_identity" <<<"$executable_details" || fail "Developer ID executable signature does not match APPLE_SIGNING_IDENTITY"
fi

if [[ "$release_mode" == true ]]; then
  xcrun notarytool submit "$dmg_path" --wait --keychain-profile "$notary_profile"
  xcrun stapler staple "$dmg_path"
  xcrun stapler validate "$dmg_path"
  mount_dir="$(mktemp -d)"
  printf 'Y\n' | hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$dmg_path" >/dev/null
  mounted=true
  verify_mounted_application_inventory "$mount_dir" "final stapled DMG"
  mounted_app="$mount_dir/$expected_app_basename"
  verify_bundle "$mounted_app" "final DMG app"
  final_signature_state="$(inspect_signature "$mounted_app" "final DMG app")"
  [[ "$final_signature_state" == "$app_signature_state" ]] || fail "final DMG app signature state differs from standalone app"
  manifest_dir="$(mktemp -d)"
  write_manifest "$app_path" "$manifest_dir/standalone"
  write_manifest "$mounted_app" "$manifest_dir/mounted"
  cmp -s "$manifest_dir/standalone" "$manifest_dir/mounted" || fail "final DMG app does not match standalone app"
  spctl -a -vvv -t exec "$mounted_app"
  hdiutil detach "$mount_dir" -quiet
  mounted=false; rmdir "$mount_dir"; mount_dir=""
  rm -rf "$manifest_dir"; manifest_dir=""
  printf 'ARTIFACTS: PASS (app and DMG metadata, resources, signatures, and content equivalence verified)\n'
  printf 'RELEASE: PASS (Developer ID signing and final DMG notarization/stapling checks completed)\n'
elif [[ "$sign_only_mode" == true ]]; then
  printf 'SIGNING: PASS (Developer ID signing and app/DMG content equivalence verified)\n'
  printf 'ARTIFACTS: PASS (app and DMG metadata, resources, signatures, and content equivalence verified)\n'
  printf 'NOTARIZATION: BLOCKED (run --release with APPLE_NOTARYTOOL_KEYCHAIN_PROFILE)\n'
  printf 'STAPLING: BLOCKED (run --release after notarization)\n'
  printf 'GATEKEEPER: BLOCKED (run --release after stapling)\n'
else
  case "$app_signature_state" in
    unsigned:adhoc) printf 'SIGNING: BLOCKED (unsigned bundle with linker ad-hoc executable)\n' ;;
    adhoc:adhoc) printf 'SIGNING: BLOCKED (ad-hoc local artifact)\n' ;;
    developer-id:developer-id) printf 'SIGNING: BLOCKED (local verification does not run release signing gates)\n' ;;
  esac
  printf 'ARTIFACTS: PASS (app and DMG metadata, resources, signatures, and content equivalence verified)\n'
  printf 'NOTARIZATION: BLOCKED (run --release with external Developer ID and notary profile inputs)\n'
  printf 'STAPLING: BLOCKED (run --release after notarization)\n'
  printf 'GATEKEEPER: BLOCKED (run --release after stapling)\n'
fi
