# Task 7 implementer report — main-app AutoFill picker

## Outcome

Task 7 adds one native menu-bar AutoFill picker shared by the dedicated tray-menu entry and the existing global shortcut. A normal tray-icon click retains the vault behavior. Both AutoFill entries capture the previous frontmost external application before Barwarden activation and route through the same popup entry-source state machine. The picker fails closed when the captured application is stale, Barwarden itself, no longer running, or no longer the exact captured process instance.

The picker queries Agent metadata for username, password, and TOTP eligibility, merges it into fixed exact/relevant/other groups, renders only fixed local reason copy, supports all-Login search and Arrow/Enter navigation, and exposes explicit locked, repair, empty, missing-context, and account-override states. An account mismatch performs no candidate query; only the user's explicit “Use this account” action invokes the existing account switch. Candidates are never combined across account projections.

Selecting a Login only reveals actions. It never releases, copies, pastes, or submits a secret. `Fill username`, `Fill password`, `Fill TOTP`, and the corresponding Copy actions each perform a fresh field-specific metadata query and request exactly one field. Fill reuses the guarded native paste path; Accessibility denial, activation races, and target termination preserve the existing copied-for-manual-paste outcome. The picker synthesizes no Tab, Enter, or Return event, performs no multi-field sequence, and never auto-submits.

## Reprompt authorization boundary

Reprompt-protected releases use a native one-time verification receipt rather than treating webview state as proof. The receipt is created from the unlocked process session and its native-derived exact password-verification endpoint; callers cannot supply a verification URL. It is bound to account, candidate, field, generation, and candidate context token, expires after 30 seconds, and is burned on expiry, mismatch, failed verification, or use.

The existing master-password verifier carries the receipt only on its exact authenticated `POST /accounts/verify-password` request with an exact single `masterPasswordHash` body. The native HTTP layer strips the local receipt header before outbound transport and marks the receipt verified only for a 2xx response. Touch ID begins the same receipt transaction and marks it verified only after the existing native biometric backend returns success. UI unlock state cannot create an Agent grant.

The Agent accepts the grant-issue operation only from the authenticated main-application peer, verifies the current projection account and generation, and returns a separate short-lived, single-use grant bound to the same full scope, including the requested field. The Rust main app consumes the verified receipt, requests the scoped Agent grant, and immediately performs the one-field release. No public Tauri command exposes direct grant issuance. Lock and reprovision clear outstanding Agent grants; main-app lock clears native receipts.

## Review hardening

The review-fix round adds an operation epoch to the picker and revalidates the selected candidate, unlocked account, projection generation, and captured application context before every secret release and again before paste or copy. Search, selection, account override, a newer operation, and component destruction supersede pending work. Delayed metadata, master-password, Touch ID, or release results therefore cannot mutate the destroyed or superseded picker. All asynchronous UI commits are guarded and explicitly mark the OnPush view for checking.

Reprompt receipts are now explicitly cancellable by their complete scope. Selection changes, search, cancellation, component destruction, lock, projection clear/replacement, and failed or stale protected operations burn outstanding receipts. Touch ID receipt verification is restricted to the main picker webview and marks a receipt verified only after native biometric success. A consumed receipt is still best-effort cancelled without turning a successful one-field release into an error.

Both sides of the Agent wire now reject unknown root and nested fields and bound every identity, context, path, key, candidate list, and secret field. Rust owns raw inbound JSON in a zeroizing frame buffer on successful and truncated reads; Swift explicitly clears decoded oversized secret and key buffers before rejection. Credential Provider service queries retain their required empty bundle/application context while still enforcing upper bounds.

The listbox exposes its active option through `aria-activedescendant`, keeps keyboard focus on the list, and gives the active option a visible highlight and outline. Arrow keys only move the active option; Enter selects it and still reveals actions without releasing a secret.

## TDD evidence

RED was observed before each implementation slice:

- the shortcut test first expected the old generic popup action, then passed after shortcut and native menu entry sources opened the shared AutoFill state;
- frontmost-context tests failed before freshness and exact live-instance validation existed;
- Rust wire tests failed before metadata query/session/one-field release and operation-specific response decoding existed;
- native receipt tests failed before exact endpoint, scope, expiry, burn-on-misuse, master-password HTTP, and Touch ID verification transitions existed;
- Swift tests failed before main-app-only grant issuance and field-bound single-use grant consumption existed;
- AppComponent and picker tests failed before entry-source routing, grouping, keyboard selection, explicit field release, fail-closed states, and account override existed;
- the full Vitest run exposed route-shell, locked-route, ARIA, and retained-runtime integrity guards; each was corrected without widening browser/generator/recovery dependency closures.

## Verification

- Picker, host, and recovery focused suites: 81 passed, including operation supersession/destruction, receipt cancellation, OnPush commits, visible/ARIA active option, main-window command routing, metadata-only selection, one-field guarded paste, locked/repair/empty, and explicit account override.
- Full Vitest regression: 3,504 passed, 22 skipped across 236 files.
- Rust: 222 passed, 4 ignored. The ignored tests require the signed Agent harness, live Touch ID, or live Keychain. The Unix-socket tests passed in the unrestricted Rust rerun.
- Full Swift/Xcode: 130 passed, 0 failed. Result bundle: `/private/tmp/task7-review-fix-xcode/Logs/Test/Test-BarwardenNativeAutoFill-2026.08.09_07-11-29-+0800.xcresult`.
- Native project, build-wrapper, identity, and IPC/contract scripts: 36 passed.
- Production web build: passed with the existing externalization, Tailwind, and chunk-size warnings only.
- `cargo fmt --check`, `git diff --check`, retained route/i18n/runtime guards, and the production configuration/entitlement diff: passed.

## Scope and residual limitations

Task 8's Accessibility floating field icon and all browser-extension behavior remain unimplemented. Task 7 only uses the menu-bar menu entry/global shortcut picker and the pre-existing guarded single-field paste fallback.

The captured external-app context intentionally expires after 30 seconds, and the verification receipt also expires after 30 seconds. A user who waits longer must reopen AutoFill or restart the protected field action. This is fail-closed behavior.

No production Tauri entitlement/configuration or native extension entitlement was changed. AutoFill session/query/receipt/release commands additionally reject every webview except the main picker window. Live signed integration remains subject to Task 9's provisioning/signing gate. The full unsigned Swift, Rust, web, and native project/build contract suites pass; no signed installation or live Touch ID success is claimed here.
