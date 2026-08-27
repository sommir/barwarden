# Task 7 Product Design QA

## Result

Passed. No actionable P0, P1, or P2 visual findings remain for the live contextual Login-detail state.

## Evidence

- Source: a local 1122 x 1402 reference capture, normalized through the existing `task-6-reference-480x600.png` source capture.
- Actual implementation: `task-7-implementation.png` (genuine PNG, 480 x 600 CSS viewport), rendered from the real `VaultItemDetailPageComponent`, `OfficialLoginDetailComponent`, and `OfficialLoginCredentialsComponent` with application global CSS, official popup shell, existing design tokens, i18n, and BWI font icons.
- Full comparison: `task-7-comparison-full.png` (960 x 600; reference left, actual implementation right).
- State: zh-CN, Termius current application, high-confidence username/password Login form, exact selected active Login, main popup window, light appearance.
- Runtime cleanliness: zero browser warnings or errors in the final capture.

The temporary deterministic boundary supplied the real component with a live native context/session/candidate and retained Login item, then was deleted. It was not a separate prototype, did not replace application components, and did not enter production code.

## Combined comparison review

- Hierarchy: the source's current-app context, inferred target, grouped account content, and primary explicit fill action are carried into the existing detail journey as a compact contextual card immediately above Login credentials.
- Integration: the action card uses the same width, border, radius, spacing, foreground/background tokens, and official button treatment as adjacent actual detail cards. It reads as a temporary contextual capability, not a redesigned Login detail page.
- Typography: existing official/system type and weights remain intact. `Termius · 登录表单` is the card's clear primary line; `用户名` and `密码` are quieter supporting metadata; the primary verb remains prominent.
- Color: existing background, raised-surface, subtle-border, muted-text, and primary-action tokens reproduce the source's light cool/blue hierarchy without introducing a palette.
- Iconography: desktop, user, lock, and form glyphs are existing BWI assets. The same user/lock/clock language continues into compatible credential field actions. No emoji, custom SVG, raster substitute, or CSS-drawn asset is present.
- Density and layout: the 480 x 600 viewport shows the complete context card plus the beginning of credentials without crowding. Stable trailing action width leaves the title and field summary legible, and the existing fixed footer remains unchanged.

## Intentional differences from the picker source

- The selected source depicts the picker; Task 7 integrates its context/action hierarchy into the existing actual Login detail rather than reproducing picker search, grouping, or the superseded segmented selector.
- `填入登录表单` is explicit and localized, replacing the source's generic `填入`; all fill controls require an intentional click.
- The card is compact because the selected cipher is already known. Account searching and related/other candidate groups remain in the picker and are not duplicated on detail.
- The surrounding summary, credentials, official footer, copy/reveal, and existing item-detail order are preserved by requirement.

## Interaction and accessibility checks

- The real browser DOM exposes a named region `Termius · 登录表单` and an explicit `填入登录表单` button.
- Username and password field fill controls expose fixed `填入用户名` and `填入密码` names with BWI user/lock glyphs; no generic sign-in glyph remains.
- The DOM/action suite verifies that no native fill occurs before an explicit action click and that contextual per-field controls cannot reach the legacy plaintext field-fill callback.
- Normal navigation and all mismatched/stale routes render no contextual region; asynchronous route reuse cannot publish a late card.
- Existing password reveal, copy feedback, TOTP countdown, URI actions, custom fields, and footer controls remain present and keyboard-native.

## Severity audit

- P0: none.
- P1: none.
- P2: none.

final result: passed
