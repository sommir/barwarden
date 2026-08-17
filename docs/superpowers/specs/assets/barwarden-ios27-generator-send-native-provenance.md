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

## Independent source-reproducibility blocker

The native session also failed the capture precondition independently of Computer Use. At startup, the uncommitted working copy of `official-i18n.service.ts` had SHA-256 `f54d1fce406c5f88c8146ca36b3d6e071c256e6254f1d77b994b7f51166e1d66`, while the Task 6 source and committed Generator manifest record `3db4b593328849b8a210286aad2bc881b0abe2784897a91fdf312a0f8a89f209`. `global.css` also contained uncommitted user hunks. Those runtime/style differences mean that even an unlocked Mac would not make this working tree valid for reproducible native capture against the source commit above.

Because attachment stopped at 0/5 and no PNG was created, no dirty-runtime image or stale hash entered the evidence set. After the user unlocks the Mac, all five native matrix rows must be rerun from a clean isolated checkout of `fd22769461ff586ba356f6c47f90f86d81986b87`, `e6e0365890380d1fec09fdf7da28a6fe4c1b10ab` (runtime-equivalent), or an equivalent clean source containing neither dirty i18n/runtime content nor the uncommitted `global.css` hunks. The Vite/Tauri processes from this attempt were stopped and must not be reused.

The workspace Tauri process and evidence server were stopped. A final process/port inventory found no workspace `target/debug/barwarden` process and no listener on port 1420; the installed application was left untouched.
