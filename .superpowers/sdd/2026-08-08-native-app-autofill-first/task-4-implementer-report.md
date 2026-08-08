# Task 4 Implementer Report: Encrypted Native AutoFill Projection

## Outcome

- Added a narrow projection schema containing only `version`, `accountId`, `vaultRevision`, `createdAt`, and active Login records. The Angular boundary allowlists only cipher ID, name, username, password, URI/match type, TOTP, favorite, and reprompt; Card, Identity, Secure Note, SSH Key, session tokens, master password, PIN, device/user key, notes, and custom fields are never forwarded.
- Added a serialized Rust projection manager. Each unlock generation receives a fresh OS-random 256-bit key and UUID generation; same-generation mutations retain that key while requiring a strictly increasing revision. Account switch and post-lock replacement create a new key/generation.
- Defined one Rust/Swift envelope: ASCII magic `BWAFPRJ1`, big-endian format version `1`, and a random 96-bit nonce. Those canonical 22 header bytes are ChaCha20-Poly1305 authenticated data; ciphertext is followed by CryptoKit-compatible 16-byte tag.
- Serialization and encryption occur in memory. Sensitive Rust plaintext structures, serialized bytes, keys, and IPC request buffers are zeroized. Swift stores the leased key in an exclusively allocated zeroizing wrapper and clears decrypted and framed transient `Data` buffers.
- The writer uses a unique `create_new` temporary file with mode `0600`, writes and `fsync`s it, atomically renames it, and `fsync`s the directory. Interrupted writes clean the temporary path. A failed Agent provision removes the renamed projection, syncs the directory, drops writer lease state, and requests Agent lock.
- Extended the authenticated Task 3 protocol with provision and lease-renewal operations. Only the already verified signed main application may provision or renew. The Agent binds key access to account, generation, revision, projection root, and a bounded lease; lock, account replacement, proactive timeout, and process restart clear or omit key state.
- Registered `autofill_replace_projection`, `autofill_clear_projection`, and `autofill_lock_projection`. Angular serializes native operations, writes only after unlocked fresh sync/mutation, invalidates queued work on lock, locks on every unlocked-to-locked transition, and clears the projection before other logout/account-removal cleanup.

## TDD evidence

- Rust RED: the first focused build reported 23 unresolved projection writer/schema/crypto symbols. The IPC batch then failed on the absent projection provision request shape. Minimal implementation brought the focused projection/IPC suite to green.
- Rust safety RED: a reprovision-failure test proved the old in-memory lease remained after the renamed new projection was deleted. The failure path now drops state and locks the Agent; the test passes.
- Swift RED: the new tests initially failed to compile because projection material, envelope, store, and protocol operations did not exist. Focused tests then exposed an account-switch fixture mismatch, which was corrected without weakening production validation.
- Swift timeout RED: the proactive expiration test failed to compile because the store had no timeout zeroization observer/timer path. A one-shot dispatch timer, renewed with the bound generation, made the test green.
- TypeScript RED: projection and cleanup tests initially failed because the service/host lifecycle did not exist. A later security-order RED showed account removal could fail before projection cleanup; projection deletion now runs first.
- Full-regression RED: two recovery-overlay guards detected that adding commands to the shared Tauri host expanded a pinned runtime closure. The projection commands were moved into a narrow standalone host adapter; the affected guard/projection suite passed 12/12 and the repeated full suite passed.
- Dependency resolution: `zeroize` is pinned to `1.8.2` with derive support because the available registry cache did not contain the derive release selected by unpinned `1.9.0`. ChaCha20-Poly1305, SHA-256, RNG, and zeroization dependencies resolve from the final lockfile.

## Security and transaction coverage

- Disk leakage fixtures assert that encrypted bytes contain none of the synthetic username, password, URI, or TOTP seed.
- Angular leakage fixtures inject synthetic access/refresh tokens, user/device key material, secure notes, a custom master-password field, Card data, and SSH data, then assert none occurs in the native input.
- Corrupt authentication tags and mismatched account/revision fail closed with fixed sanitized codes. Same-account stale/equal revisions cannot replace the current file.
- Interruption after temporary-file sync preserves the current projection and removes the temporary file. Successful account switch removes the prior account file and uses a different generation and key.
- Provision/renew requires signed-main-app authorization and exact account/generation binding. Credential Provider provision is rejected. Lease expiration proactively zeroizes without requiring a subsequent read; restart begins with no lease.
- Operations are serialized in Angular and again by the Rust manager, preventing writer re-entry and serializing replace/clear/lock state transitions.

## Final verification

- `npm test -- --reporter=dot` — exit 0; 232 files passed, 2 skipped; 3,467 tests passed, 22 skipped.
- `npm run build:web` — exit 0; production web build completed with the existing bundle-size, browser-externalization, and Tailwind-at-rule warnings.
- Full Rust `cargo test` — exit 0; 179 passed, 0 failed, 4 ignored. Ignored tests require the signed Agent, Touch ID, or local Keychain harnesses.
- Full `BarwardenNativeAutoFill` Xcode test action — exit 0; 46 passed, 0 failed, 0 skipped. The caller supplied `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`; no global Xcode selection was changed.
- Native project, bundle, identity, and contract checks — exit 0; 32 passed, 0 failed.
- Focused final projection checks — TypeScript 8/8; Rust 17 passed plus 1 signed harness ignored; Swift Agent/ProjectionStore 23/23.
- `cargo fmt --check`, `git diff --check`, and no-diff checks for production `tauri.conf.json` and native entitlements passed.

## Limitations and deferred work

- The existing signed cross-language Task 3 harness remains ignored by default and was not rerun with a signing identity in this task. The unsigned Swift suite covers the final dispatch/store behavior; release signing and installation remain Task 9 gates.
- An Agent restart intentionally loses the in-memory key and lease. The encrypted projection may remain on disk until the next replacement, logout, or account removal, but it cannot be decrypted by the restarted Agent without a new authenticated provision.
- Xcode 26.6 still emits the inherited warning that its XCTest support libraries target macOS 14 while shipping sources compile at the required macOS 13 deployment target.
- Matching, all-Login search, Credential Provider UI, main-app picker, Accessibility actions, browser integration, and any secret-release path are outside Task 4 and were not implemented.
