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

    func testCredentialProviderRuntimeClassKeepsModuleQualification() {
        XCTAssertEqual(
            NSStringFromClass(CredentialProviderViewController.self),
            "BarwardenAutoFillTests.CredentialProviderViewController"
        )
    }
}
