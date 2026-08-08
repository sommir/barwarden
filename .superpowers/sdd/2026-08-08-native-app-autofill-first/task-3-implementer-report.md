# Task 3 Implementer Report: Authenticated Native AutoFill IPC

## Outcome

- Added a macOS 13 Unix-domain-socket Agent server and bounded Swift/Rust clients using one request per connection, four-byte big-endian framing, UTF-8 JSON, a 65,536-byte payload ceiling, and read/write deadlines. Server reads use one monotonic absolute deadline across header and payload.
- The Agent binds identity to the accepted socket's `LOCAL_PEERTOKEN`, cross-checks its PID against `LOCAL_PEERPID`, creates the live dynamic guest from `kSecGuestAttributeAudit`, and accepts only Team `K7LY92JY96` with bundle ID `com.sommir.barwarden` or `com.sommir.barwarden.credential-provider`.
- Caller-provided `pid`, `team_id`, and `bundle_id` JSON fields are ignored. Authentication is evaluated before any JSON decode or operation dispatch, and authentication failure takes priority over framing details.
- Added protocol-version and bounded process-lifetime request-ID replay rejection, fresh UUID request IDs, cryptographically generated 32-byte Swift nonces, OS-random UUID-backed 32-byte Rust nonces, exact nonce/request correlation, `SO_NOSIGPIPE`, and fixed sanitized error codes.
- Wired `autofill_agent_probe`, `autofill_agent_status`, and `autofill_agent_lock` into `main.rs` and the existing Tauri native-command surface. Task 3 operations acknowledge with the exact nonce only; projection/key lock semantics remain intentionally deferred to Task 4.

## Security boundary

The accepted socket descriptor is the sole identity input. `PeerIdentityVerifier` obtains the full 32-byte `LOCAL_PEERTOKEN` audit token and `LOCAL_PEERPID`, rejects a missing token or PID mismatch, and passes the audit token as `kSecGuestAttributeAudit` to `SecCodeCopyGuestWithAttributes`. One `SecRequirement` checks the Apple code-signing anchor, leaf Team OU `K7LY92JY96`, and the exact two allowed signing identifiers before signing information is mapped to an `AuthorizedPeer`. PID is an additive consistency check and is never used to select the `SecCode`, which closes the PID-reuse gap. Missing credentials, unsigned/ad-hoc code, a wrong Team ID, and every non-allowlisted identifier resolve to the same `unauthorized` code.

The Agent authenticates before reading or parsing the frame. An unauthorized connection receives only the fixed `unauthorized` response, followed by a 25 ms absolute, 65,540-byte maximum poll/nonblocking drain and close; a drip-fed client cannot extend that bound. Authorized connections read under one monotonic absolute deadline across header and payload. The accept loop dispatches through an eight-slot concurrent executor and immediately closes excess accepted sockets, so a handler cannot serialize or grow the server without bound.

The replay gate remembers at most 4,096 request IDs for the Agent process lifetime. At capacity it rejects every new ID with fixed `request_capacity`, does not evict an old ID, and continues to reject every remembered replay. Restarting the Agent begins a new process lifetime.

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

The review fix makes this evidence reproducible through repository entry `scripts/run-native-autofill-ipc-harness.sh` and its checked-in Swift client fixture. It skips by default. Explicit execution requires `RUN_SIGNED_AUTOFILL_IPC_HARNESS=1` plus `AUTOFILL_SIGNING_IDENTITY` naming a locally available Keychain identity. The script derives the repository location, uses only a private temporary directory, checks the public Team identifier, creates a fresh Agent/socket for each route, and deletes all temporary artifacts. It contains no identity name/hash, certificate path, key path, password, or other signing secret.

## Review-fix TDD evidence

- RED 1: focused Xcode compilation exited 65 because the new tests referenced absent audit-token credentials, bounded executor, replay capacity, and sanitized `request_capacity` APIs.
- GREEN 1: the focused `PeerIdentityVerifierTests` and `AgentClientServerTests` suite passed after the minimum audit-token verifier, absolute deadline, bounded executor, and fail-closed replay gate were added. The production products compiled with `-target arm64-apple-macos13.0`; the real socket seam confirmed `LOCAL_PEERTOKEN` returns exactly `MemoryLayout<audit_token_t>.size` (32 bytes) and that its PID matches `LOCAL_PEERPID`. PID extraction uses Apple's public `audit_token_to_pid` API (available since macOS 10.8) through the system `libbsm`, rather than depending on the token's internal word layout.
- RED 2: repeated focused execution exposed an unauthorized close race: the Swift client occasionally received transport failure instead of the fixed code when the server closed before the request bytes arrived.
- GREEN 2: replacing the one-shot drain with a 25 ms absolute, size-bounded poll/nonblocking drain made the unauthorized response stable. The close-race and no-frame slowloris tests passed 10 consecutive iterations.
- Focused behavior now covers header/payload drip-feed absolute timeout, unauthorized no-frame slowloris, backlog rejection without waiting, capacity recovery, a normal client completing beside an authorized slowloris, missing token, token/PID mismatch, PID-reuse seams, replay exhaustion, and preservation of old replay IDs.
- Harness REDs were kept factual: the first repository-script run exited 141 because `pipefail` observed the signing-details producer's `SIGPIPE`; a later run showed the Swift fixture was not using the Debug socket override; and a third showed a Unix socket pathname exceeding `sockaddr_un`. Captured signing details, `-D DEBUG`, and short private socket names corrected the harness without weakening production behavior.
- Final repository harness: Rust main success; Swift Credential Provider success; same-Team wrong-bundle fixed `unauthorized`; ad-hoc/no-Team fixed `unauthorized`; exit 0. Each route used a fresh Agent/socket.

## Final verification

- Swift/Xcode: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -scheme BarwardenNativeAutoFill -configuration Debug -destination platform=macOS -derivedDataPath /private/tmp/barwarden-autofill-task3-final2 CODE_SIGNING_ALLOWED=NO test` — 26 tests, 0 failures.
- Rust: `cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml` — 169 passed, 0 failed, 4 ignored. The added ignored case is the explicitly invoked signed main-app harness.
- Native project/wrapper: `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer node --test scripts/native-autofill-project.spec.mjs` — 13 passed, 0 failed.
- Command/recovery guards: 7 passed, 0 failed.
- Full repository regression: `npm test -- --reporter=dot` — 231 files passed, 2 skipped; 3,462 tests passed, 22 skipped.
- `cargo fmt --check`, `git diff --check`, and production Tauri config/entitlement no-diff checks passed.

Review-fix final evidence supersedes the earlier counts where they differ:

- Swift/Xcode: full `BarwardenNativeAutoFill` test action with Xcode Developer directory fixed to `/Applications/Xcode.app/Contents/Developer` — 36 passed, 0 failed, 0 skipped. Result-bundle summary reported `totalTestCount: 36`.
- Unauthorized close-race stress: the fixed-code client test and unauthorized no-frame slowloris test, 10 iterations — passed.
- Rust: full `cargo test` — 170 passed, 0 failed, 4 ignored. The signed case remains explicitly ignored in default runs and is invoked by the opt-in harness.
- Native project/wrapper: 13 passed, 0 failed.
- Signed four-way repository harness: exit 0 with all four expected results.
- Full repository Vitest: 231 files passed, 2 skipped; 3,462 tests passed, 22 skipped.
- `cargo fmt --check`, harness `bash -n`, default harness skip, `git diff --check`, and production Tauri config/entitlement no-diff checks passed.

## Limitations and deferred work

- The signed harness proves the real Rust and Swift clients plus live `LOCAL_PEERTOKEN`/`LOCAL_PEERPID`/Security.framework authorization, but it does not install or invoke the Credential Provider through AuthenticationServices. Provisioning, embedded installation, notarization, and stapling remain Task 9 gates.
- `status` and `lock` currently perform authenticated transport acknowledgement only. Projection/key generation, lease state, and destructive lock behavior belong to Task 4.
- Replay memory is process-local, capped at 4,096 IDs, fails closed when full, and intentionally resets when the Agent restarts; the Agent holds no projection key or credential state in Task 3.
- Xcode 26.6 still reports the inherited warning that its XCTest support libraries target macOS 14 while production sources compile with the required `-target ...-apple-macos13.0`. Both shipping products build at the macOS 13 floor.
- Production `tauri.conf.json` and production entitlements were not changed. Browser extension, projection, matching, UI, Accessibility, and secret-release work were not added.
