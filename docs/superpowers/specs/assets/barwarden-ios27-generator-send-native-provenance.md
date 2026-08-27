# iOS 27 Generator and Send native evidence provenance

- Historical attempted source: `fd22769461ff586ba356f6c47f90f86d81986b87` (superseded; not a valid future capture pin)
- Final capture source: **not yet pinnable**
- Runtime requested: native Tauri/WebKit, configured Barwarden window 480 × 600
- Fixture gate: `VITE_BW_VAULT_EVIDENCE=true`
- Fixture queries requested: `vaultEvidence=populated&generatorEvidence=history-copy-retry`, `sendEvidence=list-populated`, `sendEvidence=form-add`, `sendEvidence=created`
- Data policy: fixed credential-free synthetic providers only; no personal login, unlock, import, vault, or Send data was used
- Native acceptance: **BLOCKED, 0/5**

## Capture inventory

| File | SHA-256 | Result |
|---|---|---|
| `barwarden-ios27-generator-native-implementation.png` | — | Not created. |
| `barwarden-ios27-generator-history-native-implementation.png` | — | Not created. |
| `barwarden-ios27-send-list-native-implementation.png` | — | Not created. |
| `barwarden-ios27-send-form-native-implementation.png` | — | Not created. |
| `barwarden-ios27-send-created-native-implementation.png` | — | Not created. |

## Evidence status

The historical native attempt stopped before any valid interaction evidence or screenshot was produced. The Mac was locked, the workspace executable could not be safely identified as a Computer Use target, and the working runtime included unrelated dirty i18n and CSS changes. No PNG, hash, VoiceOver result, Chromium result, or personal-data fixture was fabricated.

The historical `fd22769461ff586ba356f6c47f90f86d81986b87` source pin is now superseded by later Generator/Send code fixes, including the final touch-target and More → Delete → confirmation focus-transfer corrections. It must not be reused or described as the unique capture source.

## Remaining blockers

The Generator/Send routes publish the producer hooks, but the interaction/accessibility plan's authoritative `PopupRouterCacheService.tabSnapshots` consumer is not yet implemented and integrated. Therefore this artifact cannot truthfully name a final clean capture HEAD or claim that the five-row native matrix is ready to capture.

Only after the interaction/accessibility plan is complete and all related code is integrated may a new native acceptance task select the final clean HEAD, record its exact 40-character commit, run all five matrices from that source, and replace the 0/5 inventory with verified 480 × 600 PNG hashes. Until then, native evidence remains blocked at 0/5 and no source commit is pinned for future capture.
