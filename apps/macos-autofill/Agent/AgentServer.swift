import Darwin
import Foundation

final class AgentRequestGate {
    private var requestIDs: Set<UUID> = []
    private let lock = NSLock()

    func accept(_ request: AgentRequest) throws {
        guard request.version == AgentProtocol.currentVersion else {
            throw AgentProtocolError.unsupportedVersion
        }

        lock.lock()
        defer { lock.unlock() }
        guard requestIDs.insert(request.requestID).inserted else {
            throw AgentProtocolError.replayedRequest
        }
    }
}

final class AgentConnectionHandler {
    private let authorize: (Int32) throws -> AuthorizedPeer
    private let requestGate: AgentRequestGate
    private let timeout: TimeInterval

    init(
        authorize: @escaping (Int32) throws -> AuthorizedPeer = {
            try PeerIdentityVerifier().verifyAcceptedSocket($0)
        },
        requestGate: AgentRequestGate = AgentRequestGate(),
        timeout: TimeInterval = AgentClient.defaultTimeout
    ) {
        self.authorize = authorize
        self.requestGate = requestGate
        self.timeout = timeout
    }

    func handleAcceptedSocket(_ socket: Int32) {
        defer { close(socket) }
        do {
            try AgentSocketIO.applyDeadline(timeout, to: socket)
            let authorization: Result<AuthorizedPeer, Error> = Result {
                try authorize(socket)
            }
            let incomingFrame: Result<Data, Error> = Result {
                try AgentSocketIO.readFrame(from: socket)
            }
            _ = try authorization.get()
            let frame = try incomingFrame.get()
            let request = try AgentFrame.decode(frame, as: AgentRequest.self)
            try requestGate.accept(request)
            let response = AgentResponse.success(requestID: request.requestID, nonce: request.nonce)
            try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(response), to: socket)
        } catch let error as AgentProtocolError {
            try? sendFailure(error, to: socket)
        } catch {
            try? sendFailure(.malformedMessage, to: socket)
        }
    }

    private func sendFailure(_ error: AgentProtocolError, to socket: Int32) throws {
        try AgentSocketIO.writeFrame(
            try AgentFrame.encodeJSON(AgentResponse.failure(error)),
            to: socket
        )
    }
}

final class AgentServer {
    private let socketURL: URL
    private let handler: AgentConnectionHandler

    init(
        socketURL: URL,
        handler: AgentConnectionHandler = AgentConnectionHandler()
    ) {
        self.socketURL = socketURL
        self.handler = handler
    }

    func run() throws -> Never {
        try FileManager.default.createDirectory(
            at: socketURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        let listener = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard listener >= 0 else { throw AgentProtocolError.unavailable }
        defer { close(listener) }

        let path = socketURL.path
        let pathBytes = Array(path.utf8)
        guard !pathBytes.isEmpty,
              pathBytes.count < MemoryLayout.size(ofValue: sockaddr_un().sun_path) else {
            throw AgentProtocolError.unavailable
        }
        _ = unlink(path)

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let addressLength = MemoryLayout<sa_family_t>.size + pathBytes.count + 1
        address.sun_len = UInt8(addressLength)
        withUnsafeMutableBytes(of: &address.sun_path) { buffer in
            buffer.copyBytes(from: pathBytes)
            buffer[pathBytes.count] = 0
        }
        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(listener, $0, socklen_t(addressLength))
            }
        }
        guard bindResult == 0,
              chmod(path, S_IRUSR | S_IWUSR) == 0,
              listen(listener, 16) == 0 else {
            throw AgentProtocolError.unavailable
        }

        while true {
            let accepted = accept(listener, nil, nil)
            if accepted >= 0 {
                handler.handleAcceptedSocket(accepted)
            } else if errno != EINTR {
                throw AgentProtocolError.transport
            }
        }
    }
}
