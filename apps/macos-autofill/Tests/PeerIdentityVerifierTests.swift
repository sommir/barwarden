import Darwin
import Foundation
import XCTest

final class PeerIdentityVerifierTests: XCTestCase {
    private let teamID = "K7LY92JY96"

    func testAcceptsSignedMainApplication() throws {
        let verifier = makeVerifier(identity: .init(
            teamIdentifier: teamID,
            bundleIdentifier: "com.sommir.barwarden"
        ))

        XCTAssertEqual(try verifier.verifyAcceptedSocket(7), .mainApplication)
    }

    func testAcceptsSignedCredentialProvider() throws {
        let verifier = makeVerifier(identity: .init(
            teamIdentifier: teamID,
            bundleIdentifier: "com.sommir.barwarden.credential-provider"
        ))

        XCTAssertEqual(try verifier.verifyAcceptedSocket(7), .credentialProvider)
    }

    func testRejectsWrongTeamIdentifier() {
        assertUnauthorized(identity: .init(
            teamIdentifier: "AAAAAAAAAA",
            bundleIdentifier: "com.sommir.barwarden"
        ))
    }

    func testRejectsWrongBundleIdentifier() {
        assertUnauthorized(identity: .init(
            teamIdentifier: teamID,
            bundleIdentifier: "com.sommir.barwarden.autofill-agent"
        ))
    }

    func testRejectsUnsignedCaller() {
        assertUnauthorized(identity: .init(teamIdentifier: nil, bundleIdentifier: nil))
    }

    func testRejectsAcceptedSocketWithoutPeerPID() {
        let verifier = PeerIdentityVerifier(
            peerPID: { _ in nil },
            signingIdentity: { _ in XCTFail("signing lookup must not run without a peer PID"); return .init(teamIdentifier: nil, bundleIdentifier: nil) }
        )

        XCTAssertThrowsError(try verifier.verifyAcceptedSocket(7)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .unauthorized)
        }
    }

    func testVerifierUsesKernelPIDRatherThanCallerClaimedIdentity() throws {
        var inspectedPID: pid_t?
        let verifier = PeerIdentityVerifier(
            peerPID: { _ in 4_242 },
            signingIdentity: { pid in
                inspectedPID = pid
                return .init(
                    teamIdentifier: self.teamID,
                    bundleIdentifier: "com.sommir.barwarden"
                )
            }
        )
        let requestWithForgedClaims = Data(#"{"version":1,"request_id":"00000000-0000-4000-8000-000000000001","operation":"probe","nonce":[1,2,3],"pid":1,"team_id":"ATTACKER01","bundle_id":"evil.example"}"#.utf8)

        _ = try AgentFrame.decode(try AgentFrame.encode(requestWithForgedClaims), as: AgentRequest.self)
        XCTAssertEqual(try verifier.verifyAcceptedSocket(7), .mainApplication)
        XCTAssertEqual(inspectedPID, 4_242)
    }

    func testMalformedJSONIsSanitized() throws {
        XCTAssertThrowsError(
            try AgentFrame.decode(try AgentFrame.encode(Data("not-json".utf8)), as: AgentRequest.self)
        ) { error in
            XCTAssertEqual(error as? AgentProtocolError, .malformedMessage)
        }
    }

    func testProtocolVersionMismatchIsRejected() {
        let gate = AgentRequestGate()
        let request = AgentRequest(
            version: 2,
            requestID: UUID(),
            operation: .probe,
            nonce: Data([1, 2, 3])
        )

        XCTAssertThrowsError(try gate.accept(request)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .unsupportedVersion)
        }
    }

    func testRequestIDReplayIsRejected() throws {
        let gate = AgentRequestGate()
        let request = AgentRequest(
            version: 1,
            requestID: UUID(),
            operation: .probe,
            nonce: Data([1, 2, 3])
        )

        try gate.accept(request)
        XCTAssertThrowsError(try gate.accept(request)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .replayedRequest)
        }
    }

    private func makeVerifier(identity: PeerSigningIdentity) -> PeerIdentityVerifier {
        PeerIdentityVerifier(peerPID: { _ in 42 }, signingIdentity: { _ in identity })
    }

    private func assertUnauthorized(identity: PeerSigningIdentity) {
        let verifier = makeVerifier(identity: identity)
        XCTAssertThrowsError(try verifier.verifyAcceptedSocket(7)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .unauthorized)
        }
    }
}
