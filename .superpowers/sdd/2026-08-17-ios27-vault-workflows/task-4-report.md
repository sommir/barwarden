# Task 4 report — Continuous New Item and folder flows

## Outcome

- New Item now renders the retained Login/Card/Identity/Secure Note/Folder order as one semantic continuous list with 52px rows, descriptions, and exact focus keys.
- The retained title-bar New Item trigger exposes `vault:new-item`.
- Folder add/edit sheets accept the invoking trigger without breaking legacy `openFor(folder?)` calls. The folder-name input remains initial focus; cancel/Escape restores the invoking trigger, including after a nested delete Sheet has fully settled.
- Delete confirmation initially focuses its enabled Cancel action and restores the invoking Delete action when cancelled. Save/delete controls retain their existing `isSaving` disabled guards.
- Folder add/edit controls and archive/trash children expose stable focus keys. Real folder rows are flat and continuous while the real bottom Sheet retains its shaped `--mac-sheet-radius` surface.
- Existing click/output handlers, routes, option ordering, mutation behavior, and public APIs were preserved.

## TDD evidence

### RED

The first focused run used the seven brief suites against real Angular components/DOM. Result: **7 expected failures, 80 passes (87 total)**. Failures were limited to the missing New Item list role/keys, title trigger key, New Item cancel focus restoration, delete-confirm Cancel initial focus, archive/trash keys, official folder keys, and flat 52px styling.

The visual test was then moved from hand-authored markup to `NewItemPageComponent`. A second real `FoldersPageComponent` RED reproduced the hidden cascade defect: the retained `bit-item-group`/`bit-item` folder list still had rounded card styling.

### GREEN

- First minimal implementation: **7 suites, 87/87 passed**.
- Real wrapper visual refinement: **4/4 passed** after a folder-only continuous-list cascade; the same test asserts that the opened production Sheet remains shaped.
- Exact New Item key coverage asserts all five literal key/tag pairs in production order.

## Focus contract

- Title trigger: `vault:new-item`.
- New Item: `new-item:type:1`, `new-item:type:3`, `new-item:type:4`, `new-item:type:2`, `new-item:folder`.
- Folders: `folders:new` for both populated and empty actions; `folder:<id>` for the retained row and edit action.
- Vault hidden children: `vault-child:archive`, `vault-child:trash`.
- Folder Sheet: `openFor(folder?: VaultFolder, trigger?: HTMLElement | null)` passes the trigger to the real bottom-sheet focus stack and the folder-name input as initial focus.
- Delete confirm: passes the active Delete action as trigger and `delete-folder-cancel` as initial focus; Escape and explicit Cancel reopen the edit Sheet at Delete.
- The component retains the outer opener across edit→delete→edit transitions. Only a new `openFor` replaces it; terminal Save/Delete/Cancel/Escape clears it after close settlement and restores focus with a stale-operation guard.

## Recovery provenance

- Upstream revision remains `f47b6946e01aed474875789081966d311d5b8289` under GPL-3.0.
- Ran `npm run update:i18n-retained-manifests`.
- Staged only the three Task 4 runtime hashes, each checked against the actual runtime file:
  - `official-folders.component.html`: `c778b1bf1e4773a33bc07eef4940e254ae3286ba0a556f847b3c8481d124235f`
  - `folders-page.component.ts`: `4e877ac8bec2595ef3c8bf4ff481566ef8e26639ec4c0099ef5dd2b3515bc2ea`
  - `vault-folder-dialog.component.ts`: `5048a11bb56bb18d31ec54c16da152de152517c8bfd079b106fc4076f356f4fa`
- Pre-update recovery manifest working-tree SHA-256 was `b7bdabf0075ecab19a8bf5dde05acdb85638cc7e6b1cff2e6a367f8e2b8db686`. The pre-existing `official-i18n.service.ts` hash hunk remains unstaged and was not included with Task 4.

## Verification

- Initial brief 8-suite command, including recovery guard: **8 files, 94 tests passed**.
- `npm run typecheck:official-recovery`: passed.
- `npm run build:web`: passed (1124 modules transformed); only the repository's existing warning-baseline messages were emitted.
- `git diff --cached --check`: passed.

## Scope and dirty-worktree preservation

- No browser/native app was opened.
- No restore, reset, checkout, or broad `git add` was used.
- `vault-list-page.component.spec.ts`, `global.css`, and `official-recovery.transform-manifest.json` were staged interactively by hunk.
- The user's existing vault-list website-suggestion assertions, authentication CSS cascade, recovery i18n hash, native-autofill work, and all other unrelated dirty files remain outside this commit.

## Needs Fixes follow-up — nested Sheet trigger race

### Root cause and TDD

- The edit Sheet previously delegated ownership of the outer opener entirely to `AppBottomSheetComponent`. Moving to delete confirmation closed that Sheet with focus restoration disabled, and close settlement cleared its stored opener.
- Reopening edit with `open(undefined, deleteTrigger)` then captured the active internal delete Cancel when settlement had already completed. The final edit close focused that hidden control instead of the original external opener.
- Valid focused RED: **2 failed, 25 passed (27 total)**. The failures reproduced the settled edit→delete→edit chain and successful terminal Delete; the not-yet-settled timing and terminal Save were useful control cases.
- Focused GREEN: **27/27 passed**. The full test uses real external buttons, both production Sheets, real Cancel/Escape events, transform transition settlement, final edit closure, and a second `openFor` to prove stale triggers cannot steal focus.

### Implementation and provenance

- `VaultFolderDialogComponent` now owns the outer trigger lifecycle. Both initial and reopened edit Sheets receive that same trigger, while Delete retains its own Delete-button trigger and Cancel initial focus.
- Real `closed` events distinguish a nested transition from terminal closure. Terminal manual restoration is deferred past native close and official autofocus fallback, guarded by `operationToken`, `isOpen`, and `isConnected`.
- Save, Delete, explicit Cancel, and Escape terminal paths are covered; `isSaving`, bottom-sheet APIs, and animation timing remain unchanged.
- Ran `npm run update:i18n-retained-manifests`. The current truthful `vault-folder-dialog.component.ts` runtime hash is `d8596cb5c8f8a3833d66c5ee622d016ffb6fee40bbea415266e75c73f2f5c6c6`.
- Pre-follow-up recovery manifest working-tree SHA-256 was `db2477cd352c5e12b75619769f9de7f21c5f8296fc79bec6c82a334123585226`. Only the exact folder-dialog runtime hash belongs to this follow-up; the pre-existing i18n hash hunk remains unstaged.

### Follow-up verification

- Brief 8-suite command, including recovery guard: **8 files, 98 tests passed**.
- `npm run typecheck:official-recovery`: passed.
- `npm run build:web`: passed (1124 modules transformed) with only warning-baseline output.
