import Foundation

enum AgentProtocol {
    static let currentVersion: UInt16 = 1
}

enum AgentOperation: String, Codable, Equatable {
    case probe
    case status
    case lock
    case provision
    case renewLease = "renew_lease"
    case queryCandidates = "query_candidates"
    case releaseSecret = "release_secret"
    case issueRepromptGrant = "issue_reprompt_grant"
}

enum CandidateGroup: String, Codable, Equatable {
    case exact
    case relevant
    case other
}

enum PublishedCredentialServiceKind: String, Codable, Equatable {
    case URL
    case domain
}

struct PublishedCredentialService: Codable, Equatable, Hashable {
    let identifier: String
    let kind: PublishedCredentialServiceKind
}

enum PublishedCredentialServiceCanonicalizer {
    static func canonical(
        identifier rawValue: String,
        kind: PublishedCredentialServiceKind
    ) -> PublishedCredentialService? {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 2_048 else { return nil }
        switch kind {
        case .URL:
            guard var components = URLComponents(string: value),
                  let scheme = components.scheme?.lowercased(),
                  (scheme == "http" || scheme == "https"),
                  let host = components.host?.lowercased(),
                  !host.isEmpty else { return nil }
            components.scheme = scheme
            components.host = host
            components.fragment = nil
            guard let canonical = components.url?.absoluteString else { return nil }
            return PublishedCredentialService(identifier: canonical, kind: .URL)
        case .domain:
            let domain = value.precomposedStringWithCanonicalMapping
                .lowercased(with: Locale(identifier: "en_US_POSIX"))
                .trimmingCharacters(in: CharacterSet(charactersIn: "."))
            guard !domain.isEmpty,
                  domain.count <= 255,
                  !domain.contains("/"),
                  !domain.contains("?"),
                  !domain.contains(":"),
                  domain.split(separator: ".").allSatisfy({ !$0.isEmpty }) else { return nil }
            return PublishedCredentialService(identifier: domain, kind: .domain)
        }
    }

    static func canonicalVaultService(_ rawValue: String) -> PublishedCredentialService? {
        canonical(identifier: rawValue, kind: .URL)
            ?? canonical(identifier: rawValue, kind: .domain)
    }
}

struct NativeAutoFillContext: Codable, Equatable {
    let bundleID: String
    let appName: String
    let serviceIdentifiers: [String]
    let query: String

    private enum CodingKeys: String, CodingKey {
        case bundleID = "bundle_id"
        case appName = "app_name"
        case serviceIdentifiers = "service_identifiers"
        case query
    }
}

struct RankedCandidate: Codable, Equatable {
    let cipherID: String
    let displayName: String
    let username: String
    let group: CandidateGroup
    let reason: String
    let requiresMismatchConfirmation: Bool

    private enum CodingKeys: String, CodingKey {
        case cipherID = "cipher_id"
        case displayName = "display_name"
        case username
        case group
        case reason
        case requiresMismatchConfirmation = "requires_mismatch_confirmation"
    }
}

struct CandidateQueryPayload: Codable, Equatable {
    let generation: UUID
    let accountID: String
    let field: AutoFillSecretField
    let context: NativeAutoFillContext

    private enum CodingKeys: String, CodingKey {
        case generation
        case accountID = "account_id"
        case field
        case context
    }
}

struct CandidateResponsePayload: Codable, Equatable {
    let contextToken: String
    let candidates: [RankedCandidate]

    private enum CodingKeys: String, CodingKey {
        case contextToken = "context_token"
        case candidates
    }
}

struct AgentSessionPayload: Codable, Equatable {
    let generation: UUID
    let accountID: String
    let vaultRevision: UInt64

    private enum CodingKeys: String, CodingKey {
        case generation
        case accountID = "account_id"
        case vaultRevision = "vault_revision"
    }
}

enum AutoFillSecretField: String, Codable, Equatable {
    case username
    case password
    case totp
}

enum RepromptResult: String, Codable, Equatable {
    case notRequired = "not_required"
    case grant
}

struct RepromptResultPayload: Codable, Equatable {
    let result: RepromptResult
    let grant: String?
}

struct SecretReleasePayload: Codable, Equatable {
    let generation: UUID
    let accountID: String
    let candidateID: String
    let field: AutoFillSecretField
    let contextToken: String
    let mismatchConfirmed: Bool
    let reprompt: RepromptResultPayload
    let publishedService: PublishedCredentialService?

    private enum CodingKeys: String, CodingKey {
        case generation
        case accountID = "account_id"
        case candidateID = "candidate_id"
        case field
        case contextToken = "context_token"
        case mismatchConfirmed = "mismatch_confirmed"
        case reprompt
        case publishedService = "published_service"
    }

    init(
        generation: UUID,
        accountID: String,
        candidateID: String,
        field: AutoFillSecretField,
        contextToken: String,
        mismatchConfirmed: Bool,
        reprompt: RepromptResultPayload,
        publishedService: PublishedCredentialService? = nil
    ) {
        self.generation = generation
        self.accountID = accountID
        self.candidateID = candidateID
        self.field = field
        self.contextToken = contextToken
        self.mismatchConfirmed = mismatchConfirmed
        self.reprompt = reprompt
        self.publishedService = publishedService
    }
}

struct RepromptGrantIssuePayload: Codable, Equatable {
    let generation: UUID
    let accountID: String
    let candidateID: String
    let field: AutoFillSecretField
    let contextToken: String

    private enum CodingKeys: String, CodingKey {
        case generation
        case accountID = "account_id"
        case candidateID = "candidate_id"
        case field
        case contextToken = "context_token"
    }
}

struct RepromptGrantPayload: Codable, Equatable {
    let grant: String
}

final class ReleasedSecret: Codable, Equatable {
    let field: AutoFillSecretField
    private(set) var value: Data
    private(set) var isCleared = false

    init(field: AutoFillSecretField, value: Data) {
        self.field = field
        self.value = value
    }

    deinit { clear() }

    func clear() {
        guard !isCleared else { return }
        value.resetBytes(in: value.indices)
        isCleared = true
    }

    func string() throws -> String {
        guard !isCleared, let string = String(data: value, encoding: .utf8) else {
            throw AgentProtocolError.malformedMessage
        }
        return string
    }

    static func == (lhs: ReleasedSecret, rhs: ReleasedSecret) -> Bool {
        lhs.field == rhs.field && lhs.value == rhs.value && lhs.isCleared == rhs.isCleared
    }
}

final class ProjectionProvisionPayload: Codable, Equatable {
    let generation: UUID
    let accountID: String
    let vaultRevision: UInt64
    private(set) var key: Data
    let leaseDurationSeconds: TimeInterval
    let projectionPath: String?

    private enum CodingKeys: String, CodingKey {
        case generation
        case accountID = "account_id"
        case vaultRevision = "vault_revision"
        case key
        case leaseDurationSeconds = "lease_duration_seconds"
        case projectionPath = "projection_path"
    }

    init(
        generation: UUID,
        accountID: String,
        vaultRevision: UInt64,
        key: Data,
        leaseDurationSeconds: TimeInterval,
        projectionPath: String? = nil
    ) {
        self.generation = generation
        self.accountID = accountID
        self.vaultRevision = vaultRevision
        self.key = key
        self.leaseDurationSeconds = leaseDurationSeconds
        self.projectionPath = projectionPath
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        generation = try container.decode(UUID.self, forKey: .generation)
        accountID = try container.decode(String.self, forKey: .accountID)
        vaultRevision = try container.decode(UInt64.self, forKey: .vaultRevision)
        leaseDurationSeconds = try container.decode(TimeInterval.self, forKey: .leaseDurationSeconds)
        projectionPath = try container.decodeIfPresent(String.self, forKey: .projectionPath)
        key = try container.decode(Data.self, forKey: .key)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(generation, forKey: .generation)
        try container.encode(accountID, forKey: .accountID)
        try container.encode(vaultRevision, forKey: .vaultRevision)
        try container.encode(key, forKey: .key)
        try container.encode(leaseDurationSeconds, forKey: .leaseDurationSeconds)
        try container.encodeIfPresent(projectionPath, forKey: .projectionPath)
    }

    deinit {
        clearKey()
    }

    func clearKey() {
        key.resetBytes(in: key.startIndex..<key.endIndex)
    }

    static func == (lhs: ProjectionProvisionPayload, rhs: ProjectionProvisionPayload) -> Bool {
        lhs.generation == rhs.generation &&
            lhs.accountID == rhs.accountID &&
            lhs.vaultRevision == rhs.vaultRevision &&
            lhs.key == rhs.key &&
            lhs.leaseDurationSeconds == rhs.leaseDurationSeconds &&
            lhs.projectionPath == rhs.projectionPath
    }
}

struct ProjectionLeasePayload: Codable, Equatable {
    let generation: UUID
    let accountID: String
    let leaseDurationSeconds: TimeInterval

    private enum CodingKeys: String, CodingKey {
        case generation
        case accountID = "account_id"
        case leaseDurationSeconds = "lease_duration_seconds"
    }
}

struct AgentRequest: Codable, Equatable {
    let version: UInt16
    let requestID: UUID
    let operation: AgentOperation
    let nonce: Data
    let projection: ProjectionProvisionPayload?
    let lease: ProjectionLeasePayload?
    let candidateQuery: CandidateQueryPayload?
    let secretRelease: SecretReleasePayload?
    let repromptGrantIssue: RepromptGrantIssuePayload?

    private enum CodingKeys: String, CodingKey {
        case version
        case requestID = "request_id"
        case operation
        case nonce
        case projection
        case lease
        case candidateQuery = "candidate_query"
        case secretRelease = "secret_release"
        case repromptGrantIssue = "reprompt_grant_issue"
    }

    init(
        version: UInt16,
        requestID: UUID,
        operation: AgentOperation,
        nonce: Data,
        projection: ProjectionProvisionPayload? = nil,
        lease: ProjectionLeasePayload? = nil,
        candidateQuery: CandidateQueryPayload? = nil,
        secretRelease: SecretReleasePayload? = nil,
        repromptGrantIssue: RepromptGrantIssuePayload? = nil
    ) {
        self.version = version
        self.requestID = requestID
        self.operation = operation
        self.nonce = nonce
        self.projection = projection
        self.lease = lease
        self.candidateQuery = candidateQuery
        self.secretRelease = secretRelease
        self.repromptGrantIssue = repromptGrantIssue
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(UInt16.self, forKey: .version)
        requestID = try container.decode(UUID.self, forKey: .requestID)
        operation = try container.decode(AgentOperation.self, forKey: .operation)
        nonce = Data(try container.decode([UInt8].self, forKey: .nonce))
        projection = try container.decodeIfPresent(ProjectionProvisionPayload.self, forKey: .projection)
        lease = try container.decodeIfPresent(ProjectionLeasePayload.self, forKey: .lease)
        candidateQuery = try container.decodeIfPresent(CandidateQueryPayload.self, forKey: .candidateQuery)
        secretRelease = try container.decodeIfPresent(SecretReleasePayload.self, forKey: .secretRelease)
        repromptGrantIssue = try container.decodeIfPresent(RepromptGrantIssuePayload.self, forKey: .repromptGrantIssue)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(requestID, forKey: .requestID)
        try container.encode(operation, forKey: .operation)
        try container.encode(Array(nonce), forKey: .nonce)
        try container.encodeIfPresent(projection, forKey: .projection)
        try container.encodeIfPresent(lease, forKey: .lease)
        try container.encodeIfPresent(candidateQuery, forKey: .candidateQuery)
        try container.encodeIfPresent(secretRelease, forKey: .secretRelease)
        try container.encodeIfPresent(repromptGrantIssue, forKey: .repromptGrantIssue)
    }
}

struct AgentResponse: Codable, Equatable {
    let version: UInt16
    let requestID: UUID?
    let nonce: Data
    let status: AgentResponseStatus
    let error: AgentProtocolError?
    let candidateResponse: CandidateResponsePayload?
    let session: AgentSessionPayload?
    let secretResponse: ReleasedSecret?
    let repromptGrant: RepromptGrantPayload?

    private enum CodingKeys: String, CodingKey {
        case version
        case requestID = "request_id"
        case nonce
        case status
        case error
        case candidateResponse = "candidate_response"
        case session
        case secretResponse = "secret_response"
        case repromptGrant = "reprompt_grant"
    }

    static func success(requestID: UUID, nonce: Data) -> AgentResponse {
        AgentResponse(
            version: AgentProtocol.currentVersion,
            requestID: requestID,
            nonce: nonce,
            status: .ok,
            error: nil,
            candidateResponse: nil,
            session: nil,
            secretResponse: nil,
            repromptGrant: nil
        )
    }

    static func candidates(
        requestID: UUID,
        nonce: Data,
        payload: CandidateResponsePayload
    ) -> AgentResponse {
        AgentResponse(
            version: AgentProtocol.currentVersion,
            requestID: requestID,
            nonce: nonce,
            status: .ok,
            error: nil,
            candidateResponse: payload,
            session: nil,
            secretResponse: nil,
            repromptGrant: nil
        )
    }

    static func session(
        requestID: UUID,
        nonce: Data,
        payload: AgentSessionPayload
    ) -> AgentResponse {
        AgentResponse(
            version: AgentProtocol.currentVersion,
            requestID: requestID,
            nonce: nonce,
            status: .ok,
            error: nil,
            candidateResponse: nil,
            session: payload,
            secretResponse: nil,
            repromptGrant: nil
        )
    }

    static func secret(
        requestID: UUID,
        nonce: Data,
        payload: ReleasedSecret
    ) -> AgentResponse {
        AgentResponse(
            version: AgentProtocol.currentVersion,
            requestID: requestID,
            nonce: nonce,
            status: .ok,
            error: nil,
            candidateResponse: nil,
            session: nil,
            secretResponse: payload,
            repromptGrant: nil
        )
    }

    static func repromptGrant(
        requestID: UUID,
        nonce: Data,
        payload: RepromptGrantPayload
    ) -> AgentResponse {
        AgentResponse(
            version: AgentProtocol.currentVersion,
            requestID: requestID,
            nonce: nonce,
            status: .ok,
            error: nil,
            candidateResponse: nil,
            session: nil,
            secretResponse: nil,
            repromptGrant: payload
        )
    }

    static func failure(_ error: AgentProtocolError) -> AgentResponse {
        AgentResponse(
            version: AgentProtocol.currentVersion,
            requestID: nil,
            nonce: Data(),
            status: .error,
            error: error,
            candidateResponse: nil,
            session: nil,
            secretResponse: nil,
            repromptGrant: nil
        )
    }

    init(
        version: UInt16,
        requestID: UUID?,
        nonce: Data,
        status: AgentResponseStatus,
        error: AgentProtocolError?,
        candidateResponse: CandidateResponsePayload? = nil,
        session: AgentSessionPayload? = nil,
        secretResponse: ReleasedSecret? = nil,
        repromptGrant: RepromptGrantPayload? = nil
    ) {
        self.version = version
        self.requestID = requestID
        self.nonce = nonce
        self.status = status
        self.error = error
        self.candidateResponse = candidateResponse
        self.session = session
        self.secretResponse = secretResponse
        self.repromptGrant = repromptGrant
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(UInt16.self, forKey: .version)
        requestID = try container.decodeIfPresent(UUID.self, forKey: .requestID)
        nonce = Data(try container.decode([UInt8].self, forKey: .nonce))
        status = try container.decode(AgentResponseStatus.self, forKey: .status)
        error = try container.decodeIfPresent(AgentProtocolError.self, forKey: .error)
        candidateResponse = try container.decodeIfPresent(CandidateResponsePayload.self, forKey: .candidateResponse)
        session = try container.decodeIfPresent(AgentSessionPayload.self, forKey: .session)
        secretResponse = try container.decodeIfPresent(ReleasedSecret.self, forKey: .secretResponse)
        repromptGrant = try container.decodeIfPresent(RepromptGrantPayload.self, forKey: .repromptGrant)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(requestID, forKey: .requestID)
        try container.encode(Array(nonce), forKey: .nonce)
        try container.encode(status, forKey: .status)
        try container.encodeIfPresent(error, forKey: .error)
        try container.encodeIfPresent(candidateResponse, forKey: .candidateResponse)
        try container.encodeIfPresent(session, forKey: .session)
        try container.encodeIfPresent(secretResponse, forKey: .secretResponse)
        try container.encodeIfPresent(repromptGrant, forKey: .repromptGrant)
    }
}

enum AgentResponseStatus: String, Codable, Equatable {
    case ok
    case error
}

enum AgentProtocolError: String, Codable, Error, Equatable {
    case malformedMessage = "malformed_request"
    case messageTooLarge = "message_too_large"
    case unauthorized
    case unsupportedVersion = "protocol_version"
    case replayedRequest = "replay"
    case requestCapacity = "request_capacity"
    case timeout
    case unavailable
    case transport
    case corruptProjection = "corrupt_projection"
    case staleRevision = "stale_revision"
    case accountMismatch = "account_mismatch"
    case locked
}
