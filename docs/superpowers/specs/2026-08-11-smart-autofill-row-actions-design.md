# Smart AutoFill Row Actions

Date: 2026-08-11

## Goal

Make the macOS AutoFill picker communicate what each Login can provide without asking the user to choose a field that Barwarden has already detected. The picker must use the current focused-field or form context to decide what the single primary action fills.

## Selected design

- Remove the standalone detected-field chip above search. Detection remains available to assistive technology through the existing live region, but it is not repeated as visible chrome.
- Each Login row shows a compact, read-only capability group immediately before its primary action:
  - user icon when a username is available and authorized;
  - lock icon when a password is available and authorized;
  - clock icon when a TOTP value is available and authorized.
- Keep the icons in canonical username → password → TOTP order. Missing fields produce no icon. The group has one localized accessible label and the individual icons are decorative.
- Replace field-specific primary labels such as “填入用户名” and “填入登录表单” with one localized “填入” label.
- Clicking “填入” uses the immutable live context already captured for the picker:
  - a recognized username/email field releases only username;
  - a recognized password field releases only password;
  - a recognized one-time-code field releases only TOTP;
  - a recognized form releases exactly the detected canonical field sequence.
- The row body continues to open Login details. Capability icons do not release a secret and are not separate buttons.

## Fail-closed behavior

- Field capabilities come only from the current encrypted projection and current field-scoped Agent authorizations.
- A primary action is available only when the detected action fields are all present and authorized for that candidate.
- Low-confidence `choose` context is not silently guessed. It may expose the existing explicit fallback actions only when native recognition cannot produce a safe automatic action; no generic “填入” action releases a secret in this state.
- Context, account, generation, revision, candidate, mismatch, and reprompt validation remain unchanged and atomic.

## Visual rules

- Reuse the existing Bitwarden icon library (`bwi-user`, `bwi-lock`, `bwi-clock`) and current picker typography, spacing, borders, focus treatment, and color tokens.
- The capability group and “填入” remain readable at the 480×600 popup size, do not overlap long candidate names, and retain high-contrast/reduced-motion behavior.
- Treat each candidate as one continuous interactive surface. Pointer hover, keyboard highlight, focus-within, and selected state apply one uninterrupted background and one outer outline across the Login body, capability icons, and “填入” action.
- The row body and trailing action area must not draw separate borders, radii, or opaque backgrounds that visually cut the highlighted row into pieces. Individual buttons may retain a subtle local hover/focus affordance, but it must remain inside the continuous outer row treatment.
- The selected visual reference is the user-provided Termius picker screenshot annotated on 2026-08-11.

## Verification

- Component tests must first fail when the visible context chip remains, capability icons are filtered down to only the detected field, or the primary label is field-specific.
- Interaction tests must prove one “填入” click sends the exact recognized field scope for username, password, TOTP, and form contexts, with no plaintext fallback.
- Tests must cover missing candidate fields, low-confidence fail-closed behavior, keyboard activation, and accessible capability labels.
- Interaction and rendered QA must verify that moving between the row body, capability area, and “填入” action never breaks the candidate highlight, and that keyboard highlight/focus uses the same continuous outer surface.
- Render the real Angular picker at 480×600, compare it side by side with the selected screenshot, and run the focused suites, recovery/command guards, and production web build before completion.
