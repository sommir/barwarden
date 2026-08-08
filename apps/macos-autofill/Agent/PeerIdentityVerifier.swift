import Darwin
import Foundation
import Security

struct PeerSigningIdentity: Equatable {
    let teamIdentifier: String?
    let bundleIdentifier: String?
}

enum AuthorizedPeer: Equatable {
    case mainApplication
    case credentialProvider
}

struct PeerIdentityVerifier {
    static let requiredTeamIdentifier = "K7LY92JY96"

    private let peerPID: (Int32) -> pid_t?
    private let signingIdentity: (pid_t) throws -> PeerSigningIdentity

    init(
        peerPID: @escaping (Int32) -> pid_t? = Self.kernelPeerPID,
        signingIdentity: @escaping (pid_t) throws -> PeerSigningIdentity = Self.securitySigningIdentity
    ) {
        self.peerPID = peerPID
        self.signingIdentity = signingIdentity
    }

    func verifyAcceptedSocket(_ socket: Int32) throws -> AuthorizedPeer {
        guard let pid = peerPID(socket), pid > 0 else {
            throw AgentProtocolError.unauthorized
        }

        let identity: PeerSigningIdentity
        do {
            identity = try signingIdentity(pid)
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

    private static func kernelPeerPID(socket: Int32) -> pid_t? {
        var pid = pid_t.zero
        var length = socklen_t(MemoryLayout<pid_t>.size)
        guard getsockopt(socket, SOL_LOCAL, LOCAL_PEERPID, &pid, &length) == 0,
              length == MemoryLayout<pid_t>.size else {
            return nil
        }
        return pid
    }

    private static func securitySigningIdentity(pid: pid_t) throws -> PeerSigningIdentity {
        let attributes = [kSecGuestAttributePid as String: NSNumber(value: pid)] as CFDictionary
        var guest: SecCode?
        guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &guest) == errSecSuccess,
              let guest else {
            throw AgentProtocolError.unauthorized
        }
        guard SecCodeCheckValidity(guest, [], nil) == errSecSuccess else {
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
