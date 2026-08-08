import CryptoKit
import Foundation
import XCTest

final class ProjectionStoreTests: XCTestCase {
    private let key = Data((0..<32).map(UInt8.init))
    private let generation = UUID(uuidString: "00000000-0000-4000-8000-000000000004")!

    func testMainApplicationProvisionDecryptsAuthenticatedProjection() throws {
        let fixture = try Fixture()
        try fixture.writeProjection(accountID: "account-a", revision: 7, key: key)
        let store = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)

        try store.provision(
            ProjectionProvision(
                generation: generation,
                accountID: "account-a",
                vaultRevision: 7,
                key: key,
                leaseDurationSeconds: 30
            ),
            from: .mainApplication
        )

        let projection = try store.read(accountID: "account-a", generation: generation)
        XCTAssertEqual(projection.vaultRevision, 7)
        XCTAssertEqual(projection.logins.first?.username, "fixture-user@example.test")
    }

    func testCredentialProviderCannotProvisionKeyMaterial() throws {
        let fixture = try Fixture()
        let store = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)

        XCTAssertThrowsError(try store.provision(
            ProjectionProvision(
                generation: generation,
                accountID: "account-a",
                vaultRevision: 1,
                key: key,
                leaseDurationSeconds: 30
            ),
            from: .credentialProvider
        )) { error in
            XCTAssertEqual(error as? AgentProtocolError, .unauthorized)
        }
    }

    func testCorruptAuthenticationTagIsRejected() throws {
        let fixture = try Fixture()
        var bytes = try fixture.encryptedProjection(accountID: "account-a", revision: 1, key: key)
        bytes[bytes.index(before: bytes.endIndex)] ^= 0x80
        try bytes.write(to: fixture.url)
        let store = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)

        XCTAssertThrowsError(
            try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
        ) { error in
            XCTAssertEqual(error as? AgentProtocolError, .corruptProjection)
        }
    }

    func testStaleOnDiskRevisionIsRejected() throws {
        let fixture = try Fixture()
        try fixture.writeProjection(accountID: "account-a", revision: 8, key: key)
        let store = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)

        XCTAssertThrowsError(
            try store.provision(material(accountID: "account-a", revision: 9), from: .mainApplication)
        ) { error in
            XCTAssertEqual(error as? AgentProtocolError, .staleRevision)
        }
    }

    func testLockAccountSwitchTimeoutAndProcessRestartClearKeyAccess() throws {
        let fixture = try Fixture()
        try fixture.writeProjection(accountID: "account-a", revision: 1, key: key)
        let store = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)
        try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)

        store.lock()
        XCTAssertThrowsError(try store.read(accountID: "account-a", generation: generation))

        try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
        let switchedKey = Data(repeating: 9, count: 32)
        try fixture.writeProjection(accountID: "account-b", revision: 1, key: switchedKey)
        try store.provision(
            ProjectionProvision(
                generation: UUID(),
                accountID: "account-b",
                vaultRevision: 1,
                key: switchedKey,
                leaseDurationSeconds: 30
            ),
            from: .mainApplication
        )
        XCTAssertThrowsError(try store.read(accountID: "account-a", generation: generation))

        try fixture.writeProjection(accountID: "account-a", revision: 1, key: key)
        try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
        fixture.now += 31
        XCTAssertThrowsError(try store.read(accountID: "account-a", generation: generation)) { error in
            XCTAssertEqual(error as? AgentProtocolError, .locked)
        }

        let restarted = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)
        XCTAssertThrowsError(try restarted.read(accountID: "account-a", generation: generation))
    }

    func testLeaseRenewalExtendsOnlyMatchingGeneration() throws {
        let fixture = try Fixture()
        try fixture.writeProjection(accountID: "account-a", revision: 1, key: key)
        let store = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)
        try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
        fixture.now += 20

        try store.renewLease(
            generation: generation,
            accountID: "account-a",
            durationSeconds: 30,
            from: .mainApplication
        )
        fixture.now += 20

        XCTAssertNoThrow(try store.read(accountID: "account-a", generation: generation))
        XCTAssertThrowsError(try store.renewLease(
            generation: UUID(),
            accountID: "account-a",
            durationSeconds: 30,
            from: .mainApplication
        ))
    }

    func testZeroizingKeyOverwritesBytesWhenCleared() throws {
        var observed: [UInt8] = []
        let key = try ZeroizingKey(Data(repeating: 0x5a, count: 32)) { bytes in
            observed = Array(bytes)
        }

        key.clear()

        XCTAssertEqual(observed, [UInt8](repeating: 0, count: 32))
    }

    func testLeaseTimeoutProactivelyZeroizesKeyWithoutARead() throws {
        let fixture = try Fixture()
        try fixture.writeProjection(accountID: "account-a", revision: 1, key: key)
        let zeroized = expectation(description: "lease key zeroized")
        let store = ProjectionStore(
            projectionURL: fixture.url,
            onKeyZeroize: { zeroized.fulfill() }
        )
        try store.provision(
            ProjectionProvision(
                generation: generation,
                accountID: "account-a",
                vaultRevision: 1,
                key: key,
                leaseDurationSeconds: 0.03
            ),
            from: .mainApplication
        )

        wait(for: [zeroized], timeout: 0.20)
    }

    private func material(accountID: String, revision: UInt64) -> ProjectionProvision {
        ProjectionProvision(
            generation: generation,
            accountID: accountID,
            vaultRevision: revision,
            key: key,
            leaseDurationSeconds: 30
        )
    }
}

private final class Fixture {
    let directory: URL
    let url: URL
    var now: TimeInterval = 1_800_000_000
    var clock: () -> TimeInterval { { [unowned self] in self.now } }

    init() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("barwarden-projection-\(UUID().uuidString)", isDirectory: true)
        url = directory.appendingPathComponent("projection.bwaf")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    deinit {
        try? FileManager.default.removeItem(at: directory)
    }

    func writeProjection(accountID: String, revision: UInt64, key: Data) throws {
        try encryptedProjection(accountID: accountID, revision: revision, key: key).write(to: url)
    }

    func encryptedProjection(accountID: String, revision: UInt64, key: Data) throws -> Data {
        let projection = AutoFillProjection(
            version: 1,
            accountID: accountID,
            vaultRevision: revision,
            createdAt: "2026-08-08T08:00:00.000Z",
            logins: [AutoFillLogin(
                cipherID: "login-1",
                name: "Example",
                username: "fixture-user@example.test",
                password: "fixture-password-value",
                uris: [AutoFillURI(uri: "https://fixture.example.test", matchType: "default")],
                totp: "JBSWY3DPEHPK3PXP",
                favorite: true,
                reprompt: false
            )]
        )
        let plaintext = try JSONEncoder().encode(projection)
        let nonce = try ChaChaPoly.Nonce(data: Data(repeating: 7, count: 12))
        let header = AutoFillProjectionEnvelope.header(nonce: Data(nonce))
        let sealed = try ChaChaPoly.seal(
            plaintext,
            using: SymmetricKey(data: key),
            nonce: nonce,
            authenticating: header
        )
        return header + sealed.ciphertext + sealed.tag
    }
}
