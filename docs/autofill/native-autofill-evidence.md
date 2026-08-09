# Native AutoFill release evidence

Status: BLOCKED

- Product version: `0.1.2`
- Team ID: `K7LY92JY96`
- Test OS: `26.6`
- App SHA-256: unavailable
- DMG SHA-256: unavailable

## Fixed gate codes

- `NATIVE_AUTOFILL_TOOLING_IMPLEMENTED`
- `NATIVE_AUTOFILL_AGENT_RESTRICTED_ENTITLEMENT_UNPACKAGEABLE`
- `NATIVE_AUTOFILL_SIGNING_IDENTITY_KEYCHAIN_MISSING`
- `NATIVE_AUTOFILL_PRIVATE_KEY_IMPORT_NOT_AUTHORIZED`
- `NATIVE_AUTOFILL_APP_PROFILE_MISSING`
- `NATIVE_AUTOFILL_PROVIDER_PROFILE_MISSING`
- `NATIVE_AUTOFILL_XCODE_AUTOMATIC_PROVISIONING_NOT_AUTHORIZED`
- `NATIVE_AUTOFILL_NOTARY_PROFILE_MISSING`
- `NATIVE_AUTOFILL_SIGNED_ARTIFACT_MISSING`
- `NATIVE_AUTOFILL_CURRENT_GUI_SESSION_BLOCKED_LOGINWINDOW`
- `NATIVE_AUTOFILL_MACOS13_DEVICE_MISSING`
- `NATIVE_AUTOFILL_PRODUCTION_NOT_PROMOTED`

All current-release and macOS 13 live matrix rows are `NATIVE_AUTOFILL_LIVE_BLOCKED_NO_RELEASE_ARTIFACT`. No signed installation, system-provider enablement, live fill, notarization, stapling, Gatekeeper acceptance, or production promotion is claimed.

The current raw Agent executable cannot embed the provisioning profile required for its restricted App Group entitlement. Remediation requires a separately reviewed packaging or protocol/storage architecture change.
