import Darwin
import Foundation
import Security

enum AgentSocketLocation {
    static let appGroupIdentifier = "group.com.sommir.barwarden.autofill"
    static let socketFilename = "agent-v1.sock"

    static func socketURL() throws -> URL {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["BARWARDEN_AUTOFILL_SOCKET"],
           override.hasPrefix("/") {
            return URL(fileURLWithPath: override)
        }
        #endif
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupIdentifier
        ) else {
            throw AgentProtocolError.unavailable
        }
        return container.appendingPathComponent(socketFilename, isDirectory: false)
    }
}

struct AgentClient {
    static let nonceBytes = 32
    static let defaultTimeout: TimeInterval = 2

    private let connect: () throws -> Int32
    private let timeout: TimeInterval

    init(
        connect: @escaping () throws -> Int32 = {
            try Self.connectUnixSocket(at: AgentSocketLocation.socketURL().path)
        },
        timeout: TimeInterval = Self.defaultTimeout
    ) {
        self.connect = connect
        self.timeout = timeout
    }

    func perform(_ operation: AgentOperation) throws -> AgentResponse {
        let request = AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: UUID(),
            operation: operation,
            nonce: try Self.randomNonce()
        )
        let response = try perform(request)
        guard response.candidateResponse == nil else { throw AgentProtocolError.malformedMessage }
        return response
    }

    func queryCandidates(_ payload: CandidateQueryPayload) throws -> CandidateResponsePayload {
        let request = AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: UUID(),
            operation: .queryCandidates,
            nonce: try Self.randomNonce(),
            candidateQuery: payload
        )
        guard let candidates = try perform(request).candidateResponse else {
            throw AgentProtocolError.malformedMessage
        }
        return candidates
    }

    private func perform(_ request: AgentRequest) throws -> AgentResponse {
        let socket = try connect()
        defer { close(socket) }
        try AgentSocketIO.applyDeadline(timeout, to: socket)

        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(request), to: socket)
        guard shutdown(socket, SHUT_WR) == 0 else {
            throw AgentProtocolError.transport
        }

        let response = try AgentSocketIO.readJSON(from: socket, as: AgentResponse.self)
        guard response.version == AgentProtocol.currentVersion else {
            throw AgentProtocolError.unsupportedVersion
        }
        if response.status == .error {
            throw response.error ?? AgentProtocolError.malformedMessage
        }
        guard response.error == nil,
              response.requestID == request.requestID,
              response.nonce == request.nonce else {
            throw AgentProtocolError.malformedMessage
        }
        return response
    }

    private static func randomNonce() throws -> Data {
        var bytes = Data(count: nonceBytes)
        let status = bytes.withUnsafeMutableBytes { rawBuffer in
            SecRandomCopyBytes(kSecRandomDefault, nonceBytes, rawBuffer.baseAddress!)
        }
        guard status == errSecSuccess else { throw AgentProtocolError.unavailable }
        return bytes
    }

    private static func connectUnixSocket(at path: String) throws -> Int32 {
        let pathBytes = Array(path.utf8)
        guard !pathBytes.isEmpty,
              pathBytes.count < MemoryLayout.size(ofValue: sockaddr_un().sun_path) else {
            throw AgentProtocolError.unavailable
        }

        let socket = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard socket >= 0 else { throw AgentProtocolError.unavailable }
        do {
            var address = sockaddr_un()
            address.sun_family = sa_family_t(AF_UNIX)
            let addressLength = MemoryLayout<sa_family_t>.size + pathBytes.count + 1
            address.sun_len = UInt8(addressLength)
            withUnsafeMutableBytes(of: &address.sun_path) { buffer in
                buffer.copyBytes(from: pathBytes)
                buffer[pathBytes.count] = 0
            }
            let result = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    Darwin.connect(socket, $0, socklen_t(addressLength))
                }
            }
            guard result == 0 else { throw AgentProtocolError.unavailable }
            return socket
        } catch {
            close(socket)
            throw error
        }
    }
}
