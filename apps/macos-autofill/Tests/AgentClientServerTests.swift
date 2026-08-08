import Darwin
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
            .handleAcceptedSocket(sockets.server)

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
            .handleAcceptedSocket(sockets.server)

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
            .handleAcceptedSocket(sockets.server)

        let response = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
        XCTAssertEqual(response.error, .malformedMessage)
    }

    func testOversizedDeclaredRequestReturnsSanitizedCode() throws {
        let sockets = try SocketPair()
        try AgentSocketIO.writeAll(Data([0x00, 0x01, 0x00, 0x01]), to: sockets.client)

        AgentConnectionHandler(authorize: { _ in .mainApplication })
            .handleAcceptedSocket(sockets.server)

        let response = try AgentSocketIO.readJSON(from: sockets.client, as: AgentResponse.self)
        XCTAssertEqual(response.error, .messageTooLarge)
    }

    func testUnauthorizedPeerCannotProbeFramingErrors() throws {
        let sockets = try SocketPair()
        try AgentSocketIO.writeAll(Data([0x00, 0x01, 0x00, 0x01]), to: sockets.client)

        AgentConnectionHandler(authorize: { _ in throw AgentProtocolError.unauthorized })
            .handleAcceptedSocket(sockets.server)

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
        let client = AgentClient(connect: { sockets.client }, timeout: 1)
        DispatchQueue.global().async {
            defer { close(sockets.server) }
            guard let request = try? AgentSocketIO.readJSON(from: sockets.server, as: AgentRequest.self) else { return }
            let response = AgentResponse.success(
                requestID: UUID(),
                nonce: request.nonce
            )
            try? AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(response), to: sockets.server)
        }

        XCTAssertThrowsError(try client.perform(.probe)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .malformedMessage)
        }
    }

    func testClientReadDeadlineIsEnforced() throws {
        let sockets = try SocketPair()
        defer { close(sockets.server) }
        let client = AgentClient(connect: { sockets.client }, timeout: 0.05)

        XCTAssertThrowsError(try client.perform(.probe)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .timeout)
        }
    }

    func testClientReceivesUnauthorizedCodeWhenServerRejectsBeforeDecode() throws {
        let sockets = try SocketPair()
        let client = AgentClient(connect: { sockets.client }, timeout: 1)
        DispatchQueue.global().async {
            AgentConnectionHandler(authorize: { _ in throw AgentProtocolError.unauthorized })
                .handleAcceptedSocket(sockets.server)
        }

        XCTAssertThrowsError(try client.perform(.probe)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .unauthorized)
        }
    }

    private func performLoopbackClientRequest() throws -> AgentResponse {
        let sockets = try SocketPair()
        let client = AgentClient(connect: { sockets.client }, timeout: 1)
        DispatchQueue.global().async {
            AgentConnectionHandler(authorize: { _ in .credentialProvider })
                .handleAcceptedSocket(sockets.server)
        }
        return try client.perform(.probe)
    }
}

private final class SocketPair: @unchecked Sendable {
    let client: Int32
    let server: Int32

    init() throws {
        var descriptors: [Int32] = [0, 0]
        guard socketpair(AF_UNIX, SOCK_STREAM, 0, &descriptors) == 0 else {
            throw AgentProtocolError.transport
        }
        client = descriptors[0]
        server = descriptors[1]
    }

    deinit {
        close(client)
        close(server)
    }
}
