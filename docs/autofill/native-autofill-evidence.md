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
