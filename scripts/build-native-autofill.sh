#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
PROJECT_PATH="$REPOSITORY_ROOT/apps/macos-autofill/BarwardenAutoFill.xcodeproj"
SCHEME="BarwardenNativeAutoFill"

CONFIGURATION="${CONFIGURATION:-Release}"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-$REPOSITORY_ROOT/apps/macos-autofill/build/DerivedData}"
STAGING_DIR="${STAGING_DIR:-$REPOSITORY_ROOT/apps/macos-autofill/build/Staging/$CONFIGURATION}"
DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
XCODEBUILD="${XCODEBUILD:-xcodebuild}"

fail() {
  echo "build-native-autofill: $*" >&2
  exit 1
}

case "$CONFIGURATION" in
  Debug|Release) ;;
  *) fail "CONFIGURATION must be Debug or Release" ;;
esac

[[ "$DERIVED_DATA_PATH" = /* ]] || fail "DERIVED_DATA_PATH must be an absolute path"
[[ "$STAGING_DIR" = /* ]] || fail "STAGING_DIR must be an absolute path"
[[ ! -L "$DERIVED_DATA_PATH" ]] || fail "DERIVED_DATA_PATH must not be a symbolic link"
[[ ! -L "$STAGING_DIR" ]] || fail "STAGING_DIR must not be a symbolic link"
[[ -d "$DEVELOPER_DIR" ]] || fail "DEVELOPER_DIR does not contain a full Xcode installation"

mkdir -p "$DERIVED_DATA_PATH"

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

PRODUCTS_DIR="$DERIVED_DATA_PATH/Build/Products/$CONFIGURATION"
AGENT_SOURCE="$PRODUCTS_DIR/BarwardenAutoFillAgent"
PROVIDER_SOURCE="$PRODUCTS_DIR/BarwardenCredentialProvider.appex"

[[ -f "$AGENT_SOURCE" && -x "$AGENT_SOURCE" ]] || fail "Agent product is missing or not executable"
[[ -d "$PROVIDER_SOURCE" ]] || fail "Credential Provider product is missing"

for expected_product in "$AGENT_SOURCE" "$PROVIDER_SOURCE"; do
  [[ ! -L "$expected_product" ]] || fail "product must not be a symbolic link: $expected_product"
  if [[ -d "$expected_product" ]] && find "$expected_product" -type l -print -quit | grep -q .; then
    fail "product contains a symbolic link: $expected_product"
  fi
done

while IFS= read -r candidate; do
  name="$(basename "$candidate")"
  case "$name" in
    BarwardenAutoFillAgent|BarwardenCredentialProvider.appex) ;;
    *.app|*.appex|*.xpc|*.xctest) fail "unexpected product: $name" ;;
    *)
      if [[ -f "$candidate" && -x "$candidate" ]]; then
        fail "unexpected product: $name"
      fi
      ;;
  esac
done < <(find "$PRODUCTS_DIR" -mindepth 1 -maxdepth 1 -print | LC_ALL=C sort)

mkdir -p "$STAGING_DIR"
if find "$STAGING_DIR" -mindepth 1 -print -quit | grep -q .; then
  fail "STAGING_DIR must be empty"
fi

/usr/bin/ditto --norsrc --noqtn "$AGENT_SOURCE" "$STAGING_DIR/BarwardenAutoFillAgent"
/usr/bin/ditto --norsrc --noqtn "$PROVIDER_SOURCE" "$STAGING_DIR/BarwardenCredentialProvider.appex"

echo "Native AutoFill products staged at $STAGING_DIR"
