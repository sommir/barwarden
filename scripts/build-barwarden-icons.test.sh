#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'icon asset validation failed: %s\n' "$1" >&2
  exit 1
}

for required_tool in magick iconutil shasum cmp find; do
  command -v "$required_tool" >/dev/null 2>&1 ||
    fail "required tool is unavailable: $required_tool"
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
icons_dir="$repo_root/apps/menubar-tauri/src-tauri/icons"
expected_source_sha256="2f29c0bf2faf3f19b51ad7463193dc01a4d8bc267e1a39c5d8b66e44038b8138"
source_png="$icons_dir/barwarden-b4.1-source.png"
icon_png="$icons_dir/icon.png"
icon_icns="$icons_dir/icon.icns"
tray_png="$icons_dir/tray-template@2x.png"
vendored_safari_png="$repo_root/vendor/bitwarden-clients/apps/browser/src/images/icon18_safari@2x.png"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/barwarden-icons-test.XXXXXX")"
trap 'rm -rf -- "$tmp_dir"' EXIT

for required_file in \
  "$source_png" \
  "$icon_png" \
  "$icon_icns" \
  "$tray_png" \
  "$vendored_safari_png"; do
  [[ -f "$required_file" ]] || fail "required file is missing: $required_file"
done

read -r actual_source_sha256 _ < <(shasum -a 256 "$source_png")
[[ "$actual_source_sha256" == "$expected_source_sha256" ]] ||
  fail "source SHA-256 is $actual_source_sha256, expected $expected_source_sha256"

read -r source_format source_width source_height source_channels < <(
  magick identify -format '%m %w %h %[channels]\n' "$source_png"
)
[[ "$source_format" == "PNG" ]] || fail "source format is $source_format, expected PNG"
[[ "$source_width" == "1254" && "$source_height" == "1254" ]] ||
  fail "source dimensions are ${source_width}x${source_height}, expected 1254x1254"
[[ "$source_channels" == srgb* ]] ||
  fail "source channels are $source_channels, expected RGB-compatible channels"

read -r icon_format icon_width icon_height icon_channels < <(
  magick identify -format '%m %w %h %[channels]\n' "$icon_png"
)
[[ "$icon_format" == "PNG" ]] || fail "icon.png format is $icon_format, expected PNG"
[[ "$icon_width" == "1024" && "$icon_height" == "1024" ]] ||
  fail "icon.png dimensions are ${icon_width}x${icon_height}, expected 1024x1024"
[[ "$icon_channels" == srgba* ]] ||
  fail "icon.png channels are $icon_channels, expected RGBA"

read -r alpha_top_left alpha_top_right alpha_bottom_left alpha_bottom_right icon_center_visible < <(
  magick "$icon_png" -format \
    '%[fx:p{0,0}.a] %[fx:p{1023,0}.a] %[fx:p{0,1023}.a] %[fx:p{1023,1023}.a] %[fx:p{512,512}.a>0?1:0]\n' \
    info:
)
[[ "$alpha_top_left" == "0" ]] || fail "icon.png top-left corner is not transparent"
[[ "$alpha_top_right" == "0" ]] || fail "icon.png top-right corner is not transparent"
[[ "$alpha_bottom_left" == "0" ]] || fail "icon.png bottom-left corner is not transparent"
[[ "$alpha_bottom_right" == "0" ]] || fail "icon.png bottom-right corner is not transparent"
[[ "$icon_center_visible" == "1" ]] || fail "icon.png center does not contain visible logo content"

read -r tray_format tray_width tray_height tray_channels < <(
  magick identify -format '%m %w %h %[channels]\n' "$tray_png"
)
[[ "$tray_format" == "PNG" ]] || fail "tray template format is $tray_format, expected PNG"
[[ "$tray_width" == "36" && "$tray_height" == "36" ]] ||
  fail "tray template dimensions are ${tray_width}x${tray_height}, expected 36x36"
[[ "$tray_channels" == srgba* ]] ||
  fail "tray template channels are $tray_channels, expected RGBA"

read -r tray_has_transparent tray_has_visible < <(
  magick "$tray_png" -alpha extract \
    -format '%[fx:minima==0?1:0] %[fx:maxima>0?1:0]\n' info:
)
[[ "$tray_has_transparent" == "1" ]] ||
  fail "tray template does not contain transparent alpha"
[[ "$tray_has_visible" == "1" ]] ||
  fail "tray template does not contain visible alpha"

read -r tray_key_head_transparent tray_shaft_transparent tray_mark_visible tray_rgb_is_black < <(
  magick "$tray_png" -format \
    '%[fx:p{17,12}.a==0?1:0] %[fx:p{17,20}.a==0?1:0] %[fx:p{9,12}.a>0?1:0] %[fx:maxima.r==0&&maxima.g==0&&maxima.b==0?1:0]\n' \
    info:
)
[[ "$tray_key_head_transparent" == "1" ]] ||
  fail "tray template does not preserve the key-head hole in alpha"
[[ "$tray_shaft_transparent" == "1" ]] ||
  fail "tray template does not preserve the key shaft in alpha"
[[ "$tray_mark_visible" == "1" ]] ||
  fail "tray template does not contain the expected B-mark alpha"
[[ "$tray_rgb_is_black" == "1" ]] ||
  fail "tray template contains colored or non-black RGB pixels"

read -r tray_bounds_width tray_bounds_height tray_bounds_x tray_bounds_y < <(
  magick "$tray_png" -alpha extract -threshold 0 -trim \
    -format '%w %h %X %Y\n' info:
)
tray_right_padding=$((36 - tray_bounds_x - tray_bounds_width))
tray_bottom_padding=$((36 - tray_bounds_y - tray_bounds_height))
((tray_bounds_width <= 32 && tray_bounds_height <= 32)) ||
  fail "tray visible bounds are ${tray_bounds_width}x${tray_bounds_height}, expected at most 32x32"
((tray_bounds_x >= 2 && tray_bounds_y >= 2 &&
  tray_right_padding >= 2 && tray_bottom_padding >= 2)) ||
  fail "tray visible bounds do not leave at least 2px padding on every side"

if cmp -s "$tray_png" "$vendored_safari_png"; then
  fail "tray template is still the old vendored Safari icon"
fi

validate_exact_iconset_inventory() {
  local iconset_dir="$1"
  local expected_names=(
    icon_16x16.png
    icon_16x16@2x.png
    icon_32x32.png
    icon_32x32@2x.png
    icon_128x128.png
    icon_128x128@2x.png
    icon_256x256.png
    icon_256x256@2x.png
    icon_512x512.png
    icon_512x512@2x.png
  )
  local expected_sizes=(16 32 32 64 128 256 256 512 512 1024)
  local slot_index slot_name slot_size slot_path
  local slot_format slot_width slot_height slot_channels
  local entry entry_name entry_is_expected expected_name
  local entry_count=0

  for ((slot_index = 0; slot_index < ${#expected_names[@]}; slot_index += 1)); do
    slot_name="${expected_names[$slot_index]}"
    slot_size="${expected_sizes[$slot_index]}"
    slot_path="$iconset_dir/$slot_name"
    [[ -f "$slot_path" && ! -L "$slot_path" ]] ||
      fail "missing required ICNS slot: $slot_name"
    read -r slot_format slot_width slot_height slot_channels < <(
      magick identify -format '%m %w %h %[channels]\n' "$slot_path"
    )
    [[ "$slot_format" == "PNG" ]] ||
      fail "ICNS slot $slot_name format is $slot_format, expected PNG"
    [[ "$slot_width" == "$slot_size" && "$slot_height" == "$slot_size" ]] ||
      fail "ICNS slot $slot_name is ${slot_width}x${slot_height}, expected ${slot_size}x${slot_size}"
    [[ "$slot_channels" == srgba* ]] ||
      fail "ICNS slot $slot_name channels are $slot_channels, expected RGBA"
  done

  while IFS= read -r -d '' entry; do
    entry_count=$((entry_count + 1))
    entry_name="${entry##*/}"
    entry_is_expected=0
    for expected_name in "${expected_names[@]}"; do
      if [[ "$entry_name" == "$expected_name" ]]; then
        entry_is_expected=1
        break
      fi
    done
    [[ "$entry_is_expected" == "1" ]] ||
      fail "unexpected ICNS iconset entry: $entry_name"
  done < <(find "$iconset_dir" -mindepth 1 -maxdepth 1 -print0)

  [[ "$entry_count" == "${#expected_names[@]}" ]] ||
    fail "ICNS iconset contains $entry_count entries, expected exactly ${#expected_names[@]}"
}

extracted_iconset="$tmp_dir/extracted.iconset"
iconutil --convert iconset --output "$extracted_iconset" "$icon_icns"
validate_exact_iconset_inventory "$extracted_iconset"

printf 'Barwarden icon asset validation passed.\n'
