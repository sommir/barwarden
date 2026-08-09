#!/bin/bash
set -euo pipefail

[[ "${NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY:-0}" == 1 ]] || {
  printf '%s\n' NATIVE_AUTOFILL_LOCAL_SMOKE_MODE_REQUIRED >&2
  exit 1
}
[[ $# -eq 2 && "$1" == --app && "$2" = /* && -d "$2" && ! -L "$2" ]] || {
  printf '%s\n' NATIVE_AUTOFILL_ARGUMENT_INVALID >&2
  exit 1
}

APP_PATH="$2"
[[ "${APP_PATH##*/}" == "Barwarden Local Smoke.app" ]] || {
  printf '%s\n' NATIVE_AUTOFILL_LOCAL_APP_NAME_INVALID >&2
  exit 1
}
APP_EXECUTABLE="$APP_PATH/Contents/MacOS/barwarden"
PROVIDER_PATH="$APP_PATH/Contents/PlugIns/BarwardenCredentialProvider.appex"
[[ -x "$APP_EXECUTABLE" && -d "$PROVIDER_PATH" && ! -L "$PROVIDER_PATH" ]] || {
  printf '%s\n' NATIVE_AUTOFILL_APP_ARTIFACT_INVALID >&2
  exit 1
}

OPEN_COMMAND="${NATIVE_AUTOFILL_OPEN_COMMAND:-/usr/bin/open}"
PGREP_COMMAND="${NATIVE_AUTOFILL_PGREP_COMMAND:-/usr/bin/pgrep}"
LAUNCHCTL_COMMAND="${NATIVE_AUTOFILL_LAUNCHCTL_COMMAND:-/bin/launchctl}"
PLUGINKIT_COMMAND="${NATIVE_AUTOFILL_PLUGINKIT_COMMAND:-/usr/bin/pluginkit}"
OSASCRIPT_COMMAND="${NATIVE_AUTOFILL_OSASCRIPT_COMMAND:-/usr/bin/osascript}"
SOCKET_TEST_COMMAND="${NATIVE_AUTOFILL_SOCKET_TEST_COMMAND:-/usr/bin/test}"
AGENT_SOCKET="${NATIVE_AUTOFILL_LOCAL_AGENT_SOCKET:-$HOME/Library/Group Containers/K7LY92JY96.com.sommir.barwarden.autofill/agent-v1.sock}"
FAILED=0
COMMAND_TIMEOUT_SECONDS=5

run_bounded() {
  /usr/bin/perl -e 'alarm shift; exec @ARGV' "$COMMAND_TIMEOUT_SECONDS" "$@"
}

launch_app() {
  run_bounded "$OPEN_COMMAND" -n "$APP_PATH" || return 1
  local attempt
  for attempt in 1 2 3 4 5; do
    if run_bounded "$PGREP_COMMAND" -f "$APP_EXECUTABLE"; then
      return 0
    fi
    /bin/sleep 0.2
  done
  return 1
}

discover_provider() {
  local discovery
  discovery="$(run_bounded "$PLUGINKIT_COMMAND" -m \
    -i com.sommir.barwarden.credential-provider 2>/dev/null)" || return 1
  [[ "$discovery" == *com.sommir.barwarden.credential-provider* ]]
}

check() {
  local pass_code="$1" fail_code="$2"
  shift 2
  if "$@" >/dev/null 2>&1; then
    printf '%s\n' "$pass_code"
  else
    printf '%s\n' "$fail_code"
    FAILED=1
  fi
}

check NATIVE_AUTOFILL_LOCAL_APP_LAUNCH_PASS NATIVE_AUTOFILL_LOCAL_APP_LAUNCH_FAILED \
  launch_app
check NATIVE_AUTOFILL_LOCAL_AGENT_STATUS_PASS NATIVE_AUTOFILL_LOCAL_AGENT_STATUS_FAILED \
  run_bounded "$LAUNCHCTL_COMMAND" print "gui/$(/usr/bin/id -u)/com.sommir.barwarden.autofill-agent"
check NATIVE_AUTOFILL_LOCAL_AGENT_PROBE_PASS NATIVE_AUTOFILL_LOCAL_AGENT_PROBE_FAILED \
  run_bounded "$SOCKET_TEST_COMMAND" -S "$AGENT_SOCKET"
check NATIVE_AUTOFILL_LOCAL_PROVIDER_REGISTRATION_PASS NATIVE_AUTOFILL_LOCAL_PROVIDER_REGISTRATION_FAILED \
  run_bounded "$PLUGINKIT_COMMAND" -a "$PROVIDER_PATH"
check NATIVE_AUTOFILL_LOCAL_PROVIDER_DISCOVERY_PASS NATIVE_AUTOFILL_LOCAL_PROVIDER_DISCOVERY_FAILED \
  discover_provider

AX_RESULT="$(run_bounded "$OSASCRIPT_COMMAND" \
  -e 'tell application "System Events" to UI elements enabled' 2>/dev/null || true)"
if [[ "$AX_RESULT" == true ]]; then
  printf '%s\n' NATIVE_AUTOFILL_LOCAL_AX_STATUS_PASS
else
  printf '%s\n' NATIVE_AUTOFILL_LOCAL_AX_STATUS_FAILED
  FAILED=1
fi

if [[ "$FAILED" -eq 0 ]]; then
  printf '%s\n' NATIVE_AUTOFILL_LOCAL_SMOKE_COMPLETE
  exit 0
fi
printf '%s\n' NATIVE_AUTOFILL_LOCAL_SMOKE_INCOMPLETE
exit 1
