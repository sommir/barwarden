# Vault AutoFill Reference Restyle

Date: 2026-08-11

## Goal

Make the vault-integrated AutoFill suggestion section look and behave like the selected Bitwarden-style vault reference instead of a visually separate custom card. Preserve the existing context, ranking, authorization, reprompt, and exact native fill behavior.

## Source of truth

- Primary list reference: `/var/folders/7t/mr61cc1x54s6t56gf074z6980000gn/T/codex-clipboard-f6281f22-aea8-4ec5-ad18-1588cf372d67.png`.
- Multi-result density reference: `/var/folders/7t/mr61cc1x54s6t56gf074z6980000gn/T/codex-clipboard-182af5e5-4276-4b52-8119-3ad349fe45ff.png`.
- Detail reference: `/var/folders/7t/mr61cc1x54s6t56gf074z6980000gn/T/codex-clipboard-4026f695-c952-4445-a734-db89dc195121.png`.
- Existing Barwarden vault rows, section headers, tokens, BWI icons, keyboard semantics, and retained popup components remain the implementation design system.

## Selected approach

Use the retained vault list's official item-group visual language inside the AutoFill suggestions component. Do not duplicate the retained row component directly because its quick actions release legacy plaintext fields and its overflow menu exposes unrelated item mutations. Instead, compose the same official `bit-item`, `bit-item-content`, `bit-item-action`, vault icon, typography, spacing, border, and focus primitives around the existing secure contextual action.

## List composition

- The section occupies the same horizontal inset and vertical rhythm as Favorites and All Items.
- The header uses the same section-heading size/weight and a muted trailing count.
- Candidate rows are one official item group with shared rounded outer corners and normal row dividers.
- Each row is 59 px in normal density and follows the existing compact-mode floor when applicable.
- The leading icon is the real vault item icon at the same 28 px slot used by normal Login rows.
- Primary and secondary copy use the same retained row typography, truncation, and baseline.
- The secondary line is `username · fixed localized reason`, omitting the separator when username is blank.
- Capability glyphs appear in canonical username, password, TOTP order using the existing `bwi-user`, `bwi-key`, and `bwi-clock` assets.
- The primary action is a compact outlined `填入` button, not a filled blue pill and not a text link floating outside the row.
- No copy or overflow action is added to the suggestion row because the contextual section has one primary job and the row body already opens full detail.

## Interaction states

- Hover, keyboard highlight, focus-within, and selected treatment cover the entire row surface continuously.
- The official group owns the outer border and corner clipping; no inset left bar or separate per-row blue rectangle is used.
- Focus-visible uses the existing primary inset ring and must not be clipped or broken around the Fill action.
- Row body opens detail. Fill stops propagation and executes the existing detected-field/form action.
- Enter/Space on the Fill button must not trigger row navigation.
- Busy state disables only the current Fill button and preserves row geometry.
- Forced colors and reduced motion use existing official behavior; no new animation is introduced.

## Detail composition

Keep the existing contextual detail action behavior. Restyle its card only where necessary to align with the list reference: official card border/radius, compact context line, and a full-width primary AutoFill action using existing button primitives. Do not rearrange normal Login credentials or footer actions.

## Responsive and accessibility requirements

- Target viewport: 480 × 600 CSS px, device scale factor 1.
- No horizontal overflow at 420–520 px popup widths.
- Long names and usernames truncate before capability/actions; controls never compress below their accessible hit target.
- The section is a named region/list. Each row has one details label, one hidden capability summary, and one Fill button label including the Login name.
- Decorative BWI icons are hidden from assistive technology.

## Verification

- Test official item primitives, exact row structure, canonical capability icons, fixed action placement, continuous hover/focus surface, no legacy quick-copy/menu controls, and long-content truncation.
- Preserve all action, mismatch, reprompt, stale-context, and route tests.
- Render the real Angular vault at 480 × 600 with the selected reference state.
- Compare source and implementation side by side and repeat until no actionable P0/P1/P2 differences remain.
- Run focused Vitest, full Vitest, production web build, diff check, signed local build, install replacement, and installed-process/Agent/provider verification.

## Scope boundaries

- No matching or authorization policy changes.
- No native protocol, Rust, Swift, entitlement, provider profile, or browser-extension changes.
- No redesign of the vault header, search, filters, favorites, all-items, bottom navigation, or item detail outside the contextual AutoFill surfaces.
- No custom SVG, image asset, gradient, emoji, or CSS-drawn icon.

## Self-review

- The visual target, exact primitives, row density, action hierarchy, responsive behavior, accessibility, and verification gate are explicit.
- The design avoids the unsafe legacy quick-copy behavior while still matching the retained row appearance.
- No placeholder or deferred visual decision remains.
