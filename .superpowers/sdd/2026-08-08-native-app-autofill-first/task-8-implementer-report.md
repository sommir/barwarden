# Task 8 implementer report — conservative Accessibility floating action

## Outcome

Task 8 adds a fail-closed macOS 13 Accessibility floating action for the narrow case where system AutoFill is explicitly known to be unsupported. System AutoFill remains the default and preferred path: the controller starts stopped, and the native observer cannot display anything until the main app explicitly selects the `unsupported` fallback. Menu and global-shortcut access to the Task 7 picker do not depend on Accessibility; copy remains the final fallback already owned by Task 7.

The reader accepts only a live external application and a focused editable `AXTextField` or `AXSecureTextField` with a current, finite, positive, fully visible frame and valid window. It rejects Barwarden-owned windows, missing or malformed application identities, stale elements/windows/snapshots, labels and other roles, non-editable fields, empty screens, zero/negative/non-finite/offscreen/oversized geometry, and system-AutoFill-available-or-unknown state.

## Privacy and diagnostics

The Accessibility boundary copies only focused element, role, subrole, position, size, and window. Editability is obtained only by asking whether `AXValue` is settable; `AXValue` itself is never copied or read. The reader never requests selected text, placeholder, title, description, identifier, or any other field content. The native allowlist has a regression test, and the implementation carries an explicit no-value-read comment at the only `AXValue` reference.

Diagnostics serialize only an enumerated fixed reason and an optional validated bundle ID. They contain no application name, field text, label, placeholder, or arbitrary native error. Both Rust and TypeScript reject unrecognized diagnostic shapes and reasons.

## Observer and lifecycle

One dedicated worker thread creates each `AXObserver`, installs its source on that thread's current CFRunLoop, and registers exact notifications for application focused-element changes plus focused-element/window move, resize, and destruction. The registration owns the callback `Arc` refcon. Drop first removes the run-loop source and every notification, then releases focused/window/application/observer references, so callbacks cannot outlive the refcon. Workspace activation and termination notifications are installed on the AppKit main thread.

Permission loss, a different exact application instance, application termination, a destroyed/stale element or window, invalid geometry, and picker opening invalidate the generation, clear the stored application/frame, and schedule an immediate main-thread hide. The 50 ms throttle coalesces bursts, while every main-thread show callback checks its captured generation before publishing. A 250 ms lifecycle probe also catches permission or process changes when an observer notification is absent.

The review hardening makes every observer/workspace callback synchronously invalidate the controller generation and consume the visible snapshot before it merely marks a later refresh dirty. Observer registration is installed before the focused-field read, and the generation/dirty state is revalidated around that read to close the lost-event window. `AXObserverCreate` and every required notification add now fail the whole registration; partial registrations are unwound. One registration is reused for the same application across rejected focus and bounded liveness probes, so periodic checks do not recreate observers or repeat ordinary AX field reads.

## Panel and picker entry

The 28-point AppKit panel is borderless and uses `NonactivatingPanel`; it is never made key or main, becomes key only if needed, ignores the normal window cycle, joins all spaces, and is created/shown/hidden only on the main thread. Its fixed Barwarden template-icon button hides the panel, invalidates the field snapshot, and opens Task 7's existing picker with the fixed `autofill-floating` entry source. The click never queries a candidate, releases a secret, fills a field, or submits anything.

The panel click now carries the exact visible generation plus the observed bundle ID, PID, and retained `NSRunningApplication` identity. It atomically consumes only that visible snapshot, then verifies the same retained instance is still live and frontmost before injecting the original Task 7 target context. It never recaptures or substitutes a different frontmost application. The icon is explicitly marked as an `NSImage` template so light/dark/high-contrast appearance remains system-controlled.

AX top-left global coordinates are converted to AppKit bottom-left coordinates before selecting the containing `NSScreen`. Placement uses the screen's visible work area, prefers the field's trailing exterior, falls back to the leading exterior, clamps only vertically, and hides when neither exterior placement is safe. It never overlays the field insertion area.

## TDD evidence

RED was observed before each implementation slice: missing focused-field types and classification; geometry conversion/placement; lifecycle generation/throttle; permission prompt separation; observer notification matrix; exact Tauri command mapping and decoder; fixed diagnostic validation; and AppComponent's `autofill-floating` route. The native implementation was added only after the pure contract tests were green. A live fixture attempt subsequently exposed that Accessibility constants in the SDK are header macros rather than linkable global symbols; replacing those declarations with fixed `CFString` names made the real Rust test binary link, while preserving the same privacy allowlist.

Review-fix RED was separately observed for synchronous callback invalidation/exact click consumption, create/add-notification fault injection, the process-lifetime permission prompt gate, malicious diagnostic bundle IDs, copied-AX wrong-type rejection/release, and the native template-image contract. These tests became GREEN only after the corresponding runtime paths were hardened. Permission status remains read-only; only the first explicit request may call the prompt API, concurrent/repeated requests return the same fixed denied outcome without prompting, and an already-trusted process never prompts.

Every copied AX CoreFoundation object is now type-checked before conversion: focused element/window against `AXUIElementGetTypeID`, role/subrole against `CFStringGetTypeID`, and geometry against both `AXValueGetTypeID` and the exact CGPoint/CGSize `AXValueType`. Wrong types fail closed and release exactly once. Rust and both TypeScript decoders use the same strict ASCII, segmented, 255-byte bundle-ID validator; newline, NUL/control, unpaired Unicode, malformed segments, and oversize inputs are rejected or redacted before diagnostics are constructed.

## Verification

- Focused Rust: floating review contracts 20 passed, 2 explicit live smokes ignored.
- Full Rust: 248 passed, 7 ignored. The additional ignores are explicit read-only live Accessibility/fixture smokes; existing signed Agent, Touch ID, and Keychain/live tests remain gated.
- Focused TypeScript: Accessibility service and Tauri host 67 passed.
- Full TypeScript: 3,512 passed, 22 skipped across 237 files.
- Swift/Xcode: 130 passed, 0 failed. Result bundle: `/private/tmp/barwarden-task8-review-fix-unrestricted/Logs/Test/Test-BarwardenNativeAutoFill-2026.08.09_08-33-08-+0800.xcresult`.
- Native project/build-wrapper checks: 17 passed; identity/contract checks: 19 passed.
- Production web build: passed with the existing externalization, Tailwind, and chunk-size warnings only.
- `cargo check`, `cargo fmt --check`, retained runtime-closure guards, and `git diff --check`: passed.

## Live smoke and limitations

Denied permission was tested with a fresh standalone application bundle (`com.sommir.barwarden.ax-denied-smoke-20260809`) that called only `AXIsProcessTrusted()` and returned `denied`; it did not call the prompt API or modify TCC. The Rust test process already had Accessibility permission, so the explicit granted read-only smoke passed without requesting or expanding authorization.

The granted read-only smoke was rerun after the review hardening and passed again without calling the prompt API. The prior denied helper result remains the denied live evidence; no TCC state was changed during this review fix.

An external, non-sensitive AppKit fixture containing one secure text field was compiled and launched for the requested observer/panel smoke. In three bounded attempts the execution environment continued reporting `com.apple.loginwindow` as the frontmost application and never activated the fixture. Consequently focus-to-reliable-snapshot, live observer invalidation, nonactivating panel display, move-following, and fixture-close hide could not be exercised end to end here. They are recorded as blocked, not passed; the permission probe is not presented as a substitute. Automated contracts cover all of those state transitions and panel properties, but no live panel-show success is claimed.

No production Tauri configuration or entitlement changed. Browser integration, fallback configuration UI/policy, packaging/signing, and installation remain outside Task 8.
