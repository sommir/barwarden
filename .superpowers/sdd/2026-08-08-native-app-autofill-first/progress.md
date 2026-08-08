# SDD ledger — plan: docs/superpowers/plans/2026-08-08-native-app-autofill-first.md

- Workspace: `$HOME/Workspace/bitwarden-menubar/.worktrees/autofill-spike`
- Branch: `codex/autofill-spike`
- Starting commit: `69b20135130e50b39e36266176ecdb16ca1b9110`
- Status: Task 5 security review fixes implemented; awaiting review
- Baseline contract tests: 7 passed, 1 browser-release skip.
- Baseline full regression: 3462 passed, 22 skipped (from prior Task 1 gate; only design/plan docs changed afterward).

## Tasks

- [x] Task 1 — Decouple native Team identity from deferred browser identities
- [x] Task 2 — Build the native Agent and Credential Provider sidecars
- [x] Task 3 — Authenticate main app and Credential Provider IPC
- [x] Task 4 — Write and provision the encrypted AutoFill projection
- [x] Task 5 — Rank native application candidates and support all-Login search
- [ ] Task 6 — Implement macOS system password AutoFill
- [ ] Task 7 — Add the main-app AutoFill picker and explicit field actions
- [ ] Task 8 — Add conservative Accessibility floating action
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

- Implementation: `cfd69762 feat: rank native autofill candidates`; security review `7833e1eb fix: harden native autofill candidate authorization`; final residual target commit `fix: close autofill candidate review gaps`.
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
