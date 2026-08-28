#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
INSTALL_PATH="/Applications/Barwarden.app"
LOCAL_INSTALL_PREFERENCES="${BARWARDEN_LOCAL_INSTALL_PREFERENCES:-com.sommir.barwarden.local-install}"

read_local_install_preference() {
  /usr/bin/defaults read "$LOCAL_INSTALL_PREFERENCES" "$1" 2>/dev/null || true
}

SIGNING_IDENTITY="${BARWARDEN_SIGNING_IDENTITY:-$(read_local_install_preference SigningIdentity)}"
SIGNING_CERT="${BARWARDEN_SIGNING_CERT:-$(read_local_install_preference SigningCertificate)}"
SIGNING_KEY="${BARWARDEN_SIGNING_KEY:-$(read_local_install_preference SigningPrivateKey)}"
DEVELOPER_ID_INTERMEDIATE="${BARWARDEN_VERIFICATION_CERTIFICATE:-$(read_local_install_preference VerificationCertificate)}"
DEVELOPER_ID_INTERMEDIATE_SHA256="F16CD3C54C7F83CEA4BF1A3E6A0819C8AAA8E4A1528FD144715F350643D2DF3A"
USER_KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
LEGACY_PUBLIC_CERTIFICATES_KEYCHAIN="$HOME/Library/Keychains/barwarden-public-certificates.keychain-db"
PROVIDER_PROFILE="${BARWARDEN_PROVIDER_PROFILE:-$(read_local_install_preference ProviderProfile)}"
DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
BUILDER="$SCRIPT_DIR/build-native-autofill-local-smoke.sh"
AGENT_LABEL="com.sommir.barwarden.autofill-agent"
AGENT_SOCKET="$HOME/Library/Group Containers/K7LY92JY96.com.sommir.barwarden.autofill/agent-v1.sock"
PLAN=(
  validate-local-inputs
  install-public-verification-chain
  create-temporary-signing-keychain
  build-native-autofill-local
  verify-staged-native-inventory
  stop-installed-app
  install-native-bundle
  delete-temporary-signing-keychain
  verify-installed-signatures
  launch-installed-app
  verify-agent-registration
  cleanup-temporary-signing-keychain
)

fail() {
  printf '%s\n' "$1" >&2
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

ensure_public_verification_chain() {
  if [[ -e "$LEGACY_PUBLIC_CERTIFICATES_KEYCHAIN" ]]; then
    [[ -f "$LEGACY_PUBLIC_CERTIFICATES_KEYCHAIN" && \
      ! -L "$LEGACY_PUBLIC_CERTIFICATES_KEYCHAIN" ]] || \
      fail BARWARDEN_LOCAL_PUBLIC_KEYCHAIN_INVALID
    /usr/bin/security delete-keychain "$LEGACY_PUBLIC_CERTIFICATES_KEYCHAIN" >/dev/null || \
      fail BARWARDEN_LOCAL_PUBLIC_KEYCHAIN_DELETE_FAILED
  fi

  local installed_certificates
  installed_certificates="$(/usr/bin/security find-certificate -a -Z \
    "$USER_KEYCHAIN" 2>/dev/null)" || fail BARWARDEN_LOCAL_USER_KEYCHAIN_INVALID
  if /usr/bin/grep -F "SHA-256 hash: $DEVELOPER_ID_INTERMEDIATE_SHA256" \
      <<< "$installed_certificates" >/dev/null; then
    return 0
  fi
  /usr/bin/security import "$DEVELOPER_ID_INTERMEDIATE" -t cert \
    -k "$USER_KEYCHAIN" >/dev/null 2>&1 || true
  installed_certificates="$(/usr/bin/security find-certificate -a -Z \
    "$USER_KEYCHAIN" 2>/dev/null)" || fail BARWARDEN_LOCAL_USER_KEYCHAIN_INVALID
  /usr/bin/grep -F "SHA-256 hash: $DEVELOPER_ID_INTERMEDIATE_SHA256" \
    <<< "$installed_certificates" >/dev/null || \
    fail BARWARDEN_LOCAL_VERIFICATION_CHAIN_INSTALL_FAILED
}

validate_inputs() {
  [[ -n "$SIGNING_IDENTITY" ]] || fail BARWARDEN_LOCAL_SIGNING_IDENTITY_MISSING
  [[ "$SIGNING_CERT" = /* && -f "$SIGNING_CERT" && ! -L "$SIGNING_CERT" ]] || \
    fail BARWARDEN_LOCAL_SIGNING_CERT_MISSING
  [[ "$SIGNING_KEY" = /* && -f "$SIGNING_KEY" && ! -L "$SIGNING_KEY" ]] || \
    fail BARWARDEN_LOCAL_SIGNING_KEY_MISSING
  [[ -f "$DEVELOPER_ID_INTERMEDIATE" && ! -L "$DEVELOPER_ID_INTERMEDIATE" ]] || \
    fail BARWARDEN_LOCAL_SIGNING_CHAIN_MISSING
  [[ -f "$USER_KEYCHAIN" && ! -L "$USER_KEYCHAIN" ]] || \
    fail BARWARDEN_LOCAL_USER_KEYCHAIN_INVALID
  reject_symlink_components "$LEGACY_PUBLIC_CERTIFICATES_KEYCHAIN" || \
    fail BARWARDEN_LOCAL_PUBLIC_KEYCHAIN_INVALID
  reject_symlink_components "$SIGNING_CERT" || fail BARWARDEN_LOCAL_SIGNING_INPUT_INVALID
  reject_symlink_components "$SIGNING_KEY" || fail BARWARDEN_LOCAL_SIGNING_INPUT_INVALID
  reject_symlink_components "$DEVELOPER_ID_INTERMEDIATE" || \
    fail BARWARDEN_LOCAL_SIGNING_CHAIN_MISSING
  local intermediate_sha256
  intermediate_sha256="$(/usr/bin/openssl x509 -in "$DEVELOPER_ID_INTERMEDIATE" \
    -noout -fingerprint -sha256 2>/dev/null | /usr/bin/awk -F= 'NF == 2 { print $2 }' | \
    /usr/bin/tr -d ':')"
  [[ "$intermediate_sha256" == "$DEVELOPER_ID_INTERMEDIATE_SHA256" ]] || \
    fail BARWARDEN_LOCAL_SIGNING_CHAIN_INVALID
  [[ -x "$DEVELOPER_DIR/usr/bin/xcodebuild" ]] || fail BARWARDEN_LOCAL_XCODE_MISSING
  [[ -x "$BUILDER" ]] || fail BARWARDEN_LOCAL_BUILDER_MISSING
  if [[ -n "$PROVIDER_PROFILE" ]]; then
    [[ "$PROVIDER_PROFILE" = /* && -f "$PROVIDER_PROFILE" && ! -L "$PROVIDER_PROFILE" ]] || \
      fail BARWARDEN_LOCAL_PROVIDER_PROFILE_INVALID
    reject_symlink_components "$PROVIDER_PROFILE" || fail BARWARDEN_LOCAL_PROVIDER_PROFILE_INVALID
  else
    printf '%s\n' BARWARDEN_LOCAL_PROVIDER_PROFILE_MISSING
  fi
}

if [[ "${NATIVE_AUTOFILL_INSTALL_TEST_MODE:-0}" == 1 && "${1:-}" == --print-plan && $# -eq 1 ]]; then
  printf '%s\n' "${PLAN[@]}"
  exit 0
fi

case "${1:-}" in
  --preflight)
    [[ $# -eq 1 ]] || fail BARWARDEN_LOCAL_ARGUMENT_INVALID
    validate_inputs
    printf '%s\n' BARWARDEN_LOCAL_PREFLIGHT_PASS
    exit 0
    ;;
  "") ;;
  *) fail BARWARDEN_LOCAL_ARGUMENT_INVALID ;;
esac

WORK_ROOT=""
SIGNING_KEYCHAIN=""
KEYCHAIN_PASSWORD=""
BACKUP_PATH=""
INSTALL_STARTED=0
INSTALL_COMMITTED=0
ORIGINAL_USER_KEYCHAINS=()
SIGNING_KEYCHAIN_ON_SEARCH_LIST=0

restore_user_keychain_search_list() {
  [[ "$SIGNING_KEYCHAIN_ON_SEARCH_LIST" == 1 ]] || return 0
  /usr/bin/security list-keychains -d user -s "${ORIGINAL_USER_KEYCHAINS[@]}" >/dev/null || \
    return 1
  SIGNING_KEYCHAIN_ON_SEARCH_LIST=0
}

restore_previous_app() {
  [[ "$INSTALL_STARTED" == 1 && "$INSTALL_COMMITTED" != 1 ]] || return 0
  if [[ -d "$INSTALL_PATH" && ! -L "$INSTALL_PATH" ]]; then
    /bin/rm -rf "$INSTALL_PATH"
  fi
  if [[ -n "$BACKUP_PATH" && -d "$BACKUP_PATH" && ! -L "$BACKUP_PATH" ]]; then
    /bin/mv "$BACKUP_PATH" "$INSTALL_PATH"
  fi
}

cleanup() {
  local status=$?
  trap - EXIT
  restore_previous_app || true
  restore_user_keychain_search_list || true
  if [[ -n "$SIGNING_KEYCHAIN" && -f "$SIGNING_KEYCHAIN" ]]; then
    /usr/bin/security delete-keychain "$SIGNING_KEYCHAIN" >/dev/null 2>&1 || true
  fi
  [[ -z "$WORK_ROOT" ]] || /bin/rm -rf "$WORK_ROOT"
  exit "$status"
}
trap cleanup EXIT

validate_inputs
ensure_public_verification_chain
WORK_ROOT="$(/usr/bin/mktemp -d /private/tmp/barwarden-native-install.XXXXXX)" || \
  fail BARWARDEN_LOCAL_TEMP_CREATE_FAILED
/bin/chmod 700 "$WORK_ROOT"
SIGNING_KEYCHAIN="$WORK_ROOT/signing.keychain-db"
KEYCHAIN_PASSWORD="$(/usr/bin/uuidgen)"
ROOT_CERT="$WORK_ROOT/apple-root.pem"
OUTPUT_DIR="$WORK_ROOT/output"
/bin/mkdir -m 700 "$OUTPUT_DIR"

/usr/bin/security create-keychain -p "$KEYCHAIN_PASSWORD" "$SIGNING_KEYCHAIN" >/dev/null || \
  fail BARWARDEN_LOCAL_KEYCHAIN_CREATE_FAILED
/usr/bin/security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$SIGNING_KEYCHAIN" >/dev/null || \
  fail BARWARDEN_LOCAL_KEYCHAIN_UNLOCK_FAILED
/usr/bin/security set-keychain-settings -lut 21600 "$SIGNING_KEYCHAIN" >/dev/null || \
  fail BARWARDEN_LOCAL_KEYCHAIN_CONFIG_FAILED
/usr/bin/security find-certificate -c "Apple Root CA" -p \
  /System/Library/Keychains/SystemRootCertificates.keychain >"$ROOT_CERT" || \
  fail BARWARDEN_LOCAL_SIGNING_CHAIN_MISSING
/usr/bin/security import "$ROOT_CERT" -t cert -k "$SIGNING_KEYCHAIN" >/dev/null || \
  fail BARWARDEN_LOCAL_SIGNING_CHAIN_IMPORT_FAILED
/usr/bin/security import "$DEVELOPER_ID_INTERMEDIATE" -t cert -k "$SIGNING_KEYCHAIN" >/dev/null || \
  fail BARWARDEN_LOCAL_SIGNING_CHAIN_IMPORT_FAILED
/usr/bin/security import "$SIGNING_CERT" -t cert -k "$SIGNING_KEYCHAIN" >/dev/null || \
  fail BARWARDEN_LOCAL_SIGNING_CERT_IMPORT_FAILED
/usr/bin/security import "$SIGNING_KEY" -k "$SIGNING_KEYCHAIN" \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null || \
  fail BARWARDEN_LOCAL_SIGNING_KEY_IMPORT_FAILED
/usr/bin/security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
  -k "$KEYCHAIN_PASSWORD" "$SIGNING_KEYCHAIN" >/dev/null || \
  fail BARWARDEN_LOCAL_SIGNING_KEY_AUTH_FAILED
/usr/bin/security find-identity -v -p codesigning "$SIGNING_KEYCHAIN" | \
  /usr/bin/grep -Fq "$SIGNING_IDENTITY" || fail BARWARDEN_LOCAL_SIGNING_IDENTITY_INVALID
while IFS= read -r keychain_entry; do
  keychain_entry="${keychain_entry#*\"}"
  keychain_entry="${keychain_entry%\"*}"
  [[ -z "$keychain_entry" ]] || ORIGINAL_USER_KEYCHAINS+=("$keychain_entry")
done < <(/usr/bin/security list-keychains -d user)
[[ "${#ORIGINAL_USER_KEYCHAINS[@]}" -gt 0 ]] || fail BARWARDEN_LOCAL_KEYCHAIN_SEARCH_INVALID
/usr/bin/security list-keychains -d user -s "$SIGNING_KEYCHAIN" \
  "${ORIGINAL_USER_KEYCHAINS[@]}" >/dev/null || fail BARWARDEN_LOCAL_KEYCHAIN_SEARCH_UPDATE_FAILED
SIGNING_KEYCHAIN_ON_SEARCH_LIST=1

BUILD_ENV=(
  /usr/bin/env
  NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY=1
  NATIVE_AUTOFILL_SIGNING_IDENTITY="$SIGNING_IDENTITY"
  NATIVE_AUTOFILL_SIGNING_KEYCHAIN="$SIGNING_KEYCHAIN"
  NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR="$OUTPUT_DIR"
  DEVELOPER_DIR="$DEVELOPER_DIR"
)
if [[ -n "$PROVIDER_PROFILE" ]]; then
  BUILD_ENV+=(NATIVE_AUTOFILL_PROVIDER_PROFILE="$PROVIDER_PROFILE")
fi
"${BUILD_ENV[@]}" "$BUILDER"
restore_user_keychain_search_list || fail BARWARDEN_LOCAL_KEYCHAIN_SEARCH_RESTORE_FAILED

STAGED_APP="$OUTPUT_DIR/Barwarden Local Smoke.app"
for required in \
  "Contents/Helpers/BarwardenAutoFillAgent" \
  "Contents/PlugIns/BarwardenCredentialProvider.appex" \
  "Contents/Library/LaunchAgents/com.sommir.barwarden.autofill-agent.plist" \
  "Contents/Resources/BarwardenAutoFill/AppPresets.json" \
  "Contents/Resources/BarwardenAutoFill/DomainMatchRules.json"
do
  [[ -e "$STAGED_APP/$required" ]] || fail BARWARDEN_LOCAL_NATIVE_INVENTORY_MISSING
done
/usr/bin/codesign --verify --deep --strict --verbose=2 "$STAGED_APP" || \
  fail BARWARDEN_LOCAL_STAGED_SIGNATURE_INVALID

/usr/bin/osascript -e 'quit app "Barwarden"' >/dev/null 2>&1 || true
/bin/sleep 1
BACKUP_PATH="$WORK_ROOT/Barwarden.previous.app"
INSTALL_STARTED=1
if [[ -e "$INSTALL_PATH" ]]; then
  [[ -d "$INSTALL_PATH" && ! -L "$INSTALL_PATH" ]] || fail BARWARDEN_LOCAL_INSTALL_TARGET_INVALID
  /bin/mv "$INSTALL_PATH" "$BACKUP_PATH" || fail BARWARDEN_LOCAL_BACKUP_FAILED
fi
/usr/bin/ditto --norsrc --noqtn "$STAGED_APP" "$INSTALL_PATH" || fail BARWARDEN_LOCAL_INSTALL_FAILED

/usr/bin/codesign --verify --deep --strict --verbose=2 "$INSTALL_PATH" || \
  fail BARWARDEN_LOCAL_INSTALLED_SIGNATURE_INVALID
/usr/bin/security delete-keychain "$SIGNING_KEYCHAIN" >/dev/null || \
  fail BARWARDEN_LOCAL_SIGNING_KEYCHAIN_DELETE_FAILED
SIGNING_KEYCHAIN=""
/usr/bin/codesign --verify --deep --strict --verbose=2 "$INSTALL_PATH" || \
  fail BARWARDEN_LOCAL_INSTALLED_SIGNATURE_INVALID
REGISTER_OUTPUT="$($INSTALL_PATH/Contents/MacOS/barwarden --register-autofill-agent 2>&1)" || \
  fail BARWARDEN_LOCAL_AGENT_REGISTER_FAILED
[[ "$REGISTER_OUTPUT" == NATIVE_AUTOFILL_LOCAL_AGENT_REGISTER_PASS ]] || \
  fail BARWARDEN_LOCAL_AGENT_REGISTER_FAILED
/usr/bin/open -a "$INSTALL_PATH" || fail BARWARDEN_LOCAL_APP_LAUNCH_FAILED

AGENT_READY=0
for _attempt in {1..40}; do
  /bin/launchctl kickstart -k "gui/$(/usr/bin/id -u)/$AGENT_LABEL" >/dev/null 2>&1 || true
  if /bin/launchctl print "gui/$(/usr/bin/id -u)/$AGENT_LABEL" >/dev/null 2>&1 && \
    [[ -S "$AGENT_SOCKET" ]]; then
    AGENT_READY=1
    break
  fi
  /bin/sleep 0.25
done
[[ "$AGENT_READY" == 1 ]] || fail BARWARDEN_LOCAL_AGENT_VERIFY_FAILED

/usr/bin/codesign --verify --deep --strict --verbose=2 "$INSTALL_PATH" || \
  fail BARWARDEN_LOCAL_INSTALLED_SIGNATURE_INVALID
/bin/launchctl print "gui/$(/usr/bin/id -u)/com.sommir.barwarden.autofill-agent" >/dev/null || \
  fail BARWARDEN_LOCAL_AGENT_VERIFY_FAILED
INSTALL_COMMITTED=1
printf '%s\n' BARWARDEN_LOCAL_INSTALL_PASS
