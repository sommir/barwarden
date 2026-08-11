# Vault-integrated AutoFill

Date: 2026-08-11

## Goal

Remove the standalone AutoFill picker experience and make AutoFill a contextual capability of the normal vault. When Barwarden has a safe live field or form context, the vault list shows a temporary “自动填充建议” section and Login details show a contextual “自动填充” action. Without a valid match, the normal vault remains unchanged.

## Selected architecture

Keep the existing native field detection, encrypted projection, candidate ranking, authorization, mismatch confirmation, reprompt, receipt, and exact-write pipeline. Move only the presentation and entry orchestration:

- a vault-scoped contextual AutoFill service owns the immutable entry context, Agent session, ranked candidates, expiry, invalidation, and action preparation;
- the vault list consumes a read-only suggestion projection from that service;
- the Login detail page consumes the same candidate/session/context binding;
- the existing fill-action service remains the only frontend authority that prepares an exact field or form action;
- native code remains the only authority for releasing secrets and writing exact detected fields.

The standalone picker component may remain temporarily as an internal compatibility surface while migration tests are completed, but `/autofill-picker` is no longer a product destination and no entry point navigates to it.

## Entry behavior

Floating action, menu-bar AutoFill, and the configured shortcut all:

1. capture the exact current target application, window, focused field/form, observer generation, account, projection generation, and revision;
2. enable or recover the AutoFill service if needed;
3. navigate to `/tabs/vault` with replace semantics;
4. publish the captured context to the vault-scoped contextual service;
5. query ranked candidates for the captured context.

An ordinary vault open does not create a context, query Agent candidates, enable AutoFill, or display suggestions.

The legacy `/autofill-picker` route redirects to `/tabs/vault`. It does not preserve a stale picker context by itself.

## Vault list presentation

### Suggestion section

When at least one candidate passes the safe display threshold, render a first-class vault section below search/filter controls and above favorites/all-items hierarchy:

- title: `自动填充建议`;
- trailing count: number of visible suggestions;
- maximum: five candidates;
- order: native match score descending, then the existing deterministic candidate tie-break;
- included: exact, relevant, and approved fuzzy/name matches above the threshold;
- excluded: low-score “other” candidates, archived/deleted/non-Login items, candidates missing the required detected fields, and stale/invalid authorizations.

The section is completely absent when there are no suggestions. Do not render an empty placeholder, warning, divider, or count of zero.

Ordinary search continues to search the complete vault. Suggestions are contextual and remain a separate top section; they are not duplicated into a second contextual result set when search text changes. Existing favorites, folders, types, and all-items sections retain their current behavior and ordering.

### Suggestion row

Reuse the retained vault row composition and existing Bitwarden icon library/tokens. Each row contains:

- the existing favicon/type icon, Login name, username, and fixed localized match reason;
- a read-only capability group in canonical order: username (`bwi-user`), password (`bwi-lock`), TOTP (`bwi-clock`), showing only fields the candidate actually has and is authorized to release;
- one context-aware primary action labeled `填充`;
- existing copy and overflow actions where the underlying retained row already exposes them.

The Login body opens detail. Capability icons are informational, never individual secret-release buttons. The row body, capability group, and Fill action form one continuous hover/focus/selected surface with a single outer border and focus outline.

### Fill behavior

The `填充` action never asks the user to choose username/password/TOTP when native detection is confident:

- username/email field → username only;
- password field → password only;
- one-time-code field → TOTP only;
- recognized form → exact canonical detected field sequence, up to the existing native maximum.

For safe fuzzy/name matches, the existing mismatch confirmation remains mandatory. Reprompt-protected items reuse the existing master-password/Touch ID receipt flow. Low-confidence choose mode does not silently guess; it may expose existing explicit field actions only in a dedicated confirmation surface, not through the generic Fill button.

## Detail presentation

Opening a suggested Login carries only the short-lived, exact candidate/session/context binding. The detail page validates route cipher ID, active account, generation, revision, target app instance, window/field fingerprints, and expiry before showing contextual actions.

When valid, the Login summary card shows a full-width `自动填充` primary button. The button fills the exact detected field or form using the same fill-action service as the suggestion row. The existing per-field user/lock/clock actions remain available only for fields present in both the Login and current detected context.

When invalid, expired, switched to another item, opened in a popout, or entered from an ordinary vault browse, contextual AutoFill controls are absent. Existing view/copy/edit/archive/delete behavior remains unchanged.

## State, invalidation, and concurrency

The contextual service exposes one immutable snapshot containing target context, Agent session, ranked suggestions, loading/error state, and epoch. Every asynchronous step captures the epoch and revalidates it after awaits.

The snapshot is invalidated and all pending actions/receipts are burned on:

- target app/window/focused field or observer generation change;
- account, projection generation, or vault revision change;
- vault lock, logout, account switch, setup disable, or Agent lock;
- route leaving vault/detail, popup close, candidate replacement, or 30-second expiry;
- action cancellation, mismatch cancellation, reprompt failure, partial native failure, or component destruction.

Late candidate/query/receipt/fill results cannot republish suggestions or write a secret after invalidation. At most one current contextual action may own a receipt.

## Loading and failure behavior

- Candidate loading does not replace or block the vault. The suggestion section may show a compact skeleton only after the existing anti-flicker delay.
- No match is a normal state: omit the section.
- Agent/setup/context failure is fail-closed and does not expose technical error text or a stale section. Existing fixed recovery UI is shown only when entry setup specifically requires approval/repair.
- Fill failures use existing sanitized feedback. The vault and item detail remain usable.
- A successful fill hides the popup and burns the context. Reopening AutoFill requires a fresh target capture.

## Accessibility and visual behavior

- Suggestions use a labeled section/list and announce the count once through the existing polite live region.
- Each row has one accessible Login label, one localized capability summary, and a Fill button whose label includes the Login name.
- Capability icons are decorative; their group carries the accessible summary.
- Keyboard order follows normal vault order. Arrow/list navigation and Enter/Space behavior must not be intercepted by descendant action controls.
- Hover, focus-within, keyboard highlight, and selected state use the same uninterrupted outer row treatment.
- Reuse official spacing, typography, border, foreground/background, high-contrast, reduced-motion, light/dark, and 480×600 popup tokens. Do not create new gradients, custom SVGs, or screenshot-derived assets.

## Compatibility and route migration

- Remove navigation to `/autofill-picker` from popup entry handling.
- Keep a redirect route during the migration so stale internal navigation lands safely on `/tabs/vault`.
- Do not change native protocol shapes, production entitlements, signing configuration, browser extension behavior, or system Credential Provider behavior.
- Do not duplicate the matching algorithm in the vault frontend; it consumes the existing ranked Agent response.

## Testing and verification

### Component/service contracts

- entry sources navigate to `/tabs/vault`, never `/autofill-picker`;
- ordinary vault entry performs zero candidate/context queries;
- zero matches renders no suggestion section;
- one to five ranked suggestions render in native order with exact counts;
- more than five candidates are capped deterministically;
- suggestion rows show correct username/password/TOTP capability icons and one generic Fill action;
- Fill emits the exact detected field scope for username, password, TOTP, and form contexts;
- fuzzy matches require confirmation; cancellation releases nothing;
- row body opens detail while Fill never navigates;
- detail contextual action appears only for the exact selected candidate and live session;
- lock/account/revision/target/route/expiry/destroy races remove suggestions, burn receipts, and produce zero late writes;
- keyboard, accessible labels, continuous hover/focus, high contrast, and reduced motion remain correct.

### Regression and visual gates

- preserve the existing native query/release/write race and privacy tests;
- run focused vault list, retained row, detail, context session, fill action, AppComponent entry, route/cache, command/recovery guard suites;
- run full Vitest, Rust, native contract/XCTest where touched, production web build, formatting, and diff checks;
- capture the real Angular vault list and detail at 480×600 in the same states as the three selected references;
- compare reference and implementation side by side and resolve every P0/P1/P2 before completion.

## Non-goals

- no new matching algorithm or score policy;
- no new multi-secret wire response;
- no browser-specific field adapters, OCR, pixel reading, or application-name hardcoding;
- no new system AutoFill extension behavior;
- no release notarization or lower-macOS runtime claim.

## Self-review

- No placeholders or deferred product decisions remain.
- The recommendation cap, fuzzy confirmation, empty-state omission, entry route, detail behavior, invalidation rules, and test evidence are explicit.
- Matching, authorization, and exact native writes remain single-source; the design does not duplicate security logic in presentation components.
