import Foundation

@main
enum BarwardenAutoFillAgent {
    static func main() {
        guard let socketURL = try? AgentSocketLocation.socketURL() else { return }
        try? AgentServer(socketURL: socketURL).run()
    }
}
