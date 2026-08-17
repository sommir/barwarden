# Task 5 — Continuous recovery/history and retryable danger Sheets

## Outcome

- Archive, Trash, and password-history use real retained Bitwarden rows under one continuous flat recovery surface: 52 px rows and 44 px actions in compact mode.
- Archive and Trash row/View/More/Edit/Clone controls expose exact `archive-item:<id>` / `trash-item:<id>` focus keys. Restore, unarchive, soft-delete, and permanent-delete carry the real More button as the invoking trigger; permanent delete is a danger menu item.
- Password history is a semantic `bit-item-group role="list"`; every owned real `bit-item` is a `listitem`. Its copy action includes the cipher name for VoiceOver and never includes the password value.
- Protected destructive actions reprompt before opening confirmation. The typed confirmation continuation returns `RecoveryPageActionResult`, and the original More trigger survives reprompt → confirmation.
- Archive delete and permanent-delete confirmations initially focus Cancel, disable both actions while busy, keep the Sheet open after a non-terminal failure, render exactly one assertive danger alert, permit retry, and close on terminal success or the exact Vault-changed stale outcome.
- Recovery results carry a stable typed failure reason. Archive and Trash identify stale outcomes by `reason === "stale"`, independent of the localized display status.
- Busy confirmation Sheets reject Escape, backdrop, and title-close dismissal through the real BottomSheet close gate. Destroy remains an explicit forced teardown, and late completion cannot revive busy/error/continuation state.

## TDD evidence

### RED

The prescribed seven-suite run used real retained Archive/Trash/history components, production wrappers, the real adapter, and the production CSS cascade. Result: **6 expected failures, 57 passes (63 total)**.

The failures were exactly the missing contracts: Archive/Trash focus keys and native triggers, danger variant, confirmation-before-reprompt ordering, Cancel initial focus, semantic history list/contextual copy name, and continuous 52/44 px styling.

### GREEN

- First complete seven-suite GREEN after integration fixes: **7 files, 63/63 tests passed**.
- Final brief run including the recovery guard: **8 files, 69/69 tests passed**.
- No synthetic replacement page or test-only wrapper was used. The visual assertion loads `macos-tokens.css` and `global.css`; Archive, Trash, history, retry, and focus assertions mount production Angular components.

### Review-fix RED/GREEN — 2026-08-18

- RED targeted run: **4 expected failures, 36 passes (40 total)**. The failures independently exposed missing stable stale reason, Chinese stale confirmation remaining open with a retry alert, busy dismissal closing the real Sheet, and missing owned `listitem` semantics. The English stale case passed under the old implementation only because its localized message happened to equal the hard-coded comparison.
- GREEN targeted run: **3 files, 40/40 tests passed**.
- Final brief/guard run after the review fix: **8 files, 74/74 tests passed**.
- Locale coverage uses the real `OfficialI18nService` in English and Chinese. The adapter test drives a deferred real `VaultActionsService` lifecycle stale result; wrapper tests mount the real Archive/Trash confirmation DOM.

## Retry, reprompt, focus, and race contracts

- `RecoveryPageActionsAdapter.executeCurrent` checks reprompt before confirmation and forwards the captured trigger only after verification succeeds. Its typed result preserves lifecycle `duplicate` / `failure` / `stale` reasons and gives every internally detected stale path the same stable discriminant.
- Confirmation submission snapshots the pending continuation. Duplicate submit returns while `confirmationBusy` is true. A replaced/cancelled/destroyed continuation cannot clear or publish state because the identity check rejects its late completion.
- Both close methods clear continuation, busy, and error before closing. Therefore Cancel, dismissal, destroy, stale completion, and a later retry cannot inherit old error/busy state.
- Non-terminal failures leave the real Sheet open and publish one `MacosAlertStripComponent` live region. A retry reuses the same typed continuation; terminal success closes. A typed `reason: "stale"` outcome is close-only and is not exposed as a retry error.
- Stale close-only behavior no longer compares display text. English Archive and Chinese Trash cases both close silently from `reason: "stale"`, while preserving their localized status text in the typed outcome.
- `[disableClose]="confirmationBusy"` blocks native Escape, backdrop, and overlay-stack dismissals. The wrapper close handler also refuses title-close events while busy; footer actions remain disabled. After failure, busy clears, one alert is shown, retry and Cancel become usable, and destroy still force-closes safely before late completion settles.
- The retained menu closes after its item click handler and restores focus to More. Wrapper destructive execution yields one microtask before adapter execution, so menu closure completes before the Sheet opens and focuses Cancel.
- Pinned `bit-dialog` schedules a title fallback even inside a closed Sheet. Static `bitAutofocus` markers on the Sheet-owned Cancel controls and the reprompt password input suppress that fallback; `AppBottomSheet.open` remains the authority for actual initial focus.
- Existing adapter epoch/session/route/exact-source checks and the in-flight key continue to reject duplicate, locked, account-switched, route-destroyed, source-replaced, and late server outcomes without mutating newer status, collections, route, or item state.

## Provenance

- Upstream authority remains `f47b6946e01aed474875789081966d311d5b8289` under GPL-3.0; source hashes and authority pin were not changed.
- Pre-update recovery manifest working-tree SHA-256: `2d7c338f2fe5837c393cba3d8bf06fc3dabfaa8687cff3563466b673f569be98`.
- Review-fix pre-update recovery manifest working-tree SHA-256: `0e5fb67e4a5f49eeed0a6f7d3f157d1066f9df64666f1f0d82d723f49f323b79`.
- Ran `node scripts/update-i18n-retained-manifests.mjs` and inspected every recovery-manifest hunk.
- Task 5 runtime hashes are truthful for the changed retained templates/components, command/adapter, and Archive/Trash wrappers. The review-fix hashes are history HTML `4f86ba75…cac8`, recovery command `35e2c4d4…7794`, Archive wrapper `75d5ae81…c3dc`, adapter `aaa005c7…08bc`, and Trash wrapper `167b9e4d…1658`.
- The pre-existing `official-i18n.service.ts` recovery-manifest hunk (`f54d…1d66`) remains unstaged. Only the exact review-fix runtime hash hunks are included in the follow-up commit.

## Verification

```text
npx vitest run <the 8 Task 5 suites including recovery-overlay.guard.spec.ts>
Test Files  8 passed (8)
Tests       74 passed (74)

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
- The review-fix follow-up changes only the history retained template/test, typed recovery command and adapter/test, Archive/Trash wrappers and their shared real-DOM spec, five truthful runtime hashes, and this report.
- `global.css` already contained unrelated authentication cascade changes; only the Task 5 recovery-list hunk is staged.
- The recovery manifest already contained the user-owned i18n hash hunk; it remains unstaged.
- No reset, restore, checkout, broad add, browser run, or native app run was used. All unrelated modified, deleted, and untracked files remain untouched and unstaged.
