#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
SOURCE="$REPOSITORY_ROOT/apps/macos-autofill/CredentialProvider/Entitlements.plist"
OUTPUT="${1:-}"

fail() {
  printf '%s\n' NATIVE_AUTOFILL_PROVIDER_ENTITLEMENTS_INVALID >&2
  exit 1
}

[[ "$OUTPUT" = /* && "$OUTPUT" != "$SOURCE" && ! -e "$OUTPUT" ]] || fail
/bin/cp "$SOURCE" "$OUTPUT" || fail
/bin/chmod 600 "$OUTPUT" || fail
/usr/libexec/PlistBuddy -c 'Add :com.apple.application-identifier string K7LY92JY96.com.sommir.barwarden.credential-provider' "$OUTPUT" >/dev/null 2>&1 || fail
/usr/libexec/PlistBuddy -c 'Add :com.apple.developer.team-identifier string K7LY92JY96' "$OUTPUT" >/dev/null 2>&1 || fail

/usr/bin/plutil -convert json -o - "$OUTPUT" 2>/dev/null | node --input-type=module -e '
  let text=""; process.stdin.on("data", chunk => text += chunk); process.stdin.on("end", () => {
    try {
      const value=JSON.parse(text);
      const keys=Object.keys(value).sort();
      const expected=[
        "com.apple.application-identifier",
        "com.apple.developer.authentication-services.autofill-credential-provider",
        "com.apple.developer.team-identifier",
        "com.apple.security.app-sandbox",
        "com.apple.security.application-groups",
      ];
      const valid=JSON.stringify(keys)===JSON.stringify(expected) &&
        value["com.apple.application-identifier"]==="K7LY92JY96.com.sommir.barwarden.credential-provider" &&
        value["com.apple.developer.team-identifier"]==="K7LY92JY96" &&
        value["com.apple.developer.authentication-services.autofill-credential-provider"]===true &&
        value["com.apple.security.app-sandbox"]===true &&
        JSON.stringify(value["com.apple.security.application-groups"])===JSON.stringify(["K7LY92JY96.com.sommir.barwarden.autofill"]);
      process.exit(valid ? 0 : 1);
    } catch { process.exit(1); }
  });' || fail

printf '%s\n' NATIVE_AUTOFILL_PROVIDER_ENTITLEMENTS_CREATED
