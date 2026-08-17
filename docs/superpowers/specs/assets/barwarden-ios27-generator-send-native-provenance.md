# iOS 27 Generator and Send native evidence provenance

- Source commit: `fd22769461ff586ba356f6c47f90f86d81986b87`
- Runtime requested: native Tauri/WebKit, configured Barwarden window 480 × 600
- Fixture gate: `VITE_BW_VAULT_EVIDENCE=true`
- Fixture queries requested: `vaultEvidence=populated&generatorEvidence=history-copy-retry`, `sendEvidence=list-populated`, `sendEvidence=form-add`, `sendEvidence=created`
- Data policy: fixed credential-free synthetic providers only; no personal login, unlock, import, vault, or Send data was used
- Native acceptance: **BLOCKED, 0/5**

## Capture inventory

| File | SHA-256 | Result |
|---|---|---|
| `barwarden-ios27-generator-native-implementation.png` | — | Not created; native window could not be safely attached. |
| `barwarden-ios27-generator-history-native-implementation.png` | — | Not created; native window could not be safely attached. |
| `barwarden-ios27-send-list-native-implementation.png` | — | Not created; native window could not be safely attached. |
| `barwarden-ios27-send-form-native-implementation.png` | — | Not created; native window could not be safely attached. |
| `barwarden-ios27-send-created-native-implementation.png` | — | Not created; native window could not be safely attached. |

## Exact blocker and safety boundary

The evidence Vite server successfully listened on `127.0.0.1:1420`, and the exact Generator native command launched the workspace executable at `apps/menubar-tauri/src-tauri/target/debug/barwarden` after retrying outside the filesystem/network sandbox. Computer Use was initialized through `node_repl` and `@oai/sky` as required, but application inventory returned `The Mac is locked and automatic unlock could not unlock it`. Direct read-only attachment by the exact workspace executable path returned `Invalid app` even while that process was running.

`/Applications/Barwarden.app` was independently observed running as PID 39517. Attaching by the shared display name or bundle identifier could therefore target the installed app, so those fallbacks were not used. The previously built unique QA bundle was not reused because it predates this source/query run and cannot establish Task 7 provenance. No window was opened or operated, VoiceOver was not enabled, no screenshot picker was invoked, and no Chromium/Playwright fallback was used.

The workspace Tauri process and evidence server were stopped. A final process/port inventory found no workspace `target/debug/barwarden` process and no listener on port 1420; the installed application was left untouched.
