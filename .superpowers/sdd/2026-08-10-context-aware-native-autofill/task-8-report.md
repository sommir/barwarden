# Task 8 Report — Automated cross-layer gates

## Status

The automated phase is complete. All deterministic race, privacy, identity, decoder, native, application, and production-build gates pass serially. The locally signed macOS 26 live matrix is intentionally not part of this commit and remains pending for the root task; this phase did not access credentials, sign or install an app, operate the GUI, notarize, modify entitlements/production configuration, or start browser work.

## New automated gates

- `scripts/native-autofill-contract.spec.mjs`
  - Proves the production native classification path has no selected-text, pixel/screenshot, OCR, or application-specific source.
  - Allows exactly the two non-content `AXValue` operations required by the design: the settable-state query and the exact write. Neither copies field contents.
  - Proves the detected-fill path has no `AXPress`, Return, Tab, mouse event, login-button click, or application-specific adapter. The only synthesized key is Command-V's V key down/up inside the guarded paste transaction.
- `scripts/native-autofill-identity.spec.mjs`
  - Pins Team `K7LY92JY96`, the Team-prefixed App Group, app/Provider/Agent bundle identifiers, and the macOS 13 binary floor.
  - Keeps Chrome/Edge publication explicitly deferred; no browser target was introduced.
- `tauri-host.service.spec.ts`
  - Exhaustively injects `label`, `placeholder`, `identifier`, `geometry`, `frame`, `pid`, `password`, `totpSeed`, `value`, and `releasedSecret` into entry, candidate, and fill responses. Every boundary rejects the response with the fixed unavailable error.

The exact native contract command passes `19/19`; this includes the existing Xcode inventory/build-wrapper gates as well as the new privacy and identity gates.

## Deterministic race and one-shot audit

The required barriers already existed as executable tests from Tasks 1–7, so Task 8 retained them as the cross-layer gate instead of creating duplicate wrapper tests:

- Observe/focus/app/window/generation:
  - `observer_generation_change_during_live_validation_rejects_the_taken_token`
  - `exact_fill_element_index_requires_the_same_process_window_frame_and_generation`
  - `exact_fill_rejects_pid_reuse_identity_change_and_focus_switch`
  - `exact_target_window_frame_or_generation_change_fails_before_that_write`
- Query and authorization:
  - `rejects all settled results when live target or Agent session changes`
  - `uses frozen request projections while caller context and session mutate during queries`
  - `burns a late receipt when cancellation or staleness wins during begin`
  - `linearizes cancellation against a pending fill and only cancels the stored receipt`
- Between writes and partial failure:
  - `all_secrets_are_collected_before_writes_and_release_failure_writes_nothing`
  - `first_ax_failure_returns_metadata_only_partial_and_stops`
  - `exact_target_window_frame_or_generation_change_fails_before_that_write`
  - `verified_batch_receipt_is_consumed_once_before_field_scoped_releases`
- Expiry, replay, and capacity:
  - `tokens_expire_at_thirty_seconds_and_are_consumed_on_every_take_attempt`
  - `capacity_rejects_without_evicting_and_invalidation_burns_every_context`
  - `testReleaseMismatchPermanentlyConsumesTokenBeforeAnyProjectionCheck`
  - `testRetiredGenerationCapacityFailsClosedWithoutEvictingOldGenerations`
- Account/projection/lock/reprompt:
  - `testCandidateQueryIssueIsAtomicWithProvisionAndClearsTheStaleToken`
  - `testLockCannotInterleaveReleaseRevalidationConsumeAndOperation`
  - `testDirectIdentityRejectsServiceRemovedByNewProjectionRevision`
  - `burns active actions when their ephemeral session clears, expires, navigates, or selection changes`
- Queued pill show/click:
  - `observer_callback_synchronously_invalidates_visible_snapshot_before_scheduling_hide`
  - `successful_optional_layout_callback_hides_and_rejects_queued_show_and_stale_click`
  - `panel_click_atomically_consumes_only_the_exact_visible_generation_and_app_instance`
- Detail navigation and reprompt:
  - `does not publish a contextual action when the detail route changes during native validation`
  - `burns a contextual session when a reused detail route changes A to B to A`
  - `cancels a no-reprompt action when navigation changes during live validation`
  - `burns an exact protected batch receipt that arrives after detail navigation`
  - `burns the exact protected batch receipt when reprompt validation becomes invalid`

Together these tests assert that stale tokens/receipts are consumed once, every invalidation returns a fixed metadata-only outcome, and no later secret release or field write can resume after the losing barrier.

## Deferred finding closure

### Task 1 `subrole`

Closed as material. A secure control may expose `AXTextField` as its role and `AXSecureTextField` as its subrole. The focused RED classified this as `Unknown`; `is_secure_role` now accepts the secure subrole and the GREEN result is a high-confidence password/form action. The previously deferred `subrole` dead-code warning is gone.

### Task 2 logical identity

Closed by the existing Task 4 change `fadb1419`: native AX element/window equality uses `CFEqual`, not raw pointer equality. The current opaque-identity tests cover reordering, duplicate indistinguishable elements, PID reuse, window identity, and focus switching. No Task 8 code change was needed.

### Task 5 strict arrays, partial order, and revision

Closed. App and host boundaries now take one descriptor-based dense-array snapshot and reject sparse, augmented, accessor/symbol-bearing, and custom-prototype arrays. Accepted snapshots are frozen and do not retain the caller/native alias. Agent `vaultRevision` must be a nonnegative safe integer. Partial outcomes may list only canonical fields strictly before the failed field, matching the native executor's stop-at-first-failure contract.

RED evidence for the four focused TypeScript boundaries was `4 files failed; 5 failed / 118 passed`. GREEN after the strict fixes plus the response-privacy matrix is `4 files passed; 124 passed`. The secure-subrole focused Rust test was RED with `Unknown` versus `Password` and GREEN in the `15/15` classifier suite. The new native source gate was initially RED `18/19` until inspection was correctly limited to production source; the final command is `19/19`.

Only the existing host runtime recovery hash changed (`6d6825f0ebcad6535c5e07be85e471546b51405efe473ca9ffa2519375adaa44`). The recovery guard passes and the closure/command surface is unchanged.

## Serial regression evidence

All commands were run serially to avoid generated-hash races:

```text
cargo fmt --check
PASS

cargo check
PASS; 7 pre-existing dead-code warnings remain. The deferred Task 1 subrole warning is absent.

cargo test
344 total: 337 passed, 7 ignored, 0 failed

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project apps/macos-autofill/BarwardenAutoFill.xcodeproj \
  -scheme BarwardenNativeAutoFill -destination platform=macOS \
  -derivedDataPath <isolated-temp-path> test CODE_SIGNING_ALLOWED=NO
143 passed, 0 failed; TEST SUCCEEDED

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer node --test \
  scripts/native-autofill-project.spec.mjs \
  scripts/native-autofill-contract.spec.mjs \
  scripts/native-autofill-identity.spec.mjs
19 passed, 0 failed

npm test
244 files: 242 passed, 2 skipped
3,670 tests: 3,648 passed, 22 skipped, 0 failed

npm run build:web
PASS; 1116 modules transformed

git diff --check
PASS; no output
```

The Web build emitted only the recorded baseline warnings for browser-externalized Node modules, retained Tailwind at-rules, plugin timing, and large chunks. The Vitest CSS parser notices were non-failing existing environment noise.

## Independent self-review

- Security/privacy: new runtime behavior only strengthens strict projections and recognizes the already-read secure subrole. No plaintext secret/value, raw AX metadata, selected text, pixel data, OCR result, PID, or geometry crosses entry/candidate/fill responses.
- Race safety: every release/write barrier remains one-shot; all secrets are collected before the first write; release failure yields zero writes; first write failure yields the exact canonical partial result and stops.
- Scope: changed production files are limited to the secure-subrole classifier and local TypeScript/host decoders. No Tauri production config, entitlement, Xcode target, browser code, release flow, or persistence surface changed.
- Recovery: the host decoder edit required only its expected manifest hash update; the recovery guard and full regression remain green.

No automated blocker remains. The seven Rust warnings are pre-existing unused internal helpers and are unrelated to the Task 8 changes.

## Exact prerequisites for the root signed local smoke

The remaining phase may proceed only when all of the following are true:

1. Use the repository's existing local-smoke builder with `NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY=1` and a separate, already-authorized signing Keychain.
2. Supply nonempty `NATIVE_AUTOFILL_SIGNING_IDENTITY`, `NATIVE_AUTOFILL_SIGNING_KEYCHAIN`, and `NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR` without printing their values or paths into logs/evidence.
3. Verify Team `K7LY92JY96` and the exact app/Provider/Agent designated requirements before launch.
4. Install to an explicit recoverable test location; remove or clearly distinguish duplicate old Barwarden installations. Do not overwrite the normal app without a recoverable backup.
5. Grant Accessibility and App Data permission only to that exact signed test app, then use dedicated non-production username/password/TOTP fields.
6. Run the macOS 26 matrix from `task-8-brief.md` through Computer Use and capture only redacted screenshots/status/hash evidence.
7. Do not notarize, staple, create a DMG, promote a production artifact, alter production configuration/entitlements, or claim lower-macOS runtime support.
