#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
APP_NAME="Barwarden.app"
APP_PATH=""
DMG_PATH=""
ATTESTATION_PATH=""
TEMP_ROOT="$(/usr/bin/mktemp -d /private/tmp/barwarden-native-verifier.XXXXXX)"
MOUNT_PATH=""
MOUNTED=0

fail() {
  local sanitized
  sanitized="$(node "$SCRIPT_DIR/native-autofill-release-codes.mjs" "$1" 2>/dev/null)" || \
    sanitized=NATIVE_AUTOFILL_INTERNAL_ERROR
  printf '%s\n' "$sanitized" >&2
  exit 1
}

cleanup() {
  if [[ "$MOUNTED" == 1 ]]; then
    /usr/bin/hdiutil detach "$MOUNT_PATH" -quiet >/dev/null 2>&1 || true
  fi
  /bin/rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

usage() {
  printf '%s\n' 'Usage: verify-native-autofill-bundle.sh --app APP --dmg DMG --attestation JSON'
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app)
      [[ $# -ge 2 ]] || fail NATIVE_AUTOFILL_ARGUMENT_INVALID
      APP_PATH="$2"
      shift 2
      ;;
    --dmg)
      [[ $# -ge 2 ]] || fail NATIVE_AUTOFILL_ARGUMENT_INVALID
      DMG_PATH="$2"
      shift 2
      ;;
    --attestation)
      [[ $# -ge 2 ]] || fail NATIVE_AUTOFILL_ARGUMENT_INVALID
      ATTESTATION_PATH="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail NATIVE_AUTOFILL_ARGUMENT_INVALID
      ;;
  esac
done

verify_inspection() {
  node --input-type=module - "$SCRIPT_DIR/native-autofill-release-policy.mjs" "$1" <<'NODE'
const modulePath = process.argv[2];
const inspectionPath = process.argv[3];
try {
  const { loadAndVerifyNativeAutoFillInspection } = await import(`file://${modulePath}`);
  console.log(loadAndVerifyNativeAutoFillInspection(inspectionPath));
} catch (error) {
  console.error(error?.code ?? "NATIVE_AUTOFILL_INSPECTION_INVALID");
  process.exit(1);
}
NODE
}

[[ -n "$APP_PATH" && -n "$DMG_PATH" && -n "$ATTESTATION_PATH" ]] || fail NATIVE_AUTOFILL_ARGUMENT_INVALID
for artifact_path in "$APP_PATH" "$DMG_PATH" "$ATTESTATION_PATH"; do
  [[ "$artifact_path" = /* ]] || fail NATIVE_AUTOFILL_ARGUMENT_INVALID
  reject_symlink_components "$artifact_path" || fail NATIVE_AUTOFILL_SYMLINK_FORBIDDEN
done
[[ -d "$APP_PATH" && ! -L "$APP_PATH" && "$(basename "$APP_PATH")" == Barwarden.app ]] || \
  fail NATIVE_AUTOFILL_APP_ARTIFACT_INVALID
[[ -f "$DMG_PATH" && ! -L "$DMG_PATH" ]] || fail NATIVE_AUTOFILL_DMG_ARTIFACT_INVALID
[[ -f "$ATTESTATION_PATH" && ! -L "$ATTESTATION_PATH" ]] || fail NATIVE_AUTOFILL_ATTESTATION_INVALID

APP_INFO="$APP_PATH/Contents/Info.plist"
PROVIDER_PATH="$APP_PATH/Contents/PlugIns/BarwardenCredentialProvider.appex"
PROVIDER_INFO="$PROVIDER_PATH/Contents/Info.plist"
AGENT_PATH="$APP_PATH/Contents/Helpers/BarwardenAutoFillAgent"
LAUNCH_AGENT_PATH="$APP_PATH/Contents/Library/LaunchAgents/com.sommir.barwarden.autofill-agent.plist"
[[ -f "$APP_INFO" && -f "$PROVIDER_INFO" && -f "$AGENT_PATH" && -f "$LAUNCH_AGENT_PATH" ]] || \
  fail NATIVE_AUTOFILL_INVENTORY_MISSING
[[ -z "$(/usr/bin/find -P "$APP_PATH" -type l -print -quit 2>/dev/null)" ]] || \
  fail NATIVE_AUTOFILL_SYMLINK_FORBIDDEN

APP_EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_INFO" 2>/dev/null)" || \
  fail NATIVE_AUTOFILL_INSPECTION_INVALID
PROVIDER_EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$PROVIDER_INFO" 2>/dev/null)" || \
  fail NATIVE_AUTOFILL_INSPECTION_INVALID
[[ -f "$APP_PATH/Contents/MacOS/$APP_EXECUTABLE" && -x "$APP_PATH/Contents/MacOS/$APP_EXECUTABLE" ]] || \
  fail NATIVE_AUTOFILL_INVENTORY_MISSING
[[ -f "$PROVIDER_PATH/Contents/MacOS/$PROVIDER_EXECUTABLE" && -x "$PROVIDER_PATH/Contents/MacOS/$PROVIDER_EXECUTABLE" ]] || \
  fail NATIVE_AUTOFILL_INVENTORY_MISSING
[[ -x "$AGENT_PATH" ]] || fail NATIVE_AUTOFILL_INVENTORY_MISSING

/usr/bin/plutil -convert json -o - "$LAUNCH_AGENT_PATH" 2>/dev/null | node --input-type=module -e '
  let text=""; process.stdin.on("data", chunk => text += chunk); process.stdin.on("end", () => {
    try {
      const value=JSON.parse(text);
      const valid=JSON.stringify(Object.keys(value).sort())===JSON.stringify([
        "BundleProgram","KeepAlive","Label","RunAtLoad","ThrottleInterval",
      ]) && value.BundleProgram==="Contents/Helpers/BarwardenAutoFillAgent" &&
        JSON.stringify(value.KeepAlive)===JSON.stringify({SuccessfulExit:false}) &&
        value.Label==="com.sommir.barwarden.autofill-agent" && value.RunAtLoad===true &&
        value.ThrottleInterval===30;
      process.exit(valid ? 0 : 1);
    } catch { process.exit(1); }
  });' || fail NATIVE_AUTOFILL_LAUNCH_AGENT_INVALID
for command_name in autofill_agent_registration_status autofill_agent_register autofill_agent_unregister; do
  /usr/bin/strings "$APP_PATH/Contents/MacOS/$APP_EXECUTABLE" | /usr/bin/grep -Fqx "$command_name" || \
    fail NATIVE_AUTOFILL_AGENT_REGISTRATION_SURFACE_MISSING
done

unexpected_code=0
while IFS= read -r executable; do
  case "$executable" in
    "$APP_PATH/Contents/MacOS/$APP_EXECUTABLE"|"$PROVIDER_PATH/Contents/MacOS/$PROVIDER_EXECUTABLE"|"$AGENT_PATH") ;;
    *) unexpected_code=1 ;;
  esac
done < <(/usr/bin/find -P "$APP_PATH/Contents" -type f -perm -111 -print 2>/dev/null)
while IFS= read -r nested; do
  [[ "$nested" == "$PROVIDER_PATH" ]] || unexpected_code=1
done < <(/usr/bin/find -P "$APP_PATH/Contents" -type d \( -name '*.app' -o -name '*.appex' -o -name '*.framework' -o -name '*.xpc' \) -print 2>/dev/null)
while IFS= read -r candidate; do
  case "$candidate" in
    "$APP_PATH/Contents/MacOS/$APP_EXECUTABLE"|"$PROVIDER_PATH/Contents/MacOS/$PROVIDER_EXECUTABLE"|"$AGENT_PATH") continue ;;
  esac
  kind="$(/usr/bin/file -b "$candidate" 2>/dev/null || true)"
  [[ "$kind" != *'Mach-O'* && "$candidate" != *.dylib ]] || unexpected_code=1
done < <(/usr/bin/find -P "$APP_PATH/Contents" -type f -print 2>/dev/null)
[[ "$unexpected_code" == 0 ]] || fail NATIVE_AUTOFILL_INVENTORY_UNEXPECTED

signature_details() {
  local target="$1" output="$2"
  /usr/bin/codesign -dvvv "$target" >"$output" 2>&1
}
if ! signature_details "$AGENT_PATH" "$TEMP_ROOT/agent-signature"; then
  fail NATIVE_AUTOFILL_INNER_UNSIGNED
fi
if ! signature_details "$PROVIDER_PATH" "$TEMP_ROOT/provider-signature"; then
  fail NATIVE_AUTOFILL_INNER_UNSIGNED
fi
if ! signature_details "$APP_PATH" "$TEMP_ROOT/app-signature"; then
  fail NATIVE_AUTOFILL_OUTER_SIGNATURE_INVALID
fi
component_value() {
  /usr/bin/awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$2"
}
for signature_file in "$TEMP_ROOT/provider-signature" "$TEMP_ROOT/agent-signature"; do
  /usr/bin/grep -Fq 'Authority=Developer ID Application:' "$signature_file" || fail NATIVE_AUTOFILL_INNER_UNSIGNED
done
/usr/bin/grep -Fq 'Authority=Developer ID Application:' "$TEMP_ROOT/app-signature" || \
  fail NATIVE_AUTOFILL_OUTER_SIGNATURE_INVALID
for signature_file in "$TEMP_ROOT/app-signature" "$TEMP_ROOT/provider-signature" "$TEMP_ROOT/agent-signature"; do
  [[ "$(component_value TeamIdentifier "$signature_file")" == K7LY92JY96 ]] || fail NATIVE_AUTOFILL_TEAM_MISMATCH
  /usr/bin/grep -Eq '^flags=.*\(.*runtime.*\)' "$signature_file" || fail NATIVE_AUTOFILL_HARDENED_RUNTIME_MISSING
done
[[ "$(component_value Identifier "$TEMP_ROOT/app-signature")" == com.sommir.barwarden ]] || \
  fail NATIVE_AUTOFILL_BUNDLE_ID_MISMATCH
[[ "$(component_value Identifier "$TEMP_ROOT/provider-signature")" == com.sommir.barwarden.credential-provider ]] || \
  fail NATIVE_AUTOFILL_BUNDLE_ID_MISMATCH
[[ "$(component_value Identifier "$TEMP_ROOT/agent-signature")" == com.sommir.barwarden.autofill-agent ]] || \
  fail NATIVE_AUTOFILL_BUNDLE_ID_MISMATCH
if ! signature_details "$DMG_PATH" "$TEMP_ROOT/dmg-signature"; then
  fail NATIVE_AUTOFILL_DMG_SIGNATURE_INVALID
fi
/usr/bin/grep -Fq 'Authority=Developer ID Application:' "$TEMP_ROOT/dmg-signature" || \
  fail NATIVE_AUTOFILL_DMG_SIGNATURE_INVALID
[[ "$(component_value TeamIdentifier "$TEMP_ROOT/dmg-signature")" == K7LY92JY96 ]] || \
  fail NATIVE_AUTOFILL_DMG_SIGNATURE_INVALID

for component in "$AGENT_PATH" "$PROVIDER_PATH" "$APP_PATH"; do
  /usr/bin/codesign --verify --strict --verbose=2 "$component" >"$TEMP_ROOT/codesign-verify" 2>&1 || \
    fail NATIVE_AUTOFILL_OUTER_SEAL_INVALID
done
/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP_PATH" >"$TEMP_ROOT/deep-verify" 2>&1 || \
  fail NATIVE_AUTOFILL_OUTER_SEAL_INVALID
/usr/bin/codesign --verify --strict --verbose=2 "$DMG_PATH" >"$TEMP_ROOT/dmg-signature-verify" 2>&1 || \
  fail NATIVE_AUTOFILL_DMG_SIGNATURE_INVALID

/usr/bin/codesign --verify -R='anchor apple generic and certificate leaf[subject.OU] = "K7LY92JY96" and identifier "com.sommir.barwarden"' "$APP_PATH" >/dev/null 2>&1 || \
  fail NATIVE_AUTOFILL_DESIGNATED_REQUIREMENT_INVALID
/usr/bin/codesign --verify -R='anchor apple generic and certificate leaf[subject.OU] = "K7LY92JY96" and identifier "com.sommir.barwarden.credential-provider"' "$PROVIDER_PATH" >/dev/null 2>&1 || \
  fail NATIVE_AUTOFILL_DESIGNATED_REQUIREMENT_INVALID
/usr/bin/codesign --verify -R='anchor apple generic and certificate leaf[subject.OU] = "K7LY92JY96" and identifier "com.sommir.barwarden.autofill-agent"' "$AGENT_PATH" >/dev/null 2>&1 || \
  fail NATIVE_AUTOFILL_DESIGNATED_REQUIREMENT_INVALID

APP_ENTITLEMENTS="$TEMP_ROOT/app-entitlements.plist"
PROVIDER_ENTITLEMENTS="$TEMP_ROOT/provider-entitlements.plist"
AGENT_ENTITLEMENTS="$TEMP_ROOT/agent-entitlements.plist"
/usr/bin/codesign -d --entitlements :- "$APP_PATH" >"$APP_ENTITLEMENTS" 2>/dev/null || fail NATIVE_AUTOFILL_INSPECTION_INVALID
/usr/bin/codesign -d --entitlements :- "$PROVIDER_PATH" >"$PROVIDER_ENTITLEMENTS" 2>/dev/null || fail NATIVE_AUTOFILL_INSPECTION_INVALID
/usr/bin/codesign -d --entitlements :- "$AGENT_PATH" >"$AGENT_ENTITLEMENTS" 2>/dev/null || fail NATIVE_AUTOFILL_INSPECTION_INVALID

entitlement_summary() {
  /usr/bin/plutil -convert json -o - "$1" 2>/dev/null | node --input-type=module -e '
    let text=""; process.stdin.on("data", c => text += c); process.stdin.on("end", () => {
      try {
        const e=JSON.parse(text);
        const value={
          appGroups:e["com.apple.security.application-groups"] ?? [],
          keychainGroups:e["keychain-access-groups"] ?? [],
          entitlementKeys:Object.keys(e).sort(),
          browserAutomation:e["com.apple.security.automation.apple-events"] === true,
          credentialProvider:e["com.apple.developer.authentication-services.autofill-credential-provider"] === true,
          appSandbox:e["com.apple.security.app-sandbox"] === true,
          applicationIdentifier:e["com.apple.application-identifier"] ?? null,
          developerTeamIdentifier:e["com.apple.developer.team-identifier"] ?? null,
        };
        process.stdout.write(JSON.stringify(value));
      } catch { process.exit(1); }
    });'
}
APP_ENTITLEMENT_JSON="$(entitlement_summary "$APP_ENTITLEMENTS")" || fail NATIVE_AUTOFILL_INSPECTION_INVALID
PROVIDER_ENTITLEMENT_JSON="$(entitlement_summary "$PROVIDER_ENTITLEMENTS")" || fail NATIVE_AUTOFILL_INSPECTION_INVALID
AGENT_ENTITLEMENT_JSON="$(entitlement_summary "$AGENT_ENTITLEMENTS")" || fail NATIVE_AUTOFILL_INSPECTION_INVALID

validate_provider_profile() {
  local profile_path="$1" output_plist="$2"
  [[ -f "$profile_path" && ! -L "$profile_path" ]] || return 1
  if ! /usr/bin/security cms -D -i "$profile_path" >"$output_plist" 2>/dev/null; then
    /usr/bin/openssl cms -verify -inform DER -noverify \
      -in "$profile_path" -out "$output_plist" >/dev/null 2>&1 || return 1
  fi
  /usr/bin/plutil -convert json -o "$TEMP_ROOT/provider-profile.json" "$output_plist" 2>/dev/null || return 1
  /usr/bin/codesign -d --extract-certificates "$TEMP_ROOT/provider-signer-" "$PROVIDER_PATH" >/dev/null 2>&1 || return 1
  [[ -f "$TEMP_ROOT/provider-signer-0" ]] || return 1
  PROVIDER_PROFILE_SUMMARY="$(node "$SCRIPT_DIR/native-autofill-provider-profile.mjs" \
    "$TEMP_ROOT/provider-profile.json" "$TEMP_ROOT/provider-signer-0" 2>/dev/null)" || return 1
}
[[ ! -e "$APP_PATH/Contents/embedded.provisionprofile" ]] || fail NATIVE_AUTOFILL_INVENTORY_UNEXPECTED
PROVIDER_PROFILE_SUMMARY=""
validate_provider_profile \
  "$PROVIDER_PATH/Contents/embedded.provisionprofile" \
  "$TEMP_ROOT/provider-profile.plist" || \
  fail NATIVE_AUTOFILL_PROVIDER_PROFILE_INVALID

APP_MINIMUM="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP_INFO" 2>/dev/null)" || fail NATIVE_AUTOFILL_MACOS_FLOOR_INVALID
PROVIDER_MINIMUM="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$PROVIDER_INFO" 2>/dev/null)" || fail NATIVE_AUTOFILL_MACOS_FLOOR_INVALID
AGENT_MINIMUM="$(/usr/bin/otool -l "$AGENT_PATH" 2>/dev/null | /usr/bin/awk '/minos/{print $2}' | /usr/bin/sort -u | /usr/bin/paste -sd, -)"
[[ "$APP_MINIMUM" == 13.0 && "$PROVIDER_MINIMUM" == 13.0 && "$AGENT_MINIMUM" == 13.0 ]] || \
  fail NATIVE_AUTOFILL_MACOS_FLOOR_INVALID

APP_HASH="$(node "$SCRIPT_DIR/native-autofill-bundle-manifest.mjs" "$APP_PATH" 2>/dev/null)" || \
  fail NATIVE_AUTOFILL_APP_MANIFEST_INVALID
DMG_HASH="$(/usr/bin/shasum -a 256 "$DMG_PATH" | /usr/bin/awk '{print $1}')"
BUILDER_SCRIPT_HASH="$(/usr/bin/shasum -a 256 "$SCRIPT_DIR/build-native-autofill-release.sh" | /usr/bin/awk '{print $1}')"
BUILDER_POLICY_HASH="$(/usr/bin/shasum -a 256 "$SCRIPT_DIR/native-autofill-builder-policy.mjs" | /usr/bin/awk '{print $1}')"
if ! BUILDER_POLICY_CODE="$(node "$SCRIPT_DIR/native-autofill-builder-policy.mjs" \
  "$SCRIPT_DIR/build-native-autofill-release.sh" 2>&1)"; then
  fail "$BUILDER_POLICY_CODE"
fi
ATTESTATION_SUMMARY="$(node --input-type=module - "$ATTESTATION_PATH" "$APP_HASH" "$DMG_HASH" "$BUILDER_SCRIPT_HASH" "$BUILDER_POLICY_HASH" <<'NODE'
import { readFileSync } from "node:fs";
try {
  const a=JSON.parse(readFileSync(process.argv[2], "utf8"));
  const valid=a.schemaVersion===1 && a.appSha256===process.argv[3] && a.dmgSha256===process.argv[4] &&
    a.appHashKind==="bundle-manifest-v1" && a.builderScriptSha256===process.argv[5] &&
    a.builderPolicySha256===process.argv[6] &&
    a.insideOutSigning===true && a.signingUsedDeep===false &&
    JSON.stringify(a.signingOrder)===JSON.stringify(["agent","credential-provider","app","dmg"]);
  if (!valid) process.exit(1);
  process.stdout.write(JSON.stringify({insideOutSigning:true,signingUsedDeep:false}));
} catch { process.exit(1); }
NODE
)" || fail NATIVE_AUTOFILL_ATTESTATION_INVALID

/usr/bin/xcrun stapler validate "$APP_PATH" >"$TEMP_ROOT/app-staple" 2>&1 || fail NATIVE_AUTOFILL_APP_STAPLE_MISSING
/usr/bin/xcrun stapler validate "$DMG_PATH" >"$TEMP_ROOT/dmg-staple" 2>&1 || fail NATIVE_AUTOFILL_DMG_STAPLE_MISSING
/usr/sbin/spctl -a -vvv -t exec "$APP_PATH" >"$TEMP_ROOT/app-gatekeeper" 2>&1 || fail NATIVE_AUTOFILL_APP_GATEKEEPER_REJECTED
/usr/sbin/spctl -a -vvv -t open --context context:primary-signature "$DMG_PATH" >"$TEMP_ROOT/dmg-gatekeeper" 2>&1 || \
  fail NATIVE_AUTOFILL_DMG_GATEKEEPER_REJECTED
/usr/bin/grep -Fq 'source=Notarized Developer ID' "$TEMP_ROOT/app-gatekeeper" || fail NATIVE_AUTOFILL_NOTARIZATION_MISSING
/usr/bin/grep -Fq 'source=Notarized Developer ID' "$TEMP_ROOT/dmg-gatekeeper" || fail NATIVE_AUTOFILL_NOTARIZATION_MISSING

MOUNT_PATH="$TEMP_ROOT/mount"
/bin/mkdir "$MOUNT_PATH"
/usr/bin/hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT_PATH" "$DMG_PATH" >"$TEMP_ROOT/hdiutil" 2>&1 || \
  fail NATIVE_AUTOFILL_DMG_ARTIFACT_INVALID
MOUNTED=1
MOUNTED_APP_COUNT="$(/usr/bin/find -P "$MOUNT_PATH" -mindepth 1 -maxdepth 1 -type d -name '*.app' -print | /usr/bin/wc -l | /usr/bin/tr -d ' ')"
[[ "$MOUNTED_APP_COUNT" == 1 && -d "$MOUNT_PATH/$APP_NAME" ]] || fail NATIVE_AUTOFILL_INVENTORY_UNEXPECTED
MOUNTED_TOP_LEVEL_COUNT="$(/usr/bin/find -P "$MOUNT_PATH" -mindepth 1 -maxdepth 1 -print | /usr/bin/wc -l | /usr/bin/tr -d ' ')"
[[ "$MOUNTED_TOP_LEVEL_COUNT" == 2 && -L "$MOUNT_PATH/Applications" && "$(/bin/readlink "$MOUNT_PATH/Applications")" == /Applications ]] || \
  fail NATIVE_AUTOFILL_DMG_INVENTORY_INVALID
/usr/bin/diff -qr "$APP_PATH" "$MOUNT_PATH/$APP_NAME" >/dev/null 2>&1 || fail NATIVE_AUTOFILL_DMG_APP_MISMATCH
/usr/bin/hdiutil detach "$MOUNT_PATH" -quiet >"$TEMP_ROOT/hdiutil-detach" 2>&1 || fail NATIVE_AUTOFILL_DMG_DETACH_FAILED
MOUNTED=0

PRODUCT_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_INFO" 2>/dev/null)" || fail NATIVE_AUTOFILL_INSPECTION_INVALID
OS_VERSION="$(/usr/bin/sw_vers -productVersion 2>/dev/null)" || fail NATIVE_AUTOFILL_INSPECTION_INVALID
COLLECTED_INSPECTION="$TEMP_ROOT/inspection.json"
/usr/bin/env \
  APP_ENTITLEMENT_JSON="$APP_ENTITLEMENT_JSON" \
  PROVIDER_ENTITLEMENT_JSON="$PROVIDER_ENTITLEMENT_JSON" \
  AGENT_ENTITLEMENT_JSON="$AGENT_ENTITLEMENT_JSON" \
  PROVIDER_PROFILE_SUMMARY="$PROVIDER_PROFILE_SUMMARY" \
  APP_HASH="$APP_HASH" DMG_HASH="$DMG_HASH" PRODUCT_VERSION="$PRODUCT_VERSION" OS_VERSION="$OS_VERSION" \
  node --input-type=module - "$COLLECTED_INSPECTION" <<'NODE'
import { writeFileSync } from "node:fs";
const app=JSON.parse(process.env.APP_ENTITLEMENT_JSON);
const provider=JSON.parse(process.env.PROVIDER_ENTITLEMENT_JSON);
const agent=JSON.parse(process.env.AGENT_ENTITLEMENT_JSON);
const providerProfile=JSON.parse(process.env.PROVIDER_PROFILE_SUMMARY);
const component=(role,relativePath,bundleId,entitlements,profile={})=>({
  role, relativePath, bundleId, teamId:"K7LY92JY96", signatureKind:"developer-id",
  signatureValid:true, designatedRequirementValid:true, hardenedRuntime:true, minimumMacOS:"13.0",
  profileApplicationIdentifierKey:null, profileEntitlementKeys:[], profileCertificateMatchesSigner:null,
  ...profile,
  ...entitlements,
});
const inspection={
  schemaVersion:1, productVersion:process.env.PRODUCT_VERSION, teamId:"K7LY92JY96",
  appGroup:"K7LY92JY96.com.sommir.barwarden.autofill", minimumMacOS:"13.0", osVersion:process.env.OS_VERSION,
  artifacts:{appSha256:process.env.APP_HASH,dmgSha256:process.env.DMG_HASH},
  inventory:[
    component("app",".","com.sommir.barwarden",app),
    component("credential-provider","Contents/PlugIns/BarwardenCredentialProvider.appex","com.sommir.barwarden.credential-provider",provider,{
      profileApplicationIdentifierKey:providerProfile.applicationIdentifierKey,
      profileEntitlementKeys:providerProfile.entitlementKeys,
      profileCertificateMatchesSigner:providerProfile.certificateMatchesSigner,
    }),
    component("agent","Contents/Helpers/BarwardenAutoFillAgent","com.sommir.barwarden.autofill-agent",agent),
  ],
  unexpectedNestedCode:[], unexpectedSymlinks:[], unexpectedMachO:[], unexpectedDylibs:[],
  outerSealValid:true, insideOutSigning:true, signingUsedDeep:false,
  providerProfileValid:true, launchAgentValid:true, registrationCommandSurfaceValid:true,
  dmgInventoryValid:true, dmgSignatureValid:true,
  notarized:true, dmgNotarized:true, appStapled:true, dmgStapled:true, appGatekeeperAccepted:true, dmgGatekeeperAccepted:true,
  attestedAppManifestSha256:process.env.APP_HASH, builderPolicyHashValid:true,
};
writeFileSync(process.argv[2], `${JSON.stringify(inspection,null,2)}\n`, {mode:0o600});
NODE

verify_inspection "$COLLECTED_INSPECTION"
