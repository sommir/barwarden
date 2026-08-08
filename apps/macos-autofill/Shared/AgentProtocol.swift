import Foundation

enum AgentOperation: String, Codable, Equatable {
    case probe
}

struct AgentRequest: Codable, Equatable {
    let version: UInt16
    let requestID: UUID
    let operation: AgentOperation
    let nonce: Data
}

struct AgentResponse: Codable, Equatable {
    let version: UInt16
    let requestID: UUID
    let nonce: Data
}

enum AgentProtocolError: String, Codable, Error, Equatable {
    case malformedMessage
    case messageTooLarge
}
