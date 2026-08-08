import AppKit
import AuthenticationServices

@objc(CredentialProviderViewController)
final class CredentialProviderViewController: ASCredentialProviderViewController {
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        let label = NSTextField(labelWithString: "Barwarden AutoFill")
        label.alignment = .center

        let container = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 180))
        label.frame = container.bounds.insetBy(dx: 24, dy: 64)
        container.addSubview(label)
        view = container
    }
}
