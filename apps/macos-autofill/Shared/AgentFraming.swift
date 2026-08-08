import Darwin
import Dispatch
import Foundation

struct AgentDeadline {
    private let endNanoseconds: UInt64

    init(timeout: TimeInterval) throws {
        guard timeout.isFinite,
              timeout > 0,
              timeout <= Double(UInt64.max) / 1_000_000_000 else {
            throw AgentProtocolError.transport
        }
        let interval = UInt64(timeout * 1_000_000_000)
        let result = DispatchTime.now().uptimeNanoseconds.addingReportingOverflow(interval)
        guard !result.overflow else { throw AgentProtocolError.transport }
        endNanoseconds = result.partialValue
    }

    func remainingPollMilliseconds() throws -> Int32 {
        let now = DispatchTime.now().uptimeNanoseconds
        guard now < endNanoseconds else { throw AgentProtocolError.timeout }
        let remainingNanoseconds = endNanoseconds - now
        let roundedUpMilliseconds = (remainingNanoseconds + 999_999) / 1_000_000
        return Int32(min(roundedUpMilliseconds, UInt64(Int32.max)))
    }
}

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

    static func encodeJSON<Value: Encodable>(
        _ value: Value,
        onJSONCleared: ((Data) -> Void)? = nil
    ) throws -> Data {
        var payload = try JSONEncoder().encode(value)
        defer {
            payload.resetBytes(in: payload.indices)
            onJSONCleared?(payload)
        }
        return try encode(payload)
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

    static func decode<Value: Decodable>(
        _ frame: Data,
        as type: Value.Type,
        onPayloadCleared: ((Data) -> Void)? = nil
    ) throws -> Value {
        do {
            var payload = try payload(from: frame)
            defer {
                payload.resetBytes(in: payload.indices)
                onPayloadCleared?(payload)
            }
            return try JSONDecoder().decode(type, from: payload)
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

    static func readJSON<Value: Decodable>(
        from socket: Int32,
        as type: Value.Type,
        deadline: AgentDeadline? = nil,
        onFrameCleared: ((Data) -> Void)? = nil,
        onPayloadCleared: ((Data) -> Void)? = nil,
        onReadTemporaryCleared: ((Data) -> Void)? = nil
    ) throws -> Value {
        var frame = try readFrame(
            from: socket,
            deadline: deadline,
            onTemporaryCleared: onReadTemporaryCleared
        )
        defer {
            frame.resetBytes(in: frame.indices)
            onFrameCleared?(frame)
        }
        return try AgentFrame.decode(frame, as: type, onPayloadCleared: onPayloadCleared)
    }

    static func readFrame(
        from socket: Int32,
        deadline: AgentDeadline? = nil,
        onTemporaryCleared: ((Data) -> Void)? = nil
    ) throws -> Data {
        var header = try readExactly(
            headerBytes,
            from: socket,
            deadline: deadline,
            onBufferCleared: onTemporaryCleared
        )
        defer {
            header.resetBytes(in: header.indices)
            onTemporaryCleared?(header)
        }
        let payloadLength = header.reduce(UInt32.zero) { partial, byte in
            (partial << 8) | UInt32(byte)
        }
        guard payloadLength <= AgentFrame.maximumPayloadBytes else {
            throw AgentProtocolError.messageTooLarge
        }
        var payload = try readExactly(
            Int(payloadLength),
            from: socket,
            deadline: deadline,
            onBufferCleared: onTemporaryCleared
        )
        defer {
            payload.resetBytes(in: payload.indices)
            onTemporaryCleared?(payload)
        }
        var frame = Data(capacity: headerBytes + payload.count)
        frame.append(header)
        frame.append(payload)
        return frame
    }

    private static func readExactly(
        _ byteCount: Int,
        from socket: Int32,
        deadline: AgentDeadline?,
        onBufferCleared: ((Data) -> Void)?
    ) throws -> Data {
        var data = Data(count: byteCount)
        defer {
            data.resetBytes(in: data.indices)
            onBufferCleared?(data)
        }
        var received = 0
        while received < byteCount {
            if let deadline {
                try waitUntilReadable(socket, deadline: deadline)
            }
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

    private static func waitUntilReadable(_ socket: Int32, deadline: AgentDeadline) throws {
        while true {
            var descriptor = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
            let result = Darwin.poll(&descriptor, 1, try deadline.remainingPollMilliseconds())
            if result > 0 { return }
            if result == 0 { throw AgentProtocolError.timeout }
            if errno != EINTR { throw AgentProtocolError.transport }
        }
    }
}
