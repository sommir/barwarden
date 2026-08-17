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

## Review fix — RED

- A real deferred Login page test reproduced the dirty-navigation race: after cancelling the discard dialog, `savePending` became false and the transport lock was lost while the original write was still in flight.
- The existing deferred Card/Identity/Secure Note dirty-navigation matrix was tightened to require the personal operation token, disabled submit state, and duplicate-write suppression to remain owned until the old transport settles.
- Real retained Login and personal forms reproduced focus on hidden/disabled first invalid controls; a Login case also reproduced failure to continue when the first candidate refused focus.
- The production stylesheet cascade over a mounted retained Bitwarden form and a real `ng-select` reproduced the visible-shell mismatch: `[bitfieldcontainer]` had no page radius override and `.ng-select-container` retained the official 11 px radius.
- Real Login and personal page paths added assertions for the debounced Bitwarden button spinner, `aria-busy`, `aria-disabled`, polite status, and failure cleanup.

## Review fix — GREEN

- Operation invalidation now advances the stale-result epoch without releasing the in-flight transport token. Dirty-confirm cancellation therefore keeps `savePending` and duplicate suppression active; settle clears the token normally while the invalidated epoch rejects the late result.
- Invalid-control selection excludes forms, hidden and hidden-type inputs, disabled controls, `aria-hidden`/`inert` subtrees, computed `display:none`/`visibility:hidden`, and zero-client-rect controls when a real layout engine is present. If `focus({ preventScroll: true })` does not take effect or throws, selection continues to the next candidate before centered automatic scrolling.
- Vault-page CSS now applies 44 px minimum hit area and 10 px radius to the visible `[bitfieldcontainer]` and `.ng-select-container` shells. The selector remains under `.macos-page--vault-form .cipher-form-scroll`; an outside sheet control retains the official 11 px radius.
- Both Button loading paths expose the real delayed spinner and clear it after Login or personal failure without clearing typed data.

## Review fix — provenance

- No retained class member was added or removed. The two `focusFirstInvalidControl` runtime-only canonical member hashes and the personal member manifest entry were truthfully refreshed for the hardened implementation.
- Ran `npm run update:i18n-retained-manifests`; retained only the two Task 3 runtime hashes. Pinned authority revision and authority hashes are unchanged; the pre-existing recovery manifest work remains outside this task scope.
- The strict official typecheck profiles required `Array.from(querySelectorAll(...))` because their DOM library does not include iterable `NodeList`; member and runtime hashes were refreshed after that compatibility-only adjustment.

## Review fix — verification

```text
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/cipher-form-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/personal-cipher-form-overlay.guard.spec.ts apps/menubar-tauri/src/app/vault/personal-cipher-save-operation.spec.ts apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts

Test Files  7 passed (7)
Tests       386 passed (386)

npm run typecheck:official-login
exit 0

npm run typecheck:official-personal
exit 0
```

## Review fix — scope

- The follow-up changes are limited to the two retained form runtimes/tests and their member/runtime pins, personal operation/page ownership and tests, the real-cascade visual test, the page-scoped Vault CSS hunk, and this report.
- Unrelated authentication CSS, recovery/i18n work, native autofill changes, deleted matcher files, and all other dirty-worktree content remain unstaged and unmodified by this commit.
