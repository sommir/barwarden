import CryptoKit
import Foundation

enum TOTPGenerator {
    private enum Algorithm: String {
        case sha1 = "SHA1"
        case sha256 = "SHA256"
        case sha512 = "SHA512"
    }

    static func currentCode(seed: String, at date: Date = Date()) throws -> String {
        let parameters = try parse(seed)
        guard date.timeIntervalSince1970 >= 0 else { throw AgentProtocolError.malformedMessage }
        let counter = UInt64(floor(date.timeIntervalSince1970 / Double(parameters.period)))
        var bigEndianCounter = counter.bigEndian
        let message = withUnsafeBytes(of: &bigEndianCounter) { Data($0) }
        let key = SymmetricKey(data: parameters.key)
        let digest: Data
        switch parameters.algorithm {
        case .sha1:
            digest = Data(HMAC<Insecure.SHA1>.authenticationCode(for: message, using: key))
        case .sha256:
            digest = Data(HMAC<SHA256>.authenticationCode(for: message, using: key))
        case .sha512:
            digest = Data(HMAC<SHA512>.authenticationCode(for: message, using: key))
        }
        let offset = Int(digest[digest.count - 1] & 0x0f)
        guard offset + 3 < digest.count else { throw AgentProtocolError.malformedMessage }
        let value = (UInt32(digest[offset] & 0x7f) << 24)
            | (UInt32(digest[offset + 1]) << 16)
            | (UInt32(digest[offset + 2]) << 8)
            | UInt32(digest[offset + 3])
        let modulus = (0..<parameters.digits).reduce(UInt32(1)) { result, _ in result * 10 }
        return String(format: "%0*u", parameters.digits, value % modulus)
    }

    private static func parse(_ seed: String) throws -> (
        key: Data,
        algorithm: Algorithm,
        digits: Int,
        period: Int
    ) {
        let trimmed = seed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw AgentProtocolError.malformedMessage }
        var encodedSecret = trimmed
        var algorithm = Algorithm.sha1
        var digits = 6
        var period = 30
        if trimmed.lowercased().hasPrefix("otpauth://") {
            guard let components = URLComponents(string: trimmed),
                  components.scheme?.lowercased() == "otpauth",
                  components.host?.lowercased() == "totp" else {
                throw AgentProtocolError.malformedMessage
            }
            let values = Dictionary(
                (components.queryItems ?? []).map { ($0.name.lowercased(), $0.value ?? "") },
                uniquingKeysWith: { first, _ in first }
            )
            guard let secret = values["secret"], !secret.isEmpty else {
                throw AgentProtocolError.malformedMessage
            }
            encodedSecret = secret
            if let rawAlgorithm = values["algorithm"] {
                guard let parsed = Algorithm(rawValue: rawAlgorithm.uppercased()) else {
                    throw AgentProtocolError.malformedMessage
                }
                algorithm = parsed
            }
            if let rawDigits = values["digits"] {
                guard let parsed = Int(rawDigits) else { throw AgentProtocolError.malformedMessage }
                digits = parsed
            }
            if let rawPeriod = values["period"] {
                guard let parsed = Int(rawPeriod) else { throw AgentProtocolError.malformedMessage }
                period = parsed
            }
        }
        guard (6...8).contains(digits), (1...300).contains(period) else {
            throw AgentProtocolError.malformedMessage
        }
        return (try decodeBase32(encodedSecret), algorithm, digits, period)
    }

    private static func decodeBase32(_ encoded: String) throws -> Data {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        let values = Dictionary(uniqueKeysWithValues: alphabet.enumerated().map { ($0.element, $0.offset) })
        let compact = encoded.uppercased().filter { !$0.isWhitespace && $0 != "-" }
        let withoutPadding = compact.prefix { $0 != "=" }
        guard !withoutPadding.isEmpty,
              compact.dropFirst(withoutPadding.count).allSatisfy({ $0 == "=" }) else {
            throw AgentProtocolError.malformedMessage
        }
        var accumulator: UInt64 = 0
        var bitCount = 0
        var output = Data()
        for character in withoutPadding {
            guard let value = values[character] else { throw AgentProtocolError.malformedMessage }
            accumulator = (accumulator << 5) | UInt64(value)
            bitCount += 5
            while bitCount >= 8 {
                bitCount -= 8
                output.append(UInt8((accumulator >> UInt64(bitCount)) & 0xff))
            }
            if bitCount == 0 {
                accumulator = 0
            } else {
                accumulator &= (UInt64(1) << UInt64(bitCount)) - 1
            }
        }
        guard !output.isEmpty else { throw AgentProtocolError.malformedMessage }
        return output
    }
}
