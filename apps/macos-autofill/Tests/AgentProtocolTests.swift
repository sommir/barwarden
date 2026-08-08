import Foundation
import XCTest

final class AgentProtocolTests: XCTestCase {
    func testFrameRejectsPayloadOver64KiB() throws {
        XCTAssertThrowsError(try AgentFrame.encode(Data(repeating: 0, count: 65_537))) { error in
            XCTAssertEqual(error as? AgentProtocolError, .messageTooLarge)
        }
    }

    func testFrameRejectsIncomingDeclaredLengthOver64KiB() throws {
        let oversizedHeader = Data([0x00, 0x01, 0x00, 0x01])

        XCTAssertThrowsError(try AgentFrame.payload(from: oversizedHeader)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .messageTooLarge)
        }
    }

    func testFrameAcceptsPayloadAt64KiBBoundary() throws {
        let payload = Data(repeating: 0x5a, count: 65_536)

        XCTAssertEqual(try AgentFrame.payload(from: AgentFrame.encode(payload)), payload)
    }

    func testFrameRejectsTruncatedPayload() throws {
        let frame = try AgentFrame.encode(Data([1, 2, 3]))

        XCTAssertThrowsError(try AgentFrame.payload(from: frame.dropLast())) { error in
            XCTAssertEqual(error as? AgentProtocolError, .malformedMessage)
        }
    }

    func testFrameRejectsTrailingPayload() throws {
        let frame = try AgentFrame.encode(Data([1, 2, 3]))

        XCTAssertThrowsError(try AgentFrame.payload(from: frame + Data([4]))) { error in
            XCTAssertEqual(error as? AgentProtocolError, .malformedMessage)
        }
    }

    func testRequestRoundTripPreservesNonceAndVersion() throws {
        let request = AgentRequest(
            version: 1,
            requestID: UUID(),
            operation: .probe,
            nonce: Data([1, 2, 3])
        )

        XCTAssertEqual(
            try AgentFrame.decode(AgentFrame.encodeJSON(request), as: AgentRequest.self),
            request
        )
    }

    func testJSONEncodingClearsIntermediatePayloadOnSuccess() throws {
        let secret = ReleasedSecret(field: .password, value: Data("sensitive-value".utf8))
        var cleared: Data?

        _ = try AgentFrame.encodeJSON(
            AgentResponse.secret(requestID: UUID(), nonce: Data([1]), payload: secret),
            onJSONCleared: { cleared = $0 }
        )

        XCTAssertGreaterThan(cleared?.count ?? 0, 0)
        XCTAssertTrue(cleared?.allSatisfy({ $0 == 0 }) == true)
        secret.clear()
    }

    func testMalformedJSONDecodeClearsOwnedPayload() throws {
        let frame = try AgentFrame.encode(Data("not-json-sensitive".utf8))
        var cleared: Data?

        XCTAssertThrowsError(try AgentFrame.decode(
            frame,
            as: AgentRequest.self,
            onPayloadCleared: { cleared = $0 }
        )) { XCTAssertEqual($0 as? AgentProtocolError, .malformedMessage) }

        XCTAssertEqual(cleared?.count, "not-json-sensitive".utf8.count)
        XCTAssertTrue(cleared?.allSatisfy({ $0 == 0 }) == true)
    }

    func testSocketReadJSONClearsRawFrameAndReadTemporaries() throws {
        let sockets = try SocketPair()
        let response = AgentResponse.success(requestID: UUID(), nonce: Data([4, 5, 6]))
        try AgentSocketIO.writeFrame(try AgentFrame.encodeJSON(response), to: sockets.client)
        var clearedFrame: Data?
        var clearedPayload: Data?
        var clearedTemporaries: [Data] = []

        _ = try AgentSocketIO.readJSON(
            from: sockets.server,
            as: AgentResponse.self,
            onFrameCleared: { clearedFrame = $0 },
            onPayloadCleared: { clearedPayload = $0 },
            onReadTemporaryCleared: { clearedTemporaries.append($0) }
        )

        XCTAssertTrue(clearedFrame?.allSatisfy({ $0 == 0 }) == true)
        XCTAssertTrue(clearedPayload?.allSatisfy({ $0 == 0 }) == true)
        XCTAssertEqual(clearedTemporaries.count, 4)
        XCTAssertTrue(clearedTemporaries.allSatisfy { !$0.isEmpty && $0.allSatisfy { $0 == 0 } })
    }

    func testOversizedSocketFrameClearsHeaderOnError() throws {
        let sockets = try SocketPair()
        try AgentSocketIO.writeAll(Data([0x00, 0x01, 0x00, 0x01]), to: sockets.client)
        var cleared: [Data] = []

        XCTAssertThrowsError(try AgentSocketIO.readFrame(
            from: sockets.server,
            onTemporaryCleared: { cleared.append($0) }
        )) { XCTAssertEqual($0 as? AgentProtocolError, .messageTooLarge) }

        XCTAssertEqual(cleared.count, 2)
        XCTAssertTrue(cleared.allSatisfy { $0 == Data(repeating: 0, count: 4) })
    }

    func testProvisionKeyUsesOneBase64DataValueInsteadOfAnUnzeroizedByteArray() throws {
        let key = Data((0..<32).map(UInt8.init))
        let request = AgentRequest(
            version: 1,
            requestID: UUID(),
            operation: .provision,
            nonce: Data([1]),
            projection: ProjectionProvisionPayload(
                generation: UUID(),
                accountID: "account-a",
                vaultRevision: 1,
                key: key,
                leaseDurationSeconds: 30
            )
        )

        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        )
        let projection = try XCTUnwrap(object["projection"] as? [String: Any])

        XCTAssertEqual(projection["key"] as? String, key.base64EncodedString())
        XCTAssertNil(projection["key"] as? [UInt8])
    }

    func testCredentialProviderRuntimeClassKeepsModuleQualification() {
        XCTAssertEqual(
            NSStringFromClass(CredentialProviderViewController.self),
            "BarwardenAutoFillTests.CredentialProviderViewController"
        )
    }
}
