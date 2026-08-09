#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
VERIFIER="$SCRIPT_DIR/verify-native-autofill-bundle.sh"
FIXTURE_RUNNER="$SCRIPT_DIR/verify-native-autofill-inspection-fixture.mjs"
VALID_FIXTURE="$SCRIPT_DIR/fixtures/native-autofill-release/valid-inspection.json"
TEST_ROOT="$(mktemp -d /private/tmp/barwarden-native-release-verifier.XXXXXX)"
trap '/bin/rm -rf "$TEST_ROOT"' EXIT

fail() {
  printf 'verify-native-autofill-bundle tests: FAIL: %s\n' "$*" >&2
  exit 1
}

run_fixture() {
  node "$FIXTURE_RUNNER" "$1" 2>&1
}

assert_passes() {
  local output
  output="$(run_fixture "$1")" || fail "expected fixture to pass: $output"
  [[ "$output" == *'NATIVE_AUTOFILL_RELEASE_GATE_PASS'* ]] || fail "missing pass code: $output"
}

assert_rejected() {
  local fixture="$1" expected_code="$2" output
  if output="$(run_fixture "$fixture")"; then
    fail "expected $expected_code rejection"
  fi
  [[ "$output" == *"$expected_code"* ]] || fail "expected $expected_code, got: $output"
  [[ "$output" != *'/Users/'* && "$output" != *'/private/tmp/'* ]] || fail "diagnostic leaked a path: $output"
}

mutate() {
  local name="$1" expression="$2" target
  target="$TEST_ROOT/$name.json"
  node - "$VALID_FIXTURE" "$target" "$expression" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const source = JSON.parse(readFileSync(process.argv[2], "utf8"));
const mutation = Function("fixture", `"use strict"; ${process.argv[4]}`);
mutation(source);
writeFileSync(process.argv[3], `${JSON.stringify(source, null, 2)}\n`);
NODE
  printf '%s\n' "$target"
}

assert_passes "$VALID_FIXTURE"
assert_rejected "$(mutate missing 'fixture.inventory = fixture.inventory.filter((item) => item.role !== "agent");')" NATIVE_AUTOFILL_INVENTORY_MISSING
assert_rejected "$(mutate duplicate 'fixture.inventory.push(structuredClone(fixture.inventory[1]));')" NATIVE_AUTOFILL_INVENTORY_DUPLICATE
assert_rejected "$(mutate unexpected 'fixture.unexpectedNestedCode = ["Contents/Frameworks/Unexpected.framework"];')" NATIVE_AUTOFILL_INVENTORY_UNEXPECTED
assert_rejected "$(mutate symlink 'fixture.unexpectedSymlinks = ["Contents/Resources/link"];')" NATIVE_AUTOFILL_SYMLINK_FORBIDDEN
assert_rejected "$(mutate macho 'fixture.unexpectedMachO = ["Contents/Resources/tool"];')" NATIVE_AUTOFILL_INVENTORY_UNEXPECTED
assert_rejected "$(mutate dylib 'fixture.unexpectedDylibs = ["Contents/Frameworks/libbad.dylib"];')" NATIVE_AUTOFILL_INVENTORY_UNEXPECTED
assert_rejected "$(mutate team 'fixture.inventory[1].teamId = "OTHERTEAM1";')" NATIVE_AUTOFILL_TEAM_MISMATCH
assert_rejected "$(mutate bundle 'fixture.inventory[1].bundleId = "com.example.provider";')" NATIVE_AUTOFILL_BUNDLE_ID_MISMATCH
assert_rejected "$(mutate missing_group 'fixture.inventory[0].appGroups = [];')" NATIVE_AUTOFILL_APP_GROUP_MISSING
assert_rejected "$(mutate unexpected_group 'fixture.inventory[1].appGroups.push("group.com.example.shared");')" NATIVE_AUTOFILL_APP_GROUP_UNEXPECTED
assert_rejected "$(mutate keychain_group 'fixture.inventory[2].keychainGroups = ["K7LY92JY96.shared"];')" NATIVE_AUTOFILL_KEYCHAIN_GROUP_FORBIDDEN
assert_rejected "$(mutate extra_entitlement 'fixture.inventory[0].entitlementKeys.push("com.apple.security.network.client");')" NATIVE_AUTOFILL_ENTITLEMENT_INVENTORY_INVALID
assert_rejected "$(mutate unsigned 'fixture.inventory[2].signatureKind = "unsigned"; fixture.inventory[2].signatureValid = false;')" NATIVE_AUTOFILL_INNER_UNSIGNED
assert_rejected "$(mutate sign_order 'fixture.insideOutSigning = false;')" NATIVE_AUTOFILL_SIGN_ORDER_INVALID
assert_rejected "$(mutate deep_sign 'fixture.signingUsedDeep = true;')" NATIVE_AUTOFILL_SIGN_DEEP_FORBIDDEN
assert_rejected "$(mutate runtime 'fixture.inventory[1].hardenedRuntime = false;')" NATIVE_AUTOFILL_HARDENED_RUNTIME_MISSING
assert_rejected "$(mutate app_staple 'fixture.appStapled = false;')" NATIVE_AUTOFILL_APP_STAPLE_MISSING
assert_rejected "$(mutate dmg_staple 'fixture.dmgStapled = false;')" NATIVE_AUTOFILL_DMG_STAPLE_MISSING
assert_rejected "$(mutate floor 'fixture.inventory[2].minimumMacOS = "14.0";')" NATIVE_AUTOFILL_MACOS_FLOOR_INVALID
assert_rejected "$(mutate requirement 'fixture.inventory[0].designatedRequirementValid = false;')" NATIVE_AUTOFILL_DESIGNATED_REQUIREMENT_INVALID
assert_rejected "$(mutate seal 'fixture.outerSealValid = false;')" NATIVE_AUTOFILL_OUTER_SEAL_INVALID
assert_rejected "$(mutate provider_profile 'fixture.providerProfileValid = false;')" NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID
assert_rejected "$(mutate provider_profile_key 'fixture.inventory[1].profileApplicationIdentifierKey = "application-identifier";')" NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID
assert_rejected "$(mutate provider_app_id 'fixture.inventory[1].applicationIdentifier = "K7LY92JY96.com.example.provider";')" NATIVE_AUTOFILL_PROVIDER_ENTITLEMENT_INVALID
assert_rejected "$(mutate provider_team_id 'fixture.inventory[1].developerTeamIdentifier = "OTHERTEAM1";')" NATIVE_AUTOFILL_PROVIDER_ENTITLEMENT_INVALID
assert_rejected "$(mutate provider_profile_extra 'fixture.inventory[1].profileEntitlementKeys.push("get-task-allow");')" NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID
assert_rejected "$(mutate provider_profile_cert 'fixture.inventory[1].profileCertificateMatchesSigner = false;')" NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID
assert_rejected "$(mutate app_id_on_main 'fixture.inventory[0].applicationIdentifier = "K7LY92JY96.com.sommir.barwarden"; fixture.inventory[0].entitlementKeys.push("com.apple.application-identifier");')" NATIVE_AUTOFILL_ENTITLEMENT_INVENTORY_INVALID
assert_rejected "$(mutate launch_agent 'fixture.launchAgentValid = false;')" NATIVE_AUTOFILL_LAUNCH_AGENT_INVALID
assert_rejected "$(mutate command_surface 'fixture.registrationCommandSurfaceValid = false;')" NATIVE_AUTOFILL_AGENT_REGISTRATION_SURFACE_MISSING
assert_rejected "$(mutate version 'fixture.productVersion = "0.1.3";')" NATIVE_AUTOFILL_VERSION_MISMATCH
assert_rejected "$(mutate manifest_hash 'fixture.attestedAppManifestSha256 = "c".repeat(64);')" NATIVE_AUTOFILL_ATTESTATION_INVALID
assert_rejected "$(mutate builder_policy_hash 'fixture.builderPolicyHashValid = false;')" NATIVE_AUTOFILL_ATTESTATION_INVALID
assert_rejected "$(mutate dmg_inventory 'fixture.dmgInventoryValid = false;')" NATIVE_AUTOFILL_DMG_INVENTORY_INVALID
assert_rejected "$(mutate dmg_signature 'fixture.dmgSignatureValid = false;')" NATIVE_AUTOFILL_DMG_SIGNATURE_INVALID
assert_rejected "$(mutate provider_capability 'fixture.inventory[1].credentialProvider = false;')" NATIVE_AUTOFILL_PROVIDER_ENTITLEMENT_INVALID
assert_rejected "$(mutate unexpected_provider_capability 'fixture.inventory[0].credentialProvider = true;')" NATIVE_AUTOFILL_PROVIDER_ENTITLEMENT_UNEXPECTED
assert_rejected "$(mutate sandbox 'fixture.inventory[1].appSandbox = false;')" NATIVE_AUTOFILL_PROVIDER_SANDBOX_INVALID
assert_rejected "$(mutate notarization 'fixture.notarized = false;')" NATIVE_AUTOFILL_NOTARIZATION_MISSING
assert_rejected "$(mutate dmg_notarization 'fixture.dmgNotarized = false;')" NATIVE_AUTOFILL_NOTARIZATION_MISSING
assert_rejected "$(mutate app_gatekeeper 'fixture.appGatekeeperAccepted = false;')" NATIVE_AUTOFILL_APP_GATEKEEPER_REJECTED
assert_rejected "$(mutate dmg_gatekeeper 'fixture.dmgGatekeeperAccepted = false;')" NATIVE_AUTOFILL_DMG_GATEKEEPER_REJECTED

fixture_cli_output="$(NATIVE_AUTOFILL_VERIFIER_TEST_MODE=1 "$VERIFIER" --inspection-json "$VALID_FIXTURE" 2>&1 || true)"
[[ "$fixture_cli_output" == NATIVE_AUTOFILL_ARGUMENT_INVALID ]] || \
  fail "production verifier exposed a fixture path: $fixture_cli_output"

UNSIGNED_APP="$TEST_ROOT/unsigned/Barwarden.app"
UNSIGNED_PROVIDER="$UNSIGNED_APP/Contents/PlugIns/BarwardenCredentialProvider.appex"
/bin/mkdir -p "$UNSIGNED_APP/Contents/MacOS" "$UNSIGNED_APP/Contents/Helpers" \
  "$UNSIGNED_APP/Contents/Library/LaunchAgents" "$UNSIGNED_PROVIDER/Contents/MacOS"
/usr/bin/plutil -create xml1 "$UNSIGNED_APP/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleIdentifier -string com.sommir.barwarden "$UNSIGNED_APP/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleExecutable -string barwarden "$UNSIGNED_APP/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleShortVersionString -string 0.1.2 "$UNSIGNED_APP/Contents/Info.plist"
/usr/bin/plutil -insert LSMinimumSystemVersion -string 13.0 "$UNSIGNED_APP/Contents/Info.plist"
/usr/bin/plutil -create xml1 "$UNSIGNED_PROVIDER/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleIdentifier -string com.sommir.barwarden.credential-provider "$UNSIGNED_PROVIDER/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleExecutable -string BarwardenCredentialProvider "$UNSIGNED_PROVIDER/Contents/Info.plist"
/usr/bin/plutil -insert CFBundleShortVersionString -string 0.1.2 "$UNSIGNED_PROVIDER/Contents/Info.plist"
/usr/bin/plutil -insert LSMinimumSystemVersion -string 13.0 "$UNSIGNED_PROVIDER/Contents/Info.plist"
printf '#!/bin/sh\nexit 0\nautofill_agent_registration_status\nautofill_agent_register\nautofill_agent_unregister\n' > "$UNSIGNED_APP/Contents/MacOS/barwarden"
printf '#!/bin/sh\nexit 0\n' > "$UNSIGNED_PROVIDER/Contents/MacOS/BarwardenCredentialProvider"
printf '#!/bin/sh\nexit 0\n' > "$UNSIGNED_APP/Contents/Helpers/BarwardenAutoFillAgent"
/bin/cp "$REPOSITORY_ROOT/apps/macos-autofill/Agent/com.sommir.barwarden.autofill-agent.plist" \
  "$UNSIGNED_APP/Contents/Library/LaunchAgents/com.sommir.barwarden.autofill-agent.plist"
/bin/chmod 755 \
  "$UNSIGNED_APP/Contents/MacOS/barwarden" \
  "$UNSIGNED_PROVIDER/Contents/MacOS/BarwardenCredentialProvider" \
  "$UNSIGNED_APP/Contents/Helpers/BarwardenAutoFillAgent"
: > "$TEST_ROOT/unsigned/Barwarden-0.1.2.dmg"
/bin/cp "$VALID_FIXTURE" "$TEST_ROOT/unsigned/attestation.json"
production_output="$(
  "$VERIFIER" \
    --app "$UNSIGNED_APP" \
    --dmg "$TEST_ROOT/unsigned/Barwarden-0.1.2.dmg" \
    --attestation "$TEST_ROOT/unsigned/attestation.json" 2>&1 || true
)"
[[ "$production_output" == 'NATIVE_AUTOFILL_INNER_UNSIGNED' ]] || \
  fail "unsigned production bundle did not fail closed: $production_output"
[[ "$production_output" != *'/Users/'* && "$production_output" != *'/private/tmp/'* ]] || \
  fail "production diagnostic leaked a path"

/bin/ln -s "$UNSIGNED_APP" "$TEST_ROOT/symlink-app"
symlink_output="$(
  "$VERIFIER" \
    --app "$TEST_ROOT/symlink-app" \
    --dmg "$TEST_ROOT/unsigned/Barwarden-0.1.2.dmg" \
    --attestation "$TEST_ROOT/unsigned/attestation.json" 2>&1 || true
)"
[[ "$symlink_output" == NATIVE_AUTOFILL_SYMLINK_FORBIDDEN ]] || \
  fail "symlink artifact did not receive fixed rejection: $symlink_output"

ADHOC_APP="$TEST_ROOT/adhoc/Barwarden.app"
/bin/mkdir -p "$TEST_ROOT/adhoc"
/usr/bin/ditto --norsrc --noqtn "$UNSIGNED_APP" "$ADHOC_APP"
printf '%s\n' \
  '#include <stdio.h>' \
  'const char *a="autofill_agent_registration_status";' \
  'const char *b="autofill_agent_register";' \
  'const char *c="autofill_agent_unregister";' \
  'int main(void) { return a[0] + b[0] + c[0] == 0; }' \
  > "$TEST_ROOT/adhoc-main.c"
/usr/bin/xcrun clang -mmacosx-version-min=13.0 "$TEST_ROOT/adhoc-main.c" -o "$ADHOC_APP/Contents/MacOS/barwarden"
/bin/cp /usr/bin/true "$ADHOC_APP/Contents/PlugIns/BarwardenCredentialProvider.appex/Contents/MacOS/BarwardenCredentialProvider"
/bin/cp /usr/bin/true "$ADHOC_APP/Contents/Helpers/BarwardenAutoFillAgent"
/usr/bin/codesign --force --sign - "$ADHOC_APP/Contents/Helpers/BarwardenAutoFillAgent" >/dev/null 2>&1
/usr/bin/codesign --force --sign - "$ADHOC_APP/Contents/PlugIns/BarwardenCredentialProvider.appex" >/dev/null 2>&1
/usr/bin/codesign --force --sign - "$ADHOC_APP" >/dev/null 2>&1
: > "$TEST_ROOT/adhoc/Barwarden-0.1.2.dmg"
/bin/cp "$VALID_FIXTURE" "$TEST_ROOT/adhoc/attestation.json"
adhoc_output="$(
  "$VERIFIER" \
    --app "$ADHOC_APP" \
    --dmg "$TEST_ROOT/adhoc/Barwarden-0.1.2.dmg" \
    --attestation "$TEST_ROOT/adhoc/attestation.json" 2>&1 || true
)"
[[ "$adhoc_output" == 'NATIVE_AUTOFILL_INNER_UNSIGNED' ]] || \
  fail "ad-hoc inner code was not classified as unsigned: $adhoc_output"

deep_lines="$(rg -n '/usr/bin/codesign.*--deep' "$SCRIPT_DIR/build-native-autofill-release.sh" || true)"
if [[ -n "$deep_lines" && "$deep_lines" != *'--verify --deep'* ]]; then
  fail "release builder must never use codesign --deep outside verification"
fi

printf 'verify-native-autofill-bundle tests: PASS\n'
