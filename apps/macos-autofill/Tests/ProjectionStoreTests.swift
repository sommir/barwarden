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
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fixture.url.path)
        let store = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)

        XCTAssertThrowsError(
            try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
        ) { error in
            XCTAssertEqual(error as? AgentProtocolError, .corruptProjection)
        }
    }

    func testAuthenticatedProjectionRejectsDuplicateAndDanglingMatchingMetadata() throws {
        let login = AutoFillLogin(
            cipherID: "login-1",
            name: "Example",
            username: "fixture-user@example.test",
            password: "fixture-password-value",
            uris: [AutoFillURI(uri: "https://fixture.example.test", matchType: .domain)],
            totp: "seed",
            favorite: false,
            reprompt: false
        )
        let projection = { (logins: [AutoFillLogin], bindings: [AutoFillBinding], history: [AutoFillHistory]) in
            AutoFillProjection(
                version: 1,
                accountID: "account-a",
                vaultRevision: 1,
                createdAt: "2026-08-08T08:00:00Z",
                logins: logins,
                bindings: bindings,
                history: history
            )
        }
        let history = AutoFillHistory(
            contextKey: "app:com.example.app",
            cipherID: "login-1",
            successfulSelectionCount: 1,
            lastSelectedAt: 1_786_233_600_000
        )
        let invalid = [
            projection([login, login], [], []),
            projection([login], [
                AutoFillBinding(bundleID: "COM.Example.App", cipherID: "login-1"),
                AutoFillBinding(bundleID: "com.example.app", cipherID: "login-1"),
            ], []),
            projection([login], [], [history, history]),
            projection([login], [
                AutoFillBinding(bundleID: "com.example.app", cipherID: "deleted"),
            ], []),
            projection([login], [], [AutoFillHistory(
                contextKey: "app:com.example.app",
                cipherID: "deleted",
                successfulSelectionCount: 1,
                lastSelectedAt: 1_786_233_600_000
            )]),
        ]

        for malformed in invalid {
            let fixture = try Fixture()
            try fixture.writeProjection(malformed, key: key)
            let store = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)
            XCTAssertThrowsError(
                try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
            ) { XCTAssertEqual($0 as? AgentProtocolError, .corruptProjection) }
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

    func testInstalledGenerationRejectsEqualOrOlderRevision() throws {
        let fixture = try Fixture()
        try fixture.writeProjection(accountID: "account-a", revision: 2, key: key)
        let store = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)
        try store.provision(material(accountID: "account-a", revision: 2), from: .mainApplication)

        XCTAssertThrowsError(
            try store.provision(material(accountID: "account-a", revision: 2), from: .mainApplication)
        ) { error in
            XCTAssertEqual(error as? AgentProtocolError, .staleRevision)
        }
        try fixture.writeProjection(accountID: "account-a", revision: 1, key: key)
        XCTAssertThrowsError(
            try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
        ) { error in
            XCTAssertEqual(error as? AgentProtocolError, .staleRevision)
        }
    }

    func testConcurrentConnectionsCannotInstallEqualOrOlderRevision() throws {
        let fixture = try Fixture()
        try fixture.writeProjection(accountID: "account-a", revision: 2, key: key)
        let store = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)
        try store.provision(material(accountID: "account-a", revision: 2), from: .mainApplication)
        let resultLock = NSLock()
        var staleRejections = 0

        DispatchQueue.concurrentPerform(iterations: 8) { index in
            do {
                try store.provision(
                    self.material(accountID: "account-a", revision: index.isMultiple(of: 2) ? 2 : 1),
                    from: .mainApplication
                )
            } catch AgentProtocolError.staleRevision {
                resultLock.lock()
                staleRejections += 1
                resultLock.unlock()
            } catch {}
        }

        XCTAssertEqual(staleRejections, 8)
        XCTAssertEqual(
            try store.read(accountID: "account-a", generation: generation).vaultRevision,
            2
        )
    }

    func testNewGenerationRequiresAnAcknowledgedLockAndRetiredGenerationCannotReturn() throws {
        let fixture = try Fixture()
        try fixture.writeProjection(accountID: "account-a", revision: 1, key: key)
        let store = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)
        try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
        let nextGeneration = UUID()

        XCTAssertThrowsError(try store.provision(
            ProjectionProvision(
                generation: nextGeneration,
                accountID: "account-a",
                vaultRevision: 1,
                key: key,
                leaseDurationSeconds: 30
            ),
            from: .mainApplication
        )) { error in
            XCTAssertEqual(error as? AgentProtocolError, .accountMismatch)
        }

        store.lock()
        try store.provision(
            ProjectionProvision(
                generation: nextGeneration,
                accountID: "account-a",
                vaultRevision: 1,
                key: key,
                leaseDurationSeconds: 30
            ),
            from: .mainApplication
        )
        store.lock()
        XCTAssertThrowsError(
            try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
        ) { error in
            XCTAssertEqual(error as? AgentProtocolError, .staleRevision)
        }
    }

    func testRetiredGenerationCapacityFailsClosedWithoutEvictingOldGenerations() throws {
        let fixture = try Fixture()
        let first = generation
        let second = UUID()
        let third = UUID()
        try fixture.writeProjection(accountID: "account-a", revision: 1, key: key)
        let store = ProjectionStore(
            projectionURL: fixture.url,
            clock: fixture.clock,
            retiredGenerationCapacity: 2
        )

        try store.provision(material(accountID: "account-a", revision: 1, generation: first), from: .mainApplication)
        store.lock()
        try store.provision(material(accountID: "account-a", revision: 1, generation: second), from: .mainApplication)
        store.lock()

        XCTAssertThrowsError(
            try store.provision(material(accountID: "account-a", revision: 1, generation: third), from: .mainApplication)
        ) { error in
            XCTAssertEqual(error as? AgentProtocolError, .requestCapacity)
        }
        XCTAssertThrowsError(
            try store.provision(material(accountID: "account-a", revision: 1, generation: first), from: .mainApplication)
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

        let secondGeneration = UUID()
        try store.provision(
            material(accountID: "account-a", revision: 1, generation: secondGeneration),
            from: .mainApplication
        )
        store.lock()
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

        store.lock()
        try fixture.writeProjection(accountID: "account-a", revision: 1, key: key)
        let timeoutGeneration = UUID()
        try store.provision(
            material(accountID: "account-a", revision: 1, generation: timeoutGeneration),
            from: .mainApplication
        )
        fixture.now += 31
        XCTAssertThrowsError(try store.read(accountID: "account-a", generation: timeoutGeneration)) { error in
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

    func testCandidateQueryIssueIsAtomicWithProvisionAndClearsTheStaleToken() throws {
        let fixture = try Fixture()
        try fixture.writeProjection(candidateProjection(revision: 1), key: key)
        let provisionFinished = expectation(description: "new projection provisioned")
        let stateLock = NSLock()
        var provisionError: Error?
        var fired = false
        var store: ProjectionStore!
        store = ProjectionStore(
            projectionURL: fixture.url,
            clock: fixture.clock,
            onCandidateQuerySnapshot: {
                guard !fired else { return }
                fired = true
                try! fixture.writeProjection(
                    self.candidateProjection(revision: 2, uri: "https://changed.example.test"),
                    key: self.key
                )
                DispatchQueue.global().async {
                    do {
                        try store.provision(
                            self.material(accountID: "account-a", revision: 2),
                            from: .mainApplication
                        )
                    } catch {
                        stateLock.lock()
                        provisionError = error
                        stateLock.unlock()
                    }
                    provisionFinished.fulfill()
                }
            }
        )
        try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
        let engine = MatchingEngine(presets: [], domainRules: .empty)

        let response = try store.queryCandidates(
            accountID: "account-a",
            generation: generation,
            context: candidateContext,
            matchingEngine: engine
        )
        wait(for: [provisionFinished], timeout: 2)
        stateLock.lock()
        let capturedError = provisionError
        stateLock.unlock()
        XCTAssertNil(capturedError)

        XCTAssertThrowsError(try store.withAuthorizedCandidate(
            SecretReleasePayload(
                generation: generation,
                accountID: "account-a",
                candidateID: "login-1",
                field: .password,
                contextToken: response.contextToken,
                mismatchConfirmed: false,
                reprompt: RepromptResultPayload(result: .notRequired, grant: nil)
            ),
            matchingEngine: engine,
            verifyRepromptGrant: { _, _, _, _, _ in false },
            operation: { _ in XCTFail("stale candidate operation must not execute") }
        )) { XCTAssertEqual($0 as? AgentProtocolError, .unauthorized) }
    }

    func testLockCannotInterleaveReleaseRevalidationConsumeAndOperation() throws {
        let fixture = try Fixture()
        try fixture.writeProjection(candidateProjection(revision: 1), key: key)
        let lockStarted = DispatchSemaphore(value: 0)
        let lockFinished = DispatchSemaphore(value: 0)
        var fired = false
        var store: ProjectionStore!
        store = ProjectionStore(
            projectionURL: fixture.url,
            clock: fixture.clock,
            onSecretReleaseSnapshot: {
                guard !fired else { return }
                fired = true
                DispatchQueue.global().async {
                    lockStarted.signal()
                    store.lock()
                    lockFinished.signal()
                }
                XCTAssertEqual(lockStarted.wait(timeout: .now() + 1), .success)
            }
        )
        try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
        let engine = MatchingEngine(presets: [], domainRules: .empty)
        let response = try store.queryCandidates(
            accountID: "account-a",
            generation: generation,
            context: candidateContext,
            matchingEngine: engine
        )
        var operationRan = false

        XCTAssertThrowsError(try store.withAuthorizedCandidate(
            SecretReleasePayload(
                generation: generation,
                accountID: "account-a",
                candidateID: "login-1",
                field: .password,
                contextToken: response.contextToken,
                mismatchConfirmed: false,
                reprompt: RepromptResultPayload(result: .notRequired, grant: nil)
            ),
            matchingEngine: engine,
            verifyRepromptGrant: { _, _, _, _, _ in false },
            operation: { _ in
                operationRan = true
                XCTAssertEqual(lockFinished.wait(timeout: .now()), .timedOut)
                throw AgentProtocolError.unavailable
            }
        )) { XCTAssertEqual($0 as? AgentProtocolError, .unavailable) }
        XCTAssertTrue(operationRan)
        XCTAssertEqual(lockFinished.wait(timeout: .now() + 1), .success)
        XCTAssertThrowsError(try store.read(accountID: "account-a", generation: generation)) {
            XCTAssertEqual($0 as? AgentProtocolError, .locked)
        }
    }

    func testReleaseMismatchPermanentlyConsumesTokenBeforeAnyProjectionCheck() throws {
        let baseProjection = candidateProjection(revision: 1)
        let policyChanges: [(projection: AutoFillProjection, error: AgentProtocolError)] = [
            (candidateProjection(revision: 2), .staleRevision),
            (candidateProjection(revision: 1, reprompt: true), .unauthorized),
            (candidateProjection(revision: 1, uri: "https://changed.example.test"), .unauthorized),
            (candidateProjection(revision: 1, password: "changed-secret"), .unauthorized),
            (candidateProjection(revision: 1, includeLogin: false), .unauthorized),
        ]
        for policyChange in policyChanges {
            let fixture = try Fixture()
            try fixture.writeProjection(baseProjection, key: key)
            let store = ProjectionStore(projectionURL: fixture.url, clock: fixture.clock)
            try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
            let engine = MatchingEngine(presets: [], domainRules: .empty)
            let response = try store.queryCandidates(
                accountID: "account-a",
                generation: generation,
                context: candidateContext,
                matchingEngine: engine
            )

            try fixture.writeProjection(policyChange.projection, key: key)
            var operationRan = false
            let request = SecretReleasePayload(
                generation: generation,
                accountID: "account-a",
                candidateID: "login-1",
                field: .password,
                contextToken: response.contextToken,
                mismatchConfirmed: false,
                reprompt: RepromptResultPayload(result: .notRequired, grant: nil)
            )
            XCTAssertThrowsError(try store.withAuthorizedCandidate(
                request,
                matchingEngine: engine,
                verifyRepromptGrant: { _, _, _, _, _ in false },
                operation: { _ in operationRan = true }
            )) { XCTAssertEqual($0 as? AgentProtocolError, policyChange.error) }
            XCTAssertFalse(operationRan)

            try fixture.writeProjection(baseProjection, key: key)
            XCTAssertThrowsError(try store.withAuthorizedCandidate(
                request,
                matchingEngine: engine,
                verifyRepromptGrant: { _, _, _, _, _ in false },
                operation: { _ in operationRan = true }
            )) { XCTAssertEqual($0 as? AgentProtocolError, .unauthorized) }
            XCTAssertFalse(operationRan)
        }
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

    func testRejectsRootSymlinkAndInsecureRootMode() throws {
        let fixture = try Fixture()
        try fixture.writeProjection(accountID: "account-a", revision: 1, key: key)
        let link = fixture.directory.deletingLastPathComponent()
            .appendingPathComponent("projection-root-link-\(UUID().uuidString)")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: fixture.directory)
        defer { try? FileManager.default.removeItem(at: link) }
        let linkedStore = ProjectionStore(
            allowedRootURL: link
        )

        XCTAssertThrowsError(try linkedStore.provision(
            ProjectionProvision(
                generation: generation,
                accountID: "account-a",
                vaultRevision: 1,
                key: key,
                leaseDurationSeconds: 30,
                projectionURL: link.appendingPathComponent("projection.bwaf")
            ),
            from: .mainApplication
        ))

        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755],
            ofItemAtPath: fixture.directory.path
        )
        let insecureStore = ProjectionStore(projectionURL: fixture.url)
        XCTAssertThrowsError(
            try insecureStore.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
        )
    }

    func testRejectsProjectionSymlinkHardlinkDirectoryAndInsecureMode() throws {
        for kind in ["symlink", "hardlink", "directory", "mode"] {
            let fixture = try Fixture()
            let outside = fixture.directory.deletingLastPathComponent()
                .appendingPathComponent("projection-outside-\(UUID().uuidString)")
            try Data("outside".utf8).write(to: outside)
            defer { try? FileManager.default.removeItem(at: outside) }
            switch kind {
            case "symlink":
                try FileManager.default.createSymbolicLink(at: fixture.url, withDestinationURL: outside)
            case "hardlink":
                try FileManager.default.linkItem(at: outside, to: fixture.url)
            case "directory":
                try FileManager.default.createDirectory(at: fixture.url, withIntermediateDirectories: false)
            default:
                try fixture.writeProjection(accountID: "account-a", revision: 1, key: key)
                try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: fixture.url.path)
            }
            let store = ProjectionStore(projectionURL: fixture.url)
            XCTAssertThrowsError(
                try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication),
                "kind=\(kind)"
            )
        }
    }

    func testPathSwapAfterVerifiedOpenUsesTheOriginalFileDescriptor() throws {
        let fixture = try Fixture()
        try fixture.writeProjection(accountID: "account-a", revision: 1, key: key)
        let moved = fixture.directory.appendingPathComponent("moved.bwaf")
        let outside = fixture.directory.appendingPathComponent("outside.bwaf")
        try Data("not an envelope".utf8).write(to: outside)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: outside.path)
        var swapped = false
        let store = ProjectionStore(
            projectionURL: fixture.url,
            onVerifiedFileOpen: {
                guard !swapped else { return }
                swapped = true
                try! FileManager.default.moveItem(at: fixture.url, to: moved)
                try! FileManager.default.moveItem(at: outside, to: fixture.url)
            }
        )

        XCTAssertNoThrow(
            try store.provision(material(accountID: "account-a", revision: 1), from: .mainApplication)
        )
    }

    func testOwnerAndModeValidatorRejectsForeignOrInsecureMetadata() {
        XCTAssertFalse(ProjectionStore.isSecureFileStat(mode: S_IFREG | 0o600, owner: 9, links: 1, expectedOwner: 10))
        XCTAssertFalse(ProjectionStore.isSecureFileStat(mode: S_IFREG | 0o644, owner: 10, links: 1, expectedOwner: 10))
        XCTAssertFalse(ProjectionStore.isSecureFileStat(mode: S_IFREG | 0o600, owner: 10, links: 2, expectedOwner: 10))
    }

    private func material(
        accountID: String,
        revision: UInt64,
        generation: UUID? = nil
    ) -> ProjectionProvision {
        ProjectionProvision(
            generation: generation ?? self.generation,
            accountID: accountID,
            vaultRevision: revision,
            key: key,
            leaseDurationSeconds: 30
        )
    }

    private var candidateContext: NativeAutoFillContext {
        NativeAutoFillContext(
            bundleID: "com.example.App",
            appName: "Example",
            serviceIdentifiers: ["https://fixture.example.test"],
            query: ""
        )
    }

    private func candidateProjection(
        revision: UInt64,
        uri: String = "https://fixture.example.test",
        password: String = "fixture-password-value",
        reprompt: Bool = false,
        includeLogin: Bool = true
    ) -> AutoFillProjection {
        AutoFillProjection(
            version: 1,
            accountID: "account-a",
            vaultRevision: revision,
            createdAt: "2026-08-08T08:00:00Z",
            logins: includeLogin ? [AutoFillLogin(
                cipherID: "login-1",
                name: "Example",
                username: "fixture-user@example.test",
                password: password,
                uris: [AutoFillURI(uri: uri, matchType: .exact)],
                totp: "seed",
                favorite: false,
                reprompt: reprompt
            )] : []
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
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
    }

    deinit {
        try? FileManager.default.removeItem(at: directory)
    }

    func writeProjection(accountID: String, revision: UInt64, key: Data) throws {
        try encryptedProjection(accountID: accountID, revision: revision, key: key).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    func writeProjection(_ projection: AutoFillProjection, key: Data) throws {
        try encryptedProjection(projection, key: key).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
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
                uris: [AutoFillURI(uri: "https://fixture.example.test", matchType: .domain)],
                totp: "JBSWY3DPEHPK3PXP",
                favorite: true,
                reprompt: false
            )]
        )
        return try encryptedProjection(projection, key: key)
    }

    private func encryptedProjection(_ projection: AutoFillProjection, key: Data) throws -> Data {
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
