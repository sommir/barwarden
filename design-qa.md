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

---

# Interaction Task 7 native QA — 2026-08-20

Code Ready: **Yes**. Native QA: **BLOCKED**. Task 7 closure: **No**. Final result: **BLOCKED / not passed**.

Final reviewed code HEAD is `006c392cec45857b87e98365a78d5047324905a4` (tree `2c80c4168919d5f66df2dfcf777094a4006fc46b`). Independent code and requirements reviews report Critical 0 / Important 0. Fresh sequential gates: `typecheck:m14` and `build:web` exit 0; full Vitest has 3944 passes and only three expected dirty-worktree hash-lock failures. Native captures remain tied to the earlier `dc7d63a5` source and are not acceptance evidence for this final code HEAD.

The six retained first-round PNGs remain in the repository only as supplemental, non-authoritative preliminary observations. The image-producing visibility harness, packaged-app hash, and complete binary/app provenance are not recoverable, so none of the six files supports Task 7 P0/P1/P2 acceptance. The Send PNG is additionally invalid because it contains a full macOS title bar/traffic lights and a clipped bottom navigation. The Settings PNG is additionally invalid because it contains a red macOS close control although production is decorationless.

| State | Reference path(s) → implementation path | Same-input preliminary conclusion |
| --- | --- | --- |
| Auth email light | `docs/ui-audit-2026-08-17/01-login.png` → `docs/superpowers/specs/assets/barwarden-ios27-auth-implementation.png` | Hierarchy appeared aligned; supplemental only. |
| OTP populated/search | `docs/ui-audit-2026-08-17/04-vault-main.png` + `docs/superpowers/specs/assets/barwarden-ios27-ui-visual-target.png` → `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-light.png` | OTP hierarchy appeared aligned; supplemental only. |
| Vault detail | `docs/ui-audit-2026-08-17/05-vault-detail.png` → `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-detail.png` | Detail hierarchy appeared unclipped; supplemental only. |
| Generator default | `docs/ui-audit-2026-08-17/06-generator.png` → `docs/superpowers/specs/assets/barwarden-ios27-generator-implementation.png` | Result-first hierarchy appeared aligned; supplemental only. |
| Send populated | `docs/superpowers/specs/assets/barwarden-ios27-ui-visual-target.png` → `docs/superpowers/specs/assets/barwarden-ios27-send-implementation.png` | Invalid: title bar/traffic lights and clipped bottom navigation. |
| Settings main/system | `docs/ui-audit-2026-08-17/07-settings.png` + `docs/ui-audit-2026-08-17/08-appearance.png` → `docs/superpowers/specs/assets/barwarden-ios27-settings-info-implementation.png` | Invalid: red close control visible. |

Full matrix still requiring authoritative rerun: Auth email-light visual, keyboard order, validation, dark/lock/2FA/new-device/hint/account switcher; Vault populated base/detail and username/password/OTP quick actions, plus form/folders/archive/trash/history/dirty/destructive flows; OTP populated/search, copy/countdown, and tab focus restoration; Generator default/Copy/Generate/default options plus history/clear; Send populated list/search/filter/copy/navigation plus form/created/pending/late-owner; Settings main/system and compact 0 → 1 → 0 plus About/notices/licenses/long-document/back focus; real Accessibility permission Sheet; overlay Escape/focus trap/return; every-control Tab; VoiceOver; native 200%; light/dark/system; Increase Contrast/forced colors; Reduce Transparency; Reduce Motion.

The capture-only follow-up used exact HEAD `dc7d63a5fda323305c9e67c1048f6c39e517e3f7` plus the documented nine-file overlay and isolated Rust/Angular patches. Four uniquely identified signed binaries were built, but `sky.get_app_state` blocked for about 162.6 seconds despite the JavaScript timeout and returned no AX state or screenshot. Follow-up PNG count was 0. All temporary apps, processes, archives, and capture binaries were cleaned; TCP 1420 had no listener afterward.

Detailed hashes, bundle IDs, evidence rulings, and the complete outstanding matrix are in `.superpowers/sdd/2026-08-17-ios27-interaction-accessibility-qa/task-7-report.md` and `docs/superpowers/specs/assets/barwarden-ios27-interaction-native-provenance.md`.

P0/P1/P2: **not assigned for Task 7 acceptance**.

Task 7 final result: BLOCKED / not passed
