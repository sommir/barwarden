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
