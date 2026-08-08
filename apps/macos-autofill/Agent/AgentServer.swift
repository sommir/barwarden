import Darwin
import Foundation

final class AgentRequestGate {
    private var requestIDs: Set<UUID> = []
    private let lock = NSLock()
    private let maximumRememberedRequestIDs: Int

    init(maximumRememberedRequestIDs: Int = 4_096) {
        precondition(maximumRememberedRequestIDs > 0)
        self.maximumRememberedRequestIDs = maximumRememberedRequestIDs
    }

    func accept(_ request: AgentRequest) throws {
        guard request.version == AgentProtocol.currentVersion else {
            throw AgentProtocolError.unsupportedVersion
        }

        lock.lock()
        defer { lock.unlock() }
        guard !requestIDs.contains(request.requestID) else {
            throw AgentProtocolError.replayedRequest
        }
        guard requestIDs.count < maximumRememberedRequestIDs else {
            throw AgentProtocolError.requestCapacity
        }
        requestIDs.insert(request.requestID)
    }
}

final class BoundedConnectionExecutor {
    private let capacity: DispatchSemaphore
    private let queue = DispatchQueue(
        label: "com.sommir.barwarden.autofill-agent.connections",
        qos: .userInitiated,
        attributes: .concurrent
    )

    init(maximumConcurrentConnections: Int) {
        precondition(maximumConcurrentConnections > 0)
        capacity = DispatchSemaphore(value: maximumConcurrentConnections)
    }

    func submit(_ work: @escaping () -> Void) -> Bool {
        guard capacity.wait(timeout: .now()) == .success else { return false }
        queue.async { [capacity] in
            defer { capacity.signal() }
            work()
        }
        return true
    }
}

final class AgentConnectionHandler {
    private let authorize: (Int32) throws -> AuthorizedPeer
    private let requestGate: AgentRequestGate
    private let timeout: TimeInterval
    private let projectionStore: ProjectionStore?

    init(
        authorize: @escaping (Int32) throws -> AuthorizedPeer = {
            try PeerIdentityVerifier().verifyAcceptedSocket($0)
        },
        requestGate: AgentRequestGate = AgentRequestGate(),
        timeout: TimeInterval = AgentClient.defaultTimeout,
        projectionStore: ProjectionStore? = nil
    ) {
        self.authorize = authorize
        self.requestGate = requestGate
        self.timeout = timeout
        self.projectionStore = projectionStore
    }

    func handleAcceptedSocket(_ socket: Int32) {
        defer { close(socket) }
        do {
            try AgentSocketIO.applyDeadline(timeout, to: socket)
            let deadline = try AgentDeadline(timeout: timeout)
            let peer: AuthorizedPeer
            do {
                peer = try authorize(socket)
            } catch {
                try? sendFailure(.unauthorized, to: socket)
                finishRejectedConnection(socket)
                return
            }
            try handleAuthorizedSocket(socket, peer: peer, deadline: deadline)
        } catch let error as AgentProtocolError {
            try? sendFailure(error, to: socket)
        } catch {
            try? sendFailure(.malformedMessage, to: socket)
        }
    }

    private func handleAuthorizedSocket(
        _ socket: Int32,
        peer: AuthorizedPeer,
        deadline: AgentDeadline
    ) throws {
        var frame = try AgentSocketIO.readFrame(from: socket, deadline: deadline)
        defer { frame.resetBytes(in: frame.indices) }
        let request = try AgentFrame.decode(frame, as: AgentRequest.self)
        try requestGate.accept(request)
        switch request.operation {
        case .probe, .status:
            guard request.projection == nil, request.lease == nil else {
                throw AgentProtocolError.malformedMessage
            }
        case .lock:
            guard request.projection == nil, request.lease == nil else {
                throw AgentProtocolError.malformedMessage
            }
            projectionStore?.lock()
        case .provision:
            guard let payload = request.projection,
                  request.lease == nil,
                  let projectionStore else {
                throw AgentProtocolError.malformedMessage
            }
            defer { payload.clearKey() }
            try projectionStore.provision(
                ProjectionProvision(
                    generation: payload.generation,
                    accountID: payload.accountID,
                    vaultRevision: payload.vaultRevision,
                    key: payload.key,
                    leaseDurationSeconds: payload.leaseDurationSeconds,
                    projectionURL: payload.projectionPath.map { URL(fileURLWithPath: $0) }
                ),
                from: peer
            )
        case .renewLease:
            guard request.projection == nil,
                  let payload = request.lease,
                  let projectionStore else {
                throw AgentProtocolError.malformedMessage
            }
            try projectionStore.renewLease(
                generation: payload.generation,
                accountID: payload.accountID,
                durationSeconds: payload.leaseDurationSeconds,
                from: peer
            )
        }
        let response = AgentResponse.success(requestID: request.requestID, nonce: request.nonce)
        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(response), to: socket)
    }

    private func sendFailure(_ error: AgentProtocolError, to socket: Int32) throws {
        try AgentSocketIO.writeFrame(
            try AgentFrame.encodeJSON(AgentResponse.failure(error)),
            to: socket
        )
    }

    private func finishRejectedConnection(_ socket: Int32) {
        _ = shutdown(socket, SHUT_WR)
        var buffer = [UInt8](repeating: 0, count: 4_096)
        var remaining = AgentFrame.maximumPayloadBytes + MemoryLayout<UInt32>.size
        let drainEnd = DispatchTime.now().uptimeNanoseconds + 25_000_000
        while remaining > 0 {
            let now = DispatchTime.now().uptimeNanoseconds
            guard now < drainEnd else { break }
            let remainingMilliseconds = Int32(
                min((drainEnd - now + 999_999) / 1_000_000, UInt64(Int32.max))
            )
            var descriptor = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
            let pollResult = Darwin.poll(&descriptor, 1, remainingMilliseconds)
            if pollResult == 0 { break }
            if pollResult < 0 {
                if errno == EINTR { continue }
                break
            }
            let amount = min(buffer.count, remaining)
            let result = recv(socket, &buffer, amount, MSG_DONTWAIT)
            if result > 0 {
                remaining -= result
            } else if result < 0, errno == EINTR {
                continue
            } else {
                break
            }
        }
    }
}

final class AgentServer {
    private let socketURL: URL
    private let handler: AgentConnectionHandler
    private let executor: BoundedConnectionExecutor

    init(
        socketURL: URL,
        handler: AgentConnectionHandler = AgentConnectionHandler(),
        maximumConcurrentConnections: Int = 8
    ) {
        self.socketURL = socketURL
        self.handler = handler
        executor = BoundedConnectionExecutor(
            maximumConcurrentConnections: maximumConcurrentConnections
        )
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
                if !executor.submit({ [handler] in handler.handleAcceptedSocket(accepted) }) {
                    close(accepted)
                }
            } else if errno != EINTR {
                throw AgentProtocolError.transport
            }
        }
    }
}
