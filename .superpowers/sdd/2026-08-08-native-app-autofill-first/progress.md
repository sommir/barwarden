# SDD ledger — plan: docs/superpowers/plans/2026-08-08-native-app-autofill-first.md

- Workspace: `$HOME/Workspace/bitwarden-menubar/.worktrees/autofill-spike`
- Branch: `codex/autofill-spike`
- Starting commit: `69b20135130e50b39e36266176ecdb16ca1b9110`
- Status: Task 4 implemented; awaiting review
- Baseline contract tests: 7 passed, 1 browser-release skip.
- Baseline full regression: 3462 passed, 22 skipped (from prior Task 1 gate; only design/plan docs changed afterward).

## Tasks

- [x] Task 1 — Decouple native Team identity from deferred browser identities
- [x] Task 2 — Build the native Agent and Credential Provider sidecars
- [x] Task 3 — Authenticate main app and Credential Provider IPC
- [x] Task 4 — Write and provision the encrypted AutoFill projection
- [ ] Task 5 — Rank native application candidates and support all-Login search
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

- Implementation: pending final commit `feat: add encrypted native autofill projection`.
- Focused projection/lifecycle tests: TypeScript 8 passed; Rust 17 passed and 1 signed harness ignored; Swift Agent/ProjectionStore 23 passed.
- Full verification: TypeScript 3,467 passed and 22 skipped; Rust 179 passed and 4 ignored; Swift/Xcode 46 passed; native project/identity checks 32 passed; production web build passed.
- Security coverage: active-Login allowlist and forbidden-field leakage, encrypted disk-byte leakage, corrupt tag, stale revision, interruption cleanup, `0600` temporary file creation, atomic replacement/directory sync, provision failure cleanup, fresh generation/key on unlock/account switch, authenticated Agent provisioning, account/generation-bound renewal, proactive timeout zeroization, lock/logout/account removal, and process-restart denial.
- Production Tauri configuration and native entitlements remain unchanged. Matching, credential UI, Accessibility, browser extension, and secret release remain deferred.
