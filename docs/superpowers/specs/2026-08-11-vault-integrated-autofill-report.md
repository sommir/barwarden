# Vault-integrated AutoFill Implementation Report

Date: 2026-08-11

## Outcome

AutoFill is now a contextual capability of the normal vault rather than a standalone destination. Dedicated AutoFill entries initialize the existing native context and ranking pipeline, then open `/tabs/vault`. The vault conditionally inserts an `自动填充建议` section above favorites/all items, and selecting a suggestion carries the exact short-lived binding into the existing Login detail AutoFill card.

## Delivered behavior

- Removed the standalone picker component from production and redirected the compatibility route to the normal vault.
- Added an immutable vault-context service with epoch, account/generation/revision/target revalidation, selection, expiry, and invalidation.
- Kept ordinary vault entry inert: it performs zero AutoFill context, session, or candidate calls.
- Added a conditional suggestion section with at most five eligible Agent-ranked Login candidates.
- Added username/password/TOTP capability glyphs and one generic context-aware `填入` action per row.
- Kept fuzzy/name mismatch confirmation, reprompt verification, exact detected-field/form authorization, and native secret/write boundaries unchanged.
- Made row body navigation and Fill independent: opening detail never releases a secret; filling never navigates.
- Reused the existing contextual Login-detail card and per-field actions for the selected candidate.
- Invalidated late or stale work on target, account, revision, lock, navigation, expiry, cancellation, and destruction.
- Preserved the retained vault header import boundary by mounting the contextual section through a generic vault extension slot.

## Verification

- Focused integration gate: 151 passed, 1 skipped.
- Full Vitest after the reference restyle: 3,649 passed, 22 skipped, 0 failed.
- Native AutoFill contract gate: 3 passed.
- Production web build: passed (1,118 modules; only existing baseline warnings).
- Product Design QA: passed at 480 × 600 with combined source/implementation comparisons and zero final browser warnings/errors.
- `git diff --check`: passed.

Rust, Swift, native protocol, entitlements, signing, browser-extension behavior, and production Tauri configuration were not changed, so their platform suites were not rerun for this presentation-only migration.

## Evidence

- Design: `docs/superpowers/specs/2026-08-11-vault-integrated-autofill-design.md`
- Plan: `docs/superpowers/plans/2026-08-11-vault-integrated-autofill.md`
- QA ledger: `design-qa.md`
- Vault implementation: `docs/superpowers/specs/2026-08-11-vault-autofill-list-restyled.png`
- Vault comparison: `docs/superpowers/specs/2026-08-11-vault-autofill-restyle-comparison.png`
- Focused row comparison: `docs/superpowers/specs/2026-08-11-vault-autofill-restyle-focus-comparison.png`
- Continuous hover evidence: `docs/superpowers/specs/2026-08-11-vault-autofill-list-hover.png`
- Detail comparison: `docs/superpowers/specs/2026-08-11-vault-autofill-detail-comparison.png`

## Residual boundaries

- Suggestions remain fail-closed and only appear after an explicit AutoFill entry captures a live native context; opening the vault normally does not guess a target.
- The vault consumes the existing Agent ranking result and deliberately does not duplicate or broaden matching logic.
- Low-confidence choose mode never guesses through the generic Fill action.

## Reference restyle

The suggestion section was rebuilt after visual feedback against the supplied vault references. It now composes the same official section, item group, item content, item action, typography, button, and real vault-item icon primitives as the retained vault list. The previous custom icon tile, custom bordered list, inset blue selection bar, and disconnected row chrome were removed. Username, password, and verification-code capabilities use the canonical BWI user/key/clock glyphs, while the generic Fill action remains the only secret-release control. A genuine 480 × 600 browser render, full comparison, focused comparison, continuous hover capture, and zero-error console check are recorded in `design-qa.md`.
