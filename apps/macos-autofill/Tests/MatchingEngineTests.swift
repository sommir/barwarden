import Foundation
import XCTest

final class MatchingEngineTests: XCTestCase {
    func testRepromptGrantIsShortLivedSingleUseAndBoundToEveryReleaseDimension() throws {
        let generation = UUID()
        var now: TimeInterval = 1_800_000_000
        let store = RepromptGrantStore(clock: { now }, lifetimeSeconds: 15)
        let grant = try store.issue(
            accountID: "account-a",
            cipherID: "cipher-a",
            field: .password,
            generation: generation,
            contextToken: "context-a"
        )

        XCTAssertFalse(store.consume(
            accountID: "account-a", cipherID: "cipher-a", field: .username,
            generation: generation, contextToken: "context-a", grant: grant
        ))
        XCTAssertFalse(store.consume(
            accountID: "account-a", cipherID: "cipher-a", field: .password,
            generation: generation, contextToken: "context-a", grant: grant
        ))

        let expired = try store.issue(
            accountID: "account-a", cipherID: "cipher-a", field: .password,
            generation: generation, contextToken: "context-a"
        )
        now += 16
        XCTAssertFalse(store.consume(
            accountID: "account-a", cipherID: "cipher-a", field: .password,
            generation: generation, contextToken: "context-a", grant: expired
        ))

        let success = try store.issue(
            accountID: "account-a", cipherID: "cipher-a", field: .password,
            generation: generation, contextToken: "context-a"
        )
        XCTAssertTrue(store.consume(
            accountID: "account-a", cipherID: "cipher-a", field: .password,
            generation: generation, contextToken: "context-a", grant: success
        ))
        XCTAssertFalse(store.consume(
            accountID: "account-a", cipherID: "cipher-a", field: .password,
            generation: generation, contextToken: "context-a", grant: success
        ))
    }

    func testProjectionURIWireAcceptsOnlyNumericBitwardenMatchValues() throws {
        for rawValue in UInt8(0)...UInt8(5) {
            let uri = try JSONDecoder().decode(
                AutoFillURI.self,
                from: Data("{\"uri\":\"https://example.test\",\"matchType\":\(rawValue)}".utf8)
            )
            XCTAssertEqual(uri.matchType.rawValue, rawValue)
        }
        XCTAssertThrowsError(try JSONDecoder().decode(
            AutoFillURI.self,
            from: Data("{\"uri\":\"https://example.test\",\"matchType\":6}".utf8)
        ))
        XCTAssertThrowsError(try JSONDecoder().decode(
            AutoFillURI.self,
            from: Data("{\"uri\":\"https://example.test\",\"matchType\":\"default\"}".utf8)
        ))
    }

    func testRanksExactSignalsByDocumentedPriorityBeforeRelevantAndOther() throws {
        let engine = MatchingEngine(
            presets: [AppPreset(bundleID: "com.example.target", services: ["preset.example"])],
            domainRules: DomainMatchRules(
                allowedRegistrableDomains: ["service.example"],
                privateSuffixes: []
            )
        )
        let context = NativeAutoFillContext(
            bundleID: "com.example.target",
            appName: "Target Desktop",
            serviceIdentifiers: ["https://login.service.example/account"],
            query: ""
        )
        let logins = [
            login("favorite", name: "Unrelated", favorite: true),
            login("host", name: "Host", uris: [("https://www.service.example", .domain)]),
            login("rule", name: "Rule", uris: [("https://login.service.example", .startsWith)]),
            login("preset", name: "Preset", uris: [("https://preset.example", .domain)]),
            login("service", name: "Service", uris: [("https://login.service.example/account", .domain)]),
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

    func testExactApplicationNameRanksAsRelevantWithoutAServiceIdentifier() throws {
        let ranked = MatchingEngine(presets: [], domainRules: .empty).rank(
            accountID: "account-a",
            logins: [
                login("unrelated", name: "Example"),
                login("termius", name: "Termius"),
            ],
            context: NativeAutoFillContext(
                bundleID: "com.termius-dmg.mac",
                appName: "Termius",
                serviceIdentifiers: [],
                query: ""
            ),
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.map(\.cipherID), ["termius", "unrelated"])
        XCTAssertEqual(ranked.first?.group, .relevant)
        XCTAssertEqual(ranked.first?.reason, "application_name")
        XCTAssertEqual(ranked.first?.requiresMismatchConfirmation, false)
    }

    func testApplicationNameSimilarityRanksByDegreeAndAlwaysConfirmsApproximateMatches() throws {
        let ranked = MatchingEngine(presets: [], domainRules: .empty).rank(
            accountID: "account-a",
            logins: [
                login("extended", name: "Termius SSH"),
                login("unrelated", name: "Personal Mail", favorite: true),
                login("typo", name: "Trmius"),
            ],
            context: NativeAutoFillContext(
                bundleID: "com.termius-dmg.mac",
                appName: "Termius",
                serviceIdentifiers: [],
                query: ""
            ),
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.map(\.cipherID), ["typo", "extended", "unrelated"])
        XCTAssertEqual(ranked.map(\.group), [.relevant, .other, .other])
        XCTAssertEqual(ranked.prefix(2).map(\.reason), [
            "application_name_similar", "application_name_similar",
        ])
        XCTAssertTrue(ranked.prefix(2).allSatisfy(\.requiresMismatchConfirmation))
    }

    func testHardServiceEvidenceAlwaysOutranksApproximateApplicationName() throws {
        let ranked = MatchingEngine(presets: [], domainRules: .empty).rank(
            accountID: "account-a",
            logins: [
                login("typo", name: "Trmius"),
                login("service", name: "Unrelated", uris: [("https://termius.example", .exact)]),
            ],
            context: NativeAutoFillContext(
                bundleID: "com.termius-dmg.mac",
                appName: "Termius",
                serviceIdentifiers: ["https://termius.example"],
                query: ""
            ),
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.map(\.cipherID), ["service", "typo"])
        XCTAssertEqual(ranked.map(\.group), [.exact, .relevant])
        XCTAssertFalse(ranked[0].requiresMismatchConfirmation)
        XCTAssertTrue(ranked[1].requiresMismatchConfirmation)
    }

    func testApplicationNameSimilarityScoreStaysAgentInternal() throws {
        let candidate = try XCTUnwrap(MatchingEngine(presets: [], domainRules: .empty).rank(
            accountID: "account-a",
            logins: [login("typo", name: "Trmius")],
            context: NativeAutoFillContext(
                bundleID: "com.termius-dmg.mac",
                appName: "Termius",
                serviceIdentifiers: [],
                query: ""
            ),
            bindings: [],
            history: []
        ).first)

        let encoded = try JSONEncoder().encode(candidate)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertNil(object["score"])
        XCTAssertNil(object["similarity"])
    }

    func testGenericBundleTokensDoNotCreateFuzzyMatches() throws {
        let ranked = MatchingEngine(presets: [], domainRules: .empty).rank(
            accountID: "account-a",
            logins: [
                login("dot-com", name: "Example", uris: [("https://example.com", .domain)]),
                login("mac", name: "CleanMyMac"),
                login("related", name: "Termius SSH"),
            ],
            context: NativeAutoFillContext(
                bundleID: "com.termius-dmg.mac",
                appName: "Termius",
                serviceIdentifiers: [],
                query: ""
            ),
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.first?.cipherID, "related")
        XCTAssertEqual(ranked.first?.reason, "application_name_similar")
        XCTAssertEqual(ranked.first?.requiresMismatchConfirmation, true)
        XCTAssertEqual(ranked.dropFirst().map(\.reason), ["other", "other"])
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
                login("context", name: "Production SSH", uris: [("ssh://production.example", .exact)]),
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
            logins: [login("service", name: "Service", uris: [("https://service.example/", .exact)])],
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
        let ranked = MatchingEngine(
            presets: [],
            domainRules: DomainMatchRules(
                allowedRegistrableDomains: ["example.co.uk"],
                privateSuffixes: []
            )
        ).rank(
            accountID: "account-a",
            logins: [
                login("domain", name: "Domain", uris: [("https://www.example.co.uk", .domain)]),
                login("host-rule", name: "Host", uris: [("https://login.example.co.uk/other", .host)]),
                login("never", name: "Never", uris: [("https://login.example.co.uk/path", .never)]),
                login("public-suffix", name: "Unsafe", uris: [("https://attacker.co.uk", .domain)]),
            ],
            context: context,
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.map(\.cipherID), ["host-rule", "domain", "never", "public-suffix"])
        XCTAssertEqual(ranked.map(\.group), [.exact, .relevant, .other, .other])
    }

    func testHostRuleHonorsSpecifiedEffectivePortAndNormalizesIPv6() throws {
        let cases: [(rule: String, service: String, expected: CandidateGroup)] = [
            ("https://example.test", "https://example.test:8443/login", .exact),
            ("https://example.test:8443", "http://example.test:8443/login", .exact),
            ("https://example.test:8443", "https://example.test/login", .other),
            ("https://example.test:443", "https://example.test/login", .exact),
            ("https://example.test:443", "http://example.test/login", .other),
            ("https://[2001:db8::1]:8443", "http://[2001:0DB8:0:0:0:0:0:1]:8443/x", .exact),
            ("https://[2001:db8::1]:8443", "https://[2001:db8::1]:443/x", .other),
        ]
        let engine = MatchingEngine(presets: [], domainRules: .empty)
        for testCase in cases {
            let candidate = try XCTUnwrap(engine.rank(
                accountID: "account-a",
                logins: [login("rule", name: "Unrelated", uris: [(testCase.rule, .host)])],
                context: NativeAutoFillContext(
                    bundleID: "com.no.fuzzy.match",
                    appName: "No Match",
                    serviceIdentifiers: [testCase.service],
                    query: ""
                ),
                bindings: [],
                history: []
            ).first)
            XCTAssertEqual(candidate.group, testCase.expected, "\(testCase.rule) vs \(testCase.service)")
        }
    }

    func testPrivateSuffixTenantsAndUnknownDelegationsNeverCrossMatch() throws {
        let rules = DomainMatchRules(
            allowedRegistrableDomains: [],
            privateSuffixes: ["github.io", "pages.dev", "vercel.app", "appspot.com"]
        )
        let engine = MatchingEngine(presets: [], domainRules: rules)
        for suffix in ["github.io", "pages.dev", "vercel.app", "appspot.com"] {
            let ranked = engine.rank(
                accountID: "account-a",
                logins: [
                    login("same-host", name: "Same", uris: [("https://alice.\(suffix)/other", .domain)]),
                    login("other-tenant", name: "Other", uris: [("https://bob.\(suffix)/login", .domain)]),
                ],
                context: NativeAutoFillContext(
                    bundleID: "com.example.App",
                    appName: "No Match",
                    serviceIdentifiers: ["https://alice.\(suffix)/login"],
                    query: ""
                ),
                bindings: [],
                history: []
            )
            XCTAssertEqual(ranked.map(\.cipherID), ["same-host", "other-tenant"], suffix)
            XCTAssertEqual(ranked.map(\.group), [.relevant, .other], suffix)
        }

        let unknown = engine.rank(
            accountID: "account-a",
            logins: [
                login("exact", name: "Exact", uris: [("https://alice.new-delegated/path", .exact)]),
                login("other", name: "Other", uris: [("https://bob.new-delegated/path", .domain)]),
            ],
            context: NativeAutoFillContext(
                bundleID: "com.example.App",
                appName: "No Match",
                serviceIdentifiers: ["https://alice.new-delegated/path"],
                query: ""
            ),
            bindings: [],
            history: []
        )
        XCTAssertEqual(unknown.map(\.group), [.exact, .other])
    }

    func testDomainRulesRequireTheReviewedPSLRevisionAndLicense() throws {
        let reviewed = Data("""
        {
          "sourceRevision":"e1b8015c3b2f0f4f8c18659c2480fc1a22c07b20",
          "license":"MPL-2.0",
          "allowedRegistrableDomains":["github.com"],
          "privateSuffixes":["github.io"]
        }
        """.utf8)
        XCTAssertNoThrow(try DomainMatchRules.decode(reviewed))

        let unreviewedRevision = Data("""
        {
          "sourceRevision":"0000000000000000000000000000000000000000",
          "license":"MPL-2.0",
          "allowedRegistrableDomains":["github.com"],
          "privateSuffixes":["github.io"]
        }
        """.utf8)
        XCTAssertThrowsError(try DomainMatchRules.decode(unreviewedRevision))
    }

    func testSchemelessExactCanonicalizationPreservesPortPercentPathAndQueryButIgnoresFragment() {
        let context = NativeAutoFillContext(
            bundleID: "com.example.App",
            appName: "No Match",
            serviceIdentifiers: ["BÜCHER.de:8443/a%2Fb?q=%2F#request-fragment"],
            query: ""
        )
        let ranked = MatchingEngine(presets: [], domainRules: .empty).rank(
            accountID: "account-a",
            logins: [
                login("same", name: "Same", uris: [("xn--bcher-kva.de:8443/a%2Fb?q=%2F#stored-fragment", .exact)]),
                login("port", name: "Port", uris: [("xn--bcher-kva.de/a%2Fb?q=%2F", .exact)]),
                login("percent", name: "Percent", uris: [("xn--bcher-kva.de:8443/a%2fb?q=%2F", .exact)]),
                login("query", name: "Query", uris: [("xn--bcher-kva.de:8443/a%2Fb?q=%2F&x=1", .exact)]),
            ],
            context: context,
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.map(\.cipherID), ["same", "percent", "port", "query"])
        XCTAssertEqual(ranked.map(\.group), [.exact, .other, .other, .other])
    }

    func testRegexAndNeverURIsContributeNoContextFuzzyOrQuerySignal() {
        let logins = [
            login("pattern", name: "Unrelated", uris: [("^https://regex\\.example$", .regularExpression)]),
            login("blocked", name: "Unrelated", uris: [("https://never.example/path", .never)]),
        ]
        let engine = MatchingEngine(presets: [], domainRules: .empty)
        let contextual = engine.rank(
            accountID: "account-a",
            logins: logins,
            context: NativeAutoFillContext(
                bundleID: "com.example.App",
                appName: "No Match",
                serviceIdentifiers: ["https://never.example/path", "https://regex.example"],
                query: ""
            ),
            bindings: [],
            history: []
        )
        XCTAssertTrue(contextual.allSatisfy { $0.group == .other })

        let queried = engine.rank(
            accountID: "account-a",
            logins: logins,
            context: NativeAutoFillContext(
                bundleID: "com.example.App",
                appName: "No Match",
                serviceIdentifiers: [],
                query: "never.example"
            ),
            bindings: [],
            history: []
        )
        XCTAssertTrue(queried.isEmpty)
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
                login("idna", name: "Books", uris: [("https://xn--bcher-kva.de/login", .exact)]),
                login("confusable", name: "Other", uris: [("https://b\u{443}cher.de/login", .exact)]),
            ],
            context: context,
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.map(\.cipherID), ["idna", "confusable"])
        XCTAssertEqual(ranked.map(\.group), [.exact, .other])
        XCTAssertEqual(ranked.last?.requiresMismatchConfirmation, true)
    }

    func testStartsWithRuleCannotCrossAHostBoundary() {
        let ranked = MatchingEngine(presets: [], domainRules: .empty).rank(
            accountID: "account-a",
            logins: [login(
                "rule", name: "Unrelated", uris: [("https://example.test", .startsWith)]
            )],
            context: NativeAutoFillContext(
                bundleID: "com.example.app",
                appName: "Different Application",
                serviceIdentifiers: ["https://example.test.evil.invalid/login"],
                query: ""
            ),
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.first?.group, .other)
        XCTAssertTrue(ranked.first?.requiresMismatchConfirmation == true)
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
            login("recent", name: "Recent", lastUsedAt: 1_786_233_600_000),
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
                lastSelectedAt: 1_786_147_200_000
            ),
            MatchingHistoryEntry(
                accountID: "account-b",
                contextKey: "app:com.example.app",
                cipherID: "z",
                successfulSelectionCount: 99,
                lastSelectedAt: 1_893_456_000_000
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

    func testRecentCandidatesUseDescendingEpochBeforeStableTextAndInvalidValuesAreLowest() {
        let ranked = MatchingEngine(presets: [], domainRules: .empty).rank(
            accountID: "account-a",
            logins: [
                login("older", name: "Alpha", lastUsedAt: 1_700_000_000_000),
                login("newer", name: "Zulu", lastUsedAt: 1_800_000_000_000),
                login("zero", name: "Able", lastUsedAt: 0),
                login("negative", name: "Baker", lastUsedAt: -1),
                login("nil", name: "Charlie"),
            ],
            context: NativeAutoFillContext(
                bundleID: "com.no.fuzzy.match",
                appName: "No Match",
                serviceIdentifiers: [],
                query: ""
            ),
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.map(\.cipherID), ["newer", "older", "zero", "negative", "nil"])
        XCTAssertEqual(ranked.map(\.reason), ["recent", "recent", "other", "other", "other"])
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
                uris: [AutoFillURI(uri: uri, matchType: .exact)],
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

    func testShippedBitwardenDesktopPresetRanksBitwardenVaultLoginAsExact() throws {
        let presetURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Agent/AppPresets.json")
        let presets = try AppPresetCatalog.decode(Data(contentsOf: presetURL))
        let ranked = MatchingEngine(presets: presets, domainRules: .empty).rank(
            accountID: "account-a",
            logins: [login(
                "bitwarden-login",
                name: "Bitwarden",
                uris: [("https://vault.bitwarden.com", .domain)]
            )],
            context: NativeAutoFillContext(
                bundleID: "com.bitwarden.desktop",
                appName: "Bitwarden",
                serviceIdentifiers: [],
                query: ""
            ),
            bindings: [],
            history: []
        )

        XCTAssertEqual(ranked.first?.group, .exact)
        XCTAssertEqual(ranked.first?.reason, "app_preset")
        XCTAssertEqual(ranked.first?.requiresMismatchConfirmation, false)
    }

    func testRawAgentLoadsMatchingResourcesFromTheOuterApplicationBundle() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let executable = root
            .appendingPathComponent("Contents/Helpers/BarwardenAutoFillAgent")
        let resources = root
            .appendingPathComponent("Contents/Resources/BarwardenAutoFill", isDirectory: true)
        try FileManager.default.createDirectory(
            at: executable.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let sourceRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Agent", isDirectory: true)
        try FileManager.default.copyItem(
            at: sourceRoot.appendingPathComponent("AppPresets.json"),
            to: resources.appendingPathComponent("AppPresets.json")
        )
        try FileManager.default.copyItem(
            at: sourceRoot.appendingPathComponent("DomainMatchRules.json"),
            to: resources.appendingPathComponent("DomainMatchRules.json")
        )

        let presets = AppPresetCatalog.bundled(bundleResourceURL: nil, executableURL: executable)
        let rules = DomainMatchRules.bundled(bundleResourceURL: nil, executableURL: executable)

        XCTAssertTrue(presets.contains { $0.bundleID == "com.bitwarden.desktop" })
        XCTAssertFalse(rules.allowedRegistrableDomains.isEmpty)
        XCTAssertFalse(rules.privateSuffixes.isEmpty)
    }

    func testProjectionDecodesAccountScopedBindingsHistoryAndRecentMetadata() throws {
        let projection = try JSONDecoder().decode(AutoFillProjection.self, from: Data("""
        {
          "version":1,"accountId":"account-a","vaultRevision":3,
          "createdAt":"2026-08-08T00:00:00Z",
          "logins":[{
            "cipherId":"cipher-a","name":"Example","username":"person@example.test",
            "password":"secret","uris":[],"totp":"seed","favorite":false,"reprompt":false,
            "lastUsedAt":1786233600000
          }],
          "bindings":[{"bundleId":"com.example.app","cipherId":"cipher-a"}],
          "history":[{
            "contextKey":"app:com.example.app","cipherId":"cipher-a",
            "successfulSelectionCount":2,"lastSelectedAt":1786233600000
          }]
        }
        """.utf8))

        XCTAssertEqual(projection.logins.first?.lastUsedAt, 1_786_233_600_000)
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
        let context = NativeAutoFillContext(
            bundleID: "com.example.app",
            appName: "Example",
            serviceIdentifiers: ["https://example.test"],
            query: ""
        )
        let contextDigest = Data(repeating: 0x11, count: 32)
        let policyDigest = Data(repeating: 0x22, count: 32)
        let first = try store.issue(
            accountID: "account-a",
            generation: generation,
            field: .password,
            vaultRevision: 7,
            context: context,
            contextDigest: contextDigest,
            policyDigest: policyDigest,
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
            authorization: try XCTUnwrap(store.take(contextToken: first.contextToken)),
            currentVaultRevision: 7,
            currentContextDigest: contextDigest,
            currentPolicyDigest: policyDigest,
            verifyRepromptGrant: { _, _, _, _, _, _ in true }
        )) { XCTAssertEqual($0 as? AgentProtocolError, .unauthorized) }

        let second = try store.issue(
            accountID: "account-a",
            generation: generation,
            field: .password,
            vaultRevision: 7,
            context: context,
            contextDigest: contextDigest,
            policyDigest: policyDigest,
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
        let secondAuthorization = try XCTUnwrap(store.take(contextToken: second.contextToken))
        XCTAssertNoThrow(try store.validate(
            authorized,
            authorization: secondAuthorization,
            currentVaultRevision: 7,
            currentContextDigest: contextDigest,
            currentPolicyDigest: policyDigest,
            verifyRepromptGrant: { _, _, _, _, _, grant in grant == "valid-grant" }
        ))
        XCTAssertNil(store.take(contextToken: second.contextToken))

        let wrongField = try store.issue(
            accountID: "account-a",
            generation: generation,
            field: .password,
            vaultRevision: 7,
            context: context,
            contextDigest: contextDigest,
            policyDigest: policyDigest,
            candidates: [fuzzy],
            logins: [login]
        )
        XCTAssertThrowsError(try store.validate(
            SecretReleasePayload(
                generation: generation,
                accountID: "account-a",
                candidateID: "cipher-a",
                field: .username,
                contextToken: wrongField.contextToken,
                mismatchConfirmed: true,
                reprompt: RepromptResultPayload(result: .grant, grant: "valid-grant")
            ),
            authorization: try XCTUnwrap(store.take(contextToken: wrongField.contextToken)),
            currentVaultRevision: 7,
            currentContextDigest: contextDigest,
            currentPolicyDigest: policyDigest,
            verifyRepromptGrant: { _, _, _, _, _, _ in true }
        )) { XCTAssertEqual($0 as? AgentProtocolError, .unauthorized) }

        let expired = try store.issue(
            accountID: "account-a",
            generation: generation,
            field: .password,
            vaultRevision: 7,
            context: context,
            contextDigest: contextDigest,
            policyDigest: policyDigest,
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
            authorization: try XCTUnwrap(store.take(contextToken: expired.contextToken)),
            currentVaultRevision: 7,
            currentContextDigest: contextDigest,
            currentPolicyDigest: policyDigest,
            verifyRepromptGrant: { _, _, _, _, _, _ in true }
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
        let context = NativeAutoFillContext(
            bundleID: "com.example.app", appName: "Example", serviceIdentifiers: [], query: ""
        )
        let contextDigest = Data(repeating: 0x11, count: 32)
        let policyDigest = Data(repeating: 0x22, count: 32)

        XCTAssertThrowsError(try store.issue(
            accountID: "account-a",
            generation: generation,
            field: .password,
            vaultRevision: 1,
            context: context,
            contextDigest: contextDigest,
            policyDigest: policyDigest,
            candidates: [candidate, candidate],
            logins: [projected]
        )) { XCTAssertEqual($0 as? AgentProtocolError, .malformedMessage) }
        XCTAssertThrowsError(try store.issue(
            accountID: "account-a",
            generation: generation,
            field: .password,
            vaultRevision: 1,
            context: context,
            contextDigest: contextDigest,
            policyDigest: policyDigest,
            candidates: [candidate],
            logins: [projected, projected]
        )) { XCTAssertEqual($0 as? AgentProtocolError, .malformedMessage) }
    }

    func testContextAndPolicyDigestsBindRevisionRepromptURIAndCandidateDeletion() throws {
        let engine = MatchingEngine(presets: [], domainRules: .empty)
        let context = NativeAutoFillContext(
            bundleID: "COM.EXAMPLE.App",
            appName: "Example",
            serviceIdentifiers: ["HTTPS://EXAMPLE.TEST/path#fragment"],
            query: "  admin  "
        )
        let canonicalEquivalent = NativeAutoFillContext(
            bundleID: "com.example.app",
            appName: "example",
            serviceIdentifiers: ["https://example.test/path#other"],
            query: "admin"
        )
        XCTAssertEqual(
            engine.authorizationContextDigest(context),
            engine.authorizationContextDigest(canonicalEquivalent)
        )

        let baseLogin = login(
            "cipher-a",
            name: "Example",
            uris: [("https://example.test/path", .exact)]
        )
        let projection = { (revision: UInt64, logins: [AutoFillLogin]) in
            AutoFillProjection(
                version: 1,
                accountID: "account-a",
                vaultRevision: revision,
                createdAt: "2026-08-08T00:00:00Z",
                logins: logins
            )
        }
        let base = engine.authorizationPolicyDigest(
            projection: projection(7, [baseLogin]),
            context: context
        )
        XCTAssertNotEqual(base, engine.authorizationPolicyDigest(
            projection: projection(8, [baseLogin]),
            context: context
        ))
        XCTAssertNotEqual(base, engine.authorizationPolicyDigest(
            projection: projection(7, [AutoFillLogin(
                cipherID: baseLogin.cipherID,
                name: baseLogin.name,
                username: baseLogin.username,
                password: baseLogin.password,
                uris: baseLogin.uris,
                totp: baseLogin.totp,
                favorite: baseLogin.favorite,
                reprompt: true
            )]),
            context: context
        ))
        XCTAssertNotEqual(base, engine.authorizationPolicyDigest(
            projection: projection(7, [login(
                "cipher-a", name: "Example", uris: [("https://changed.example/path", .exact)]
            )]),
            context: context
        ))
        XCTAssertNotEqual(base, engine.authorizationPolicyDigest(
            projection: projection(7, []),
            context: context
        ))
    }

    private func login(
        _ cipherID: String,
        name: String,
        uris: [(String, AutoFillURIMatch)] = [],
        favorite: Bool = false,
        lastUsedAt: Int64? = nil,
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
