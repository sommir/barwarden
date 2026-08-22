# Locked-State AutoFill Match Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep application/browser recognition and safe AutoFill suggestions available while Barwarden shows its existing lock screen, without retaining secret projection keys.

**Architecture:** Split the Agent into a durable encrypted metadata index and the existing ephemeral secret projection. Candidate queries use metadata in every UI authorization state; secret release still requires an unlocked projection with the same account and vault revision. Locked selections enter the existing unlock flow and revalidate context before filling.

**Tech Stack:** Swift 5/CryptoKit/Security/AuthenticationServices, Rust/Tauri/serde/chacha20poly1305, Angular/TypeScript/RxJS/Vitest, XCTest, Cargo tests, Developer ID code signing.

**Spec:** `docs/superpowers/specs/2026-08-23-locked-autofill-match-index-design.md`

## Global Constraints

- The Barwarden lock route and vault UI remain unchanged.
- Match metadata may include display name, username, URI policy, app binding, history, and available-field flags; it must exclude passwords, TOTP seeds, notes, sessions, and keys.
- Application/browser recognition must not read focused controls.
- Secret release requires an unlocked secret projection and exact account, vault-revision, candidate, field, and context agreement.
- Logs contain only fixed stage, operation, and error codes.
- Preserve unrelated dirty-worktree changes and commit only files owned by each task.

---

### Task 1: Define the safe match-index wire model

**Files:**
- Modify: `apps/macos-autofill/Shared/AutoFillProjection.swift`
- Modify: `apps/macos-autofill/Shared/AgentProtocol.swift`
- Modify: `apps/macos-autofill/Tests/AgentProtocolTests.swift`
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_contract.rs`

**Interfaces:**
- Produces Swift `AutoFillMatchLogin`, `AutoFillMatchIndex`, and `MatchIndexProvisionPayload`.
- Produces Rust `AutoFillMatchLogin`, `AutoFillMatchIndex`, and `match_index` on `ProjectionProvisionPayload`.
- Bumps `AgentProtocol.currentVersion` and `AGENT_PROTOCOL_VERSION` from `2` to `3`.

- [ ] **Step 1: Write failing Swift and Rust wire tests**

Assert a match login serializes only `cipher_id`, `name`, `username`, `uris`, `favorite`, `reprompt`, `last_used_at`, and `available_fields`; assert serialized JSON does not contain `password`, `totp`, `notes`, `access_token`, or `refresh_token`.

```swift
func testMatchIndexWireShapeCannotCarrySecrets() throws {
    let encoded = try JSONEncoder().encode(matchIndexFixture())
    let text = String(decoding: encoded, as: UTF8.self)
    XCTAssertFalse(text.contains("password"))
    XCTAssertFalse(text.contains("totp"))
    XCTAssertFalse(text.contains("notes"))
}
```

```rust
#[test]
fn match_index_wire_shape_is_metadata_only() {
    let value = serde_json::to_value(match_index_fixture()).unwrap();
    let text = value.to_string();
    assert!(!text.contains("password"));
    assert!(!text.contains("totp"));
    assert!(!text.contains("notes"));
}
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml autofill_contract::tests::match_index_wire_shape_is_metadata_only
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -scheme BarwardenNativeAutoFill -configuration Debug -destination 'platform=macOS' -derivedDataPath /private/tmp/barwarden-xcode-derived CODE_SIGNING_ALLOWED=NO -only-testing:BarwardenAutoFillTests/AgentProtocolTests/testMatchIndexWireShapeCannotCarrySecrets test
```

Expected: compile failure because the match types do not exist.

- [ ] **Step 3: Add bounded types and validation**

Use explicit structs with `deny_unknown_fields` in Rust and strict coding keys in Swift. Represent field availability with booleans rather than secret values. Validate nonempty account/generation/cipher IDs, unique cipher IDs, canonical bindings/history, bounded strings and arrays, and vault revision greater than zero.

- [ ] **Step 4: Run focused protocol suites and verify GREEN**

Run the complete Rust `autofill_contract` tests and Swift `AgentProtocolTests`.

- [ ] **Step 5: Commit**

```bash
git add apps/macos-autofill/Shared/AutoFillProjection.swift apps/macos-autofill/Shared/AgentProtocol.swift apps/macos-autofill/Tests/AgentProtocolTests.swift apps/menubar-tauri/src-tauri/src/autofill_contract.rs
git commit -m "feat: define safe autofill match index"
```

### Task 2: Persist the match index with an Agent-owned Keychain key

**Files:**
- Create: `apps/macos-autofill/Agent/MatchIndexKeyStore.swift`
- Create: `apps/macos-autofill/Agent/MatchIndexStore.swift`
- Create: `apps/macos-autofill/Tests/MatchIndexStoreTests.swift`
- Modify: `apps/macos-autofill/BarwardenAutoFill.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces `protocol MatchIndexKeyProviding { func loadOrCreateKey() throws -> Data; func deleteKey() throws }`.
- Produces `MatchIndexStore.replace(_:)`, `snapshot()`, `session()`, and `remove(accountID:)`.
- Uses file `autofill-match-index-v1.bwmi`, magic `BWAFIDX1`, mode `0600`, and a 32-byte Keychain key.

- [ ] **Step 1: Write failing store tests**

Cover encrypted round trip, plaintext sentinel absence, restart loading, mode/owner checks, corrupt tag removal, symlink rejection, atomic replacement rollback, and account-scoped removal. Inject an in-memory key provider.

- [ ] **Step 2: Run the new XCTest class and verify RED**

Expected: compile failure because `MatchIndexStore` does not exist.

- [ ] **Step 3: Implement Keychain and encrypted atomic store**

Use `SecItemCopyMatching`/`SecItemAdd` with service `com.sommir.barwarden.autofill.match-index-key.v1`, account `active`, and `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. Use ChaChaPoly with the full header as associated data. Open directories/files with `O_NOFOLLOW`; stage, sync, rename, and sync the directory before publishing memory state.

- [ ] **Step 4: Add both source files to Agent and test targets**

Add PBX file references, Agent/Test build files, group membership, and source phase entries with unique IDs.

- [ ] **Step 5: Run `MatchIndexStoreTests` and verify GREEN**

- [ ] **Step 6: Commit**

```bash
git add apps/macos-autofill/Agent/MatchIndexKeyStore.swift apps/macos-autofill/Agent/MatchIndexStore.swift apps/macos-autofill/Tests/MatchIndexStoreTests.swift apps/macos-autofill/BarwardenAutoFill.xcodeproj/project.pbxproj
git commit -m "feat: persist encrypted autofill match index"
```

### Task 3: Query metadata while locking secret release

**Files:**
- Modify: `apps/macos-autofill/Agent/AgentMain.swift`
- Modify: `apps/macos-autofill/Agent/AgentServer.swift`
- Modify: `apps/macos-autofill/Agent/ProjectionStore.swift`
- Modify: `apps/macos-autofill/Agent/MatchingEngine.swift`
- Modify: `apps/macos-autofill/Tests/AgentClientServerTests.swift`
- Modify: `apps/macos-autofill/Tests/ProjectionStoreTests.swift`
- Modify: `apps/macos-autofill/Tests/MatchingEngineTests.swift`

**Interfaces:**
- `AgentConnectionHandler` receives both `matchIndexStore` and `projectionStore`.
- `status` and `queryCandidates` use match-index generation/account/revision.
- `releaseSecret` first validates the metadata authorization, then requires a secret projection at the same revision.
- `lock` clears only `ProjectionStore`; `logoutAccount` removes the match index too.

- [ ] **Step 1: Write failing lifecycle tests**

Test sequence: provision both layers, query candidates, lock, query the same candidates successfully, reject `releaseSecret` with `.locked`, recreate the handler/store from disk and query again, then logout and receive `.matchIndexUnavailable`.

- [ ] **Step 2: Run focused Agent/Projection tests and verify RED**

- [ ] **Step 3: Split matching input from secret input**

Add a metadata ranking adapter that creates the existing matching-engine view with availability flags. Candidate authorization stores the match revision and context digest. Secret release locates the secret login only after exact metadata/secret revision equality.

- [ ] **Step 4: Change lock/logout dispatch and fixed diagnostics**

Keep the already-added `operation=<fixed> failure=<fixed>` logging. Add fixed `match_index_unavailable` and `match_index_corrupt` codes without paths or payload data.

- [ ] **Step 5: Run full `BarwardenAutoFillTests` and verify GREEN**

- [ ] **Step 6: Commit**

```bash
git add apps/macos-autofill/Agent apps/macos-autofill/Tests
git commit -m "feat: keep autofill matching available while locked"
```

### Task 4: Publish safe metadata and secrets as one revision

**Files:**
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-projection.model.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-projection.service.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-projection.service.spec.ts`
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_projection.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_ipc.rs`

**Interfaces:**
- TypeScript produces `AutoFillMatchIndexInput` alongside `AutoFillProjectionInput`.
- Rust `ProjectionProvision` owns `match_index: AutoFillMatchIndex` and zeroizes only the secret key.
- Agent provision receives both layers with identical account and vault revision.

- [ ] **Step 1: Write failing TS test proving the safe model excludes secrets**

Capture the native host input, stringify only `matchIndex`, and assert sentinel password/TOTP/note values are absent while field availability is correct.

- [ ] **Step 2: Write failing Rust transaction tests**

Test mismatched account/revision rejection and failure rollback that keeps the previous metadata index and secret projection active.

- [ ] **Step 3: Run tests and verify RED**

- [ ] **Step 4: Build the safe index and extend provision**

Derive metadata from the same immutable item snapshot used for the secret projection. Do not derive by serializing the secret model and deleting keys. Send the explicit safe type through the bounded Agent protocol.

- [ ] **Step 5: Run TS projection suite and Rust `autofill_projection`/`autofill_ipc` suites**

- [ ] **Step 6: Commit**

```bash
git add apps/menubar-tauri/src/app/autofill apps/menubar-tauri/src-tauri/src/autofill_projection.rs apps/menubar-tauri/src-tauri/src/autofill_ipc.rs
git commit -m "feat: publish split autofill metadata and secrets"
```

### Task 5: Decouple the native monitor from UI authorization

**Files:**
- Modify: `apps/menubar-tauri/src-tauri/src/suggestion_count.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/session_broker.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_ipc.rs`

**Interfaces:**
- `lifecycle_decision` accepts an explicit `has_match_index` signal; lock/recovery no longer imply `Clear`.
- `SuggestionAgentPort::session()` returns the match-index session.
- Logout/removal explicitly calls `suggestion_monitor.clear()`.

- [ ] **Step 1: Replace the current locked-clears test with a failing independence test**

```rust
assert_eq!(lifecycle_decision(AuthorizationState::Locked, true, false), LifecycleDecision::NoChange);
assert_eq!(lifecycle_decision(AuthorizationState::Locked, true, true), LifecycleDecision::Refresh);
assert_eq!(lifecycle_decision(AuthorizationState::SignedOut, false, false), LifecycleDecision::Clear);
```

- [ ] **Step 2: Run `suggestion_count` and `session_broker` tests and verify RED**

- [ ] **Step 3: Implement explicit index lifecycle**

Remove authorization as a proxy for metadata availability. Keep browser URL failure fail-closed and keep the monitor read-only and focused-field-free.

- [ ] **Step 4: Run Rust suites and `scripts/menu-bar-suggestion-count-contract.spec.mjs`**

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src-tauri/src/suggestion_count.rs apps/menubar-tauri/src-tauri/src/session_broker.rs apps/menubar-tauri/src-tauri/src/autofill_ipc.rs
git commit -m "fix: decouple suggestions from vault UI lock"
```

### Task 6: Unify master-password, PIN, and Touch ID publication

**Files:**
- Modify: `apps/menubar-tauri/src/app/auth/auth.facade.ts`
- Modify: `apps/menubar-tauri/src/app/auth/auth.facade.spec.ts`

**Interfaces:**
- `restoreAlternativeSession()` calls `publishCurrentUnlockedState()` after successful sync/status persistence.

- [ ] **Step 1: Keep the existing failing regression test**

The test `publishes unlocked authority and reprojects after Touch ID restores the session` must fail with `events=[]` before the implementation.

- [ ] **Step 2: Keep the minimal implementation already made**

```ts
this.vaultTimeout?.start();
await this.publishCurrentUnlockedState();
```

- [ ] **Step 3: Run all AuthFacade tests**

```bash
npx vitest run apps/menubar-tauri/src/app/auth/auth.facade.spec.ts
```

- [ ] **Step 4: Commit only the two owned files**

```bash
git add apps/menubar-tauri/src/app/auth/auth.facade.ts apps/menubar-tauri/src/app/auth/auth.facade.spec.ts
git commit -m "fix: publish autofill after alternative unlock"
```

### Task 7: Resume locked selections through the existing unlock route

**Files:**
- Create: `apps/menubar-tauri/src/app/autofill/pending-autofill.service.ts`
- Create: `apps/menubar-tauri/src/app/autofill/pending-autofill.service.spec.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.spec.ts`
- Modify: `apps/menubar-tauri/src/app/auth/auth.facade.ts`
- Modify: `apps/menubar-tauri/src/app/app.component.ts`

**Interfaces:**
- `PendingAutoFillService.begin(intent)`, `cancel(reason)`, and `resumeAfterUnlock()`.
- Intent contains opaque candidate ID, field, account, match generation/revision, and context digest; lifetime is 60 seconds and memory-only.

- [ ] **Step 1: Write failing pending-intent tests**

Cover lock-route navigation, no persistent storage writes, timeout, cancellation, account switch, URL/app change, and successful post-unlock re-query before fill.

- [ ] **Step 2: Run focused Vitest suites and verify RED**

- [ ] **Step 3: Implement memory-only coordinator**

Raise the existing `/lock` route. After unlock, restore/read the target, re-query current metadata, require the same candidate, and invoke the existing field fill path. Clear intent in `finally`.

- [ ] **Step 4: Run focused and AuthFacade/AppComponent suites**

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/autofill/pending-autofill.service.ts apps/menubar-tauri/src/app/autofill/pending-autofill.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.ts apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.spec.ts apps/menubar-tauri/src/app/auth/auth.facade.ts apps/menubar-tauri/src/app/app.component.ts
git commit -m "feat: resume autofill safely after unlock"
```

### Task 8: Add the system credential-provider unlock handoff

**Files:**
- Modify: `apps/macos-autofill/CredentialProvider/CandidateListViewController.swift`
- Modify: `apps/macos-autofill/CredentialProvider/CredentialProviderViewController.swift`
- Modify: `apps/macos-autofill/Tests/CredentialProviderTests.swift`
- Modify: `apps/menubar-tauri/src-tauri/tauri.conf.json`

**Interfaces:**
- Locked provider UI exposes an Open Barwarden action using `extensionContext.open(barwarden://autofill-unlock)`.
- A bounded watcher re-queries the same published identity after the secret revision becomes available; cancellation stays terminal and single-shot.

- [ ] **Step 1: Write failing coordinator/view tests**

Test `userInteractionRequired`, open-action invocation, bounded retry, successful exact-identity completion, cancellation, and stale-service rejection.

- [ ] **Step 2: Run `CredentialProviderTests` and verify RED**

- [ ] **Step 3: Register the URL scheme and implement the handoff UI**

Use only the fixed URL route; do not put account, candidate, username, service, or context in the URL. Keep identity details in extension memory and revalidate via Agent.

- [ ] **Step 4: Run provider and bundle-policy suites**

- [ ] **Step 5: Commit**

```bash
git add apps/macos-autofill/CredentialProvider apps/macos-autofill/Tests/CredentialProviderTests.swift apps/menubar-tauri/src-tauri/tauri.conf.json
git commit -m "feat: hand off locked system autofill to Barwarden"
```

### Task 9: Verify, sign, install, and clean up

**Files:**
- Modify only if a verification defect is found; start read-only.

- [ ] **Step 1: Run complete focused verification**

Run full `BarwardenAutoFillTests`, `cargo test`, the affected Vitest files, the menu-bar contract test, web build/typecheck, and native bundle policy tests.

- [ ] **Step 2: Build the native AutoFill local app**

Use `scripts/build-native-autofill-local-smoke.sh` or the existing approved local assembly path with an isolated output directory and the explicit Developer ID identity.

- [ ] **Step 3: Sign in dependency order**

Sign Agent, Credential Provider, and outer app with timestamp/runtime and their exact entitlements. Verify each component, then run strict/deep verification on the app.

- [ ] **Step 4: Live locked-state verification**

With Barwarden on `/lock`, switch between a non-browser app and multiple browser URLs without focusing a field. Confirm operation logs show metadata `status/query_candidates`, the menu title changes, and no secret release succeeds. Select a suggestion, unlock, verify context revalidation and fill; change target during a second attempt and verify cancellation.

- [ ] **Step 5: Cleanup**

Delete the temporary signing Keychain and exact temporary signing/build directories after successful verification. Preserve the installed signed app and all user vault data.

- [ ] **Step 6: Final repository check**

Run `git diff --check`, list only task-owned changes/commits, and report unrelated dirty files as untouched.
