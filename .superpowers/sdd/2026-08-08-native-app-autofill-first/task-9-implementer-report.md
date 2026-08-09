# Task 9 implementer report — native release gate tooling

## Outcome

Task 9 is **BLOCKED**, not released. Reusable native release tooling, fixture tests, a real unsigned overlay build, and sanitized partial evidence are implemented. Production `tauri.conf.json` and production `Entitlements.plist` were not promoted or modified.

The release builder uses a temporary native overlay, builds the main app and the two sidecars independently, embeds the Credential Provider at `Contents/PlugIns`, the Agent at `Contents/Helpers`, and the LaunchAgent metadata at `Contents/Library/LaunchAgents`. It consumes the signing identity, main-app profile, Credential Provider profile, signing Keychain, and notarytool Keychain profile only through environment references. Command output is discarded rather than persisted; outward diagnostics are fixed codes only.

Signing is inside-out: Agent, Credential Provider, then main app. Each inner component's exact designated requirement is verified before the app is signed. The builder never uses `codesign --deep` for signing; deep operation is verification-only. It submits an app archive, staples the app, creates the final DMG, submits and staples the DMG, then invokes the strict independent verifier.

## Strict verifier

The verifier requires exactly these signed native components:

- `com.sommir.barwarden`
- `com.sommir.barwarden.credential-provider`
- `com.sommir.barwarden.autofill-agent`

It rejects missing, duplicate, or unexpected executable/nested code; wrong paths, Team or bundle identifiers; unsigned/ad-hoc inner code; non-Developer-ID outer code; missing hardened runtime; wrong macOS floor; invalid designated requirements; missing or extra App Groups; every Keychain access group; unexpected entitlements; invalid or expired Developer ID profiles; an unsealed outer app; a non-exact DMG inventory; mismatched DMG/app contents; absent app or DMG tickets; missing notarized Gatekeeper source; and failed app/DMG Gatekeeper assessment.

The app and both inner components must carry exactly `group.com.sommir.barwarden.autofill`. Only the Provider may carry App Sandbox and the AutoFill Credential Provider entitlement. Every target must have an empty Keychain group set and a macOS 13.0 floor. The app and Provider profiles must be Team `K7LY92JY96` Developer ID distribution profiles granting only the exact bundle/application-group boundary required by that target; on macOS the verifier requires `com.apple.application-identifier` and rejects the iOS-style `application-identifier` key.

[Apple Technical Note TN3125](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles) states that a standalone executable has no place to embed a provisioning profile and therefore cannot claim a restricted entitlement. The current Agent is an Xcode command-line tool embedded as a raw Mach-O executable while claiming the App Group entitlement. The builder now detects that exact source shape during preflight and fails closed as `NATIVE_AUTOFILL_AGENT_RESTRICTED_ENTITLEMENT_UNPACKAGEABLE`; the production collector also marks the current shape unpackageable. This is an architecture blocker, not a certificate failure. Candidate remediations requiring separate design/security review are either a profile-bearing helper app/XPC packaging model or a protocol/storage redesign in which the raw Agent claims no restricted entitlement. Task 9 selects neither and does not remove the Agent App Group.

The builder creates a hash-bound assembly attestation containing only hashes, the inside-out role sequence, and the fixed `signingUsedDeep: false` decision. The verifier independently recalculates the app-executable and DMG SHA-256 hashes before accepting the attestation.

## TDD evidence

- Initial verifier RED: the valid fixture failed because the verifier did not exist.
- Verifier GREEN covers the valid fixture plus fixed-code rejection for missing/duplicate/unexpected inventory, Team and bundle drift, missing/extra App Group, Keychain groups, extra entitlements, unsigned inner code, incorrect signing order, deep signing, missing hardened runtime, app/DMG stapling, macOS floor, designated requirements, outer seal, app/provider profiles, DMG inventory, Provider-only entitlements, notarization, and app/DMG Gatekeeper.
- Real production-entry RED/GREEN proves a physically unsigned three-component bundle fails as `NATIVE_AUTOFILL_INNER_UNSIGNED` with no path in diagnostics.
- A real ad-hoc signed bundle first failed with the less accurate Team mismatch. The collector was corrected to classify ad-hoc inner code as unsigned before Team evaluation; the real regression now passes.
- Entitlement-inventory mutation RED proved an extra entitlement was initially accepted; the exact entitlement-key allowlist made it GREEN.
- Builder RED/GREEN covers the exact inside-out operation plan, credential-reference preflight, no deep signing, sanitized diagnostics, and output-directory symlink ancestry.
- A new builder/verifier RED/GREEN covers the current raw-Agent restricted-entitlement shape and the macOS-specific profile application-identifier key.
- Native overlay RED/GREEN covers private atomic generation, app-only output, exact native entitlement selection, byte-identical production inputs, and refusal to overwrite production files.
- Evidence RED/GREEN covers the complete 20-row live matrix, fixed-code-only content, path/credential exclusion, and refusal to record PASS without both artifact hashes, all current/macOS 13 live rows, strict verifier success, and production promotion.

## Real partial build evidence

A real Release native overlay build completed for the Tauri main app. The existing deterministic Xcode wrapper built the Agent and Credential Provider, and an exact unsigned app assembly embedded all three native components at their final sealed locations. The real collector rejected the linker ad-hoc inner code with `NATIVE_AUTOFILL_INNER_UNSIGNED`. Production configuration and entitlements were byte-identical before and after this build.

No signed app or DMG exists, so artifact hashes remain `null`. The checked-in evidence status is `BLOCKED`; it makes no notarization, stapling, Gatekeeper, installation, Provider enablement, or live-fill claim.

## Credential and external gate status

Read-only discovery found no valid code-signing identity in the login Keychain, no installed provisioning profile in either standard Xcode profile store, and no notarytool Keychain profile metadata. A valid public Developer ID certificate for Team `K7LY92JY96` is externally available, but no certificate or key material was copied, read into repository tooling, or recorded.

Developer ID release identity is the only release certificate class considered. Absence of a Mac Development identity is not treated as a release blocker.

The attempted temporary-Keychain private-key import was rejected before execution by the safety authority and is recorded as `NATIVE_AUTOFILL_PRIVATE_KEY_IMPORT_NOT_AUTHORIZED`. The requested Xcode `-allowProvisioningUpdates` portal attempt was likewise rejected before execution because the current trusted user message does not directly authorize Apple-account side effects; it is recorded as `NATIVE_AUTOFILL_XCODE_AUTOMATIC_PROVISIONING_NOT_AUTHORIZED`, not as a failed provisioning attempt. No Keychain, certificate, profile, or Apple Developer Portal state was changed.

Current external blockers are represented only by fixed codes in the evidence:

- `NATIVE_AUTOFILL_AGENT_RESTRICTED_ENTITLEMENT_UNPACKAGEABLE`
- `NATIVE_AUTOFILL_SIGNING_IDENTITY_KEYCHAIN_MISSING`
- `NATIVE_AUTOFILL_APP_PROFILE_MISSING`
- `NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING`
- `NATIVE_AUTOFILL_NOTARY_PROFILE_MISSING`
- `NATIVE_AUTOFILL_SIGNED_ARTIFACT_MISSING`
- `NATIVE_AUTOFILL_CURRENT_GUI_SESSION_BLOCKED_LOGINWINDOW`
- `NATIVE_AUTOFILL_MACOS13_DEVICE_MISSING`
- `NATIVE_AUTOFILL_PRODUCTION_NOT_PROMOTED`

## Live matrix and production promotion

All 20 fresh/update/current/macOS 13, Provider, field, matching/search, AX, lock/reprompt/account/logout/restart/offline/stale-generation rows remain `NATIVE_AUTOFILL_LIVE_BLOCKED_NO_RELEASE_ARTIFACT`. Without a signed/notarized/stapled artifact, no installation into `/Applications`, Provider enablement, update, or live secret-release test was safe or meaningful. The prior GUI environment also remains unable to activate the bounded external fixture and reports `loginwindow` as frontmost; this is not presented as live success.

The macOS 13 device gate is absent. Because the signed artifact gate, current-machine live matrix, and macOS 13 live matrix did not pass, production native config and entitlements were deliberately not promoted.

## Verification

- Task 9 verifier/builder/overlay/evidence focused suites: passed.
- Native Xcode project/build-wrapper contracts: 13 passed.
- Native identity contracts: 19 passed.
- Full TypeScript: 3,512 passed, 22 skipped across 237 files.
- Full Rust: 248 passed, 7 ignored.
- Full Swift/Xcode: 130 passed, 0 failed. The sandboxed first attempt was blocked by the XCTest helper-service sandbox; the approved unrestricted rerun passed.
- Production web build: passed with existing externalization, Tailwind, and chunk-size warnings.
- `cargo fmt --check`, `cargo check`, shell syntax, plist lint, and `git diff --check`: passed. `cargo check` retains six existing dead-code warnings.

An exploratory `node --test scripts/*.spec.mjs` run is not a Task 9 gate. It exited nonzero on unrelated M13/M16 pinned evidence/clean-artifact preconditions and native-project cases invoked without the required full-Xcode environment. Every applicable Task 9 file was rerun independently with the correct environment and passed.

## Promotion decision

- Release gate: **BLOCKED**
- Production promoted: **NO**
- Signed/notarized/stapled artifact: **NO**
- Architecture remediation selected: **NO; requires design/security review**
- Commit intent: `build: add native autofill release gate`
