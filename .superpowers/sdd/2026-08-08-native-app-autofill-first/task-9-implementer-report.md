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

`AutoFillSetupService.disable()` is the callable disable path. A visible `Turn Off AutoFill` control reaches it from both the normal picker and repair state. It clears the enabled flag first, atomically persists a structured cleanup marker containing the original target account, then fail-closed locks the Agent, clears exactly that target projection, and unregisters the Agent in that order, attempting every cleanup even when one operation fails. The marker clears only after all three operations succeed; otherwise the UI reports one fixed failure without native or secret details, and a later startup retries from the persisted target even when the cold/locked store has no owner or a different account is now current. A missing or malformed marker target remains fail-closed and is never replaced with the current account.

The repair `Retry` control now awaits setup recovery (`status → register-if-needed → probe`) rather than merely rerunning picker initialization. Target context, Agent session, and candidate queries begin only when recovery returns `ready`; `requiresApproval` and other recovery failures remain in repair with zero queries and fixed guidance/status text.

## TDD evidence

- Initial verifier RED: the valid fixture failed because the verifier did not exist.
- Verifier GREEN covers the valid fixture plus fixed-code rejection for missing/duplicate/unexpected inventory, Team and bundle drift, missing/extra App Group, Keychain groups, extra entitlements, unsigned inner code, incorrect signing order, deep signing, missing hardened runtime, app/DMG stapling, macOS floor, designated requirements, outer seal, the Provider profile, DMG inventory, Provider-only entitlements, notarization, and app/DMG Gatekeeper.
- Real production-entry RED/GREEN proves a physically unsigned three-component bundle fails as `NATIVE_AUTOFILL_INNER_UNSIGNED` with no path in diagnostics.
- A real ad-hoc signed bundle first failed with the less accurate Team mismatch. The collector was corrected to classify ad-hoc inner code as unsigned before Team evaluation; the real regression now passes.
- Entitlement-inventory mutation RED proved an extra entitlement was initially accepted; the exact entitlement-key allowlist made it GREEN.
- Builder RED/GREEN covers the exact inside-out operation plan, credential-reference preflight, no deep signing, sanitized diagnostics, and output-directory symlink ancestry.
- Review RED/GREEN covers Team-prefixed group identity, Provider-only profile/effective identifiers, certificate/public-key signer binding, LaunchAgent lifecycle and command surface, product version, all symlinks, unexpected Mach-O/dylib payloads, full bundle-manifest hashing, builder-policy binding, exact Agent/Provider/app/DMG signing order, independent DMG Developer ID/Team validation, static deep-sign rejection, fixed-code sanitization, and atomic output promotion.
- Native overlay RED/GREEN covers private atomic generation, app-only output, exact native entitlement selection, byte-identical production inputs, and refusal to overwrite production files.
- Evidence RED/GREEN now covers the revised 18-row current-macOS live matrix, fixed-code-only content, path/credential exclusion, and refusal to record PASS without both artifact hashes, all current-machine live rows, strict verifier success, and production promotion. Schema v2 requires macOS 13–25 runtime to remain explicitly `NATIVE_AUTOFILL_LOWER_OS_RUNTIME_UNVERIFIED`; it is not a promotion blocker, while deployment target 13.0, compile/API availability, and binary minimum-floor verification remain strict gates.
- Product setup RED/GREEN covers fresh install, update/restart recovery, persisted opt-in, status/register/probe ordering, `requiresApproval` query suppression and fixed Login Items guidance, and disable lock/clear/unregister cleanup.
- Final lifecycle RED/GREEN covers visible normal/repair Turn Off controls, awaited fixed-state success/failure, persisted original-account cleanup target, lock/clear/unregister best-effort ordering across failures, cold/locked and account-switch startup cleanup without current-owner substitution, missing-target retention, and Retry query suppression until setup is ready.
- Profile authorization RED/GREEN covers absent/exact/Team-wildcard App Group authorization, exact/Team-wildcard application identifiers, safe Apple-standard extras, and rejection of wrong Team/app/capability/certificate/expiry or dangerous restricted entitlements. No real profile validation is claimed.
- PASS-evidence mutation RED/GREEN proves both runtime and JSON Schema reject an otherwise-valid PASS record containing any code outside the exact three-code positive set or claiming a lower-OS runtime result.

## Real partial build evidence

A real Release native overlay build completed for the Tauri main app. The existing deterministic Xcode wrapper built the Agent and Credential Provider, and an exact unsigned app assembly embedded all three native components at their final sealed locations. The real collector rejected the linker ad-hoc inner code with `NATIVE_AUTOFILL_INNER_UNSIGNED`. Production configuration and entitlements were byte-identical before and after this build.

No signed app or DMG exists, so artifact hashes remain `null`. The checked-in evidence status is `BLOCKED`; it makes no notarization, stapling, Gatekeeper, installation, Provider enablement, or live-fill claim.

## Credential and external gate status

Read-only discovery found no valid code-signing identity in the login Keychain, no installed provisioning profile in either standard Xcode profile store, Xcode account metadata but no Team `K7LY92JY96` metadata, and no notarytool Keychain profile metadata. The external public Developer ID certificate is a currently valid Developer ID Application certificate for Team `K7LY92JY96`, expiring in 2031. The authorized external private-key and API-key files were identified by reference only; no private content was output, copied into the repository, or recorded. The API Key ID is discoverable from its filename, but the required notary/API Issuer ID is not present in any discovered non-secret metadata and cannot be derived from the key.

Developer ID release identity is the only release certificate class considered. Absence of a Mac Development identity is not treated as a release blocker.

The controller's direct-user-authorized run imported the external certificate/key into an isolated temporary Keychain, verified a usable Team `K7LY92JY96` Developer ID Application identity, and destroyed the temporary Keychain. Evidence records only `NATIVE_AUTOFILL_TEMP_KEYCHAIN_IDENTITY_PASS`; it contains no credential path, value, or Keychain detail.

The authorized Xcode automatic-provisioning run reached profile resolution but requested a Mac App Development profile and failed because no profile exists for the Credential Provider bundle ID. This does not satisfy or prove the required Developer ID Provider profile, and no App Store profile was created or selected. The correct release profile therefore remains `NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING`. Notary setup remains blocked before credential validation because the API Issuer ID is genuinely undiscoverable from available non-secret metadata.

The builder now requires an explicit isolated signing Keychain and passes that same Keychain explicitly to both notarytool submissions. Static policy and shell tests reject any builder that omits the notarization Keychain, preventing an ephemeral notary profile from silently falling back to the login Keychain.

Current external state is represented only by fixed codes in the evidence:

- `NATIVE_AUTOFILL_TEMP_KEYCHAIN_IDENTITY_PASS`
- `NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING`
- `NATIVE_AUTOFILL_NOTARY_PROFILE_MISSING`
- `NATIVE_AUTOFILL_NOTARY_ISSUER_ID_MISSING`
- `NATIVE_AUTOFILL_SIGNED_ARTIFACT_MISSING`
- `NATIVE_AUTOFILL_CURRENT_GUI_SESSION_BLOCKED_LOGINWINDOW`
- `NATIVE_AUTOFILL_PRODUCTION_NOT_PROMOTED`

## Live matrix and production promotion

All 18 current-machine fresh/update, Provider, field, matching/search, AX, lock/reprompt/account/logout/restart/offline/stale-generation rows remain `NATIVE_AUTOFILL_LIVE_BLOCKED_NO_RELEASE_ARTIFACT`. Without a signed/notarized/stapled artifact, no installation into `/Applications`, Provider enablement, update, or live secret-release test was safe or meaningful. The prior GUI environment also remains unable to activate the bounded external fixture and reports `loginwindow` as frontmost; this is not presented as live success.

Under the revised acceptance, macOS 13–25 runtime testing is explicitly best-effort/unverified and does not block promotion. Deployment target 13.0 and compile/API/binary-floor checks still pass. Production native config and entitlements remain unpromoted because the signed artifact and current-machine live matrix gates have not passed.

## Verification

- Setup/App/Picker/Tauri-host focused suites: 140 passed.
- Final lifecycle App/Setup/Picker focused suites: 86 passed.
- Task 9 verifier/builder/overlay/evidence focused suites: 25 Node tests plus all three shell harnesses passed.
- Revised evidence/builder/provider/project focused run: 35/35 Node tests passed with the full Xcode environment; evidence/builder policy rerun passed 12/12, and both release-builder and strict-verifier shell harnesses passed.
- Native Xcode project/build-wrapper contracts: 14 passed.
- Native identity contracts: 19 passed.
- Full TypeScript: 3,531 passed and 22 skipped.
- Full Rust: 252 passed, 7 ignored.
- Full Swift/Xcode: 131 passed, 0 failed. The sandboxed first attempt was blocked by the XCTest helper-service sandbox; the approved unrestricted rerun passed.
- Production web build: passed with existing externalization, Tailwind, and chunk-size warnings.
- Rust/native release code was unchanged by the final lifecycle fix, so its previously passing 252/7 and 131/0 results remain the recorded native evidence rather than being rerun.
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
