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

## Whole-plan final fix wave 2

### RED and real vendor cascade

- A follow-up review identified three remaining vendor-cascade defects. The mounted visual test was extended before production changes with the real retained utility contracts:
  - `bit-item-content.tw-py-2` contributes 8px top and bottom padding normally;
  - `bit-compact:tw-py-1.5` contributes 6px top and bottom in compact mode;
  - the retained `body2` and `helper` lines contribute 20px and 16px respectively;
  - every real `tw-truncate` ancestor contributes hidden overflow, nowrap, and ellipsis;
  - the mode labels use unequal one-line / three-line / one-line content at an independent 200% root scale.
- Strict mounted RED failed both selected real-page tests with 13 expected soft assertions:
  - History modeled to 56px normal (`2 + 8 + 20 + 16 + 8 + 2`) and 48px compact (`6 + 20 + 16 + 6`) instead of 48/44px.
  - The credential had three real `tw-truncate` ancestors between `bit-color-password` and `bit-item-content`; each remained clipped at 200%.
  - Mode intrinsic heights were `[44, 124, 44]`; `bit-toggle-group` used `align-items:center`, while toggle/radio/label/paint alignment stayed normal/auto, so all three owners and plates remained unequal.

### GREEN

- Cleared only the Generator History `bit-item-content` vertical padding. With the existing outer 2px normal / 0px compact row padding and the real 44px Copy owner, the actual model is now exactly 48px normal and 44px compact.
- Released `max-height`, overflow, nowrap, and ellipsis only for real `.tw-truncate` descendants inside Generator History rows. The credential, all intermediate retained wrappers, timestamp, safe row name, and Copy semantics remain intact, and long values can grow at 200%.
- Changed the real mode group, each toggle host, native radio, label owner, and painted first span to a stretch chain. The longest localized label now drives a common owner height of 124px and a common painted height of 120px in the hostile 200% fixture, while ordinary labels retain 44px owners with 40px normal / 36px compact painted minimums.
- No retained template, vendor source, transform, manifest, semantic role, label association, selection binding, or history behavior changed.

### Wave 2 verification

- Strict selected GREEN: 2/2 real mounted tests passed.
- Fresh focused mounted GREEN: 3 files, 46/46 tests passed.
- Full Generator main-worktree run: 161/162 passed; the sole failure remains the pre-existing user-dirty `official-i18n.service.ts` closure hash (`c34d…` versus committed `8cd7…`). All behavior and visual tests passed.
- Clean HEAD-plus-staged-delta snapshot guard: 17/17 passed.
- Clean snapshot updater ran twice before verification and once after both builds. Every run was zero-diff with manifest SHA-256 `9607cbe0fad94db80b324feb8deb9aa042ffbd596fac1516d7fdb9e038590287`.
- Clean snapshot `npm run typecheck:official-generator` passed at pinned upstream source `f47b6946e01aed474875789081966d311d5b8289`, including its 1,129-module embedded build.
- Separate clean snapshot `npm run build:web` passed with 1,129 modules and repository-baselined warnings only.
- The staged allowlist contains only this report, the mounted visual regression, and exact Generator hunks from `global.css`; unrelated Auth CSS, i18n, AutoFill, and every other user-owned dirty file remain unstaged.

## Whole-plan final fix wave 3

### RED

- The final narrow review found that a compact mode label owner remained 44px with only 2px top and bottom padding. Because the painted span stretches inside the label, its actual compact painted height was 40px and the 36px compact minimum never took effect.
- The real mounted model was extended before production changes and failed with four expected soft assertions:
  - compact 100% labels computed 2px/2px padding and `[40, 40, 40]` painted heights instead of 4px/4px and `[36, 36, 36]`;
  - compact 200% unequal one-line / three-line / one-line labels produced common 124px owners with 120px plates, leaving only 4px total inset;
  - the required compact result is common 128px owners, common 120px plates, and exactly 8px owner-minus-plate inset.
- Removing the compact padding rule returns all four failures, so the mounted regression is mutation-sensitive to this exact defect.

### GREEN

- Added one compact-only scoped declaration: real mode labels use 4px vertical padding in compact mode. Normal mode remains 2px per side.
- Compact 100% now measures three equal 44px owners with three equal 36px painted layers.
- Compact 200% lets the longest label drive three equal 128px owners and three equal 120px painted layers. Every owner remains exactly 8px taller than its plate, and all wrapping/no-clipping contracts remain intact.
- Strict selected GREEN: 1/1 passed. Fresh focused mounted GREEN: 3 files, 46/46 tests passed.
- Full Generator main-worktree run: 161/162 passed; the sole failure remains the user-dirty `official-i18n.service.ts` closure hash, and all behavior/visual suites passed.
- Clean HEAD-plus-staged-delta guard: 17/17 passed. The updater ran twice before verification and once after both builds with zero diff and manifest SHA-256 `9607cbe0fad94db80b324feb8deb9aa042ffbd596fac1516d7fdb9e038590287`.
- Clean `npm run typecheck:official-generator` passed at upstream pin `f47b6946e01aed474875789081966d311d5b8289`, including its 1,129-module embedded build. A separate clean `npm run build:web` also passed with 1,129 modules and repository-baselined warnings only.
