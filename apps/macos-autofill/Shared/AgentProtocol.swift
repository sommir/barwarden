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
}

enum CandidateGroup: String, Codable, Equatable {
    case exact
    case relevant
    case other
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
    let context: NativeAutoFillContext

    private enum CodingKeys: String, CodingKey {
        case generation
        case accountID = "account_id"
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

    private enum CodingKeys: String, CodingKey {
        case generation
        case accountID = "account_id"
        case candidateID = "candidate_id"
        case field
        case contextToken = "context_token"
        case mismatchConfirmed = "mismatch_confirmed"
        case reprompt
    }
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

    private enum CodingKeys: String, CodingKey {
        case version
        case requestID = "request_id"
        case operation
        case nonce
        case projection
        case lease
        case candidateQuery = "candidate_query"
        case secretRelease = "secret_release"
    }

    init(
        version: UInt16,
        requestID: UUID,
        operation: AgentOperation,
        nonce: Data,
        projection: ProjectionProvisionPayload? = nil,
        lease: ProjectionLeasePayload? = nil,
        candidateQuery: CandidateQueryPayload? = nil,
        secretRelease: SecretReleasePayload? = nil
    ) {
        self.version = version
        self.requestID = requestID
        self.operation = operation
        self.nonce = nonce
        self.projection = projection
        self.lease = lease
        self.candidateQuery = candidateQuery
        self.secretRelease = secretRelease
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

    private enum CodingKeys: String, CodingKey {
        case version
        case requestID = "request_id"
        case nonce
        case status
        case error
        case candidateResponse = "candidate_response"
        case session
        case secretResponse = "secret_response"
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
            secretResponse: nil
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
            secretResponse: nil
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
            secretResponse: nil
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
            secretResponse: payload
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
            secretResponse: nil
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
        secretResponse: ReleasedSecret? = nil
    ) {
        self.version = version
        self.requestID = requestID
        self.nonce = nonce
        self.status = status
        self.error = error
        self.candidateResponse = candidateResponse
        self.session = session
        self.secretResponse = secretResponse
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
