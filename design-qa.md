# Vault-home visual QA — iOS 27 foundations

## Evidence identity

- Selected target: `docs/superpowers/specs/assets/barwarden-ios27-ui-visual-target.png` (1122 × 1402 px).
- Structural references: `docs/ui-audit-2026-08-17/04-vault-main.png`, `09-search-results.png`, and `10-vault-dark.png` (each 480 × 600 px).
- Light implementation: `docs/superpowers/specs/assets/barwarden-ios27-vault-light-implementation.png` (480 × 600 px).
- Search implementation: `docs/superpowers/specs/assets/barwarden-ios27-vault-search-implementation.png` (480 × 600 px).
- Dark implementation: `docs/superpowers/specs/assets/barwarden-ios27-vault-dark-implementation.png` (480 × 600 px).
- Surface: native macOS Tauri popup, no browser and no device frame; the captures contain sanitized evidence-only values.

The evidence build used a temporary local capture harness to expose the hidden tray window, hold it at 480 × 600, and supply deterministic AutoFill candidates. Those harness changes were removed after capture and are not part of the implementation diff. A previously exposed real-vault window was not retained as evidence.

## Same-input comparison

The target and light implementation, then the search and dark reference/implementation pairs, were opened together in one visual comparison input. A focused second comparison included the final light capture with AutoFill rows, the search capture proving the section disappears, and the dark capture.

- Search is a quiet 12 px contextual surface, with focus feedback instead of a persistent gray pill.
- AutoFill suggestions sit directly below search. Their rows use continuous 52 px surfaces and capability-based username/password/TOTP actions; glyphs are blue, indigo, and orange without persistent button boxes.
- Entering `Calendar` removes the AutoFill section and produces a single compact continuous result row with no card gap, outer border, or radius, while preserving field actions and the generic overflow action. The recapture starts at scroll position zero and keeps the full title/add/pop-out/account header visible.
- Ordinary Vault rows and disclosure groups use fine separators with no shadowed card gaps. Secondary copy remains readable blue-gray.
- The dark capture keeps the same hierarchy while moving to the approved solid navy surface ladder; semantic action colors remain distinguishable.
- A separate bottom-scroll inspection confirmed the final `Example Support` row can rest fully above the bottom navigation.

The selected target shows TOTP on every illustrative suggestion. The implementation intentionally shows TOTP only when that item actually has a TOTP secret; this is the approved capability-based behavior rather than a visual mismatch.

## P0/P1/P2 history

| Round | P0 | P1 | P2 | Outcome |
| --- | --- | --- | --- | --- |
| 1 | Not assessed | Not assessed | Not assessed | Native capture initially blocked. |
| 2 | 0 | 0 | 0 | Passed after sanitized 480 × 600 light, search, dark, and bottom-scroll evidence was captured and compared. |
| 3 | 0 | 0 | 0 | Passed after the search result was flattened and recaptured with the complete header visible. |

## Verification context

- Focused search/visual/guard suite after the final review fixes: 94 tests passed.
- Full `npm test`: 250 files passed, 1 skipped; 3,730 tests passed, 8 skipped.
- Final web build: passed with only the recorded repository warning baseline.

final result: passed
