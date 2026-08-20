# Barwarden iOS 27–inspired Full UI Harmonization Design

**Date:** 2026-08-20

**Status:** Proposed for implementation

**Audit:** `docs/ui-audit-2026-08-20/README.md`

**Scope:** All 34 production component routes in `apps/menubar-tauri/src/app/app.routes.ts`

## 1. Purpose

Barwarden currently combines retained Bitwarden web components, page-specific macOS overrides, and accessibility-driven minimum sizes. Each layer is individually defensible, but together they produce inconsistent density, oversized visible controls, conflicting card/list patterns, and abrupt visual changes between routes.

This design replaces page-by-page correction with one shared contract for geometry, hierarchy, materials, feedback, and interaction. The target is a flat, restrained Apple-style menu-bar utility with iOS 27–inspired clarity and fluidity, adapted to a 480 × 600 macOS popover rather than copied from a phone interface.

The desired feeling is calm, compact, predictable, and trustworthy. Security data remains visually distinct, but chrome must not compete with it.

## 2. Success Criteria

The redesign is complete when:

1. All 34 production routes use one title, text, row, control, icon-action, spacing, and surface contract.
2. A 44px minimum hit target remains available without forcing every visible control to be a 44px solid rectangle.
3. Header and bottom navigation each occupy exactly 52px of visible layout height.
4. Normal and compact modes are visibly different but preserve readable text and safe hit targets.
5. The final content row, field, Sheet footer, and alert are never obscured by floating navigation.
6. Settings pages use a native preference mapping: label and explanation on the left, value or Switch on the right.
7. Vault, OTP, Generator, Send, Settings, Auth, and Document routes no longer introduce conflicting card and list grammars.
8. Default, loading, empty, no-results, failure, pending, disabled, focused, menu, Sheet, and destructive states remain usable.
9. Light, dark, and system themes plus reduced motion, reduced transparency, increased contrast, and forced colors remain supported.
10. Every route has a fresh 480 × 600 native WebKit screenshot after implementation, with no unresolved P0 or P1 visual/interaction defect.

## 3. Non-Goals

- Do not replace Angular, Tauri, Bitwarden SDK integration, routing, evidence providers, or retained upstream overlays.
- Do not redesign product information architecture or remove existing capabilities.
- Do not introduce a new component library or external UI dependency.
- Do not weaken focus, keyboard, VoiceOver, dirty-form, confirmation, or navigation ownership contracts.
- Do not convert the application into a literal iPhone UI. macOS pointer, keyboard, popover, menu, and window behavior remain authoritative.
- Do not absorb unrelated AutoFill, native host, i18n, evidence, or user-owned worktree changes.

## 4. Design Principles

### 4.1 Simplicity, not emptiness

Reduce chrome and repeated surfaces while preserving enough context to understand each action. Empty space must communicate grouping; it must not merely make pages longer.

### 4.2 One visible hierarchy

Each screen has one page title, one primary task, and at most one filled primary action. Secondary actions use text, ghost, or icon treatment. Dangerous actions are isolated in a bottom group or confirmation Sheet.

### 4.3 Continuous groups over stacked cards

Lists and settings use continuous rows with inset dividers. Forms use grouped fields without a card around every field. Cards are reserved for a genuinely self-contained summary, empty state, or status object.

### 4.4 Visible geometry is not hit geometry

The visible icon plate may be 28–32px while its interactive owner remains at least 44 × 44px. A field may paint a 36–40px capsule inside a 44px field container. A primary button keeps a 44px layout/interaction box and paints its 36–40px fill through an inset inner layer or pseudo-element. Focus rings belong to the visible control, while pointer and accessibility ownership remain on the interactive owner.

### 4.5 Immediate, restrained feedback

Pressed feedback starts on pointer-down. Selection, menus, Sheets, and alerts use the existing 160/180/200ms motion vocabulary. No decorative bounce is added. Reduced Motion replaces movement with opacity or immediate state change.

## 5. Shared Geometry Contract

### 5.1 Tokens

The token layer in `apps/menubar-tauri/src/styles/macos-tokens.css` will expose separate visible and interactive geometry:

| Token role | Normal | Compact | Notes |
|---|---:|---:|---|
| Minimum hit target | 44px | 44px | Never reduced |
| Header height | 52px | 52px | Base and secondary pages |
| Bottom navigation height | 52px | 52px | Includes icon and label |
| Single-line row | 44px | 44px | Settings and simple content |
| Double-line row | 48px | 44px | Title plus metadata |
| Visible input/select | 40px | 36px | Inside a 44px owner/container |
| Visible primary button | 40px | 36px | Owner remains at least 44px |
| Visible icon plate | 32px | 28px | Transparent owner remains 44px |
| Segmented control | 40px | 36px | One control, not three buttons |
| Horizontal page inset | 16px | 16px | Shared across every family |
| Group gap | 20px | 16px | Between semantic groups |
| Row horizontal inset | 12px | 12px | In continuous groups |
| Control radius | 10px | 9px | Inputs, plates, segmented controls |
| Group radius | 12px | 10px | Only when a group needs a surface |

Existing compatibility tokens may remain temporarily, but production selectors must migrate to semantic roles rather than treating `--mac-control-min-size` and `--mac-row-height` as universal visible dimensions.

### 5.2 Typography

| Role | Size / line height | Weight | Use |
|---|---|---|---|
| Page title | 17px / 22px | 650 | Header title |
| Section label | 12px / 16px | 600 | Upper-level grouping, secondary color |
| Row title / label | 14px / 18px | 550–600 | Settings and content rows |
| Body | 14px / 20px | 400–500 | Explanations and content |
| Secondary | 12px / 16px | 400–500 | Metadata, timestamps, hints |
| Data result | 18–20px / 24px | 500–600 | OTP, generated values, passwords |

Page titles use slightly negative tracking. Small labels may use a small positive tracking value. Passwords, OTP values, and generated credentials use the system monospace stack with tabular numerals where appropriate.

### 5.3 Color

- Window and scrolling surfaces use theme background tokens; nested white rectangles are removed.
- One low-contrast group surface may separate a semantic region from the page.
- Blue is reserved for the primary action, selection, and username/fill identity.
- Password and OTP actions retain their existing semantic theme colors, but color appears on the glyph or subtle hover plate rather than a permanently filled 44px square.
- Destructive red is shown only on destructive text/icon actions and confirmation Sheets.
- Disabled controls reduce contrast without retaining an active blue border.

## 6. Shared Page Architecture

Shell route: `/tabs`.

### 6.1 Header

`popup-header` owns a fixed 52px visible slot:

- 44px interactive Back owner with a 20px glyph.
- Centered 17px title independent of left/right action count.
- 44px interactive right-side owners with 20px glyphs and 28–32px visible hover/pressed plates.
- No duplicate Back action inside page content.
- Auth secondary routes use the same Header as other secondary routes; branding appears consistently without creating a second title row.

### 6.2 Scrolling region

`popup-page` owns page inset and safe areas. Individual pages do not calculate navigation overlap.

- Header content begins immediately below the 52px slot.
- Tabbed routes reserve `52px + 12px` bottom safe space.
- Secondary routes without bottom navigation use 16px bottom padding, or the shared sticky action footer height when present.
- Scrollbars never overlap visible content or fixed footer controls.

### 6.3 Bottom navigation

The floating tab switcher becomes a 52px material layer:

- 18px icon, 10–11px label.
- Selected state uses a light tint/indicator, not a large solid capsule.
- The layer remains translucent when transparency is allowed and becomes solid under Reduced Transparency or Increased Contrast.
- It never overlays the final content row because the shell owns the bottom inset.

### 6.4 Continuous groups

Lists, settings, account rows, and history use one group contract:

- No per-row outer radius or shadow.
- One optional outer group radius.
- Inset divider aligned after the leading icon/avatar where present.
- Single-line row 44px; double-line row 48px; compact double-line row 44px.
- Row actions appear on hover/focus when pointer context permits, but remain discoverable and keyboard reachable.

### 6.5 Form groups

Vault and Send forms share one form geometry:

- Label-to-control gap: 6px.
- Field-to-field gap: 12px normal, 10px compact.
- Section-to-section gap: 20px normal, 16px compact.
- Visible input/select: 40px normal, 36px compact.
- Text areas use content-driven height with a 72px minimum, not a generic 44/52px rule.
- Validation text is 12px and stays attached to its field.
- Optional/advanced groups use disclosure where it shortens the common task.
- Sticky footer has one filled Save action; Cancel is secondary; destructive actions are separated.

## 7. Family Designs

### 7.1 Auth

Routes: `/login`, `/lock`, `/2fa`, `/new-device-verification`, `/hint`, `/account-switcher`.

- Login, 2FA, new-device, and hint share one Auth shell and one form width.
- 2FA and new-device remove duplicate content-level Back actions.
- Hint regains the shared Header and uses one primary plus one quiet secondary action.
- Disabled primary actions use neutral fill/border and cannot resemble an enabled action.
- Lock remains the density reference: one primary method, alternatives as continuous rows.
- Account Switcher uses 48px account rows, 28–32px avatars, and one continuous action group.

### 7.2 Vault and OTP

Routes: `/tabs/vault`, `/new-item`, `/folders`, `/archive`, `/trash`, `/view-cipher/:id`, `/add-cipher`, `/edit-cipher`, `/clone-cipher`, `/cipher-password-history`, `/tabs/otp`.

- Vault and OTP use 48px information rows with compact metadata.
- Username/password/TOTP quick actions preserve their three distinct semantic actions and colors.
- Quick-action glyph plates are 28–32px inside 44px transparent owners.
- New Item uses one left-aligned row layout for Login, Card, Identity, Note, and Folder.
- Detail fields become continuous value rows; Copy/Fill actions remain adjacent to the affected value.
- Add/Edit/Clone share the form geometry and source context appears as title metadata, not another card.
- Password History uses a 48–52px two-line row with monospace value, 12px timestamp, and one quiet Copy action.
- Folder/archive/trash management actions do not permanently dominate the row.

### 7.3 Generator

Routes: `/tabs/generator`, `/generator-history`.

- Result-first composition remains.
- Result block targets 68–72px total visible height.
- Copy is the only filled action; Regenerate is a quiet icon action.
- Password/Passphrase/Username segmented control is 36–40px.
- Options use compact form rows; checkboxes remain checkboxes because they represent a multi-selection character set.
- History uses 48px rows with readable credential value, timestamp, and quiet Copy action.
- Clear History remains a secondary/destructive Sheet flow.

### 7.4 Send

Routes: `/tabs/send`, `/add-send`, `/edit-send`, `/send-created`.

- Empty state has one lightweight illustration/icon, one short explanation, and one Create action.
- Populated list uses 48px rows with View, Copy Link, and More actions.
- Add/Edit use the shared form geometry and Switch for preference-like booleans; true multi-choice fields remain checkboxes.
- Read-only Send detail uses compact label/value rows instead of vertically separated web-form labels.
- Created state keeps one short summary, a readable link treatment with middle truncation or controlled horizontal reading, one Copy primary action, and a quiet Close action.

### 7.5 Settings

Routes: `/tabs/settings`, `/vault-settings`, `/account-security`, `/settings-password`, `/autofill`, `/keyboard-shortcut`, `/appearance`.

- Every secondary Settings route includes `macos-page--settings-detail` and uses the same 16px grid.
- Preference rows use left-aligned label/description and right-aligned value, disclosure, Select, or Switch.
- Checkbox is not used for a single on/off preference.
- Appearance uses Language and Theme as standard value rows; Compact Mode, Motion, and Website Icons are Switch rows.
- Account Security places PIN, timeout, and timeout action in continuous groups; external Web Vault actions are a separate group.
- AutoFill maps mode and behavior to setting rows and keeps the permission action as a secondary button.
- Keyboard Shortcut recorder paints a 40/36px field while its recorder and clear owners retain 44px targets.
- Change Password is a compact handoff group, not a full-width form CTA floating in empty space.

### 7.6 Document and About

Routes: `/about`, `/third-party-notices`, `/third-party-licenses`.

- About uses a compact version summary, continuous information rows, and one consistent update/status presentation.
- Notices and Licenses use 14px/20px reading text and a stable 17px title.
- Long documents receive in-page search and a compact section/category navigator without obscuring the text.
- Returning from a document restores scroll and semantic focus through the existing route-cache contract.

## 8. Interaction Contract

### 8.1 Pointer and keyboard

- Pressed feedback begins on pointer-down and clears on cancel/release.
- Every interactive owner is at least 44 × 44px unless it is inline text with sufficient separation.
- Keyboard focus uses one 2px ring on the visible control, never both owner and child.
- Hover may reveal secondary row actions, but focus and touch contexts must still expose them.
- Back, Escape, dirty confirmation, transient detail return, focus restoration, and overlay stack behavior remain owned by the existing navigation services.

### 8.2 Motion

- Fast feedback: 160ms.
- Navigation/selection: 180ms.
- Sheet/material transition: 200ms.
- Movement is critically damped and has no decorative bounce.
- Reduced Motion removes transform movement and preserves short opacity/color feedback.

### 8.3 Feedback

- One status has one accessible announcement owner.
- Inline field errors remain near the field.
- Page-level recoverable errors use one compact alert strip.
- Confirmation failure stays inside the owning Sheet.
- Toasts do not overlap bottom navigation and do not contain secret data.

## 9. Accessibility Contract

- Preserve all existing semantic labels, including item name plus field name for Vault quick actions.
- Preserve active credential readability while preventing automatic secret announcements.
- Dynamic result announcements contain only localized counts/status, never IDs, names, passwords, OTPs, URLs, Send content, or notes.
- VoiceOver order follows the visual hierarchy: Header, primary content, contextual actions, sticky footer, bottom navigation.
- 200% text scaling may increase row height; content must wrap rather than clip.
- Forced Colors preserves selection, focus, danger, and primary/secondary distinctions.
- Reduced Transparency replaces blur with an opaque theme surface and visible border.
- Increased Contrast strengthens separators and focus without reintroducing shadows/cards.

## 10. Implementation Architecture

The migration is bottom-up:

1. Extend semantic tokens in `macos-tokens.css` and add shared geometry regression coverage.
2. Move Header, Page, Floating Tab Switcher, icon-action, group, and form geometry to shared selectors in `global.css`.
3. Adopt shared host classes and semantic hooks in route families.
4. Remove family-local overrides only after the shared contract covers their real mounted DOM.
5. Keep retained upstream authority and exact transforms truthful; regenerate only affected patches/manifests.
6. Validate each family independently before moving to the next.

The order is Foundation → Shell → Settings → Generator → Vault/OTP → Send → Auth → Document → full native QA. Each family must remain independently shippable and reviewable.

## 11. Testing Strategy

Every production change follows RED → GREEN → refactor:

1. Mount the real Angular owner or retained component.
2. Load production tokens and CSS into the computed-style fixture.
3. Assert visible geometry separately from hit geometry.
4. Assert normal and compact modes.
5. Assert focus-visible, reduced motion, forced colors, and wrapping where applicable.
6. Run the family behavior suites and overlay guards.
7. Run strict family typecheck and `npm run build:web`.
8. Capture fresh 480 × 600 native WebKit screenshots from installed/evidence states and compare against the approved contract.

No test may prove production geometry using a synthetic DOM that differs from the actual component hierarchy. Shared CSS tests must identify the real route host and real interactive owner.

## 12. Provenance and Dirty-Worktree Policy

- Work directly on `main`, per user instruction.
- Never reset, restore, overwrite, or stage unrelated user changes.
- For hot files such as `global.css`, `app.component.ts`, `app.visual.spec.ts`, Vault page files, and retained manifests, stage only exact task hunks.
- Each task ends in an independently reviewable commit.
- Generated retained output is changed only through the repository updater or exact transform workflow.
- A manifest commit must be self-contained against clean committed sources; dirty compatibility overlays remain unstaged.

## 13. Rollout and Review Gates

Each phase must pass three gates:

1. **Code gate:** focused tests, relevant family suite, strict typecheck, build, and diff checks.
2. **Design gate:** real 480 × 600 normal/compact screenshots, with layout, density, focus, and final-row visibility reviewed.
3. **Accessibility gate:** keyboard order, focus restoration, live-region ownership, 200% text, contrast, transparency, and reduced-motion checks appropriate to the phase.

If a shared token causes a family regression, the family receives an explicit scoped compatibility rule only when the shared role is genuinely different. Page-name overrides are not accepted as a substitute for a semantic role.

## 14. Final Acceptance Matrix

The final pass covers all 34 routes and at least these state families:

- Auth: email, master password, validation error, 2FA, new device, hint, lock, account switcher.
- Vault: populated, empty, no-results, stale/error, new item, detail, add, edit, clone, history, folders, archive, trash.
- OTP: populated, search/no-results, copy feedback, countdown, tab restoration.
- Generator: password, passphrase, username, options, history populated/empty/clear confirmation.
- Send: empty, populated, search/filter, add, edit/read-only, validation error, created, row menu, delete confirmation.
- Settings: main, each secondary page, system/light/dark, compact off/on, permission Sheet where naturally available.
- Documents: About, update states, notices, full licenses, search, long-text navigation.

Final status remains **Design Ready: No** until the entire matrix is re-captured and no P0/P1 defect remains.
