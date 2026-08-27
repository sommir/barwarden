import CryptoKit
import Darwin
import Foundation

struct AppPreset: Codable, Equatable {
    let bundleID: String
    let services: [String]

    private enum CodingKeys: String, CodingKey {
        case bundleID = "bundleId"
        case services
    }
}

enum AppPresetCatalog {
    static func decode(_ data: Data) throws -> [AppPreset] {
        guard let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            throw AgentProtocolError.malformedMessage
        }
        let allowedKeys: Set<String> = ["bundleId", "services"]
        guard !rows.isEmpty, rows.count <= 128, rows.allSatisfy({ row in
            Set(row.keys).isSubset(of: allowedKeys)
                && Set(row.keys) == allowedKeys
                && (row["bundleId"] as? String).map({ !$0.isEmpty && $0.count <= 255 }) == true
                && (row["services"] as? [String]).map({
                    !$0.isEmpty && $0.count <= 16 && $0.allSatisfy { !$0.isEmpty && $0.count <= 2_048 }
                }) == true
        }) else {
            throw AgentProtocolError.malformedMessage
        }
        return try JSONDecoder().decode([AppPreset].self, from: data)
    }

    static func bundled(in bundle: Bundle = .main) -> [AppPreset] {
        bundled(bundleResourceURL: bundle.resourceURL, executableURL: bundle.executableURL)
    }

    static func bundled(bundleResourceURL: URL?, executableURL: URL?) -> [AppPreset] {
        guard let url = agentResourceURL(
            named: "AppPresets.json",
            bundleResourceURL: bundleResourceURL,
            executableURL: executableURL
        ),
              let data = try? Data(contentsOf: url),
              let presets = try? decode(data) else { return [] }
        return presets
    }
}

struct DomainMatchRules: Equatable {
    static let reviewedSourceRevision = "e1b8015c3b2f0f4f8c18659c2480fc1a22c07b20"
    static let sourceLicense = "MPL-2.0"

    let publicSuffixRules: Set<String>
    let exceptionRules: Set<String>
    private let exactSuffixes: Set<String>
    private let wildcardSuffixes: Set<String>

    private struct Document: Codable {
        let sourceRevision: String
        let license: String
        let publicSuffixRules: [String]
        let exceptionRules: [String]
    }

    static let empty = DomainMatchRules(publicSuffixRules: [], exceptionRules: [])

    init(publicSuffixRules: [String], exceptionRules: [String]) {
        let normalizedRules = Set(publicSuffixRules.map(Self.normalizeRule))
        self.publicSuffixRules = normalizedRules
        self.exceptionRules = Set(exceptionRules.map(Self.normalizeRule))
        exactSuffixes = Set(normalizedRules.filter { !$0.hasPrefix("*.") })
        wildcardSuffixes = Set(normalizedRules.compactMap { rule in
            rule.hasPrefix("*.") ? String(rule.dropFirst(2)) : nil
        })
    }

    static func decode(_ data: Data) throws -> DomainMatchRules {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == [
                "sourceRevision", "license", "publicSuffixRules", "exceptionRules",
              ] else {
            throw AgentProtocolError.malformedMessage
        }
        let document = try JSONDecoder().decode(Document.self, from: data)
        guard document.sourceRevision == reviewedSourceRevision,
              document.license == sourceLicense,
              document.publicSuffixRules.count >= 9_000,
              document.publicSuffixRules.count <= 20_000,
              !document.exceptionRules.isEmpty,
              document.exceptionRules.count <= 512,
              Set(document.publicSuffixRules).count == document.publicSuffixRules.count,
              Set(document.exceptionRules).count == document.exceptionRules.count,
              document.publicSuffixRules.allSatisfy(Self.isValidPublicSuffixRule),
              document.exceptionRules.allSatisfy(Self.isValidExceptionRule) else {
            throw AgentProtocolError.malformedMessage
        }
        return DomainMatchRules(
            publicSuffixRules: document.publicSuffixRules,
            exceptionRules: document.exceptionRules
        )
    }

    static func bundled(in bundle: Bundle = .main) -> DomainMatchRules {
        bundled(bundleResourceURL: bundle.resourceURL, executableURL: bundle.executableURL)
    }

    static func bundled(bundleResourceURL: URL?, executableURL: URL?) -> DomainMatchRules {
        guard let url = agentResourceURL(
            named: "DomainMatchRules.json",
            bundleResourceURL: bundleResourceURL,
            executableURL: executableURL
        ),
              let data = try? Data(contentsOf: url),
              let rules = try? decode(data) else { return .empty }
        return rules
    }

    func registrableDomain(for host: String) -> String? {
        let normalized = Self.normalizeRule(host)
        let labels = normalized.split(separator: ".").map(String.init)
        guard labels.count >= 2,
              labels.allSatisfy(Self.isValidHostLabel) else { return nil }

        var publicSuffixLabelCount: Int?
        for suffixLabelCount in 1...labels.count {
            let suffix = labels.suffix(suffixLabelCount).joined(separator: ".")
            if exceptionRules.contains(suffix) {
                let exceptionSuffixLabels = suffixLabelCount - 1
                guard labels.count > exceptionSuffixLabels else { return nil }
                return labels.suffix(exceptionSuffixLabels + 1).joined(separator: ".")
            }
            if exactSuffixes.contains(suffix) {
                publicSuffixLabelCount = max(publicSuffixLabelCount ?? 0, suffixLabelCount)
            }
            if labels.count > suffixLabelCount, wildcardSuffixes.contains(suffix) {
                publicSuffixLabelCount = max(publicSuffixLabelCount ?? 0, suffixLabelCount + 1)
            }
        }
        guard let suffixLabels = publicSuffixLabelCount,
              labels.count > suffixLabels else { return nil }
        return labels.suffix(suffixLabels + 1).joined(separator: ".")
    }

    private static func normalizeRule(_ value: String) -> String {
        value.trimmingCharacters(in: CharacterSet(charactersIn: ". "))
            .lowercased(with: Locale(identifier: "en_US_POSIX"))
    }

    private static func isValidPublicSuffixRule(_ value: String) -> Bool {
        let normalized = normalizeRule(value)
        let suffix = normalized.hasPrefix("*.") ? String(normalized.dropFirst(2)) : normalized
        return !normalized.isEmpty
            && normalized.count <= 255
            && !suffix.isEmpty
            && suffix.split(separator: ".").allSatisfy { isValidHostLabel(String($0)) }
    }

    private static func isValidExceptionRule(_ value: String) -> Bool {
        let normalized = normalizeRule(value)
        return normalized.count <= 255
            && normalized.split(separator: ".").count >= 2
            && normalized.split(separator: ".").allSatisfy { isValidHostLabel(String($0)) }
    }

    private static func isValidHostLabel(_ value: String) -> Bool {
        !value.isEmpty
            && value.count <= 63
            && value.first != "-"
            && value.last != "-"
            && value.unicodeScalars.allSatisfy {
                CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-").contains($0)
            }
    }
}

private func agentResourceURL(
    named name: String,
    bundleResourceURL: URL?,
    executableURL: URL?
) -> URL? {
    let candidates = [
        bundleResourceURL?.appendingPathComponent(name, isDirectory: false),
        executableURL?
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Resources/BarwardenAutoFill", isDirectory: true)
            .appendingPathComponent(name, isDirectory: false),
    ]
    return candidates.compactMap { $0 }.first { FileManager.default.isReadableFile(atPath: $0.path) }
}

struct UserAppBinding: Codable, Equatable {
    let accountID: String
    let bundleID: String
    let cipherID: String
}

struct MatchingHistoryEntry: Codable, Equatable {
    let accountID: String
    let contextKey: String
    let cipherID: String
    let successfulSelectionCount: UInt
    let lastSelectedAt: Int64
}

struct MatchingEngine {
    let presets: [AppPreset]
    let domainRules: DomainMatchRules

    init(
        presets: [AppPreset],
        domainRules: DomainMatchRules = .bundled()
    ) {
        self.presets = presets
        self.domainRules = domainRules
    }

    private enum Signal {
        case binding
        case serviceIdentifier
        case preset
        case uriRule
        case domainHost
        case domain
        case browserName
        case browserDescription
        case applicationName
        case applicationNameSimilarRelevant
        case applicationNameSimilarOther
        case fuzzy
        case history
        case favorite
        case recent
        case other

        var group: CandidateGroup {
            switch self {
            case .binding, .serviceIdentifier, .preset, .uriRule: .exact
            case .domainHost, .domain, .browserName, .browserDescription,
                 .applicationName, .applicationNameSimilarRelevant: .relevant
            default: .other
            }
        }

        var reason: String {
            switch self {
            case .binding: "user_binding"
            case .serviceIdentifier: "service_identifier"
            case .preset: "app_preset"
            case .uriRule: "vault_uri_rule"
            case .domainHost, .domain: "host_or_domain"
            case .browserName: "browser_name"
            case .browserDescription: "browser_description"
            case .applicationName: "application_name"
            case .applicationNameSimilarRelevant, .applicationNameSimilarOther:
                "application_name_similar"
            case .fuzzy: "fuzzy_name"
            case .history: "selection_history"
            case .favorite: "favorite"
            case .recent: "recent"
            case .other: "other"
            }
        }

        var defaultRankScore: Int {
            switch self {
            case .binding: 1_000_000
            case .serviceIdentifier: 980_000
            case .preset: 960_000
            case .uriRule: 940_000
            case .domainHost: 930_000
            case .domain: 920_000
            case .browserName: 800_000
            case .browserDescription: 780_000
            case .applicationName: 900_000
            case .applicationNameSimilarRelevant, .applicationNameSimilarOther: 650_000
            case .fuzzy: 640_000
            case .history: 300_000
            case .favorite: 200_000
            case .recent: 100_000
            case .other: 0
            }
        }

        var requiresMismatchConfirmation: Bool {
            false
        }
    }

    private struct ScoredSignal {
        let signal: Signal
        let rankScore: Int

        init(_ signal: Signal, rankScore: Int? = nil) {
            self.signal = signal
            self.rankScore = rankScore ?? signal.defaultRankScore
        }
    }

    private struct ScoredCandidate {
        let login: AutoFillLogin
        let scoredSignal: ScoredSignal
        let historyCount: UInt
        let historyDate: Int64
        let recentDate: Int64
    }

    func rank(
        accountID: String,
        logins: [AutoFillLogin],
        context: NativeAutoFillContext,
        bindings: [UserAppBinding],
        history: [MatchingHistoryEntry]
    ) -> [RankedCandidate] {
        let normalizedBundleID = Self.normalizeText(context.bundleID)
        let browserContext = Self.isBrowserContext(context)
        let scopedBindings = browserContext ? [] : bindings.filter {
            $0.accountID == accountID && Self.normalizeText($0.bundleID) == normalizedBundleID
        }
        let presetServices = browserContext ? [] : presets
            .filter { Self.normalizeText($0.bundleID) == normalizedBundleID }
            .flatMap(\.services)
        let contextKey = Self.contextKey(context)
        let scopedHistory = history.filter {
            $0.accountID == accountID && $0.contextKey == contextKey
        }
        let query = Self.normalizeText(context.query.trimmingCharacters(in: .whitespacesAndNewlines))
        let eligibleLogins = query.isEmpty ? logins : logins.filter {
            Self.queryMatches(query, login: $0)
        }
        return eligibleLogins.map { login in
            let matchingHistory = scopedHistory.first { $0.cipherID == login.cipherID }
            return ScoredCandidate(
                login: login,
                scoredSignal: signal(
                    for: login,
                    context: context,
                    bindings: scopedBindings,
                    presetServices: presetServices,
                    browserContext: browserContext,
                    hasHistory: matchingHistory != nil
                ),
                historyCount: matchingHistory?.successfulSelectionCount ?? 0,
                historyDate: matchingHistory?.lastSelectedAt ?? 0,
                recentDate: max(login.lastUsedAt ?? 0, 0)
            )
        }.sorted { lhs, rhs in
            if lhs.scoredSignal.rankScore != rhs.scoredSignal.rankScore {
                return lhs.scoredSignal.rankScore > rhs.scoredSignal.rankScore
            }
            if lhs.historyCount != rhs.historyCount { return lhs.historyCount > rhs.historyCount }
            if lhs.historyDate != rhs.historyDate { return lhs.historyDate > rhs.historyDate }
            if lhs.scoredSignal.signal == .recent, lhs.recentDate != rhs.recentDate {
                return lhs.recentDate > rhs.recentDate
            }
            let left = (
                Self.normalizeText(lhs.login.name),
                Self.normalizeText(lhs.login.username),
                lhs.login.cipherID
            )
            let right = (
                Self.normalizeText(rhs.login.name),
                Self.normalizeText(rhs.login.username),
                rhs.login.cipherID
            )
            return left < right
        }.map {
            RankedCandidate(
                cipherID: $0.login.cipherID,
                displayName: $0.login.name,
                username: $0.login.username,
                group: $0.scoredSignal.signal.group,
                reason: $0.scoredSignal.signal.reason,
                requiresMismatchConfirmation: $0.scoredSignal.signal.requiresMismatchConfirmation
            )
        }
    }

    private func signal(
        for login: AutoFillLogin,
        context: NativeAutoFillContext,
        bindings: [UserAppBinding],
        presetServices: [String],
        browserContext: Bool,
        hasHistory: Bool
    ) -> ScoredSignal {
        if bindings.contains(where: { $0.cipherID == login.cipherID }) {
            return ScoredSignal(.binding)
        }
        if login.uris.contains(where: { uri in
            guard Self.isContextMatchable(uri) else { return false }
            return context.serviceIdentifiers.contains { Self.servicesAreExactlyEqual($0, uri.uri) }
        }) { return ScoredSignal(.serviceIdentifier) }
        if login.uris.contains(where: { uri in
            guard Self.isContextMatchable(uri) else { return false }
            return presetServices.contains { Self.hostOrServiceMatches($0, uri.uri) }
        }) { return ScoredSignal(.preset) }
        if login.uris.contains(where: { uri in
            guard uri.matchType == .host
                    || uri.matchType == .startsWith
                    || uri.matchType == .exact else { return false }
            return context.serviceIdentifiers.contains { uriRuleMatches(uri, service: $0) }
        }) { return ScoredSignal(.uriRule) }
        if login.uris.contains(where: { uri in
            guard uri.matchType == .domain, let storedHost = Self.host(uri.uri) else { return false }
            return context.serviceIdentifiers.contains { Self.host($0) == storedHost }
        }) { return ScoredSignal(.domainHost) }
        if login.uris.contains(where: { uri in
            guard uri.matchType == .domain else { return false }
            return context.serviceIdentifiers.contains { hostOrDomainMatches($0, uri.uri) }
        }) { return ScoredSignal(.domain) }
        if browserContext, let textSignal = browserTextSignal(for: login, context: context) {
            return ScoredSignal(textSignal)
        }
        if !browserContext, let nameMatch = ApplicationNameSimilarity.compare(
            applicationName: context.appName,
            itemName: login.name
        ) {
            switch nameMatch.kind {
            case .exact:
                return ScoredSignal(.applicationName)
            case .approximate:
                let bounded = min(max(nameMatch.similarity, 7_200), 10_000)
                let score = 650_000 + (bounded - 7_200) * 249_999 / 2_800
                return ScoredSignal(
                    nameMatch.isHighConfidence
                        ? .applicationNameSimilarRelevant
                        : .applicationNameSimilarOther,
                    rankScore: score
                )
            }
        }
        if !browserContext, Self.fuzzyMatches(login: login, context: context) {
            return ScoredSignal(.fuzzy)
        }
        if !browserContext, hasHistory { return ScoredSignal(.history) }
        if login.favorite { return ScoredSignal(.favorite) }
        if let lastUsedAt = login.lastUsedAt, lastUsedAt > 0 { return ScoredSignal(.recent) }
        return ScoredSignal(.other)
    }

    static func contextKey(_ context: NativeAutoFillContext) -> String {
        let bundle = normalizeText(context.bundleID)
        if isBrowserContext(context),
           let firstHost = context.serviceIdentifiers.compactMap(host).sorted().first {
            return "service:\(firstHost)"
        }
        if !bundle.isEmpty { return "app:\(bundle)" }
        if let firstHost = context.serviceIdentifiers.compactMap(host).sorted().first {
            return "service:\(firstHost)"
        }
        return "unknown"
    }

    private static let browserBundleIDs: Set<String> = [
        "com.apple.Safari",
        "com.apple.SafariTechnologyPreview",
        "com.google.Chrome",
        "com.google.Chrome.beta",
        "com.google.Chrome.canary",
        "com.microsoft.edgemac",
        "com.microsoft.edgemac.Beta",
        "com.microsoft.edgemac.Dev",
        "com.microsoft.edgemac.Canary",
        "com.brave.Browser",
        "com.brave.Browser.beta",
        "com.brave.Browser.nightly",
        "company.thebrowser.Browser",
        "org.chromium.Chromium",
        "com.vivaldi.Vivaldi",
        "com.operasoftware.Opera",
        "com.operasoftware.OperaGX",
    ].reduce(into: Set<String>()) { result, bundleID in
        result.insert(normalizeText(bundleID))
    }

    private static func isBrowserContext(_ context: NativeAutoFillContext) -> Bool {
        browserBundleIDs.contains(normalizeText(context.bundleID))
    }

    func authorizationContextDigest(_ context: NativeAutoFillContext) -> Data {
        var digest = SHA256()
        Self.append("context-v1", to: &digest)
        Self.append(Self.normalizeText(context.bundleID), to: &digest)
        Self.append(Self.normalizeText(context.appName), to: &digest)
        Self.append(Self.normalizeText(
            context.query.trimmingCharacters(in: .whitespacesAndNewlines)
        ), to: &digest)
        let services = context.serviceIdentifiers.map {
            Self.canonicalExactService($0) ?? Self.normalizeText(
                $0.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }.sorted()
        Self.append(UInt64(services.count), to: &digest)
        services.forEach { Self.append($0, to: &digest) }
        return Data(digest.finalize())
    }

    func authorizationPolicyDigest(
        projection: AutoFillProjection,
        context: NativeAutoFillContext
    ) -> Data {
        var digest = SHA256()
        Self.append("policy-v1", to: &digest)
        Self.append(projection.accountID, to: &digest)
        Self.append(projection.vaultRevision, to: &digest)
        digest.update(data: authorizationContextDigest(context))
        Self.append(UInt64(presets.count), to: &digest)
        for preset in presets.sorted(by: { $0.bundleID < $1.bundleID }) {
            Self.append(Self.normalizeText(preset.bundleID), to: &digest)
            let services = preset.services.map {
                Self.canonicalExactService($0) ?? Self.normalizeText($0)
            }.sorted()
            Self.append(UInt64(services.count), to: &digest)
            services.forEach { Self.append($0, to: &digest) }
        }
        Self.append(UInt64(domainRules.publicSuffixRules.count), to: &digest)
        domainRules.publicSuffixRules.sorted().forEach { Self.append($0, to: &digest) }
        Self.append(UInt64(domainRules.exceptionRules.count), to: &digest)
        domainRules.exceptionRules.sorted().forEach { Self.append($0, to: &digest) }
        Self.append(UInt64(projection.logins.count), to: &digest)
        for login in projection.logins.sorted(by: { $0.cipherID < $1.cipherID }) {
            Self.append(login.cipherID, to: &digest)
            Self.append(login.name, to: &digest)
            Self.append(login.notes ?? "", to: &digest)
            Self.append(login.username, to: &digest)
            // These values never leave the Agent; hashing them makes an already-issued
            // authorization stale if the encrypted projection changes a requested secret.
            Self.append(login.password, to: &digest)
            Self.append(login.totp, to: &digest)
            Self.append(login.favorite ? UInt64(1) : UInt64(0), to: &digest)
            Self.append(login.reprompt ? UInt64(1) : UInt64(0), to: &digest)
            Self.append(UInt64(bitPattern: login.lastUsedAt ?? 0), to: &digest)
            let uris = login.uris.sorted(by: {
                ($0.matchType.rawValue, $0.uri) < ($1.matchType.rawValue, $1.uri)
            })
            Self.append(UInt64(uris.count), to: &digest)
            for uri in uris {
                Self.append(UInt64(uri.matchType.rawValue), to: &digest)
                Self.append(Self.canonicalExactService(uri.uri) ?? Self.normalizeText(uri.uri), to: &digest)
            }
        }
        Self.append(UInt64(projection.bindings.count), to: &digest)
        for binding in projection.bindings.sorted(by: {
            ($0.bundleID, $0.cipherID) < ($1.bundleID, $1.cipherID)
        }) {
            Self.append(Self.normalizeText(binding.bundleID), to: &digest)
            Self.append(binding.cipherID, to: &digest)
        }
        Self.append(UInt64(projection.history.count), to: &digest)
        for entry in projection.history.sorted(by: {
            ($0.contextKey, $0.cipherID) < ($1.contextKey, $1.cipherID)
        }) {
            Self.append(Self.normalizeText(entry.contextKey), to: &digest)
            Self.append(entry.cipherID, to: &digest)
            Self.append(UInt64(entry.successfulSelectionCount), to: &digest)
            Self.append(UInt64(bitPattern: entry.lastSelectedAt), to: &digest)
        }
        return Data(digest.finalize())
    }

    private static func servicesAreExactlyEqual(_ lhs: String, _ rhs: String) -> Bool {
        guard let left = canonicalExactService(lhs),
              let right = canonicalExactService(rhs) else { return false }
        return left == right
    }

    private static func hostOrServiceMatches(_ lhs: String, _ rhs: String) -> Bool {
        servicesAreExactlyEqual(lhs, rhs) || host(lhs) == host(rhs)
    }

    private func uriRuleMatches(_ rule: AutoFillURI, service: String) -> Bool {
        switch rule.matchType {
        case .exact: return Self.servicesAreExactlyEqual(service, rule.uri)
        case .startsWith:
            guard let candidate = Self.canonicalExactService(service),
                  let expected = Self.canonicalExactService(rule.uri),
                  Self.host(service) == Self.host(rule.uri) else { return false }
            return candidate.hasPrefix(expected)
        case .host: return Self.hostRuleMatches(rule.uri, service)
        case .domain:
            return hostOrDomainMatches(rule.uri, service)
        case .regularExpression, .never: return false
        }
    }

    private static func isContextMatchable(_ uri: AutoFillURI) -> Bool {
        uri.matchType != .regularExpression && uri.matchType != .never
    }

    private static func queryMatches(_ query: String, login: AutoFillLogin) -> Bool {
        let searchable = normalizeText(
            ([login.name, login.notes ?? "", login.username]
                + login.uris.filter(isContextMatchable).map(\.uri))
                .joined(separator: " ")
        )
        let queryTokens = tokens(query)
        return !queryTokens.isEmpty && queryTokens.allSatisfy(searchable.contains)
    }

    private func hostOrDomainMatches(_ lhs: String, _ rhs: String) -> Bool {
        guard let leftHost = Self.host(lhs), let rightHost = Self.host(rhs) else { return false }
        if leftHost == rightHost { return true }
        guard let leftDomain = domainRules.registrableDomain(for: leftHost),
              let rightDomain = domainRules.registrableDomain(for: rightHost) else { return false }
        return leftDomain == rightDomain
    }

    private func browserTextSignal(
        for login: AutoFillLogin,
        context: NativeAutoFillContext
    ) -> Signal? {
        let brands = context.serviceIdentifiers.compactMap { service -> String? in
            guard let contextHost = Self.host(service),
                  let registrable = domainRules.registrableDomain(for: contextHost),
                  let brand = registrable.split(separator: ".").first.map(String.init),
                  Self.isMeaningfulBrowserBrand(brand) else { return nil }
            return brand
        }
        guard !brands.isEmpty else { return nil }

        let nameTokens = Set(Self.tokens(login.name))
        if brands.contains(where: nameTokens.contains) {
            return .browserName
        }
        if brands.contains(where: { brand in
            ApplicationNameSimilarity.compare(
                applicationName: brand,
                itemName: login.name
            )?.isHighConfidence == true
        }) {
            return .browserName
        }

        let descriptionTokens = Set(Self.tokens(login.notes ?? ""))
        if brands.contains(where: descriptionTokens.contains) {
            return .browserDescription
        }
        return nil
    }

    private static let genericBrowserBrands: Set<String> = [
        "account", "accounts", "admin", "app", "auth", "cloud", "home", "login",
        "online", "portal", "secure", "service", "services", "web", "www",
    ]

    private static func isMeaningfulBrowserBrand(_ value: String) -> Bool {
        value.count >= 4
            && !value.hasPrefix("xn--")
            && !genericBrowserBrands.contains(value)
    }

    private static func fuzzyMatches(login: AutoFillLogin, context: NativeAutoFillContext) -> Bool {
        let hints = meaningfulTokens(context.appName)
            + meaningfulTokens(context.bundleID)
            + context.serviceIdentifiers.compactMap(host).flatMap(meaningfulTokens)
        let loginValues = [login.name] + login.uris.filter(isContextMatchable).map(\.uri)
        let loginTokens = loginValues.flatMap(tokens)
        return hints.contains { hint in
            loginTokens.contains(hint)
        }
    }

    private static let genericApplicationTokens: Set<String> = [
        "app", "apps", "application", "client", "com", "desktop", "dmg", "io", "mac",
        "macos", "net", "official", "org", "osx",
    ]

    private static func meaningfulTokens(_ value: String) -> [String] {
        tokens(value).filter { token in
            token.count >= 3 && !genericApplicationTokens.contains(token)
        }
    }

    private static func tokens(_ value: String) -> [String] {
        normalizeText(value).split { !$0.isLetter && !$0.isNumber }.map(String.init)
    }

    private static func canonicalExactService(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let source = hasExplicitScheme(trimmed) ? trimmed : "https://\(trimmed)"
        guard let components = URLComponents(string: source),
              let scheme = components.scheme,
              let host = components.host,
              components.user == nil,
              components.password == nil else { return nil }
        let normalizedHost = normalizeHost(host)
        let serializedHost = normalizedHost.contains(":") ? "[\(normalizedHost)]" : normalizedHost
        var result = normalizeText(scheme) + "://" + serializedHost
        if let port = components.port { result += ":\(port)" }
        result += components.percentEncodedPath
        if let query = components.percentEncodedQuery { result += "?\(query)" }
        // URI fragments are client-side navigation state and never identify a service.
        return result
    }

    private static func host(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let source = hasExplicitScheme(trimmed) ? trimmed : "https://\(trimmed)"
        guard let parsed = URLComponents(string: source), let host = parsed.host else { return nil }
        return normalizeHost(host)
    }

    private static func hostRuleMatches(_ rule: String, _ service: String) -> Bool {
        guard let expected = hostIdentity(rule),
              let candidate = hostIdentity(service),
              expected.host == candidate.host else { return false }
        guard let requiredPort = expected.explicitPort else { return true }
        return candidate.effectivePort == requiredPort
    }

    private struct HostIdentity {
        let host: String
        let explicitPort: Int?
        let effectivePort: Int?
    }

    private static func hostIdentity(_ value: String) -> HostIdentity? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let source = hasExplicitScheme(trimmed) ? trimmed : "https://\(trimmed)"
        guard let parsed = URLComponents(string: source),
              let scheme = parsed.scheme,
              let host = parsed.host,
              parsed.user == nil,
              parsed.password == nil else { return nil }
        let explicitPort = parsed.port
        guard explicitPort.map({ (1...65_535).contains($0) }) ?? true else { return nil }
        return HostIdentity(
            host: normalizeHost(host),
            explicitPort: explicitPort,
            effectivePort: explicitPort ?? defaultPort(for: scheme)
        )
    }

    private static func defaultPort(for scheme: String) -> Int? {
        switch normalizeText(scheme) {
        case "http", "ws": 80
        case "https", "wss": 443
        case "ftp": 21
        default: nil
        }
    }

    private static func hasExplicitScheme(_ value: String) -> Bool {
        value.range(
            of: #"^[A-Za-z][A-Za-z0-9+.-]*://"#,
            options: .regularExpression
        ) != nil
    }

    private static func normalizeHost(_ value: String) -> String {
        let normalized = normalizeText(value).trimmingCharacters(
            in: CharacterSet(charactersIn: ".[]")
        )
        if let address = canonicalIPAddress(normalized) { return address }
        return URL(string: "https://\(normalized)")?.host.map(normalizeText) ?? normalized
    }

    private static func canonicalIPAddress(_ value: String) -> String? {
        var ipv6 = in6_addr()
        if inet_pton(AF_INET6, value, &ipv6) == 1 {
            var buffer = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))
            return withUnsafePointer(to: &ipv6) { address in
                buffer.withUnsafeMutableBufferPointer { output in
                    guard inet_ntop(
                        AF_INET6,
                        address,
                        output.baseAddress,
                        socklen_t(output.count)
                    ) != nil else { return nil }
                    return String(cString: output.baseAddress!)
                }
            }
        }
        var ipv4 = in_addr()
        if inet_pton(AF_INET, value, &ipv4) == 1 {
            var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            return withUnsafePointer(to: &ipv4) { address in
                buffer.withUnsafeMutableBufferPointer { output in
                    guard inet_ntop(
                        AF_INET,
                        address,
                        output.baseAddress,
                        socklen_t(output.count)
                    ) != nil else { return nil }
                    return String(cString: output.baseAddress!)
                }
            }
        }
        return nil
    }

    private static func normalizeText(_ value: String) -> String {
        value.precomposedStringWithCanonicalMapping
            .folding(options: [.caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    }

    private static func append(_ value: String, to digest: inout SHA256) {
        let data = Data(value.utf8)
        append(UInt64(data.count), to: &digest)
        digest.update(data: data)
    }

    private static func append(_ value: UInt64, to digest: inout SHA256) {
        var bigEndian = value.bigEndian
        withUnsafeBytes(of: &bigEndian) { digest.update(bufferPointer: $0) }
    }

}

final class RepromptGrantStore {
    private struct Grant {
        let accountID: String
        let cipherID: String
        let field: AutoFillSecretField
        let generation: UUID
        let contextToken: String
        let expiresAt: TimeInterval
    }

    private let clock: () -> TimeInterval
    private let lifetimeSeconds: TimeInterval
    private let maximumRecords: Int
    private let lock = NSLock()
    private var records: [String: Grant] = [:]

    init(
        clock: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 },
        lifetimeSeconds: TimeInterval = 30,
        maximumRecords: Int = 4_096
    ) {
        precondition(lifetimeSeconds > 0 && lifetimeSeconds <= 60)
        precondition(maximumRecords > 0)
        self.clock = clock
        self.lifetimeSeconds = lifetimeSeconds
        self.maximumRecords = maximumRecords
    }

    func issue(
        accountID: String,
        cipherID: String,
        field: AutoFillSecretField,
        generation: UUID,
        contextToken: String
    ) throws -> String {
        guard !accountID.isEmpty, !cipherID.isEmpty, !contextToken.isEmpty else {
            throw AgentProtocolError.malformedMessage
        }
        lock.lock()
        defer { lock.unlock() }
        let now = clock()
        records = records.filter { $0.value.expiresAt > now }
        guard records.count < maximumRecords else { throw AgentProtocolError.requestCapacity }
        var token = UUID().uuidString
        while records[token] != nil { token = UUID().uuidString }
        records[token] = Grant(
            accountID: accountID,
            cipherID: cipherID,
            field: field,
            generation: generation,
            contextToken: contextToken,
            expiresAt: now + lifetimeSeconds
        )
        return token
    }

    func consume(
        accountID: String,
        cipherID: String,
        field: AutoFillSecretField,
        generation: UUID,
        contextToken: String,
        grant: String
    ) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard let record = records.removeValue(forKey: grant) else { return false }
        return record.expiresAt > clock()
            && record.accountID == accountID
            && record.cipherID == cipherID
            && record.field == field
            && record.generation == generation
            && record.contextToken == contextToken
    }

    func clear() {
        lock.lock()
        records.removeAll(keepingCapacity: false)
        lock.unlock()
    }
}

final class CandidateAuthorizationStore {
    typealias RepromptGrantVerifier = (
        _ accountID: String,
        _ cipherID: String,
        _ field: AutoFillSecretField,
        _ generation: UUID,
        _ contextToken: String,
        _ grant: String
    ) -> Bool

    struct Snapshot {
        let vaultRevision: UInt64
        let context: NativeAutoFillContext
        let contextDigest: Data
        let policyDigest: Data
    }

    struct Authorization {
        let accountID: String
        let generation: UUID
        let field: AutoFillSecretField
        let snapshot: Snapshot
        let expiresAt: TimeInterval
        let candidates: [String: Candidate]
    }

    struct Candidate {
        let requiresMismatchConfirmation: Bool
        let requiresReprompt: Bool
    }

    private let clock: () -> TimeInterval
    private let lifetimeSeconds: TimeInterval
    private let maximumRecords: Int
    private let lock = NSLock()
    private var records: [String: Authorization] = [:]

    init(
        clock: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 },
        lifetimeSeconds: TimeInterval = 30,
        maximumRecords: Int = 4_096
    ) {
        precondition(lifetimeSeconds > 0 && lifetimeSeconds <= 60)
        precondition(maximumRecords > 0)
        self.clock = clock
        self.lifetimeSeconds = lifetimeSeconds
        self.maximumRecords = maximumRecords
    }

    func issue(
        accountID: String,
        generation: UUID,
        field: AutoFillSecretField,
        vaultRevision: UInt64,
        context: NativeAutoFillContext,
        contextDigest: Data,
        policyDigest: Data,
        candidates: [RankedCandidate],
        logins: [AutoFillLogin]
    ) throws -> CandidateResponsePayload {
        guard !accountID.isEmpty,
              vaultRevision > 0,
              contextDigest.count == SHA256.byteCount,
              policyDigest.count == SHA256.byteCount,
              candidates.count <= 500,
              Set(candidates.map(\.cipherID)).count == candidates.count,
              Set(logins.map(\.cipherID)).count == logins.count else {
            throw AgentProtocolError.malformedMessage
        }
        let loginsByID = Dictionary(uniqueKeysWithValues: logins.map { ($0.cipherID, $0) })
        let authorized: [String: Candidate] = Dictionary(uniqueKeysWithValues: candidates.compactMap { candidate in
            guard let login = loginsByID[candidate.cipherID] else { return nil }
            return (candidate.cipherID, Candidate(
                requiresMismatchConfirmation: candidate.requiresMismatchConfirmation,
                requiresReprompt: login.reprompt
            ))
        })
        guard authorized.count == candidates.count else { throw AgentProtocolError.unauthorized }

        lock.lock()
        defer { lock.unlock() }
        let now = clock()
        records = records.filter { $0.value.expiresAt > now }
        guard records.count < maximumRecords else { throw AgentProtocolError.requestCapacity }
        var token = UUID().uuidString
        while records[token] != nil { token = UUID().uuidString }
        records[token] = Authorization(
            accountID: accountID,
            generation: generation,
            field: field,
            snapshot: Snapshot(
                vaultRevision: vaultRevision,
                context: context,
                contextDigest: contextDigest,
                policyDigest: policyDigest
            ),
            expiresAt: now + lifetimeSeconds,
            candidates: authorized
        )
        return CandidateResponsePayload(contextToken: token, candidates: candidates)
    }

    func take(contextToken: String) -> Authorization? {
        lock.lock()
        defer { lock.unlock() }
        return records.removeValue(forKey: contextToken)
    }

    func validate(
        _ request: SecretReleasePayload,
        authorization: Authorization,
        currentVaultRevision: UInt64,
        currentContextDigest: Data,
        currentPolicyDigest: Data,
        verifyRepromptGrant: RepromptGrantVerifier
    ) throws {
        guard !request.accountID.isEmpty,
              !request.candidateID.isEmpty,
              !request.contextToken.isEmpty else {
            throw AgentProtocolError.malformedMessage
        }
        guard authorization.expiresAt > clock(),
              authorization.accountID == request.accountID,
              authorization.generation == request.generation,
              authorization.field == request.field,
              authorization.snapshot.vaultRevision == currentVaultRevision,
              authorization.snapshot.contextDigest == currentContextDigest,
              authorization.snapshot.policyDigest == currentPolicyDigest,
              let candidate = authorization.candidates[request.candidateID],
              !candidate.requiresMismatchConfirmation || request.mismatchConfirmed else {
            throw AgentProtocolError.unauthorized
        }
        if candidate.requiresReprompt {
            guard request.reprompt.result == .grant,
                  let grant = request.reprompt.grant,
                  !grant.isEmpty,
                  verifyRepromptGrant(
                    request.accountID,
                    request.candidateID,
                    request.field,
                    request.generation,
                    request.contextToken,
                    grant
                  ) else {
                throw AgentProtocolError.unauthorized
            }
        } else {
            guard request.reprompt.result == .notRequired,
                  request.reprompt.grant == nil else {
                throw AgentProtocolError.unauthorized
            }
        }
    }

    func clear() {
        lock.lock()
        records.removeAll(keepingCapacity: false)
        lock.unlock()
    }
}
