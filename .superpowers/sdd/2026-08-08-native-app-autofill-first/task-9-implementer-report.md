# Task 9 implementer report — native release gate tooling

## Outcome

Task 9 is **BLOCKED**, not released. Reusable native release tooling, fixture tests, a real unsigned overlay build, and sanitized partial evidence are implemented. Production `tauri.conf.json` and production `Entitlements.plist` were not promoted or modified.

The release builder uses a temporary native overlay, builds the main app and the two sidecars independently, embeds the Credential Provider at `Contents/PlugIns`, the Agent at `Contents/Helpers`, and the LaunchAgent metadata at `Contents/Library/LaunchAgents`. It consumes the signing identity, Credential Provider profile, signing Keychain, and notarytool Keychain profile only through environment references. The main app and raw Agent do not require profiles. Command output is discarded rather than persisted; outward diagnostics pass through a fixed-code allowlist.

Signing is inside-out: Agent, Credential Provider, then main app. Each inner component's exact designated requirement is verified before the app is signed. The builder never uses `codesign --deep` for signing; deep operation is verification-only. It submits an app archive, staples the app, creates and Developer ID signs the final DMG, submits and staples the DMG, then invokes the strict independent verifier.

## Strict verifier

The verifier requires exactly these signed native components:

- `com.sommir.barwarden`
- `com.sommir.barwarden.credential-provider`
- `com.sommir.barwarden.autofill-agent`

It rejects missing, duplicate, or unexpected executable/nested code, every app-bundle symlink, unexpected Mach-O or dylib payloads, wrong paths, Team or bundle identifiers, unsigned/ad-hoc inner code, non-Developer-ID outer code, an unsigned/non-Developer-ID/wrong-Team DMG, missing hardened runtime, wrong product version or macOS floor, invalid designated requirements, missing or extra App Groups, every Keychain access group, unexpected entitlements, an invalid or expired Provider Developer ID profile, an invalid LaunchAgent or missing Agent registration command surface, an unsealed outer app, a non-exact DMG inventory, mismatched DMG/app contents, absent app or DMG tickets, missing notarized Gatekeeper source, and failed app/DMG Gatekeeper assessment.

The accepted macOS remediation changes the shared group everywhere to Team-prefixed `K7LY92JY96.com.sommir.barwarden.autofill`. The app and raw Agent carry only that App Group and no application/team identifier or profile. Only the Provider carries App Sandbox and the AutoFill Credential Provider capability; its generated effective signed-code entitlements additionally require exact `com.apple.application-identifier=K7LY92JY96.com.sommir.barwarden.credential-provider` and `com.apple.developer.team-identifier=K7LY92JY96`. Profile validation applies authorization semantics rather than signed-code equality: exact or Team-wildcard application identifiers authorize the Provider, the App Group may be absent/exact/Team-wildcard, and only safe Apple-standard extras such as Team/application identifiers, Team-scoped Keychain authorization, and `get-task-allow=false` are accepted. Unknown or dangerous restricted capabilities are rejected. The profile must also be an unexpired Team-scoped Developer ID distribution profile whose embedded signing certificate/public key exactly matches the Provider signer. These rules are proven by fixtures only; no real Provider profile has been presented or claimed valid.

This is a pre-production spike identity correction, not a production data migration. Production native configuration has never been promoted, so no formal migration of the old local spike group container is performed; any old local spike container is intentionally left untouched.

The builder creates a hash-bound assembly attestation containing the complete bundle-manifest hash (root and relative paths, type, mode, and every file hash), DMG hash, exact Agent → Provider → app → DMG signing sequence, `signingUsedDeep: false`, and the release-builder policy hash. The verifier independently recalculates all hashes, derives app/inner/DMG signature and seal state from the artifacts, requires that exact sequence in the current builder policy, and checks the current builder-policy hash before accepting the attestation. Sanitized JSON and Markdown evidence are written into the private build stage before promotion. The exact five-item app/DMG/attestation/evidence set is copied into a private sibling stage and becomes visible through one directory rename; failed evidence generation leaves no release directory.

## Product setup lifecycle

Native Agent registration is now connected to the product path. The first dedicated `autofill-menu`, `autofill-shortcut`, or `autofill-floating` entry persists an explicit enabled flag and awaits `status → register-if-needed → probe` before opening the shared picker. Ordinary vault/tray entry does not opt in. `requiresApproval` enters the existing repair state with fixed `System Settings > General > Login Items` guidance and performs no target-context, Agent-session, candidate, or secret query. On later startup an enabled feature repeats status/recovery/probe so update and restart can recover the embedded Agent.

`AutoFillSetupService.disable()` is the callable disable path. It clears the enabled flag first, then fail-closed locks the Agent, clears the current account projection, and unregisters the Agent, attempting every cleanup even when one operation fails.

## TDD evidence

- Initial verifier RED: the valid fixture failed because the verifier did not exist.
- Verifier GREEN covers the valid fixture plus fixed-code rejection for missing/duplicate/unexpected inventory, Team and bundle drift, missing/extra App Group, Keychain groups, extra entitlements, unsigned inner code, incorrect signing order, deep signing, missing hardened runtime, app/DMG stapling, macOS floor, designated requirements, outer seal, the Provider profile, DMG inventory, Provider-only entitlements, notarization, and app/DMG Gatekeeper.
- Real production-entry RED/GREEN proves a physically unsigned three-component bundle fails as `NATIVE_AUTOFILL_INNER_UNSIGNED` with no path in diagnostics.
- A real ad-hoc signed bundle first failed with the less accurate Team mismatch. The collector was corrected to classify ad-hoc inner code as unsigned before Team evaluation; the real regression now passes.
- Entitlement-inventory mutation RED proved an extra entitlement was initially accepted; the exact entitlement-key allowlist made it GREEN.
- Builder RED/GREEN covers the exact inside-out operation plan, credential-reference preflight, no deep signing, sanitized diagnostics, and output-directory symlink ancestry.
- Review RED/GREEN covers Team-prefixed group identity, Provider-only profile/effective identifiers, certificate/public-key signer binding, LaunchAgent lifecycle and command surface, product version, all symlinks, unexpected Mach-O/dylib payloads, full bundle-manifest hashing, builder-policy binding, exact Agent/Provider/app/DMG signing order, independent DMG Developer ID/Team validation, static deep-sign rejection, fixed-code sanitization, and atomic output promotion.
- Native overlay RED/GREEN covers private atomic generation, app-only output, exact native entitlement selection, byte-identical production inputs, and refusal to overwrite production files.
- Evidence RED/GREEN covers the complete 20-row live matrix, fixed-code-only content, path/credential exclusion, and refusal to record PASS without both artifact hashes, all current/macOS 13 live rows, strict verifier success, and production promotion.
- Product setup RED/GREEN covers fresh install, update/restart recovery, persisted opt-in, status/register/probe ordering, `requiresApproval` query suppression and fixed Login Items guidance, and disable lock/clear/unregister cleanup.
- Profile authorization RED/GREEN covers absent/exact/Team-wildcard App Group authorization, exact/Team-wildcard application identifiers, safe Apple-standard extras, and rejection of wrong Team/app/capability/certificate/expiry or dangerous restricted entitlements. No real profile validation is claimed.
- PASS-evidence mutation RED/GREEN proves both runtime and JSON Schema reject an otherwise-valid PASS record containing any code outside the exact four-code positive set.

## Real partial build evidence

A real Release native overlay build completed for the Tauri main app. The existing deterministic Xcode wrapper built the Agent and Credential Provider, and an exact unsigned app assembly embedded all three native components at their final sealed locations. The real collector rejected the linker ad-hoc inner code with `NATIVE_AUTOFILL_INNER_UNSIGNED`. Production configuration and entitlements were byte-identical before and after this build.

No signed app or DMG exists, so artifact hashes remain `null`. The checked-in evidence status is `BLOCKED`; it makes no notarization, stapling, Gatekeeper, installation, Provider enablement, or live-fill claim.

## Credential and external gate status

Read-only discovery found no valid code-signing identity in the login Keychain, no installed provisioning profile in either standard Xcode profile store, and no notarytool Keychain profile metadata. A valid public Developer ID certificate for Team `K7LY92JY96` is externally available, but no certificate or key material was copied, read into repository tooling, or recorded.

Developer ID release identity is the only release certificate class considered. Absence of a Mac Development identity is not treated as a release blocker.

The attempted temporary-Keychain private-key import was rejected before execution by the safety authority and is recorded as `NATIVE_AUTOFILL_PRIVATE_KEY_IMPORT_NOT_AUTHORIZED`. The requested Xcode `-allowProvisioningUpdates` portal attempt was likewise rejected before execution because the current trusted user message does not directly authorize Apple-account side effects; it is recorded as `NATIVE_AUTOFILL_XCODE_AUTOMATIC_PROVISIONING_NOT_AUTHORIZED`, not as a failed provisioning attempt. No Keychain, certificate, profile, or Apple Developer Portal state was changed.

Current external blockers are represented only by fixed codes in the evidence:

- `NATIVE_AUTOFILL_SIGNING_IDENTITY_MISSING`
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

- Setup/App/Picker/Tauri-host focused suites: 140 passed.
- Task 9 verifier/builder/overlay/evidence focused suites: 25 Node tests plus all three shell harnesses passed.
- Native Xcode project/build-wrapper contracts: 14 passed.
- Native identity contracts: 19 passed.
- Full TypeScript: passed after updating the exact recovery-manifest hash for the intentional Tauri host command change.
- Full Rust: 252 passed, 7 ignored.
- Full Swift/Xcode: 131 passed, 0 failed. The sandboxed first attempt was blocked by the XCTest helper-service sandbox; the approved unrestricted rerun passed.
- Production web build: passed with existing externalization, Tailwind, and chunk-size warnings.
- Shell syntax and `git diff --check`: passed.

An exploratory `node --test scripts/*.spec.mjs` run is not a Task 9 gate. It exited nonzero on unrelated M13/M16 pinned evidence/clean-artifact preconditions and native-project cases invoked without the required full-Xcode environment. Every applicable Task 9 file was rerun independently with the correct environment and passed.

## Promotion decision

- Release gate: **BLOCKED**
- Production promoted: **NO**
- Signed/notarized/stapled artifact: **NO**
- Architecture remediation selected: **YES; Team-prefixed macOS App Group with Provider-only profile**
- Production container migration: **NO; old local spike data is not production data and is left untouched**
- Review-fix commit intent: `fix: harden native autofill release gate`
- Follow-up commit intent: `fix: complete native autofill release setup gate`
