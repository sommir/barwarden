import CryptoKit
import Foundation

struct AutoFillURI: Codable, Equatable {
    let uri: String
    let matchType: String

    private enum CodingKeys: String, CodingKey {
        case uri
        case matchType
    }
}

struct AutoFillLogin: Codable, Equatable {
    let cipherID: String
    let name: String
    let username: String
    let password: String
    let uris: [AutoFillURI]
    let totp: String
    let favorite: Bool
    let reprompt: Bool

    private enum CodingKeys: String, CodingKey {
        case cipherID = "cipherId"
        case name
        case username
        case password
        case uris
        case totp
        case favorite
        case reprompt
    }
}

struct AutoFillProjection: Codable, Equatable {
    let version: UInt16
    let accountID: String
    let vaultRevision: UInt64
    let createdAt: String
    let logins: [AutoFillLogin]

    private enum CodingKeys: String, CodingKey {
        case version
        case accountID = "accountId"
        case vaultRevision
        case createdAt
        case logins
    }
}

enum AutoFillProjectionEnvelope {
    static let magic = Data("BWAFPRJ1".utf8)
    static let formatVersion: UInt16 = 1
    static let nonceBytes = 12
    static let tagBytes = 16
    static let headerBytes = magic.count + MemoryLayout<UInt16>.size + nonceBytes

    static func header(nonce: Data) -> Data {
        precondition(nonce.count == nonceBytes)
        var result = magic
        result.append(UInt8(formatVersion >> 8))
        result.append(UInt8(formatVersion & 0xff))
        result.append(nonce)
        return result
    }

    static func open(_ envelope: Data, using key: ZeroizingKey) throws -> AutoFillProjection {
        guard envelope.count > headerBytes + tagBytes,
              envelope.prefix(magic.count) == magic,
              envelope[magic.count] == UInt8(formatVersion >> 8),
              envelope[magic.count + 1] == UInt8(formatVersion & 0xff) else {
            throw AgentProtocolError.corruptProjection
        }
        let header = envelope.prefix(headerBytes)
        let nonceData = envelope[(magic.count + 2)..<headerBytes]
        let ciphertext = envelope[headerBytes..<(envelope.count - tagBytes)]
        let tag = envelope.suffix(tagBytes)
        do {
            return try key.withSymmetricKey { symmetricKey in
                let sealed = try ChaChaPoly.SealedBox(
                    nonce: ChaChaPoly.Nonce(data: nonceData),
                    ciphertext: ciphertext,
                    tag: tag
                )
                var plaintext = try ChaChaPoly.open(
                    sealed,
                    using: symmetricKey,
                    authenticating: header
                )
                defer { plaintext.resetBytes(in: plaintext.indices) }
                return try JSONDecoder().decode(AutoFillProjection.self, from: plaintext)
            }
        } catch {
            throw AgentProtocolError.corruptProjection
        }
    }
}
