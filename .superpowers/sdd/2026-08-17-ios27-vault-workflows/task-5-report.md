# Task 5 — Continuous recovery/history and retryable danger Sheets

## Outcome

- Archive, Trash, and password-history use real retained Bitwarden rows under one continuous flat recovery surface: 52 px rows and 44 px actions in compact mode.
- Archive and Trash row/View/More/Edit/Clone controls expose exact `archive-item:<id>` / `trash-item:<id>` focus keys. Restore, unarchive, soft-delete, and permanent-delete carry the real More button as the invoking trigger; permanent delete is a danger menu item.
- Password history is a semantic `bit-item-group role="list"`. Its copy action includes the cipher name for VoiceOver and never includes the password value.
- Protected destructive actions reprompt before opening confirmation. The typed confirmation continuation returns `RecoveryPageActionResult`, and the original More trigger survives reprompt → confirmation.
- Archive delete and permanent-delete confirmations initially focus Cancel, disable both actions while busy, keep the Sheet open after a non-terminal failure, render exactly one assertive danger alert, permit retry, and close on terminal success or the exact Vault-changed stale outcome.

## TDD evidence

### RED

The prescribed seven-suite run used real retained Archive/Trash/history components, production wrappers, the real adapter, and the production CSS cascade. Result: **6 expected failures, 57 passes (63 total)**.

The failures were exactly the missing contracts: Archive/Trash focus keys and native triggers, danger variant, confirmation-before-reprompt ordering, Cancel initial focus, semantic history list/contextual copy name, and continuous 52/44 px styling.

### GREEN

- First complete seven-suite GREEN after integration fixes: **7 files, 63/63 tests passed**.
- Final brief run including the recovery guard: **8 files, 69/69 tests passed**.
- No synthetic replacement page or test-only wrapper was used. The visual assertion loads `macos-tokens.css` and `global.css`; Archive, Trash, history, retry, and focus assertions mount production Angular components.

## Retry, reprompt, focus, and race contracts

- `RecoveryPageActionsAdapter.executeCurrent` now checks reprompt before confirmation and forwards the captured trigger only after verification succeeds.
- Confirmation submission snapshots the pending continuation. Duplicate submit returns while `confirmationBusy` is true. A replaced/cancelled/destroyed continuation cannot clear or publish state because the identity check rejects its late completion.
- Both close methods clear continuation, busy, and error before closing. Therefore Cancel, dismissal, destroy, stale completion, and a later retry cannot inherit old error/busy state.
- Non-terminal failures leave the real Sheet open and publish one `MacosAlertStripComponent` live region. A retry reuses the same typed continuation; terminal success closes. `Vault changed; action not applied.` is treated as a close-only stale outcome and is not exposed as a retry error.
- The retained menu closes after its item click handler and restores focus to More. Wrapper destructive execution yields one microtask before adapter execution, so menu closure completes before the Sheet opens and focuses Cancel.
- Pinned `bit-dialog` schedules a title fallback even inside a closed Sheet. Static `bitAutofocus` markers on the Sheet-owned Cancel controls and the reprompt password input suppress that fallback; `AppBottomSheet.open` remains the authority for actual initial focus.
- Existing adapter epoch/session/route/exact-source checks and the in-flight key continue to reject duplicate, locked, account-switched, route-destroyed, source-replaced, and late server outcomes without mutating newer status, collections, route, or item state.

## Provenance

- Upstream authority remains `f47b6946e01aed474875789081966d311d5b8289` under GPL-3.0; source hashes and authority pin were not changed.
- Pre-update recovery manifest working-tree SHA-256: `2d7c338f2fe5837c393cba3d8bf06fc3dabfaa8687cff3563466b673f569be98`.
- Ran `node scripts/update-i18n-retained-manifests.mjs` and inspected every recovery-manifest hunk.
- Task 5 runtime hashes are truthful for the changed retained templates/components, command/adapter, and Archive/Trash wrappers. The final adapter hash is `b698c68f84ffde97568b13c194068932fa5b9156eeaa46b9ba56ccb2307964be`.
- The pre-existing `official-i18n.service.ts` recovery-manifest hunk (`f54d…1d66`) remains unstaged. Only Task 5 runtime hash hunks are included in this commit.

## Verification

```text
npx vitest run <the 8 Task 5 suites including recovery-overlay.guard.spec.ts>
Test Files  8 passed (8)
Tests       69 passed (69)

npm run typecheck:official-recovery
exit 0

npm run build:web
1124 modules transformed; exit 0

git diff --cached --check
exit 0
```

The web build emitted only the repository's existing warning-baseline messages for externalized Node modules, Tailwind at-rules, plugin timings, and chunk size.

## Scope and dirty-worktree preservation

- Changed only Task 5 recovery/history runtime and tests, the two app-owned wrappers, the adapter/command contract, the production recovery CSS hunk, one reprompt focus marker required by the real dual-Sheet focus graph, the Task 5 runtime manifest hashes, and this report.
- `global.css` already contained unrelated authentication cascade changes; only the Task 5 recovery-list hunk is staged.
- The recovery manifest already contained the user-owned i18n hash hunk; it remains unstaged.
- No reset, restore, checkout, broad add, browser run, or native app run was used. All unrelated modified, deleted, and untracked files remain untouched and unstaged.
