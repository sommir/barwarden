#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
PROJECT_PATH="$REPOSITORY_ROOT/apps/macos-autofill/BarwardenAutoFill.xcodeproj"
SCHEME="BarwardenNativeAutoFill"

CONFIGURATION="${CONFIGURATION:-Release}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$REPOSITORY_ROOT/apps/macos-autofill/build/DerivedData}"
STAGING_DIR="${STAGING_DIR:-$REPOSITORY_ROOT/apps/macos-autofill/build/Staging/$CONFIGURATION}"
XCODE_SELECT="${XCODE_SELECT:-/usr/bin/xcode-select}"

fail() {
  echo "build-native-autofill: $*" >&2
  exit 1
}

fail_with_code() {
  local code="$1"
  shift
  echo "build-native-autofill: $*" >&2
  exit "$code"
}

reject_symlink_components() {
  local target="$1"
  local current="/"
  local component
  local components
  IFS='/' read -r -a components <<< "${target#/}"
  for component in "${components[@]}"; do
    [[ -n "$component" ]] || continue
    current="${current%/}/$component"
    [[ ! -L "$current" ]] || fail "path contains a symbolic link: $current"
  done
}

case "$CONFIGURATION" in
  Debug|Release) ;;
  *) fail "CONFIGURATION must be Debug or Release" ;;
esac

[[ "$DERIVED_DATA_PATH" = /* ]] || fail "DERIVED_DATA_PATH must be an absolute path"
[[ "$STAGING_DIR" = /* ]] || fail "STAGING_DIR must be an absolute path"
reject_symlink_components "$DERIVED_DATA_PATH"
reject_symlink_components "$STAGING_DIR"

if [[ -z "${DEVELOPER_DIR:-}" ]]; then
  DEVELOPER_DIR="$($XCODE_SELECT -p 2>/dev/null)" ||
    fail_with_code 78 "unable to select a full Xcode developer directory"
fi
if [[ ! -x "$DEVELOPER_DIR/usr/bin/xcodebuild" || ! -d "$DEVELOPER_DIR/Platforms/MacOSX.platform" ]]; then
  fail_with_code 78 "DEVELOPER_DIR is not a full Xcode developer directory"
fi
XCODEBUILD="${XCODEBUILD:-$DEVELOPER_DIR/usr/bin/xcodebuild}"

mkdir -p "$DERIVED_DATA_PATH"
mkdir -p "$STAGING_DIR"
reject_symlink_components "$DERIVED_DATA_PATH"
reject_symlink_components "$STAGING_DIR"
if find "$STAGING_DIR" -mindepth 1 -print -quit | grep -q .; then
  fail "STAGING_DIR must be empty"
fi

xcode_arguments=(
  -project "$PROJECT_PATH"
  -scheme "$SCHEME"
  -configuration "$CONFIGURATION"
  -derivedDataPath "$DERIVED_DATA_PATH"
)
if [[ -n "${CODE_SIGNING_ALLOWED:-}" ]]; then
  xcode_arguments+=("CODE_SIGNING_ALLOWED=$CODE_SIGNING_ALLOWED")
fi

env DEVELOPER_DIR="$DEVELOPER_DIR" "$XCODEBUILD" "${xcode_arguments[@]}" build

reject_symlink_components "$DERIVED_DATA_PATH"
reject_symlink_components "$STAGING_DIR"
PRODUCTS_DIR="$DERIVED_DATA_PATH/Build/Products/$CONFIGURATION"
reject_symlink_components "$PRODUCTS_DIR"
AGENT_SOURCE="$PRODUCTS_DIR/BarwardenAutoFillAgent"
PROVIDER_SOURCE="$PRODUCTS_DIR/BarwardenCredentialProvider.appex"

[[ -f "$AGENT_SOURCE" && -x "$AGENT_SOURCE" ]] || fail "Agent product is missing or not executable"
[[ -d "$PROVIDER_SOURCE" ]] || fail "Credential Provider product is missing"

if [[ -n "$(find "$PRODUCTS_DIR" -type l -print -quit)" ]]; then
  fail "built products must not contain a symbolic link"
fi

while IFS= read -r candidate; do
  name="$(basename "$candidate")"
  case "$name" in
    BarwardenAutoFillAgent|BarwardenCredentialProvider.appex) ;;
    BarwardenAutoFillAgent.dSYM|BarwardenAutoFillAgent.swiftmodule) ;;
    BarwardenCredentialProvider.appex.dSYM|BarwardenCredentialProvider.swiftmodule) ;;
    *) fail "unexpected product: $name" ;;
  esac
done < <(find "$PRODUCTS_DIR" -mindepth 1 -maxdepth 1 -print | LC_ALL=C sort)

if find "$STAGING_DIR" -mindepth 1 -print -quit | grep -q .; then
  fail "STAGING_DIR must be empty"
fi

/usr/bin/ditto --norsrc --noqtn "$AGENT_SOURCE" "$STAGING_DIR/BarwardenAutoFillAgent"
/usr/bin/ditto --norsrc --noqtn "$PROVIDER_SOURCE" "$STAGING_DIR/BarwardenCredentialProvider.appex"

echo "Native AutoFill products staged at $STAGING_DIR"
