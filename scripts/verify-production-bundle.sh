#!/usr/bin/env bash
set -euo pipefail

bundle_dir="${1:-apps/menubar-tauri/dist}"
task7_patterns='login-workflow-|calendar-user|evidence-password|JBSWY3DPEHPK3PXP|fixture-a|fixture-r|example-region'
task9_patterns='card-detail-reprompt|card-form-add|identity-detail-reprompt|note-form-clone|personal-form-stale|m9-created-card|m9-stale-returned-sentinel|4242424242424242|C123EXAMPLE|000-00-0000|identity.example.test|Synthetic example.test Card notes|\+1 555 0100|1 Example Way|Synthetic example.test Identity notes|card-hidden-example|identity-hidden-example|note-hidden-example|P-EXAMPLE-123|L-EXAMPLE-456|Synthetic example.test secure note body'
task10_patterns='appCopyClick|password-history-selection|PlatformUtilsService|archivePremiumRestart|restartPremium|assignToCollections|passkeyNotCopiedAlert|conditionallyNavigateToAssignCollections'
m10_recovery_state_names='password-history-populated|password-history-empty|password-history-reprompt|folders-list|folders-empty|folders-add-dialog|folders-edit-dialog|folders-delete-confirmation|archive-list|archive-menu|archive-empty|trash-list|trash-menu|trash-permanent-delete-confirmation|trash-empty|recovery-operation-error'
m10_recovery_state_patterns="(^|[^A-Za-z0-9_-])(${m10_recovery_state_names})([^A-Za-z0-9_-]|$)"
m10_recovery_patterns='m10-created-folder|m10-encrypted-folder|bw-evidence-release-recovery-transport|bw-evidence-recovery-transition|__bwRecoverySecureGet|__bwRecoverySecureSet|__bwRecoverySecureDelete|__bwRecoveryServerCommit|__bwRecoveryFreshSync|__bwRecoveryNativeCopy|__bwRecoveryPrepareRelaunch|bwEvidenceRecoveryReceipt|bwEvidenceTransportCallCount|bwEvidenceRecoveryBarrier|bwEvidenceTransportPending|M10-CVC-731|recoveryStartup|Synthetic recovery evidence operation failure|Example Recovery Login|Example Recovery Card|Example Recovery Identity|Example Recovery Note|Example Work|Example Personal'
m11_generator_evidence_state_names='history-loading|history-load-retry|history-copy-retry|history-clear-retry|history-same-id-stale|generation-account-switch|generation-lock|generation-same-id|generation-route-teardown|generation-duplicate|form-generation-failure'
m11_generator_evidence_state_patterns="(^|[^A-Za-z0-9_-])(${m11_generator_evidence_state_names})([^A-Za-z0-9_-]|$)"
m11_generator_patterns='CopyClickDirective|appCopyClick|ForwarderSettingsComponent|ForwarderIntegration|generator/providers|generator/integrations|@bitwarden/auth/sso|addy\.io|SimpleLogin|Firefox Relay|Fastmail|DuckDuckGo Email Protection|nudge-generator-spotlight|generator-current-tab-context|generator-website-context|LocalGeneratorHistoryService|SecretState|StateProvider|DialogService|generator-history-state-provider|generator-history-semantic-debug|generator-history-dialog-service|generator-history-native-messaging|generator-history-sso|generatorEvidence|bw-generator-(evidence|lifecycle)|bwEvidenceGenerator|evidence-lifecycle|Synthetic generator|orbit-lantern-copper-signal|Mango-River-47!'
m12_send_patterns='send-file|SendFile|FileReader|upload.*send|download.*send|SpecificPeople|BillingAccountProfileStateService|PremiumUpgradePromptService|OrganizationService|CurrentAccountComponent|PopOutComponent|singleSignOn|bw-send-evidence|bwEvidenceSend|Synthetic Text Send evidence|send-fixture\.invalid|m12-local-fixture|opaque-local-session-material|local-link-material|m12-text-send|m12-text-access|m12-created-send|m12-created-access|send-evidence-failure|send-mutation-error|send-row-actions'
m12_send_scan_patterns='send-file|SendFile|FileReader|upload.{0,256}send|download.{0,256}send|SpecificPeople|BillingAccountProfileStateService|PremiumUpgradePromptService|OrganizationService|CurrentAccountComponent|PopOutComponent|singleSignOn|bw-send-evidence|bwEvidenceSend|Synthetic Text Send evidence|send-fixture\.invalid|m12-local-fixture|opaque-local-session-material|local-link-material|m12-text-send|m12-text-access|m12-created-send|m12-created-access|send-evidence-failure|send-mutation-error|send-row-actions'
m13_settings_patterns="admin-settings|extension-device-management|blocked-domains|excluded-domains|premium-v2|(^|[\"'/:])billing([\"'/?#:]|\$)|reports|import-browser|export-browser|await-desktop-dialog|nativeMessaging|clickItemsToAutofillVaultView|enableBadgeCounter|extensionWidth|rateExtension|singleSignOn"
m13_settings_wasm_patterns='admin-settings|extension-device-management|blocked-domains|excluded-domains|premium-v2|billing|reports|import-browser|export-browser|await-desktop-dialog|nativeMessaging|clickItemsToAutofillVaultView|enableBadgeCounter|extensionWidth|rateExtension|singleSignOn'
m13_settings_evidence_patterns='settingsEvidence|m13-settings-runtime|bwEvidenceSettings|__bwReleaseSettingsEvidenceSync|Synthetic Settings sync failure|Unsupported Settings evidence destination'
patterns='chrome\.tabs|browser\.tabs|webRequest|webNavigation|nativeMessaging|contentScript|showOpenFilePicker|chrome\.downloads|browser\.downloads|BrowserApi\.(getCurrentTab|tabsQuery|getBackgroundPage|getExtensionViews)|VITE_BW_VAULT_EVIDENCE|authEvidence|auth-evidence@example\.test|evidence@example\.test|locked-fixture@example\.test|evidence-account|locked-evidence-account|vault\.example\.test|vault\.with-a-deliberately-long-self-hosted-name\.example\.test'

if [[ ! -d "$bundle_dir" ]]; then
  printf 'Production bundle directory is missing: %s\n' "$bundle_dir" >&2
  exit 1
fi

scan_files=()
while IFS= read -r file; do
  scan_files+=("$file")
done < <(find "$bundle_dir" -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.map' \) -print)

wasm_files=()
while IFS= read -r file; do
  wasm_files+=("$file")
done < <(find "$bundle_dir" -type f -name '*.wasm' -print)

if (( ${#scan_files[@]} == 0 )); then
  printf 'Production bundle has no scannable artifacts: %s\n' "$bundle_dir" >&2
  exit 1
fi

set +e
rg --quiet -e "$patterns" -e "$task7_patterns" -e "$task9_patterns" -e "$task10_patterns" -e "$m10_recovery_state_patterns" -e "$m10_recovery_patterns" -e "$m11_generator_evidence_state_patterns" -e "$m11_generator_patterns" -e "$m12_send_scan_patterns" -e "$m13_settings_patterns" -e "$m13_settings_evidence_patterns" "${scan_files[@]}"
scan_status=$?
set -e

case "$scan_status" in
  0)
    printf 'Forbidden browser surface found in production bundle.\n' >&2
    exit 1
    ;;
  1)
    ;;
  *)
    printf 'Production bundle scan failed with rg status %s.\n' "$scan_status" >&2
    exit "$scan_status"
    ;;
esac

if (( ${#wasm_files[@]} != 1 )); then
  printf 'Production bundle must contain exactly one retained SDK WASM asset; found %s.\n' "${#wasm_files[@]}" >&2
  exit 1
fi
node "$(dirname "$0")/audit-retained-sdk-wasm.mjs" "${wasm_files[0]}"
if ! node --input-type=module - "${wasm_files[0]}" "$m13_settings_wasm_patterns" <<'NODE'
import { readFileSync } from "node:fs";

const [wasmPath, pattern] = process.argv.slice(2);
const matcher = new RegExp(pattern, "i");
const forbidden = WebAssembly.Module.exports(new WebAssembly.Module(readFileSync(wasmPath)))
  .map(({ name }) => name)
  .filter((name) => matcher.test(name));
if (forbidden.length > 0) {
  process.stderr.write(`Forbidden Settings WASM exports: ${forbidden.join(", ")}\n`);
  process.exit(1);
}
NODE
then
  printf 'Forbidden Settings surface found in production WASM export inventory.\n' >&2
  exit 1
fi

printf 'Production bundle scan passed: %s\n' "$bundle_dir"
printf 'Forbidden patterns: %s\n' "$patterns"
printf 'Task 7 forbidden patterns: %s\n' "$task7_patterns"
printf 'Task 9 forbidden patterns: %s\n' "$task9_patterns"
printf 'Task 10 forbidden patterns: %s\n' "$task10_patterns"
printf 'M10 recovery state names: %s\n' "$m10_recovery_state_names"
printf 'M10 recovery forbidden patterns: %s\n' "$m10_recovery_patterns"
printf 'M11 Generator evidence state names: %s\n' "$m11_generator_evidence_state_names"
printf 'M11 Generator forbidden patterns: %s\n' "$m11_generator_patterns"
printf 'M12 Send forbidden patterns: %s\n' "$m12_send_patterns"
printf 'M13 Settings forbidden patterns: %s\n' "$m13_settings_patterns"
printf 'M13 Settings evidence forbidden patterns: %s\n' "$m13_settings_evidence_patterns"
