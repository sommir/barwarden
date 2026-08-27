#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
verifier="$script_dir/verify-macos-bundle.sh"
real_find="$(command -v find)"
fixture_root="$(mktemp -d)"
shim_root="$fixture_root/shims"
command_log="$fixture_root/commands.log"
release_attach_counter="$fixture_root/release-attach-count"
stapled_marker="$fixture_root/release-dmg-stapled"
final_mounted_app_file="$fixture_root/final-mounted-app"
mounted_template="$fixture_root/mounted-template/Barwarden.app"
standalone_app="$fixture_root/standalone/Barwarden.app"
standalone_dmg="$fixture_root/standalone/Barwarden_0.1.0_aarch64.dmg"
release_bundle_root="$fixture_root/apps/menubar-tauri/src-tauri/target/release/bundle"
release_app="$release_bundle_root/macos/Barwarden.app"
release_dmg="$release_bundle_root/dmg/Barwarden_0.1.0_aarch64.dmg"
test_identity_prefix="Developer ID Application:"
test_nonce="$(date +%s)-$$"
test_identity_subject="opaque-$test_nonce"
test_identity_team="T$test_nonce"
test_identity="$test_identity_prefix $test_identity_subject ($test_identity_team)"
test_profile_name="opaque-profile-$test_nonce"

cleanup() {
  rm -rf "$fixture_root"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_contains() {
  local text="$1"
  local expected="$2"
  local description="$3"

  [[ "$text" == *"$expected"* ]] || fail "$description; expected diagnostic: $expected; got: $text"
}

assert_not_contains() {
  local text="$1"
  local unexpected="$2"
  local description="$3"

  [[ "$text" != *"$unexpected"* ]] || fail "$description; unexpected diagnostic: $unexpected; got: $text"
}

assert_rejected() {
  local description="$1"
  local expected="$2"
  shift 2
  local output

  if output="$("$@" 2>&1)"; then
    fail "verifier accepted $description"
  fi
  assert_contains "$output" "$expected" "$description"
}

assert_rejected_with_exact_diagnostic() {
  local description="$1"
  local expected="$2"
  shift 2
  local output

  if output="$("$@" 2>&1)"; then
    fail "verifier accepted $description"
  fi
  grep -Fxq "$expected" <<<"$output" || \
    fail "$description; expected exact diagnostic: $expected; got: $output"
}

assert_rejected_with_sanitized_diagnostic() {
  local description="$1"
  local expected="$2"
  local unsanitized="$3"
  shift 3
  local output

  if output="$("$@" 2>&1)"; then
    fail "verifier accepted $description"
  fi
  grep -Fxq "$expected" <<<"$output" || \
    fail "$description; expected exact diagnostic: $expected; got: $output"
  assert_not_contains "$output" "$unsanitized" "$description"
}

assert_succeeds() {
  local description="$1"
  shift
  local output

  if ! output="$("$@" 2>&1)"; then
    fail "$description failed: $output"
  fi
  printf '%s\n' "$output"
}

probe_sensitive_assignment() {
  local expectation="$1"
  local description="$2"
  local rhs="$3"
  local sensitive_key output

  sensitive_key="$(printf '%s%s' 'APPLE_SIGNING' '_IDENTITY')"
  cp "$repo_root/scripts/verify-macos-bundle.test.sh" "$credential_fixture"
  printf '%s=%s\n' "$sensitive_key" "$rhs" >> "$credential_fixture"

  if [[ "$expectation" == accept ]]; then
    if ! output="$("$verifier" --source-root "$fixture_root" --inputs-only 2>&1)"; then
      fail "$description was rejected: $output"
    fi
    [[ "$output" == "INPUTS: PASS (identifier=com.sommir.barwarden version=0.1.0 targets=app,dmg minimum-macOS=13.0)" ]] || \
      fail "$description did not produce the exact accepted diagnostic: $output"
  else
    assert_rejected_with_exact_diagnostic \
      "$description" \
      "Error: committed sensitive Apple assignment found in $credential_fixture" \
      "$verifier" --source-root "$fixture_root" --inputs-only
  fi
}

write_app() {
  local app="$1"

  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
  node - "$app/Contents/Info.plist" <<'NODE'
import { writeFileSync } from "node:fs";

writeFileSync(process.argv[2], `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.sommir.barwarden</string>
<key>CFBundleName</key><string>Barwarden</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>0.1.0</string>
<key>CFBundleExecutable</key><string>barwarden</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSAppleEventsUsageDescription</key><string>Barwarden reads the active browser page to suggest matching logins and interacts with the target app only when you invoke a paste action.</string>
<key>LSUIElement</key><true/>
</dict></plist>\n`);
NODE
  printf '#!/usr/bin/env bash\nexit 0\n' > "$app/Contents/MacOS/barwarden"
  chmod 755 "$app/Contents/MacOS/barwarden"
  cp "$repo_root/LICENSE" "$app/Contents/Resources/LICENSE"
  cp "$repo_root/NOTICE.md" "$app/Contents/Resources/NOTICE.md"
  cp "$repo_root/PRIVACY.md" "$app/Contents/Resources/PRIVACY.md"
  cp "$repo_root/THIRD_PARTY_LICENSES.txt" "$app/Contents/Resources/THIRD_PARTY_LICENSES.txt"
  cp "$repo_root/THIRD_PARTY_NOTICES.md" "$app/Contents/Resources/THIRD_PARTY_NOTICES.md"
  cp "$repo_root/apps/menubar-tauri/src-tauri/icons/icon.icns" "$app/Contents/Resources/icon.icns"
}

mkdir -p "$fixture_root/apps/menubar-tauri/src-tauri/src" "$fixture_root/apps/menubar-tauri/src-tauri/icons" "$fixture_root/scripts" "$shim_root"
cp "$repo_root/package.json" "$fixture_root/package.json"
cp "$repo_root/LICENSE" "$fixture_root/LICENSE"
cp "$repo_root/NOTICE.md" "$fixture_root/NOTICE.md"
cp "$repo_root/PRIVACY.md" "$fixture_root/PRIVACY.md"
cp "$repo_root/THIRD_PARTY_LICENSES.txt" "$fixture_root/THIRD_PARTY_LICENSES.txt"
cp "$repo_root/THIRD_PARTY_NOTICES.md" "$fixture_root/THIRD_PARTY_NOTICES.md"
cp "$repo_root/apps/menubar-tauri/src-tauri/Cargo.toml" "$fixture_root/apps/menubar-tauri/src-tauri/Cargo.toml"
cp "$repo_root/apps/menubar-tauri/src-tauri/tauri.conf.json" "$fixture_root/apps/menubar-tauri/src-tauri/tauri.conf.json"
cp "$repo_root/apps/menubar-tauri/src-tauri/Entitlements.plist" "$fixture_root/apps/menubar-tauri/src-tauri/Entitlements.plist"
cp "$repo_root/apps/menubar-tauri/src-tauri/Info.plist" "$fixture_root/apps/menubar-tauri/src-tauri/Info.plist"
cp "$repo_root/apps/menubar-tauri/src-tauri/icons/icon.icns" "$fixture_root/apps/menubar-tauri/src-tauri/icons/icon.icns"
source_info_plist="$fixture_root/apps/menubar-tauri/src-tauri/Info.plist"
if ! plutil -extract LSUIElement raw -o - "$source_info_plist" >/dev/null 2>&1; then
  plutil -insert LSUIElement -bool true "$source_info_plist"
fi
cp "$repo_root/scripts/verify-macos-bundle.sh" "$fixture_root/scripts/verify-macos-bundle.sh"
cp "$repo_root/scripts/verify-macos-bundle.test.sh" "$fixture_root/scripts/verify-macos-bundle.test.sh"
printf 'fn main() {}\n' > "$fixture_root/apps/menubar-tauri/src-tauri/src/main.rs"

write_app "$standalone_app"
mkdir -p "$(dirname "$mounted_template")"
cp -R "$standalone_app" "$mounted_template"
mkdir -p "$(dirname "$release_app")" "$(dirname "$release_dmg")"
cp -R "$standalone_app" "$release_app"
printf 'fixture dmg\n' > "$standalone_dmg"
cp "$standalone_dmg" "$release_dmg"

cat > "$shim_root/hdiutil" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
printf 'hdiutil|%s\n' "$*" >> "$MOCK_COMMAND_LOG"
case "$1" in
  verify)
    exit 0
    ;;
  attach)
    mount_dir=""
    dmg_path="${@: -1}"
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "-mountpoint" ]]; then
        mount_dir="$2"
        shift 2
      else
        shift
      fi
    done
    [[ -n "$mount_dir" ]] || exit 64
    if [[ "${MOCK_RELEASE_MODE:-}" == "1" ]]; then
      [[ "$dmg_path" == "$MOCK_RELEASE_DMG" ]] || exit 65
      attach_count=0
      [[ ! -f "$MOCK_RELEASE_ATTACH_COUNTER" ]] || attach_count="$(<"$MOCK_RELEASE_ATTACH_COUNTER")"
      attach_count=$((attach_count + 1))
      printf '%s\n' "$attach_count" > "$MOCK_RELEASE_ATTACH_COUNTER"
      case "$attach_count" in
        1)
          [[ ! -e "$MOCK_STAPLED_MARKER" ]] || {
            printf 'first release attach occurred after DMG staple marker\n' >&2
            exit 66
          }
          ;;
        2)
          [[ -e "$MOCK_STAPLED_MARKER" ]] || {
            printf 'final release attach requires stapled DMG marker\n' >&2
            exit 67
          }
          [[ "$MOCK_MOUNTED_APP" == "$MOCK_RELEASE_APP" ]] || exit 68
          printf '%s\n' "$mount_dir/Barwarden.app" > "$MOCK_FINAL_MOUNTED_APP_FILE"
          ;;
        *)
          printf 'unexpected extra release attach\n' >&2
          exit 69
          ;;
      esac
    fi
    cp -pR "$MOCK_MOUNTED_APP" "$mount_dir/Barwarden.app"
    if [[ -n "${MOCK_EXTRA_MOUNTED_APP:-}" ]]; then
      extra_app_path="$mount_dir/${MOCK_EXTRA_MOUNTED_APP_RELATIVE_PATH:-Legacy.app}"
      mkdir -p "$(dirname "$extra_app_path")"
      cp -pR "$MOCK_EXTRA_MOUNTED_APP" "$extra_app_path"
    fi
    if [[ "${MOCK_APPLICATIONS_SYMLINK:-}" == "1" ]]; then
      ln -s /Applications "$mount_dir/Applications"
    fi
    ;;
  detach)
    rm -rf "$2/Barwarden.app" "$2/Legacy.app" "$2/Nested" "$2/Applications"
    ;;
  *)
    exit 64
    ;;
esac
SHIM

cat > "$shim_root/find" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail

inventory_traversal=false
for argument in "$@"; do
  if [[ "$argument" == '*.app' ]]; then
    inventory_traversal=true
  fi
done

if [[ "$inventory_traversal" == true && -n "${MOCK_FIND_FAILURE_PASS:-}" ]]; then
  current_pass=initial
  if [[ "${MOCK_RELEASE_MODE:-}" == "1" &&
        -f "$MOCK_RELEASE_ATTACH_COUNTER" &&
        "$(<"$MOCK_RELEASE_ATTACH_COUNTER")" == "2" ]]; then
    current_pass=final
  fi
  if [[ "$MOCK_FIND_FAILURE_PASS" == "$current_pass" ]]; then
    printf '%s\0' "$2/Barwarden.app"
    printf 'mock find traversal failure at %s mount\n' "$current_pass" >&2
    exit 70
  fi
fi

exec "$MOCK_REAL_FIND" "$@"
SHIM

cat > "$shim_root/codesign" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
printf 'codesign|%s\n' "$*" >> "$MOCK_COMMAND_LOG"
target="${@: -1}"
IFS=: read -r bundle_signature executable_signature <<<"${MOCK_SIGNATURE_STATES:-unsigned:adhoc}"
if [[ "$target" == *.app ]]; then
  signature="$bundle_signature"
  entitlements="${MOCK_BUNDLE_ENTITLEMENTS:-automation}"
else
  signature="$executable_signature"
  entitlements="${MOCK_EXECUTABLE_ENTITLEMENTS:-automation}"
fi
if [[ "$*" == *"--entitlements :-"* ]]; then
  printf 'Executable=fixture\n' >&2
  [[ "$signature" == "unsigned" ]] && exit 1
  if [[ "$entitlements" == "automation" ]]; then
    cat <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.automation.apple-events</key><true/></dict></plist>
PLIST
  elif [[ "$entitlements" == "unexpected" ]]; then
    cat <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/></dict></plist>
PLIST
  fi
  exit 0
fi
if [[ "$*" == *"--verify"* ]]; then
  [[ "$signature" == "unsigned" ]] && exit 1
  exit 0
fi
case "$signature" in
  unsigned)
    printf 'code object is not signed at all\n' >&2
    exit 1
    ;;
  adhoc)
    printf 'Signature=adhoc\n' >&2
    ;;
  developer)
    printf 'Authority=%s\n' "$MOCK_DEVELOPER_IDENTITY" >&2
    ;;
  *)
    exit 64
    ;;
esac
SHIM

cat > "$shim_root/tauri" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
printf 'tauri|identity=%s|%s\n' "${APPLE_SIGNING_IDENTITY:-}" "$*" >> "$MOCK_COMMAND_LOG"
[[ "$1" == "build" ]] || exit 64
[[ -n "${APPLE_SIGNING_IDENTITY:-}" ]] || exit 65
for variable in \
  APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_ID APPLE_PASSWORD \
  APPLE_TEAM_ID APPLE_PROVIDER_SHORT_NAME APPLE_API_ISSUER APPLE_API_KEY \
  APPLE_API_KEY_PATH APPLE_NOTARYTOOL_KEYCHAIN_PROFILE
do
  if printenv "$variable" >/dev/null 2>&1; then
    printf 'ambient Apple variable reached Tauri: %s\n' "$variable" >&2
    exit 66
  fi
done
SHIM

cat > "$shim_root/xcrun" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
printf 'xcrun|%s\n' "$*" >> "$MOCK_COMMAND_LOG"
if [[ "$1" == "notarytool" ]]; then
  [[ "$2" == "submit" && "$3" == "$MOCK_RELEASE_DMG" && "$4" == "--wait" && "$5" == "--keychain-profile" && "$6" == "$MOCK_NOTARY_PROFILE" && "$#" -eq 6 ]] || exit 64
elif [[ "$1" == "stapler" ]]; then
  [[ "$3" == "$MOCK_RELEASE_DMG" && "$#" -eq 3 ]] || exit 64
  case "$2" in
    staple)
      [[ ! -e "$MOCK_STAPLED_MARKER" ]] || exit 65
      [[ -f "$MOCK_RELEASE_ATTACH_COUNTER" && "$(<"$MOCK_RELEASE_ATTACH_COUNTER")" == "1" ]] || exit 66
      [[ "${MOCK_SUPPRESS_STAPLE_MARKER:-}" == "1" ]] || : > "$MOCK_STAPLED_MARKER"
      ;;
    validate)
      if [[ "${MOCK_SUPPRESS_STAPLE_MARKER:-}" != "1" ]]; then
        [[ -e "$MOCK_STAPLED_MARKER" ]] || exit 67
      fi
      ;;
    *)
      exit 64
      ;;
  esac
else
  exit 64
fi
SHIM

cat > "$shim_root/spctl" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
printf 'spctl|%s\n' "$*" >> "$MOCK_COMMAND_LOG"
[[ -f "$MOCK_FINAL_MOUNTED_APP_FILE" ]] || exit 64
expected_app="$(<"$MOCK_FINAL_MOUNTED_APP_FILE")"
[[ "$#" -eq 5 && "$1" == "-a" && "$2" == "-vvv" && "$3" == "-t" && "$4" == "exec" && "$5" == "$expected_app" ]] || exit 65
SHIM

chmod 755 "$shim_root/hdiutil" "$shim_root/find" "$shim_root/codesign" "$shim_root/tauri" "$shim_root/xcrun" "$shim_root/spctl"

export PATH="$shim_root:$PATH"
export MOCK_REAL_FIND="$real_find"
export MOCK_COMMAND_LOG="$command_log"
export MOCK_MOUNTED_APP="$mounted_template"
export MOCK_RELEASE_APP="$release_app"
export MOCK_RELEASE_DMG="$release_dmg"
export MOCK_RELEASE_ATTACH_COUNTER="$release_attach_counter"
export MOCK_STAPLED_MARKER="$stapled_marker"
export MOCK_FINAL_MOUNTED_APP_FILE="$final_mounted_app_file"
export MOCK_NOTARY_PROFILE="$test_profile_name"

ambient_apple_environment=()
for variable in \
  APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_ID APPLE_PASSWORD \
  APPLE_TEAM_ID APPLE_PROVIDER_SHORT_NAME APPLE_API_ISSUER APPLE_API_KEY \
  APPLE_API_KEY_PATH
do
  ambient_apple_environment+=("$variable=ambient-$test_nonce")
done

help_output="$("$verifier" --help)"
assert_contains "$help_output" "--release" "help must describe the opt-in release mode"

assert_succeeds "input validation" "$verifier" --source-root "$fixture_root" --inputs-only >/dev/null

rm "$fixture_root/PRIVACY.md"
assert_rejected \
  "missing privacy disclosure input" \
  "required file is missing" \
  "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/PRIVACY.md" "$fixture_root/PRIVACY.md"

plutil -replace LSUIElement -bool false "$source_info_plist"
assert_rejected \
  "a source Info.plist with LSUIElement disabled" \
  "unexpected LSUIElement" \
  "$verifier" --source-root "$fixture_root" --inputs-only
plutil -replace LSUIElement -bool true "$source_info_plist"

inputs_config="$fixture_root/apps/menubar-tauri/src-tauri/tauri.conf.json"
node - "$inputs_config" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const path = process.argv[2];
const config = JSON.parse(readFileSync(path, "utf8"));
config.bundle.icon = ["icons/missing.icns"];
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
NODE
assert_rejected \
  "an unexpected application icon configuration" \
  "unexpected bundle icon configuration" \
  "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/apps/menubar-tauri/src-tauri/tauri.conf.json" "$inputs_config"

node - "$inputs_config" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const path = process.argv[2];
const config = JSON.parse(readFileSync(path, "utf8"));
config.bundle.targets = ["app"];
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
NODE
assert_rejected "an incomplete target list" "bundle targets must be fixed" "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/apps/menubar-tauri/src-tauri/tauri.conf.json" "$inputs_config"

node - "$inputs_config" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const path = process.argv[2];
const config = JSON.parse(readFileSync(path, "utf8"));
config.bundle.license = "GPL-3.0-only";
config.bundle.licenseFile = "../../../LICENSE";
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
NODE
assert_rejected \
  "a DMG license agreement configuration" \
  "DMG license agreement must not be configured" \
  "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/apps/menubar-tauri/src-tauri/tauri.conf.json" "$inputs_config"

node - "$inputs_config" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const path = process.argv[2];
const config = JSON.parse(readFileSync(path, "utf8"));
const key = ["signing", "Identity"].join("");
config.bundle.macOS[key] = ["committed", "identity"].join(" ");
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
NODE
assert_rejected "a committed signing identity" "signing identity must not be committed" "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/apps/menubar-tauri/src-tauri/tauri.conf.json" "$inputs_config"

entitlements_fixture="$fixture_root/apps/menubar-tauri/src-tauri/Entitlements.plist"
node - "$entitlements_fixture" <<'NODE'
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.app-sandbox</key><true/></dict></plist>
`);
NODE
assert_rejected_with_exact_diagnostic \
  "unexpected source entitlements" \
  "AssertionError [ERR_ASSERTION]: local distribution entitlements must declare only Apple Events automation" \
  "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/apps/menubar-tauri/src-tauri/Entitlements.plist" "$entitlements_fixture"

license_fixture="$fixture_root/LICENSE"
printf 'license text without required markers\n' > "$license_fixture"
assert_rejected_with_exact_diagnostic \
  "a source license without GPL markers" \
  "FAIL: GPL license title is missing" \
  "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/LICENSE" "$license_fixture"

notice_fixture="$fixture_root/NOTICE.md"
node - "$notice_fixture" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const path = process.argv[2];
writeFileSync(path, readFileSync(path, "utf8").replace("independent GPL-3.0-only project", "separate project"));
NODE
assert_rejected_with_exact_diagnostic \
  "a source notice without independent-project attribution" \
  "FAIL: independent-project attribution is missing" \
  "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/NOTICE.md" "$notice_fixture"

node - "$notice_fixture" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const path = process.argv[2];
writeFileSync(path, readFileSync(path, "utf8").replace("It is not an official\nBitwarden product", "a separate Bitwarden client"));
NODE
assert_rejected_with_exact_diagnostic \
  "a source notice without unofficial-product attribution" \
  "FAIL: unofficial-product attribution is missing" \
  "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/NOTICE.md" "$notice_fixture"

credential_fixture="$fixture_root/scripts/verify-macos-bundle.test.sh"

while IFS='|' read -r expectation description rhs; do
  probe_sensitive_assignment "$expectation" "$description" "$rhs"
done <<'CASES'
accept|an unquoted dollar reference|$DIRECT_REFERENCE
accept|an unquoted braced reference|${DIRECT_REFERENCE}
accept|an unquoted defaulting reference|${DIRECT_REFERENCE-}
accept|a double-quoted dollar reference|"$DIRECT_REFERENCE"
accept|a double-quoted braced reference|"${DIRECT_REFERENCE}"
accept|a double-quoted defaulting reference|"${DIRECT_REFERENCE-}"
reject|an unquoted literal|forbidden-value
reject|a double-quoted literal|"forbidden value"
reject|a single-quoted literal|'forbidden value'
reject|adjacent quoted literal concatenation|"forbidden""-value"
reject|two unbraced references|$FIRST$SECOND
reject|two braced references|"${FIRST}${SECOND}"
reject|command substitution|"$(command)"
reject|backtick command substitution|`command`
reject|indirect expansion|${!INDIRECT}
reject|a braced reference with default text|${DIRECT_REFERENCE-default}
reject|an unbraced direct reference plus suffix|$DIRECT_REFERENCE-suffix
reject|a braced direct reference plus suffix|"${DIRECT_REFERENCE}-suffix"
CASES
cp "$repo_root/scripts/verify-macos-bundle.test.sh" "$credential_fixture"

printf '%s%s%s\n' '-----BEGIN ' 'PRIVATE ' 'KEY-----' >> "$credential_fixture"
assert_rejected "private-key material in a tracked distribution script" "private key or certificate block" "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/scripts/verify-macos-bundle.test.sh" "$credential_fixture"

printf '%s%s%s\n' 'APPLE_SIGNING' '_IDENTITY' '=forbidden-value' >> "$credential_fixture"
assert_rejected "a committed signing identity value" "committed sensitive Apple assignment" "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/scripts/verify-macos-bundle.test.sh" "$credential_fixture"

printf '%s%s%s\n' 'APPLE_NOTARYTOOL' '_KEYCHAIN_PROFILE' '=forbidden-value' >> "$credential_fixture"
assert_rejected "a committed notary profile value" "committed sensitive Apple assignment" "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/scripts/verify-macos-bundle.test.sh" "$credential_fixture"

printf '%s%s%s\n' 'certificate-path=forbidden.p' '1' '2' >> "$credential_fixture"
assert_rejected "a committed certificate path" "committed certificate or API key path" "$verifier" --source-root "$fixture_root" --inputs-only
cp "$repo_root/scripts/verify-macos-bundle.test.sh" "$credential_fixture"

printf '%s=%s\n' "$(printf '%s%s' 'APPLE_SIGNING' '_IDENTITY')" '${APPLE_SIGNING_IDENTITY}' >> "$credential_fixture"
assert_succeeds "an environment-only signing identity reference" "$verifier" --source-root "$fixture_root" --inputs-only >/dev/null
cp "$repo_root/scripts/verify-macos-bundle.test.sh" "$credential_fixture"

renamed_app="$fixture_root/standalone/Unexpected.app"
cp -R "$standalone_app" "$renamed_app"
assert_rejected \
  "an app input with the wrong basename" \
  "application basename mismatch" \
  env MOCK_SIGNATURE_STATES=unsigned:adhoc "$verifier" --source-root "$fixture_root" --app "$renamed_app" --dmg "$standalone_dmg"
rm -rf "$renamed_app"

renamed_dmg="$fixture_root/standalone/Unexpected.dmg"
cp "$standalone_dmg" "$renamed_dmg"
assert_rejected \
  "a DMG input with the wrong basename" \
  "DMG basename mismatch" \
  env MOCK_SIGNATURE_STATES=unsigned:adhoc "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$renamed_dmg"
rm -f "$renamed_dmg"

autofill_surface_app="$fixture_root/autofill-surface/Barwarden.app"
autofill_surface_mounted="$fixture_root/autofill-surface-mounted/Barwarden.app"
mkdir -p "$(dirname "$autofill_surface_app")" "$(dirname "$autofill_surface_mounted")"
cp -R "$standalone_app" "$autofill_surface_app"
cp -R "$standalone_app" "$autofill_surface_mounted"
for app in "$autofill_surface_app" "$autofill_surface_mounted"; do
  cat > "$app/Contents/MacOS/barwarden" <<'SHIM'
#!/usr/bin/env bash
exit 0
autofill_agent_registration_status
autofill_agent_register
autofill_agent_unregister
SHIM
  chmod 755 "$app/Contents/MacOS/barwarden"
done
assert_rejected \
  "an AutoFill-capable app bundle without native sidecars" \
  "native AutoFill sidecar inventory is missing" \
  env MOCK_SIGNATURE_STATES=unsigned:adhoc MOCK_MOUNTED_APP="$autofill_surface_mounted" \
  "$verifier" --source-root "$fixture_root" --app "$autofill_surface_app" --dmg "$standalone_dmg"

printf '#!/usr/bin/env bash\nexit 0\n' > "$standalone_app/Contents/MacOS/legacy"
chmod 755 "$standalone_app/Contents/MacOS/legacy"
cp "$standalone_app/Contents/MacOS/legacy" "$mounted_template/Contents/MacOS/legacy"
assert_rejected \
  "an app bundle with an additional executable payload" \
  "Contents/MacOS must contain only barwarden" \
  env MOCK_SIGNATURE_STATES=unsigned:adhoc "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"
rm "$standalone_app/Contents/MacOS/legacy" "$mounted_template/Contents/MacOS/legacy"

extra_mounted_app="$fixture_root/extra-mounted/Legacy.app"
write_app "$extra_mounted_app"
assert_rejected \
  "a DMG with an additional application bundle" \
  "DMG contains an additional application bundle" \
  env MOCK_SIGNATURE_STATES=unsigned:adhoc MOCK_EXTRA_MOUNTED_APP="$extra_mounted_app" \
  "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"

assert_rejected \
  "a DMG with a nested additional application bundle" \
  "DMG contains an additional application bundle" \
  env MOCK_SIGNATURE_STATES=unsigned:adhoc MOCK_EXTRA_MOUNTED_APP="$extra_mounted_app" \
  MOCK_EXTRA_MOUNTED_APP_RELATIVE_PATH="Nested/Legacy.app" \
  "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"

assert_rejected_with_sanitized_diagnostic \
  "a DMG whose application inventory traversal fails" \
  "FAIL: DMG application inventory traversal failed" \
  "mock find traversal failure at initial mount" \
  env MOCK_SIGNATURE_STATES=unsigned:adhoc MOCK_FIND_FAILURE_PASS=initial \
  "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"

applications_output="$(assert_succeeds \
  "a DMG with the standard Applications symlink" \
  env MOCK_SIGNATURE_STATES=unsigned:adhoc MOCK_APPLICATIONS_SYMLINK=1 \
  "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg")"
assert_contains "$applications_output" "ARTIFACTS: PASS" "standard Applications symlink payload"

printf 'mismatch\n' > "$mounted_template/Contents/Resources/stale-marker"
assert_rejected "a stale DMG application" "DMG app does not match standalone app" env MOCK_SIGNATURE_STATES=unsigned:adhoc "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"
rm -rf "$mounted_template"
cp -R "$standalone_app" "$mounted_template"

plutil -replace LSUIElement -bool false "$standalone_app/Contents/Info.plist"
assert_rejected \
  "an app bundle with LSUIElement disabled" \
  "LSUIElement mismatch" \
  env MOCK_SIGNATURE_STATES=unsigned:adhoc "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"
plutil -replace LSUIElement -bool true "$standalone_app/Contents/Info.plist"

plutil -replace CFBundleExecutable -string unexpected "$standalone_app/Contents/Info.plist"
assert_rejected \
  "an app bundle with a different executable name" \
  "artifact executable name mismatch" \
  env MOCK_SIGNATURE_STATES=unsigned:adhoc "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"
plutil -replace CFBundleExecutable -string barwarden "$standalone_app/Contents/Info.plist"

rm "$mounted_template/Contents/Resources/NOTICE.md"
assert_rejected "a DMG application without the bundled notice" "bundled notice differs from source" env MOCK_SIGNATURE_STATES=unsigned:adhoc "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"
rm -rf "$mounted_template"
cp -R "$standalone_app" "$mounted_template"

rm "$mounted_template/Contents/Resources/PRIVACY.md"
assert_rejected "a DMG application without the bundled privacy disclosure" "bundled privacy disclosure differs from source" env MOCK_SIGNATURE_STATES=unsigned:adhoc "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"
rm -rf "$mounted_template"
cp -R "$standalone_app" "$mounted_template"

rm "$mounted_template/Contents/Resources/THIRD_PARTY_NOTICES.md"
assert_rejected "a DMG application without bundled third-party notices" "bundled third-party notices differ from source" env MOCK_SIGNATURE_STATES=unsigned:adhoc "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"
rm -rf "$mounted_template"
cp -R "$standalone_app" "$mounted_template"

rm "$mounted_template/Contents/Resources/THIRD_PARTY_LICENSES.txt"
assert_rejected "a DMG application without complete third-party licenses" "bundled third-party licenses differ from source" env MOCK_SIGNATURE_STATES=unsigned:adhoc "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"
rm -rf "$mounted_template"
cp -R "$standalone_app" "$mounted_template"

unsigned_output="$(assert_succeeds "unsigned bundle local verification" env MOCK_SIGNATURE_STATES=unsigned:adhoc "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg")"
assert_contains "$unsigned_output" "SIGNING: BLOCKED (unsigned bundle with linker ad-hoc executable)" "unsigned bundle branch"

mkdir -p "$standalone_app/Contents/_CodeSignature" "$mounted_template/Contents/_CodeSignature"
touch "$standalone_app/Contents/_CodeSignature/CodeResources" "$mounted_template/Contents/_CodeSignature/CodeResources"
adhoc_output="$(assert_succeeds "sealed ad-hoc local verification" env MOCK_SIGNATURE_STATES=adhoc:adhoc "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg")"
assert_contains "$adhoc_output" "SIGNING: BLOCKED (ad-hoc local artifact)" "sealed ad-hoc branch"
assert_contains "$adhoc_output" "NOTARIZATION: BLOCKED" "sealed ad-hoc notarization status"
assert_contains "$adhoc_output" "STAPLING: BLOCKED" "sealed ad-hoc stapling status"
assert_contains "$adhoc_output" "GATEKEEPER: BLOCKED" "sealed ad-hoc Gatekeeper status"
assert_not_contains "$adhoc_output" "RELEASE: PASS" "sealed ad-hoc artifact must remain release-blocked"

assert_rejected_with_exact_diagnostic \
  "unexpected sealed bundle entitlements" \
  "AssertionError [ERR_ASSERTION]: built application contains unexpected entitlements" \
  env MOCK_SIGNATURE_STATES=adhoc:adhoc MOCK_BUNDLE_ENTITLEMENTS=unexpected \
  "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"

assert_rejected_with_exact_diagnostic \
  "unexpected sealed executable entitlements" \
  "AssertionError [ERR_ASSERTION]: built application contains unexpected entitlements" \
  env MOCK_SIGNATURE_STATES=adhoc:adhoc MOCK_EXECUTABLE_ENTITLEMENTS=unexpected \
  "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg"

rm -rf "$standalone_app/Contents/_CodeSignature" "$mounted_template/Contents/_CodeSignature"

mkdir -p "$standalone_app/Contents/_CodeSignature" "$mounted_template/Contents/_CodeSignature"
touch "$standalone_app/Contents/_CodeSignature/CodeResources" "$mounted_template/Contents/_CodeSignature/CodeResources"
developer_output="$(assert_succeeds "Developer ID local verification" env MOCK_SIGNATURE_STATES=developer:developer MOCK_DEVELOPER_IDENTITY="$test_identity" "$verifier" --source-root "$fixture_root" --app "$standalone_app" --dmg "$standalone_dmg")"
assert_contains "$developer_output" "SIGNING: BLOCKED (local verification does not run release signing gates)" "Developer ID local branch"

assert_rejected "release mode without external inputs" "--release requires APPLE_SIGNING_IDENTITY" "$verifier" --source-root "$fixture_root" --release
assert_rejected "release mode without a notary profile" "--release requires APPLE_NOTARYTOOL_KEYCHAIN_PROFILE" env APPLE_SIGNING_IDENTITY="$test_identity" "$verifier" --source-root "$fixture_root" --release
rm -rf "$mounted_template"
cp -R "$release_app" "$mounted_template"
mkdir -p "$release_app/Contents/_CodeSignature" "$mounted_template/Contents/_CodeSignature"
touch "$release_app/Contents/_CodeSignature/CodeResources" "$mounted_template/Contents/_CodeSignature/CodeResources"
wrong_test_identity="$test_identity_prefix Wrong Signer ($test_identity_team)"
rm -f "$release_attach_counter" "$stapled_marker" "$final_mounted_app_file"
assert_rejected "a Developer ID signature from the wrong identity" "Developer ID signature does not match APPLE_SIGNING_IDENTITY" \
  env "${ambient_apple_environment[@]}" APPLE_SIGNING_IDENTITY="$test_identity" APPLE_NOTARYTOOL_KEYCHAIN_PROFILE="$test_profile_name" \
  MOCK_RELEASE_MODE=1 MOCK_SIGNATURE_STATES=developer:developer MOCK_DEVELOPER_IDENTITY="$wrong_test_identity" MOCK_MOUNTED_APP="$release_app" \
  "$verifier" --source-root "$fixture_root" --release

rm -f "$release_attach_counter" "$stapled_marker" "$final_mounted_app_file"
assert_rejected_with_exact_diagnostic \
  "a final release attach without a stapled DMG marker" \
  "final release attach requires stapled DMG marker" \
  env "${ambient_apple_environment[@]}" APPLE_SIGNING_IDENTITY="$test_identity" APPLE_NOTARYTOOL_KEYCHAIN_PROFILE="$test_profile_name" \
  MOCK_RELEASE_MODE=1 MOCK_SUPPRESS_STAPLE_MARKER=1 MOCK_SIGNATURE_STATES=developer:developer MOCK_DEVELOPER_IDENTITY="$test_identity" MOCK_MOUNTED_APP="$release_app" \
  "$verifier" --source-root "$fixture_root" --release

rm -f "$release_attach_counter" "$stapled_marker" "$final_mounted_app_file"
assert_rejected_with_sanitized_diagnostic \
  "a final stapled DMG whose application inventory traversal fails" \
  "FAIL: final stapled DMG application inventory traversal failed" \
  "mock find traversal failure at final mount" \
  env "${ambient_apple_environment[@]}" APPLE_SIGNING_IDENTITY="$test_identity" APPLE_NOTARYTOOL_KEYCHAIN_PROFILE="$test_profile_name" \
  MOCK_RELEASE_MODE=1 MOCK_FIND_FAILURE_PASS=final MOCK_SIGNATURE_STATES=developer:developer MOCK_DEVELOPER_IDENTITY="$test_identity" MOCK_MOUNTED_APP="$release_app" \
  "$verifier" --source-root "$fixture_root" --release

: > "$command_log"
rm -f "$release_attach_counter" "$stapled_marker" "$final_mounted_app_file"
release_output="$(assert_succeeds "shimmed release verification" \
  env "${ambient_apple_environment[@]}" APPLE_SIGNING_IDENTITY="$test_identity" APPLE_NOTARYTOOL_KEYCHAIN_PROFILE="$test_profile_name" \
  MOCK_RELEASE_MODE=1 MOCK_SIGNATURE_STATES=developer:developer MOCK_DEVELOPER_IDENTITY="$test_identity" MOCK_MOUNTED_APP="$release_app" \
  "$verifier" --source-root "$fixture_root" --release)"
assert_contains "$release_output" "RELEASE: PASS (Developer ID signing and final DMG notarization/stapling checks completed)" "release result"
assert_contains "$(cat "$command_log")" "tauri|identity=$test_identity|build --config" "Tauri build identity propagation"
expected_notary="xcrun|notarytool submit $release_dmg --wait --keychain-profile $test_profile_name"
assert_contains "$(cat "$command_log")" "$expected_notary" "exact notary submission"

first_attach="$(grep '^hdiutil|attach ' "$command_log" | sed -n '1p')"
final_attach="$(grep '^hdiutil|attach ' "$command_log" | sed -n '2p')"
first_mount="$(awk '{ for (i = 1; i <= NF; i++) if ($i == "-mountpoint") print $(i + 1) }' <<<"$first_attach")"
final_mount="$(awk '{ for (i = 1; i <= NF; i++) if ($i == "-mountpoint") print $(i + 1) }' <<<"$final_attach")"
[[ -n "$first_mount" && -n "$final_mount" && "$first_mount" != "$final_mount" ]] || fail "release mounts were not distinct"

actual_sequence="$(grep -E '^(hdiutil\|(attach|detach) |xcrun\||spctl\|)' "$command_log")"
expected_sequence="$(printf '%s\n' \
  "hdiutil|attach -readonly -nobrowse -mountpoint $first_mount $release_dmg" \
  "hdiutil|detach $first_mount -quiet" \
  "$expected_notary" \
  "xcrun|stapler staple $release_dmg" \
  "xcrun|stapler validate $release_dmg" \
  "hdiutil|attach -readonly -nobrowse -mountpoint $final_mount $release_dmg" \
  "spctl|-a -vvv -t exec $final_mount/Barwarden.app" \
  "hdiutil|detach $final_mount -quiet")"
[[ "$actual_sequence" == "$expected_sequence" ]] || fail "complete release sequence was not exact: $actual_sequence"
[[ "$(<"$release_attach_counter")" == "2" && -e "$stapled_marker" ]] || fail "release attach/staple state was incomplete"

printf 'macOS bundle verifier tests: PASS\n'
