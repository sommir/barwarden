#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
TEST_ROOT="$(mktemp -d /private/tmp/barwarden-provider-entitlements.XXXXXX)"
trap '/bin/rm -rf "$TEST_ROOT"' EXIT
OUTPUT="$TEST_ROOT/provider.plist"

result="$("$SCRIPT_DIR/create-native-autofill-provider-entitlements.sh" "$OUTPUT")"
[[ "$result" == NATIVE_AUTOFILL_PROVIDER_ENTITLEMENTS_CREATED ]]
/usr/bin/plutil -convert json -o - "$OUTPUT" | node --input-type=module -e '
  import assert from "node:assert/strict";
  let text=""; process.stdin.on("data", chunk => text += chunk); process.stdin.on("end", () => {
    const value=JSON.parse(text);
    const expected={
      "com.apple.application-identifier":"K7LY92JY96.com.sommir.barwarden.credential-provider",
      "com.apple.developer.authentication-services.autofill-credential-provider":true,
      "com.apple.developer.team-identifier":"K7LY92JY96",
      "com.apple.security.app-sandbox":true,
      "com.apple.security.application-groups":["K7LY92JY96.com.sommir.barwarden.autofill"],
    };
    assert.deepEqual(value, expected);
  });'
[[ "$(/usr/bin/stat -f %Lp "$OUTPUT")" == 600 ]]
printf 'create-native-autofill-provider-entitlements tests: PASS\n'
