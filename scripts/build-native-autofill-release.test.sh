#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
BUILDER="$SCRIPT_DIR/build-native-autofill-release.sh"
TEST_ROOT="$(mktemp -d /private/tmp/barwarden-native-release-builder.XXXXXX)"
trap '/bin/rm -rf "$TEST_ROOT"' EXIT

fail() {
  printf 'build-native-autofill-release tests: FAIL: %s\n' "$*" >&2
  exit 1
}

plan="$(NATIVE_AUTOFILL_RELEASE_TEST_MODE=1 "$BUILDER" --print-plan)" || fail "plan command failed"
expected_plan="$(printf '%s\n' \
  build-main-app-unsigned \
  build-native-sidecars-unsigned \
  embed-credential-provider \
  embed-agent \
  embed-launch-agent \
  embed-external-profiles \
  sign-agent \
  sign-credential-provider \
  verify-inner-designated-requirements \
  sign-main-app \
  verify-outer-seal \
  submit-app-for-notarization \
  staple-app \
  create-dmg \
  submit-dmg-for-notarization \
  staple-dmg \
  run-strict-release-verifier \
  write-sanitized-evidence)"
[[ "$plan" == "$expected_plan" ]] || fail "inside-out release plan changed"

preflight_output="$(NATIVE_AUTOFILL_RELEASE_TEST_MODE=1 "$BUILDER" --preflight 2>&1 || true)"
for code in \
  NATIVE_AUTOFILL_SIGNING_IDENTITY_MISSING \
  NATIVE_AUTOFILL_APP_PROFILE_MISSING \
  NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING \
  NATIVE_AUTOFILL_NOTARY_PROFILE_MISSING
do
  [[ "$preflight_output" == *"$code"* ]] || fail "missing preflight code $code"
done
[[ "$preflight_output" != *'/Users/'* && "$preflight_output" != *'/private/tmp/'* ]] || fail "preflight leaked a path"

: > "$TEST_ROOT/app.provisionprofile"
: > "$TEST_ROOT/provider.provisionprofile"
complete_output="$(
  NATIVE_AUTOFILL_RELEASE_TEST_MODE=1 \
  NATIVE_AUTOFILL_SIGNING_IDENTITY=external-reference \
  NATIVE_AUTOFILL_APP_PROFILE="$TEST_ROOT/app.provisionprofile" \
  NATIVE_AUTOFILL_PROVIDER_PROFILE="$TEST_ROOT/provider.provisionprofile" \
  NATIVE_AUTOFILL_NOTARY_PROFILE=keychain-reference \
  "$BUILDER" --preflight 2>&1 || true
)"
[[ "$complete_output" == 'NATIVE_AUTOFILL_AGENT_RESTRICTED_ENTITLEMENT_UNPACKAGEABLE' ]] || \
  fail "raw Agent restricted-entitlement shape was not rejected: $complete_output"

/bin/mkdir -p "$TEST_ROOT/real-output-parent"
/bin/ln -s "$TEST_ROOT/real-output-parent" "$TEST_ROOT/symlink-output-parent"
unsafe_output="$(
  NATIVE_AUTOFILL_RELEASE_TEST_MODE=1 \
  "$BUILDER" --test-output-path "$TEST_ROOT/symlink-output-parent/output" 2>&1 || true
)"
[[ "$unsafe_output" == NATIVE_AUTOFILL_OUTPUT_DIR_INVALID ]] || \
  fail "symlink ancestor was accepted: $unsafe_output"

deep_lines="$(rg -n '/usr/bin/codesign.*--deep' "$BUILDER" || true)"
if [[ -n "$deep_lines" && "$deep_lines" != *'--verify --deep'* ]]; then
  fail "codesign --deep is forbidden outside verification"
fi

printf 'build-native-autofill-release tests: PASS\n'
