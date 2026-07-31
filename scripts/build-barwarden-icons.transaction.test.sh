#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'icon publication transaction regression failed: %s\n' "$1" >&2
  exit 1
}

for required_tool in shasum mktemp find grep rm; do
  command -v "$required_tool" >/dev/null 2>&1 ||
    fail "required tool is unavailable: $required_tool"
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
icons_dir="$repo_root/apps/menubar-tauri/src-tauri/icons"
build_script="$script_dir/build-barwarden-icons.sh"
output_icon_png="$icons_dir/icon.png"
output_icon_icns="$icons_dir/icon.icns"
output_tray_png="$icons_dir/tray-template@2x.png"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/barwarden-icon-transaction-test.XXXXXX")"
trap 'rm -rf -- "$tmp_dir"' EXIT

hash_outputs() {
  shasum -a 256 "$output_icon_png" "$output_icon_icns" "$output_tray_png"
}

assert_no_transaction_residue() {
  local residue
  residue="$(
    find "$icons_dir" -maxdepth 1 \
      \( -name '.barwarden-icon-new.*' -o -name '.barwarden-icon-backup.*' \) \
      -print
  )"
  [[ -z "$residue" ]] ||
    fail "transaction left replacement or backup files in the production directory"
}

before_hashes="$(hash_outputs)"
assert_no_transaction_residue

run_rollback_case() {
  local fail_at="$1"
  local expected_message="$2"
  local injected_log="$tmp_dir/$fail_at.log"
  local after_hashes

  if BARWARDEN_ICON_TEST_MODE="publication-rollback-v1" \
    BARWARDEN_ICON_TEST_FAIL_AT="$fail_at" \
    "$build_script" >"$injected_log" 2>&1; then
    fail "build unexpectedly succeeded at injected failure point: $fail_at"
  fi
  grep -F "$expected_message" "$injected_log" >/dev/null ||
    fail "$fail_at did not report the expected failure"

  after_hashes="$(hash_outputs)"
  [[ "$after_hashes" == "$before_hashes" ]] ||
    fail "one or more production output hashes changed after rollback at $fail_at"
  assert_no_transaction_residue
}

run_rollback_case \
  "after-icon-icns" \
  "injected test failure after publishing icon.icns"
run_rollback_case \
  "invalidate-tray-before-validation" \
  "tray template dimensions are 1254x1254, expected 36x36"

invalid_guard_log="$tmp_dir/invalid-guard.log"
if BARWARDEN_ICON_TEST_FAIL_AT="after-icon-icns" \
  "$build_script" >"$invalid_guard_log" 2>&1; then
  fail "build accepted failure injection without the exact test-mode guard"
fi
grep -F "test failure injection requires BARWARDEN_ICON_TEST_MODE=publication-rollback-v1" \
  "$invalid_guard_log" >/dev/null ||
  fail "unguarded failure injection did not fail closed"
[[ "$(hash_outputs)" == "$before_hashes" ]] ||
  fail "unguarded failure injection changed production outputs"
assert_no_transaction_residue

printf 'Barwarden icon publication rollback regression passed.\n'
printf '%s\n' "$before_hashes"
