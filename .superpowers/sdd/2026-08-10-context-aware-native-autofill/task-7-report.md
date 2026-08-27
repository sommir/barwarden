# Task 7 Report — Contextual whole-form fill in Login details

## Status

Implementation and independent-review fixes are complete and ready for scoped re-review. An active Login opened from the contextual picker now carries the exact live native context into its existing official detail composition. The detail renders one explicit contextual form/field action above credentials and only the authorized username/password/TOTP field actions. All navigation, context, candidate, session, and route mismatches fail closed.

## Independent-review fix round 1

The first independent review identified two lifecycle gaps, both fixed with strict RED-to-GREEN coverage:

- A reused detail route could move `A -> B -> A` without burning the selected contextual session. A no-reprompt action already validating could consequently continue, and a protected batch receipt returned after navigation was not guaranteed to be canceled by the detail lifecycle. Item/route identity changes, initial admission mismatches, and every post-await identity mismatch now invalidate the context immediately and cancel the exact prepared action. The action service's one-shot state burns a late receipt exactly once before any fill.
- `VaultRepromptDialogComponent` closed on `verify() === false` without invoking its contextual cancellation continuation. A protected receipt could therefore remain outstanding after lock, account/session change, or protected-operation invalidation. A false/stale verification now invokes contextual cancellation exactly once when that continuation exists; the legacy dialog path keeps its prior non-canceling close semantics.

Review-fix RED evidence:

```text
npx vitest run \
  apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts \
  apps/menubar-tauri/src/app/vault/vault-reprompt-dialog.component.spec.ts
Test Files: 2 failed
Tests: 5 failed, 56 passed (61)
```

The five expected failures were: `A -> B -> A` session resurrection, navigation during no-reprompt validation, late protected batch receipt after navigation, exact receipt burn after `verify() === false`, and once-only dialog cancellation.

Review-fix GREEN and expanded regression:

```text
Test Files: 2 passed
Tests: 61 passed (61)

Test Files: 12 passed
Tests: 171 passed (171)
```

The expanded set includes detail, official Login credentials/detail, reprompt dialog/service, router cache/routes, context session, fill action, both guarded overlays, and retained i18n. `npm run build:web` passed with 1116 transformed modules and only the recorded baseline warnings. `git diff --check` passed with no output.

## Implementation

- `vault-item-detail-page.component.ts`
  - Admits the contextual card only for the exact selected active Login, exact main-window route, exact live native context/session, unexpired context-session snapshot, complete requested secrets, and unchanged candidate authorization matrix.
  - Revalidates route, window mode, item identity, native context, Agent account/generation/revision, and candidate authorization after asynchronous native validation, preventing a late result from publishing on a reused route.
  - Prepares whole-form and single-field actions through `AutoFillFillActionService`; there is no contextual plaintext release/paste/copy path.
  - Uses one mismatch sheet, one exact batch reprompt receipt, and the existing receipt-aware reprompt dialog. Cancel, outcome, invalidation, expiry, item replacement, back, pop-out, or destruction clears/burns the ephemeral context.
  - Maps success/partial/stale/unavailable outcomes to fixed localized messages.
- `official-login-credentials.component.{ts,html}` and `official-login-detail.component.{ts,html}`
  - Add a compact existing-token/card/button contextual action above the official Login credentials.
  - Use BWI `bwi-user`, `bwi-lock`, and `bwi-clock` field actions with fixed localized labels.
  - Render only the immutable live-context/candidate/authorization field intersection; contextual field clicks emit the detected action instead of the legacy detail fill path.
  - Preserve existing copy, reveal, TOTP countdown, URI, custom-field, history, and other item-type composition.
- `vault-reprompt-dialog.component.ts`
  - Adds a narrow once-only cancellation continuation so a protected contextual batch receipt is canceled when its dialog is dismissed.
- `official-i18n.service.ts`
  - Adds the fixed Login-form contextual label in zh-CN and en-US.
- Guarded manifests
  - Updated only the four local Login-detail runtime hashes and the retained recovery i18n hash through the repository updater; no closure, entitlement, or Tauri configuration changed.

## TDD evidence

Initial RED, before production implementation:

```text
npx vitest run apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.spec.ts
Test Files: 2 failed
Tests: 8 failed, 40 passed (48)
```

The failures were the new contract: no contextual card or primary/detail action existed, exact fail-closed behavior was absent, protected form continuation was not wired, and Login field actions still used the generic sign-in glyph.

A second deterministic RED exposed an authorization-intersection defect: a password-only native context still exposed username/TOTP detail actions and could reach the legacy fill callback.

```text
Test Files: 1 failed
Tests: 1 failed, 48 skipped (49)
```

The minimal fix gated visible field controls by the frozen context/candidate/authorization intersection and routed contextual field clicks through the detected native action service.

An asynchronous route-cache race was then established RED: if the route changed while native validation was pending, the late result incorrectly published the contextual card.

```text
npx vitest run apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts -t "does not publish a contextual action when the detail route changes during native validation"
Test Files: 1 failed
Tests: 1 failed, 49 skipped (50)
```

After a post-await exact route/window/item recheck, the same test passed `1/1`.

Final focused verification:

```text
npx vitest run \
  apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts \
  apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.spec.ts \
  apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.component.spec.ts \
  apps/menubar-tauri/src/app/vault/vault-reprompt-dialog.component.spec.ts \
  apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts \
  apps/menubar-tauri/src/app/app.routes.spec.ts \
  apps/menubar-tauri/src/app/autofill/autofill-context-session.service.spec.ts \
  apps/menubar-tauri/src/app/autofill/autofill-fill-action.service.spec.ts \
  apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/cipher-detail-overlay.guard.spec.ts \
  apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-overlay.guard.spec.ts \
  apps/menubar-tauri/src/app/official-ui/official-i18n.service.spec.ts
Test Files: 11 passed
Tests: 161 passed
Duration: 4.37s
```

Build and diff verification:

```text
npm run build:web
Result: passed; 1116 modules transformed; production bundle built in 7.33s.

git diff --check
Result: passed with no output.
```

The build emitted only the repository's existing baseline warnings for browser-externalized Node modules, retained Tailwind at-rules, plugin timing, and large chunks.

## Covered behavior

- Exact contextual-picker selection and active Login route only.
- Normal navigation, wrong cipher, archived/deleted/non-Login, missing required secret, wrong route, pop-out, expired context, stale target, and asynchronous route race fail closed.
- Exact context fingerprint and Agent account/generation/vault-revision validation.
- Whole-form and per-field explicit click with no submit, Return, Tab, AXPress, or login-button click.
- Exact context/candidate/authorization intersection for user/lock/clock actions.
- One mismatch confirmation, one exact protected batch receipt/reprompt, and receipt burn on cancellation.
- Fixed success, partial, stale, and unavailable outcomes with context burn.
- Existing copy/reveal/TOTP countdown and non-Login detail composition remain intact.

## Product Design QA

Detailed QA: `task-7-design-qa.md` (`passed`, no P0/P1/P2).

- Selected source: the local reference capture documented in `task-7-design-qa.md`.
- Actual implementation: `task-7-implementation.png` (genuine 480 x 600 PNG from the real `VaultItemDetailPageComponent` and official Login children).
- Combined comparison: `task-7-comparison-full.png` (960 x 600; selected source at left, actual Login detail at right).

The temporary deterministic native/candidate entry only supplied safe test boundaries to the real application component. It was removed after capture and is not a prototype or production path. The clean browser capture reported zero warnings or errors.

## Self-review

- Security: every contextual action reuses the exact immutable authorization scope; no secret is queried, released, copied, or filled by detail navigation itself; all contextual actions fail closed and become one-shot after outcome/invalidation.
- Async: every asynchronous validation and action is bound to the prepared object/session epoch, with a post-await route/window/item check; late native results cannot publish into a reused detail route.
- Accessibility: the contextual region has an accessible name, visible localized button labels, fixed per-field ARIA labels, decorative icons hidden, standard focus behavior, and no custom keyboard interception.
- Visual: existing official card/button/type/spacing tokens and BWI assets only; no custom SVG, invented palette, custom typography, or CSS-drawn icon.
- Scope: no browser-extension, OCR, app-specific rule, telemetry, model/cloud, Tauri config, entitlement, release, notarization, or Task 8 change.

## Concerns

No blocking concern. The review fix changes lifecycle behavior and tests only, so the previously passed visual evidence remains current and no new harness capture was warranted. Dark/increased-contrast behavior remains inherited from existing official tokens; signed native live-matrix validation remains explicitly deferred to Task 8.
