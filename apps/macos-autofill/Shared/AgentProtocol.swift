import Foundation

enum AgentProtocol {
    static let currentVersion: UInt16 = 1
}

enum AgentOperation: String, Codable, Equatable {
    case probe
    case status
    case lock
}

struct AgentRequest: Codable, Equatable {
    let version: UInt16
    let requestID: UUID
    let operation: AgentOperation
    let nonce: Data

    private enum CodingKeys: String, CodingKey {
        case version
        case requestID = "request_id"
        case operation
        case nonce
    }

    init(version: UInt16, requestID: UUID, operation: AgentOperation, nonce: Data) {
        self.version = version
        self.requestID = requestID
        self.operation = operation
        self.nonce = nonce
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(UInt16.self, forKey: .version)
        requestID = try container.decode(UUID.self, forKey: .requestID)
        operation = try container.decode(AgentOperation.self, forKey: .operation)
        nonce = Data(try container.decode([UInt8].self, forKey: .nonce))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(requestID, forKey: .requestID)
        try container.encode(operation, forKey: .operation)
        try container.encode(Array(nonce), forKey: .nonce)
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
}
