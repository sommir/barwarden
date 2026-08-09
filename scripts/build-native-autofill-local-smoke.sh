#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
TEAM_ID="K7LY92JY96"
APP_NAME="Barwarden.app"
LOCAL_APP_NAME="Barwarden Local Smoke.app"
PROVIDER_NAME="BarwardenCredentialProvider.appex"
AGENT_NAME="BarwardenAutoFillAgent"

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

validate_preflight() {
  [[ -n "${NATIVE_AUTOFILL_SIGNING_IDENTITY:-}" ]] || \
    fail NATIVE_AUTOFILL_LOCAL_SIGNING_IDENTITY_MISSING
  [[ -n "${NATIVE_AUTOFILL_SIGNING_KEYCHAIN:-}" && \
    "${NATIVE_AUTOFILL_SIGNING_KEYCHAIN:-}" = /* && \
    -f "${NATIVE_AUTOFILL_SIGNING_KEYCHAIN:-}" && \
    ! -L "${NATIVE_AUTOFILL_SIGNING_KEYCHAIN:-}" ]] || \
    fail NATIVE_AUTOFILL_LOCAL_SIGNING_KEYCHAIN_MISSING
  reject_symlink_components "$NATIVE_AUTOFILL_SIGNING_KEYCHAIN" || \
    fail NATIVE_AUTOFILL_LOCAL_SIGNING_KEYCHAIN_MISSING

  local output_dir="${NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR:-}"
  [[ "$output_dir" = /* && -d "$output_dir" && ! -L "$output_dir" ]] || \
    fail NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR_INVALID
  reject_symlink_components "$output_dir" || fail NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR_INVALID
  local output_mode
  output_mode="$(/usr/bin/stat -f '%Lp' "$output_dir" 2>/dev/null)" || \
    fail NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR_INVALID
  (( (8#$output_mode & 077) == 0 )) || fail NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR_INVALID
  [[ "$(/usr/bin/stat -f '%u' "$output_dir" 2>/dev/null)" == "$(/usr/bin/id -u)" ]] || \
    fail NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR_INVALID
  if /usr/bin/find "$output_dir" -mindepth 1 -print -quit | /usr/bin/grep -q .; then
    fail NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR_NOT_EMPTY
  fi

  if [[ -n "${NATIVE_AUTOFILL_PROVIDER_PROFILE:-}" ]]; then
    [[ "${NATIVE_AUTOFILL_PROVIDER_PROFILE}" = /* && \
      -f "${NATIVE_AUTOFILL_PROVIDER_PROFILE}" && \
      ! -L "${NATIVE_AUTOFILL_PROVIDER_PROFILE}" ]] || \
      fail NATIVE_AUTOFILL_LOCAL_PROVIDER_PROFILE_INVALID
    reject_symlink_components "$NATIVE_AUTOFILL_PROVIDER_PROFILE" || \
      fail NATIVE_AUTOFILL_LOCAL_PROVIDER_PROFILE_INVALID
  else
    printf '%s\n' NATIVE_AUTOFILL_LOCAL_PROVIDER_PROFILE_MISSING >&2
  fi
}

if ! POLICY_CODE="$(/usr/bin/env node "$SCRIPT_DIR/native-autofill-local-smoke-policy.mjs" "$0" 2>&1)"; then
  fail "$POLICY_CODE"
fi

[[ "${NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY:-0}" == 1 ]] || \
  fail NATIVE_AUTOFILL_LOCAL_SMOKE_MODE_REQUIRED

case "${1:-}" in
  --preflight)
    [[ $# -eq 1 ]] || fail NATIVE_AUTOFILL_ARGUMENT_INVALID
    validate_preflight
    printf '%s\n' NATIVE_AUTOFILL_LOCAL_SMOKE_PREFLIGHT_PASS
    exit 0
    ;;
  "") ;;
  *) fail NATIVE_AUTOFILL_ARGUMENT_INVALID ;;
esac

validate_preflight

WORK_ROOT="$(/usr/bin/mktemp -d /private/tmp/barwarden-native-local-smoke.XXXXXX)"
OVERLAY_CONFIG="$(/usr/bin/mktemp "$REPOSITORY_ROOT/apps/menubar-tauri/src-tauri/.tauri-native-autofill-local.XXXXXX.json")"
OUTPUT_APP="$NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR/$LOCAL_APP_NAME"
BUILD_COMPLETE=0
cleanup() {
  /bin/rm -f "$OVERLAY_CONFIG" >/dev/null 2>&1 || true
  /bin/rm -rf "$WORK_ROOT" >/dev/null 2>&1 || true
  if [[ "$BUILD_COMPLETE" -ne 1 && -n "${OUTPUT_APP:-}" ]]; then
    /bin/rm -rf "$OUTPUT_APP" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

run_or_fail() {
  local code="$1"
  shift
  if ! "$@" >/dev/null 2>&1; then
    fail "$code"
  fi
}

IDENTITY_LIST="$(/usr/bin/security find-identity -v -p codesigning \
  "$NATIVE_AUTOFILL_SIGNING_KEYCHAIN" 2>/dev/null)" || \
  fail NATIVE_AUTOFILL_LOCAL_SIGNING_IDENTITY_INVALID
[[ "$IDENTITY_LIST" == *"$NATIVE_AUTOFILL_SIGNING_IDENTITY"* ]] || \
  fail NATIVE_AUTOFILL_LOCAL_SIGNING_IDENTITY_INVALID
unset IDENTITY_LIST

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
run_or_fail NATIVE_AUTOFILL_APP_STAGE_FAILED \
  /usr/bin/ditto --norsrc --noqtn "$MAIN_APP_SOURCE" "$APP_PATH"
/bin/mkdir -p "$APP_PATH/Contents/PlugIns" "$APP_PATH/Contents/Helpers" \
  "$APP_PATH/Contents/Library/LaunchAgents"
run_or_fail NATIVE_AUTOFILL_PROVIDER_EMBED_FAILED \
  /usr/bin/ditto --norsrc --noqtn "$SIDECAR_STAGING/$PROVIDER_NAME" \
  "$APP_PATH/Contents/PlugIns/$PROVIDER_NAME"
run_or_fail NATIVE_AUTOFILL_AGENT_EMBED_FAILED \
  /usr/bin/ditto --norsrc --noqtn "$SIDECAR_STAGING/$AGENT_NAME" \
  "$APP_PATH/Contents/Helpers/$AGENT_NAME"
run_or_fail NATIVE_AUTOFILL_LAUNCH_AGENT_EMBED_FAILED \
  /usr/bin/ditto --norsrc --noqtn \
  "$REPOSITORY_ROOT/apps/macos-autofill/Agent/com.sommir.barwarden.autofill-agent.plist" \
  "$APP_PATH/Contents/Library/LaunchAgents/com.sommir.barwarden.autofill-agent.plist"
if [[ -n "${NATIVE_AUTOFILL_PROVIDER_PROFILE:-}" ]]; then
  run_or_fail NATIVE_AUTOFILL_PROVIDER_PROFILE_EMBED_FAILED \
    /usr/bin/ditto --norsrc --noqtn "$NATIVE_AUTOFILL_PROVIDER_PROFILE" \
    "$APP_PATH/Contents/PlugIns/$PROVIDER_NAME/Contents/embedded.provisionprofile"
fi

SIGNING_ARGS=(--force --timestamp --options runtime --sign "$NATIVE_AUTOFILL_SIGNING_IDENTITY" --keychain "$NATIVE_AUTOFILL_SIGNING_KEYCHAIN")
PROVIDER_ENTITLEMENTS="$WORK_ROOT/provider-entitlements.plist"
run_or_fail NATIVE_AUTOFILL_PROVIDER_ENTITLEMENTS_INVALID \
  "$SCRIPT_DIR/create-native-autofill-provider-entitlements.sh" "$PROVIDER_ENTITLEMENTS"
run_or_fail NATIVE_AUTOFILL_LOCAL_AGENT_SIGN_FAILED \
  /usr/bin/codesign "${SIGNING_ARGS[@]}" \
  --entitlements "$REPOSITORY_ROOT/apps/macos-autofill/Agent/Entitlements.plist" \
  "$APP_PATH/Contents/Helpers/$AGENT_NAME"
run_or_fail NATIVE_AUTOFILL_LOCAL_PROVIDER_SIGN_FAILED \
  /usr/bin/codesign "${SIGNING_ARGS[@]}" \
  --entitlements "$PROVIDER_ENTITLEMENTS" \
  "$APP_PATH/Contents/PlugIns/$PROVIDER_NAME"

run_or_fail NATIVE_AUTOFILL_LOCAL_AGENT_REQUIREMENT_FAILED \
  /usr/bin/codesign -R "=designated => anchor apple generic and certificate leaf[subject.OU] = \"$TEAM_ID\" and identifier \"com.sommir.barwarden.autofill-agent\"" \
  "$APP_PATH/Contents/Helpers/$AGENT_NAME"
run_or_fail NATIVE_AUTOFILL_LOCAL_PROVIDER_REQUIREMENT_FAILED \
  /usr/bin/codesign -R "=designated => anchor apple generic and certificate leaf[subject.OU] = \"$TEAM_ID\" and identifier \"com.sommir.barwarden.credential-provider\"" \
  "$APP_PATH/Contents/PlugIns/$PROVIDER_NAME"

run_or_fail NATIVE_AUTOFILL_LOCAL_APP_SIGN_FAILED \
  /usr/bin/codesign "${SIGNING_ARGS[@]}" \
  --entitlements "$REPOSITORY_ROOT/apps/menubar-tauri/src-tauri/Entitlements.native-autofill.plist" \
  "$APP_PATH"
run_or_fail NATIVE_AUTOFILL_LOCAL_APP_REQUIREMENT_FAILED \
  /usr/bin/codesign -R "=designated => anchor apple generic and certificate leaf[subject.OU] = \"$TEAM_ID\" and identifier \"com.sommir.barwarden\"" \
  "$APP_PATH"
run_or_fail NATIVE_AUTOFILL_LOCAL_STRICT_VERIFY_FAILED \
  /usr/bin/codesign --verify --strict --verbose=2 "$APP_PATH"
run_or_fail NATIVE_AUTOFILL_LOCAL_DEEP_VERIFY_FAILED \
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_PATH"

run_or_fail NATIVE_AUTOFILL_LOCAL_BUILD_FAILED \
  /usr/bin/ditto --norsrc --noqtn "$APP_PATH" "$OUTPUT_APP"
[[ -d "$OUTPUT_APP" && ! -L "$OUTPUT_APP" ]] || fail NATIVE_AUTOFILL_LOCAL_BUILD_FAILED
[[ "$(/usr/bin/find "$NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR" -mindepth 1 -maxdepth 1 -print | /usr/bin/wc -l | /usr/bin/tr -d ' ')" == 1 ]] || \
  fail NATIVE_AUTOFILL_LOCAL_BUILD_FAILED
run_or_fail NATIVE_AUTOFILL_LOCAL_APP_REQUIREMENT_FAILED \
  /usr/bin/codesign -R "=designated => anchor apple generic and certificate leaf[subject.OU] = \"$TEAM_ID\" and identifier \"com.sommir.barwarden\"" \
  "$OUTPUT_APP"
run_or_fail NATIVE_AUTOFILL_LOCAL_STRICT_VERIFY_FAILED \
  /usr/bin/codesign --verify --strict --verbose=2 "$OUTPUT_APP"
run_or_fail NATIVE_AUTOFILL_LOCAL_DEEP_VERIFY_FAILED \
  /usr/bin/codesign --verify --deep --strict --verbose=2 "$OUTPUT_APP"
BUILD_COMPLETE=1
printf '%s\n' NATIVE_AUTOFILL_LOCAL_SMOKE_BUILD_PASS
