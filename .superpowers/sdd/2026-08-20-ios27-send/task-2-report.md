# Send Task 2 report

## Scope and provenance

- Started on `main` at
  `8ccacc47bdf8fe0a802c60f5645b83fc0b1b4f6a` with an empty index.
- Used only the existing retained Send static-patch pipeline. No transform
  mode, rewrite command, or authority pin was added or changed.
- Kept unrelated dirty work unstaged, including `official-i18n` and all
  non-Send `global.css` hunks.

## Delivered contracts

- Real add/edit/read-only field owners are at least 44px and use the actual
  Bitwarden field-container wrappers.
- Text inputs and selects paint at a 40px normal / 36px compact minimum while
  retaining auto height, unbounded maximum height, and visible overflow for
  200% text. Textareas retain a 72px minimum.
- Send form groups are flat and shadowless, have no card or double inset, and
  use 12px normal / 10px compact field rhythm.
- Hidden Text and Hide Email are real 44px `role=switch` owners with retained
  boolean `valueChange` outputs. No multi-choice checkbox was converted.
- Save is the only filled primary in edit mode. Its owner remains 44px and the
  shared inset paint remains 40/36px; Cancel/Edit stay secondary.
- Generate, Copy Password, Remove Password, and Delete owners remain at least
  44px with 32/28px icon plates and one keyboard-only plate ring. Hover,
  pressed, disabled, Reduced Motion, and Forced Colors states remain scoped to
  the visible plate.
- The max-access helper remains visible through invalid state; the custom
  error uses `aria-errormessage` while the real vendor hint continues to own
  `aria-describedby`, then the error relationship clears after correction.
- Dirty Back/Cancel/Escape, first-invalid focus, pending/disabled owners,
  policy, stale continuation handling, mutation outputs, and retries remain
  owned by the existing page/service/operation code.
- A mounted pending transport regression confirms the real operation owner
  publishes Save `aria-busy`, disables Save and Cancel through `aria-disabled`,
  and clears busy state after the transport settles.

## TDD evidence

- Mounted RED showed zero semantic field owners, zero Switch owners, old 44px
  painted controls, missing Save hierarchy, and missing suffix plate roles.
- Behavior RED showed the old checkbox transport and the max-access error was
  not semantically associated while its helper remained visible.
- Minimal runtime hooks and scoped CSS turned the focused mounted and behavior
  suites green without changing command outputs.

## Updater and verification

- `npm run update:official-send-manifest` ran twice; the second manifest and
  patch hashes were byte-identical.
- Final focused Send page/form service/operation/visual/guard gate passed
  128/128, including the pending-ownership regression.
- Post-CSS-move visual/guard gate passed 21/21.
- `npm run typecheck:official-send` passed, including pinned upstream check,
  upstream/local typechecks, and its production web build.
- Independent `npm run build:web` passed with only the repository's accepted
  Tailwind-at-rule, browser externalization, and chunk-size warnings.
