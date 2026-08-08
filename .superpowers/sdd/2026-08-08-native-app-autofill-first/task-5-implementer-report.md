# Task 5 implementer report — native candidate matching

## Outcome

Task 5 is implemented without adding AutoFill UI, Accessibility behavior, browser behavior, production configuration, entitlements, or a secret-returning fill path.

- `MatchingEngine` produces only `RankedCandidate` metadata: opaque cipher ID, display name, username, group, fixed reason, and mismatch-confirmation flag.
- Display order is deterministic and degrades through `exact`, `relevant`, and `other` groups. Signal priority is user binding, exact service identifier, reviewed built-in preset, exact vault URI rule, host/registrable domain, fuzzy app/vendor/service name, explicit-success history, favorite, recent, and stable normalized name/username/cipher-ID tie-break.
- A non-empty all-Login query searches every active Login by normalized name, username, and projected URI rather than filtering to the current app context. Empty or whitespace-only query uses contextual ranking.
- Every fuzzy/history/favorite/recent/otherwise-unmatched candidate requires mismatch confirmation. No candidate query can return a password, TOTP seed, URI, or service identifier.
- User bindings and successful-selection history are account-scoped. Orphan bindings cannot elevate a missing or inactive cipher. History records only explicit successful choices. Both are included inside the existing encrypted account projection and are deleted only after native account-projection removal succeeds.

## Matching and normalization boundaries

- Text uses NFC plus POSIX case folding. URL parsing supplies IDNA host canonicalization; visually confusable Unicode hosts are not transliterated or treated as equivalent.
- Bitwarden `exact`, `startsWith`, `host`, and `baseDomain` URI rules are handled explicitly. `never` cannot contribute exact, preset, or host/domain relevance.
- Registrable-domain matching uses a small, local, reviewable common-suffix subset. No network or large unmaintained dataset was added. Unknown suffixes fail closed and therefore cause conservative false negatives instead of cross-site matches.
- `AppPresets.json` contains only minimal bundle-ID-to-canonical-service mappings. Strict decoding rejects extra keys such as cipher IDs or credential data.

## Agent and release boundary

- Candidate queries reuse Task 3 peer authentication and Task 4 `ProjectionStore.read(accountID:generation:)`, so active lease, account, lock generation, epoch, and projection authentication remain authoritative. Both the signed main app and signed Credential Provider can query; projection provision, renewal, and lock remain main-app-only.
- Query responses are strict metadata-only envelopes. A separate `release_secret` request contract binds account, candidate ID, requested field, opaque context token, lock generation, mismatch acknowledgement, and reprompt result.
- `CandidateAuthorizationStore` signs no ambient state: it issues an unpredictable opaque UUID token only for candidates present in the current query result and current projection. Records have a 30-second lifetime, a 4,096-record bound, are single-use, and are cleared on lock/provision. Duplicate projection/candidate IDs fail closed.
- Release validation rechecks the current projection lease and candidate membership, consumes the token, enforces mismatch confirmation, and delegates reprompt grants to a separate verifier. Task 5 deliberately ends with `unavailable`; Task 6 owns actual secret release and fill UI.
- Matching metadata remains protected by Task 4's ChaCha20-Poly1305 projection encryption and exact account/ownership-epoch binding. The encryption algorithm was not changed.

## TDD evidence

RED was observed before each implementation slice: missing matching types/files; ranking priority and all-Login search assertions; preset schema rejection; TypeScript candidate/binding services; projection bindings/history/recent wire schema in TypeScript, Rust, and Swift; Agent query dispatch; authorization store; release contract; shared Agent client query; binding-change reprojection; `never` URI isolation; strict response/release field allowlists; account cleanup; and duplicate-ID authorization handling. The final duplicate-ID RED failed the focused Xcode test before the fail-closed guard was added.

GREEN/property coverage includes:

- exact/relevant/other ordering, account-scoped binding override, orphan-binding denial, URI match modes, public-suffix boundary, IDNA/case/NFC, confusable-host separation, all-Login and empty-query behavior;
- history/favorite/recent priority and 48 input permutations proving stable ordering and no secret serialization;
- metadata-only Agent wire responses, signed-provider query, current projection lease checks, single-use/expiry/account/generation/candidate token binding, mismatch/reprompt enforcement, and unavailable secret release;
- explicit-success-only history, account cleanup after native deletion, and matching-state projection replacement without a vault mutation.

## Verification

- Focused TypeScript candidate/projection: 17 passed.
- Focused Rust projection: 28 passed.
- Focused Swift matching/Agent: 32 passed.
- Full TypeScript: 3,484 passed, 22 skipped.
- Full Rust: 200 passed, 4 ignored.
- Full Xcode: 72 passed.
- Native project/wrapper contract: 13 passed.
- Production web build: passed (existing browser-externalization, Tailwind, and chunk-size warnings only).
- `cargo fmt --check`, `git diff --check`, and production config/entitlement diff checks: passed.

## Residual consideration

The deliberately small public-suffix subset trades recall for safety. Services on unknown or newly delegated suffixes will not receive registrable-domain relevance until the reviewed local mapping is extended; exact service, explicit URI rules, presets, and user bindings continue to work.
