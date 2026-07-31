#!/usr/bin/env bash

# Approved B4.1 source SHA-256:
# 2f29c0bf2faf3f19b51ad7463193dc01a4d8bc267e1a39c5d8b66e44038b8138

set -euo pipefail

fail() {
  printf 'Barwarden icon build failed: %s\n' "$1" >&2
  exit 1
}

for required_tool in magick sips iconutil shasum find; do
  command -v "$required_tool" >/dev/null 2>&1 ||
    fail "required tool is unavailable: $required_tool"
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
icons_dir="$repo_root/apps/menubar-tauri/src-tauri/icons"
source_png="$icons_dir/barwarden-b4.1-source.png"
output_icon_png="$icons_dir/icon.png"
output_icon_icns="$icons_dir/icon.icns"
output_tray_png="$icons_dir/tray-template@2x.png"
expected_source_sha256="2f29c0bf2faf3f19b51ad7463193dc01a4d8bc267e1a39c5d8b66e44038b8138"
test_mode="${BARWARDEN_ICON_TEST_MODE:-}"
test_fail_at="${BARWARDEN_ICON_TEST_FAIL_AT:-}"

if [[ -n "$test_mode" || -n "$test_fail_at" ]]; then
  [[ "$test_mode" == "publication-rollback-v1" ]] ||
    fail "test failure injection requires BARWARDEN_ICON_TEST_MODE=publication-rollback-v1"
  case "$test_fail_at" in
    after-icon-png | after-icon-icns | invalidate-tray-before-validation) ;;
    *) fail "invalid BARWARDEN_ICON_TEST_FAIL_AT value: ${test_fail_at:-<empty>}" ;;
  esac
fi

[[ -f "$source_png" ]] || fail "approved source is missing: $source_png"

read -r actual_source_sha256 _ < <(shasum -a 256 "$source_png")
[[ "$actual_source_sha256" == "$expected_source_sha256" ]] ||
  fail "approved source SHA-256 is $actual_source_sha256, expected $expected_source_sha256"

read -r source_format source_width source_height source_channels < <(
  magick identify -format '%m %w %h %[channels]\n' "$source_png"
)
[[ "$source_format" == "PNG" ]] || fail "approved source format is $source_format, expected PNG"
[[ "$source_width" == "1254" && "$source_height" == "1254" ]] ||
  fail "approved source dimensions are ${source_width}x${source_height}, expected 1254x1254"
[[ "$source_channels" == srgb* ]] ||
  fail "approved source channels are $source_channels, expected RGB-compatible channels"

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/barwarden-icons-build.XXXXXX")"
transaction_active=0
production_outputs=("$output_icon_png" "$output_icon_icns" "$output_tray_png")
replacement_paths=()
backup_paths=()

rollback_publication() {
  local rollback_failed=0
  local path_index backup_path

  for ((path_index = 0; path_index < ${#production_outputs[@]}; path_index += 1)); do
    backup_path="${backup_paths[$path_index]:-}"
    if [[ -n "$backup_path" && -f "$backup_path" ]]; then
      if ! mv -f -- "$backup_path" "${production_outputs[$path_index]}"; then
        rollback_failed=1
      fi
    else
      rollback_failed=1
    fi
  done
  if ((rollback_failed == 0)); then
    transaction_active=0
    return 0
  fi
  return 1
}

cleanup_on_exit() {
  local exit_status=$?
  local cleanup_path
  local cleanup_transaction_files=1
  trap - EXIT

  if [[ "$transaction_active" == "1" ]]; then
    if rollback_publication; then
      printf 'Barwarden icon publication rolled back to the complete prior asset set.\n' >&2
    else
      printf 'Barwarden icon publication rollback failed; inspect production assets immediately.\n' >&2
      exit_status=1
      cleanup_transaction_files=0
    fi
  fi

  if [[ "$cleanup_transaction_files" == "1" ]]; then
    for cleanup_path in "${replacement_paths[@]}" "${backup_paths[@]}"; do
      [[ -n "$cleanup_path" ]] && rm -f -- "$cleanup_path"
    done
  fi
  rm -rf -- "$tmp_dir"
  exit "$exit_status"
}

trap cleanup_on_exit EXIT

generated_icon_png="$tmp_dir/icon.png"
generated_tray_mask="$tmp_dir/tray-mask.png"
generated_tray_png="$tmp_dir/tray-template@2x.png"
generated_iconset="$tmp_dir/Barwarden.iconset"
generated_icon_icns="$tmp_dir/icon.icns"
extracted_iconset="$tmp_dir/extracted.iconset"

magick "$source_png" \
  -alpha set \
  -fuzz '12%' \
  -fill none \
  -draw 'alpha 0,0 floodfill' \
  -draw 'alpha 1253,0 floodfill' \
  -draw 'alpha 0,1253 floodfill' \
  -draw 'alpha 1253,1253 floodfill' \
  -filter Lanczos \
  -resize '1024x1024!' \
  -gravity center \
  -background none \
  -extent '1024x1024' \
  -strip \
  -define png:color-type=6 \
  "$generated_icon_png"

magick "$source_png" \
  -alpha off \
  -colorspace Gray \
  -threshold '75%' \
  -trim \
  +repage \
  -filter Lanczos \
  -resize '28x28>' \
  -gravity center \
  -background black \
  -extent '36x36' \
  -strip \
  "$generated_tray_mask"

magick -size '36x36' xc:black \
  "$generated_tray_mask" \
  -alpha off \
  -compose CopyAlpha \
  -composite \
  -strip \
  -define png:color-type=6 \
  "$generated_tray_png"

read -r icon_format icon_width icon_height icon_channels < <(
  magick identify -format '%m %w %h %[channels]\n' "$generated_icon_png"
)
[[ "$icon_format" == "PNG" ]] || fail "generated icon format is $icon_format, expected PNG"
[[ "$icon_width" == "1024" && "$icon_height" == "1024" ]] ||
  fail "generated icon dimensions are ${icon_width}x${icon_height}, expected 1024x1024"
[[ "$icon_channels" == srgba* ]] ||
  fail "generated icon channels are $icon_channels, expected RGBA"

read -r alpha_top_left alpha_top_right alpha_bottom_left alpha_bottom_right icon_center_visible < <(
  magick "$generated_icon_png" -format \
    '%[fx:p{0,0}.a] %[fx:p{1023,0}.a] %[fx:p{0,1023}.a] %[fx:p{1023,1023}.a] %[fx:p{512,512}.a>0?1:0]\n' \
    info:
)
[[ "$alpha_top_left" == "0" && "$alpha_top_right" == "0" &&
  "$alpha_bottom_left" == "0" && "$alpha_bottom_right" == "0" ]] ||
  fail "generated icon does not have four fully transparent corners"
[[ "$icon_center_visible" == "1" ]] ||
  fail "generated icon center does not contain visible logo content"

read -r icon_bounds_width icon_bounds_height icon_bounds_x icon_bounds_y < <(
  magick "$generated_icon_png" -alpha extract -threshold 0 -trim \
    -format '%w %h %X %Y\n' info:
)
((icon_bounds_width > 0 && icon_bounds_height > 0 &&
  icon_bounds_width < 1024 && icon_bounds_height < 1024 &&
  icon_bounds_x > 0 && icon_bounds_y > 0)) ||
  fail "generated icon visible bounds are invalid: ${icon_bounds_width}x${icon_bounds_height}+${icon_bounds_x}+${icon_bounds_y}"

read -r tray_format tray_width tray_height tray_channels < <(
  magick identify -format '%m %w %h %[channels]\n' "$generated_tray_png"
)
[[ "$tray_format" == "PNG" ]] || fail "generated tray format is $tray_format, expected PNG"
[[ "$tray_width" == "36" && "$tray_height" == "36" ]] ||
  fail "generated tray dimensions are ${tray_width}x${tray_height}, expected 36x36"
[[ "$tray_channels" == srgba* ]] ||
  fail "generated tray channels are $tray_channels, expected RGBA"

read -r tray_has_transparent tray_has_visible tray_key_head_transparent tray_shaft_transparent tray_mark_visible tray_rgb_is_black < <(
  magick "$generated_tray_png" -format \
    '%[fx:minima.a==0?1:0] %[fx:maxima.a>0?1:0] %[fx:p{17,12}.a==0?1:0] %[fx:p{17,20}.a==0?1:0] %[fx:p{9,12}.a>0?1:0] %[fx:maxima.r==0&&maxima.g==0&&maxima.b==0?1:0]\n' \
    info:
)
[[ "$tray_has_transparent" == "1" && "$tray_has_visible" == "1" ]] ||
  fail "generated tray alpha does not contain both transparent and visible pixels"
[[ "$tray_key_head_transparent" == "1" && "$tray_shaft_transparent" == "1" ]] ||
  fail "generated tray alpha does not preserve the key-head and shaft holes"
[[ "$tray_mark_visible" == "1" ]] ||
  fail "generated tray does not contain the expected B-mark alpha"
[[ "$tray_rgb_is_black" == "1" ]] ||
  fail "generated tray contains colored or non-black RGB pixels"

read -r tray_bounds_width tray_bounds_height tray_bounds_x tray_bounds_y < <(
  magick "$generated_tray_png" -alpha extract -threshold 0 -trim \
    -format '%w %h %X %Y\n' info:
)
tray_right_padding=$((36 - tray_bounds_x - tray_bounds_width))
tray_bottom_padding=$((36 - tray_bounds_y - tray_bounds_height))
((tray_bounds_width <= 32 && tray_bounds_height <= 32 &&
  tray_bounds_x >= 2 && tray_bounds_y >= 2 &&
  tray_right_padding >= 2 && tray_bottom_padding >= 2)) ||
  fail "generated tray bounds do not fit within 32x32 with 2px padding: ${tray_bounds_width}x${tray_bounds_height}+${tray_bounds_x}+${tray_bounds_y}"

mkdir -p "$generated_iconset"
slot_names=(
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
slot_sizes=(16 32 32 64 128 256 256 512 512 1024)

for ((slot_index = 0; slot_index < ${#slot_names[@]}; slot_index += 1)); do
  slot_name="${slot_names[$slot_index]}"
  slot_size="${slot_sizes[$slot_index]}"
  if [[ "$slot_size" == "1024" ]]; then
    cp "$generated_icon_png" "$generated_iconset/$slot_name"
  else
    sips -z "$slot_size" "$slot_size" "$generated_icon_png" \
      --out "$generated_iconset/$slot_name" >/dev/null
  fi
done

iconutil --convert icns --output "$generated_icon_icns" "$generated_iconset"

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

iconutil --convert iconset --output "$extracted_iconset" "$generated_icon_icns"
validate_exact_iconset_inventory "$extracted_iconset"

for production_output in "${production_outputs[@]}"; do
  [[ -f "$production_output" ]] ||
    fail "transaction requires the complete prior production set: $production_output"
done

replacement_paths[0]="$(mktemp "$icons_dir/.barwarden-icon-new.icon.png.XXXXXX")"
replacement_paths[1]="$(mktemp "$icons_dir/.barwarden-icon-new.icon.icns.XXXXXX")"
replacement_paths[2]="$(mktemp "$icons_dir/.barwarden-icon-new.tray-template.XXXXXX")"
backup_paths[0]="$(mktemp "$icons_dir/.barwarden-icon-backup.icon.png.XXXXXX")"
backup_paths[1]="$(mktemp "$icons_dir/.barwarden-icon-backup.icon.icns.XXXXXX")"
backup_paths[2]="$(mktemp "$icons_dir/.barwarden-icon-backup.tray-template.XXXXXX")"

cp -p "$generated_icon_png" "${replacement_paths[0]}"
cp -p "$generated_icon_icns" "${replacement_paths[1]}"
cp -p "$generated_tray_png" "${replacement_paths[2]}"
cp -p "$output_icon_png" "${backup_paths[0]}"
cp -p "$output_icon_icns" "${backup_paths[1]}"
cp -p "$output_tray_png" "${backup_paths[2]}"

transaction_active=1
mv -f -- "${replacement_paths[0]}" "$output_icon_png"
if [[ "$test_fail_at" == "after-icon-png" ]]; then
  fail "injected test failure after publishing icon.png"
fi
mv -f -- "${replacement_paths[1]}" "$output_icon_icns"
if [[ "$test_fail_at" == "after-icon-icns" ]]; then
  fail "injected test failure after publishing icon.icns"
fi
mv -f -- "${replacement_paths[2]}" "$output_tray_png"
if [[ "$test_fail_at" == "invalidate-tray-before-validation" ]]; then
  cp -p "$source_png" "$output_tray_png"
fi

"$script_dir/build-barwarden-icons.test.sh"

transaction_active=0
rm -f -- "${backup_paths[@]}" "${replacement_paths[@]}"

printf 'Barwarden icon assets generated from the pinned B4.1 source.\n'
