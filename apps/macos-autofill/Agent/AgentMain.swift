import Foundation

@main
enum BarwardenAutoFillAgent {
    static func main() {
        guard let socketURL = try? AgentSocketLocation.socketURL() else { return }
        let projectionStore = ProjectionStore(
            allowedRootURL: socketURL.deletingLastPathComponent()
        )
        let handler = AgentConnectionHandler(projectionStore: projectionStore)
        try? AgentServer(socketURL: socketURL, handler: handler).run()
    }
}
