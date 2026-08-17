# Versioned Background Suggestion Sync Implementation Plan

> **Goal:** Make the menu-bar count and the vault suggestion list consume the same accepted native background observation, while avoiding duplicate refreshes when the popup opens.

> **Design:** `docs/superpowers/specs/2026-08-17-versioned-background-suggestion-sync-design.md`

## Task 1: Publish accepted native observations with a revision

**Files:**
- Modify: `apps/menubar-tauri/src-tauri/src/suggestion_count.rs`

1. Add monitor tests proving that an accepted observation publishes its tray title before its revision, an accepted same-count observation still publishes a newer revision, and a stale observation publishes neither.
2. Run the focused Rust tests and confirm the new tests fail for the missing revision behavior.
3. Change the context sink from `Fn()` to `Fn(u64)` and expose the current revision.
4. Remove pre-query context notifications and publish the revision only after an accepted result or authoritative clear/error.
5. Run the focused Rust tests and keep existing generation/retry behavior green.

## Task 2: Deliver revisions to hidden WebViews and popup entry

**Files:**
- Modify: `apps/menubar-tauri/src-tauri/src/window.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/main.rs`

1. Add window tests for the revision-bearing context event and popup-entry payload.
2. Run the focused Rust tests and confirm they fail because the payload is absent.
3. Dispatch `barwarden:suggestion-context-changed` without a visibility gate, carrying the `u64` revision as a decimal string.
4. Include the monitor's current revision string in every popup-entry event.
5. Wire the monitor revision sink to the window dispatcher and run focused Rust tests.

## Task 3: Consume revisions without duplicate frontend refreshes

**Files:**
- Modify: `apps/menubar-tauri/src/app/app.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/app.component.ts`

1. Add component tests proving duplicate revisions refresh once, a missed higher revision catches up on popup entry, invalid/missing revisions only force the initial load, and a newer revision arriving during a refresh is processed afterward.
2. Run the component tests and confirm the new tests fail for the current unconditional/open-only behavior.
3. Add strict decimal-string revision decoding and component state for highest pending revision, consumed revision, initial-load need, and serialized refresh execution.
4. Route background events and popup-entry events through one coordinator; only refresh while unlocked on the main vault route.
5. Reset initial-load state when the vault becomes unavailable or locked, and retry an unconsumed revision after a failed refresh.
6. Run the component and autofill-context tests.

## Task 4: Verify the complete behavior

**Files:**
- Verification only

1. Run Rust tests for `suggestion_count` and `window`.
2. Run the frontend component/autofill integration tests.
3. Run the full frontend and Rust test suites and type/build checks used by the signed packaging flow.
4. Review the diff to ensure no unrelated dirty-worktree changes were altered.

## Task 5: Build and install the signed app

**Files:**
- Build artifacts only

1. Build with the repository's signed native-autofill packaging script and the existing Developer ID identity.
2. Verify the app bundle with strict code-signature validation.
3. Back up the currently installed app, install the new bundle, and compare hashes/signatures.
4. Launch and verify that background target changes update the badge and cached suggestion list together, and opening the popup at the same revision causes no second refresh animation.
