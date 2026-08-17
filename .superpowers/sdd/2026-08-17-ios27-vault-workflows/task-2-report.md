# Task 2 — Flat detail hierarchy and focus-return producers

## RED

- Added a real `VaultItemDetailPageComponent` fixture contract for the item-name `h1`, type/folder metadata, hidden duplicate identity, contextual Fill as the first visible section, and the exact Edit focus key.
- Loaded the production `macos-tokens.css` and `global.css` into the real detail fixture and asserted computed card/control styles; no CSS-source regex or hand-built detail DOM was used.
- Added real retained row, menu, and history component assertions for `vault-item:<id>` and `detail-history:<id>`, including proof that only View/Edit/Clone menu navigation receives the row key.
- The required seven-suite RED run failed in seven target places: generic heading, duplicate identity contract, three focus-key producers, and rounded ordinary detail surfaces.
- After changing the retained row/menu templates, the byte-lock guard was also run before its lock update and failed on the changed row runtime hash as expected.

## GREEN

- The page heading now uses the item name and exposes `type · folder` metadata through getter-only state.
- The official item identity remains in the retained child graph for traceability, but both the official host and rendered identity root are `aria-hidden`; the rendered root is visually removed by the page-scoped production rule.
- Contextual Fill was not moved. Hiding the duplicate identity makes the existing official credentials action the first visible section.
- Ordinary detail `bit-card` surfaces are flat and transparent; real read-only/form controls use a 10 px radius; adjacent section spacing is compact-aware.
- Exact focus producers are limited to the detail Edit link, password-history navigation, real Vault row navigation, and View/Edit/Clone menu navigation.
- Existing official inputs/outputs and fill, reveal, reprompt, copy, launch, and API paths were not changed.

## Provenance and retained guards

- Ran `npm run update:i18n-retained-manifests`.
- Kept only the task-required runtime hashes in `official-login-detail.transform-manifest.json` and `official-personal-detail.transform-manifest.json`: Login/Personal compositions, shared item identity, and shared item history.
- Updated the retained Vault list byte locks for the row and menu runtime templates after first observing the guard RED.
- The pre-existing recovery-manifest diff remained byte-for-byte unchanged (`git diff` SHA-256 `9871874c0d6f0ac1dedfd4e0493076501978466d0e7e7f8b3ba88b44ef4b931b`).

## Verification

```text
npx vitest run apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/cipher-detail-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/personal-cipher-detail-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts

Test Files  9 passed (9)
Tests       95 passed (95)

npx vitest run apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/cipher-detail-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/personal-cipher-detail-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-overlay.guard.spec.ts

Test Files  3 passed (3)
Tests       22 passed (22)

npm run typecheck:official-login
exit 0

npm run typecheck:official-personal
exit 0
```

## Scope and dirty-worktree preservation

- Only Task 2 detail hierarchy, style, focus producers, tests, runtime locks/manifests, and this report are intended for the commit.
- `global.css` already contained unrelated authentication changes; only the Task 2 detail-style hunk is staged.
- `retained-vault-list-overlay.guard.spec.ts` already contained an unrelated Vault list-page hash update; only the two Task 2 row/menu lock hunks are staged.
- The recovery manifest, i18n service, Vault list component, recovery work, and all other pre-existing modified/deleted/untracked files are left unstaged and unchanged by this commit.
