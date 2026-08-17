# Auth/Account final review fix report

## Outcome

All four final-review findings are covered by real Angular rendered-DOM contracts and the scoped production cascade. The retained lock authorities remain pinned and unchanged; only named local transforms, runtime hashes, and the external manifest digest were updated.

Native visual QA remains blocked at **0/16** for the previously recorded app-identity/attachment reason. Chromium/Playwright was not authorized for this loop and was not run.

## Finding 1 — complete lock method hierarchies

- **RED:** `npx vitest run apps/menubar-tauri/src/app/auth/lock-page.component.spec.ts -t "complete zero-gap row hierarchies"` failed first because the biometric primary action was outside `lock-unlock-methods`; after moving it, the real PIN state exposed `lock-switch-biometric` resolving to the generic `var(--mac-control-min-size)` declaration instead of an explicit 44px row.
- **GREEN:** the same real `OfficialLockComponent` fixture now traverses biometric → PIN → master-password and proves, for every state, one filled primary, transparent flat alternatives, wrapper `display:flex`, column direction, `gap:0`, full-width 44px rows, stable test-id order, and the projected switch-account row in the same child method hierarchy.
- **Production:** biometric primary moved inside `macos-unlock-methods`; PIN/master retained templates replaced `tw-space-y-3` with the same zero-gap wrapper and project the unchanged switch-account link into that wrapper. `lock-switch-biometric` now shares the 44px transparent flat-row rule.
- **Provenance:** pinned authority bytes and revision were not modified. `auth-lock-overlay.guard.spec.ts` derives all three runtime templates from the same authority fragments with named transforms. The three runtime SHA-256 values and `official-master-password-lock.transform-manifest.json` external digest were updated without bypassing the hash guard.
- **Focused GREEN:** lock component + authority guard: **43/43**.

## Finding 2 — 44px touch targets

- **2FA remember-device RED:** the real `TwoFactorPageComponent` label computed to **24px** while its visual checkbox was 24px.
- **2FA remember-device GREEN:** the enclosing clickable label computes to **44px**, the checkbox remains 24px, and clicking the label toggles the real form checkbox.
- **Environment RED:** the real official menu overlay rendered all three menu items at **36px**.
- **Environment GREEN:** environment menu items carrying the retained `aria-pressed` selection contract compute to **44px**. The rule is scoped to selectable environment-style menu items rather than widening every application menu.

## Finding 3 — login focus outline

- **RED:** after a real `focus()` on `login-continue-button`, JSDOM reported the default `outlineWidth: medium` because it does not activate the production `:focus-visible` selector.
- **GREEN:** the test confirms the button is the real `document.activeElement`, loads the full production token/global cascade, locates the production focus rule through CSSOM, and exposes that rule through a test-only focus-visible selector. Computed longhands are exactly `2px`, `solid`, and `2px` offset.
- **Production:** the existing 2px tokenized outline shorthand was split into equivalent width/style/color longhands so the real production cascade remains testable even when JSDOM cannot resolve the custom-property shorthand.

## Finding 4 — real challenge hierarchy coverage

- **RED mutation check:** with only the production challenge primary minimum mutated from 44px to 43px, the new real `OfficialTwoFactorComponent` contract failed on `two-factor-continue: 43px`; the production value was then restored.
- **GREEN:** real two-factor and new-device page fixtures prove the retained `tw-flex tw-flex-col tw-space-y-3` and `tw-grid tw-gap-3` wrappers, visible-button order/conditions, one filled tokenized 44px primary, and transparent 44px accent/secondary alternatives with 1px dividers. The prior synthetic cascade probe remains unchanged and continues to verify precedence against a deliberately different generic control token.
- **Scope:** no two-factor or new-device retained template, event, API, manifest, or spacing utility changed.

## Verification

- Focused touched specs and overlay guards: `npx vitest run ...` — **9 files, 165/165 passed**.
- Expanded auth + auth-overlay run: `npx vitest run apps/menubar-tauri/src/app/auth apps/menubar-tauri/src/app/upstream-overlays/auth` — **35 files, 611/611 passed**.
- Exact completion command from final review — **33 files, 604/604 passed** (baseline 600; four new contracts).
- `npm run typecheck:official-login` — passed.
- `npm run build:web` — passed with the existing accepted warnings (browser-compatible Node externalization, retained Tailwind at-rules, plugin timing, and chunk-size advisory).
- Staged diff checks are recorded in the commit handoff after precise staging.

## Scope protection

- No upstream authority file changed.
- No public component input/output, method event, test id, error/attempt behavior, or retained challenge spacing utility changed.
- The large pre-existing dirty worktree was preserved. In particular, unrelated authentication-root edits already present in `global.css` are excluded from this fix commit through interactive hunk staging.
