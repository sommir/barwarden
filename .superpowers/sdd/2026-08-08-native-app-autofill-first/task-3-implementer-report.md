# Task 3 Implementer Report: Authenticated Native AutoFill IPC

## Outcome

- Added a macOS 13 Unix-domain-socket Agent server and bounded Swift/Rust clients using one request per connection, four-byte big-endian framing, UTF-8 JSON, a 65,536-byte payload ceiling, and read/write deadlines.
- The Agent derives the caller PID only from `LOCAL_PEERPID`, validates the live guest with Security.framework, and accepts only Team `K7LY92JY96` with bundle ID `com.sommir.barwarden` or `com.sommir.barwarden.credential-provider`.
- Caller-provided `pid`, `team_id`, and `bundle_id` JSON fields are ignored. Authentication is evaluated before any JSON decode or operation dispatch, and authentication failure takes priority over framing details.
- Added protocol-version and process-lifetime request-ID replay rejection, fresh UUID request IDs, cryptographically generated 32-byte Swift nonces, OS-random UUID-backed 32-byte Rust nonces, exact nonce/request correlation, `SO_NOSIGPIPE`, and fixed sanitized error codes.
- Wired `autofill_agent_probe`, `autofill_agent_status`, and `autofill_agent_lock` into `main.rs` and the existing Tauri native-command surface. Task 3 operations acknowledge with the exact nonce only; projection/key lock semantics remain intentionally deferred to Task 4.

## Security boundary

The accepted socket descriptor is the sole identity input. `PeerIdentityVerifier` obtains `LOCAL_PEERPID`, calls `SecCodeCopyGuestWithAttributes`, dynamically validates the guest with `SecCodeCheckValidity`, obtains its static code, and reads `kSecCodeInfoTeamIdentifier` and `kSecCodeInfoIdentifier` from Security.framework signing information. Missing PID, unsigned/ad-hoc code, a wrong Team ID, and every non-allowlisted identifier resolve to the same `unauthorized` code.

The Agent first records the Security.framework authorization result, then reads at most one deadline-bound and size-bound raw frame so a rejected client can receive its fixed response without `SIGPIPE`. It applies the authorization result before JSON decoding. This prevents an unauthorized caller from turning malformed or oversized frames into a framing oracle.

## TDD evidence

- Baseline: the inherited unsigned Xcode suite executed 7 tests with 0 failures.
- Swift identity RED: the new tests failed to compile because `PeerIdentityVerifier`, `PeerSigningIdentity`, `AgentRequestGate`, and the fixed error cases did not exist.
- Swift identity GREEN: 17 tests passed after the PID-derived verifier and version/replay gate were added.
- Swift socket/client RED: the second test batch failed because `AgentSocketIO`, `AgentConnectionHandler`, `AgentClient`, and structured responses did not exist.
- Swift socket/client GREEN: the suite reached 24 tests with 0 failures, covering exact nonce echo, one-request close, deadlines, malformed/oversized requests, unauthorized response sanitization, and fresh IDs/nonces.
- Rust RED: the focused build failed on unresolved `AgentRequest`, `AgentResponse`, `AgentClient`, frame helpers, and error codes.
- Rust GREEN: 7 focused tests passed after the minimum wire contract and client were implemented.
- Real-harness RED: the first signed cross-language run rejected the Rust main-app response as malformed because Swift normalizes UUID text casing; the ad-hoc no-Team client also exposed a `SIGPIPE` close race. UUID comparison was changed to semantic UUID equality, and bounded socket setup gained `SO_NOSIGPIPE` plus the raw-frame drain described above.
- Auth-priority RED: an unauthorized peer with an oversized declared frame received `message_too_large`; the focused test expected `unauthorized`. Prioritizing the captured authorization result made this test pass.
- Command-surface RED: the full Vitest suite reported only the three new Rust commands missing from the exact TypeScript allowlist. Minimal Tauri host forwarding and the generated recovery-overlay integrity refresh made the focused command/recovery guards pass 7/7.

## Real signed Debug harness

The external keychain exposed one valid `Developer ID Application` signing identity for Team `K7LY92JY96`. Temporary artifacts under `/private/tmp` were signed through `codesign`; no private key, certificate bytes, provisioning profile, password, or signing secret was read, printed, or copied into the repository.

Against the final Debug Agent and one private temporary socket:

- A signed Rust test executable identified as `com.sommir.barwarden` sent a fresh request and passed exact nonce echo: 1 test passed.
- A signed Swift executable built from the same `AgentClient.swift` compiled into the Credential Provider and identified as `com.sommir.barwarden.credential-provider` passed exact nonce echo: exit 0.
- A valid same-Team executable identified as `com.sommir.barwarden.wrong` received only `unauthorized`: expected exit 0.
- An ad-hoc executable with no Team identifier received only `unauthorized`: expected exit 0.

The temporary Agent was stopped after each harness run and no socket or generated harness artifact was added to the worktree.

## Final verification

- Swift/Xcode: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -scheme BarwardenNativeAutoFill -configuration Debug -destination platform=macOS -derivedDataPath /private/tmp/barwarden-autofill-task3-final2 CODE_SIGNING_ALLOWED=NO test` — 26 tests, 0 failures.
- Rust: `cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml` — 169 passed, 0 failed, 4 ignored. The added ignored case is the explicitly invoked signed main-app harness.
- Native project/wrapper: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer node --test scripts/native-autofill-project.spec.mjs` — 13 passed, 0 failed.
- Command/recovery guards: 7 passed, 0 failed.
- Full repository regression: `npm test -- --reporter=dot` — 231 files passed, 2 skipped; 3,462 tests passed, 22 skipped.
- `cargo fmt --check`, `git diff --check`, and production Tauri config/entitlement no-diff checks passed.

## Limitations and deferred work

- The signed harness proves the real Rust and Swift clients plus live `LOCAL_PEERPID`/Security.framework authorization, but it does not install or invoke the Credential Provider through AuthenticationServices. Provisioning, embedded installation, notarization, and stapling remain Task 9 gates.
- `status` and `lock` currently perform authenticated transport acknowledgement only. Projection/key generation, lease state, and destructive lock behavior belong to Task 4.
- Replay memory is process-local and intentionally resets when the Agent restarts; the Agent holds no projection key or credential state in Task 3.
- Xcode 26.6 still reports the inherited warning that its XCTest support libraries target macOS 14 while production sources compile with the required `-target ...-apple-macos13.0`. Both shipping products build at the macOS 13 floor.
- Production `tauri.conf.json` and production entitlements were not changed. Browser extension, projection, matching, UI, Accessibility, and secret-release work were not added.
