# Task 3 — First-invalid focus, pending state, and flat forms

## RED

- Added real retained Login and personal-form tests for first-invalid focus, `aria-invalid`, `preventScroll`, and centered automatic scrolling.
- Added operation/page tests for token-derived pending state, `aria-busy`, polite saving feedback, duplicate-write suppression, failed-save cleanup, and typed-value retention.
- Added a real mounted retained personal form under the production stylesheet cascade for flat cards, 44 px/10 px controls, and 16 px compact section spacing.
- Ran the five pre-implementation suites: exactly 5 tests failed on missing focus, pending, busy/live feedback, and flat-form styling.

## GREEN

- Scoped invalid-control lookup to each official form with `#formElement`; invalid submit now focuses with `{ preventScroll: true }` and centers with `{ block: "center", behavior: "auto" }`.
- Added `PersonalCipherSaveOperation.pending` directly from the operation token and `VaultAddEditPageComponent.savePending` from the Login or personal operation token.
- Bound the scroll wrapper and active save button to busy/loading state and added a polite atomic screen-reader saving status.
- Flattened retained form cards, standardized controls to 44 px minimum height and 10 px radius, and tightened compact section spacing to 16 px.
- Preserved all existing config, submit, result, duplicate, failure, navigation, and typed-form semantics.

## Provenance

- Updated both retained form templates and exact member/template transform contracts for the new form reference, runtime-only focus members, and invalid-submit call.
- Added canonical runtime-only member hashes with specific retained-boundary justifications.
- Ran `npm run update:i18n-retained-manifests`; only the two Task 3 form runtime hashes were retained from the updater. Authority revision and authority hashes were not changed.
- Both replay/source guards pass, including exact template replay and runtime/member hash validation.

## Verification

```text
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/cipher-form-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/personal-cipher-form-overlay.guard.spec.ts apps/menubar-tauri/src/app/vault/personal-cipher-save-operation.spec.ts apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts

Test Files  7 passed (7)
Tests       381 passed (381)

npm run typecheck:official-login
exit 0

npm run typecheck:official-personal
exit 0
```

## Scope and dirty-worktree preservation

- Changed only Task 3 implementation, tests, retained provenance contracts/manifests, the personal guard allowlist, and this report.
- `global.css` already contained unrelated authentication changes; only the Task 3 vault-form styling hunk is staged.
- The pre-existing recovery manifest and all other unrelated modified, deleted, and untracked worktree files were preserved and left unstaged.
- No restore, reset, broad add, browser, or native run was used.
