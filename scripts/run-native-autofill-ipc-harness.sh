#!/bin/bash
set -euo pipefail

if [[ "${RUN_SIGNED_AUTOFILL_IPC_HARNESS:-0}" != "1" ]]; then
  echo "SKIP: set RUN_SIGNED_AUTOFILL_IPC_HARNESS=1 and AUTOFILL_SIGNING_IDENTITY to run the signed IPC harness"
  exit 0
fi

if [[ -z "${AUTOFILL_SIGNING_IDENTITY:-}" ]]; then
  echo "AUTOFILL_SIGNING_IDENTITY is required" >&2
  exit 2
fi

SCRIPT_DIRECTORY="$(cd "$(dirname "$0")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIRECTORY/.." && pwd)"
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
export DEVELOPER_DIR

HARNESS_TEMP="$(mktemp -d "${TMPDIR:-/tmp}/barwarden-autofill-ipc.XXXXXX")"
AGENT_PID=""
cleanup() {
  if [[ -n "$AGENT_PID" ]]; then
    kill "$AGENT_PID" 2>/dev/null || true
    wait "$AGENT_PID" 2>/dev/null || true
  fi
  rm -rf "$HARNESS_TEMP"
}
trap cleanup EXIT

DERIVED_DATA="$HARNESS_TEMP/DerivedData"
xcodebuild -quiet \
  -project "$REPOSITORY_ROOT/apps/macos-autofill/BarwardenAutoFill.xcodeproj" \
  -scheme BarwardenNativeAutoFill \
  -configuration Debug \
  -destination platform=macOS \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  build

AGENT_BINARY="$HARNESS_TEMP/BarwardenAutoFillAgent"
cp "$DERIVED_DATA/Build/Products/Debug/BarwardenAutoFillAgent" "$AGENT_BINARY"
codesign --force --sign "$AUTOFILL_SIGNING_IDENTITY" \
  --identifier com.sommir.barwarden.autofill-agent "$AGENT_BINARY"

SWIFT_CLIENT="$HARNESS_TEMP/swift-client"
HOST_ARCHITECTURE="$(uname -m)"
case "$HOST_ARCHITECTURE" in
  arm64|x86_64) ;;
  *) echo "unsupported macOS architecture: $HOST_ARCHITECTURE" >&2; exit 1 ;;
esac
xcrun swiftc \
  -target "$HOST_ARCHITECTURE-apple-macos13.0" \
  -D DEBUG \
  -framework Security \
  "$REPOSITORY_ROOT/apps/macos-autofill/Shared/AgentProtocol.swift" \
  "$REPOSITORY_ROOT/apps/macos-autofill/Shared/AgentFraming.swift" \
  "$REPOSITORY_ROOT/apps/macos-autofill/Shared/AgentClient.swift" \
  "$REPOSITORY_ROOT/scripts/fixtures/native-autofill-ipc-harness.swift" \
  -o "$SWIFT_CLIENT"

PROVIDER_CLIENT="$HARNESS_TEMP/provider-client"
WRONG_BUNDLE_CLIENT="$HARNESS_TEMP/wrong-bundle-client"
AD_HOC_CLIENT="$HARNESS_TEMP/ad-hoc-client"
cp "$SWIFT_CLIENT" "$PROVIDER_CLIENT"
cp "$SWIFT_CLIENT" "$WRONG_BUNDLE_CLIENT"
cp "$SWIFT_CLIENT" "$AD_HOC_CLIENT"
codesign --force --sign "$AUTOFILL_SIGNING_IDENTITY" \
  --identifier com.sommir.barwarden.credential-provider "$PROVIDER_CLIENT"
codesign --force --sign "$AUTOFILL_SIGNING_IDENTITY" \
  --identifier com.sommir.barwarden.wrong "$WRONG_BUNDLE_CLIENT"
codesign --force --sign - --identifier com.sommir.barwarden "$AD_HOC_CLIENT"

RUST_ARTIFACTS="$HARNESS_TEMP/rust-artifacts.jsonl"
cargo test \
  --manifest-path "$REPOSITORY_ROOT/apps/menubar-tauri/src-tauri/Cargo.toml" \
  --no-run \
  --message-format=json > "$RUST_ARTIFACTS"
RUST_TEST_SOURCE="$(node -e '
const fs = require("fs");
for (const line of fs.readFileSync(process.argv[1], "utf8").trim().split("\n")) {
  const item = JSON.parse(line);
  if (item.reason === "compiler-artifact" && item.target?.name === "barwarden" && item.profile?.test && item.executable) {
    process.stdout.write(item.executable);
    process.exit(0);
  }
}
process.exit(1);
' "$RUST_ARTIFACTS")"
RUST_MAIN_CLIENT="$HARNESS_TEMP/rust-main-client"
cp "$RUST_TEST_SOURCE" "$RUST_MAIN_CLIENT"
codesign --force --sign "$AUTOFILL_SIGNING_IDENTITY" \
  --identifier com.sommir.barwarden "$RUST_MAIN_CLIENT"

for SIGNED_CLIENT in "$PROVIDER_CLIENT" "$WRONG_BUNDLE_CLIENT" "$RUST_MAIN_CLIENT"; do
  SIGNING_DETAILS="$(codesign -d --verbose=4 "$SIGNED_CLIENT" 2>&1)"
  if ! grep -q '^TeamIdentifier=K7LY92JY96$' <<< "$SIGNING_DETAILS"; then
    echo "signed harness client does not have the required Team identifier" >&2
    exit 1
  fi
done
SIGNING_DETAILS="$(codesign -d --verbose=4 "$AD_HOC_CLIENT" 2>&1)"
if grep -q '^TeamIdentifier=K7LY92JY96$' <<< "$SIGNING_DETAILS"; then
  echo "ad-hoc control unexpectedly has the accepted Team identifier" >&2
  exit 1
fi

run_with_fresh_agent() {
  local case_name="$1"
  shift
  local socket_path="$HARNESS_TEMP/$case_name.sock"
  local agent_log="$HARNESS_TEMP/$case_name-agent.log"
  BARWARDEN_AUTOFILL_SOCKET="$socket_path" "$AGENT_BINARY" > "$agent_log" 2>&1 &
  AGENT_PID="$!"

  local attempt
  for attempt in {1..50}; do
    [[ -S "$socket_path" ]] && break
    sleep 0.1
  done
  if [[ ! -S "$socket_path" ]]; then
    echo "Agent did not create the harness socket for $case_name" >&2
    exit 1
  fi

  BARWARDEN_AUTOFILL_SOCKET="$socket_path" "$@"
  kill "$AGENT_PID"
  wait "$AGENT_PID" 2>/dev/null || true
  AGENT_PID=""
}

run_with_fresh_agent m \
  "$RUST_MAIN_CLIENT" signed_main_application_harness_echoes_nonce --ignored
run_with_fresh_agent p "$PROVIDER_CLIENT" success
run_with_fresh_agent w "$WRONG_BUNDLE_CLIENT" unauthorized
run_with_fresh_agent a "$AD_HOC_CLIENT" unauthorized

echo "PASS: Rust main, Swift provider, same-Team wrong-bundle, and ad-hoc/no-Team signed IPC cases"
