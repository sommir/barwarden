import Darwin
import Foundation
import Security

struct PeerSigningIdentity: Equatable {
    let teamIdentifier: String?
    let bundleIdentifier: String?
}

struct PeerCredentials: Equatable {
    let pid: pid_t
    let auditToken: Data
    let auditTokenPID: pid_t
}

enum AuthorizedPeer: Equatable {
    case mainApplication
    case credentialProvider
}

struct PeerIdentityVerifier {
    static let requiredTeamIdentifier = "K7LY92JY96"

    private let peerCredentials: (Int32) -> PeerCredentials?
    private let signingIdentity: (Data) throws -> PeerSigningIdentity

    init(
        peerCredentials: @escaping (Int32) -> PeerCredentials? = Self.kernelPeerCredentials,
        signingIdentity: @escaping (Data) throws -> PeerSigningIdentity = Self.securitySigningIdentity
    ) {
        self.peerCredentials = peerCredentials
        self.signingIdentity = signingIdentity
    }

    func verifyAcceptedSocket(_ socket: Int32) throws -> AuthorizedPeer {
        guard let credentials = peerCredentials(socket),
              credentials.pid > 0,
              credentials.auditTokenPID == credentials.pid,
              credentials.auditToken.count == MemoryLayout<audit_token_t>.size else {
            throw AgentProtocolError.unauthorized
        }

        let identity: PeerSigningIdentity
        do {
            identity = try signingIdentity(credentials.auditToken)
        } catch {
            throw AgentProtocolError.unauthorized
        }

        guard identity.teamIdentifier == Self.requiredTeamIdentifier else {
            throw AgentProtocolError.unauthorized
        }

        switch identity.bundleIdentifier {
        case "com.sommir.barwarden":
            return .mainApplication
        case "com.sommir.barwarden.credential-provider":
            return .credentialProvider
        default:
            throw AgentProtocolError.unauthorized
        }
    }

    static func kernelPeerCredentials(socket: Int32) -> PeerCredentials? {
        var pid = pid_t.zero
        var pidLength = socklen_t(MemoryLayout<pid_t>.size)
        guard getsockopt(socket, SOL_LOCAL, LOCAL_PEERPID, &pid, &pidLength) == 0,
              pidLength == MemoryLayout<pid_t>.size else {
            return nil
        }

        var token = audit_token_t()
        var tokenLength = socklen_t(MemoryLayout<audit_token_t>.size)
        guard getsockopt(socket, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &tokenLength) == 0,
              tokenLength == MemoryLayout<audit_token_t>.size else {
            return nil
        }
        let tokenData = withUnsafeBytes(of: &token) { Data($0) }
        return PeerCredentials(
            pid: pid,
            auditToken: tokenData,
            auditTokenPID: audit_token_to_pid(token)
        )
    }

    private static func securitySigningIdentity(auditToken: Data) throws -> PeerSigningIdentity {
        let attributes = [kSecGuestAttributeAudit as String: auditToken as CFData] as CFDictionary
        var guest: SecCode?
        guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &guest) == errSecSuccess,
              let guest else {
            throw AgentProtocolError.unauthorized
        }
        var requirement: SecRequirement?
        let expression = "anchor apple generic and certificate leaf[subject.OU] = \"\(requiredTeamIdentifier)\" and (identifier \"com.sommir.barwarden\" or identifier \"com.sommir.barwarden.credential-provider\")"
        guard SecRequirementCreateWithString(expression as CFString, [], &requirement) == errSecSuccess,
              let requirement,
              SecCodeCheckValidity(guest, [], requirement) == errSecSuccess else {
            throw AgentProtocolError.unauthorized
        }

        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(guest, [], &staticCode) == errSecSuccess,
              let staticCode else {
            throw AgentProtocolError.unauthorized
        }

        var rawInformation: CFDictionary?
        let flags = SecCSFlags(rawValue: kSecCSSigningInformation)
        guard SecCodeCopySigningInformation(staticCode, flags, &rawInformation) == errSecSuccess,
              let information = rawInformation as? [String: Any] else {
            throw AgentProtocolError.unauthorized
        }

        return PeerSigningIdentity(
            teamIdentifier: information[kSecCodeInfoTeamIdentifier as String] as? String,
            bundleIdentifier: information[kSecCodeInfoIdentifier as String] as? String
        )
    }
}
