import Darwin
import Foundation

@main
private enum NativeAutoFillIPCHarness {
    static func main() {
        guard CommandLine.arguments.count == 2 else {
            fail("usage: native-autofill-ipc-harness <success|unauthorized>")
        }

        let expectedResult = CommandLine.arguments[1]
        do {
            let response = try AgentClient().perform(.probe)
            guard expectedResult == "success",
                  response.status == .ok,
                  response.requestID != nil,
                  response.nonce.count == AgentClient.nonceBytes else {
                fail("unexpected successful response")
            }
        } catch let error as AgentProtocolError {
            guard expectedResult == "unauthorized", error == .unauthorized else {
                fail("unexpected fixed protocol error: \(error.rawValue)")
            }
        } catch {
            fail("unexpected transport result")
        }
    }

    private static func fail(_ message: String) -> Never {
        FileHandle.standardError.write(Data((message + "\n").utf8))
        exit(1)
    }
}
