# Generator whole-plan final fix report

## Outcome

- Base: `903175e52cd107b050bd81e4ee77ee5b5b6a10a9` on `main`, with an initially empty index.
- Scope: close all five whole-plan review findings without changing Generator behavior bindings, retained templates, authority pins, or pinned vendor sources.
- Production changes are limited to exact Generator hunks in `global.css`; the real mounted regression lives in `generator-send-ios27.visual.spec.ts`.

## Strict RED evidence

The new real Angular mounted tests ran before production changes.

- Generator page: one selected test failed with eight expected soft assertions.
  - The real Regenerate `primaryGhost` button's `aria-disabled="true"` and native `disabled` states still inherited hover/pressed plate paint.
  - Forced Colors rendered disabled Regenerate identically to enabled Regenerate.
  - The real mode `label` had no pointer-down `:active` feedback.
  - At an independently applied 200% root font scale, the real `bit-toggle`, native radio/label owner, and first-span paint layer retained hostile 40px maximum height, hidden overflow, nowrap, ellipsis, and one-line clamp instead of growing.
- History page: one selected test failed with eight expected soft assertions.
  - The real `popup-page > main > [data-testid="popup-layout-scroll-region"]` already supplied the single 16px page inset, but `macos-generator-history__content` added another 16px margin.
  - The real row's 44px Copy owner plus 4px top and bottom padding modeled to 52px in both normal and compact modes, despite the 48/44px row contract.

No synthetic `ng-content` shell was used to obtain the History evidence. The content section is asserted as the direct child of the production scroll owner.

## Minimal fix

- Removed the duplicate History content margin.
- Changed History row vertical padding to 2px normal and 0px compact. The mutation-sensitive row model now proves `max(min-height, vertical padding + tallest real child)` equals 48px normal and 44px compact with the real 44px Copy owner.
- Released fixed/max-height, clipping, nowrap, ellipsis, and line-clamp constraints from real mode owners and the painted span. The default and compact baselines remain 44px owner / 40px paint / 36px compact paint, while long localized labels may wrap and grow at a separately applied 200% root scale.
- Added immediate `:active` feedback for unselected and selected mode labels.
- Added neutral Regenerate disabled styling for native and ARIA-disabled states, including explicit hover/pressed invariance and a differentiated GrayText Forced Colors treatment. The 44px owner stays transparent.
- Removed the History visual test's `PopupPageComponent` template override so geometry is measured through the production hierarchy.

## Verification

- Focused real mounted GREEN in the main worktree: 3 files, 46/46 tests passed:
  - `generator-send-ios27.visual.spec.ts`
  - `generator-history-page.component.spec.ts`
  - `official-credential-generator.component.spec.ts`
- Full Generator main-worktree run: 161/162 passed. The sole failure is the pre-existing user-dirty `official-i18n.service.ts` closure hash (`c34d…` working tree versus committed `8cd7…`); all functional and visual tests passed.
- Clean HEAD-plus-staged-delta snapshot exact guard: 17/17 passed.
- Clean snapshot updater ran twice before verification and once after both builds. Every run was zero-diff with manifest SHA-256 `9607cbe0fad94db80b324feb8deb9aa042ffbd596fac1516d7fdb9e038590287`.
- Clean snapshot `npm run typecheck:official-generator` passed at pinned upstream source `f47b6946e01aed474875789081966d311d5b8289`, including its 1,129-module embedded web build.
- Separate clean snapshot `npm run build:web` passed with 1,129 modules transformed and repository-baselined warnings only.
- As documented in Tasks 2 and 3, running real Angular suites from an archive snapshot with a symlinked `node_modules` reproduces the infrastructure-only duplicate component ID / `NG0401` failure before five test files collect. Therefore real mounted behavior/visual evidence comes from the main worktree, while the clean snapshot owns the exact guard, updater idempotence, typecheck, and builds.
- Cached allowlist before commit: this report, the mounted visual spec, and exact Generator-only hunks from `global.css`. Unrelated Auth CSS, i18n, AutoFill, and all other user-owned dirty changes remain unstaged and preserved.

## Execution constraints

- No browser, Playwright, or Computer Use automation was used.
- No subagents were used.
- No retained template, manifest, transform, or pinned vendor source changed.
