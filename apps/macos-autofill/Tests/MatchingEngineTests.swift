import Foundation
import XCTest

final class MatchingEngineTests: XCTestCase {
    func testRanksExactSignalsByDocumentedPriorityBeforeRelevantAndOther() throws {
        let engine = MatchingEngine(presets: [
            AppPreset(bundleID: "com.example.target", services: ["preset.example"]),
        ])
        let context = NativeAutoFillContext(
            bundleID: "com.example.target",
            appName: "Target Desktop",
            serviceIdentifiers: ["https://login.service.example/account"],
            query: ""
        )
        let logins = [
            login("favorite", name: "Unrelated", favorite: true),
            login("host", name: "Host", uris: [("https://www.service.example", "host")]),
            login("rule", name: "Rule", uris: [("https://login.service.example", "startsWith")]),
            login("preset", name: "Preset", uris: [("https://preset.example", "default")]),
            login("service", name: "Service", uris: [("https://login.service.example/account", "default")]),
            login("binding", name: "Bound"),
        ]

        let ranked = engine.rank(
            accountID: "account-a",
            logins: logins,
            context: context,
            bindings: [UserAppBinding(
                accountID: "account-a",
                bundleID: "com.example.target",
                cipherID: "binding"
            ), UserAppBinding(
                accountID: "account-a",
                bundleID: "com.example.target",
                cipherID: "deleted-or-inactive-cipher"
            )],
            history: []
        )

        XCTAssertEqual(ranked.map(\.cipherID), [
            "binding", "service", "preset", "rule", "host", "favorite",
        ])
        XCTAssertEqual(ranked.map(\.group), [
            .exact, .exact, .exact, .exact, .relevant, .other,
        ])
        XCTAssertEqual(ranked.map(\.requiresMismatchConfirmation), [
            false, false, false, false, false, true,
        ])
    }

    func testAllLoginSearchFindsUnrelatedItemsAndFiltersNonMatches() {
        let engine = MatchingEngine(presets: [])
        let context = NativeAutoFillContext(
            bundleID: "com.apple.Terminal",
            appName: "Terminal",
            serviceIdentifiers: ["ssh://production.example"],
            query: "  CAFÉ ADMIN  "
        )

        let ranked = engine.rank(
            accountID: "account-a",
            logins: [
                login("unrelated", name: "Cafe\u{301} Admin Portal"),
                login("context", name: "Production SSH", uris: [("ssh://production.example", "exact")]),
                login("noise", name: "Personal Mail"),
            ],
            context: context,
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.map(\.cipherID), ["unrelated"])
        XCTAssertEqual(ranked.first?.group, .other)
        XCTAssertEqual(ranked.first?.requiresMismatchConfirmation, true)
    }

    func testWhitespaceQueryUsesContextRankingInsteadOfAllLoginFiltering() {
        let ranked = MatchingEngine(presets: []).rank(
            accountID: "account-a",
            logins: [login("service", name: "Service", uris: [("https://service.example", "exact")])],
            context: NativeAutoFillContext(
                bundleID: "com.example.App",
                appName: "Example",
                serviceIdentifiers: ["HTTPS://SERVICE.EXAMPLE/"],
                query: " \n\t "
            ),
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.map(\.cipherID), ["service"])
        XCTAssertEqual(ranked.first?.group, .exact)
    }

    func testBitwardenHostRuleIsExactButRegistrableDomainFallbackIsRelevant() {
        let context = NativeAutoFillContext(
            bundleID: "com.example.App",
            appName: "Example",
            serviceIdentifiers: ["https://login.example.co.uk/path"],
            query: ""
        )
        let ranked = MatchingEngine(presets: []).rank(
            accountID: "account-a",
            logins: [
                login("domain", name: "Domain", uris: [("https://www.example.co.uk", "default")]),
                login("host-rule", name: "Host", uris: [("https://login.example.co.uk/other", "host")]),
                login("never", name: "Never", uris: [("https://login.example.co.uk/path", "never")]),
                login("public-suffix", name: "Unsafe", uris: [("https://attacker.co.uk", "default")]),
            ],
            context: context,
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.map(\.cipherID), ["host-rule", "domain", "never", "public-suffix"])
        XCTAssertEqual(ranked.map(\.group), [.exact, .relevant, .other, .other])
    }

    func testIDNAAndCanonicalCaseMatchWithoutTreatingConfusableHostAsEquivalent() {
        let context = NativeAutoFillContext(
            bundleID: "COM.EXAMPLE.BOOKS",
            appName: "Books",
            serviceIdentifiers: ["https://BÜCHER.de/login"],
            query: ""
        )
        let ranked = MatchingEngine(presets: []).rank(
            accountID: "account-a",
            logins: [
                login("idna", name: "Books", uris: [("https://xn--bcher-kva.de/login", "exact")]),
                login("confusable", name: "Other", uris: [("https://b\u{443}cher.de/login", "exact")]),
            ],
            context: context,
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.map(\.cipherID), ["idna", "confusable"])
        XCTAssertEqual(ranked.map(\.group), [.exact, .other])
        XCTAssertEqual(ranked.last?.requiresMismatchConfirmation, true)
    }

    func testHistoryIsAccountAndContextScopedAndThenFavoriteRecentAndStableTieBreak() {
        let context = NativeAutoFillContext(
            bundleID: "com.example.App",
            appName: "No Match",
            serviceIdentifiers: [],
            query: ""
        )
        let logins = [
            login("z", name: "Same"),
            login("recent", name: "Recent", lastUsedAt: "2026-08-09T00:00:00Z"),
            login("favorite", name: "Favorite", favorite: true),
            login("history", name: "History"),
            login("a", name: "Same"),
        ]
        let history = [
            MatchingHistoryEntry(
                accountID: "account-a",
                contextKey: "app:com.example.app",
                cipherID: "history",
                successfulSelectionCount: 2,
                lastSelectedAt: "2026-08-08T00:00:00Z"
            ),
            MatchingHistoryEntry(
                accountID: "account-b",
                contextKey: "app:com.example.app",
                cipherID: "z",
                successfulSelectionCount: 99,
                lastSelectedAt: "2030-01-01T00:00:00Z"
            ),
        ]

        let engine = MatchingEngine(presets: [])
        let forward = engine.rank(
            accountID: "account-a",
            logins: logins,
            context: context,
            bindings: [],
            history: history
        )
        let reversed = engine.rank(
            accountID: "account-a",
            logins: logins.reversed(),
            context: context,
            bindings: [],
            history: history
        )

        XCTAssertEqual(forward.map(\.cipherID), ["history", "favorite", "recent", "a", "z"])
        XCTAssertEqual(reversed.map(\.cipherID), forward.map(\.cipherID))
        XCTAssertTrue(forward.allSatisfy(\.requiresMismatchConfirmation))
    }

    func testRankedCandidateEncodingNeverContainsProjectedSecretsOrURIs() throws {
        let password = "PASSWORD-MUST-NOT-LEAVE-RANKING"
        let totp = "TOTP-MUST-NOT-LEAVE-RANKING"
        let uri = "https://private.example/secret-path"
        let candidate = try XCTUnwrap(MatchingEngine(presets: []).rank(
            accountID: "account-a",
            logins: [AutoFillLogin(
                cipherID: "opaque-id",
                name: "Display",
                username: "person@example.test",
                password: password,
                uris: [AutoFillURI(uri: uri, matchType: "exact")],
                totp: totp,
                favorite: false,
                reprompt: true
            )],
            context: NativeAutoFillContext(
                bundleID: "com.example.App",
                appName: "Example",
                serviceIdentifiers: [],
                query: "Display"
            ),
            bindings: [],
            history: []
        ).first)

        let encoded = String(decoding: try JSONEncoder().encode(candidate), as: UTF8.self)
        XCTAssertFalse(encoded.contains(password))
        XCTAssertFalse(encoded.contains(totp))
        XCTAssertFalse(encoded.contains(uri))
        XCTAssertTrue(encoded.contains("opaque-id"))
        XCTAssertTrue(encoded.contains("person@example.test"))
    }

    func testPropertyPermutationNeverChangesStableTieBreakOrLeaksSecrets() throws {
        let engine = MatchingEngine(presets: [])
        let context = NativeAutoFillContext(
            bundleID: "com.example.App",
            appName: "No Context Match",
            serviceIdentifiers: [],
            query: ""
        )
        let base = (0..<24).map { index in
            login(String(format: "cipher-%02d", index), name: "Same Name")
        }
        let expected = base.map(\.cipherID)

        for offset in 0..<base.count {
            let rotated = Array(base[offset...] + base[..<offset])
            for input in [rotated, rotated.reversed()] {
                let ranked = engine.rank(
                    accountID: "account-a",
                    logins: Array(input),
                    context: context,
                    bindings: [],
                    history: []
                )
                XCTAssertEqual(ranked.map(\.cipherID), expected)
                let wire = String(decoding: try JSONEncoder().encode(ranked), as: UTF8.self)
                XCTAssertFalse(wire.contains("secret-cipher"))
                XCTAssertFalse(wire.contains("totp-cipher"))
            }
        }
    }

    func testPresetCatalogContainsOnlyBundleToCanonicalServiceMappings() throws {
        let valid = Data("""
        [{"bundleId":"com.example.App","services":["example.com"]}]
        """.utf8)
        XCTAssertEqual(
            try AppPresetCatalog.decode(valid),
            [AppPreset(bundleID: "com.example.App", services: ["example.com"])]
        )

        let passwordItem = Data("""
        [{"bundleId":"com.example.App","services":["example.com"],"cipherId":"personal"}]
        """.utf8)
        XCTAssertThrowsError(try AppPresetCatalog.decode(passwordItem))
    }

    func testProjectionDecodesAccountScopedBindingsHistoryAndRecentMetadata() throws {
        let projection = try JSONDecoder().decode(AutoFillProjection.self, from: Data("""
        {
          "version":1,"accountId":"account-a","vaultRevision":3,
          "createdAt":"2026-08-08T00:00:00Z",
          "logins":[{
            "cipherId":"cipher-a","name":"Example","username":"person@example.test",
            "password":"secret","uris":[],"totp":"seed","favorite":false,"reprompt":false,
            "lastUsedAt":"2026-08-09T00:00:00Z"
          }],
          "bindings":[{"bundleId":"com.example.app","cipherId":"cipher-a"}],
          "history":[{
            "contextKey":"app:com.example.app","cipherId":"cipher-a",
            "successfulSelectionCount":2,"lastSelectedAt":"2026-08-09T00:00:00Z"
          }]
        }
        """.utf8))

        XCTAssertEqual(projection.logins.first?.lastUsedAt, "2026-08-09T00:00:00Z")
        XCTAssertEqual(projection.bindings.first?.bundleID, "com.example.app")
        XCTAssertEqual(projection.history.first?.successfulSelectionCount, 2)
    }

    func testSecretAuthorizationConsumesContextAndRequiresMismatchAndVerifiedReprompt() throws {
        let generation = UUID()
        var now: TimeInterval = 1_800_000_000
        let store = CandidateAuthorizationStore(clock: { now })
        let fuzzy = RankedCandidate(
            cipherID: "cipher-a",
            displayName: "Example",
            username: "person@example.test",
            group: .other,
            reason: "fuzzy_name",
            requiresMismatchConfirmation: true
        )
        let login = login("cipher-a", name: "Example", reprompt: true)
        let first = try store.issue(
            accountID: "account-a",
            generation: generation,
            candidates: [fuzzy],
            logins: [login]
        )

        XCTAssertThrowsError(try store.validate(
            SecretReleasePayload(
                generation: generation,
                accountID: "account-a",
                candidateID: "cipher-a",
                field: .password,
                contextToken: first.contextToken,
                mismatchConfirmed: false,
                reprompt: RepromptResultPayload(result: .grant, grant: "valid-grant")
            ),
            verifyRepromptGrant: { _, _, _, _, _ in true }
        )) { XCTAssertEqual($0 as? AgentProtocolError, .unauthorized) }

        let second = try store.issue(
            accountID: "account-a",
            generation: generation,
            candidates: [fuzzy],
            logins: [login]
        )
        let authorized = SecretReleasePayload(
            generation: generation,
            accountID: "account-a",
            candidateID: "cipher-a",
            field: .password,
            contextToken: second.contextToken,
            mismatchConfirmed: true,
            reprompt: RepromptResultPayload(result: .grant, grant: "valid-grant")
        )
        XCTAssertNoThrow(try store.validate(
            authorized,
            verifyRepromptGrant: { _, _, _, _, grant in grant == "valid-grant" }
        ))
        XCTAssertThrowsError(try store.validate(
            authorized,
            verifyRepromptGrant: { _, _, _, _, _ in true }
        )) { XCTAssertEqual($0 as? AgentProtocolError, .unauthorized) }

        let expired = try store.issue(
            accountID: "account-a",
            generation: generation,
            candidates: [fuzzy],
            logins: [login]
        )
        now += 31
        XCTAssertThrowsError(try store.validate(
            SecretReleasePayload(
                generation: generation,
                accountID: "account-a",
                candidateID: "cipher-a",
                field: .username,
                contextToken: expired.contextToken,
                mismatchConfirmed: true,
                reprompt: RepromptResultPayload(result: .grant, grant: "valid-grant")
            ),
            verifyRepromptGrant: { _, _, _, _, _ in true }
        )) { XCTAssertEqual($0 as? AgentProtocolError, .unauthorized) }
    }

    func testSecretAuthorizationRejectsDuplicateCandidateAndProjectionIDs() throws {
        let generation = UUID()
        let store = CandidateAuthorizationStore()
        let candidate = RankedCandidate(
            cipherID: "duplicate",
            displayName: "Example",
            username: "person@example.test",
            group: .other,
            reason: "other",
            requiresMismatchConfirmation: true
        )
        let projected = login("duplicate", name: "Example")

        XCTAssertThrowsError(try store.issue(
            accountID: "account-a",
            generation: generation,
            candidates: [candidate, candidate],
            logins: [projected]
        )) { XCTAssertEqual($0 as? AgentProtocolError, .malformedMessage) }
        XCTAssertThrowsError(try store.issue(
            accountID: "account-a",
            generation: generation,
            candidates: [candidate],
            logins: [projected, projected]
        )) { XCTAssertEqual($0 as? AgentProtocolError, .malformedMessage) }
    }

    private func login(
        _ cipherID: String,
        name: String,
        uris: [(String, String)] = [],
        favorite: Bool = false,
        lastUsedAt: String? = nil,
        reprompt: Bool = false
    ) -> AutoFillLogin {
        AutoFillLogin(
            cipherID: cipherID,
            name: name,
            username: "\(cipherID)@example.test",
            password: "secret-\(cipherID)",
            uris: uris.map { AutoFillURI(uri: $0.0, matchType: $0.1) },
            totp: "totp-\(cipherID)",
            favorite: favorite,
            reprompt: reprompt,
            lastUsedAt: lastUsedAt
        )
    }
}
