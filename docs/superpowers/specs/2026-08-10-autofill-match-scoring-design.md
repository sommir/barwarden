# AutoFill Match Scoring Design

## Objective

Replace the current binary name-token fallback with a deterministic, explainable similarity score. The ranking must tolerate ordinary application-name spelling variation such as `Termius` / `trmius`, keep authoritative URI and user-binding evidence ahead of fuzzy evidence, and never turn an approximate name match into silent credential authorization.

The implementation is generic. It must not contain application-specific names, bundle identifiers, or aliases.

## Design constraints

- Matching runs locally inside the authenticated AutoFill Agent. No vault metadata, candidate names, similarity values, or user behavior leave the device.
- Existing evidence remains ordered by authority: explicit user binding, exact service identifier, reviewed application preset, exact vault URI rule, host/domain rule, exact application name, approximate application name, then weak priors.
- Bitwarden URI semantics remain unchanged. `Never` and regular-expression URIs contribute no fuzzy evidence.
- Any approximate name match requires mismatch confirmation before secret release, including a high-scoring match shown in the Related group.
- Scores and tie breaks are deterministic across runs and architectures.
- Inputs remain bounded by the existing wire limits. Name comparison additionally caps work to 128 normalized Unicode scalars and 16 meaningful tokens per side.

## Considered approaches

### 1. Single Damerau-Levenshtein distance

This handles insertions, deletions, substitutions, and adjacent transpositions and is easy to explain. It performs poorly when one application adds a legitimate suffix or splits a product name into multiple words.

### 2. WRatio/token-set style maximum

This has high recall for reordered and extended names. It is unsafe as the only measure because a subset can receive a perfect token-set score despite unmatched additional words. That behavior would over-rank names that share one generic product or vendor token.

### 3. Hybrid name comparator — selected

Combine Jaro-Winkler, normalized Optimal String Alignment distance, and symmetric token coverage. Jaro-Winkler handles short typographical variation, OSA provides a concrete edit-cost guard including adjacent transposition, and symmetric token coverage handles multi-word product names without giving a subset a perfect score.

References:

- NIST Dictionary of Algorithms and Data Structures, Jaro-Winkler: https://xlinux.nist.gov/dads/HTML/jaroWinkler.html
- U.S. Census Bureau, *An Adaptive String Comparator for Record Linkage*: https://www.census.gov/content/dam/Census/library/working-papers/2004/adrm/rrs2004-02.pdf
- RapidFuzz token and weighted ratios: https://rapidfuzz.github.io/RapidFuzz/Usage/fuzz.html
- Bitwarden URI match detection and safety boundaries: https://bitwarden.com/help/uri-match-detection/

## Normalization

1. Apply Unicode canonical composition and locale-stable case folding.
2. Split on non-alphanumeric separators and camel-case boundaries.
3. Preserve all tokens for exact application-name equality.
4. For approximate matching only, remove packaging/vendor noise tokens such as `app`, `application`, `client`, `com`, `desktop`, `dmg`, `mac`, `macos`, `official`, and `osx`.
5. Reject approximate matching when either side has fewer than three meaningful alphanumeric characters.

Bundle identifiers are only a source of distinctive fallback tokens. Generic bundle components never contribute similarity.

## Similarity calculation

All arithmetic is fixed-point integer arithmetic on the range `0...10_000`.

For normalized application name `A` and Login item name `B`:

```text
nameSimilarity =
    45% JaroWinkler(A, B)
  + 35% normalizedOSA(A, B)
  + 20% symmetricTokenCoverage(A, B)
```

- Jaro-Winkler uses a maximum four-character prefix bonus, applied only when the underlying Jaro score is at least `0.70`.
- `normalizedOSA = 1 - distance / max(length(A), length(B))`.
- Token-pair similarity is the greater of Jaro-Winkler and normalized OSA for that pair.
- Directional token coverage is the token-length-weighted best match from every token on one side to the other side.
- Symmetric token coverage is the harmonic mean of `A -> B` and `B -> A`. This penalizes unmatched suffixes and prevents subset equality.

Examples that must be covered by tests:

| Application | Login item | Expected behavior |
| --- | --- | --- |
| `Termius` | `Termius` | Exact application-name match |
| `Termius` | `trmius` | High approximate score |
| `Termius` | `Temrius` | High approximate score for transposition |
| `Termius` | `Termius SSH` | Approximate multi-token match |
| `Microsoft Teams` | `Microsoft Outlook` | Penalized for the unmatched product token |
| `AWS` | `WPS` | Rejected by the short-name guard |
| `Warp` | `Wasp` | Not promoted without meeting the short-name threshold |

## Ranking model

The Agent assigns candidates to non-overlapping score bands so weak evidence can never overtake authoritative evidence:

| Evidence | Internal band |
| --- | ---: |
| Explicit user binding | 1,000,000 |
| Exact service identifier | 980,000 |
| Reviewed application preset | 960,000 |
| Exact vault URI rule | 940,000 |
| Host/domain rule | 920,000 |
| Exact application name | 900,000 |
| Approximate application name | 650,000–899,999 |
| Selection history only | 300,000 |
| Favorite only | 200,000 |
| Recent only | 100,000 |
| No evidence | 0 |

For an accepted approximate result, its band score is calculated from the raw fixed-point similarity independently of the length guard:

```text
650_000 + clamp((similarity - 7_200) * 249_999 / 2_800, 0, 249_999)
```

The length-adjusted threshold decides whether a result is accepted; the formula above ensures two accepted candidates with the same similarity receive the same rank regardless of name length. Distinctive exact bundle/name tokens may provide a low approximate score but cannot exceed a calculated high-similarity application-name result.

History count/date, favorite state, and last-used time remain bounded tie breakers inside the same evidence band. They cannot move a candidate into a stronger evidence band. Final stable ties use normalized display name, username, then cipher ID.

For a non-empty global search query, the query filters all active Login items first; contextual scores still order the filtered results.

## Display and authorization policy

- Exact application name: `relevant`, reason `application_name`, no mismatch confirmation.
- Approximate score at least `0.88`: `relevant`, reason `application_name_similar`, mismatch confirmation required.
- Approximate score below `0.88` but above the length-adjusted inclusion threshold: `other`, reason `application_name_similar`, mismatch confirmation required.
- Below the inclusion threshold: no name signal; history/favorite/recent/other behavior applies.

Length-adjusted inclusion thresholds:

| Shorter meaningful name length | Minimum similarity |
| --- | ---: |
| 3–4 | 0.94 |
| 5–7 | 0.80 |
| 8+ | 0.72 |

The raw numerical score remains inside the Agent for now. The UI shows a fixed localized explanation rather than an apparently precise percentage. Candidate responses remain metadata-only and contain no URI or secret.

## Components and data flow

1. `MatchingEngine` normalizes the current application name and each active Login name.
2. `ApplicationNameSimilarity` computes the bounded fixed-point metrics and returns either no signal or a scored approximate signal.
3. `MatchingEngine` combines authoritative evidence and the similarity result into a score band.
4. Candidates are sorted by score, bounded history tie breakers, and stable textual keys.
5. `RankedCandidate` continues to expose group, fixed reason, and mismatch-confirmation requirement; no secret or raw contextual identifier is added.
6. `ProjectionStore` continues to bind one-time authorization to the current projection, context, candidate policy, account, generation, and field. Approximate matches cannot bypass this transaction.

## Failure behavior

- Empty, oversized, malformed, or normalization-empty names produce no approximate signal.
- Arithmetic is saturating/fixed-point; no NaN or platform floating-point ordering is possible.
- Comparator work exceeding the scalar/token bounds fails closed to no approximate signal.
- Unknown match reasons use the existing safe UI fallback.

## Test strategy

### RED/GREEN unit tests

- Missing character, substituted character, and adjacent transposition rank by decreasing similarity.
- Exact name remains above every approximate name.
- Multi-token extension ranks below exact but above unrelated names.
- Shared vendor-prefix names do not become high matches.
- Short-name false-positive fixtures fail the inclusion guard.
- Generic bundle tokens never contribute score.
- Input permutation produces identical order.
- Approximate candidates always require mismatch confirmation and authorization tokens remain one-time.
- Encoded candidate responses remain free of URI, password, TOTP, and raw similarity internals.

### UI tests

- A high approximate match appears first in Related with the localized “similar application name” explanation.
- A lower accepted approximate match appears ahead of unrelated Other candidates.
- Confirming an approximate candidate remains mandatory before fill or copy.

### Regression and live verification

- Run focused MatchingEngine and picker suites, then full Swift and Vitest suites and the production web build.
- Build and sign the local smoke application with the authorized Developer ID workflow.
- In a real third-party application, verify exact and misspelled item names order correctly without releasing or filling a secret.

## Non-goals

- No machine-learning model or external similarity service.
- No telemetry collection or upload of vault names.
- No automatic alias dictionary or application-specific preset generated from fuzzy results.
- No change to browser URI matching, system Credential Provider availability, or secret-release security boundaries.
