# Native macOS AutoFill First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Barwarden native-application password AutoFill on macOS 13 and later before implementing Safari, Chrome, or Edge extensions.

**Architecture:** The Tauri app remains the vault authority and writes a transactional encrypted Login projection. A signed Swift AutoFill Agent holds the projection key only in memory, authenticates every local caller by Team ID and bundle ID, ranks native-app candidates, and serves the embedded AutoFill Credential Provider. The main app exposes the same ranked list and all-Login search through its menu/global-shortcut picker, then adds a conservative Accessibility floating action that fills only one explicitly selected field.

**Tech Stack:** Tauri 2.11, Angular/Vitest, Rust 1.88, Swift 6/Xcode, AuthenticationServices, Accessibility, Security.framework, CryptoKit ChaChaPoly, Unix domain sockets, SMAppService, App Groups, Developer ID signing, Apple notarization.

## Global Constraints

- macOS 13.0 remains the minimum supported operating system.
- Browser extensions, Safari WebExtension, Chromium Native Messaging, and browser store publication are deferred and do not block this plan.
- Chrome and Edge store IDs remain `null`; upstream Bitwarden extension IDs are always forbidden.
- The Apple Team ID is `K7LY92JY96`, derived from the external `Developer ID Application: Local Developer (K7LY92JY96)` certificate.
- No certificate, private key, Apple API key, provisioning profile, password, or notarization credential is committed.
- The production `tauri.conf.json` and production entitlements remain unchanged until the native packaging gate passes.
- Only Login items participate in first-release AutoFill.
- The AutoFill Agent is the only process allowed to hold the projection key after provisioning; embedded extensions never decrypt the store directly.
- The current `SessionBroker` remains WebView-only and credential-free.
- App Group paths and socket possession are discovery mechanisms, never authorization.
- Every accepted peer must match Team ID `K7LY92JY96` and one exact native Barwarden bundle identifier.
- Fuzzy matching changes display order only; it never authorizes automatic fill or secret release.
- System AutoFill may fill username and password together only after an explicit system/user selection.
- Accessibility, menu, and shortcut fallbacks fill only one explicit username, password, or TOTP field and never synthesize a Tab sequence.
- System TOTP is enabled only on macOS 15 and later; macOS 13 and 14 retain explicit focused-field TOTP actions.
- Lock, logout, account switch, reprompt failure, agent restart, lost main-app lease, stale generation, or caller mismatch prevents secret release.
- Plaintext projection records and keys are never written to disk or diagnostic output.

---

## Relationship to the Browser Packaging Plan

This plan changes implementation order without deleting the broader design in `docs/superpowers/specs/2026-08-08-app-browser-autofill-design.md`. It supersedes the sequencing of `2026-08-08-autofill-packaging-transport-spike.md` for native work only:

- Native Team ID, Agent, Credential Provider, projection, matching, picker, Accessibility fallback, and native signing proceed now.
- Safari WebExtension, Chromium extension IDs, Native Messaging, browser bridge verification, and browser store installation remain deferred.
- The browser packaging plan resumes later from its browser-specific tasks and reuses the Agent protocol created here.

## File Structure

### Contract and native build

- `config/autofill-spike-contract.json` — Team ID, App Group, native bundle IDs, and deferred browser IDs.
- `scripts/autofill-spike-release-identities.mjs` — independent Team-ID and browser-ID validation policies.
- `scripts/record-autofill-team-identity.mjs` — validates an external DER Developer ID certificate and records only its non-secret Team ID.
- `scripts/build-native-autofill.sh` — builds the app, Agent, and Credential Provider without Safari/Chromium products.
- `scripts/verify-native-autofill-bundle.sh` — verifies exact native nested inventory, entitlements, signatures, notarization, and stapling.

### Swift native sidecar

- `apps/macos-autofill/BarwardenAutoFill.xcodeproj/project.pbxproj` — Agent, Credential Provider, shared library, and unit-test targets.
- `apps/macos-autofill/Config/Native.xcconfig` — version, Team ID, App Group, deployment target, and native bundle IDs.
- `apps/macos-autofill/Shared/AgentProtocol.swift` — bounded versioned request/response types.
- `apps/macos-autofill/Shared/AgentFraming.swift` — four-byte big-endian framing capped at 64 KiB.
- `apps/macos-autofill/Shared/AgentClient.swift` — authenticated socket client used by the Credential Provider.
- `apps/macos-autofill/Shared/AutoFillProjection.swift` — projection schema shared by tests and Agent.
- `apps/macos-autofill/Agent/AgentMain.swift` — process lifecycle and main-app lease.
- `apps/macos-autofill/Agent/AgentServer.swift` — socket accept loop and request dispatcher.
- `apps/macos-autofill/Agent/PeerIdentityVerifier.swift` — PID, Team ID, and exact bundle-ID verification.
- `apps/macos-autofill/Agent/ProjectionStore.swift` — authenticated decryption and in-memory key lifecycle.
- `apps/macos-autofill/Agent/MatchingEngine.swift` — exact-to-fuzzy ranking with reasons.
- `apps/macos-autofill/Agent/AppPresets.json` — audited bundle-to-service presets, never account choices.
- `apps/macos-autofill/CredentialProvider/CredentialProviderViewController.swift` — system request and explicit candidate selection.
- `apps/macos-autofill/CredentialProvider/CredentialIdentityPublisher.swift` — password identity lifecycle and macOS 15 TOTP gating.
- `apps/macos-autofill/Tests/*Tests.swift` — protocol, identity, projection, matching, and provider tests.

### Main app native AutoFill

- `apps/menubar-tauri/src-tauri/src/autofill_contract.rs` — Rust wire models and fixed sanitized outcomes.
- `apps/menubar-tauri/src-tauri/src/autofill_ipc.rs` — bounded Agent client and lease/provision commands.
- `apps/menubar-tauri/src-tauri/src/autofill_projection.rs` — ChaCha20-Poly1305 transaction writer.
- `apps/menubar-tauri/src-tauri/src/accessibility_focus.rs` — focused editable-field discovery and reliable bounds classification.
- `apps/menubar-tauri/src-tauri/src/autofill_floating.rs` — non-activating floating action lifecycle.
- `apps/menubar-tauri/src/app/autofill/autofill-projection.service.ts` — Login projection lifecycle after sync/unlock/lock.
- `apps/menubar-tauri/src/app/autofill/autofill-context.service.ts` — previous frontmost app and entry-point context.
- `apps/menubar-tauri/src/app/autofill/autofill-candidate.service.ts` — Agent query and sanitized candidate models.
- `apps/menubar-tauri/src/app/autofill/autofill-picker.component.*` — ranked groups, match reasons, all-Login search, and explicit field actions.
- `apps/menubar-tauri/src/app/autofill/autofill-bindings.service.ts` — user-created exact app-to-login bindings.

---

### Task 1: Decouple Native Team Identity from Deferred Browser Identities

**Files:**
- Modify: `config/autofill-spike-contract.json`
- Modify: `scripts/autofill-spike-release-identities.mjs`
- Modify: `scripts/autofill-spike-contract.mjs`
- Modify: `scripts/autofill-spike-contract.spec.mjs`
- Create: `scripts/record-autofill-team-identity.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `loadAutoFillSpikeContract(root, { requireTeamIdentity?: boolean, requireBrowserReleaseIdentities?: boolean })`.
- Produces: `inspectDeveloperIdCertificate(path, runner?): { teamId: string, commonName: string }`.
- Guarantees: Team ID is `K7LY92JY96`; browser IDs may both remain `null`, but partial/malformed/forbidden browser identity states fail.

- [ ] **Step 1: Write failing tests for the native-only identity state**

```js
test("accepts the signed native identity while browser publication is deferred", () => {
  const contract = loadAutoFillSpikeContract(process.cwd(), { requireTeamIdentity: true });
  assert.equal(contract.teamId, "K7LY92JY96");
  assert.deepEqual(contract.chromium, { chromeExtensionId: null, edgeExtensionId: null });
});

test("browser release mode still rejects deferred IDs", () => {
  assert.throws(
    () => loadAutoFillSpikeContract(process.cwd(), { requireBrowserReleaseIdentities: true }),
    /browser release identities/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test scripts/autofill-spike-contract.spec.mjs`

Expected: FAIL because Team ID and browser IDs are currently validated only as one triple.

- [ ] **Step 3: Split Team and browser validation**

```js
export function assertTeamIdentity(teamId) {
  assert.match(teamId, /^[A-Z0-9]{10}$/);
}

export function assertBrowserReleaseIdentities(chromium) {
  assert.match(chromium.chromeExtensionId, /^[a-p]{32}$/);
  assert.match(chromium.edgeExtensionId, /^[a-p]{32}$/);
  assert.notEqual(chromium.chromeExtensionId, chromium.edgeExtensionId);
  assertAllowedBrowserExtensionId(chromium.chromeExtensionId);
  assertAllowedBrowserExtensionId(chromium.edgeExtensionId);
}
```

The loader always validates a non-null Team ID and validates browser IDs only when both are present or browser release mode is required. Exactly two `null` browser IDs remain the sole deferred state.

- [ ] **Step 4: Implement external certificate inspection without importing secrets**

`record-autofill-team-identity.mjs` reads only the external `.cer` path, runs `openssl x509 -inform DER -noout -subject -dates`, requires the exact `Developer ID Application` common name and Team ID, updates only `teamId`, and writes atomically with mode `0600`. Tests inject a fake runner; no certificate fixture or private key enters the repository.

- [ ] **Step 5: Record the verified Team ID and run GREEN**

Run:

```bash
node scripts/record-autofill-team-identity.mjs \
  $BARWARDEN_SIGNING_DIR/developer-id.cer
npm run test:autofill-spike:contract
```

Expected: native identity tests PASS; browser-release test proves the deferred state still fails closed.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test -- --reporter=dot`

Commit: `feat: prioritize native autofill identity`

---

### Task 2: Build the Native Agent and Credential Provider Sidecars

**Files:**
- Create: `apps/macos-autofill/BarwardenAutoFill.xcodeproj/project.pbxproj`
- Create: `apps/macos-autofill/Config/Native.xcconfig`
- Create: `apps/macos-autofill/Shared/AgentProtocol.swift`
- Create: `apps/macos-autofill/Shared/AgentFraming.swift`
- Create: `apps/macos-autofill/Agent/AgentMain.swift`
- Create: `apps/macos-autofill/Agent/Entitlements.plist`
- Create: `apps/macos-autofill/Agent/com.sommir.barwarden.autofill-agent.plist`
- Create: `apps/macos-autofill/CredentialProvider/CredentialProviderViewController.swift`
- Create: `apps/macos-autofill/CredentialProvider/Info.plist`
- Create: `apps/macos-autofill/CredentialProvider/Entitlements.plist`
- Create: `apps/macos-autofill/Tests/AgentProtocolTests.swift`
- Create: `scripts/build-native-autofill.sh`

**Interfaces:**
- Produces: `BarwardenAutoFillAgent` with bundle ID `com.sommir.barwarden.autofill-agent`.
- Produces: `BarwardenCredentialProvider.appex` with bundle ID `com.sommir.barwarden.credential-provider`.
- Both use App Group `group.com.sommir.barwarden.autofill` and deployment target `13.0`.

- [ ] **Step 1: Write protocol framing tests**

```swift
func testFrameRejectsPayloadOver64KiB() throws {
    XCTAssertThrowsError(try AgentFrame.encode(Data(repeating: 0, count: 65_537)))
}

func testRequestRoundTripPreservesNonceAndVersion() throws {
    let request = AgentRequest(version: 1, requestID: UUID(), operation: .probe, nonce: Data([1, 2, 3]))
    XCTAssertEqual(try AgentFrame.decode(AgentFrame.encodeJSON(request), as: AgentRequest.self), request)
}
```

- [ ] **Step 2: Create the two-target Xcode project and verify RED-to-GREEN**

Run: `xcodebuild -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -scheme BarwardenNativeAutoFill -configuration Debug CODE_SIGNING_ALLOWED=NO build test`

Expected: both products compile for macOS 13; no Safari or Native Messaging product is present.

- [ ] **Step 3: Add exact entitlement and Info.plist assertions**

Run: `node --test scripts/native-autofill-project.spec.mjs`

The test parses the project and plists, asserts the two exact bundle IDs, App Group on both products, Credential Provider entitlement only on the `.appex`, and rejects Safari/Chromium product references.

- [ ] **Step 4: Add the deterministic build wrapper**

`scripts/build-native-autofill.sh` accepts `CONFIGURATION` and `DERIVED_DATA_PATH`, invokes one named scheme, and copies only the Agent and Credential Provider into an explicit staging directory. It rejects symlinks and unexpected products.

- [ ] **Step 5: Run Swift and project tests and commit**

Commit: `build: add native autofill sidecars`

---

### Task 3: Authenticate Main App and Credential Provider IPC

**Files:**
- Create: `apps/macos-autofill/Shared/AgentClient.swift`
- Create: `apps/macos-autofill/Agent/AgentServer.swift`
- Create: `apps/macos-autofill/Agent/PeerIdentityVerifier.swift`
- Create: `apps/macos-autofill/Tests/PeerIdentityVerifierTests.swift`
- Create: `apps/menubar-tauri/src-tauri/src/autofill_contract.rs`
- Create: `apps/menubar-tauri/src-tauri/src/autofill_ipc.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/main.rs`

**Interfaces:**
- Produces Rust commands: `autofill_agent_probe()`, `autofill_agent_status()`, `autofill_agent_lock()`.
- Agent allowlist: `com.sommir.barwarden` and `com.sommir.barwarden.credential-provider` only.
- Wire frame: four-byte big-endian length followed by UTF-8 JSON, maximum 65,536 bytes.

- [ ] **Step 1: Write peer authorization and framing tests**

Tests reject wrong Team ID, wrong bundle ID, unsigned caller, missing PID, oversized frame, malformed JSON, replayed request ID, and protocol version mismatch. They accept each exact native Barwarden caller independently.

- [ ] **Step 2: Implement PID-derived Security.framework verification**

The server obtains `LOCAL_PEERPID` from the accepted socket, calls `SecCodeCopyGuestWithAttributes`, and reads signing information from Security.framework. Caller-provided PID, Team ID, or bundle ID fields are ignored.

- [ ] **Step 3: Implement the bounded Rust and Swift clients**

```rust
pub struct AgentRequest {
    pub version: u16,
    pub request_id: String,
    pub operation: AgentOperation,
    pub nonce: Vec<u8>,
}
```

Both clients use read/write deadlines, exact frame length, one request per connection, and fixed sanitized error codes.

- [ ] **Step 4: Prove both native client paths**

Run the signed Debug harness so the main app and Credential Provider each send a random nonce and receive the exact nonce from the Agent. An unsigned fixture and wrong-bundle fixture must be rejected.

- [ ] **Step 5: Run Rust, Swift, and full regression tests and commit**

Commit: `feat: authenticate native autofill IPC`

---

### Task 4: Write and Provision the Encrypted AutoFill Projection

**Files:**
- Create: `apps/menubar-tauri/src-tauri/src/autofill_projection.rs`
- Modify: `apps/menubar-tauri/src-tauri/Cargo.toml`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-projection.model.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-projection.service.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-projection.service.spec.ts`
- Create: `apps/macos-autofill/Shared/AutoFillProjection.swift`
- Create: `apps/macos-autofill/Agent/ProjectionStore.swift`
- Create: `apps/macos-autofill/Tests/ProjectionStoreTests.swift`

**Interfaces:**
- Tauri commands: `autofill_replace_projection(input)`, `autofill_clear_projection(accountId)`, `autofill_lock_projection()`.
- Projection schema: version, account ID, vault revision, creation time, and active Login records only.
- Encryption: fresh 256-bit key per unlock generation, ChaCha20-Poly1305, random 96-bit nonce, authenticated header, atomic rename.

- [ ] **Step 1: Write Rust transaction and leakage tests**

Tests cover successful replacement, interrupted temporary write, corrupt tag, stale revision, account switch, logout deletion, and assert the on-disk bytes contain none of the fixture username, password, URI, or TOTP seed.

- [ ] **Step 2: Implement the Rust projection writer**

The writer serializes only active Login fields, encrypts in memory, fsyncs the temporary file and containing directory, atomically renames, then provisions the key and generation to the Agent. A failed Agent provision removes the new projection.

- [ ] **Step 3: Implement Agent key and lease lifecycle**

The Agent accepts a key only from the signed main app, stores it in a zeroizing memory wrapper, requires periodic main-app lease renewal, and clears it on lock, account change, timeout, or process restart.

- [ ] **Step 4: Wire projection lifecycle to vault state**

`AutoFillProjectionService` replaces the projection after successful unlocked sync/mutation, clears it on logout/account removal, and locks the Agent on every UI/session lock transition. It never sends Card, Identity, Secure Note, SSH Key, access token, master password, PIN, or device key fields.

- [ ] **Step 5: Run TypeScript, Rust, Swift, and full tests and commit**

Commit: `feat: add encrypted native autofill projection`

---

### Task 5: Rank Native Application Candidates and Support All-Login Search

**Files:**
- Create: `apps/macos-autofill/Agent/MatchingEngine.swift`
- Create: `apps/macos-autofill/Agent/AppPresets.json`
- Create: `apps/macos-autofill/Tests/MatchingEngineTests.swift`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-bindings.service.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-candidate.service.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-candidate.service.spec.ts`

**Interfaces:**
- Consumes: `NativeAutoFillContext { bundleId, appName, serviceIdentifiers, query }`.
- Produces: `RankedCandidate { cipherId, displayName, username, group, reason, requiresMismatchConfirmation }` with no password/TOTP.
- Groups are exactly `exact`, `relevant`, and `other`; all-Login search bypasses context filtering but not lock/reprompt policy.

- [ ] **Step 1: Write ranking-order tests**

Cover user binding, exact service identifier, built-in preset, exact vault URI rule, host/domain, fuzzy app/vendor/service name, history, favorite, recent, stable tie-break, Unicode normalization, and empty query.

- [ ] **Step 2: Write fuzzy authorization tests**

Every fuzzy-only candidate must be marked non-authorizing; selecting it requires explicit user action and mismatch confirmation where no exact signal exists. No fuzzy path may return a secret directly.

- [ ] **Step 3: Implement presets, bindings, history, and search**

Presets map bundle ID to canonical service/domain only. User bindings map bundle ID to a cipher ID and override presets. History is account-scoped, records only explicit successful selections, and is deleted with the account projection.

- [ ] **Step 4: Expose sanitized candidate queries through the Agent**

Candidate responses contain display metadata and opaque IDs only. Secret field release is a separate operation requiring candidate ID, field request, context token, lock generation, and reprompt result.

- [ ] **Step 5: Run matching/property tests and commit**

Commit: `feat: rank native autofill candidates`

---

### Task 6: Implement macOS System Password AutoFill

**Files:**
- Modify: `apps/macos-autofill/CredentialProvider/CredentialProviderViewController.swift`
- Create: `apps/macos-autofill/CredentialProvider/CredentialIdentityPublisher.swift`
- Create: `apps/macos-autofill/CredentialProvider/CandidateListViewController.swift`
- Create: `apps/macos-autofill/Tests/CredentialProviderTests.swift`
- Create: `apps/macos-autofill/Tests/CredentialIdentityPublisherTests.swift`

**Interfaces:**
- Publishes `ASPasswordCredentialIdentity` metadata only; the identity store never contains passwords.
- Completes password requests with `ASPasswordCredential(user:password:)` only after Agent authorization.
- Enables system TOTP identities/completion behind `if #available(macOS 15.0, *)`.

- [ ] **Step 1: Write identity lifecycle tests**

Cover replace-after-sync, duplicate service identifiers, account switch, logout removal, archived/deleted Login exclusion, username-only identity metadata, and lock preserving identity metadata without exposing secrets.

- [ ] **Step 2: Write request authorization tests**

Cover locked Agent, reprompt required, stale generation, wrong service, explicit all-Login selection, cancelled request, agent unavailable, and successful password completion.

- [ ] **Step 3: Implement system candidate and full-search UI**

The provider shows ranked groups with textual match reasons and a search field across all Login items. Selection never auto-submits and returns only the system-requested credential type.

- [ ] **Step 4: Implement version-gated TOTP behavior**

macOS 13/14 return a stable `unsupported-system-totp` outcome and direct the user to focused-field actions. macOS 15+ requests a current code from the Agent; the seed never leaves the Agent.

- [ ] **Step 5: Run Swift tests and a live system AutoFill smoke test and commit**

Commit: `feat: add macOS credential provider autofill`

---

### Task 7: Add the Main-App AutoFill Picker and Explicit Field Actions

**Files:**
- Create: `apps/menubar-tauri/src/app/autofill/autofill-context.service.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.html`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-entry.service.ts`
- Modify: `apps/menubar-tauri/src/app/app.component.ts`
- Modify: `apps/menubar-tauri/src-tauri/src/global_shortcut.rs`

**Interfaces:**
- Entry points: menu-bar popup and current global shortcut.
- Context: previous frontmost app bundle ID/name captured before Barwarden activation.
- Actions: `Fill username`, `Fill password`, `Fill TOTP`, `Copy`; fallback fills one field through the existing guarded paste command.

- [ ] **Step 1: Write picker rendering and search tests**

Tests assert exact/relevant/other order, match reason labels, all-Login search, keyboard navigation, locked/repair state, empty results, and account override selection.

- [ ] **Step 2: Write one-field safety tests**

Selecting a Login does not paste anything until an explicit field action is chosen. The picker never generates a Tab key, never fills two fallback fields, and never auto-submits.

- [ ] **Step 3: Implement entry context and picker route/state**

The menu/global shortcut opens the AutoFill picker when a previous frontmost external app exists; normal tray clicks continue opening the vault. The picker requests metadata first and secret material only for the final explicit action.

- [ ] **Step 4: Reuse guarded clipboard/paste and reprompt flows**

Accessibility denial or activation races retain the existing value-copied outcome. Reprompt items pass the current master-password/Touch ID gate before Agent field release.

- [ ] **Step 5: Run component, Rust, and full tests and commit**

Commit: `feat: add native autofill picker`

---

### Task 8: Add Conservative Accessibility Floating Action

**Files:**
- Create: `apps/menubar-tauri/src-tauri/src/accessibility_focus.rs`
- Create: `apps/menubar-tauri/src-tauri/src/autofill_floating.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/main.rs`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-accessibility.service.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-accessibility.service.spec.ts`

**Interfaces:**
- Produces: `FocusedFieldSnapshot { app, role, subrole, frame, secure, reliable }` without reading field contents.
- Shows a non-activating Barwarden icon only when permission is granted and field bounds are reliable.
- Clicking the icon opens the same picker from Task 7; the final action still fills one field only.

- [ ] **Step 1: Write focused-field classification tests**

Cover editable text, secure text, non-editable label, missing frame, zero/off-screen frame, stale element, Barwarden-owned window, permission denied, and app termination.

- [ ] **Step 2: Implement AX observation without field-value capture**

Observe focus/window movement notifications, query only role/subrole/editability/frame, throttle repositioning, and discard all snapshots on app change or permission loss. Diagnostics contain bundle ID and fixed reason codes only.

- [ ] **Step 3: Implement the floating panel lifecycle**

Use a borderless non-activating `NSPanel`, keep it inside the active screen work area, never cover the text insertion point when a trailing-edge placement is available, and hide immediately on unreliable geometry.

- [ ] **Step 4: Implement ordered fallback behavior**

System AutoFill remains first. The floating action appears only for a reliable unsupported/fallback field. Menu/global shortcut remains available regardless of AX permission; copy remains the last fallback.

- [ ] **Step 5: Run denied/granted live AX smoke tests and commit**

Commit: `feat: add native autofill floating action`

---

### Task 9: Pass the Native Packaging, Signing, and Installation Gate

**Files:**
- Create: `apps/menubar-tauri/src-tauri/Entitlements.native-autofill.plist`
- Create: `scripts/create-native-autofill-config.mjs`
- Create: `scripts/build-native-autofill-release.sh`
- Create: `scripts/verify-native-autofill-bundle.sh`
- Create: `scripts/verify-native-autofill-bundle.test.sh`
- Create: `docs/autofill/native-autofill-evidence.schema.json`
- Create: `docs/autofill/native-autofill-evidence.json`
- Create: `docs/autofill/native-autofill-evidence.md`
- Modify after gate passes: `apps/menubar-tauri/src-tauri/tauri.conf.json`
- Modify after gate passes: `apps/menubar-tauri/src-tauri/Entitlements.plist`

**Interfaces:**
- Produces a signed, notarized, stapled DMG with exactly the main app, Credential Provider, and Agent native inventory.
- Consumes external certificate/private-key/notarization inputs by path or environment only; never copies them into source control.

- [ ] **Step 1: Write fixture-driven verifier tests**

Reject missing/duplicate/unexpected nested code, wrong Team ID, wrong bundle ID, missing App Group, App Group on an unexpected target, shared Keychain groups, unsigned inner code, wrong signing order, `codesign --deep` signing, missing hardened runtime, unstapled ticket, and macOS floor above 13.0.

- [ ] **Step 2: Build and sign inside-out**

Sign Agent and Credential Provider first, embed them at their exact sealed locations, sign the outer app last, verify each designated requirement independently, then create the DMG. `codesign --deep` is verification-only.

- [ ] **Step 3: Notarize, staple, and verify**

Run Apple notarization using external credentials, staple both app/DMG where supported, and run Gatekeeper plus strict bundle verification. Evidence records hashes, versions, Team ID, OS version, and fixed pass/fail codes, never credential paths or values.

- [ ] **Step 4: Execute the native live matrix**

Test fresh install and update on macOS 13 plus the current macOS release; system AutoFill enablement; supported and unsupported fields; exact, fuzzy, and full search; AX denied/granted; lock, reprompt, account switch, logout, app/Agent restart, offline use, and stale generation cancellation.

- [ ] **Step 5: Promote native entitlements only after the gate passes**

After every automated and live check passes, update production Tauri configuration and entitlements to the exact verified native inventory. Re-run release verification and current application regression suites.

- [ ] **Step 6: Commit the evidence-backed native release integration**

Commit: `release: enable native macOS autofill`

---

## Native Acceptance Criteria

- A native system AutoFill request can return a user-selected Login password credential on macOS 13 and later.
- macOS 15 and later may request system TOTP; macOS 13 and 14 offer explicit focused-field TOTP actions.
- The menu/global-shortcut picker always offers ranked candidates plus search across all Login items.
- Exact application bindings rank first; fuzzy signals affect ordering only.
- Unsupported native fields use the floating action when geometry is reliable and AX is allowed, then menu/shortcut, then copy.
- Every fallback action fills only one explicitly selected field.
- Agent caller authentication is based on kernel-derived PID plus exact Team ID/bundle ID, never claimed identity fields.
- Plaintext credentials and projection keys never persist to disk or logs.
- Lock, logout, account switch, failed reprompt, lost lease, stale generation, agent restart, or caller mismatch prevents secret release.
- The signed/notarized bundle contains the exact main app, Credential Provider, and Agent inventory and continues to support macOS 13.
- No Safari, Chrome, Edge, Firefox, or Native Messaging implementation is required to pass this native-first plan.
