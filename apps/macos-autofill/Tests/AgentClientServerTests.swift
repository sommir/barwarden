import Darwin
import CryptoKit
import Foundation
import XCTest

final class AgentClientServerTests: XCTestCase {
    func testAuthorizedConnectionEchoesExactNonceAndClosesAfterOneRequest() throws {
        let sockets = try SocketPair()
        let request = AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: UUID(),
            operation: .probe,
            nonce: Data([0, 1, 2, 253, 254, 255])
        )
        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(request), to: sockets.client)
        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(request), to: sockets.client)

        AgentConnectionHandler(authorize: { _ in .mainApplication })
            .handleAcceptedSocket(sockets.takeServer())

        let response = try AgentSocketIO.readJSON(
            from: sockets.client,
            as: AgentResponse.self
        )
        XCTAssertEqual(response.status, .ok)
        XCTAssertEqual(response.requestID, request.requestID)
        XCTAssertEqual(response.nonce, request.nonce)
        var trailingByte: UInt8 = 0
        XCTAssertEqual(read(sockets.client, &trailingByte, 1), 0, "server must close after one request")
    }

    func testUnauthorizedConnectionReturnsOnlyFixedErrorCode() throws {
        let sockets = try SocketPair()
        let request = AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: UUID(),
            operation: .probe,
            nonce: Data([7])
        )
        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(request), to: sockets.client)

        AgentConnectionHandler(authorize: { _ in throw AgentProtocolError.unauthorized })
            .handleAcceptedSocket(sockets.takeServer())

        let response = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
        XCTAssertEqual(response.status, .error)
        XCTAssertEqual(response.error, .unauthorized)
        XCTAssertNil(response.requestID)
        XCTAssertTrue(response.nonce.isEmpty)
    }

    func testMalformedRequestReturnsSanitizedCode() throws {
        let sockets = try SocketPair()
        try AgentSocketIO.writeFrame(
            try AgentFrame.encode(Data("not-json".utf8)),
            to: sockets.client
        )

        AgentConnectionHandler(authorize: { _ in .credentialProvider })
            .handleAcceptedSocket(sockets.takeServer())

        let response = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
        XCTAssertEqual(response.error, .malformedMessage)
    }

    func testOversizedDeclaredRequestReturnsSanitizedCode() throws {
        let sockets = try SocketPair()
        try AgentSocketIO.writeAll(Data([0x00, 0x01, 0x00, 0x01]), to: sockets.client)

        AgentConnectionHandler(authorize: { _ in .mainApplication })
            .handleAcceptedSocket(sockets.takeServer())

        let response = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
        XCTAssertEqual(response.error, .messageTooLarge)
    }

    func testUnauthorizedPeerCannotProbeFramingErrors() throws {
        let sockets = try SocketPair()
        try AgentSocketIO.writeAll(Data([0x00, 0x01, 0x00, 0x01]), to: sockets.client)

        AgentConnectionHandler(authorize: { _ in throw AgentProtocolError.unauthorized })
            .handleAcceptedSocket(sockets.takeServer())

        let response = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
        XCTAssertEqual(response.error, .unauthorized)
    }

    func testClientUsesFreshRequestIDAndNonceForEveryConnection() throws {
        let first = try performLoopbackClientRequest()
        let second = try performLoopbackClientRequest()

        XCTAssertNotEqual(first.requestID, second.requestID)
        XCTAssertNotEqual(first.nonce, second.nonce)
        XCTAssertEqual(first.nonce.count, AgentClient.nonceBytes)
        XCTAssertEqual(second.nonce.count, AgentClient.nonceBytes)
    }

    func testClientRejectsResponseWithWrongRequestID() throws {
        let sockets = try SocketPair()
        let client = AgentClient(connect: { sockets.takeClient() }, timeout: 1)
        DispatchQueue.global().async {
            let server = sockets.takeServer()
            defer { close(server) }
            guard let request = try? AgentSocketIO.readJSON(from: server, as: AgentRequest.self) else { return }
            let response = AgentResponse.success(
                requestID: UUID(),
                nonce: request.nonce
            )
            try? AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(response), to: server)
        }

        XCTAssertThrowsError(try client.perform(.probe)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .malformedMessage)
        }
    }

    func testClientReadDeadlineIsEnforced() throws {
        let sockets = try SocketPair()
        let server = sockets.takeServer()
        defer { close(server) }
        let client = AgentClient(connect: { sockets.takeClient() }, timeout: 0.05)

        XCTAssertThrowsError(try client.perform(.probe)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .timeout)
        }
    }

    func testClientReceivesUnauthorizedCodeWhenServerRejectsBeforeDecode() throws {
        let sockets = try SocketPair()
        let client = AgentClient(connect: { sockets.takeClient() }, timeout: 1)
        DispatchQueue.global().async {
            AgentConnectionHandler(authorize: { _ in throw AgentProtocolError.unauthorized })
                .handleAcceptedSocket(sockets.takeServer())
        }

        XCTAssertThrowsError(try client.perform(.probe)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .unauthorized)
        }
    }

    func testAbsoluteReadDeadlineCoversHeaderAndPayloadDripFeed() throws {
        let sockets = try SocketPair()
        let finished = expectation(description: "handler deadline")
        let started = DispatchTime.now().uptimeNanoseconds
        DispatchQueue.global().async {
            AgentConnectionHandler(authorize: { _ in .mainApplication }, timeout: 0.10)
                .handleAcceptedSocket(sockets.takeServer())
            finished.fulfill()
        }

        for byte in [UInt8(0), 0, 0, 8] {
            _ = withUnsafePointer(to: byte) { Darwin.send(sockets.client, $0, 1, MSG_NOSIGNAL) }
            usleep(35_000)
        }

        wait(for: [finished], timeout: 0.30)
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000_000
        XCTAssertLessThan(elapsed, 0.25, "drip-fed bytes must not reset the request deadline")
        let response = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
        XCTAssertEqual(response.error, .timeout)
    }

    func testUnauthorizedSlowlorisIsRejectedWithoutWaitingForAFrame() throws {
        let sockets = try SocketPair()
        let finished = expectation(description: "unauthorized rejected")
        DispatchQueue.global().async {
            AgentConnectionHandler(authorize: { _ in throw AgentProtocolError.unauthorized }, timeout: 1)
                .handleAcceptedSocket(sockets.takeServer())
            finished.fulfill()
        }

        wait(for: [finished], timeout: 0.20)
        let response = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
        XCTAssertEqual(response.error, .unauthorized)
    }

    func testBoundedExecutorRejectsBacklogImmediatelyAndRecoversCapacity() {
        let executor = BoundedConnectionExecutor(maximumConcurrentConnections: 1)
        let occupying = expectation(description: "occupying handler started")
        let release = DispatchSemaphore(value: 0)
        let completed = expectation(description: "occupying handler completed")
        XCTAssertTrue(executor.submit {
            occupying.fulfill()
            release.wait()
            completed.fulfill()
        })
        wait(for: [occupying], timeout: 1)

        let rejectedWork = expectation(description: "rejected work must not run")
        rejectedWork.isInverted = true
        let started = DispatchTime.now().uptimeNanoseconds
        XCTAssertFalse(executor.submit { rejectedWork.fulfill() })
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000_000
        XCTAssertLessThan(elapsed, 0.05)

        release.signal()
        wait(for: [completed], timeout: 1)
        let nextCompleted = expectation(description: "capacity recovered")
        XCTAssertTrue(executor.submit { nextCompleted.fulfill() })
        wait(for: [nextCompleted, rejectedWork], timeout: 1)
    }

    func testAuthorizedSlowlorisDoesNotBlockNormalClientWithinConcurrentLimit() throws {
        let executor = BoundedConnectionExecutor(maximumConcurrentConnections: 2)
        let handler = AgentConnectionHandler(authorize: { _ in .mainApplication }, timeout: 0.5)
        let slowloris = try SocketPair()
        let normal = try SocketPair()
        try AgentSocketIO.applyDeadline(0.25, to: normal.client)
        let request = AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: UUID(),
            operation: .probe,
            nonce: Data([9, 8, 7])
        )

        XCTAssertTrue(executor.submit {
            handler.handleAcceptedSocket(slowloris.takeServer())
        })
        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(request), to: normal.client)
        XCTAssertTrue(executor.submit {
            handler.handleAcceptedSocket(normal.takeServer())
        })

        let response = try AgentSocketIO.readJSON(from: normal.client, as: AgentResponse.self)
        XCTAssertEqual(response.status, .ok)
        XCTAssertEqual(response.requestID, request.requestID)
        close(slowloris.takeClient())
    }

    func testCredentialProviderCannotProvisionProjectionKey() throws {
        let fixture = try ProjectionHandlerFixture()
        let sockets = try SocketPair()
        let request = AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: UUID(),
            operation: .provision,
            nonce: Data([4]),
            projection: fixture.provisionPayload
        )
        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(request), to: sockets.client)

        AgentConnectionHandler(
            authorize: { _ in .credentialProvider },
            projectionStore: fixture.store
        ).handleAcceptedSocket(sockets.takeServer())

        let response = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
        XCTAssertEqual(response.error, .unauthorized)
    }

    func testCredentialProviderCannotLockMainApplicationProjectionLease() throws {
        let fixture = try ProjectionHandlerFixture()
        try performProjectionRequest(
            .provision,
            projection: fixture.provisionPayload,
            store: fixture.store
        )
        let sockets = try SocketPair()
        let request = AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: UUID(),
            operation: .lock,
            nonce: Data([5])
        )
        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(request), to: sockets.client)

        AgentConnectionHandler(
            authorize: { _ in .credentialProvider },
            projectionStore: fixture.store
        ).handleAcceptedSocket(sockets.takeServer())

        let response = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
        XCTAssertEqual(response.error, .unauthorized)
        XCTAssertNoThrow(
            try fixture.store.read(accountID: "account-a", generation: fixture.generation)
        )
    }

    func testAuthenticatedMainApplicationProvisionRenewAndLockMutateLease() throws {
        let fixture = try ProjectionHandlerFixture()
        try performProjectionRequest(
            .provision,
            projection: fixture.provisionPayload,
            store: fixture.store
        )
        fixture.now += 20
        try performProjectionRequest(
            .renewLease,
            lease: ProjectionLeasePayload(
                generation: fixture.generation,
                accountID: "account-a",
                leaseDurationSeconds: 30
            ),
            store: fixture.store
        )
        fixture.now += 20
        XCTAssertNoThrow(try fixture.store.read(accountID: "account-a", generation: fixture.generation))

        try performProjectionRequest(.lock, store: fixture.store)
        XCTAssertThrowsError(try fixture.store.read(accountID: "account-a", generation: fixture.generation))
    }

    func testAuthenticatedCredentialProviderQueriesMetadataThroughCurrentProjectionLease() throws {
        let fixture = try ProjectionHandlerFixture()
        try performProjectionRequest(
            .provision,
            projection: fixture.provisionPayload,
            store: fixture.store
        )
        let sockets = try SocketPair()
        let request = AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: UUID(),
            operation: .queryCandidates,
            nonce: Data([9]),
            candidateQuery: CandidateQueryPayload(
                generation: fixture.generation,
                accountID: "account-a",
                context: NativeAutoFillContext(
                    bundleID: "com.example.App",
                    appName: "Example",
                    serviceIdentifiers: ["https://fixture.example.test"],
                    query: ""
                )
            )
        )
        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(request), to: sockets.client)

        AgentConnectionHandler(
            authorize: { _ in .credentialProvider },
            projectionStore: fixture.store,
            matchingEngine: MatchingEngine(presets: [])
        ).handleAcceptedSocket(sockets.takeServer())

        let response = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
        XCTAssertEqual(response.status, .ok)
        XCTAssertEqual(response.candidateResponse?.candidates.map(\.cipherID), ["login-1"])
        XCTAssertEqual(response.candidateResponse?.candidates.first?.group, .exact)
        let encoded = String(decoding: try JSONEncoder().encode(response), as: UTF8.self)
        XCTAssertFalse(encoded.contains("fixture-password-value"))
        XCTAssertFalse(encoded.contains("JBSWY3DPEHPK3PXP"))
        XCTAssertFalse(encoded.contains("https://fixture.example.test"))
    }

    func testSecretReleaseOperationValidatesOneTimeContextButNeverReturnsSecret() throws {
        let fixture = try ProjectionHandlerFixture()
        try performProjectionRequest(.provision, projection: fixture.provisionPayload, store: fixture.store)
        let handler = AgentConnectionHandler(
            authorize: { _ in .credentialProvider },
            projectionStore: fixture.store,
            matchingEngine: MatchingEngine(presets: [])
        )
        let query = AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: UUID(),
            operation: .queryCandidates,
            nonce: Data([10]),
            candidateQuery: CandidateQueryPayload(
                generation: fixture.generation,
                accountID: "account-a",
                context: NativeAutoFillContext(
                    bundleID: "com.example.App",
                    appName: "Example",
                    serviceIdentifiers: ["https://fixture.example.test"],
                    query: ""
                )
            )
        )
        let queryResponse = try perform(query, handler: handler)
        let token = try XCTUnwrap(queryResponse.candidateResponse?.contextToken)
        let release = AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: UUID(),
            operation: .releaseSecret,
            nonce: Data([11]),
            secretRelease: SecretReleasePayload(
                generation: fixture.generation,
                accountID: "account-a",
                candidateID: "login-1",
                field: .password,
                contextToken: token,
                mismatchConfirmed: false,
                reprompt: RepromptResultPayload(result: .notRequired, grant: nil)
            )
        )

        let response = try perform(release, handler: handler)
        XCTAssertEqual(response.error, .unavailable)
        XCTAssertNil(response.candidateResponse)
        let encoded = String(decoding: try JSONEncoder().encode(response), as: UTF8.self)
        XCTAssertFalse(encoded.contains("fixture-password-value"))
        XCTAssertEqual(try perform(release, handler: handler).error, .replayedRequest)
    }

    func testSharedAgentClientCanRequestCandidatesWithoutReceivingSecrets() throws {
        let fixture = try ProjectionHandlerFixture()
        try performProjectionRequest(.provision, projection: fixture.provisionPayload, store: fixture.store)
        let sockets = try SocketPair()
        let handler = AgentConnectionHandler(
            authorize: { _ in .credentialProvider },
            projectionStore: fixture.store,
            matchingEngine: MatchingEngine(presets: [])
        )
        DispatchQueue.global().async { handler.handleAcceptedSocket(sockets.takeServer()) }
        let client = AgentClient(connect: { sockets.takeClient() }, timeout: 1)

        let response = try client.queryCandidates(CandidateQueryPayload(
            generation: fixture.generation,
            accountID: "account-a",
            context: NativeAutoFillContext(
                bundleID: "com.example.App",
                appName: "Example",
                serviceIdentifiers: ["https://fixture.example.test"],
                query: ""
            )
        ))

        XCTAssertEqual(response.candidates.map(\.cipherID), ["login-1"])
        XCTAssertFalse(String(decoding: try JSONEncoder().encode(response), as: UTF8.self)
            .contains("fixture-password-value"))
    }

    private func perform(_ request: AgentRequest, handler: AgentConnectionHandler) throws -> AgentResponse {
        let sockets = try SocketPair()
        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(request), to: sockets.client)
        handler.handleAcceptedSocket(sockets.takeServer())
        return try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
    }

    private func performProjectionRequest(
        _ operation: AgentOperation,
        projection: ProjectionProvisionPayload? = nil,
        lease: ProjectionLeasePayload? = nil,
        store: ProjectionStore
    ) throws {
        let sockets = try SocketPair()
        let request = AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: UUID(),
            operation: operation,
            nonce: Data([8]),
            projection: projection,
            lease: lease
        )
        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(request), to: sockets.client)
        AgentConnectionHandler(
            authorize: { _ in .mainApplication },
            projectionStore: store
        ).handleAcceptedSocket(sockets.takeServer())
        let response = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
        XCTAssertEqual(response.status, .ok)
    }

    func testDecodedProvisionKeyBufferIsClearedAfterDispatch() throws {
        let fixture = try ProjectionHandlerFixture()
        let sockets = try SocketPair()
        var cleared: Data?
        let request = AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: UUID(),
            operation: .provision,
            nonce: Data([8]),
            projection: fixture.provisionPayload
        )
        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(request), to: sockets.client)

        AgentConnectionHandler(
            authorize: { _ in .mainApplication },
            projectionStore: fixture.store,
            onProjectionKeyCleared: { cleared = $0 }
        ).handleAcceptedSocket(sockets.takeServer())
        _ = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)

        XCTAssertEqual(cleared, Data(repeating: 0, count: ZeroizingKey.byteCount))
    }

    private func performLoopbackClientRequest() throws -> AgentResponse {
        let sockets = try SocketPair()
        let client = AgentClient(connect: { sockets.takeClient() }, timeout: 1)
        DispatchQueue.global().async {
            AgentConnectionHandler(authorize: { _ in .credentialProvider })
                .handleAcceptedSocket(sockets.takeServer())
        }
        return try client.perform(.probe)
    }
}

private final class ProjectionHandlerFixture {
    let directory: URL
    let url: URL
    let generation = UUID()
    var now: TimeInterval = 1_800_000_000
    lazy var store = ProjectionStore(projectionURL: url, clock: { [unowned self] in self.now })

    var provisionPayload: ProjectionProvisionPayload {
        ProjectionProvisionPayload(
            generation: generation,
            accountID: "account-a",
            vaultRevision: 1,
            key: Data((0..<32).map(UInt8.init)),
            leaseDurationSeconds: 30
        )
    }

    init() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("barwarden-handler-\(UUID().uuidString)", isDirectory: true)
        url = directory.appendingPathComponent("projection.bwaf")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        let projection = AutoFillProjection(
            version: 1,
            accountID: "account-a",
            vaultRevision: 1,
            createdAt: "2026-08-08T08:00:00.000Z",
            logins: [AutoFillLogin(
                cipherID: "login-1",
                name: "Example",
                username: "fixture-user@example.test",
                password: "fixture-password-value",
                uris: [AutoFillURI(uri: "https://fixture.example.test", matchType: .exact)],
                totp: "JBSWY3DPEHPK3PXP",
                favorite: false,
                reprompt: false
            )]
        )
        let key = SymmetricKey(data: Data((0..<32).map(UInt8.init)))
        let nonce = try ChaChaPoly.Nonce(data: Data(repeating: 7, count: 12))
        let header = AutoFillProjectionEnvelope.header(nonce: Data(nonce))
        let sealed = try ChaChaPoly.seal(
            JSONEncoder().encode(projection),
            using: key,
            nonce: nonce,
            authenticating: header
        )
        try (header + sealed.ciphertext + sealed.tag).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    deinit { try? FileManager.default.removeItem(at: directory) }
}

final class SocketPair: @unchecked Sendable {
    private(set) var client: Int32
    private(set) var server: Int32

    init() throws {
        var descriptors: [Int32] = [0, 0]
        guard socketpair(AF_UNIX, SOCK_STREAM, 0, &descriptors) == 0 else {
            throw AgentProtocolError.transport
        }
        client = descriptors[0]
        server = descriptors[1]
    }

    deinit {
        if client >= 0 { close(client) }
        if server >= 0 { close(server) }
    }

    func takeClient() -> Int32 {
        defer { client = -1 }
        return client
    }

    func takeServer() -> Int32 {
        defer { server = -1 }
        return server
    }
}
