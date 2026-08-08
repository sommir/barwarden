# Task 4 Implementer Report: Encrypted Native AutoFill Projection

## Outcome

- The projection remains a strict allowlist: `version`, `accountId`, native-owned `vaultRevision`, `createdAt`, and active Login cipher ID/name/username/password/URI match data/TOTP/favorite/reprompt. Card, Identity, Secure Note, SSH Key, notes, custom fields, access/refresh tokens, master password, PIN, and device/user keys never cross the Angular projection boundary.
- Account identity is captured with the exact unlocked session reference, vault-items reference, and lifecycle epoch. The service validates that snapshot and active account around every asynchronous lookup/native write. A real account switch synchronously invalidates the epoch, obtains an acknowledged native lock, and only then persists `setActive`; lock failure preserves the prior account and surfaces a sanitized error.
- Revision allocation is process-wide and native-authoritative. UI windows no longer supply counters; one Rust manager mutex allocates monotonically increasing same-generation revisions and returns the committed revision. Parallel-writer tests receive exactly revisions 1 through 8.
- Each unlocked generation uses an OS-random 256-bit key and UUID. Rust and CryptoKit share the `BWAFPRJ1` envelope, big-endian format version, 96-bit random nonce, canonical authenticated 22-byte header, ChaCha20-Poly1305 ciphertext, and 16-byte tag.
- The Rust transaction is rooted in a verified `0700`, current-user directory FD. Temporary files use `openat(O_CREAT|O_EXCL|O_NOFOLLOW)` mode `0600`; final/backup/cleanup operations use `fstatat(AT_SYMLINK_NOFOLLOW)`, `renameat`, `unlinkat`, and directory-FD `fsync`. Existing files must be current-user regular files, mode `0600`, with exactly one link.
- Replacement keeps a recoverable backup until Agent provision commits. Rename/directory-sync faults restore the old file; provision faults restore or remove the candidate and revoke the Agent; post-commit old-file/backup cleanup and cleanup-fsync faults are retained as retryable pending work. A secondary rollback failure becomes pending-lock state and can never renew an uncertain lease.
- Native lock deletes and syncs the encrypted file before IPC. If Agent lock fails, Rust retains pending state, suppresses renewal, and heartbeat retries until acknowledgement; Angular performs bounded retries and surfaces a localized fixed error for an exhausted background lock. Clear and replace are also retryable.
- The Agent accepts provision, renew, and lock only from the authenticated signed main application; Credential Provider lock is explicitly unauthorized. One `NSLock` covers transition validation, verified-FD decrypt, and installation. Equal/older revisions, cross-account/generation transitions without lock, and retired-generation return are rejected under concurrent requests.
- Swift opens a verified current-user `0700` root with `O_DIRECTORY|O_NOFOLLOW`, binds its device/inode to the requested root, opens the projection with `openat(O_NOFOLLOW)`, and requires current-user regular `0600`, `nlink == 1`. It reads exactly the bounded `fstat` size (maximum 16 MiB) from that same FD and stores device/inode in the lease, so unlink/replace/swap cannot redirect future reads.
- Provision keys use one base64 JSON `Data` value rather than `[UInt8]`. Rust zeroizes the encoded string, request payload/frame, key vectors, plaintext model, and serialized plaintext. Swift clears framed `Data`, decoded provision payload, the provision transfer object, decrypted plaintext, and the application-owned lease key buffer.

## Security-review TDD evidence

- Critical account switch RED: focused TypeScript initially had seven failures, including a UI-supplied revision, absent invalidation/lock, no retry, an A-items/B-account interleaving, and `setActive` occurring without an acknowledged lock. GREEN: service/AuthFacade focused suite is 178/178 after adding immutable identity/epoch checks, pre-persistence lock, bounded retry, and sanitized failure propagation.
- I1/I4/I7 Swift RED: four focused failures proved Credential Provider could lock, the key encoded as a byte array, equal revision could reinstall, and an old generation could return. GREEN adds main-app-only lock, base64 `Data`, locked monotonic transitions, retired generations, and an observable decoded-buffer clear seam.
- I2/I3/I5 Rust RED: native revision tests returned caller values, failed lock dropped state, and key wire shape was incompatible. Filesystem RED then showed root symlink, final symlink/hardlink, insecure mode, and same-account provision rollback failures. GREEN focused projection suite is 20/20 with native revision allocation, pending lock, dirfd operations, backup/rollback, recoverable cleanup, and secondary-rollback fail-closed tests.
- I6 Swift RED: the hardened tests failed to compile because there was no verified-file-open seam or metadata validator. GREEN rejects root/final symlink, hardlink, directory, foreign-owner/mode/link-count metadata, and proves open-after-swap reads only the original verified FD while later lease reads require the installed inode.
- Additional RED/GREEN: transient native clear initially rejected without retry; background lock exhaustion was silently swallowed; the full source audit rejected a static English error; and the recovery overlay rejected the changed i18n runtime hash. Clear retry, localized surfaced failure, and the repository manifest updater closed each failure.

## Fault and leakage coverage

- Deterministic account-switch interleavings assert A-only username/password bytes cannot be emitted with B's account ID. AuthFacade tests assert projection lock precedes persistent active-account selection and a missing acknowledgement prevents `setActive`.
- Disk fixtures search encrypted bytes for the synthetic username, password, URI, and TOTP and find none. Angular fixtures inject synthetic access/refresh tokens, user/device keys, Secure Note, custom master-password data, Card, and SSH data and assert none appears in native input.
- Fault seams cover interruption after temp sync, backup rename, final rename/directory commit, provision failure, rollback failure, old-account/backup cleanup, and cleanup directory sync. Pending work is retried without repeating an already committed Agent transition.
- Filesystem tests cover root/final/temp symlink, final/temp hardlink, directory type, owner/mode/link-count validation, temp `0600`, and root pathname swap. Rust revalidates root pathname device/inode before Agent provision; Swift binds read and lease to verified FDs/inodes.
- Concurrent Agent requests cannot install equal/older revisions; new generation/account requires an acknowledged lock; retired generations cannot return. Lock, account switch, timeout, and process restart all deny prior key access.

## Final verification

- `npm test -- --reporter=dot` — exit 0; 232 files passed, 2 skipped; 3,473 tests passed, 22 skipped.
- `npm run build:web` — exit 0; production web build completed with the existing browser-externalization, Tailwind-at-rule, and bundle-size warnings.
- Rust `cargo fmt --check && cargo test` — exit 0; 191 passed, 0 failed, 4 ignored. The ignored tests require the signed Agent, Touch ID, or local Keychain harnesses.
- Full `BarwardenNativeAutoFill` Xcode test action — exit 0; 56 passed, 0 failed, 0 skipped. Commands used caller-scoped `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`; global Xcode selection was not changed.
- Native project/IPC portability tests — exit 0; 17 passed. Native identity/contract tests — exit 0; 19 passed.
- Focused final security checks — TypeScript AutoFill/AuthFacade 178/178; Rust projection 20/20; Swift full native 56/56.
- `git diff --check`, production `tauri.conf.json` no-diff, and native entitlement no-diff checks pass.

## Limitations and deferred work

- Application-controlled key/plaintext copies are explicitly cleared. Foundation `JSONDecoder` and CryptoKit may create internal implementation buffers that this code cannot observe or independently prove zeroized; this report does not claim otherwise.
- The signed cross-language Task 3 harness remains opt-in/ignored in the Rust default suite. Its portability tests pass, and the unsigned Swift suite covers final dispatch/store behavior; release signing and installed-app execution remain Task 9 gates.
- Agent restart intentionally loses its in-memory lease/key. A stale encrypted file may remain until pending cleanup, replacement, logout, or account removal, but cannot be decrypted without a new authenticated provision.
- Xcode 26.6 emits the inherited warning that its XCTest support libraries target macOS 14 while all shipped sources compile at the required macOS 13 deployment target.
- Matching, ranking, Credential Provider UI, main-app picker, Accessibility actions, browser integration, and secret release are outside Task 4 and remain deferred.
