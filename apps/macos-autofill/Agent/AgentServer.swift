import Darwin
import Foundation
import OSLog

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

private struct ReportedAgentFailure: Error {
    let error: AgentProtocolError
}

final class AgentConnectionHandler {
    private static let logger = Logger(
        subsystem: "com.sommir.barwarden.autofill-agent",
        category: "protocol"
    )

    private let authorize: (Int32) throws -> AuthorizedPeer
    private let requestGate: AgentRequestGate
    private let timeout: TimeInterval
    private let projectionStore: ProjectionStore?
    private let matchingEngine: MatchingEngine
    private let verifyRepromptGrant: CandidateAuthorizationStore.RepromptGrantVerifier
    private let repromptGrants: RepromptGrantStore
    private let onProjectionKeyCleared: ((Data) -> Void)?
    private let onSecretResponseCleared: ((Data) -> Void)?
    private let totpClock: () -> Date

    init(
        authorize: @escaping (Int32) throws -> AuthorizedPeer = {
            try PeerIdentityVerifier().verifyAcceptedSocket($0)
        },
        requestGate: AgentRequestGate = AgentRequestGate(),
        timeout: TimeInterval = AgentClient.defaultTimeout,
        projectionStore: ProjectionStore? = nil,
        matchingEngine: MatchingEngine = MatchingEngine(presets: AppPresetCatalog.bundled()),
        repromptGrants: RepromptGrantStore = RepromptGrantStore(),
        verifyRepromptGrant: CandidateAuthorizationStore.RepromptGrantVerifier? = nil,
        onProjectionKeyCleared: ((Data) -> Void)? = nil,
        onSecretResponseCleared: ((Data) -> Void)? = nil,
        totpClock: @escaping () -> Date = Date.init
    ) {
        self.authorize = authorize
        self.requestGate = requestGate
        self.timeout = timeout
        self.projectionStore = projectionStore
        self.matchingEngine = matchingEngine
        self.repromptGrants = repromptGrants
        self.verifyRepromptGrant = verifyRepromptGrant ?? { [repromptGrants] in
            repromptGrants.consume(
                accountID: $0,
                cipherID: $1,
                field: $2,
                generation: $3,
                contextToken: $4,
                grant: $5
            )
        }
        self.onProjectionKeyCleared = onProjectionKeyCleared
        self.onSecretResponseCleared = onSecretResponseCleared
        self.totpClock = totpClock
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
                reportFailure(.unauthorized)
                try? sendFailure(.unauthorized, to: socket)
                finishRejectedConnection(socket)
                return
            }
            try handleAuthorizedSocket(socket, peer: peer, deadline: deadline)
        } catch let reported as ReportedAgentFailure {
            try? sendFailure(reported.error, to: socket)
        } catch let error as AgentProtocolError {
            reportFailure(error)
            try? sendFailure(error, to: socket)
        } catch {
            reportFailure(.malformedMessage)
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
        defer {
            if let projection = request.projection {
                projection.clearKey()
                onProjectionKeyCleared?(projection.key)
            }
        }
        do {
            try handleDecodedRequest(request, peer: peer, socket: socket)
        } catch let error as AgentProtocolError {
            reportFailure(error, operation: request.operation)
            throw ReportedAgentFailure(error: error)
        } catch {
            reportFailure(.malformedMessage, operation: request.operation)
            throw ReportedAgentFailure(error: .malformedMessage)
        }
    }

    private func handleDecodedRequest(
        _ request: AgentRequest,
        peer: AuthorizedPeer,
        socket: Int32
    ) throws {
        try requestGate.accept(request)
        var candidateResponse: CandidateResponsePayload?
        var sessionResponse: AgentSessionPayload?
        var secretResponse: ReleasedSecret?
        var repromptGrantResponse: RepromptGrantPayload?
        defer {
            secretResponse?.clear()
            if let secretResponse {
                onSecretResponseCleared?(secretResponse.value)
            }
        }
        switch request.operation {
        case .probe:
            guard request.projection == nil, request.lease == nil,
                  request.candidateQuery == nil, request.secretRelease == nil,
                  request.repromptGrantIssue == nil else {
                throw AgentProtocolError.malformedMessage
            }
        case .status:
            guard request.projection == nil, request.lease == nil,
                  request.candidateQuery == nil, request.secretRelease == nil,
                  request.repromptGrantIssue == nil,
                  let projectionStore else {
                throw AgentProtocolError.malformedMessage
            }
            sessionResponse = try projectionStore.currentSession()
        case .lock:
            guard peer == .mainApplication,
                  request.projection == nil, request.lease == nil,
                  request.candidateQuery == nil, request.secretRelease == nil,
                  request.repromptGrantIssue == nil else {
                if peer != .mainApplication { throw AgentProtocolError.unauthorized }
                throw AgentProtocolError.malformedMessage
            }
            projectionStore?.lock()
            repromptGrants.clear()
        case .provision:
            guard let payload = request.projection,
                  request.lease == nil, request.candidateQuery == nil, request.secretRelease == nil,
                  request.repromptGrantIssue == nil,
                  let projectionStore else {
                throw AgentProtocolError.malformedMessage
            }
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
            repromptGrants.clear()
        case .renewLease:
            guard request.projection == nil,
                  let payload = request.lease,
                  request.candidateQuery == nil,
                  request.secretRelease == nil,
                  request.repromptGrantIssue == nil,
                  let projectionStore else {
                throw AgentProtocolError.malformedMessage
            }
            try projectionStore.renewLease(
                generation: payload.generation,
                accountID: payload.accountID,
                durationSeconds: payload.leaseDurationSeconds,
                from: peer
            )
        case .queryCandidates:
            guard request.projection == nil, request.lease == nil,
                  let payload = request.candidateQuery,
                  request.secretRelease == nil,
                  request.repromptGrantIssue == nil,
                  let projectionStore,
                  !payload.accountID.isEmpty,
                  payload.context.bundleID.count <= 255,
                  payload.context.appName.count <= 255,
                  payload.context.serviceIdentifiers.count <= 32,
                  payload.context.serviceIdentifiers.allSatisfy({ $0.count <= 2_048 }),
                  payload.context.query.count <= 512 else {
                throw AgentProtocolError.malformedMessage
            }
            candidateResponse = try projectionStore.queryCandidates(
                accountID: payload.accountID,
                generation: payload.generation,
                field: payload.field,
                context: payload.context,
                matchingEngine: matchingEngine
            )
        case .releaseSecret:
            guard request.projection == nil, request.lease == nil,
                  request.candidateQuery == nil,
                  let payload = request.secretRelease,
                  request.repromptGrantIssue == nil,
                  let projectionStore else {
                throw AgentProtocolError.malformedMessage
            }
            secretResponse = try projectionStore.withAuthorizedCandidate(
                payload,
                matchingEngine: matchingEngine,
                verifyRepromptGrant: verifyRepromptGrant,
                operation: { login in
                    let value: String
                    switch payload.field {
                    case .username:
                        value = login.username
                    case .password:
                        value = login.password
                    case .totp:
                        guard !login.totp.isEmpty else { throw AgentProtocolError.unavailable }
                        value = try TOTPGenerator.currentCode(seed: login.totp, at: totpClock())
                    }
                    return ReleasedSecret(field: payload.field, value: Data(value.utf8))
                }
            )
        case .issueRepromptGrant:
            guard peer == .mainApplication,
                  request.projection == nil, request.lease == nil,
                  request.candidateQuery == nil, request.secretRelease == nil,
                  let payload = request.repromptGrantIssue,
                  let projectionStore else {
                if peer != .mainApplication { throw AgentProtocolError.unauthorized }
                throw AgentProtocolError.malformedMessage
            }
            let session = try projectionStore.currentSession()
            guard session.accountID == payload.accountID,
                  session.generation == payload.generation else {
                throw AgentProtocolError.unauthorized
            }
            repromptGrantResponse = RepromptGrantPayload(grant: try repromptGrants.issue(
                accountID: payload.accountID,
                cipherID: payload.candidateID,
                field: payload.field,
                generation: payload.generation,
                contextToken: payload.contextToken
            ))
        }
        let response: AgentResponse
        if let candidateResponse {
            response = AgentResponse.candidates(
                requestID: request.requestID, nonce: request.nonce, payload: candidateResponse
            )
        } else if let sessionResponse {
            response = AgentResponse.session(
                requestID: request.requestID, nonce: request.nonce, payload: sessionResponse
            )
        } else if let secretResponse {
            response = AgentResponse.secret(
                requestID: request.requestID, nonce: request.nonce, payload: secretResponse
            )
        } else if let repromptGrantResponse {
            response = AgentResponse.repromptGrant(
                requestID: request.requestID,
                nonce: request.nonce,
                payload: repromptGrantResponse
            )
        } else {
            response = AgentResponse.success(requestID: request.requestID, nonce: request.nonce)
        }
        var encodedResponse = try AgentFrame.encodeJSON(response)
        defer { encodedResponse.resetBytes(in: encodedResponse.indices) }
        try AgentSocketIO.writeFrame(encodedResponse, to: socket)
    }

    private func sendFailure(_ error: AgentProtocolError, to socket: Int32) throws {
        var frame = try AgentFrame.encodeJSON(AgentResponse.failure(error))
        defer { frame.resetBytes(in: frame.indices) }
        try AgentSocketIO.writeFrame(frame, to: socket)
    }

    private func reportFailure(
        _ error: AgentProtocolError,
        operation: AgentOperation? = nil
    ) {
        let prefix = operation.map { "operation=\($0.rawValue) " } ?? ""
        let line = "BarwardenAutoFillAgent \(prefix)failure=\(error.rawValue)\n"
        try? FileHandle.standardError.write(contentsOf: Data(line.utf8))
        if let operation {
            Self.logger.error(
                "operation=\(operation.rawValue, privacy: .public) failure=\(error.rawValue, privacy: .public)"
            )
        } else {
            Self.logger.error("failure=\(error.rawValue, privacy: .public)")
        }
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
        let rootDescriptor = open(
            socketURL.deletingLastPathComponent().path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard rootDescriptor >= 0 else { throw AgentProtocolError.unavailable }
        defer { close(rootDescriptor) }
        var rootMetadata = stat()
        guard fstat(rootDescriptor, &rootMetadata) == 0,
              rootMetadata.st_uid == geteuid(),
              fchmod(rootDescriptor, S_IRWXU) == 0 else {
            throw AgentProtocolError.unavailable
        }

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
