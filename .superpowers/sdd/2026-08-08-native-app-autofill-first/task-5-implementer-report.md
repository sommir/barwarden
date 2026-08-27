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
- The projection boundary uses Bitwarden's canonical numeric URI values: `0 domain`, `1 host`, `2 startsWith`, `3 exact`, `4 regularExpression`, and `5 never`. Unknown values fail closed; regular expressions are deliberately unsupported and fail closed; `never` and regex entries contribute no exact, preset, fuzzy, query, host, or domain signal.
- Exact URL comparison canonicalizes schemeless services without discarding port, percent-encoded path, or query, and explicitly ignores fragments. Host extraction is separate. `startsWith` additionally requires the same canonical host, so `example.test.evil` cannot inherit an `example.test` rule.
- Bitwarden Host matching compares a normalized hostname plus the saved URI's optional port rule. No saved port leaves the detected port unconstrained; a saved port must equal the detected URI's effective port, so saved HTTPS `:443` matches HTTPS with no explicit port while `:8443` remains distinct. IPv4 and IPv6 literals are normalized through their binary address representation before comparison.
- Registrable-domain matching uses a local fail-closed allowlist generated from the pinned `publicsuffix/list` revision `e1b8015c3b2f0f4f8c18659c2480fc1a22c07b20`, licensed MPL-2.0. Both values are enforced at decode time. Reviewed private suffixes cover `github.io`, `pages.dev`, `vercel.app`, and `appspot.com`; cross-tenant matches and unknown/new delegations fail closed while exact-host matching still works. No network or unmaintained large dataset was added.
- `AppPresets.json` contains only minimal bundle-ID-to-canonical-service mappings. Strict decoding rejects extra keys such as cipher IDs or credential data.

## Agent and release boundary

- Candidate queries reuse Task 3 peer authentication and run inside Task 4 `ProjectionStore`, so active lease, account, lock generation, epoch, projection authentication, and vault revision remain authoritative. Both the signed main app and signed Credential Provider can query; projection provision, renewal, and lock remain main-app-only.
- Query responses are strict metadata-only envelopes. A separate `release_secret` request contract binds account, candidate ID, requested field, opaque context token, lock generation, mismatch acknowledgement, and reprompt result.
- `CandidateAuthorizationStore` signs no ambient state: it issues an unpredictable opaque UUID token only for candidates present in the current query result and current projection. Each record binds vault revision, canonical context digest, policy digest, account, and generation. SHA-256 inputs use versioned domain separators, length-prefixed fields, and explicit collection counts to avoid concatenation ambiguity. Records have a 30-second lifetime, a 4,096-record bound, are single-use, and are cleared on lock/provision. Duplicate projection/candidate IDs fail closed.
- Query snapshot/ranking/digest/token issuance is one `ProjectionStore` transaction. Release atomically takes and removes its authorization record immediately after entering the transaction lock, before any lease, revision, context, policy, or candidate check. Every success or failure therefore consumes the token permanently. It then revalidates current state, enforces mismatch confirmation and reprompt, and executes the future secret-access operation under the same lock. Provision cannot interleave snapshot and issuance; lock cannot interleave take, revalidation, and operation. Reprompt, URI, secret, or candidate deletion changes make an issued token stale. Task 5 deliberately ends with `unavailable`; Task 6 owns actual secret release and fill UI.
- Authenticated projection validation rejects the whole projection for duplicate active cipher IDs, duplicate normalized bundle bindings, duplicate normalized `(context,cipher)` history, or dangling binding/history references. History and recent timestamps are numeric UTC epoch milliseconds; only explicit successful selections update real usage time. Recent candidates sort by descending positive usage epoch within the recent group before the stable text tie-break; nil, zero, and negative values remain in the lower `other` group.
- Matching metadata remains protected by Task 4's ChaCha20-Poly1305 projection encryption and exact account/ownership-epoch binding. The encryption algorithm was not changed.

## TDD evidence

RED was observed before each implementation slice: missing matching types/files; ranking priority and all-Login search assertions; preset schema rejection; TypeScript candidate/binding services; projection bindings/history/recent wire schema in TypeScript, Rust, and Swift; Agent query dispatch; authorization store; release contract; shared Agent client query; binding-change reprojection; `never` URI isolation; strict response/release field allowlists; account cleanup; and duplicate-ID authorization handling.

The security-review REDs additionally covered every numeric URI wire value and unknown/string inputs; schemeless canonical URL preservation; private-suffix tenant separation and unknown delegation; duplicate/dangling projection metadata; UTC epoch usage; context/policy digest changes; missing atomic ProjectionStore APIs/hooks; deterministic provision-between-read/issue and lock-between-read/consume races; reprompt/URI/deletion changes; and rejection of an unreviewed same-length PSL revision. The final residual RED proved mismatched tokens survived prechecks, Host rules ignored ports/IPv6 normalization, and recent candidates fell through to text ordering. Each failed for the intended behavioral reason before its production change.

GREEN/property coverage includes:

- exact/relevant/other ordering, account-scoped binding override, orphan-binding denial, URI match modes, public-suffix boundary, IDNA/case/NFC, confusable-host separation, all-Login and empty-query behavior;
- history/favorite/recent priority and 48 input permutations proving stable ordering and no secret serialization;
- metadata-only Agent wire responses, signed-provider query, current projection lease checks, single-use/expiry/account/generation/candidate token binding, mismatch/reprompt enforcement, and unavailable secret release;
- explicit-success-only history, account cleanup after native deletion, and matching-state projection replacement without a vault mutation.
- transaction-level token authorization across provision, lock, revision, canonical context, policy, reprompt, URI, secret, and deletion changes.

## Verification

- Focused TypeScript candidate/projection: 20 passed.
- Focused Rust projection: 30 passed.
- Focused Swift matching/ProjectionStore: 41 passed.
- Full TypeScript: 3,487 passed, 22 skipped.
- Full Rust: 202 passed, 4 ignored.
- Full Xcode: 85 passed.
- Native project/wrapper contract: 13 passed.
- Production web build: passed (existing browser-externalization, Tailwind, and chunk-size warnings only).
- `cargo fmt --check`, `git diff --check`, and production config/entitlement diff checks: passed.

## Residual consideration

The deliberately small pinned public-suffix allowlist trades recall for safety. Services on unknown or newly delegated suffixes will not receive registrable-domain relevance until the reviewed local mapping is regenerated and its pinned revision updated; exact service/host, explicit URI rules, presets, and user bindings continue to work.
