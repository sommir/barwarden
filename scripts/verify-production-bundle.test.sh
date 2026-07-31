#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "$fixture_dir"' EXIT

node --test "$script_dir/prepare-retained-sdk-wasm.spec.mjs"

if "$script_dir/verify-production-bundle.sh" "$fixture_dir"; then
  printf 'Expected empty production bundle fixture to fail.\n' >&2
  exit 1
fi

printf 'console.log("clean")\n' > "$fixture_dir/index.js"
if "$script_dir/verify-production-bundle.sh" "$fixture_dir"; then
  printf 'Expected a production bundle without the retained SDK WASM to fail.\n' >&2
  exit 1
fi

node "$script_dir/prepare-retained-sdk-wasm.mjs" >/dev/null
cp "$script_dir/../apps/menubar-tauri/.generated/bitwarden_wasm_internal_bg.wasm" "$fixture_dir/runtime.wasm"
"$script_dir/verify-production-bundle.sh" "$fixture_dir"

cp "$script_dir/../node_modules/@bitwarden/sdk-internal/bitwarden_wasm_internal_bg.wasm" "$fixture_dir/runtime.wasm"
if "$script_dir/verify-production-bundle.sh" "$fixture_dir"; then
  printf 'Expected the full SDK WASM capability surface to fail.\n' >&2
  exit 1
fi
cp "$script_dir/../apps/menubar-tauri/.generated/bitwarden_wasm_internal_bg.wasm" "$fixture_dir/runtime.wasm"

printf 'upload%s send\n' "$(printf '%0300d' 0)" > "$fixture_dir/distant-send-tokens.js"
"$script_dir/verify-production-bundle.sh" "$fixture_dir"
rm "$fixture_dir/distant-send-tokens.js"

printf 'chrome.tabs.query({})\n' > "$fixture_dir/forbidden.js"
if "$script_dir/verify-production-bundle.sh" "$fixture_dir"; then
  printf 'Expected forbidden production bundle fixture to fail.\n' >&2
  exit 1
fi

rm "$fixture_dir/forbidden.js"
for marker in \
  'VITE_BW_VAULT_EVIDENCE=true' \
  'authEvidence=loading' \
  'auth-evidence@example.test' \
  'evidence@example.test' \
  'locked-fixture@example.test' \
  'evidence-account' \
  'locked-evidence-account' \
  'https://vault.example.test' \
  'vault.with-a-deliberately-long-self-hosted-name.example.test' \
  'login-workflow-detail-default' \
  'calendar-user' \
  'evidence-password' \
  'JBSWY3DPEHPK3PXP' \
  'fixture-a' \
  'fixture-r' \
  'example-region' \
  'card-detail-reprompt' \
  'card-form-add' \
  'identity-detail-reprompt' \
  'note-form-clone' \
  'personal-form-stale' \
  'm9-created-card' \
  'm9-stale-returned-sentinel' \
  '4242424242424242' \
  'C123EXAMPLE' \
  '000-00-0000' \
  'identity.example.test' \
  'Synthetic example.test Card notes' \
  '+1 555 0100' \
  '1 Example Way' \
  'Synthetic example.test Identity notes' \
  'card-hidden-example' \
  'identity-hidden-example' \
  'note-hidden-example' \
  'Synthetic example.test secure note body' \
  'P-EXAMPLE-123' \
  'L-EXAMPLE-456' \
  'appCopyClick' \
  'password-history-selection' \
  'PlatformUtilsService' \
  'archivePremiumRestart' \
  'restartPremium' \
  'assignToCollections' \
  'passkeyNotCopiedAlert' \
  'conditionallyNavigateToAssignCollections' \
  'CopyClickDirective' \
  'appCopyClick' \
  'ForwarderSettingsComponent' \
  'ForwarderIntegration' \
  'generator/providers' \
  'generator/integrations' \
  'LocalGeneratorHistoryService' \
  'SecretState' \
  'StateProvider' \
  'DialogService' \
  'generator-history-state-provider' \
  'generator-history-semantic-debug' \
  'generator-history-dialog-service' \
  'generator-history-native-messaging' \
  'generator-history-sso' \
  '@bitwarden/auth/sso' \
  'addy.io' \
  'SimpleLogin' \
  'Firefox Relay' \
  'Fastmail' \
  'DuckDuckGo Email Protection' \
  'nudge-generator-spotlight' \
  'generator-current-tab-context' \
  'generator-website-context' \
  'generatorEvidence=generation-account-switch' \
  'generation-same-id' \
  'history-copy-retry' \
  'generation-route-teardown' \
  'form-generation-failure' \
  'bw-generator-evidence-release' \
  'bw-generator-lifecycle-account' \
  'bw-generator-lifecycle-release' \
  'bwEvidenceGeneratorHistoryTracks' \
  'bwEvidenceGeneratorPending' \
  'evidence-lifecycle-latest' \
  'Synthetic generator evidence copy failure' \
  'orbit-lantern-copper-signal' \
  'Mango-River-47!' \
  'password-history-populated' \
  'password-history-empty' \
  'password-history-reprompt' \
  'folders-list' \
  'folders-empty' \
  'folders-add-dialog' \
  'folders-edit-dialog' \
  'folders-delete-confirmation' \
  'archive-list' \
  'archive-menu' \
  'archive-empty' \
  'trash-list' \
  'trash-menu' \
  'trash-permanent-delete-confirmation' \
  'trash-empty' \
  'recovery-operation-error' \
  'm10-created-folder' \
  'm10-encrypted-folder' \
  'bw-evidence-release-recovery-transport' \
  'bw-evidence-recovery-transition' \
  '__bwRecoverySecureGet' \
  '__bwRecoverySecureSet' \
  '__bwRecoverySecureDelete' \
  '__bwRecoveryServerCommit' \
  '__bwRecoveryFreshSync' \
  '__bwRecoveryNativeCopy' \
  '__bwRecoveryPrepareRelaunch' \
  'bwEvidenceRecoveryReceipt' \
  'bwEvidenceTransportCallCount' \
  'bwEvidenceRecoveryBarrier' \
  'bwEvidenceTransportPending' \
  'M10-CVC-731' \
  'recoveryStartup' \
  'Synthetic recovery evidence operation failure' \
  'Example Recovery Login' \
  'Example Recovery Card' \
  'Example Recovery Identity' \
  'Example Recovery Note' \
  'Example Work' \
  'Example Personal' \
  'send-file' \
  'SendFile' \
  'FileReader' \
  'upload text send' \
  'download text send' \
  'SpecificPeople' \
  'BillingAccountProfileStateService' \
  'PremiumUpgradePromptService' \
  'OrganizationService' \
  'CurrentAccountComponent' \
  'PopOutComponent' \
  'singleSignOn' \
  'bw-send-evidence' \
  'bwEvidenceSend' \
  'Synthetic Text Send evidence' \
  'send-fixture.invalid' \
  'm12-local-fixture' \
  'opaque-local-session-material' \
  'local-link-material' \
  'm12-text-send' \
  'm12-text-access' \
  'm12-created-send' \
  'm12-created-access' \
  'send-evidence-failure' \
  'send-mutation-error' \
  'send-row-actions' \
  'settingsEvidence=settings-main' \
  'm13-settings-runtime' \
  'bwEvidenceSettingsReceipts' \
  '__bwReleaseSettingsEvidenceSync' \
  'Synthetic Settings sync failure' \
  'Unsupported Settings evidence destination'
do
  printf '%s\n' "$marker" > "$fixture_dir/auth-evidence-marker.js"
  if "$script_dir/verify-production-bundle.sh" "$fixture_dir"; then
    printf 'Expected auth evidence marker production bundle fixture to fail.\n' >&2
    exit 1
  fi
done
rm "$fixture_dir/auth-evidence-marker.js"

for marker in \
  'admin-settings' \
  'extension-device-management' \
  'blocked-domains' \
  'excluded-domains' \
  'premium-v2' \
  'billing' \
  'reports' \
  'import-browser' \
  'export-browser' \
  'await-desktop-dialog' \
  'nativeMessaging' \
  'clickItemsToAutofillVaultView' \
  'enableBadgeCounter' \
  'extensionWidth' \
  'rateExtension' \
  'singleSignOn'
do
  for artifact in settings-surface.js lazy-settings-surface.js settings-surface.css settings-surface.js.map; do
    fixture_marker="$marker"
    if [[ "$marker" == "billing" ]]; then
      fixture_marker='"/billing"'
    fi
    printf '%s\n' "$fixture_marker" > "$fixture_dir/$artifact"
    if "$script_dir/verify-production-bundle.sh" "$fixture_dir"; then
      printf 'Expected excluded Settings marker in %s to fail: %s\n' "$artifact" "$marker" >&2
      exit 1
    fi
    rm "$fixture_dir/$artifact"
  done
done

printf '.bwi-billing::before { content: "icon"; }\nconst BillingSync = 1;\n' > "$fixture_dir/settings-non-surface.css"
"$script_dir/verify-production-bundle.sh" "$fixture_dir"
rm "$fixture_dir/settings-non-surface.css"

cat > "$fixture_dir/settings-surface.wat" <<'WAT'
(module
  (memory (export "memory") 1)
  (func (export "init_sdk"))
  (func (export "passwordmanagerclient_new"))
  (func (export "passwordmanagerclient_generator"))
  (func (export "__wbg_passwordmanagerclient_free"))
  (func (export "generatorclient_password"))
  (func (export "generatorclient_passphrase"))
  (func (export "__wbg_generatorclient_free"))
  (func (export "purecrypto_random_number"))
  (func (export "purecrypto_symmetric_encrypt_string"))
  (func (export "purecrypto_symmetric_decrypt_bytes"))
  (func (export "purecrypto_decapsulate_key_unsigned"))
  (func (export "purecrypto_derive_kdf_material"))
  (func (export "purecrypto_decrypt_user_key_with_master_key"))
  (func (export "nativeMessaging"))
)
WAT
"$script_dir/../node_modules/.bin/wasm-as" "$fixture_dir/settings-surface.wat" -o "$fixture_dir/runtime.wasm"
rm "$fixture_dir/settings-surface.wat"
if "$script_dir/verify-production-bundle.sh" "$fixture_dir"; then
  printf 'Expected excluded Settings WASM export inventory to fail.\n' >&2
  exit 1
fi
