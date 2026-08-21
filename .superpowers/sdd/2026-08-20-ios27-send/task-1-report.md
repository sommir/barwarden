# Send Task 1 report

## Scope and provenance

- Base: `e771323f5b5b0a4001a66cef2754b4fe618657ee` on `main`.
- Preflight index: empty.
- Retained Send list and list-items remain static transforms in
  `official-send-member-transforms.ts`; no HTML patch mode was added.
- Upstream revision remains
  `f47b6946e01aed474875789081966d311d5b8289`; authority pins did not drift.
- Unrelated dirty work was left unstaged. Only the final Send-specific
  `global.css` block was staged from that shared file.

## Delivered contracts

- Mounted populated Send rows use the flat double-row role: 48px normal,
  44px compact, no card gap/radius/shadow/double inset.
- Rows and their text containers grow instead of clipping at 200% text.
- New, Filter, Empty Create, View, Copy, More, and portal Delete owners retain
  at least 44 by 44px hit geometry.
- View uses the shared 32/28px icon plate; Filter, Copy, and More paint pointer
  and keyboard feedback on their real 32/28px icon-button plate.
- The row contains no `menuitem`; Delete remains in the official CDK portal
  Menu. Menu selection restores the real More owner before opening the Delete
  Sheet, and Cancel/Escape restore the same More owner after Sheet teardown.
- `send:search`, `send-item:<id>`, `:copy`, and `:more` remain structural and
  secret-free. Same-count result announcements remain count-only.
- Icon owners have hover, pressed, disabled, keyboard-only single-ring,
  Reduced Motion, and Forced Colors states.

## TDD evidence

- Initial mounted RED: the row lacked `macos-row`/`macos-row--double`, was
  52px, and Empty Create lacked the shared hit-target role.
- Plate RED: the mounted View action lacked a real shared icon plate.
- Guard RED: an accidental edit to the transform search side caused exact
  application to report zero matches; the authority search was restored and
  only the replacement carries the new role.
- Final focused result: 4 files passed, 111 tests passed.

## Updater and verification

- `npm run update:official-send-manifest` ran twice after each transform
  correction; the second run was byte-stable.
- A final updater run against `HEAD + staged delta` produced zero unstaged
  changes in Send runtimes, patches, transforms, or manifest.
- `npx vitest run` for Send behavior, Generator/Send visual coverage,
  official Send list behavior, and the Send overlay guard: 111/111 passed.
- `npm run typecheck:official-send`: passed, including pinned upstream check,
  upstream/local typechecks, and its production web build.
- Independent `npm run build:web`: passed. Output retained the repository's
  accepted Tailwind-at-rule, browser externalization, and chunk-size warnings.
- `git diff --cached --check`: passed.
