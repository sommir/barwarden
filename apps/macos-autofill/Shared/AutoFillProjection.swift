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
    let lastUsedAt: String?

    private enum CodingKeys: String, CodingKey {
        case cipherID = "cipherId"
        case name
        case username
        case password
        case uris
        case totp
        case favorite
        case reprompt
        case lastUsedAt
    }

    init(
        cipherID: String,
        name: String,
        username: String,
        password: String,
        uris: [AutoFillURI],
        totp: String,
        favorite: Bool,
        reprompt: Bool,
        lastUsedAt: String? = nil
    ) {
        self.cipherID = cipherID
        self.name = name
        self.username = username
        self.password = password
        self.uris = uris
        self.totp = totp
        self.favorite = favorite
        self.reprompt = reprompt
        self.lastUsedAt = lastUsedAt
    }
}

struct AutoFillBinding: Codable, Equatable {
    let bundleID: String
    let cipherID: String

    private enum CodingKeys: String, CodingKey {
        case bundleID = "bundleId"
        case cipherID = "cipherId"
    }
}

struct AutoFillHistory: Codable, Equatable {
    let contextKey: String
    let cipherID: String
    let successfulSelectionCount: UInt
    let lastSelectedAt: String

    private enum CodingKeys: String, CodingKey {
        case contextKey
        case cipherID = "cipherId"
        case successfulSelectionCount
        case lastSelectedAt
    }
}

struct AutoFillProjection: Codable, Equatable {
    let version: UInt16
    let accountID: String
    let vaultRevision: UInt64
    let createdAt: String
    let logins: [AutoFillLogin]
    let bindings: [AutoFillBinding]
    let history: [AutoFillHistory]

    private enum CodingKeys: String, CodingKey {
        case version
        case accountID = "accountId"
        case vaultRevision
        case createdAt
        case logins
        case bindings
        case history
    }

    init(
        version: UInt16,
        accountID: String,
        vaultRevision: UInt64,
        createdAt: String,
        logins: [AutoFillLogin],
        bindings: [AutoFillBinding] = [],
        history: [AutoFillHistory] = []
    ) {
        self.version = version
        self.accountID = accountID
        self.vaultRevision = vaultRevision
        self.createdAt = createdAt
        self.logins = logins
        self.bindings = bindings
        self.history = history
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
