# Send Whole-Plan Final Fix Report

## Scope

- Bound the real Send filter select to the facade-owned type filter so disclosure teardown does not reset its value.
- Recover an invalid Created Send owner by replacing the route with `/tabs/send`; copy remains unavailable and no Send value is rendered.
- Replace 59px loading placeholders with flat 48px rows and 44px compact rows.
- Exercise the real `RouterOutlet` lifecycle across Send list, add, and created components, including delayed search-focus restoration.
- Make editing single-line input/select/combobox paint geometry exact at 40px normal and 36px compact.

## TDD evidence

- Initial focused RED: 3 files, 105 tests; 6 expected failures (Filter 1, Created recovery 3, skeleton 1, form paint 1).
- Focused GREEN: 3 files, 105 tests passed.
- Real-router lifecycle RED: 2 expected focus-restoration failures; GREEN after observing the real `afterNextRender` lifecycle: 2 passed.

## Verification

- Full Send gate: 14 files, 226 tests passed.
- `npm run typecheck:official-send`: passed, including pinned upstream guard and web build.
- Independent `npm run build:web`: passed with the accepted warning baseline.
- `npm run update:official-send-manifest`: clean staged state was run twice after staging; both runs ended with zero Send overlay diff.

## Dynamic-type control follow-up

- Replaced fixed 40/36px heights on mounted Send editing controls and the Filter select with `height: auto`, retained 40/36px minimums, and rem-based font, line-height, and block padding.
- The mounted geometry model remains exactly 40px normal and 36px compact at 100%, then grows above the compact minimum at 200% without hidden overflow or scroll clipping.
- Regression tests failed when `height: auto`, either minimum, or the rem scaling declarations were independently mutated, then returned green after each restoration.
- Final focused tests passed, the full Send gate passed 226 tests, the updater ran twice with zero overlay diff, and typecheck/build passed.

## Custom select ownership follow-up

- Real mounted DOM coverage now treats `bit-select` as the transparent 44px owner, `.ng-select-container` as the only 40/36px painted layer, and resets the intervening `ng-select` plus internal combobox input to zero padding/minimum height.
- At 200% the painted container and composite owner grow without clipping; restoring padding on the outer layers produced the expected focused RED before the final GREEN.
