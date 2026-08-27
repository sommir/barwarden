# AutoFill Packaging and Transport Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that a signed and notarized Barwarden DMG can embed, enable, update, and securely connect a Safari WebExtension, an AutoFill Credential Provider, an AutoFill Agent, and a Chromium Native Messaging host on macOS 13 and the current macOS release.

**Architecture:** This is a non-production gate for the broader AutoFill design. An Xcode sidecar project builds the two `.appex` bundles and two signed native helpers; the agent listens on a Unix domain socket inside `group.com.sommir.barwarden.autofill`, derives each peer's PID, and validates its Team ID and bundle identifier with Security.framework before answering a credential-free probe. Spike-only assembly scripts embed and sign inner components before the outer Tauri app, create a DMG, notarize it, and verify the exact nested inventory without using `codesign --deep` as a signing strategy.

**Tech Stack:** Tauri 2.11, Rust 1.88, Swift 6/Xcode, AuthenticationServices, SafariServices, Security.framework, App Groups, Unix domain sockets, Manifest V3 Native Messaging, Node.js 22 tests, shell bundle verification, Developer ID signing, Apple notarization.

## Global Constraints

- The minimum supported operating system remains macOS 13.0.
- The production `tauri.conf.json` and `Entitlements.plist` remain unchanged until this gate passes.
- The spike contains no vault item, password, TOTP seed, master password, PIN, account token, or decrypted payload.
- The AutoFill Agent is the only process allowed to hold a projection key in later phases; this spike transports only a random nonce.
- App Group paths and socket possession are discovery mechanisms, never authorization.
- Every accepted peer must match the expected Apple Team ID and one exact Barwarden bundle identifier.
- Inner code is signed before the outer app. `codesign --deep` may be used for verification only, never to repair or create a signature.
- Developer ID certificates and provisioning profiles remain external inputs; no certificate, profile, private key, or notarization credential is committed. The non-secret Team ID is recorded in the contract.
- Safari, Chrome, and Edge are release targets. Firefox remains excluded.
- Chrome and Edge installation remains user-confirmed through their official extension stores.
- No downstream AutoFill feature work begins unless every automated and live gate in this plan passes.

## Program Decomposition

This document is the first of five independently reviewed implementation plans:

1. Packaging and authenticated transport spike — this plan.
2. Encrypted projection, AutoFill Agent protocol, matching, lock, and reprompt lifecycle.
3. Chrome and Edge extension, form discovery, inline list, search, and guarded fill.
4. Safari WebExtension and AutoFill Credential Provider.
5. Accessibility floating action, one-field fallback, setup UI, distribution, and release gates.

Plans 2–5 are written after this spike records the accepted transport and agent lifecycle. That prevents their interfaces from depending on an unproven macOS process model.

## File Structure

### Contract and build orchestration

- `config/autofill-spike-contract.json` — exact bundle identifiers, App Group, executable names, extension origins, deployment target, and nested paths.
- `scripts/autofill-spike-contract.mjs` — loads and validates the contract for tests and build scripts.
- `scripts/autofill-spike-contract.spec.mjs` — rejects missing identifiers, duplicate bundle IDs, development store identities in a release gate, and unexpected paths.
- `scripts/record-autofill-release-identities.mjs` — records the Apple Team ID plus Chrome Web Store and Microsoft Edge Add-ons IDs assigned to Barwarden.
- `scripts/build-autofill-spike.sh` — builds the Tauri shell and Xcode sidecars, assembles the nested bundle, signs inside-out, and creates the DMG.
- `scripts/verify-autofill-spike.sh` — verifies inventory, entitlements, signatures, notarization, stapling, and caller allowlists.
- `scripts/verify-autofill-spike.test.sh` — fixture-driven negative and positive tests for the verifier.
- `scripts/install-autofill-spike-native-hosts.sh` — explicitly installs or removes only Barwarden-owned per-user Chrome and Edge host manifests.
- `scripts/install-autofill-spike-native-hosts.test.sh` — verifies atomic install, exact paths, allowlists, repair, and scoped removal.
- `scripts/create-autofill-spike-config.mjs` — produces a temporary Tauri configuration without changing production configuration.
- `package.json` — exposes deterministic spike build and verification commands.

### Xcode sidecar

- `apps/macos-autofill/BarwardenAutoFill.xcodeproj/project.pbxproj` — four product targets plus unit tests.
- `apps/macos-autofill/Config/Base.xcconfig` — shared version, deployment target, App Group, and Swift settings.
- `apps/macos-autofill/Shared/ProbeProtocol.swift` — bounded versioned request/response models.
- `apps/macos-autofill/Shared/ProbeFraming.swift` — four-byte big-endian length framing capped at 16 KiB.
- `apps/macos-autofill/Agent/AgentMain.swift` — agent entry point and socket lifecycle.
- `apps/macos-autofill/Agent/ProbeServer.swift` — accepts authenticated peers and echoes a nonce.
- `apps/macos-autofill/Agent/PeerIdentityVerifier.swift` — obtains the peer PID and validates Security.framework signing information.
- `apps/macos-autofill/Agent/ProbeStateStore.swift` — persists one non-secret install marker for update validation.
- `apps/macos-autofill/Agent/Entitlements.plist` — App Group access for the agent.
- `apps/macos-autofill/Agent/com.sommir.barwarden.autofill-agent.plist` — `SMAppService.agent` launch agent metadata.
- `apps/macos-autofill/NativeMessaging/NativeMessagingMain.swift` — Chromium stdin/stdout adapter that forwards one bounded probe.
- `apps/macos-autofill/NativeMessaging/ChromeNativeFraming.swift` — Chrome's four-byte little-endian Native Messaging framing capped at 1 MiB for the spike.
- `apps/macos-autofill/NativeMessaging/Entitlements.plist` — App Group access for the Native Messaging host.
- `apps/macos-autofill/CredentialProvider/CredentialProviderViewController.swift` — password-provider probe UI that never returns a credential.
- `apps/macos-autofill/CredentialProvider/Info.plist` — AuthenticationServices extension metadata.
- `apps/macos-autofill/CredentialProvider/Entitlements.plist` — App Sandbox, App Group, and credential-provider entitlement.
- `apps/macos-autofill/SafariWebExtension/SafariWebExtensionHandler.swift` — Safari native handler forwarding a bounded probe.
- `apps/macos-autofill/SafariWebExtension/Info.plist` — Safari WebExtension metadata.
- `apps/macos-autofill/SafariWebExtension/Entitlements.plist` — App Sandbox and App Group only.
- `apps/macos-autofill/SafariWebExtension/Resources/manifest.json` — toolbar-only WebExtension probe manifest.
- `apps/macos-autofill/SafariWebExtension/Resources/popup.html` — shows `connected`, `locked`, or a stable error code.
- `apps/macos-autofill/SafariWebExtension/Resources/popup.js` — sends the nonce probe to the native handler.
- `apps/macos-autofill/Tests/ProbeProtocolTests.swift` — framing, size, replay, and malformed-message tests.
- `apps/macos-autofill/Tests/PeerIdentityVerifierTests.swift` — exact Team ID and bundle-ID allowlist tests.

### Tauri spike integration

- `apps/menubar-tauri/src-tauri/Entitlements.autofill-spike.plist` — App Group entitlement used only by the spike build.
- `apps/menubar-tauri/src-tauri/Info.autofill-spike.plist` — current metadata plus a spike marker.
- `apps/menubar-tauri/src-tauri/src/autofill_spike.rs` — registers and queries the agent when the spike marker is present.
- `apps/menubar-tauri/src-tauri/src/main.rs` — conditionally initializes the spike module without changing the normal runtime path.

### Chromium probe

- `apps/browser-autofill-spike/manifest.chrome.json` — unpacked Chrome probe manifest with one native messaging permission.
- `apps/browser-autofill-spike/manifest.edge.json` — unpacked Edge probe manifest using the same source.
- `apps/browser-autofill-spike/service-worker.js` — sends the nonce probe and exposes a stable status.
- `apps/browser-autofill-spike/popup.html` — renders the current bridge status.
- `apps/browser-autofill-spike/popup.js` — requests status without storing probe data.
- `apps/browser-autofill-spike/native-host.chrome.template.json` — checked-in template allowing only a generated Chrome origin.
- `apps/browser-autofill-spike/native-host.edge.template.json` — checked-in template allowing only a generated Edge origin.

### Evidence

- `docs/autofill/packaging-transport-spike-evidence.json` — canonical command hashes, machine/OS matrix, store IDs, component versions, and pass/fail result.
- `docs/autofill/packaging-transport-spike-evidence.md` — human-readable summary generated from the canonical JSON evidence.
- `docs/autofill/packaging-transport-spike-evidence.schema.json` — prevents the gate from being marked passed with missing evidence.

---

### Task 1: Freeze the Spike Contract

**Files:**
- Create: `config/autofill-spike-contract.json`
- Create: `scripts/autofill-spike-contract.mjs`
- Create: `scripts/autofill-spike-contract.spec.mjs`
- Create: `scripts/record-autofill-release-identities.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: the production identifier `com.sommir.barwarden`, product version from `package.json`, and minimum macOS `13.0` from `tauri.conf.json`.
- Produces: `loadAutoFillSpikeContract(root, options?): AutoFillSpikeContract`, where the contract contains `appGroup`, `teamId`, `deploymentTarget`, and exact entries for `app`, `credentialProvider`, `safariExtension`, `agent`, and `nativeMessagingHost`.

- [ ] **Step 1: Write the failing contract tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { loadAutoFillSpikeContract } from "./autofill-spike-contract.mjs";

test("locks the nested bundle identity and macOS floor", () => {
  const contract = loadAutoFillSpikeContract(process.cwd());
  assert.equal(contract.appGroup, "group.com.sommir.barwarden.autofill");
  assert.equal(contract.deploymentTarget, "13.0");
  assert.deepEqual(
    Object.values(contract.components).map(({ bundleId }) => bundleId),
    [
      "com.sommir.barwarden",
      "com.sommir.barwarden.credential-provider",
      "com.sommir.barwarden.safari-web-extension",
      "com.sommir.barwarden.autofill-agent",
      "com.sommir.barwarden.native-messaging",
    ],
  );
});

test("requires the signing team and distinct Chrome and Edge store IDs", (context) => {
  const structural = loadAutoFillSpikeContract(process.cwd());
  if (!structural.teamId || !structural.chromium.chromeExtensionId || !structural.chromium.edgeExtensionId) {
    context.skip("official release identities have not been recorded");
    return;
  }
  const contract = loadAutoFillSpikeContract(process.cwd(), { requireReleaseIdentities: true });
  assert.match(contract.teamId, /^[A-Z0-9]{10}$/);
  assert.match(contract.chromium.chromeExtensionId, /^[a-p]{32}$/);
  assert.match(contract.chromium.edgeExtensionId, /^[a-p]{32}$/);
  assert.notEqual(contract.chromium.chromeExtensionId, contract.chromium.edgeExtensionId);
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `node --test scripts/autofill-spike-contract.spec.mjs`

Expected: FAIL because `autofill-spike-contract.mjs` and its JSON contract do not exist.

- [ ] **Step 3: Implement the strict loader and initial contract**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadAutoFillSpikeContract(root, options = {}) {
  const path = resolve(root, "config/autofill-spike-contract.json");
  const value = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.appGroup, "group.com.sommir.barwarden.autofill");
  assert.equal(value.deploymentTarget, "13.0");
  assert.equal(new Set(Object.values(value.components).map((entry) => entry.bundleId)).size, 5);
  if (options.requireReleaseIdentities) {
    assert.match(value.teamId, /^[A-Z0-9]{10}$/);
    assert.match(value.chromium.chromeExtensionId, /^[a-p]{32}$/);
    assert.match(value.chromium.edgeExtensionId, /^[a-p]{32}$/);
    assert.notEqual(value.chromium.chromeExtensionId, value.chromium.edgeExtensionId);
  }
  return Object.freeze(value);
}
```

The checked-in initial contract uses `null` for the Team ID and both store IDs. `record-autofill-release-identities.mjs` is the only writer and accepts exactly three validated identities:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadAutoFillSpikeContract } from "./autofill-spike-contract.mjs";

const [teamId, chromeExtensionId, edgeExtensionId] = process.argv.slice(2);
assert.match(teamId, /^[A-Z0-9]{10}$/);
assert.match(chromeExtensionId, /^[a-p]{32}$/);
assert.match(edgeExtensionId, /^[a-p]{32}$/);
assert.notEqual(chromeExtensionId, edgeExtensionId);
const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
  encoding: "utf8",
});
assert.match(identities, new RegExp(`Developer ID Application:.*\\(${teamId}\\)`));
const next = {
  ...loadAutoFillSpikeContract(process.cwd()),
  teamId,
  chromium: { chromeExtensionId, edgeExtensionId },
};
const contractPath = resolve(process.cwd(), "config/autofill-spike-contract.json");
const temporaryPath = `${contractPath}.${process.pid}.tmp`;
writeFileSync(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
renameSync(temporaryPath, contractPath);
```

```bash
node scripts/record-autofill-release-identities.mjs "$APPLE_TEAM_ID" "$CHROME_EXTENSION_ID" "$EDGE_EXTENSION_ID"
```

- [ ] **Step 4: Reserve and record release identities**

Create draft or unlisted Barwarden listings in Chrome Web Store and Microsoft Edge Add-ons, obtain their assigned 32-character IDs, read the 10-character Team ID from the Developer ID signing certificate, and run:

```bash
node scripts/record-autofill-release-identities.mjs "$APPLE_TEAM_ID" "$CHROME_EXTENSION_ID" "$EDGE_EXTENSION_ID"
node --test scripts/autofill-spike-contract.spec.mjs
```

Expected: PASS with no skipped release-identity assertion. The writer rejects a Team ID that does not match the local signing certificate, identical browser IDs, and the fixture-only IDs used by tests.

- [ ] **Step 5: Add package scripts and run the passing contract test**

```json
{
  "test:autofill-spike:contract": "node --test scripts/autofill-spike-contract.spec.mjs",
  "build:autofill-spike": "scripts/build-autofill-spike.sh",
  "verify:autofill-spike": "scripts/verify-autofill-spike.sh",
  "test:autofill-spike:bundle": "scripts/verify-autofill-spike.test.sh"
}
```

Run: `npm run test:autofill-spike:contract`

Expected: PASS for structural and release-identity validation.

- [ ] **Step 6: Commit the contract**

```bash
git add config/autofill-spike-contract.json scripts/autofill-spike-contract.mjs scripts/autofill-spike-contract.spec.mjs scripts/record-autofill-release-identities.mjs package.json
git commit -m "test: define autofill packaging spike contract"
```

### Task 2: Build the Four Xcode Sidecar Products

**Files:**
- Create: `apps/macos-autofill/BarwardenAutoFill.xcodeproj/project.pbxproj`
- Create: `apps/macos-autofill/Config/Base.xcconfig`
- Create: `apps/macos-autofill/Shared/ProbeProtocol.swift`
- Create: `apps/macos-autofill/Shared/ProbeFraming.swift`
- Create: `apps/macos-autofill/Agent/AgentMain.swift`
- Create: `apps/macos-autofill/NativeMessaging/NativeMessagingMain.swift`
- Create: `apps/macos-autofill/CredentialProvider/CredentialProviderViewController.swift`
- Create: `apps/macos-autofill/CredentialProvider/Info.plist`
- Create: `apps/macos-autofill/CredentialProvider/Entitlements.plist`
- Create: `apps/macos-autofill/SafariWebExtension/SafariWebExtensionHandler.swift`
- Create: `apps/macos-autofill/SafariWebExtension/Info.plist`
- Create: `apps/macos-autofill/SafariWebExtension/Entitlements.plist`
- Create: `apps/macos-autofill/SafariWebExtension/Resources/manifest.json`
- Create: `apps/macos-autofill/Tests/ProbeProtocolTests.swift`

**Interfaces:**
- Consumes: bundle IDs, App Group, version, and deployment target from Task 1; `Base.xcconfig` repeats them as Xcode build settings and the contract test requires exact equality.
- Produces: `BarwardenCredentialProvider.appex`, `BarwardenSafariWebExtension.appex`, `BarwardenAutoFillAgent`, and `BarwardenNativeMessagingHost`; shared Swift types `ProbeRequest`, `ProbeResponse`, `ProbeErrorCode`, and `ProbeFraming`.

- [ ] **Step 1: Create the project and verify target inventory fails before products exist**

Configure exact targets and product types:

```text
BarwardenAutoFillAgent            com.apple.product-type.tool
BarwardenNativeMessagingHost      com.apple.product-type.tool
BarwardenCredentialProvider       com.apple.product-type.app-extension
BarwardenSafariWebExtension       com.apple.product-type.app-extension
BarwardenAutoFillTests            com.apple.product-type.bundle.unit-test
```

Run: `xcodebuild -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -list`

Expected: all five targets are listed. Then run the `BarwardenAutoFillSidecars` aggregate scheme and expect failure because the Swift entry points and plists have not been added.

- [ ] **Step 2: Write failing framing tests**

```swift
func testRoundTripsOneBoundedProbe() throws {
    let request = ProbeRequest(version: 1, requestID: UUID(), nonce: Data(repeating: 0x5a, count: 32))
    let frame = try ProbeFraming.encode(request)
    XCTAssertEqual(try ProbeFraming.decode(ProbeRequest.self, from: frame), request)
}

func testRejectsPayloadLargerThanSixteenKiB() {
    struct Oversized: Codable { let bytes: Data }
    let value = Oversized(bytes: Data(repeating: 0x5a, count: 16_385))
    XCTAssertThrowsError(try ProbeFraming.encode(value)) { error in
        XCTAssertEqual(error as? ProbeErrorCode, .messageTooLarge)
    }
}
```

Run: `xcodebuild test -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -scheme BarwardenAutoFillTests -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO`

Expected: FAIL because `ProbeRequest` and `ProbeFraming` are undefined.

- [ ] **Step 3: Implement the bounded protocol**

```swift
import Foundation
import Security

struct ProbeRequest: Codable, Equatable {
    let version: UInt16
    let requestID: UUID
    let nonce: Data

    static func random() throws -> ProbeRequest {
        var nonce = Data(count: 32)
        let status = nonce.withUnsafeMutableBytes {
            SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!)
        }
        guard status == errSecSuccess else { throw ProbeErrorCode.randomUnavailable }
        return ProbeRequest(version: 1, requestID: UUID(), nonce: nonce)
    }
}

struct ProbeResponse: Codable, Equatable {
    let version: UInt16
    let requestID: UUID
    let nonce: Data
    let agentGeneration: UUID
    let installMarker: UUID
    let callerBundleIdentifier: String
}

enum ProbeErrorCode: String, Error, Codable {
    case malformedMessage
    case messageTooLarge
    case unsupportedVersion
    case unauthorizedCaller
    case replayedRequest
    case agentUnavailable
    case randomUnavailable
}

enum ProbeFraming {
    static let maximumPayloadBytes = 16 * 1024
    static func encode<T: Encodable>(_ value: T) throws -> Data {
        let payload = try JSONEncoder().encode(value)
        guard payload.count <= maximumPayloadBytes else { throw ProbeErrorCode.messageTooLarge }
        var length = UInt32(payload.count).bigEndian
        var frame = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
        frame.append(payload)
        return frame
    }

    static func decode<T: Decodable>(_ type: T.Type, from frame: Data) throws -> T {
        guard frame.count >= MemoryLayout<UInt32>.size else { throw ProbeErrorCode.malformedMessage }
        let payloadLength = frame.prefix(4).withUnsafeBytes {
            Int($0.loadUnaligned(as: UInt32.self).bigEndian)
        }
        guard payloadLength <= maximumPayloadBytes else { throw ProbeErrorCode.messageTooLarge }
        guard frame.count == payloadLength + 4 else { throw ProbeErrorCode.malformedMessage }
        do {
            return try JSONDecoder().decode(T.self, from: Data(frame.dropFirst(4)))
        } catch {
            throw ProbeErrorCode.malformedMessage
        }
    }
}
```

- [ ] **Step 4: Add minimal product entry points and extension metadata**

The Credential Provider subclasses `ASCredentialProviderViewController`, exposes only a `Run Connection Check` action, and always cancels with `ASExtensionError.userCanceled` after displaying the probe result. Its entitlements are exactly:

```xml
<dict>
  <key>com.apple.developer.authentication-services.autofill-credential-provider</key><true/>
  <key>com.apple.security.app-sandbox</key><true/>
  <key>com.apple.security.application-groups</key>
  <array><string>group.com.sommir.barwarden.autofill</string></array>
</dict>
```

The Safari target uses `com.apple.Safari.web-extension`, has toolbar-only permissions, and requests no website access in the spike manifest.

The agent and Native Messaging executables each receive only the App Group entitlement. No target receives a Keychain access group.

Use these credential-provider and Safari skeletons before Task 4 connects the probe:

```swift
import AppKit
import AuthenticationServices
import SafariServices

private let SFExtensionMessageKey = "message"

final class CredentialProviderViewController: ASCredentialProviderViewController {
    override func prepareCredentialList(forServiceIdentifiers serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        let label = NSTextField(labelWithString: "Barwarden AutoFill connection check")
        label.alignment = .center
        view = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 180))
        label.frame = view.bounds.insetBy(dx: 24, dy: 64)
        view.addSubview(label)
    }
}

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: ["status": "agent-unavailable"]]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
```

- [ ] **Step 5: Build all products without signing**

Run:

```bash
xcodebuild build \
  -project apps/macos-autofill/BarwardenAutoFill.xcodeproj \
  -scheme BarwardenAutoFillSidecars \
  -configuration Release \
  -derivedDataPath apps/macos-autofill/build/DerivedData \
  CODE_SIGNING_ALLOWED=NO
```

Expected: PASS and exactly four products under `Build/Products/Release`.

- [ ] **Step 6: Run tests and commit the sidecar skeleton**

Run: `xcodebuild test -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -scheme BarwardenAutoFillTests -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO`

Expected: PASS with the oversize, malformed prefix, unsupported version, and round-trip tests all green.

```bash
git add apps/macos-autofill
git commit -m "build: add autofill macOS sidecar targets"
```

### Task 3: Authenticate Local IPC Peers

**Files:**
- Create: `apps/macos-autofill/Agent/PeerIdentityVerifier.swift`
- Create: `apps/macos-autofill/Agent/ProbeServer.swift`
- Create: `apps/macos-autofill/Agent/ProbeStateStore.swift`
- Create: `apps/macos-autofill/Agent/Entitlements.plist`
- Create: `apps/macos-autofill/NativeMessaging/Entitlements.plist`
- Create: `apps/macos-autofill/Tests/PeerIdentityVerifierTests.swift`
- Create: `apps/macos-autofill/Agent/com.sommir.barwarden.autofill-agent.plist`
- Create: `apps/menubar-tauri/src-tauri/Entitlements.autofill-spike.plist`
- Create: `apps/menubar-tauri/src-tauri/Info.autofill-spike.plist`
- Create: `apps/menubar-tauri/src-tauri/src/autofill_spike.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `ProbeRequest` and `ProbeResponse` from Task 2 and the exact allowlist from Task 1.
- Produces: `PeerIdentityVerifier.verify(socketFD:) throws -> VerifiedPeer`, `ProbeServer.run(socketURL:)`, and `initialize_autofill_spike(info, socketPath, register) -> Result<AutoFillSpikeAgentStatus, AutoFillSpikeError>` guarded by the spike Info.plist marker.

- [ ] **Step 1: Write failing allowlist tests**

```swift
func testAcceptsExactTeamAndCredentialProviderIdentifier() throws {
    let policy = PeerPolicy(teamID: "ABCDE12345", bundleIDs: Set([
        "com.sommir.barwarden.credential-provider"
    ]))
    XCTAssertNoThrow(try policy.validate(.init(
        pid: 123,
        teamID: "ABCDE12345",
        bundleIdentifier: "com.sommir.barwarden.credential-provider"
    )))
}

func testRejectsSameBundleIdentifierFromAnotherTeam() {
    let policy = PeerPolicy(teamID: "ABCDE12345", bundleIDs: Set([
        "com.sommir.barwarden.credential-provider"
    ]))
    XCTAssertThrowsError(try policy.validate(.init(
        pid: 123,
        teamID: "OTHER12345",
        bundleIdentifier: "com.sommir.barwarden.credential-provider"
    )))
}
```

Run the `BarwardenAutoFillTests` scheme.

Expected: FAIL because `PeerPolicy` and `VerifiedPeer` are undefined.

- [ ] **Step 2: Implement peer PID and signing validation**

`PeerIdentityVerifier` must:

1. Read `LOCAL_PEERPID` from the accepted Unix socket with `getsockopt`.
2. Call `SecCodeCopyGuestWithAttributes` using `kSecGuestAttributePid`.
3. Call `SecCodeCopySigningInformation` with `kSecCSSigningInformation`.
4. Compare `kSecCodeInfoTeamIdentifier` and `kSecCodeInfoIdentifier` against the exact policy.
5. Build an exact designated requirement from the expected Team ID and the observed allowed bundle identifier and call `SecCodeCheckValidity`.
6. Reject missing Team IDs, ad-hoc peers, dynamic-validity failures, and identifiers not in the allowlist.

```swift
struct VerifiedPeer: Equatable {
    let pid: pid_t
    let teamID: String
    let bundleIdentifier: String
}

protocol PeerVerifying {
    func verify(socketFD: Int32) throws -> VerifiedPeer
}

struct PeerPolicy {
    let teamID: String
    let bundleIDs: Set<String>
    func validate(_ peer: VerifiedPeer) throws {
        guard peer.teamID == teamID, bundleIDs.contains(peer.bundleIdentifier) else {
            throw ProbeErrorCode.unauthorizedCaller
        }
    }
}
```

- [ ] **Step 3: Implement replay-safe probe serving**

`ProbeServer` creates `autofill-agent-v1.sock` in the App Group container with mode `0600`, removes only a stale socket owned by the current UID, accepts one bounded frame per connection, authenticates before decoding, and retains the latest 1,024 request IDs for five minutes.

`ProbeStateStore` creates `probe-install-marker.json` atomically on first start with mode `0600`. It contains only schema version `1` and one newly generated UUID string; later spike builds must read the same marker without rewriting it.

```swift
let response = ProbeResponse(
    version: 1,
    requestID: request.requestID,
    nonce: request.nonce,
    agentGeneration: generation,
    installMarker: state.installMarker,
    callerBundleIdentifier: peer.bundleIdentifier
)
```

- [ ] **Step 4: Add the spike-only agent registration bridge**

`autofill_spike.rs` checks the built app's `BarwardenAutoFillSpike` Info.plist value before calling `SMAppService.agent(plistName:)`. `main.rs` calls `initialize_autofill_spike` during setup; normal production builds return `spike-disabled` without registering anything. The spike writes only a stable status code to diagnostics.

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoFillSpikeAgentStatus {
    pub enabled: bool,
    pub registration: String,
    pub socket_reachable: bool,
}
```

Keep the marker check independently testable from the macOS registration adapter:

```rust
use std::os::unix::net::UnixStream;
use std::path::Path;

#[derive(Debug)]
pub enum AutoFillSpikeError {
    InvalidMarker,
    RegistrationUnavailable,
}

fn spike_enabled(info: &serde_json::Value) -> bool {
    info.get("BarwardenAutoFillSpike").and_then(serde_json::Value::as_bool) == Some(true)
}

fn initialize_autofill_spike(
    info: &serde_json::Value,
    socket_path: &Path,
    register: impl FnOnce() -> Result<String, AutoFillSpikeError>,
) -> Result<AutoFillSpikeAgentStatus, AutoFillSpikeError> {
    if !spike_enabled(info) {
        return Ok(AutoFillSpikeAgentStatus {
            enabled: false,
            registration: "spike-disabled".to_owned(),
            socket_reachable: false,
        });
    }
    let registration = register()?;
    Ok(AutoFillSpikeAgentStatus {
        enabled: true,
        registration,
        socket_reachable: UnixStream::connect(socket_path).is_ok(),
    })
}
```

Add unit tests for marker absent, registration denied, registered but unreachable, and reachable states. Do not add any vault or session data to this module.

- [ ] **Step 5: Run native tests**

Run:

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml autofill_spike
xcodebuild test -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -scheme BarwardenAutoFillTests -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO
```

Expected: both commands PASS; the Swift suite rejects wrong teams, wrong identifiers, replay, oversized frames, and malformed input.

- [ ] **Step 6: Commit authenticated transport**

```bash
git add apps/macos-autofill/Agent apps/macos-autofill/NativeMessaging/Entitlements.plist apps/macos-autofill/Tests apps/menubar-tauri/src-tauri/src/autofill_spike.rs apps/menubar-tauri/src-tauri/src/main.rs apps/menubar-tauri/src-tauri/Entitlements.autofill-spike.plist apps/menubar-tauri/src-tauri/Info.autofill-spike.plist
git commit -m "feat: prove authenticated autofill agent transport"
```

### Task 4: Connect All Four Client Paths

**Files:**
- Modify: `apps/macos-autofill/NativeMessaging/NativeMessagingMain.swift`
- Create: `apps/macos-autofill/NativeMessaging/ChromeNativeFraming.swift`
- Modify: `apps/macos-autofill/CredentialProvider/CredentialProviderViewController.swift`
- Modify: `apps/macos-autofill/SafariWebExtension/SafariWebExtensionHandler.swift`
- Create: `apps/macos-autofill/SafariWebExtension/Resources/popup.html`
- Create: `apps/macos-autofill/SafariWebExtension/Resources/popup.js`
- Create: `apps/macos-autofill/Shared/ProbeClient.swift`
- Create: `apps/macos-autofill/Shared/ProbeSocket.swift`
- Create: `apps/browser-autofill-spike/manifest.chrome.json`
- Create: `apps/browser-autofill-spike/manifest.edge.json`
- Create: `apps/browser-autofill-spike/service-worker.js`
- Create: `apps/browser-autofill-spike/popup.html`
- Create: `apps/browser-autofill-spike/popup.js`
- Create: `apps/browser-autofill-spike/native-host.chrome.template.json`
- Create: `apps/browser-autofill-spike/native-host.edge.template.json`
- Create: `apps/browser-autofill-spike/service-worker.spec.mjs`
- Create: `apps/macos-autofill/Tests/ChromeNativeFramingTests.swift`

**Interfaces:**
- Consumes: the framed probe transport and exact peer policy from Task 3.
- Produces: `runProbe(): Promise<{ status, agentGeneration, installMarker, callerBundleIdentifier }>` in browser code; `ProbeClient.run(expectedCallerBundleIdentifier:) throws -> ProbeResponse` and `ChromeNativeFraming.readOne/writeOne` in Swift; and the stable statuses `connected`, `agent-unavailable`, `unauthorized-caller`, `version-incompatible`, and `malformed-response`.

- [ ] **Step 1: Write failing Chromium bridge tests**

```js
test("reports connected only when nonce and caller identity match", async () => {
  const native = async (request) => ({
    version: 1,
    requestID: request.requestID,
    nonce: request.nonce,
    agentGeneration: "11111111-1111-1111-1111-111111111111",
    installMarker: "22222222-2222-4222-8222-222222222222",
    callerBundleIdentifier: "com.sommir.barwarden.native-messaging",
  });
  assert.equal((await runProbe(native)).status, "connected");
});

test("rejects a response carrying another nonce", async () => {
  const native = async (request) => ({ ...request, nonce: "wrong" });
  assert.equal((await runProbe(native)).status, "malformed-response");
});
```

Add the native framing test:

```swift
func testChromeFrameUsesFourByteLittleEndianLength() throws {
    let payload = Data("{}".utf8)
    let frame = try ChromeNativeFraming.encode(payload, maximumBytes: 1_048_576)
    XCTAssertEqual(Array(frame.prefix(4)), [2, 0, 0, 0])
    XCTAssertEqual(try ChromeNativeFraming.decode(frame, maximumBytes: 1_048_576), payload)
}
```

Run:

```bash
node --test apps/browser-autofill-spike/service-worker.spec.mjs
xcodebuild test -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -scheme BarwardenAutoFillTests -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO
```

Expected: FAIL because `runProbe` and `ChromeNativeFraming` are not implemented.

- [ ] **Step 2: Implement the Native Messaging adapter**

The host reads exactly one Chrome Native Messaging frame from stdin, verifies its 1 MiB outer limit, converts it to the 16 KiB agent frame, forwards it, writes exactly one response, clears buffers, and exits. It logs only the stable status and never the nonce.

```swift
let input = FileHandle.standardInput
let output = FileHandle.standardOutput
let chromePayload = try ChromeNativeFraming.readOne(from: input, maximumBytes: 1_048_576)
let request = try JSONDecoder().decode(ProbeRequest.self, from: chromePayload)
let response = try ProbeClient().run(
    request: request,
    expectedCallerBundleIdentifier: "com.sommir.barwarden.native-messaging"
)
try ChromeNativeFraming.writeOne(response, to: output, maximumBytes: 1_048_576)
```

- [ ] **Step 3: Implement Credential Provider and Safari clients**

Both clients create 32 random bytes with `SecRandomCopyBytes`, connect to the App Group socket, verify the echoed nonce and expected `callerBundleIdentifier`, and display a stable localized status. The Credential Provider never calls a credential-completion API in this spike.

```swift
struct ProbeClient {
    func run(expectedCallerBundleIdentifier: String) throws -> ProbeResponse {
        try run(
            request: ProbeRequest.random(),
            expectedCallerBundleIdentifier: expectedCallerBundleIdentifier
        )
    }

    func run(
        request: ProbeRequest,
        expectedCallerBundleIdentifier: String
    ) throws -> ProbeResponse {
        let socketURL = try ProbeSocket.appGroupURL(
            group: "group.com.sommir.barwarden.autofill",
            name: "autofill-agent-v1.sock"
        )
        let descriptor = try ProbeSocket.connect(to: socketURL)
        defer { Darwin.close(descriptor) }
        try ProbeSocket.writeAll(ProbeFraming.encode(request), to: descriptor)
        let response = try ProbeFraming.decode(
            ProbeResponse.self,
            from: ProbeSocket.readOneFrame(from: descriptor, maximumBytes: 16 * 1024)
        )
        guard response.requestID == request.requestID,
              response.nonce == request.nonce,
              response.callerBundleIdentifier == expectedCallerBundleIdentifier else {
            throw ProbeErrorCode.malformedMessage
        }
        return response
    }
}
```

- [ ] **Step 4: Implement Chrome and Edge probe extensions**

Use Manifest V3 with only these permissions:

```json
{
  "manifest_version": 3,
  "permissions": ["nativeMessaging"],
  "action": { "default_popup": "popup.html" },
  "background": { "service_worker": "service-worker.js", "type": "module" }
}
```

Do not request `tabs`, `activeTab`, host permissions, content scripts, or storage in the spike.

```js
export async function runProbe(
  send = (request) => chrome.runtime.sendNativeMessage("com.sommir.barwarden", request),
) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = btoa(String.fromCharCode(...bytes));
  const request = { version: 1, requestID: crypto.randomUUID(), nonce };
  try {
    const response = await send(request);
    if (
      response?.version !== 1 ||
      response?.requestID !== request.requestID ||
      response?.nonce !== nonce ||
      response?.callerBundleIdentifier !== "com.sommir.barwarden.native-messaging" ||
      typeof response?.agentGeneration !== "string" ||
      typeof response?.installMarker !== "string"
    ) {
      return { status: "malformed-response" };
    }
    return { status: "connected", ...response };
  } catch (error) {
    return { status: stableNativeMessagingStatus(error) };
  }
}

function stableNativeMessagingStatus(error) {
  const message = String(error instanceof Error ? error.message : error);
  if (message.includes("not found") || message.includes("disconnected")) {
    return "agent-unavailable";
  }
  if (message.includes("version")) {
    return "version-incompatible";
  }
  if (message.includes("unauthorized")) {
    return "unauthorized-caller";
  }
  return "malformed-response";
}
```

- [ ] **Step 5: Run client tests and source guards**

Run:

```bash
node --test apps/browser-autofill-spike/service-worker.spec.mjs
! rg -n 'storage|tabs|activeTab|content_scripts|host_permissions' apps/browser-autofill-spike/manifest.*.json
```

Expected: the Node tests PASS and the manifest scan returns no matches.

- [ ] **Step 6: Commit the four probe paths**

```bash
git add apps/macos-autofill apps/browser-autofill-spike
git commit -m "feat: connect autofill extension probe clients"
```

### Task 5: Assemble, Sign, Notarize, and Verify the Spike DMG

**Files:**
- Create: `scripts/create-autofill-spike-config.mjs`
- Create: `scripts/build-autofill-spike.sh`
- Create: `scripts/verify-autofill-spike.sh`
- Create: `scripts/verify-autofill-spike.test.sh`
- Create: `scripts/install-autofill-spike-native-hosts.sh`
- Create: `scripts/install-autofill-spike-native-hosts.test.sh`
- Modify: `scripts/verify-macos-bundle.sh`
- Modify: `scripts/verify-macos-bundle.test.sh`

**Interfaces:**
- Consumes: four sidecar products, spike entitlements, and contract from Tasks 1–4.
- Produces: `target/autofill-spike/Barwarden.app`, `target/autofill-spike/Barwarden-AutoFill-Spike.dmg`, and a machine-readable verification report at `target/autofill-spike/verification.json`.

- [ ] **Step 1: Write failing verifier fixture tests**

Create fixture builders that exercise these cases independently:

```text
PASS: exact two appex + agent + native host, exact entitlements, inside-out signatures
FAIL: missing Credential Provider
FAIL: duplicate Safari appex
FAIL: extra executable under Contents/MacOS
FAIL: App Group missing from one embedded extension
FAIL: shared Keychain access group appears anywhere
FAIL: AutoFill entitlement appears on a non-provider target
FAIL: outer app signed before a nested component is replaced
FAIL: native host manifest allows an unrecorded extension ID
FAIL: native host manifest points outside the selected Barwarden.app
FAIL: any symlink escapes the sealed app bundle
```

Run: `scripts/verify-autofill-spike.test.sh`

Expected: FAIL because `verify-autofill-spike.sh` does not exist.

- [ ] **Step 2: Implement temporary Tauri config generation**

`create-autofill-spike-config.mjs` clones the production config into a temporary file, changes only `bundle.macOS.entitlements` and `bundle.macOS.infoPlist` to the spike variants, and asserts the production files remain byte-identical before and after generation.

- [ ] **Step 3: Implement deterministic bundle assembly**

`build-autofill-spike.sh` performs this exact order:

```text
1. Validate source contract and required tools.
2. Build the web app and unsigned Tauri `.app` using the temporary config.
3. Build the four Xcode products into a temporary DerivedData directory.
4. Copy both `.appex` bundles to `Contents/PlugIns`.
5. Copy the agent to `Contents/Helpers` with its LaunchAgent plist in `Contents/Library/LaunchAgents`.
6. Copy the Native Messaging host to `Contents/Helpers`.
7. Generate Chrome and Edge host manifests with absolute installed-app paths.
8. Sign the native host, agent, Credential Provider, Safari extension, and outer app in that order.
9. Verify every component individually with `codesign --verify --strict`.
10. Create the DMG, submit it with `notarytool --wait`, staple it, and validate the staple.
11. Run `verify-autofill-spike.sh` and write `verification.json`.
```

Required secret-bearing inputs stay external:

```bash
APPLE_SIGNING_IDENTITY="$APPLE_SIGNING_IDENTITY" \
APPLE_NOTARYTOOL_KEYCHAIN_PROFILE="$APPLE_NOTARYTOOL_KEYCHAIN_PROFILE" \
APPLE_TEAM_ID="$APPLE_TEAM_ID" \
APPLE_APP_PROVISIONING_PROFILE="$APPLE_APP_PROVISIONING_PROFILE" \
APPLE_CREDENTIAL_PROVIDER_PROVISIONING_PROFILE="$APPLE_CREDENTIAL_PROVIDER_PROVISIONING_PROFILE" \
APPLE_SAFARI_EXTENSION_PROVISIONING_PROFILE="$APPLE_SAFARI_EXTENSION_PROVISIONING_PROFILE" \
npm run build:autofill-spike
```

The assembly script copies the app profile to `Contents/embedded.provisionprofile`; Xcode embeds the two extension profiles in their respective `.appex` bundles. The verifier compares each profile's application identifier and entitlement grants to the signed target and rejects expired or mismatched profiles.

The signing function accepts an explicit entitlement file for each target and never signs recursively:

```bash
sign_component() {
  local target="$1" entitlements="$2"
  codesign --force --timestamp --options runtime \
    --sign "$APPLE_SIGNING_IDENTITY" \
    --entitlements "$entitlements" \
    "$target"
  codesign --verify --strict --verbose=4 "$target"
}

sign_component "$app_path/Contents/Helpers/BarwardenNativeMessagingHost" "$native_host_entitlements"
sign_component "$app_path/Contents/Helpers/BarwardenAutoFillAgent" "$agent_entitlements"
sign_component "$app_path/Contents/PlugIns/BarwardenCredentialProvider.appex" "$credential_provider_entitlements"
sign_component "$app_path/Contents/PlugIns/BarwardenSafariWebExtension.appex" "$safari_entitlements"
sign_component "$app_path" "$app_entitlements"
```

- [ ] **Step 4: Implement exact verifier policy**

The verifier uses `find -P`, `plutil`, `codesign -d --entitlements :-`, `codesign --verify --strict`, `spctl`, `xcrun stapler`, and contract comparisons. It must not invoke `codesign --force`, `codesign --deep` for signing, `xattr -cr`, or mutate the artifacts.

Update the production verifier only to reject spike products accidentally appearing in a normal production bundle. Do not teach the production verifier to accept non-empty entitlements yet.

- [ ] **Step 5: Run fixture, source, and unsigned build checks**

Run:

```bash
npm run test:autofill-spike:bundle
scripts/install-autofill-spike-native-hosts.test.sh
npm run test:macos-bundle
npm run verify:macos-bundle -- --inputs-only
xcodebuild build -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -scheme BarwardenAutoFillSidecars -configuration Release CODE_SIGNING_ALLOWED=NO
```

Expected: all commands PASS; the normal production bundle contract remains empty-entitlement and single-executable.

- [ ] **Step 6: Build and verify the signed notarized artifact**

Run: `npm run build:autofill-spike`

Expected: PASS with `verification.json` reporting exact inventory, Developer ID signatures for all five signed code objects, accepted notarization, valid staple, and Gatekeeper acceptance.

- [ ] **Step 7: Install and remove the per-user host manifests**

Run:

```bash
scripts/install-autofill-spike-native-hosts.sh --app /Applications/Barwarden.app
scripts/install-autofill-spike-native-hosts.sh --remove
```

Expected: install writes one exact Barwarden manifest under Chrome's and Edge's per-user Native Messaging directories, repair replaces only those two files atomically, and remove deletes only those two Barwarden-owned files. The script rejects an app outside `/Applications`, a missing or invalid signature, an unexpected bundle identifier, and a Native Messaging executable outside the sealed app.

- [ ] **Step 8: Commit assembly and verification**

```bash
git add scripts/create-autofill-spike-config.mjs scripts/build-autofill-spike.sh scripts/verify-autofill-spike.sh scripts/verify-autofill-spike.test.sh scripts/install-autofill-spike-native-hosts.sh scripts/install-autofill-spike-native-hosts.test.sh scripts/verify-macos-bundle.sh scripts/verify-macos-bundle.test.sh
git commit -m "build: verify signed autofill spike bundle"
```

### Task 6: Run the Live macOS and Browser Gate

**Files:**
- Create: `docs/autofill/packaging-transport-spike-evidence.schema.json`
- Create: `docs/autofill/packaging-transport-spike-evidence.json`
- Create: `docs/autofill/packaging-transport-spike-evidence.md`
- Create: `scripts/validate-autofill-spike-evidence.mjs`
- Create: `scripts/validate-autofill-spike-evidence.spec.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: signed notarized DMG and `verification.json` from Task 5.
- Produces: validated evidence with `gateResult` equal to `passed` or `failed`; `passed` is accepted only when all required macOS/browser rows contain artifact hashes, OS versions, component versions, caller identities, and successful probe results.

- [ ] **Step 1: Write failing evidence validation tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { validateEvidence } from "./validate-autofill-spike-evidence.mjs";

const validEvidence = (overrides = {}) => ({
  schemaVersion: 1,
  artifact: { dmgSha256: "a".repeat(64) },
  releaseIdentities: {
    teamId: "ABCDE12345",
    chromeExtensionId: "abcdefghijklmnopabcdefghijklmnop",
    edgeExtensionId: "ponmlkjihgfedcbaponmlkjihgfedcba",
    chromeStoreListing: "https://chromewebstore.google.com/detail/barwarden/abcdefghijklmnopabcdefghijklmnop",
    edgeStoreListing: "https://microsoftedge.microsoft.com/addons/detail/barwarden/ponmlkjihgfedcbaponmlkjihgfedcba",
    storeIdentityConfirmed: true,
  },
  environments: [
    "macos-13", "macos-current", "safari-current", "chrome-current",
    "edge-current", "update", "rollback",
  ].map((id) => ({
    id,
    dmgSha256: "a".repeat(64),
    platformVersion: "verified-version",
    componentVersion: "0.1.0-spike.2",
    expectedCallerBundleId: "com.sommir.barwarden.native-messaging",
    observedCallerBundleId: "com.sommir.barwarden.native-messaging",
    stableResultCode: "connected",
    result: "passed",
  })),
  gateResult: "passed",
  ...overrides,
});

test("does not accept a passed gate with a missing macOS 13 row", () => {
  assert.throws(() => validateEvidence(validEvidence({
    environments: validEvidence().environments.filter(({ id }) => id !== "macos-13"),
  })), /macos-13/);
});

test("does not accept unconfirmed store identities", () => {
  assert.throws(() => validateEvidence(validEvidence({
    releaseIdentities: {
      ...validEvidence().releaseIdentities,
      storeIdentityConfirmed: false,
    },
  })), /store identity/);
});
```

Run: `node --test scripts/validate-autofill-spike-evidence.spec.mjs`

Expected: FAIL because the validator is not implemented.

- [ ] **Step 2: Implement the evidence schema and validator**

Require these live rows:

```text
macOS 13: DMG install, app launch, agent registration, Credential Provider enablement and probe
current macOS: DMG install, app launch, agent registration, Credential Provider enablement and probe
current Safari: embedded extension discovery, enablement, toolbar probe
current Chrome: official-store assigned ID, native-host install, allowlisted probe, wrong-ID rejection
current Edge: official-store assigned ID, native-host install, allowlisted probe, wrong-ID rejection
update: previous spike app to current spike app, preserved discovery and registration
rollback: failed update leaves the previously signed app usable
```

Every row records the DMG SHA-256, app version, OS/browser version, expected caller bundle ID, observed caller bundle ID, and stable result code. The evidence file contains no usernames, URLs, vault data, account identifiers, or nonces.

```js
export function validateEvidence(value) {
  assert.equal(value.schemaVersion, 1);
  assert.match(value.artifact.dmgSha256, /^[a-f0-9]{64}$/);
  assert.match(value.releaseIdentities.teamId, /^[A-Z0-9]{10}$/);
  assert.match(value.releaseIdentities.chromeExtensionId, /^[a-p]{32}$/);
  assert.match(value.releaseIdentities.edgeExtensionId, /^[a-p]{32}$/);
  assert.notEqual(value.releaseIdentities.chromeExtensionId, value.releaseIdentities.edgeExtensionId);
  assert.match(value.releaseIdentities.chromeStoreListing, /^https:\/\/chromewebstore\.google\.com\//);
  assert.match(value.releaseIdentities.edgeStoreListing, /^https:\/\/microsoftedge\.microsoft\.com\/addons\//);
  assert.equal(value.releaseIdentities.storeIdentityConfirmed, true, "store identity is not confirmed");
  assert.ok(value.releaseIdentities.chromeStoreListing.includes(value.releaseIdentities.chromeExtensionId));
  assert.ok(value.releaseIdentities.edgeStoreListing.includes(value.releaseIdentities.edgeExtensionId));
  for (const required of ["macos-13", "macos-current", "safari-current", "chrome-current", "edge-current", "update", "rollback"]) {
    const row = value.environments.find((candidate) => candidate.id === required);
    assert.ok(row, `missing ${required} evidence`);
    assert.match(row.dmgSha256, /^[a-f0-9]{64}$/);
    for (const field of ["platformVersion", "componentVersion", "expectedCallerBundleId", "observedCallerBundleId", "stableResultCode"]) {
      assert.equal(typeof row[field], "string");
      assert.ok(row[field].length > 0, `${required}.${field} is empty`);
    }
    assert.equal(row.result, "passed", `${required} did not pass`);
  }
  assert.equal(value.gateResult, "passed");
  return value;
}
```

- [ ] **Step 3: Confirm store installation prompts**

Open the draft or unlisted Chrome Web Store and Microsoft Edge Add-ons listings recorded in Task 1. Confirm that each browser displays its own installation and permission prompt and that Barwarden does not attempt silent installation.

- [ ] **Step 4: Execute the matrix and record evidence**

Build and notarize spike build numbers 1 and 2 from the same source contract. Install build 1, run every probe, then install build 2 and confirm extension discovery, agent registration, and the non-secret App Group install marker are preserved. Attempt to open a separately copied build 3 whose nested signature was intentionally invalidated; Gatekeeper must reject it while installed build 2 remains usable. Repeat the clean-install probes on macOS 13 and current macOS. For each row, copy only stable verifier output and hashes into the evidence document. Confirm that a locally modified extension ID and an ad-hoc peer are both rejected as `unauthorized-caller`.

- [ ] **Step 5: Validate the complete gate**

Add this package script:

```json
{
  "test:autofill-spike:evidence": "node --test scripts/validate-autofill-spike-evidence.spec.mjs && node scripts/validate-autofill-spike-evidence.mjs docs/autofill/packaging-transport-spike-evidence.json"
}
```

Run:

```bash
npm run test:autofill-spike:contract
npm run test:autofill-spike:bundle
npm run test:autofill-spike:evidence
npm run test:macos-bundle
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml
xcodebuild test -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -scheme BarwardenAutoFillTests -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO
```

Expected: every command PASSes and the evidence validator prints `AUTOFILL SPIKE GATE: PASS`.

- [ ] **Step 6: Record the architecture decision**

If the gate passes, append an `Accepted Transport` section to the design specification naming the Unix socket location contract, peer verification mechanism, launch-agent lifecycle, bundle inventory, and evidence commit. If any live row fails, set `gateResult` to `failed`, record the stable failure code, and stop without starting Plan 2.

- [ ] **Step 7: Commit the gate evidence**

```bash
git add config/autofill-spike-contract.json docs/autofill/packaging-transport-spike-evidence.json docs/autofill/packaging-transport-spike-evidence.md docs/autofill/packaging-transport-spike-evidence.schema.json scripts/validate-autofill-spike-evidence.mjs scripts/validate-autofill-spike-evidence.spec.mjs package.json docs/superpowers/specs/2026-08-08-app-browser-autofill-design.md
git commit -m "docs: record autofill transport gate evidence"
```

## Completion Gate

This plan is complete only when:

- The normal Barwarden production bundle still passes its existing empty-entitlement verifier.
- The spike DMG contains exactly the two expected `.appex` bundles, one AutoFill Agent, one Native Messaging host, and no additional executable.
- Every nested code object and the outer app has the exact expected entitlement set and a valid Developer ID signature.
- The DMG is notarized, stapled, Gatekeeper-accepted, and produces identical mounted-app inventory.
- Credential Provider, Safari, Chrome, and Edge each complete the nonce probe through the same authenticated agent on the required OS matrix.
- Wrong Team IDs, wrong bundle IDs, replays, malformed frames, oversized frames, and missing agents fail closed with stable error codes.
- Official Chrome and Edge store IDs are recorded and are the only allowed Chromium origins.
- The evidence validator prints `AUTOFILL SPIKE GATE: PASS`.

Only after this gate passes should the encrypted projection and credential-bearing protocol plan be written.
