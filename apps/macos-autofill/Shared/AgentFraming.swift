import Foundation

enum AgentFrame {
    static let maximumPayloadBytes = 65_536
    private static let headerBytes = MemoryLayout<UInt32>.size

    static func encode(_ payload: Data) throws -> Data {
        guard payload.count <= maximumPayloadBytes else {
            throw AgentProtocolError.messageTooLarge
        }

        var length = UInt32(payload.count).bigEndian
        var frame = withUnsafeBytes(of: &length) { Data($0) }
        frame.append(payload)
        return frame
    }

    static func encodeJSON<Value: Encodable>(_ value: Value) throws -> Data {
        try encode(JSONEncoder().encode(value))
    }

    static func payload(from frame: Data) throws -> Data {
        guard frame.count >= headerBytes else {
            throw AgentProtocolError.malformedMessage
        }

        let payloadLength = frame.prefix(headerBytes).reduce(UInt32.zero) { partial, byte in
            (partial << 8) | UInt32(byte)
        }
        guard payloadLength <= maximumPayloadBytes else {
            throw AgentProtocolError.messageTooLarge
        }
        guard frame.count == headerBytes + Int(payloadLength) else {
            throw AgentProtocolError.malformedMessage
        }

        return Data(frame.dropFirst(headerBytes))
    }

    static func decode<Value: Decodable>(_ frame: Data, as type: Value.Type) throws -> Value {
        do {
            return try JSONDecoder().decode(type, from: payload(from: frame))
        } catch let error as AgentProtocolError {
            throw error
        } catch {
            throw AgentProtocolError.malformedMessage
        }
    }
}
