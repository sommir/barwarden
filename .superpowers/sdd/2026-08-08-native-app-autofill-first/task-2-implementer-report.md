# Task 2 Implementer Report: Native Agent and Credential Provider Sidecars

## Outcome

- Added one shared Xcode scheme, `BarwardenNativeAutoFill`, that builds exactly two deliverable native products: the `BarwardenAutoFillAgent` command-line tool and `BarwardenCredentialProvider.appex`. A hostless unit-test bundle is present only for protocol tests.
- Pinned Team ID `K7LY92JY96`, App Group `group.com.sommir.barwarden.autofill`, and deployment target `13.0` in `Native.xcconfig`.
- Pinned the Agent and Credential Provider bundle identifiers to `com.sommir.barwarden.autofill-agent` and `com.sommir.barwarden.credential-provider`. The Agent embeds its generated Info.plist in the Mach-O binary so the identifier remains concrete for code signing.
- Added a four-byte big-endian JSON frame capped at 65,536 payload bytes. The protocol currently exposes only the `probe` operation and transports only version, request ID, and nonce data; it contains no vault or credential fields.
- Added the minimal Credential Provider controller and metadata using Xcode 26.6's macOS template values: extension point `com.apple.authentication-services-credential-provider-ui` and entitlement `com.apple.developer.authentication-services.autofill-credential-provider`.
- Added a LaunchAgent plist using `BundleProgram` for the staged helper path. The authenticated server lifecycle remains intentionally deferred to Task 3.

## Entitlements and signing configuration

- Agent entitlements contain only `com.apple.security.application-groups` with the exact Barwarden App Group.
- Credential Provider entitlements contain exactly App Sandbox, the same App Group, and the AutoFill Credential Provider entitlement.
- No Keychain access group is present. Hardened runtime, automatic signing, and the recorded Team ID are configured, while certificates and provisioning profiles remain external.
- Signed builds were not attempted as a completion gate because the credential-provider capability requires an external provisioning profile. Unsigned builds prove compilation without importing or committing signing material.

## Deterministic build wrapper

- `scripts/build-native-autofill.sh` accepts `CONFIGURATION`, `DERIVED_DATA_PATH`, and an explicit `STAGING_DIR`, and always invokes the single `BarwardenNativeAutoFill` scheme.
- It accepts only Debug or Release, requires absolute build/staging paths, rejects symlinked paths and product contents, rejects extra executable or bundle products, requires an empty staging directory, and copies only the Agent and Credential Provider.
- A real unsigned Release wrapper run built universal arm64/x86_64 products and staged exactly those two artifacts under `/private/tmp`.

## TDD evidence

- Initial Node RED: all six project, plist, entitlement, and wrapper tests failed because their artifacts did not exist.
- Initial Swift RED: Xcode compiled the product skeleton but the unit tests failed specifically because `AgentFrame`, `AgentProtocolError`, and `AgentRequest` were undefined.
- Review RED: the signed Agent identity assertion failed because the command-line tool did not yet embed its generated Info.plist. Adding `CREATE_INFOPLIST_SECTION_IN_BINARY=YES` made the assertion pass, and `otool` then showed `com.sommir.barwarden.autofill-agent` in the binary's `__TEXT,__info_plist` section.
- Final GREEN: five Swift protocol/framing tests and six deterministic Node tests passed.

## Verification

- Final Xcode command: `env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -scheme BarwardenNativeAutoFill -configuration Debug -destination platform=macOS -derivedDataPath /private/tmp/barwarden-autofill-task2-final-20260808 CODE_SIGNING_ALLOWED=NO build test`.
- Result: build succeeded; 5 tests executed, 0 failures.
- Project/plist/wrapper suite: `node --test scripts/native-autofill-project.spec.mjs`; 6 passed, 0 failed.
- Repository regression: `npm test -- --reporter=dot`; 231 files passed, 2 skipped; 3,462 tests passed, 22 skipped.
- `git diff --check` passed. Production `apps/menubar-tauri/src-tauri/tauri.conf.json` and `apps/menubar-tauri/src-tauri/Entitlements.plist` have no diff.

## Self-review

- Confirmed the project has no Safari WebExtension, Chromium, or Native Messaging target, source, or product reference.
- Confirmed the Release build action contains only the Agent and Credential Provider; the test bundle is not a Release deliverable.
- Confirmed all generated build, result, and staging paths are outside the repository and no certificate, private key, API key, provisioning profile, password, or machine-specific external path is included.
- The only observed warning relevant to test execution is that Xcode 26.6's bundled XCTest libraries declare macOS 14 while the test target inherits the required 13.0 floor. Both production products compile with `-target ...-apple-macos13.0`; the warning affects only running this Xcode version's XCTest bundle, not either shipped product.

## Review remediation

- Verified Xcode 26.6's macOS AutoFill template before changing the principal class: the template uses the module-qualified `NSExtensionPrincipalClass` and does not apply an explicit unqualified `@objc` rename. Removed that rename. A Swift runtime-name regression test and the expanded Info.plist from a real unsigned build now jointly verify the class/metadata contract.
- Removed the wrapper's machine-specific Xcode default. It now respects a caller-provided `DEVELOPER_DIR`, otherwise asks `xcode-select`, validates that the selected directory contains both `xcodebuild` and the macOS platform, and exits with status 78 when only Command Line Tools are selected.
- Hardened derived-data, staging, and product validation. Every existing path component is checked for symlinks before and after directory creation, every symlink in the built product tree is rejected, staging must be empty before the build, and the top-level product inventory is an exact allowlist of the two products plus Xcode's four observed bookkeeping entries.
- Replaced disconnected project-text assertions with Xcode-parsed Debug and Release build settings, parsed shared-scheme XML associations, semantic plist checks, and real unsigned product inspection. The Agent's Mach-O `__info_plist` and the provider's expanded principal class are both asserted.
- Added the requested incoming four-byte declared-length test for a payload greater than 65,536 bytes.

### Review TDD and verification evidence

- RED: the upgraded Node suite produced the expected three behavioral failures (invalid Xcode selection was accepted, a symlink ancestor was accepted, and an unexpected framework was accepted). The upgraded Swift suite executed seven tests with the principal-class runtime-name test as its single failure; the oversized incoming-frame test already passed against the bounded decoder.
- GREEN: `node --test scripts/native-autofill-project.spec.mjs` with a runtime-provided full Xcode directory passed 11/11, including parsed Debug/Release settings, scheme associations, real product metadata, symlink ancestry/subtree cases, strict `.framework`/`.bundle`/arbitrary inventory cases, and non-empty staging.
- GREEN: the unsigned Debug Xcode test run executed 7 tests with 0 failures. A real unsigned universal Release wrapper run succeeded and staged exactly `BarwardenAutoFillAgent` and `BarwardenCredentialProvider.appex`; its expanded provider metadata contains the exact bundle ID, macOS 13.0 floor, and module-qualified principal class.
- Full repository regression was run once after the production fixes: 231 files passed, 2 skipped; 3,462 tests passed, 22 skipped (exit 0).
