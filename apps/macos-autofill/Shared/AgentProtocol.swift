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
        key = Data(try container.decode([UInt8].self, forKey: .key))
        leaseDurationSeconds = try container.decode(TimeInterval.self, forKey: .leaseDurationSeconds)
        projectionPath = try container.decodeIfPresent(String.self, forKey: .projectionPath)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(generation, forKey: .generation)
        try container.encode(accountID, forKey: .accountID)
        try container.encode(vaultRevision, forKey: .vaultRevision)
        try container.encode(Array(key), forKey: .key)
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

    private enum CodingKeys: String, CodingKey {
        case version
        case requestID = "request_id"
        case operation
        case nonce
        case projection
        case lease
    }

    init(
        version: UInt16,
        requestID: UUID,
        operation: AgentOperation,
        nonce: Data,
        projection: ProjectionProvisionPayload? = nil,
        lease: ProjectionLeasePayload? = nil
    ) {
        self.version = version
        self.requestID = requestID
        self.operation = operation
        self.nonce = nonce
        self.projection = projection
        self.lease = lease
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(UInt16.self, forKey: .version)
        requestID = try container.decode(UUID.self, forKey: .requestID)
        operation = try container.decode(AgentOperation.self, forKey: .operation)
        nonce = Data(try container.decode([UInt8].self, forKey: .nonce))
        projection = try container.decodeIfPresent(ProjectionProvisionPayload.self, forKey: .projection)
        lease = try container.decodeIfPresent(ProjectionLeasePayload.self, forKey: .lease)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(requestID, forKey: .requestID)
        try container.encode(operation, forKey: .operation)
        try container.encode(Array(nonce), forKey: .nonce)
        try container.encodeIfPresent(projection, forKey: .projection)
        try container.encodeIfPresent(lease, forKey: .lease)
    }
}

struct AgentResponse: Codable, Equatable {
    let version: UInt16
    let requestID: UUID?
    let nonce: Data
    let status: AgentResponseStatus
    let error: AgentProtocolError?

    private enum CodingKeys: String, CodingKey {
        case version
        case requestID = "request_id"
        case nonce
        case status
        case error
    }

    static func success(requestID: UUID, nonce: Data) -> AgentResponse {
        AgentResponse(
            version: AgentProtocol.currentVersion,
            requestID: requestID,
            nonce: nonce,
            status: .ok,
            error: nil
        )
    }

    static func failure(_ error: AgentProtocolError) -> AgentResponse {
        AgentResponse(
            version: AgentProtocol.currentVersion,
            requestID: nil,
            nonce: Data(),
            status: .error,
            error: error
        )
    }

    init(
        version: UInt16,
        requestID: UUID?,
        nonce: Data,
        status: AgentResponseStatus,
        error: AgentProtocolError?
    ) {
        self.version = version
        self.requestID = requestID
        self.nonce = nonce
        self.status = status
        self.error = error
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(UInt16.self, forKey: .version)
        requestID = try container.decodeIfPresent(UUID.self, forKey: .requestID)
        nonce = Data(try container.decode([UInt8].self, forKey: .nonce))
        status = try container.decode(AgentResponseStatus.self, forKey: .status)
        error = try container.decodeIfPresent(AgentProtocolError.self, forKey: .error)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(requestID, forKey: .requestID)
        try container.encode(Array(nonce), forKey: .nonce)
        try container.encode(status, forKey: .status)
        try container.encodeIfPresent(error, forKey: .error)
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
