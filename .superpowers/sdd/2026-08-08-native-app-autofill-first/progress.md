# SDD ledger — plan: docs/superpowers/plans/2026-08-08-native-app-autofill-first.md

- Workspace: `$HOME/Workspace/bitwarden-menubar/.worktrees/autofill-spike`
- Branch: `codex/autofill-spike`
- Starting commit: `69b20135130e50b39e36266176ecdb16ca1b9110`
- Status: Task 9 tooling complete; external signing, notarization, and live release gates blocked
- Baseline contract tests: 7 passed, 1 browser-release skip.
- Baseline full regression: 3462 passed, 22 skipped (from prior Task 1 gate; only design/plan docs changed afterward).

## Tasks

- [x] Task 1 — Decouple native Team identity from deferred browser identities
- [x] Task 2 — Build the native Agent and Credential Provider sidecars
- [x] Task 3 — Authenticate main app and Credential Provider IPC
- [x] Task 4 — Write and provision the encrypted AutoFill projection
- [x] Task 5 — Rank native application candidates and support all-Login search
- [x] Task 6 — Implement macOS system password AutoFill
- [x] Task 7 — Add the main-app AutoFill picker and explicit field actions
- [x] Task 8 — Add conservative Accessibility floating action
- [ ] Task 9 — Pass the native packaging, signing, and installation gate

## Task 1

- Implementation: `638b004b feat: prioritize native autofill identity`
- Integrity repair: `8fe6ca2f fix: refresh overlay package integrity pins`
- Review fix: `d0a1fc75 test: prove autofill identity writes are atomic`
- Focused identity tests: 19 passed.
- Full regression: 3462 passed, 22 skipped.
- Review: approved after atomic-write and browser-recorder compatibility fixes.
- External DER independently confirmed Team ID `K7LY92JY96`; certificate/private-key pair was verified outside the repository.

## Task 2

- Implementation: `eb10dad6 build: add native autofill sidecars`
- Review fixes: `4e5b2181 fix: harden native autofill sidecars`, `fbf5009b test: verify native target inventory`
- Focused project/wrapper tests: 13 passed; Swift/Xcode tests: 7 passed.
- Real unsigned universal Release wrapper build succeeded and staged only the Agent and Credential Provider.
- Full regression: 3462 passed, 22 skipped.
- Review: approved after principal-class, Xcode discovery, symlink/product inventory, build metadata, and archive-action coverage fixes.

## Task 3

- Implementation: `1d885c7a feat: authenticate native autofill IPC`
- Security review fix: `4e5ddfff fix: harden native autofill IPC authentication`
- Harness portability fix: `b7cb2782 fix: respect selected Xcode in IPC harness`
- Swift/Xcode: 36 passed; Rust: 170 passed, 4 ignored; native project checks: 13 passed.
- Reproducible four-way signed harness passed for main app, Credential Provider, wrong-bundle rejection, and ad-hoc/no-Team rejection.
- Full regression: 3462 passed, 22 skipped.
- Review: approved after audit-token binding, PID consistency, absolute deadline, bounded concurrency, fail-closed replay capacity, and portable harness fixes.

## Task 4

- Implementation: `08e40684 feat: add encrypted native autofill projection`; first security-review fix: `e61ef015 fix: harden native autofill projection lifecycle`; second security-review fix is the current change set.
- Focused projection/lifecycle tests: TypeScript 8 passed; Rust 17 passed and 1 signed harness ignored; Swift Agent/ProjectionStore 23 passed.
- Full verification: TypeScript 3,467 passed and 22 skipped; Rust 179 passed and 4 ignored; Swift/Xcode 46 passed; native project/identity checks 32 passed; production web build passed.
- Security coverage: active-Login allowlist and forbidden-field leakage, encrypted disk-byte leakage, corrupt tag, stale revision, interruption cleanup, `0600` temporary file creation, atomic replacement/directory sync, provision failure cleanup, fresh generation/key on unlock/account switch, authenticated Agent provisioning, account/generation-bound renewal, proactive timeout zeroization, lock/logout/account removal, and process-restart denial.
- Production Tauri configuration and native entitlements remain unchanged. Matching, credential UI, Accessibility, browser extension, and secret release remain deferred.
- Security-review fix closes account-switch identity/epoch binding, main-app-only Agent lock, transactional rollback/pending cleanup, lock-ack retry, Agent monotonic concurrency, native authoritative revision allocation, dirfd/verified-FD filesystem hardening, and application-controlled key-buffer clearing.
- Security-review final verification: TypeScript 3,473 passed/22 skipped; Rust 191 passed/4 ignored; Swift 56 passed; native project/identity tests 36 passed; production web build passed.
- Security-review round 2 closes process-shared exact-epoch account bindings, atomic vault-owner envelopes, lock-before-delete recovery obligations with restart reconstruction, and bounded fail-closed retired generations.
- Round 2 final verification: TypeScript 3,473 passed/22 skipped; Rust 198 passed/4 ignored; Swift 57 passed; native project/identity tests 36 passed; production web build passed.
- Final compensation fix: `f4470015 fix: compensate failed autofill account switches`.
- Final verification: TypeScript 3,477 passed/22 skipped; Rust 199 passed/4 ignored; Swift 57 passed; production web build passed.
- Review: approved with 0 Critical, 0 Important, and 0 Minor after failed-switch persistence readback, new ownership-epoch restoration, reprojection, and fail-closed recovery handling.

## Task 5

- Implementation: `cfd69762 feat: rank native autofill candidates`; security review `7833e1eb fix: harden native autofill candidate authorization`; final residual fix `bf9b0d6c fix: close autofill candidate review gaps`.
- Candidate ordering: exact user binding/service/preset/URI-rule signals, relevant host/domain signals, then mismatch-confirmed fuzzy/history/favorite/recent/other candidates with stable tie-breaks.
- All-Login search filters all active Login records by normalized query while current-context empty search remains contextual. Unicode/IDNA/confusable/public-suffix boundaries fail closed.
- Candidate Agent responses contain display metadata and opaque cipher IDs only. The separate bounded, expiring, single-use release authorization contract validates account, generation, candidate, mismatch, and reprompt but does not release a Task 6 secret.
- Account-scoped bindings and explicit-success history travel only inside the existing ChaCha20-Poly1305 projection and are cleared after account-projection deletion succeeds.
- Security review fixes canonical numeric URI match values, schemeless exact URLs, host-safe startsWith, a pinned MPL-2.0 PSL/private-suffix fail-closed allowlist, malformed projection rejection, actual epoch usage time, and atomic ProjectionStore candidate authorization bound to revision/context/policy.
- Deterministic race coverage proves provision cannot interleave query snapshot/issue and lock cannot interleave release revalidation/consume/operation; reprompt, URI, secret, and candidate deletion changes stale the token.
- Final residual fix makes release authorization take/remove atomic before every current-state check, adds Bitwarden Host effective-port and IPv6 semantics, and sorts recent candidates by descending positive usage epoch.
- Focused verification: TypeScript 20 passed; Rust 30 passed; Swift 41 passed. Property coverage exercises 48 ordering permutations and secret-free serialization.
- Full verification: TypeScript 3,487 passed/22 skipped; Rust 202 passed/4 ignored; Swift 85 passed; native project/wrapper 13 passed; production web build passed.
- Production Tauri configuration and native entitlements remain unchanged.
- Review: approved with 0 Critical, 0 Important, and 0 Minor after consume-on-failure, Host effective-port/IPv6, and recent-epoch ordering fixes.

## Task 6

- Implementation: `82afd68e feat: add macOS credential provider autofill`; review hardening: `20bfdd01 fix: harden macOS credential provider autofill`; final callback/copy fix: `69f59eb9 fix: make autofill identity callbacks reentrant-safe`.
- Identity publication uses only active Login service/username metadata plus an opaque account/generation-scoped record identifier. Full replace covers sync/account switch, logout publishes an empty replacement, lock retains safe metadata, disabled store and replace errors fail closed.
- Password/TOTP-code release reads the requested field only inside the existing `ProjectionStore` authorization transaction after current lease/account/generation/revision/context/policy/candidate/mismatch/reprompt validation. Candidate queries remain secret-free; application-controlled response buffers are cleared after use.
- macOS 13/14 return stable `unsupported-system-totp`; macOS 15 one-time-code APIs are availability guarded. Reprompt-protected system Provider completion remains fail closed and states that system AutoFill cannot complete verification, directing the user only to open Barwarden for access; it promises no retry, approval, or Task 7 flow.
- Review hardening adds per-service opaque record IDs and exact current published-service release validation; serialized monotonic latest-wins identity publication with stable-state, external asynchronous exact-once completion delivery; atomic one-shot terminal callbacks; explicit framing/projection-key buffer clearing; requested-field candidate filtering; password plus OTP plist capabilities; fixed reason-specific copy; and mismatch-cancel retry state.
- Final verification: Swift/Xcode 124 passed; native project/wrapper/Info contracts 13 passed; full TypeScript 3,487 passed/22 skipped; Rust 202 passed/4 ignored; production web build passed.
- Signed build/live system smoke is blocked by the missing `com.sommir.barwarden.credential-provider` provisioning profile and missing Team `K7LY92JY96` Mac Development certificate/private key. No extension installation or live success is claimed; Task 9 owns that gate.
- Production Tauri configuration/native entitlements and Task 7 Accessibility/browser/focused-field behavior remain unchanged.
- Review: approved with 0 Critical, 0 Important, and 0 Minor after reentrant exact-once identity publication and accurate reprompt copy fixes.

## Task 7

- Implementation: `bbaff96f feat: add native autofill picker`; review hardening: `2edca614 fix: harden native autofill picker lifecycle`.
- The dedicated native tray menu entry and current global shortcut capture the previous exact live external application and open one shared picker state machine; ordinary tray clicks continue opening the vault.
- Candidate selection remains metadata-only. Explicit username/password/TOTP Fill or Copy actions re-query one field and request one Agent secret. Guarded paste preserves copied-manually fallback and never synthesizes Tab/Enter/Return, fills multiple fields, or submits.
- Locked, repair, empty, unavailable-context, and explicit account-override states fail closed; no candidate query or account mixing occurs before the user selects the projected account.
- Master-password and Touch ID reprompt produce a native verified, 30-second, single-use full-scope receipt. Only the authenticated main-app Agent peer may exchange it for the immediately consumed field-bound grant; UI unlock alone cannot authorize release.
- Final verification: full TypeScript 3,493 passed/22 skipped; Rust 215 passed/4 ignored; Swift/Xcode 126 passed; native project/build/IPC contracts 28 passed; production web build passed.
- Production Tauri configuration/native entitlements remain unchanged. Task 8 Accessibility floating UI and browser behavior are not implemented; signed live installation remains Task 9.
- Final review verification: TypeScript 3,504 passed/22 skipped; Rust 222 passed/4 ignored; Swift/Xcode 130 passed; native contracts 36 passed; production web build passed.
- Review: approved with 0 Critical, 0 Important, and 0 Minor after async-operation invalidation, receipt lifecycle, strict wire/zeroization, OnPush, and keyboard-accessibility fixes.

## Task 8

- Implementation: `3d909e79 feat: add native autofill floating action`; review hardening: `3a9303c3 fix: harden native autofill floating action`. The conservative macOS 13 Accessibility action remains behind the explicit `unsupported` system-AutoFill fallback gate. Default/system-available state stops AX observation and hides the panel; menu and shortcut entry remain independent of Accessibility.
- The native reader permits only role, subrole, settable/editability, position, size, window validity, and exact application identity. It never copies AX value, selected text, placeholder, title, description, identifier, or any other field content. Diagnostics contain a fixed reason and optional bounded bundle ID only.
- A worker-thread AX observer owns its CFRunLoop registration and removes every focus/move/resize/destroy notification before releasing element/observer references. Workspace activation/termination, permission loss, application identity changes, invalid elements/windows, stale snapshots, and unreliable geometry invalidate a generation and hide immediately; 50 ms throttling coalesces event bursts.
- The main-thread borderless nonactivating `NSPanel` uses the Barwarden template icon, never requests key/main status, and opens Task 7's same `autofill-floating` picker entry without releasing or filling a secret. AX top-left coordinates convert to AppKit coordinates; placement prefers the trailing exterior, falls back to the leading exterior, clamps vertically to visible work area, and otherwise hides.
- Final automated verification: Rust 239 passed/7 ignored; TypeScript 3,510 passed/22 skipped; Swift/Xcode 130 passed; native project/build-wrapper 17 passed plus identity contracts 19 passed; production web build passed; `cargo fmt --check` and `git diff --check` passed.
- Live read-only permission smoke: a fresh standalone helper returned denied without calling the prompt API; the already-authorized Rust test process passed the granted permission probe without prompting. Actual external fixture observer/panel smoke is blocked in this execution environment because the GUI session always reports `com.apple.loginwindow` as frontmost and never activates the local AppKit fixture. No observer snapshot or live panel-show success is claimed.
- Review hardening closes synchronous generation invalidation/exact visible-target consumption, observer registration fault handling and lost-event revalidation, process-lifetime one-shot/inflight prompting, strict diagnostic bundle validation, pre-cast CF/AX type checks, same-app observer reuse, and explicit template-image appearance. Review verification: Rust 248 passed/7 ignored; TypeScript 3,512 passed/22 skipped; Swift/Xcode 130 passed; native project/IPC contracts 17 passed; identity contracts 19 passed; production web build passed. The granted read-only smoke passed again without prompting; denied evidence and the bounded live fixture blocker remain unchanged and accurately reported.
- Production Tauri configuration, native entitlements, browser behavior, and Task 9 packaging/signing scope remain unchanged.
- Review: approved with 0 Critical, 0 Important, and 0 Minor after exact target click binding, fail-closed observer registration, one-shot prompting, production bundle validation, CF type checks, observer reuse, and template-image fixes.

## Task 9

- Reusable native overlay, inside-out release builder, strict bundle verifier, fixture tests, evidence schema/recorder, and a complete fixed-code live matrix are implemented. The verifier requires the exact app + Credential Provider + Agent inventory, Team `K7LY92JY96`, exact bundle IDs/App Group/entitlements, no Keychain groups, a Provider Developer ID profile, Developer ID signatures, hardened runtime, macOS 13.0, designated requirements, sealed DMG contents, notarization, stapling, and Gatekeeper.
- TDD fixture and real-artifact coverage rejects missing/duplicate/unexpected components, wrong identity/entitlements/floor, unsigned and ad-hoc inner code, wrong order/deep signing, invalid profiles, unstapled/unnotarized artifacts, and failed Gatekeeper with fixed codes only. Builder, overlay, evidence, native project, and identity focused suites pass.
- A real unsigned Release overlay built the main app and both native sidecars, assembled their exact final paths, and was rejected by the real collector as `NATIVE_AUTOFILL_INNER_UNSIGNED`. Production `tauri.conf.json` and `Entitlements.plist` remained byte-identical.
- Full verification: TypeScript 3,513 passed/22 skipped; Rust 252 passed/7 ignored; Swift/Xcode 131 passed; native project 14 passed; identity contracts 19 passed; 57 focused Node tests and all three release shell harnesses passed; production web build passed; format/check/syntax/plist/diff checks passed.
- Review hardening adopts Team-prefixed `K7LY92JY96.com.sommir.barwarden.autofill` across the contract, Swift/Rust paths, xcconfig, source/overlay entitlements, verifier, and tests. The app and raw Agent retain only the group entitlement without profiles; the Provider alone requires an exact Developer ID profile and generated effective application/team identifiers. Since production native configuration was never promoted, no old local spike-container migration is performed.
- The Agent is managed through `SMAppService.agent(plistName:)`, never `mainAppService`: status/register/unregister expose `requiresApproval` explicitly. Its exact embedded LaunchAgent uses `RunAtLoad=true`, crash-only `KeepAlive.SuccessfulExit=false`, and a 30-second throttle. The real collector validates the plist and three-command registration surface.
- Release hardening removes the production fixture-input path, binds full bundle manifest and builder policy hashes, rejects all symlinks/unexpected Mach-O/dylibs, validates the Provider profile certificate/public key against the actual signer, statically requires exact Agent → Provider → app → DMG signing and forbids deep signing, independently verifies the DMG Developer ID signature and Team, uses a fixed-code allowlist, requires explicit PASS promotion state, and atomically promotes the exact output set.
- Product follow-up connects the dedicated menu/shortcut/floating entries to persisted Agent opt-in and awaited status/register/probe, restores an enabled Agent on later startup, blocks all picker queries behind fixed Login Items approval guidance, and exposes a fail-closed disable service that clears the flag, locks, clears the current projection, and unregisters. Ordinary vault entry remains non-opt-in.
- Provider profile validation now distinguishes authorization from effective signed entitlements: exact/wildcard app authorization, absent/exact/wildcard Team App Group, and safe standard extras are accepted, while wrong Team/app/capability/cert/expiry and dangerous extras fail. This is fixture evidence only; no real profile has been proven.
- Revised schema-v2 PASS evidence accepts exactly three positive codes, requires all 18 current-macOS live rows, and binds the tested host to macOS major 26 in both runtime and JSON Schema validation. BLOCKED records may name another host OS; macOS 13–25 runtime stays fixed as `NATIVE_AUTOFILL_LOWER_OS_RUNTIME_UNVERIFIED` and non-blocking, while deployment/API/binary-floor checks remain strict. Sanitized evidence is generated in private staging before the exact five-item candidate set is exposed by one rename; evidence failure leaves no release directory.
- External state remains blocked after authorized controller attempts: the isolated temporary Keychain produced a valid Team `K7LY92JY96` Developer ID Application identity and was destroyed; Xcode automatic provisioning reached profile resolution but found no Mac App Development profile and produced no valid Developer ID Credential Provider profile. Xcode account metadata exists but contains no Team `K7LY92JY96` metadata. No notary profile or discoverable API Issuer ID exists. The builder now requires the isolated signing Keychain and passes it explicitly to both notary submissions, covered by RED/GREEN policy tests.
- No signed/notarized/stapled **release** product exists. A separate local-only Developer ID smoke app was installed on macOS 26 and proved the redesigned main-app picker, grouped/searchable real candidate query, and one explicit username fill through guarded one-field paste. It did not prove manual copy, Credential Provider enablement, notarization, update, or the complete live matrix, so all 18 production rows remain fixed-code blocked. macOS 13–25 runtime is honestly unverified and no longer blocks promotion. Production configuration was not promoted. Task 9 remains unchecked and evidence status is `BLOCKED`.
- Final signed-picker stabilization keeps search mounted/focused during asynchronous queries, revalidates the exact projection snapshot after native replace, serializes enable/disable cleanup, recreates same-route picker entries, captures tray targets before menu focus, and aligns listbox focus/scroll semantics. Focused App/Picker/Projection/Setup passed 120 tests; full TypeScript passed 3,554/22 skipped; Rust 255/7 ignored; Swift/Xcode 131/131; native contracts 29/29; local/release policies 15/15; web build passed. Independent review: 0 Critical, 0 Important, 0 Minor.
- Final lifecycle fix: normal and repair picker states both expose an awaited `Turn Off AutoFill`; disable persists its original account target before native cleanup and always attempts lock → persisted-target projection clear → unregister. Cold/locked startup and account-switch retries never substitute the current owner, and missing/failed cleanup retains the marker fail-closed. Retry awaits status/register/probe recovery and remains query-free until setup is ready. Focused App/Setup/Picker verification passes 86 tests; full TypeScript passes 3,531 with 22 skipped; production web build passes with existing warnings. Rust/native code is unchanged. Production promotion remains NO and external release blockers are unchanged.
