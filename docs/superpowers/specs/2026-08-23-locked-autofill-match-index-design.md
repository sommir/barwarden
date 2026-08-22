# Locked-State AutoFill Match Index Design

Date: 2026-08-23

## Problem

Barwarden's foreground application and browser URL observation is a background feature, but the current suggestion pipeline cannot use that context unless the vault UI is unlocked. The menu-bar monitor calls the Agent for its current secret projection session. Locking clears that session and deletes the encrypted projection, so every `status` request returns `locked` and the monitor publishes no suggestions.

This couples two concerns that have different security lifetimes:

- recognizing an application or website and ranking safe credential metadata;
- releasing a fill value, including a password or TOTP value, into a target application.

The regression became visible after the native suggestion monitor replaced the earlier in-popup website matcher. A second bug makes it worse: PIN and Touch ID restoration synchronize the vault but do not publish the unlocked projection, so an otherwise unlocked UI can also leave the Agent without data.

## Goals

- Observe the foreground application and active browser URL independently of popup visibility, input-field focus, and vault UI lock state.
- Continue publishing menu-bar counts and system/floating suggestions while the Barwarden window shows its existing lock screen.
- Never retain passwords, TOTP seeds, notes, session tokens, or a secret-decryption key solely to support locked-state matching.
- Require a live unlocked secret projection before any secret release.
- When a locked user selects a suggestion, open the existing unlock flow and resume only after the target context and candidate are revalidated.
- Preserve the current fail-closed behavior for stale targets, account changes, corrupted storage, authorization failure, and extension cancellation.

## Non-Goals

- Changing the Barwarden lock screen or showing vault rows inside the locked Barwarden window.
- Making password or TOTP secrets available while the vault is locked.
- Depending on focused-field discovery for application or website recognition. Focused-field discovery remains a fill-time concern only.
- Adding passkeys or changing the matching score policy.
- Persisting pending fill requests across application or Agent restarts.

## Architecture

### Two Agent stores

The Agent owns two independent stores.

`MatchIndexStore` is a durable, non-secret matching index. It contains:

- schema version, account ID, index generation, and source vault revision;
- opaque cipher ID;
- display name and username;
- canonical website services and URI match rules;
- explicit application bindings and non-secret ranking history;
- booleans indicating whether username, password, or TOTP is available;
- favorite, reprompt-required, archived, and deleted eligibility flags required by ranking.

It must not contain passwords, TOTP seeds, notes, access/refresh tokens, encryption keys, or a serialized vault item.

`SecretProjectionStore` is the existing encrypted projection and lease. It contains secrets and remains ephemeral. Locking clears the lease key, candidate authorizations, reprompt grants, and encrypted secret projection artifacts.

### Match-index protection

The Agent creates a random match-index key in macOS Keychain under its stable designated requirement. The key does not require biometric presence because the Agent must read the index while the UI is locked. The App Group contains only an authenticated-encrypted index file with mode `0600`; the directory remains mode `0700` and is opened with the existing no-symlink/no-follow checks.

The file uses a distinct magic value and domain-separated AEAD additional data so it cannot be confused with a secret projection. Writes use a temporary file, `fsync`, atomic rename, and directory `fsync`. The store validates owner, mode, device/inode, schema, size limits, canonical services, unique opaque IDs, and the AEAD tag before publishing a snapshot.

On corruption, missing Keychain material, or unsupported schema, the Agent removes the unusable index and returns a fixed `match_index_unavailable` code. It never falls back to parsing untrusted or partially valid records.

### Protocol split

The wire protocol distinguishes matching state from secret state:

- `match_status` returns the active match-index account, generation, and vault revision.
- `query_candidates` consumes a match generation and reads only `MatchIndexStore`.
- `secret_status` returns the current secret projection lease if one exists.
- `release_secret` consumes a candidate authorization produced by a metadata query, but also requires a current secret projection with the same account and vault revision.
- `provision` carries both an explicit match-index payload and the encrypted secret projection provision. The Agent validates both before atomically publishing the new logical revision.
- `lock` clears only secret state.
- `logout_account` removes both secret state and the selected account's match index.

The existing protocol version is bumped. Older main apps, Agents, and providers fail with the fixed protocol-version code instead of silently mixing generations.

### Candidate authorization

Metadata queries may run while locked and return display metadata, available-field flags, rank group, rank reason, and an opaque candidate authorization token. The authorization snapshot includes:

- match-index account, generation, and vault revision;
- canonicalized application/site context digest;
- candidate ID and requested field;
- ranking-policy digest;
- a short expiration.

Secret release additionally proves that the secret projection account and vault revision equal the metadata snapshot. Unlocking and reprojection burns older secret authorizations. A context or vault revision change forces a fresh query.

## Runtime Data Flow

### Sync and publication

After a successful vault sync, the TypeScript projection service builds two explicit models:

1. a safe match index;
2. the existing secret projection input.

Rust validates the safe model independently, encrypts the secret projection as it does today, and sends both to the Agent in one bounded operation. The Agent stages and validates both. Publication succeeds only when both represent the same account and vault revision. On failure, the previous complete match index remains available and the new secret projection is not activated.

PIN and Touch ID restoration must call `publishCurrentUnlockedState()` after successful synchronization and account-status persistence. This closes the observed path where the UI is unlocked but no projection is published.

### Lock, startup, account switch, and logout

- UI lock: clear secret projection and secret grants; keep the active match index.
- Agent or app restart: load and validate the active encrypted match index before starting the monitor; secret state begins locked.
- Account switch: invalidate pending fills, switch the active match-index pointer atomically, then publish the target account after its next successful sync.
- Logout: delete that account's match index, remove its Apple credential identities, clear secret state, and clear suggestions.
- Recovery-required state: retain the safe index for recognition, but all secret releases remain locked until a valid session is restored.

### Independent recognition

The native monitor continues to observe application activation and polls browser URL changes once per second. It no longer receives a `Clear` decision merely because the process broker is locked, signed out, or recovering. It clears only when there is no active match index, the active account is logged out, AutoFill is disabled, context capture fails closed, or the observed target is no longer current.

Application recognition uses bundle ID plus application name. Browser recognition uses the canonical active-tab URL and never falls back to the browser application name when URL capture fails. Neither path reads focused controls.

### Selecting while unlocked

The client re-reads the live application/browser context, re-queries the current match generation, and releases the secret only if the candidate, account, field, context digest, and secret vault revision still match. Fill-time field inspection remains bounded to the selected action.

### Selecting while locked

The floating Barwarden suggestion path creates an in-memory, single-use pending fill containing only the opaque candidate ID, field, match generation, and original context digest. It raises the existing Barwarden lock window. The pending fill is erased on cancellation, timeout, account change, target change, lock-epoch change, or process termination.

After unlock and secret publication, the app restores the original target, reads its application/browser context again, runs a fresh metadata query, and continues only if the same candidate remains eligible. It then performs the normal field-specific fill.

For macOS Password AutoFill, `provideCredentialWithoutUserInteraction` returns `ASExtensionError.userInteractionRequired` when the secret store is locked, as required by AuthenticationServices. The system then presents the extension interface. That interface shows the selected safe identity and an Open Barwarden action. It uses the extension context to open the containing app's existing lock route and keeps a bounded request watcher. If the extension request remains active when the secret revision becomes available, it revalidates and completes. If the host cancels or suspends the request, it ends safely and the identity remains available for a retry after unlock.

## Error Handling and Privacy

- Logs contain only fixed stage, operation, and error codes. Match names, usernames, URLs, bundle IDs, tokens, file paths, and vault payloads are not logged.
- A corrupt index never affects the vault or secret projection. It produces no suggestions until the next sync rebuilds it.
- A stale metadata result never authorizes a secret from another account, generation, revision, service, or application context.
- Missing Accessibility or browser-automation permission clears the affected live context instead of using broad fallback matches.
- Timeouts and Agent unavailability retain the last safe visible suggestion only where the existing stale-while-revalidate contract allows it; they never retain a secret authorization.
- The existing Barwarden lock route and vault UI remain unchanged.

## Migration

The first compatible unlocked sync creates the encrypted match index. Until that happens, locked-state recognition is unavailable and the Agent reports a fixed missing-index state. Existing Apple credential identities remain preserved across lock and are replaced after the first compatible sync.

Old secret projection files are removed through the existing recovery ledger. The match index uses a different filename suffix and recovery ledger so a secret lock cannot delete metadata and metadata recovery cannot retain a secret artifact.

## Testing

### Swift

- match-index encode/decode round trip and size/canonicalization bounds;
- encrypted persistence, atomic replacement, file permissions, no-follow behavior, corruption and missing-key recovery;
- restart restores metadata but not secret lease;
- lock preserves metadata queries while `release_secret` returns `locked`;
- logout removes metadata;
- account/revision/context mismatch rejects secret release;
- protocol operations log only fixed codes;
- credential provider lists identities while locked and maps secret release to interactive unlock.

### Rust

- split input validation rejects any secret field in the match model;
- lock no longer deletes or clears match-index suggestions;
- logout and account switch lifecycle decisions are explicit;
- application and browser monitors query match status without focused-field dependencies;
- browser failure remains fail closed;
- projection transaction and recovery tests cover partial failures between metadata and secret publication.

### TypeScript

- PIN and Touch ID restoration publish unlocked authority and reprojection after sync;
- match model contains only allowed metadata;
- locked selection creates an ephemeral pending fill and raises the existing lock route;
- unlock resumes only after target and candidate revalidation;
- cancellation, timeout, navigation, account switch, and target change erase pending state.

### Signed runtime verification

- build all focused Swift, Rust, and TypeScript suites;
- build the native AutoFill app and components;
- sign Agent, provider, then outer app with the approved Developer ID and entitlements;
- pass strict/deep code-sign verification;
- with Barwarden locked, switch between a normal app and browser URLs and verify the menu count and suggestions change without focusing a field;
- select a locked suggestion, unlock, and verify safe continuation;
- change the target during unlock and verify no fill occurs;
- verify logout removes locked-state suggestions;
- remove the temporary signing Keychain and working material after verification.

## Acceptance Criteria

1. Barwarden may remain on its existing lock screen while application/site recognition and safe suggestions continue.
2. Recognition does not depend on an editable control or focused field.
3. No password, TOTP seed, session token, note, or secret projection key survives UI lock for matching purposes.
4. Secret filling while locked always enters an unlock interaction and revalidates the target afterward.
5. PIN, Touch ID, and master-password unlock paths all publish the same projection lifecycle.
6. Restart, corruption, account switch, logout, and stale-context behavior fail closed and are covered by automated tests.
