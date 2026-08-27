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

## Scoped review fix

- Replaced the visual test's manually assigned page class with the real
  `SendAddEditPageComponent` route host and retained wrapper for add and
  read-only states.
- Save's real inset paint is mutation-protected at 40/36px across default,
  hover, pressed, native/ARIA disabled, keyboard focus, and Forced Colors;
  the owner remains transparent and the visible paint owns the only ring.
- Generate, Copy Password, Delete, and Remove Password retain exact commands
  and now expose localized BitIconButton labels. Delete and Remove use a
  danger plate that resolves to the Forced Colors `Mark` system color.
- The nested Text Details section now owns the required 12/10px rhythm.
- Read-only mode has an explicit retained page marker and renders real
  field wrappers as compact label/value rows with zero group gap, preserved
  readonly values, 44px minimum owners, and growing unclipped 200% content.
- Final scoped gate passed 129/129; official Send typecheck and independent
  web build passed. The updater was rerun twice after all retained changes.

## Final read-only value fix

- Read-only fields now paint a dedicated wrapping semantic value owner with
  `role="textbox"`, `aria-readonly="true"`, and one keyboard stop instead of
  exposing the single-line native control as the visible value.
- The real BitFormField-required source control is reduced to a 1px clipped,
  `aria-hidden`, `tabindex=-1` implementation source. It is not a second AT
  owner; the password source is always empty and the visible value says only
  that the Send is password protected.
- Long Send names, text, notes, and other values use auto height, visible
  overflow, normal/preformatted wrapping, and no maximum height in normal,
  compact, and 200% states. A real two-line value model exceeds 44px without
  clipping.
- Editing controls remain real inputs/selects and are mutation-protected at
  exact 40px normal / 36px compact minimum paint.
- Final focused gate passed 129/129; official typecheck and both production
  build invocations passed. The updater was rerun twice after retained output
  changed.
