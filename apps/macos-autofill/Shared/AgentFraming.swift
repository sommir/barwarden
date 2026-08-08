import Darwin
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

enum AgentSocketIO {
    private static let headerBytes = MemoryLayout<UInt32>.size

    static func applyDeadline(_ seconds: TimeInterval, to socket: Int32) throws {
        guard seconds > 0 else { throw AgentProtocolError.transport }
        let wholeSeconds = floor(seconds)
        var timeout = timeval(
            tv_sec: Int(wholeSeconds),
            tv_usec: Int32((seconds - wholeSeconds) * 1_000_000)
        )
        var noSignal = Int32(1)
        let length = socklen_t(MemoryLayout<timeval>.size)
        guard setsockopt(socket, SOL_SOCKET, SO_RCVTIMEO, &timeout, length) == 0,
              setsockopt(socket, SOL_SOCKET, SO_SNDTIMEO, &timeout, length) == 0,
              setsockopt(
                  socket,
                  SOL_SOCKET,
                  SO_NOSIGPIPE,
                  &noSignal,
                  socklen_t(MemoryLayout<Int32>.size)
              ) == 0 else {
            throw AgentProtocolError.transport
        }
    }

    static func writeFrame(_ frame: Data, to socket: Int32) throws {
        try writeAll(frame, to: socket)
    }

    static func writeAll(_ data: Data, to socket: Int32) throws {
        try data.withUnsafeBytes { rawBuffer in
            guard let baseAddress = rawBuffer.baseAddress else { return }
            var written = 0
            while written < rawBuffer.count {
                let result = Darwin.write(socket, baseAddress.advanced(by: written), rawBuffer.count - written)
                if result > 0 {
                    written += result
                } else if result < 0, errno == EINTR {
                    continue
                } else if result < 0, errno == EAGAIN || errno == EWOULDBLOCK {
                    throw AgentProtocolError.timeout
                } else {
                    throw AgentProtocolError.transport
                }
            }
        }
    }

    static func readJSON<Value: Decodable>(from socket: Int32, as type: Value.Type) throws -> Value {
        try AgentFrame.decode(readFrame(from: socket), as: type)
    }

    static func readFrame(from socket: Int32) throws -> Data {
        let header = try readExactly(headerBytes, from: socket)
        let payloadLength = header.reduce(UInt32.zero) { partial, byte in
            (partial << 8) | UInt32(byte)
        }
        guard payloadLength <= AgentFrame.maximumPayloadBytes else {
            throw AgentProtocolError.messageTooLarge
        }
        return header + (try readExactly(Int(payloadLength), from: socket))
    }

    private static func readExactly(_ byteCount: Int, from socket: Int32) throws -> Data {
        var data = Data(count: byteCount)
        var received = 0
        while received < byteCount {
            let result = data.withUnsafeMutableBytes { rawBuffer -> Int in
                guard let baseAddress = rawBuffer.baseAddress else { return 0 }
                return Darwin.read(socket, baseAddress.advanced(by: received), byteCount - received)
            }
            if result > 0 {
                received += result
            } else if result == 0 {
                throw AgentProtocolError.malformedMessage
            } else if errno == EINTR {
                continue
            } else if errno == EAGAIN || errno == EWOULDBLOCK {
                throw AgentProtocolError.timeout
            } else {
                throw AgentProtocolError.transport
            }
        }
        return data
    }
}
