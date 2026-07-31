#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'ICNS inventory regression failed: %s\n' "$1" >&2
  exit 1
}

if [[ "${0##*/}" == "iconutil" ]]; then
  fixture_dir="${BARWARDEN_ICON_TEST_FIXTURE_DIR:-}"
  output_path=""
  while (($# > 0)); do
    if [[ "$1" == "--output" ]]; then
      shift
      (($# > 0)) || fail "mock iconutil received --output without a path"
      output_path="$1"
    fi
    shift
  done
  [[ -n "$fixture_dir" && -d "$fixture_dir" ]] ||
    fail "mock iconutil requires BARWARDEN_ICON_TEST_FIXTURE_DIR"
  [[ -n "$output_path" && ! -e "$output_path" ]] ||
    fail "mock iconutil requires a new output path"
  cp -R "$fixture_dir" "$output_path"
  exit 0
fi

for required_tool in iconutil magick mktemp cp rm mv mkdir ln grep; do
  command -v "$required_tool" >/dev/null 2>&1 ||
    fail "required tool is unavailable: $required_tool"
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
validator="$script_dir/build-barwarden-icons.test.sh"
icon_icns="$repo_root/apps/menubar-tauri/src-tauri/icons/icon.icns"
real_iconutil="$(command -v iconutil)"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/barwarden-icon-inventory-test.XXXXXX")"
trap 'rm -rf -- "$tmp_dir"' EXIT
base_iconset="$tmp_dir/base.iconset"
fixture_iconset="$tmp_dir/fixture.iconset"
mock_bin="$tmp_dir/mock-bin"
mkdir -p "$mock_bin"
ln -s "$script_dir/build-barwarden-icons.inventory.test.sh" "$mock_bin/iconutil"

"$real_iconutil" --convert iconset --output "$base_iconset" "$icon_icns"

run_rejection_case() {
  local case_name="$1"
  local expected_message="$2"
  local log_path="$tmp_dir/$case_name.log"

  if PATH="$mock_bin:$PATH" \
    BARWARDEN_ICON_TEST_FIXTURE_DIR="$fixture_iconset" \
    "$validator" >"$log_path" 2>&1; then
    fail "standalone validator accepted malformed inventory case: $case_name"
  fi
  grep -F "$expected_message" "$log_path" >/dev/null ||
    fail "$case_name did not fail with the expected message"
}

rm -rf -- "$fixture_iconset"
cp -R "$base_iconset" "$fixture_iconset"
rm -- "$fixture_iconset/icon_32x32@2x.png"
cp "$fixture_iconset/icon_128x128.png" "$fixture_iconset/substituted_128.png"
run_rejection_case \
  "missing-substituted-slot" \
  "missing required ICNS slot: icon_32x32@2x.png"

rm -rf -- "$fixture_iconset"
cp -R "$base_iconset" "$fixture_iconset"
cp "$fixture_iconset/icon_128x128.png" "$fixture_iconset/icon_32x32@2x.png"
run_rejection_case \
  "wrong-slot-size" \
  "ICNS slot icon_32x32@2x.png is 128x128, expected 64x64"

rm -rf -- "$fixture_iconset"
cp -R "$base_iconset" "$fixture_iconset"
cp "$fixture_iconset/icon_16x16.png" "$fixture_iconset/unexpected-extra.png"
run_rejection_case \
  "extra-slot" \
  "unexpected ICNS iconset entry: unexpected-extra.png"

rm -rf -- "$fixture_iconset"
cp -R "$base_iconset" "$fixture_iconset"
magick "$fixture_iconset/icon_32x32@2x.png" \
  -alpha off \
  -define png:color-type=2 \
  "$tmp_dir/non-rgba.png"
mv "$tmp_dir/non-rgba.png" "$fixture_iconset/icon_32x32@2x.png"
run_rejection_case \
  "non-rgba-slot" \
  "ICNS slot icon_32x32@2x.png channels are"

printf 'Barwarden exact ICNS inventory regression passed.\n'
