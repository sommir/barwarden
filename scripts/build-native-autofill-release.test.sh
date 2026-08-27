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
  embed-provider-profile \
  sign-agent \
  sign-credential-provider \
  verify-inner-designated-requirements \
  sign-main-app \
  verify-outer-seal \
  submit-app-for-notarization \
  staple-app \
  create-dmg \
  sign-dmg \
  submit-dmg-for-notarization \
  staple-dmg \
  run-strict-release-verifier \
  write-sanitized-evidence \
  promote-complete-release)"
[[ "$plan" == "$expected_plan" ]] || fail "inside-out release plan changed"

preflight_output="$(NATIVE_AUTOFILL_RELEASE_TEST_MODE=1 "$BUILDER" --preflight 2>&1 || true)"
for code in \
  NATIVE_AUTOFILL_SIGNING_IDENTITY_MISSING \
  NATIVE_AUTOFILL_SIGNING_KEYCHAIN_MISSING \
  NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING \
  NATIVE_AUTOFILL_NOTARY_PROFILE_MISSING
do
  [[ "$preflight_output" == *"$code"* ]] || fail "missing preflight code $code"
done
[[ "$preflight_output" != *'/Users/'* && "$preflight_output" != *'/private/tmp/'* ]] || fail "preflight leaked a path"

: > "$TEST_ROOT/provider.provisionprofile"
: > "$TEST_ROOT/signing.keychain-db"
complete_output="$(
  NATIVE_AUTOFILL_RELEASE_TEST_MODE=1 \
  NATIVE_AUTOFILL_SIGNING_IDENTITY=external-reference \
  NATIVE_AUTOFILL_SIGNING_KEYCHAIN="$TEST_ROOT/signing.keychain-db" \
  NATIVE_AUTOFILL_PROVIDER_PROFILE="$TEST_ROOT/provider.provisionprofile" \
  NATIVE_AUTOFILL_NOTARY_PROFILE=keychain-reference \
  "$BUILDER" --preflight
)" || fail "complete external-reference preflight failed"
[[ "$complete_output" == 'NATIVE_AUTOFILL_RELEASE_PREFLIGHT_PASS' ]] || \
  fail "unexpected complete preflight output: $complete_output"

/bin/mkdir -p "$TEST_ROOT/real-output-parent"
/bin/ln -s "$TEST_ROOT/real-output-parent" "$TEST_ROOT/symlink-output-parent"
unsafe_output="$(
  NATIVE_AUTOFILL_RELEASE_TEST_MODE=1 \
  "$BUILDER" --test-output-path "$TEST_ROOT/symlink-output-parent/output" 2>&1 || true
)"
[[ "$unsafe_output" == NATIVE_AUTOFILL_OUTPUT_DIR_INVALID ]] || \
  fail "symlink ancestor was accepted: $unsafe_output"

node --test "$SCRIPT_DIR/native-autofill-builder-policy.spec.mjs" || fail "static codesign policy failed"
"$SCRIPT_DIR/create-native-autofill-provider-entitlements.test.sh" || fail "Provider entitlement generation failed"

evidence_line="$(rg -n 'record-native-autofill-evidence\.mjs.*ARTIFACT_PASS' "$BUILDER" | cut -d: -f1)"
promotion_line="$(rg -n 'native-autofill-atomic-promotion\.mjs' "$BUILDER" | tail -1 | cut -d: -f1)"
[[ -n "$evidence_line" && -n "$promotion_line" && "$evidence_line" -lt "$promotion_line" ]] || \
  fail "evidence must be staged before the single release promotion"

rg -q 'STRICT_VERIFIER_OUTPUT=' "$BUILDER" || \
  fail "strict verifier output must be captured for sanitized diagnostics"
rg -q 'fail "\$STRICT_VERIFIER_CODE"' "$BUILDER" || \
  fail "strict verifier failure must pass through the release-code allowlist"

printf 'build-native-autofill-release tests: PASS\n'
