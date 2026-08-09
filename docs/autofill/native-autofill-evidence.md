# Native AutoFill release evidence

Status: BLOCKED

- Product version: `0.1.2`
- Team ID: `K7LY92JY96`
- Production promoted: `false`
- Test OS: `26.6.1`
- macOS 13–25 runtime: `NATIVE_AUTOFILL_LOWER_OS_RUNTIME_UNVERIFIED`
- App SHA-256: unavailable
- DMG SHA-256: unavailable

## Fixed gate codes

- `NATIVE_AUTOFILL_TOOLING_IMPLEMENTED`
- `NATIVE_AUTOFILL_TEMP_KEYCHAIN_IDENTITY_PASS`
- `NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING`
- `NATIVE_AUTOFILL_NOTARY_PROFILE_MISSING`
- `NATIVE_AUTOFILL_NOTARY_ISSUER_ID_MISSING`
- `NATIVE_AUTOFILL_SIGNED_ARTIFACT_MISSING`
- `NATIVE_AUTOFILL_CURRENT_GUI_SESSION_BLOCKED_LOGINWINDOW`
- `NATIVE_AUTOFILL_PRODUCTION_NOT_PROMOTED`

All current-macOS live matrix rows are `NATIVE_AUTOFILL_LIVE_BLOCKED_NO_RELEASE_ARTIFACT`. macOS 13–25 runtime behavior is explicitly unverified and non-blocking under the revised acceptance; the 13.0 deployment target, compile/API availability checks, and binary minimum-floor verification remain mandatory. No signed installation, system-provider enablement, live fill, notarization, stapling, Gatekeeper acceptance, or production promotion is claimed.

## Current-mac local smoke tooling

The separate `build-native-autofill-local-smoke.sh` path is intentionally not a release path. Its static policy requires `NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY=1`, rejects notarization, stapling, DMG creation, release evidence, production promotion, and `codesign --deep` signing, and enforces Agent → Credential Provider → app signing. It builds with the native overlay, embeds the LaunchAgent, uses only an explicitly referenced signing identity and isolated Keychain, verifies designated requirements plus strict/deep seals, and writes exactly one `Barwarden Local Smoke.app` to an existing empty private output directory. A missing Credential Provider profile is allowed only in this mode and emits `NATIVE_AUTOFILL_LOCAL_PROVIDER_PROFILE_MISSING`; macOS may consequently reject Provider registration or discovery.

The command contract is:

```sh
NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY=1 \
NATIVE_AUTOFILL_SIGNING_IDENTITY='<identity label or fingerprint>' \
NATIVE_AUTOFILL_SIGNING_KEYCHAIN='<absolute isolated-keychain path>' \
NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR='<absolute existing empty mode-0700 directory>' \
NATIVE_AUTOFILL_PROVIDER_PROFILE='<optional absolute profile path>' \
scripts/build-native-autofill-local-smoke.sh

NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY=1 \
scripts/run-native-autofill-local-smoke.sh \
  --app '<output directory>/Barwarden Local Smoke.app'
```

`NATIVE_AUTOFILL_PROVIDER_PROFILE` is omitted when unavailable; it is never supplied as an empty path. `DEVELOPER_DIR` may optionally name an installed full Xcode. The builder and helper emit only fixed `NATIVE_AUTOFILL_*` status codes and suppress command diagnostics that could disclose credential references. The helper bounds each external probe and reports app launch, Agent registration status/socket availability, Provider registration/discovery, and Accessibility status. Provider rejection is an honest local-smoke incomplete result, not release evidence.

No local signed build or smoke result has been recorded in this evidence snapshot. The production Tauri configuration and production entitlements remain unpromoted, and the release builder/verifier retain all notarization, DMG, evidence-PASS, and promotion gates.

The local-smoke overlay staging path uses a trailing-six-X `mktemp` template, so stale or concurrent overlay files cannot alias one another; temporary-file creation failures emit only `NATIVE_AUTOFILL_LOCAL_TEMP_CREATE_FAILED` and cleanup any partial working directory. The raw Agent is signed with the explicit identifier `com.sommir.barwarden.autofill-agent` in both local-smoke and release builders. Provider and main-app identifiers continue to come from their bundle metadata and are not overridden. These tooling corrections do not constitute a completed local signed build or alter the blocked release evidence above.

Designated-requirement checks use the codesign verification action with a single `-R=<requirement expression>` argument; they do not pass requirement-set syntax to codesign. Static builder policies also reject an identifier in shared signing arguments, keeping the explicit Agent identifier local to the raw Agent signing command. This corrects command construction only and records no signed-build result.
