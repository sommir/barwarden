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
            peerCredentials: { _ in
                PeerCredentials(
                    pid: 0,
                    auditToken: Data(repeating: 7, count: MemoryLayout<audit_token_t>.size),
                    auditTokenPID: 0
                )
            },
            signingIdentity: { _ in XCTFail("signing lookup must not run without peer credentials"); return .init(teamIdentifier: nil, bundleIdentifier: nil) }
        )

        XCTAssertThrowsError(try verifier.verifyAcceptedSocket(7)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .unauthorized)
        }
    }

    func testVerifierUsesKernelPIDRatherThanCallerClaimedIdentity() throws {
        let auditToken = Data(repeating: 0xA5, count: MemoryLayout<audit_token_t>.size)
        var inspectedAuditToken: Data?
        let verifier = PeerIdentityVerifier(
            peerCredentials: { _ in
                PeerCredentials(pid: 4_242, auditToken: auditToken, auditTokenPID: 4_242)
            },
            signingIdentity: { token in
                inspectedAuditToken = token
                return .init(
                    teamIdentifier: self.teamID,
                    bundleIdentifier: "com.sommir.barwarden"
                )
            }
        )
        let requestWithForgedClaims = Data(#"{"version":1,"request_id":"00000000-0000-4000-8000-000000000001","operation":"probe","nonce":[1,2,3],"pid":1,"team_id":"ATTACKER01","bundle_id":"evil.example"}"#.utf8)

        _ = try AgentFrame.decode(try AgentFrame.encode(requestWithForgedClaims), as: AgentRequest.self)
        XCTAssertEqual(try verifier.verifyAcceptedSocket(7), .mainApplication)
        XCTAssertEqual(inspectedAuditToken, auditToken)
    }

    func testRejectsMissingAuditToken() {
        let verifier = PeerIdentityVerifier(
            peerCredentials: { _ in
                PeerCredentials(pid: 42, auditToken: Data(), auditTokenPID: 42)
            },
            signingIdentity: { _ in XCTFail("Security lookup must not run without an audit token"); return .init(teamIdentifier: nil, bundleIdentifier: nil) }
        )

        XCTAssertThrowsError(try verifier.verifyAcceptedSocket(7)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .unauthorized)
        }
    }

    func testRejectsLocalPeerPIDAndAuditTokenPIDMismatch() {
        let verifier = PeerIdentityVerifier(
            peerCredentials: { _ in
                PeerCredentials(
                    pid: 4_242,
                    auditToken: Data(repeating: 1, count: MemoryLayout<audit_token_t>.size),
                    auditTokenPID: 4_243
                )
            },
            signingIdentity: { _ in XCTFail("Security lookup must not run for mismatched credentials"); return .init(teamIdentifier: nil, bundleIdentifier: nil) }
        )

        XCTAssertThrowsError(try verifier.verifyAcceptedSocket(7)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .unauthorized)
        }
    }

    func testSigningLookupIsBoundToAuditTokenRatherThanReusablePID() throws {
        let trustedToken = Data(repeating: 0x11, count: MemoryLayout<audit_token_t>.size)
        let reusedPIDToken = Data(repeating: 0x22, count: MemoryLayout<audit_token_t>.size)
        var selectedToken = trustedToken
        let verifier = PeerIdentityVerifier(
            peerCredentials: { _ in
                PeerCredentials(pid: 900, auditToken: selectedToken, auditTokenPID: 900)
            },
            signingIdentity: { token in
                token == trustedToken
                    ? .init(teamIdentifier: self.teamID, bundleIdentifier: "com.sommir.barwarden")
                    : .init(teamIdentifier: "ATTACKER01", bundleIdentifier: "com.sommir.barwarden")
            }
        )

        XCTAssertEqual(try verifier.verifyAcceptedSocket(7), .mainApplication)
        selectedToken = reusedPIDToken
        XCTAssertThrowsError(try verifier.verifyAcceptedSocket(7)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .unauthorized)
        }
    }

    func testKernelPeerCredentialsUseFullAuditTokenBuffer() throws {
        let sockets = try SocketPair()
        let credentials = PeerIdentityVerifier.kernelPeerCredentials(socket: sockets.server)

        XCTAssertEqual(credentials?.pid, getpid())
        XCTAssertEqual(credentials?.auditTokenPID, getpid())
        XCTAssertEqual(credentials?.auditToken.count, MemoryLayout<audit_token_t>.size)
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

    func testReplayCacheFailsClosedAtCapacityAndRetainsPriorIDs() throws {
        let gate = AgentRequestGate(maximumRememberedRequestIDs: 2)
        let first = request(id: UUID())
        let second = request(id: UUID())

        try gate.accept(first)
        try gate.accept(second)
        XCTAssertThrowsError(try gate.accept(request(id: UUID()))) { error in
            XCTAssertEqual(error as? AgentProtocolError, .requestCapacity)
        }
        XCTAssertThrowsError(try gate.accept(first)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .replayedRequest)
        }
    }

    func testReplayCapacityErrorUsesFixedSanitizedWireCode() throws {
        let encoded = try JSONEncoder().encode(AgentResponse.failure(.requestCapacity))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])

        XCTAssertEqual(json["error"] as? String, "request_capacity")
    }

    private func makeVerifier(identity: PeerSigningIdentity) -> PeerIdentityVerifier {
        PeerIdentityVerifier(
            peerCredentials: { _ in
                PeerCredentials(
                    pid: 42,
                    auditToken: Data(repeating: 7, count: MemoryLayout<audit_token_t>.size),
                    auditTokenPID: 42
                )
            },
            signingIdentity: { _ in identity }
        )
    }

    private func assertUnauthorized(identity: PeerSigningIdentity) {
        let verifier = makeVerifier(identity: identity)
        XCTAssertThrowsError(try verifier.verifyAcceptedSocket(7)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .unauthorized)
        }
    }

    private func request(id: UUID) -> AgentRequest {
        AgentRequest(
            version: AgentProtocol.currentVersion,
            requestID: id,
            operation: .probe,
            nonce: Data([1])
        )
    }
}
