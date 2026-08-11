# Vault AutoFill Reference Restyle — Product Design QA

## Source truth and rendered evidence

- Source list truth: `/var/folders/7t/mr61cc1x54s6t56gf074z6980000gn/T/codex-clipboard-182af5e5-4276-4b52-8119-3ad349fe45ff.png` (1060 × 1300 PNG).
- Supporting single-result truth: `/var/folders/7t/mr61cc1x54s6t56gf074z6980000gn/T/codex-clipboard-f6281f22-aea8-4ec5-ad18-1588cf372d67.png` (1060 × 1300 PNG).
- Supporting detail truth: `/var/folders/7t/mr61cc1x54s6t56gf074z6980000gn/T/codex-clipboard-4026f695-c952-4445-a734-db89dc195121.png` (1060 × 1300 PNG).
- Browser-rendered implementation: `docs/superpowers/specs/2026-08-11-vault-autofill-list-restyled.png` (480 × 600 PNG).
- Hover-state implementation: `docs/superpowers/specs/2026-08-11-vault-autofill-list-hover.png` (480 × 600 PNG).
- Full-view comparison: `docs/superpowers/specs/2026-08-11-vault-autofill-restyle-comparison.png` (960 × 600 PNG; normalized source left, implementation right).
- Focused suggestion comparison: `docs/superpowers/specs/2026-08-11-vault-autofill-restyle-focus-comparison.png` (900 × 338 PNG; normalized source left, implementation right).
- Existing real detail evidence: `.superpowers/sdd/2026-08-10-context-aware-native-autofill/task-7-implementation.png` (480 × 600 PNG).

## Normalization and state

- Source captures were normalized from 1060 × 1300 to a 480 × 600 comparison viewport with a centered crop; the source and implementation therefore share the same visible canvas and 1× comparison density.
- Implementation CSS viewport: 480 × 600, device scale 1.
- State: zh-CN, light appearance, four live ranked Login suggestions, username/password/TOTP capabilities, one retained vault hierarchy below.
- The implementation screenshot is a genuine browser render of `VaultListPageComponent`, `VaultAutoFillSuggestionsComponent`, official item primitives, real `VaultItemIconComponent`, global application CSS, BWI icon font, and deterministic boundary data.
- Final browser console check: zero warnings and zero errors.

## Findings and comparison history

### Iteration 1 — blocked

- **P1 — Suggestions looked like a separate custom widget.** The previous implementation used a custom bordered list, custom icon tile, disconnected row shadow, and a blue inset selection bar. It did not share the retained vault row system and visibly drifted from the supplied list references.
- **P2 — Password capability icon was semantically wrong.** The old row used `bwi-lock`; the product and reference vocabulary use the key glyph for a password value.
- **P2 — Context block lacked the source's surface hierarchy.** White suggestion rows sat directly on the white page, so grouping and row boundaries were too weak.

### Fixes applied

- Replaced the custom list with official `bit-section`, `bit-section-header`, `bit-item-group`, `bit-item`, `bit-item-content`, and `bit-item-action` components.
- Replaced the generic custom icon tile with the real `VaultItemIconComponent` used by the retained vault list.
- Changed capability order and glyphs to username (`bwi-user`), password (`bwi-key`), then verification code (`bwi-clock`).
- Used the official compact `primaryOutline` button for the single detected `填入` action.
- Added the existing alternate surface token behind the contextual block so official white rows read as one distinct suggestion group.
- Removed custom split selection chrome. The official item hover now paints one continuous full-width row, verified in the hover capture.
- Kept row-body detail navigation and the single detected-field/form fill action behavior unchanged.

### Iteration 2 — passed

- Full-view and focused comparisons show the same hierarchy as the source: section heading/count, vertically grouped suggestions, real item identity, compact inline action, and a clearly separated following vault section.
- The implementation deliberately retains Barwarden's existing header/search/navigation instead of copying unrelated reference-app chrome.
- It also retains the user's requested username/password/TOTP capability icons; the source's copy and overflow actions are intentionally omitted because this row is an AutoFill recommendation, not a mutation menu.

## Required fidelity surfaces

- **Fonts and typography:** Existing Inter/BW typography remains intact. The heading uses official `h6`; row title and helper text use the official item typography and truncate without wrapping.
- **Spacing and layout rhythm:** Official 59px vault row height, standard 12px horizontal section inset, official action gaps, radius, divider, and elevation are shared with retained vault items. Four rows remain readable in the 480 × 600 viewport.
- **Colors and tokens:** Only existing `background`, `background-alt`, `text-main`, `text-muted`, `primaryOutline`, hover, focus, and border tokens are used. No ad hoc palette or gradient was introduced.
- **Image and icon fidelity:** Login icons use the real favicon/fallback component. All UI glyphs use the existing BWI library. No handcrafted SVG, CSS illustration, emoji, or screenshot-derived UI asset exists.
- **Copy and content:** `自动填充建议`, fixed localized match reasons, count, and `填入` match the supplied flow. Capability semantics are exposed once to assistive technology.

## Interaction and accessibility verification

- Suggestion row body opens Login details and does not fill.
- `填入` derives the detected field or form and does not navigate.
- No live context means no suggestion section.
- Maximum five Agent-ranked eligible suggestions; invalid/missing local Login data remains excluded.
- Mismatch confirmation, reprompt, cancellation, and stale-action invalidation remain covered by the focused component tests.
- Hover paints the entire row continuously; keyboard focus is owned by official item focus handling.
- Long item names and subtitles truncate; capability icons are decorative with one screen-reader summary.

## Severity audit

- P0: none.
- P1: none after iteration 2.
- P2: none after iteration 2.
- P3: the reference includes unrelated folder/type filters and bottom navigation that are intentionally not copied into Barwarden's existing vault shell.

final result: passed
