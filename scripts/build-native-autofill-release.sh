#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
TEAM_ID="K7LY92JY96"
APP_NAME="Barwarden.app"
PROVIDER_NAME="BarwardenCredentialProvider.appex"
AGENT_NAME="BarwardenAutoFillAgent"
PLAN=(
  build-main-app-unsigned
  build-native-sidecars-unsigned
  embed-credential-provider
  embed-agent
  embed-launch-agent
  embed-provider-profile
  sign-agent
  sign-credential-provider
  verify-inner-designated-requirements
  sign-main-app
  verify-outer-seal
  submit-app-for-notarization
  staple-app
  create-dmg
  sign-dmg
  submit-dmg-for-notarization
  staple-dmg
  run-strict-release-verifier
  write-sanitized-evidence
  promote-complete-release
)

fail() {
  local sanitized
  sanitized="$(node "$SCRIPT_DIR/native-autofill-release-codes.mjs" "$1" 2>/dev/null)" || \
    sanitized=NATIVE_AUTOFILL_INTERNAL_ERROR
  printf '%s\n' "$sanitized" >&2
  exit 1
}

reject_symlink_components() {
  local target="$1" current="/" component
  local components
  IFS='/' read -r -a components <<< "${target#/}"
  for component in "${components[@]}"; do
    [[ -n "$component" ]] || continue
    current="${current%/}/$component"
    [[ ! -L "$current" ]] || return 1
  done
}

emit_preflight_codes() {
  local failed=0
  [[ -n "${NATIVE_AUTOFILL_SIGNING_IDENTITY:-}" ]] || {
    printf '%s\n' NATIVE_AUTOFILL_SIGNING_IDENTITY_MISSING >&2
    failed=1
  }
  [[ -n "${NATIVE_AUTOFILL_PROVIDER_PROFILE:-}" && -f "${NATIVE_AUTOFILL_PROVIDER_PROFILE:-}" ]] || {
    printf '%s\n' NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING >&2
    failed=1
  }
  [[ -n "${NATIVE_AUTOFILL_NOTARY_PROFILE:-}" ]] || {
    printf '%s\n' NATIVE_AUTOFILL_NOTARY_PROFILE_MISSING >&2
    failed=1
  }
  return "$failed"
}

if ! BUILDER_POLICY_CODE="$(/usr/bin/env node "$SCRIPT_DIR/native-autofill-builder-policy.mjs" "$0" 2>&1)"; then
  fail "$BUILDER_POLICY_CODE"
fi

case "${1:-}" in
  --print-plan)
    [[ "${NATIVE_AUTOFILL_RELEASE_TEST_MODE:-0}" == 1 ]] || fail NATIVE_AUTOFILL_TEST_MODE_REQUIRED
    printf '%s\n' "${PLAN[@]}"
    exit 0
    ;;
  --preflight)
    if emit_preflight_codes; then
      printf '%s\n' NATIVE_AUTOFILL_RELEASE_PREFLIGHT_PASS
      exit 0
    fi
    exit 1
    ;;
  --test-output-path)
    [[ "${NATIVE_AUTOFILL_RELEASE_TEST_MODE:-0}" == 1 && $# -eq 2 && "$2" = /* ]] || \
      fail NATIVE_AUTOFILL_TEST_MODE_REQUIRED
    reject_symlink_components "$2" || fail NATIVE_AUTOFILL_OUTPUT_DIR_INVALID
    printf '%s\n' NATIVE_AUTOFILL_OUTPUT_DIR_VALID
    exit 0
    ;;
  "") ;;
  *) fail NATIVE_AUTOFILL_ARGUMENT_INVALID ;;
esac

emit_preflight_codes || exit 1

OUTPUT_DIR="${NATIVE_AUTOFILL_OUTPUT_DIR:-}"
[[ "$OUTPUT_DIR" = /* ]] || fail NATIVE_AUTOFILL_OUTPUT_DIR_INVALID
reject_symlink_components "$OUTPUT_DIR" || fail NATIVE_AUTOFILL_OUTPUT_DIR_INVALID
OUTPUT_PARENT="$(dirname "$OUTPUT_DIR")"
[[ -d "$OUTPUT_PARENT" && ! -e "$OUTPUT_DIR" ]] || fail NATIVE_AUTOFILL_OUTPUT_DIR_NOT_EMPTY
reject_symlink_components "$OUTPUT_PARENT" || fail NATIVE_AUTOFILL_OUTPUT_DIR_INVALID

WORK_ROOT="$(/usr/bin/mktemp -d /private/tmp/barwarden-native-release.XXXXXX)"
OVERLAY_CONFIG="$(/usr/bin/mktemp "$REPOSITORY_ROOT/apps/menubar-tauri/src-tauri/.tauri-native-autofill.XXXXXX.json")"
cleanup() {
  /bin/rm -f "$OVERLAY_CONFIG"
  /bin/rm -rf "$WORK_ROOT"
}
trap cleanup EXIT
run_or_fail() {
  local code="$1"
  shift
  if ! "$@" >/dev/null 2>&1; then
    fail "$code"
  fi
}

if [[ -z "${DEVELOPER_DIR:-}" ]]; then
  DEVELOPER_DIR="$(/usr/bin/xcode-select -p 2>/dev/null)" || fail NATIVE_AUTOFILL_XCODE_UNAVAILABLE
fi
[[ -x "$DEVELOPER_DIR/usr/bin/xcodebuild" ]] || fail NATIVE_AUTOFILL_XCODE_UNAVAILABLE

run_or_fail NATIVE_AUTOFILL_CONFIG_BUILD_FAILED \
  /usr/bin/env node "$SCRIPT_DIR/create-native-autofill-config.mjs" "$OVERLAY_CONFIG"

CARGO_TARGET_DIR="$WORK_ROOT/cargo-target"
run_or_fail NATIVE_AUTOFILL_MAIN_APP_BUILD_FAILED \
  /usr/bin/env CARGO_TARGET_DIR="$CARGO_TARGET_DIR" DEVELOPER_DIR="$DEVELOPER_DIR" \
  npx tauri build --config "$OVERLAY_CONFIG"
MAIN_APP_SOURCE="$CARGO_TARGET_DIR/release/bundle/macos/$APP_NAME"
[[ -d "$MAIN_APP_SOURCE" && ! -L "$MAIN_APP_SOURCE" ]] || fail NATIVE_AUTOFILL_MAIN_APP_MISSING

SIDECAR_DERIVED_DATA="$WORK_ROOT/native-derived-data"
SIDECAR_STAGING="$WORK_ROOT/native-staging"
run_or_fail NATIVE_AUTOFILL_SIDECAR_BUILD_FAILED \
  /usr/bin/env DEVELOPER_DIR="$DEVELOPER_DIR" CONFIGURATION=Release \
  DERIVED_DATA_PATH="$SIDECAR_DERIVED_DATA" STAGING_DIR="$SIDECAR_STAGING" \
  CODE_SIGNING_ALLOWED=NO "$SCRIPT_DIR/build-native-autofill.sh"

ASSEMBLY_ROOT="$WORK_ROOT/assembly"
APP_PATH="$ASSEMBLY_ROOT/$APP_NAME"
/bin/mkdir -p "$ASSEMBLY_ROOT"
run_or_fail NATIVE_AUTOFILL_APP_STAGE_FAILED /usr/bin/ditto --norsrc --noqtn "$MAIN_APP_SOURCE" "$APP_PATH"
/bin/mkdir -p "$APP_PATH/Contents/PlugIns" "$APP_PATH/Contents/Helpers" "$APP_PATH/Contents/Library/LaunchAgents"
run_or_fail NATIVE_AUTOFILL_PROVIDER_EMBED_FAILED \
  /usr/bin/ditto --norsrc --noqtn "$SIDECAR_STAGING/$PROVIDER_NAME" "$APP_PATH/Contents/PlugIns/$PROVIDER_NAME"
run_or_fail NATIVE_AUTOFILL_AGENT_EMBED_FAILED \
  /usr/bin/ditto --norsrc --noqtn "$SIDECAR_STAGING/$AGENT_NAME" "$APP_PATH/Contents/Helpers/$AGENT_NAME"
run_or_fail NATIVE_AUTOFILL_LAUNCH_AGENT_EMBED_FAILED \
  /usr/bin/ditto --norsrc --noqtn \
  "$REPOSITORY_ROOT/apps/macos-autofill/Agent/com.sommir.barwarden.autofill-agent.plist" \
  "$APP_PATH/Contents/Library/LaunchAgents/com.sommir.barwarden.autofill-agent.plist"
run_or_fail NATIVE_AUTOFILL_PROVIDER_PROFILE_EMBED_FAILED \
  /usr/bin/ditto --norsrc --noqtn "$NATIVE_AUTOFILL_PROVIDER_PROFILE" \
  "$APP_PATH/Contents/PlugIns/$PROVIDER_NAME/Contents/embedded.provisionprofile"

SIGNING_ARGS=(--force --timestamp --options runtime --sign "$NATIVE_AUTOFILL_SIGNING_IDENTITY")
if [[ -n "${NATIVE_AUTOFILL_SIGNING_KEYCHAIN:-}" ]]; then
  SIGNING_ARGS+=(--keychain "$NATIVE_AUTOFILL_SIGNING_KEYCHAIN")
fi
PROVIDER_RELEASE_ENTITLEMENTS="$WORK_ROOT/provider-release-entitlements.plist"
run_or_fail NATIVE_AUTOFILL_PROVIDER_ENTITLEMENTS_INVALID \
  "$SCRIPT_DIR/create-native-autofill-provider-entitlements.sh" "$PROVIDER_RELEASE_ENTITLEMENTS"
run_or_fail NATIVE_AUTOFILL_AGENT_SIGN_FAILED \
  /usr/bin/codesign "${SIGNING_ARGS[@]}" \
  --entitlements "$REPOSITORY_ROOT/apps/macos-autofill/Agent/Entitlements.plist" \
  "$APP_PATH/Contents/Helpers/$AGENT_NAME"
run_or_fail NATIVE_AUTOFILL_PROVIDER_SIGN_FAILED \
  /usr/bin/codesign "${SIGNING_ARGS[@]}" \
  --entitlements "$PROVIDER_RELEASE_ENTITLEMENTS" \
  "$APP_PATH/Contents/PlugIns/$PROVIDER_NAME"

run_or_fail NATIVE_AUTOFILL_AGENT_REQUIREMENT_FAILED \
  /usr/bin/codesign -R "=designated => anchor apple generic and certificate leaf[subject.OU] = \"$TEAM_ID\" and identifier \"com.sommir.barwarden.autofill-agent\"" \
  "$APP_PATH/Contents/Helpers/$AGENT_NAME"
run_or_fail NATIVE_AUTOFILL_PROVIDER_REQUIREMENT_FAILED \
  /usr/bin/codesign -R "=designated => anchor apple generic and certificate leaf[subject.OU] = \"$TEAM_ID\" and identifier \"com.sommir.barwarden.credential-provider\"" \
  "$APP_PATH/Contents/PlugIns/$PROVIDER_NAME"

run_or_fail NATIVE_AUTOFILL_MAIN_APP_SIGN_FAILED \
  /usr/bin/codesign "${SIGNING_ARGS[@]}" \
  --entitlements "$REPOSITORY_ROOT/apps/menubar-tauri/src-tauri/Entitlements.native-autofill.plist" \
  "$APP_PATH"
run_or_fail NATIVE_AUTOFILL_OUTER_SEAL_FAILED /usr/bin/codesign --verify --strict --verbose=2 "$APP_PATH"
run_or_fail NATIVE_AUTOFILL_OUTER_DEEP_VERIFY_FAILED /usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_PATH"

APP_ZIP="$WORK_ROOT/$APP_NAME.zip"
run_or_fail NATIVE_AUTOFILL_APP_ARCHIVE_FAILED /usr/bin/ditto -c -k --keepParent "$APP_PATH" "$APP_ZIP"
run_or_fail NATIVE_AUTOFILL_APP_NOTARIZATION_FAILED \
  /usr/bin/xcrun notarytool submit "$APP_ZIP" --wait --keychain-profile "$NATIVE_AUTOFILL_NOTARY_PROFILE"
run_or_fail NATIVE_AUTOFILL_APP_STAPLE_FAILED /usr/bin/xcrun stapler staple "$APP_PATH"
run_or_fail NATIVE_AUTOFILL_APP_STAPLE_VALIDATE_FAILED /usr/bin/xcrun stapler validate "$APP_PATH"

DMG_STAGE="$WORK_ROOT/dmg-stage"
/bin/mkdir -p "$DMG_STAGE"
run_or_fail NATIVE_AUTOFILL_DMG_APP_STAGE_FAILED /usr/bin/ditto --norsrc --noqtn "$APP_PATH" "$DMG_STAGE/$APP_NAME"
/bin/ln -s /Applications "$DMG_STAGE/Applications"
DMG_PATH="$WORK_ROOT/Barwarden-0.1.2.dmg"
run_or_fail NATIVE_AUTOFILL_DMG_CREATE_FAILED \
  /usr/bin/hdiutil create -quiet -fs HFS+ -volname Barwarden -srcfolder "$DMG_STAGE" "$DMG_PATH"
run_or_fail NATIVE_AUTOFILL_DMG_SIGN_FAILED \
  /usr/bin/codesign "${SIGNING_ARGS[@]}" "$DMG_PATH"
run_or_fail NATIVE_AUTOFILL_DMG_SIGNATURE_INVALID \
  /usr/bin/codesign --verify --strict --verbose=2 "$DMG_PATH"
run_or_fail NATIVE_AUTOFILL_DMG_NOTARIZATION_FAILED \
  /usr/bin/xcrun notarytool submit "$DMG_PATH" --wait --keychain-profile "$NATIVE_AUTOFILL_NOTARY_PROFILE"
run_or_fail NATIVE_AUTOFILL_DMG_STAPLE_FAILED /usr/bin/xcrun stapler staple "$DMG_PATH"
run_or_fail NATIVE_AUTOFILL_DMG_STAPLE_VALIDATE_FAILED /usr/bin/xcrun stapler validate "$DMG_PATH"

APP_EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Contents/Info.plist" 2>/dev/null)" || \
  fail NATIVE_AUTOFILL_MAIN_EXECUTABLE_METADATA_INVALID
APP_HASH="$(node "$SCRIPT_DIR/native-autofill-bundle-manifest.mjs" "$APP_PATH" 2>/dev/null)" || \
  fail NATIVE_AUTOFILL_APP_MANIFEST_INVALID
DMG_HASH="$(/usr/bin/shasum -a 256 "$DMG_PATH" | /usr/bin/awk '{print $1}')"
BUILDER_SCRIPT_HASH="$(/usr/bin/shasum -a 256 "$0" | /usr/bin/awk '{print $1}')"
BUILDER_POLICY_HASH="$(/usr/bin/shasum -a 256 "$SCRIPT_DIR/native-autofill-builder-policy.mjs" | /usr/bin/awk '{print $1}')"
ATTESTATION="$WORK_ROOT/native-autofill-assembly-attestation.json"
/usr/bin/env APP_HASH="$APP_HASH" DMG_HASH="$DMG_HASH" BUILDER_SCRIPT_HASH="$BUILDER_SCRIPT_HASH" \
  BUILDER_POLICY_HASH="$BUILDER_POLICY_HASH" node --input-type=module - "$ATTESTATION" <<'NODE'
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], `${JSON.stringify({
  schemaVersion: 1,
  appSha256: process.env.APP_HASH,
  appHashKind: "bundle-manifest-v1",
  dmgSha256: process.env.DMG_HASH,
  builderScriptSha256: process.env.BUILDER_SCRIPT_HASH,
  builderPolicySha256: process.env.BUILDER_POLICY_HASH,
  insideOutSigning: true,
  signingUsedDeep: false,
  signingOrder: ["agent", "credential-provider", "app", "dmg"],
}, null, 2)}\n`, { mode: 0o600 });
NODE

run_or_fail NATIVE_AUTOFILL_STRICT_VERIFIER_FAILED \
  "$SCRIPT_DIR/verify-native-autofill-bundle.sh" --app "$APP_PATH" --dmg "$DMG_PATH" --attestation "$ATTESTATION"

PROMOTION_SOURCE="$WORK_ROOT/promotion"
/bin/mkdir "$PROMOTION_SOURCE"
run_or_fail NATIVE_AUTOFILL_OUTPUT_APP_FAILED /usr/bin/ditto --norsrc --noqtn "$APP_PATH" "$PROMOTION_SOURCE/$APP_NAME"
run_or_fail NATIVE_AUTOFILL_OUTPUT_DMG_FAILED /usr/bin/ditto --norsrc --noqtn "$DMG_PATH" "$PROMOTION_SOURCE/Barwarden-0.1.2.dmg"
run_or_fail NATIVE_AUTOFILL_OUTPUT_ATTESTATION_FAILED \
  /usr/bin/ditto --norsrc --noqtn "$ATTESTATION" "$PROMOTION_SOURCE/native-autofill-assembly-attestation.json"
run_or_fail NATIVE_AUTOFILL_EVIDENCE_FAILED \
  /usr/bin/env NATIVE_AUTOFILL_APP_SHA256="$APP_HASH" NATIVE_AUTOFILL_DMG_SHA256="$DMG_HASH" \
  NATIVE_AUTOFILL_OS_VERSION="$(/usr/bin/sw_vers -productVersion)" \
  node "$SCRIPT_DIR/record-native-autofill-evidence.mjs" ARTIFACT_PASS \
  "$PROMOTION_SOURCE/native-autofill-evidence.json" \
  "$PROMOTION_SOURCE/native-autofill-evidence.md"
run_or_fail NATIVE_AUTOFILL_PROMOTION_FAILED \
  node "$SCRIPT_DIR/native-autofill-atomic-promotion.mjs" "$PROMOTION_SOURCE" "$OUTPUT_DIR"

printf '%s\n' NATIVE_AUTOFILL_RELEASE_BUILD_PASS
