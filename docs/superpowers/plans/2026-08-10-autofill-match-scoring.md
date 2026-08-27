# AutoFill Match Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank native AutoFill candidates with a generic, typo-tolerant application-name similarity score while preserving authoritative URI/binding priority and mandatory confirmation for approximate matches.

**Architecture:** Add a bounded fixed-point `ApplicationNameSimilarity` unit to the Swift Agent, then make `MatchingEngine` assign every evidence class a non-overlapping score band. The picker continues to receive metadata-only candidate rows; it adds one fixed localized explanation for approximate application-name matches without exposing raw scores or secrets.

**Tech Stack:** Swift 5 / XCTest / Foundation, Angular / TypeScript / Vitest, existing authenticated Agent IPC and signed local-smoke workflow.

## Global Constraints

- Matching remains local to the authenticated AutoFill Agent; no vault name or score telemetry.
- No application-specific names, bundle identifiers, aliases, or external fuzzy-matching dependency.
- Use fixed-point integer arithmetic in `0...10_000`; no floating-point rank ordering.
- Bound each normalized name to 128 Unicode scalars and 16 meaningful tokens.
- Preserve authority order: binding, exact service, preset, URI rule, host/domain, exact application name, approximate application name, then weak priors.
- Every approximate match requires mismatch confirmation before secret release.
- `Never` and regular-expression URIs contribute no approximate evidence.
- Candidate responses remain free of URI, password, TOTP, and raw similarity score.
- Continue to compile the native targets for macOS 13.0; live verification is performed only on the current macOS 26 machine.

---

## File structure

- Create `apps/macos-autofill/Agent/ApplicationNameSimilarity.swift`: normalization, Jaro-Winkler, bounded OSA distance, symmetric token coverage, thresholds, and fixed-point score.
- Create `apps/macos-autofill/Tests/ApplicationNameSimilarityTests.swift`: direct algorithm behavior, bounds, short-name guards, and permutation-independent examples.
- Modify `apps/macos-autofill/BarwardenAutoFill.xcodeproj/project.pbxproj`: compile the new production file into Agent and Tests and the new test file into Tests only.
- Modify `apps/macos-autofill/Agent/MatchingEngine.swift`: evidence score bands, scored signals, approximate-name reason/group/confirmation, and deterministic score-first sorting.
- Modify `apps/macos-autofill/Tests/MatchingEngineTests.swift`: end-to-end candidate ranking and metadata-only serialization assertions.
- Modify `apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts`: map the fixed `application_name_similar` reason.
- Modify `apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts`: verify group placement, reason text, ordering, and mismatch confirmation.
- Modify `apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts`: Chinese and English fixed copy.
- Modify `apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json`: update only the official i18n integrity hash with the repository updater.

---

### Task 1: Fixed-point application-name comparator

**Files:**
- Create: `apps/macos-autofill/Agent/ApplicationNameSimilarity.swift`
- Create: `apps/macos-autofill/Tests/ApplicationNameSimilarityTests.swift`
- Modify: `apps/macos-autofill/BarwardenAutoFill.xcodeproj/project.pbxproj`

**Interfaces:**
- Produces: `ApplicationNameSimilarity.compare(applicationName:itemName:) -> ApplicationNameSimilarity.Result?`
- Produces: `Result.kind: .exact | .approximate`, `Result.similarity: Int`, and `Result.isHighConfidence: Bool`
- Consumes: Foundation Unicode strings only; it has no projection, IPC, or secret dependency.

- [ ] **Step 1: Add the new Swift files to the Xcode project**

Add `ApplicationNameSimilarity.swift` to Agent and Tests source phases. Add `ApplicationNameSimilarityTests.swift` to Tests only. Use fresh PBX identifiers and preserve the exact three-target inventory.

- [ ] **Step 2: Write the failing direct comparator tests**

Create tests with the following behavioral assertions:

```swift
final class ApplicationNameSimilarityTests: XCTestCase {
    func testExactTypoTranspositionAndMultiTokenScoresAreOrdered() {
        let exact = compare("Termius", "Termius")
        let missing = compare("Termius", "trmius")
        let transposed = compare("Termius", "Temrius")
        let extended = compare("Termius", "Termius SSH")

        XCTAssertEqual(exact?.kind, .exact)
        XCTAssertEqual(exact?.similarity, 10_000)
        XCTAssertGreaterThanOrEqual(missing?.similarity ?? 0, 8_800)
        XCTAssertGreaterThanOrEqual(transposed?.similarity ?? 0, 8_800)
        XCTAssertGreaterThan(extended?.similarity ?? 0, 7_200)
        XCTAssertGreaterThan(missing?.similarity ?? 0, extended?.similarity ?? 0)
    }

    func testSharedVendorPrefixAndShortNamesFailClosed() {
        XCTAssertNil(compare("Microsoft Teams", "Microsoft Outlook"))
        XCTAssertNil(compare("AWS", "WPS"))
        XCTAssertNil(compare("Warp", "Wasp"))
    }

    func testNormalizationIsUnicodeCaseSeparatorAndCamelBoundaryStable() {
        XCTAssertEqual(compare("Visual Studio Code", "visualStudio-code")?.kind, .exact)
        XCTAssertEqual(compare("Te\u{301}rmius", "TÉRMIUS")?.kind, .exact)
    }

    func testOversizedOrNormalizationEmptyInputsFailClosed() {
        XCTAssertNil(compare(String(repeating: "a", count: 129), "a"))
        XCTAssertNil(compare("---", "___"))
    }
}
```

The production change that makes these pass is the new bounded comparator; no matching-engine mock is involved.

- [ ] **Step 3: Run the new suite and verify RED**

Run:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild test \
  -project apps/macos-autofill/BarwardenAutoFill.xcodeproj \
  -scheme BarwardenNativeAutoFill \
  -destination 'platform=macOS' \
  -only-testing:BarwardenAutoFillTests/ApplicationNameSimilarityTests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: compilation fails because `ApplicationNameSimilarity` does not exist.

- [ ] **Step 4: Implement the minimal bounded comparator**

Create the following public shape and private helpers:

```swift
struct ApplicationNameSimilarity {
    static let scale = 10_000
    static let highConfidenceThreshold = 8_800

    struct Result: Equatable {
        enum Kind: Equatable { case exact, approximate }
        let kind: Kind
        let similarity: Int
        var isHighConfidence: Bool {
            kind == .exact || similarity >= highConfidenceThreshold
        }
    }

    static func compare(applicationName: String, itemName: String) -> Result? {
        guard let application = NormalizedName(applicationName),
              let item = NormalizedName(itemName) else { return nil }
        if application.exactTokens == item.exactTokens {
            return Result(kind: .exact, similarity: scale)
        }
        let jw = jaroWinkler(application.comparisonScalars, item.comparisonScalars)
        let osa = normalizedOSA(application.comparisonScalars, item.comparisonScalars)
        let token = symmetricTokenCoverage(application.tokens, item.tokens)
        let similarity = (45 * jw + 35 * osa + 20 * token) / 100
        guard similarity >= inclusionThreshold(shorterLength: min(
            application.meaningfulLength,
            item.meaningfulLength
        )) else { return nil }
        return Result(kind: .approximate, similarity: similarity)
    }
}
```

Implementation requirements:

- Normalize with canonical composition, insert token boundaries before camel-case uppercase transitions while original casing is available, then apply POSIX case folding and split on non-alphanumeric scalars.
- Preserve unfiltered `exactTokens`; remove the approved generic tokens only from approximate `tokens`.
- Return `nil` if either scalar count exceeds 128, either meaningful token list exceeds 16, or either side has fewer than three meaningful characters.
- Implement standard Jaro matching windows and a maximum four-character Winkler prefix bonus only when Jaro is at least 7,000.
- Implement OSA with two rolling integer rows plus the previous-previous row; adjacent transposition costs one edit.
- Return all sub-scores in `0...10_000` using saturating integer operations.
- Compute directional token coverage using token-length-weighted best pair scores; combine both directions with integer harmonic mean `2ab/(a+b)` and return zero when `a+b == 0`.
- Inclusion thresholds: 9,400 for length 3–4, 8,000 for 5–7, and 7,200 for 8+.

- [ ] **Step 5: Run the direct suite and verify GREEN**

Run the Step 3 command. Expected: all `ApplicationNameSimilarityTests` pass with zero failures.

- [ ] **Step 6: Run the direct tests under reversed fixture order**

Add a table-driven test that compares the same pairs in both argument orders and asserts identical scores. Run the focused suite again; expected: all pass.

- [ ] **Step 7: Commit the comparator**

```bash
git add \
  apps/macos-autofill/Agent/ApplicationNameSimilarity.swift \
  apps/macos-autofill/Tests/ApplicationNameSimilarityTests.swift \
  apps/macos-autofill/BarwardenAutoFill.xcodeproj/project.pbxproj
git commit -m "feat: score autofill application names"
```

---

### Task 2: Score-band candidate ranking

**Files:**
- Modify: `apps/macos-autofill/Agent/MatchingEngine.swift`
- Modify: `apps/macos-autofill/Tests/MatchingEngineTests.swift`

**Interfaces:**
- Consumes: `ApplicationNameSimilarity.Result`
- Produces: unchanged `RankedCandidate` wire shape with group, fixed reason, and mismatch-confirmation flag.
- Preserves: existing `authorizationContextDigest` and `authorizationPolicyDigest` secret-staleness behavior.

- [ ] **Step 1: Write failing end-to-end ranking tests**

Add tests that rank a mixed candidate set:

```swift
func testApproximateApplicationNamesUseScoreOrderAndAlwaysRequireConfirmation() {
    let ranked = engine.rank(
        accountID: "account-a",
        logins: [
            login("unrelated", name: "Terminal"),
            login("extended", name: "Termius SSH"),
            login("transposed", name: "Temrius"),
            login("missing", name: "trmius"),
            login("exact", name: "Termius"),
        ],
        context: .init(
            bundleID: "com.termius-dmg.mac",
            appName: "Termius",
            serviceIdentifiers: [],
            query: ""
        ),
        bindings: [],
        history: []
    )

    XCTAssertEqual(ranked.map(\.cipherID), ["exact", "missing", "transposed", "extended", "unrelated"])
    XCTAssertEqual(ranked[0].reason, "application_name")
    XCTAssertFalse(ranked[0].requiresMismatchConfirmation)
    XCTAssertTrue(ranked[1...3].allSatisfy {
        $0.reason == "application_name_similar" && $0.requiresMismatchConfirmation
    })
}
```

Add separate tests proving:

- binding/service/preset/URI/domain candidates remain above exact and approximate name candidates;
- a high approximate result uses group `.relevant` but still requires confirmation;
- a lower accepted result uses group `.other` and sorts before history/favorite/recent/other;
- generic bundle tokens cannot score unrelated URI/name candidates;
- input reversal/permutation preserves the exact order;
- query mode filters first and then uses the same score order;
- candidate encoding contains no `matchScore`, URI, password, TOTP, bundle ID, or service identifier.

- [ ] **Step 2: Run MatchingEngine tests and verify RED**

Run:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild test \
  -project apps/macos-autofill/BarwardenAutoFill.xcodeproj \
  -scheme BarwardenNativeAutoFill \
  -destination 'platform=macOS' \
  -only-testing:BarwardenAutoFillTests/MatchingEngineTests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: approximate names retain the old equal fuzzy rank/reason/order and the new assertions fail.

- [ ] **Step 3: Introduce scored evidence bands**

Replace the raw-value-only `Signal` result with:

```swift
private struct ScoredSignal {
    let signal: Signal
    let rankScore: Int
}

private enum ScoreBand {
    static let binding = 1_000_000
    static let serviceIdentifier = 980_000
    static let preset = 960_000
    static let uriRule = 940_000
    static let domain = 920_000
    static let exactApplicationName = 900_000
    static let distinctiveToken = 640_000
    static let history = 300_000
    static let favorite = 200_000
    static let recent = 100_000

    static func approximateName(_ similarity: Int) -> Int {
        650_000 + max(0, min(249_999, (similarity - 7_200) * 249_999 / 2_800))
    }
}
```

`signal(for:)` must return the first authoritative hard signal exactly as before. For names:

```swift
if let result = ApplicationNameSimilarity.compare(
    applicationName: context.appName,
    itemName: login.name
) {
    switch result.kind {
    case .exact:
        return .init(signal: .applicationName, rankScore: ScoreBand.exactApplicationName)
    case .approximate:
        return .init(
            signal: result.isHighConfidence ? .applicationNameSimilarRelevant : .applicationNameSimilarOther,
            rankScore: ScoreBand.approximateName(result.similarity)
        )
    }
}
```

Keep the existing distinctive exact-token fallback as `.fuzzy` at score 640,000, after the composite comparator and after generic-token filtering.

- [ ] **Step 4: Sort by score without weakening stable authorization**

Add `rankScore` to `ScoredCandidate`. Sort by descending score first, then history count/date, recent date within the recent band, normalized name, normalized username, and cipher ID. Map both approximate-name signals to reason `application_name_similar` and `requiresMismatchConfirmation: true`; only the high signal maps to group `.relevant`.

Do not add raw score to `RankedCandidate` or any Codable wire type.

- [ ] **Step 5: Run focused MatchingEngine tests and verify GREEN**

Run the Step 2 command. Expected: all MatchingEngine tests pass with zero failures.

- [ ] **Step 6: Run ProjectionStore authorization regressions**

Run:

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild test \
  -project apps/macos-autofill/BarwardenAutoFill.xcodeproj \
  -scheme BarwardenNativeAutoFill \
  -destination 'platform=macOS' \
  -only-testing:BarwardenAutoFillTests/ProjectionStoreTests \
  CODE_SIGNING_ALLOWED=NO
```

Expected: one-time token, policy digest, reprompt, deletion, revision, and mismatch-confirmation tests all pass.

- [ ] **Step 7: Commit the ranking integration**

```bash
git add \
  apps/macos-autofill/Agent/MatchingEngine.swift \
  apps/macos-autofill/Tests/MatchingEngineTests.swift
git commit -m "feat: rank autofill candidates by match score"
```

---

### Task 3: Picker explanation and confirmation behavior

**Files:**
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json`

**Interfaces:**
- Consumes: fixed Agent reason `application_name_similar` and existing `requiresMismatchConfirmation` boolean.
- Produces: localized Chinese `应用名称相似` and English `Similar application name` copy.

- [ ] **Step 1: Write failing picker tests**

Use metadata-only fake candidates and assert:

```typescript
expect(related.textContent).toContain("trmius");
expect(related.textContent).toContain("应用名称相似");
expect(candidateHost.releaseSecret).not.toHaveBeenCalled();

await clickFillFor("trmius");
expect(screen.textContent).toContain("此账户与当前应用并非完全匹配");
expect(candidateHost.releaseSecret).not.toHaveBeenCalled();
```

Add a lower-scoring approximate candidate in Other and verify the Agent-provided order is preserved ahead of unrelated candidates. Do not put secrets in the fixture response.

- [ ] **Step 2: Run picker tests and verify RED**

Run:

```bash
npm test -- --run apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts
```

Expected: the new reason falls back to the generic explanation because the translation mapping does not exist.

- [ ] **Step 3: Add fixed reason mapping and translations**

Add:

```typescript
application_name_similar: "i18nAutofillReasonApplicationNameSimilar",
```

Translations:

```typescript
i18nAutofillReasonApplicationNameSimilar: "应用名称相似",
i18nAutofillReasonApplicationNameSimilar: "Similar application name",
```

Do not display a raw percentage and do not alter the existing mismatch-confirmation dialog or explicit single-field fill action.

- [ ] **Step 4: Update the retained i18n integrity manifest**

Run:

```bash
npm run update:i18n-retained-manifests
```

Inspect the diff and require that only the expected `official-i18n.service.ts` hash changes.

- [ ] **Step 5: Run picker tests and verify GREEN**

Run the Step 2 command. Expected: all picker tests pass.

- [ ] **Step 6: Commit the picker copy**

```bash
git add \
  apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts \
  apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts \
  apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts \
  apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json
git commit -m "feat: explain similar autofill matches"
```

---

### Task 4: Full regression, signed smoke, and live verification

**Files:**
- Modify only if a regression demonstrates a scoped defect in Tasks 1–3.

**Interfaces:**
- Consumes: completed score comparator, MatchingEngine integration, and picker reason.
- Produces: test evidence and an installed signed local-smoke application; no release promotion or notarization.

- [ ] **Step 1: Run the full native suite**

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild test \
  -project apps/macos-autofill/BarwardenAutoFill.xcodeproj \
  -scheme BarwardenNativeAutoFill \
  -destination 'platform=macOS' \
  CODE_SIGNING_ALLOWED=NO
```

Expected: zero failures. Record the exact executed test count from the `.xcresult` or final summary.

- [ ] **Step 2: Run full TypeScript tests and production web build**

```bash
npm test
npm run build:web
```

Expected: both exit zero; record exact passed/skipped counts and only existing documented build warnings.

- [ ] **Step 3: Run native project and source-integrity contracts**

Run the repository's native project/build-wrapper and recovery-overlay guard suites with `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. Expected: all pass without widening allowlists beyond the new Swift files and i18n hash.

- [ ] **Step 4: Run formatting and diff checks**

```bash
git diff --check
git status --short
```

Expected: no whitespace error and no unrelated file.

- [ ] **Step 5: Build a signed local smoke application**

Use the already-authorized isolated temporary-Keychain workflow and `scripts/build-native-autofill-local-smoke.sh`. Requirements:

- set `NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY=1`;
- reference the authorized Developer ID identity and isolated Keychain without logging secrets or private-key paths;
- use a new owner-only mode-0700 empty output directory;
- omit the Provider profile when unavailable and accept only the fixed local warning;
- do not notarize, staple, create a DMG, mark evidence PASS, or promote production configuration.

Expected fixed success code: `NATIVE_AUTOFILL_LOCAL_SMOKE_BUILD_PASS`.

- [ ] **Step 6: Install and restart the correct Agent**

Back up the existing `/Applications/Barwarden.app` recoverably, install the signed local app as `/Applications/Barwarden.app`, and verify its Developer ID signature. If the running Agent executable still resolves to the backup bundle, terminate only that Agent PID and verify launchd restarts it from `/Applications/Barwarden.app/Contents/Helpers/BarwardenAutoFillAgent` before evaluating candidates.

- [ ] **Step 7: Perform bounded live verification**

1. Have the user unlock `/Applications/Barwarden.app`; never request, read, or type the master password.
2. Focus a login field in a real third-party application.
3. Open AutoFill through the floating action or global shortcut.
4. Verify the exact matching item is first in Related with `应用名称相同`.
5. Do not fill, copy, release a secret, or modify the user's vault.
6. Treat the synthetic `trmius` typo case as proven by the direct/MatchingEngine tests; do not rename or create a real vault item merely for live testing.

- [ ] **Step 8: Final self-review and commit any scoped verification fix**

Re-read the design and this plan, inspect the full diff, and run the affected focused suite again after any repair. Commit only when all required evidence is fresh and the worktree is clean.
