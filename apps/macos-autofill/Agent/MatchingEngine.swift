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
        guard let url = bundle.url(forResource: "AppPresets", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let presets = try? decode(data) else { return [] }
        return presets
    }
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
    let lastSelectedAt: String
}

struct MatchingEngine {
    let presets: [AppPreset]

    private enum Signal: Int {
        case binding = 0
        case serviceIdentifier = 1
        case preset = 2
        case uriRule = 3
        case domain = 4
        case fuzzy = 5
        case history = 6
        case favorite = 7
        case recent = 8
        case other = 9

        var group: CandidateGroup {
            switch self {
            case .binding, .serviceIdentifier, .preset, .uriRule: .exact
            case .domain: .relevant
            default: .other
            }
        }

        var reason: String {
            switch self {
            case .binding: "user_binding"
            case .serviceIdentifier: "service_identifier"
            case .preset: "app_preset"
            case .uriRule: "vault_uri_rule"
            case .domain: "host_or_domain"
            case .fuzzy: "fuzzy_name"
            case .history: "selection_history"
            case .favorite: "favorite"
            case .recent: "recent"
            case .other: "other"
            }
        }
    }

    private struct ScoredCandidate {
        let login: AutoFillLogin
        let signal: Signal
        let historyCount: UInt
        let historyDate: String
    }

    func rank(
        accountID: String,
        logins: [AutoFillLogin],
        context: NativeAutoFillContext,
        bindings: [UserAppBinding],
        history: [MatchingHistoryEntry]
    ) -> [RankedCandidate] {
        let normalizedBundleID = Self.normalizeText(context.bundleID)
        let scopedBindings = bindings.filter {
            $0.accountID == accountID && Self.normalizeText($0.bundleID) == normalizedBundleID
        }
        let presetServices = presets
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
                signal: signal(
                    for: login,
                    context: context,
                    bindings: scopedBindings,
                    presetServices: presetServices,
                    hasHistory: matchingHistory != nil
                ),
                historyCount: matchingHistory?.successfulSelectionCount ?? 0,
                historyDate: matchingHistory?.lastSelectedAt ?? ""
            )
        }.sorted { lhs, rhs in
            if lhs.signal.rawValue != rhs.signal.rawValue {
                return lhs.signal.rawValue < rhs.signal.rawValue
            }
            if lhs.historyCount != rhs.historyCount { return lhs.historyCount > rhs.historyCount }
            if lhs.historyDate != rhs.historyDate { return lhs.historyDate > rhs.historyDate }
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
                group: $0.signal.group,
                reason: $0.signal.reason,
                requiresMismatchConfirmation: $0.signal.rawValue >= Signal.fuzzy.rawValue
            )
        }
    }

    private func signal(
        for login: AutoFillLogin,
        context: NativeAutoFillContext,
        bindings: [UserAppBinding],
        presetServices: [String],
        hasHistory: Bool
    ) -> Signal {
        if bindings.contains(where: { $0.cipherID == login.cipherID }) { return .binding }
        if login.uris.contains(where: { uri in
            guard Self.isContextMatchable(uri) else { return false }
            return context.serviceIdentifiers.contains { Self.servicesAreExactlyEqual($0, uri.uri) }
        }) { return .serviceIdentifier }
        if login.uris.contains(where: { uri in
            guard Self.isContextMatchable(uri) else { return false }
            return presetServices.contains { Self.hostOrServiceMatches($0, uri.uri) }
        }) { return .preset }
        if login.uris.contains(where: { uri in
            guard Self.isContextMatchable(uri) else { return false }
            return context.serviceIdentifiers.contains { Self.uriRuleMatches(uri, service: $0) }
        }) { return .uriRule }
        if login.uris.contains(where: { uri in
            guard Self.isContextMatchable(uri) else { return false }
            return context.serviceIdentifiers.contains { Self.hostOrDomainMatches($0, uri.uri) }
        }) { return .domain }
        if Self.fuzzyMatches(login: login, context: context) { return .fuzzy }
        if hasHistory { return .history }
        if login.favorite { return .favorite }
        if let lastUsedAt = login.lastUsedAt, !lastUsedAt.isEmpty { return .recent }
        return .other
    }

    static func contextKey(_ context: NativeAutoFillContext) -> String {
        let bundle = normalizeText(context.bundleID)
        if !bundle.isEmpty { return "app:\(bundle)" }
        if let firstHost = context.serviceIdentifiers.compactMap(host).sorted().first {
            return "service:\(firstHost)"
        }
        return "unknown"
    }

    private static func servicesAreExactlyEqual(_ lhs: String, _ rhs: String) -> Bool {
        canonicalService(lhs) == canonicalService(rhs)
    }

    private static func hostOrServiceMatches(_ lhs: String, _ rhs: String) -> Bool {
        servicesAreExactlyEqual(lhs, rhs) || host(lhs) == host(rhs)
    }

    private static func uriRuleMatches(_ rule: AutoFillURI, service: String) -> Bool {
        let candidate = canonicalService(service)
        let expected = canonicalService(rule.uri)
        switch normalizeText(rule.matchType) {
        case "exact": return candidate == expected
        case "startswith", "starts_with": return candidate.hasPrefix(expected)
        case "host": return host(rule.uri) == host(service)
        case "basedomain", "base_domain":
            guard let left = host(rule.uri).flatMap(registrableDomain),
                  let right = host(service).flatMap(registrableDomain) else { return false }
            return left == right
        case "never": return false
        default: return false
        }
    }

    private static func isContextMatchable(_ uri: AutoFillURI) -> Bool {
        normalizeText(uri.matchType) != "never"
    }

    private static func queryMatches(_ query: String, login: AutoFillLogin) -> Bool {
        let searchable = normalizeText(
            ([login.name, login.username] + login.uris.map(\.uri)).joined(separator: " ")
        )
        let queryTokens = tokens(query)
        return !queryTokens.isEmpty && queryTokens.allSatisfy(searchable.contains)
    }

    private static func hostOrDomainMatches(_ lhs: String, _ rhs: String) -> Bool {
        guard let leftHost = host(lhs), let rightHost = host(rhs) else { return false }
        if leftHost == rightHost { return true }
        guard let leftDomain = registrableDomain(leftHost),
              let rightDomain = registrableDomain(rightHost) else { return false }
        return leftDomain == rightDomain
    }

    private static func fuzzyMatches(login: AutoFillLogin, context: NativeAutoFillContext) -> Bool {
        let hints = [context.appName, context.bundleID]
            + context.serviceIdentifiers.compactMap(host)
        let loginValues = [login.name] + login.uris.map(\.uri)
        return hints.flatMap(tokens).contains { hint in
            hint.count >= 3 && loginValues.flatMap(tokens).contains(hint)
        }
    }

    private static func tokens(_ value: String) -> [String] {
        normalizeText(value).split { !$0.isLetter && !$0.isNumber }.map(String.init)
    }

    private static func canonicalService(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if let components = URLComponents(string: trimmed), let host = components.host {
            var result = normalizeText(components.scheme ?? "https") + "://" + normalizeHost(host)
            if let port = components.port { result += ":\(port)" }
            let path = components.percentEncodedPath == "/" ? "" : components.percentEncodedPath
            result += path
            if let query = components.percentEncodedQuery { result += "?\(query)" }
            return result
        }
        return normalizeHost(trimmed.trimmingCharacters(in: CharacterSet(charactersIn: ".")))
    }

    private static func host(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if let parsed = URL(string: trimmed), let host = parsed.host { return normalizeHost(host) }
        if let parsed = URL(string: "https://\(trimmed)"), let host = parsed.host {
            return normalizeHost(host)
        }
        return nil
    }

    private static func normalizeHost(_ value: String) -> String {
        let normalized = normalizeText(value).trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return URL(string: "https://\(normalized)")?.host.map(normalizeText) ?? normalized
    }

    private static func normalizeText(_ value: String) -> String {
        value.precomposedStringWithCanonicalMapping
            .folding(options: [.caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    }

    private static func registrableDomain(_ host: String) -> String? {
        let labels = host.split(separator: ".").map(String.init)
        guard labels.count >= 2 else { return nil }
        let suffix2 = labels.suffix(2).joined(separator: ".")
        // Deliberately conservative, reviewable PSL subset. Unknown suffixes fail closed.
        let knownSingleLabelSuffixes: Set<String> = [
            "app", "au", "br", "ca", "cn", "com", "de", "dev", "edu", "example", "fr",
            "gov", "io", "jp", "me", "mil", "net", "nz", "org", "uk", "us",
        ]
        let knownTwoLabelSuffixes: Set<String> = [
            "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.jp", "co.nz", "com.br", "com.cn",
        ]
        if knownTwoLabelSuffixes.contains(suffix2) {
            guard labels.count >= 3 else { return nil }
            return labels.suffix(3).joined(separator: ".")
        }
        guard let suffix = labels.last, knownSingleLabelSuffixes.contains(suffix) else { return nil }
        return suffix2
    }
}

final class CandidateAuthorizationStore {
    typealias RepromptGrantVerifier = (
        _ accountID: String,
        _ cipherID: String,
        _ field: AutoFillSecretField,
        _ generation: UUID,
        _ grant: String
    ) -> Bool

    private struct Authorization {
        let accountID: String
        let generation: UUID
        let expiresAt: TimeInterval
        let candidates: [String: Candidate]
    }

    private struct Candidate {
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
        candidates: [RankedCandidate],
        logins: [AutoFillLogin]
    ) throws -> CandidateResponsePayload {
        guard !accountID.isEmpty,
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
            expiresAt: now + lifetimeSeconds,
            candidates: authorized
        )
        return CandidateResponsePayload(contextToken: token, candidates: candidates)
    }

    func validate(
        _ request: SecretReleasePayload,
        verifyRepromptGrant: RepromptGrantVerifier
    ) throws {
        guard !request.accountID.isEmpty,
              !request.candidateID.isEmpty,
              !request.contextToken.isEmpty else {
            throw AgentProtocolError.malformedMessage
        }
        lock.lock()
        let authorization = records.removeValue(forKey: request.contextToken)
        lock.unlock()
        guard let authorization,
              authorization.expiresAt > clock(),
              authorization.accountID == request.accountID,
              authorization.generation == request.generation,
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
