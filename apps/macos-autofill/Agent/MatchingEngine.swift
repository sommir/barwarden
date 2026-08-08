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
        guard let url = bundle.url(forResource: "AppPresets", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let presets = try? decode(data) else { return [] }
        return presets
    }
}

struct DomainMatchRules: Equatable {
    static let reviewedSourceRevision = "e1b8015c3b2f0f4f8c18659c2480fc1a22c07b20"
    static let sourceLicense = "MPL-2.0"

    let allowedRegistrableDomains: Set<String>
    let privateSuffixes: Set<String>

    private struct Document: Codable {
        let sourceRevision: String
        let license: String
        let allowedRegistrableDomains: [String]
        let privateSuffixes: [String]
    }

    static let empty = DomainMatchRules(allowedRegistrableDomains: [], privateSuffixes: [])

    init(allowedRegistrableDomains: [String], privateSuffixes: [String]) {
        self.allowedRegistrableDomains = Set(allowedRegistrableDomains.map(Self.normalizeRule))
        self.privateSuffixes = Set(privateSuffixes.map(Self.normalizeRule))
    }

    static func decode(_ data: Data) throws -> DomainMatchRules {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == [
                "sourceRevision", "license", "allowedRegistrableDomains", "privateSuffixes",
              ] else {
            throw AgentProtocolError.malformedMessage
        }
        let document = try JSONDecoder().decode(Document.self, from: data)
        guard document.sourceRevision == reviewedSourceRevision,
              document.license == sourceLicense,
              !document.allowedRegistrableDomains.isEmpty,
              !document.privateSuffixes.isEmpty,
              document.allowedRegistrableDomains.count <= 128,
              document.privateSuffixes.count <= 128,
              document.allowedRegistrableDomains.allSatisfy(Self.isValidRule),
              document.privateSuffixes.allSatisfy(Self.isValidRule) else {
            throw AgentProtocolError.malformedMessage
        }
        return DomainMatchRules(
            allowedRegistrableDomains: document.allowedRegistrableDomains,
            privateSuffixes: document.privateSuffixes
        )
    }

    static func bundled(in bundle: Bundle = .main) -> DomainMatchRules {
        guard let url = bundle.url(forResource: "DomainMatchRules", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let rules = try? decode(data) else { return .empty }
        return rules
    }

    func registrableDomain(for host: String) -> String? {
        let normalized = Self.normalizeRule(host)
        let matchingPrivate = privateSuffixes
            .filter { normalized == $0 || normalized.hasSuffix(".\($0)") }
            .max { $0.count < $1.count }
        if let suffix = matchingPrivate {
            let labels = normalized.split(separator: ".")
            let suffixLabels = suffix.split(separator: ".").count
            guard labels.count > suffixLabels else { return nil }
            return labels.suffix(suffixLabels + 1).joined(separator: ".")
        }
        return allowedRegistrableDomains
            .filter { normalized == $0 || normalized.hasSuffix(".\($0)") }
            .max { $0.count < $1.count }
    }

    private static func normalizeRule(_ value: String) -> String {
        value.trimmingCharacters(in: CharacterSet(charactersIn: ". "))
            .lowercased(with: Locale(identifier: "en_US_POSIX"))
    }

    private static func isValidRule(_ value: String) -> Bool {
        let normalized = normalizeRule(value)
        return !normalized.isEmpty
            && normalized.count <= 255
            && normalized.split(separator: ".").count >= 2
            && normalized.unicodeScalars.allSatisfy {
                CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-.")
                    .contains($0)
            }
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
                historyDate: matchingHistory?.lastSelectedAt ?? 0,
                recentDate: max(login.lastUsedAt ?? 0, 0)
            )
        }.sorted { lhs, rhs in
            if lhs.signal.rawValue != rhs.signal.rawValue {
                return lhs.signal.rawValue < rhs.signal.rawValue
            }
            if lhs.historyCount != rhs.historyCount { return lhs.historyCount > rhs.historyCount }
            if lhs.historyDate != rhs.historyDate { return lhs.historyDate > rhs.historyDate }
            if lhs.signal == .recent, lhs.recentDate != rhs.recentDate {
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
            guard uri.matchType == .host
                    || uri.matchType == .startsWith
                    || uri.matchType == .exact else { return false }
            return context.serviceIdentifiers.contains { uriRuleMatches(uri, service: $0) }
        }) { return .uriRule }
        if login.uris.contains(where: { uri in
            guard uri.matchType == .domain else { return false }
            return context.serviceIdentifiers.contains { hostOrDomainMatches($0, uri.uri) }
        }) { return .domain }
        if Self.fuzzyMatches(login: login, context: context) { return .fuzzy }
        if hasHistory { return .history }
        if login.favorite { return .favorite }
        if let lastUsedAt = login.lastUsedAt, lastUsedAt > 0 { return .recent }
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
        Self.append(UInt64(domainRules.allowedRegistrableDomains.count), to: &digest)
        domainRules.allowedRegistrableDomains.sorted().forEach { Self.append($0, to: &digest) }
        Self.append(UInt64(domainRules.privateSuffixes.count), to: &digest)
        domainRules.privateSuffixes.sorted().forEach { Self.append($0, to: &digest) }
        Self.append(UInt64(projection.logins.count), to: &digest)
        for login in projection.logins.sorted(by: { $0.cipherID < $1.cipherID }) {
            Self.append(login.cipherID, to: &digest)
            Self.append(login.name, to: &digest)
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
            ([login.name, login.username] + login.uris.filter(isContextMatchable).map(\.uri))
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

    private static func fuzzyMatches(login: AutoFillLogin, context: NativeAutoFillContext) -> Bool {
        let hints = [context.appName, context.bundleID]
            + context.serviceIdentifiers.compactMap(host)
        let loginValues = [login.name] + login.uris.filter(isContextMatchable).map(\.uri)
        return hints.flatMap(tokens).contains { hint in
            hint.count >= 3 && loginValues.flatMap(tokens).contains(hint)
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

final class CandidateAuthorizationStore {
    typealias RepromptGrantVerifier = (
        _ accountID: String,
        _ cipherID: String,
        _ field: AutoFillSecretField,
        _ generation: UUID,
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
