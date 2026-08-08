import AuthenticationServices
import Foundation
import XCTest

final class CredentialIdentityPublisherTests: XCTestCase {
    func testSyncAtomicallyReplacesIdentitiesAndDeduplicatesServices() throws {
        let store = RecordingCredentialIdentityStore()
        let publisher = CredentialIdentityPublisher(store: store)
        let generation = UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!
        let first = CredentialIdentitySnapshot(
            accountID: "account-a",
            generation: generation,
            items: [
                item(
                    "cipher-a",
                    username: "person@example.test",
                    services: [
                        "HTTPS://EXAMPLE.TEST/login",
                        "https://example.test/login",
                        "example.test",
                        " example.test "
                    ]
                ),
                item("cipher-b", username: "second", services: ["other.example.test"])
            ]
        )

        XCTAssertNoThrow(try publisher.replaceAfterSyncAndWait(first))
        XCTAssertEqual(store.replacements.count, 1)
        XCTAssertEqual(store.replacements[0].count, 3)
        XCTAssertEqual(
            Set(store.replacements[0].map { $0.serviceIdentifier.identifier }),
            Set(["https://example.test/login", "example.test", "other.example.test"])
        )
        let firstCipherIdentities = store.replacements[0].filter { $0.user == "person@example.test" }
        XCTAssertEqual(firstCipherIdentities.count, 2)
        XCTAssertEqual(
            Set(firstCipherIdentities.compactMap(\.recordIdentifier)).count,
            2,
            "each published service must have a distinct opaque record identifier"
        )

        let second = CredentialIdentitySnapshot(
            accountID: "account-a",
            generation: generation,
            items: [item("cipher-c", username: "replacement", services: ["new.example.test"])]
        )
        XCTAssertNoThrow(try publisher.replaceAfterSyncAndWait(second))
        XCTAssertEqual(store.replacements.count, 2)
        XCTAssertEqual(store.replacements[1].map(\.user), ["replacement"])
    }

    func testAccountSwitchAndGenerationProduceOpaqueScopedRecordIdentifiers() throws {
        let store = RecordingCredentialIdentityStore()
        let publisher = CredentialIdentityPublisher(store: store)
        let generationA = UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!
        let generationB = UUID(uuidString: "11111111-2222-3333-4444-555555555555")!

        try publisher.replaceAfterSyncAndWait(CredentialIdentitySnapshot(
            accountID: "account-a",
            generation: generationA,
            items: [item("cipher-sensitive", username: "person", services: ["example.test"])]
        ))
        let first = try XCTUnwrap(store.replacements.last?.first?.recordIdentifier)
        try publisher.replaceAfterSyncAndWait(CredentialIdentitySnapshot(
            accountID: "account-b",
            generation: generationB,
            items: [item("cipher-sensitive", username: "person", services: ["example.test"])]
        ))
        let second = try XCTUnwrap(store.replacements.last?.first?.recordIdentifier)

        XCTAssertNotEqual(first, second)
        for recordIdentifier in [first, second] {
            XCTAssertTrue(recordIdentifier.hasPrefix("bwaf-id-v1."))
            XCTAssertFalse(recordIdentifier.contains("account"))
            XCTAssertFalse(recordIdentifier.contains("cipher"))
            XCTAssertFalse(recordIdentifier.contains(generationA.uuidString))
            XCTAssertFalse(recordIdentifier.contains(generationB.uuidString))
        }
        XCTAssertEqual(store.replacements.last?.count, 1, "account switch must replace, not merge")
    }

    func testLogoutRemovesAllWhileLockPreservesSafeMetadata() throws {
        let store = RecordingCredentialIdentityStore()
        let publisher = CredentialIdentityPublisher(store: store)
        try publisher.replaceAfterSyncAndWait(CredentialIdentitySnapshot(
            accountID: "account-a",
            generation: UUID(),
            items: [item("cipher-a", username: "person", services: ["example.test"])]
        ))

        publisher.preserveOnLock()
        XCTAssertEqual(store.replacements.count, 1)

        XCTAssertNoThrow(try publisher.removeForLogoutAndWait())
        XCTAssertEqual(store.replacements.count, 2)
        XCTAssertTrue(try XCTUnwrap(store.replacements.last).isEmpty)
    }

    func testPublishesOnlyActiveLoginUsernameAndRequiredServiceMetadata() throws {
        let store = RecordingCredentialIdentityStore()
        let publisher = CredentialIdentityPublisher(store: store)
        let snapshot = CredentialIdentitySnapshot(
            accountID: "account-a",
            generation: UUID(),
            items: [
                item("active", username: "username-only", services: ["https://example.test/login"]),
                item("archived", username: "archive", services: ["archive.test"], archived: true),
                item("deleted", username: "delete", services: ["delete.test"], deleted: true),
                item("card", username: "4111111111111111", services: ["card.test"], kind: .card),
                item("no-service", username: "ignored", services: [])
            ]
        )

        try publisher.replaceAfterSyncAndWait(snapshot)

        let identity = try XCTUnwrap(store.replacements.last?.only)
        XCTAssertEqual(identity.user, "username-only")
        XCTAssertEqual(identity.serviceIdentifier.identifier, "https://example.test/login")
        XCTAssertEqual(identity.serviceIdentifier.type, .URL)
        XCTAssertNotNil(identity.recordIdentifier)
    }

    func testDisabledIdentityStoreFailsClosedWithoutAttemptingReplace() {
        let store = RecordingCredentialIdentityStore(
            stateResult: .success(CredentialIdentityStoreState(
                isEnabled: false,
                supportsIncrementalUpdates: true
            ))
        )
        let publisher = CredentialIdentityPublisher(store: store)

        XCTAssertThrowsError(try publisher.replaceAfterSyncAndWait(CredentialIdentitySnapshot(
            accountID: "account-a",
            generation: UUID(),
            items: [item("cipher-a", username: "person", services: ["example.test"])]
        ))) {
            XCTAssertEqual($0 as? CredentialIdentityPublisherError, .storeDisabled)
        }
        XCTAssertTrue(store.replacements.isEmpty)
    }

    func testFullReplaceWorksWithoutIncrementalSupportAndPropagatesReplaceError() throws {
        let expected = IdentityStoreTestError.replaceFailed
        let store = RecordingCredentialIdentityStore(
            stateResult: .success(CredentialIdentityStoreState(
                isEnabled: true,
                supportsIncrementalUpdates: false
            )),
            replaceResult: .failure(expected)
        )
        let publisher = CredentialIdentityPublisher(store: store)

        XCTAssertThrowsError(try publisher.replaceAfterSyncAndWait(CredentialIdentitySnapshot(
            accountID: "account-a",
            generation: UUID(),
            items: [item("cipher-a", username: "person", services: ["example.test"])]
        ))) {
            XCTAssertEqual($0 as? IdentityStoreTestError, expected)
        }
        XCTAssertEqual(store.replacements.count, 1)
    }

    func testNewestLifecycleRequestWinsWhenOlderStateCallbackArrivesLate() throws {
        let store = ControllableCredentialIdentityStore()
        let publisher = CredentialIdentityPublisher(store: store)
        var oldResult: Result<Void, Error>?
        var logoutResult: Result<Void, Error>?
        let oldCompletion = expectation(description: "old request completion")
        let logoutCompletion = expectation(description: "logout completion")

        publisher.replaceAfterSync(CredentialIdentitySnapshot(
            accountID: "account-a",
            generation: UUID(),
            items: [item("old", username: "old-user", services: ["old.example.test"])]
        )) {
            oldResult = $0
            oldCompletion.fulfill()
        }
        publisher.removeForLogout {
            logoutResult = $0
            logoutCompletion.fulfill()
        }

        XCTAssertEqual(store.pendingStateCount, 1, "publisher must serialize store calls")
        store.completeNextState(enabled: true)
        XCTAssertEqual(store.pendingReplaceCount, 0, "superseded sync must never start a replace")
        wait(for: [oldCompletion], timeout: 1)
        XCTAssertThrowsError(try XCTUnwrap(oldResult).get()) {
            XCTAssertEqual($0 as? CredentialIdentityPublisherError, .superseded)
        }
        XCTAssertEqual(store.pendingStateCount, 1)

        store.completeNextState(enabled: true)
        XCTAssertEqual(store.pendingReplaceCount, 1)
        XCTAssertEqual(store.pendingReplacements.only?.count, 0)
        store.completeNextReplace()

        wait(for: [logoutCompletion], timeout: 1)
        XCTAssertNoThrow(try XCTUnwrap(logoutResult).get())
        XCTAssertEqual(store.committedReplacements.count, 1)
        XCTAssertTrue(store.committedReplacements[0].isEmpty)
    }

    func testAccountSwitchQueuedDuringReplaceCommitsLastAndCompletesInOrder() throws {
        let store = ControllableCredentialIdentityStore()
        let publisher = CredentialIdentityPublisher(store: store)
        var completions: [String] = []
        let oldCompletion = expectation(description: "old completion")
        let newCompletion = expectation(description: "new completion")

        publisher.replaceAfterSync(CredentialIdentitySnapshot(
            accountID: "account-a",
            generation: UUID(),
            items: [item("old", username: "old-user", services: ["old.example.test"])]
        )) { result in
            defer { oldCompletion.fulfill() }
            guard case let .failure(error) = result else {
                XCTFail("superseded request must fail")
                return
            }
            XCTAssertEqual(error as? CredentialIdentityPublisherError, .superseded)
            completions.append("old")
        }
        store.completeNextState(enabled: true)
        XCTAssertEqual(store.pendingReplaceCount, 1)

        publisher.replaceAfterSync(CredentialIdentitySnapshot(
            accountID: "account-b",
            generation: UUID(),
            items: [item("new", username: "new-user", services: ["new.example.test"])]
        )) { result in
            defer { newCompletion.fulfill() }
            guard case .success = result else {
                XCTFail("newest request must succeed")
                return
            }
            completions.append("new")
        }
        XCTAssertEqual(store.pendingStateCount, 0, "new request waits behind the in-flight replace")

        store.completeNextReplace()
        wait(for: [oldCompletion], timeout: 1)
        XCTAssertEqual(completions, ["old"])
        XCTAssertEqual(store.pendingStateCount, 1)
        store.completeNextState(enabled: true)
        store.completeNextReplace()

        wait(for: [newCompletion], timeout: 1)
        XCTAssertEqual(completions, ["old", "new"])
        XCTAssertEqual(store.committedReplacements.map { $0.map(\.user) }, [["old-user"], ["new-user"]])
        XCTAssertEqual(store.committedReplacements.last?.map(\.user), ["new-user"])
    }

    func testSupersededCompletionReentrancyIsAsynchronousOneShotAndNewestLogoutWins() throws {
        let store = ControllableCredentialIdentityStore()
        let publisher = CredentialIdentityPublisher(store: store)
        let callbacks = expectation(description: "all lifecycle callbacks")
        callbacks.expectedFulfillmentCount = 4
        callbacks.assertForOverFulfill = true
        let reentrantLogoutSubmitted = expectation(description: "reentrant logout submitted")
        let lock = NSLock()
        var counts: [String: Int] = [:]
        var outcomes: [String: String] = [:]

        func record(_ name: String, _ result: Result<Void, Error>) -> Int {
            let outcome: String
            switch result {
            case .success:
                outcome = "success"
            case let .failure(error as CredentialIdentityPublisherError):
                outcome = error == .superseded ? "superseded" : "publisher-error"
            case .failure:
                outcome = "other-error"
            }
            lock.lock()
            counts[name, default: 0] += 1
            outcomes[name] = outcome
            let count = counts[name]!
            lock.unlock()
            callbacks.fulfill()
            return count
        }

        publisher.replaceAfterSync(CredentialIdentitySnapshot(
            accountID: "account-a",
            generation: UUID(),
            items: [item("active", username: "active-user", services: ["active.example.test"])]
        )) { _ = record("active", $0) }
        store.completeNextState(enabled: true)
        XCTAssertEqual(store.pendingReplaceCount, 1)

        publisher.replaceAfterSync(CredentialIdentitySnapshot(
            accountID: "account-b",
            generation: UUID(),
            items: [item("pending", username: "pending-user", services: ["pending.example.test"])]
        )) { result in
            guard record("pending", result) == 1 else { return }
            publisher.removeForLogout { _ = record("logout", $0) }
            reentrantLogoutSubmitted.fulfill()
        }
        publisher.replaceAfterSync(CredentialIdentitySnapshot(
            accountID: "account-c",
            generation: UUID(),
            items: [item("newer", username: "newer-user", services: ["newer.example.test"])]
        )) { _ = record("newer", $0) }

        wait(for: [reentrantLogoutSubmitted], timeout: 1)
        store.completeNextReplace()
        XCTAssertEqual(store.pendingStateCount, 1)
        store.completeNextState(enabled: true)
        XCTAssertEqual(store.pendingReplacements.only?.count, 0, "reentrant logout must remain latest")
        if store.pendingReplaceCount == 1 {
            store.completeNextReplace()
        }
        wait(for: [callbacks], timeout: 1)

        lock.lock()
        let finalCounts = counts
        let finalOutcomes = outcomes
        lock.unlock()
        XCTAssertEqual(finalCounts, ["active": 1, "pending": 1, "newer": 1, "logout": 1])
        XCTAssertEqual(finalOutcomes, [
            "active": "superseded",
            "pending": "superseded",
            "newer": "superseded",
            "logout": "success"
        ])
        XCTAssertEqual(store.committedReplacements.map { $0.map(\.user) }, [["active-user"], []])
    }

    private func item(
        _ id: String,
        username: String,
        services: [String],
        archived: Bool = false,
        deleted: Bool = false,
        kind: CredentialIdentityItem.Kind = .login
    ) -> CredentialIdentityItem {
        CredentialIdentityItem(
            kind: kind,
            opaqueCipherID: id,
            username: username,
            serviceIdentifiers: services,
            isArchived: archived,
            isDeleted: deleted
        )
    }
}

private enum IdentityStoreTestError: Error, Equatable {
    case replaceFailed
    case callbackTimedOut
}

private final class RecordingCredentialIdentityStore: CredentialIdentityStoreWriting {
    private let stateResult: Result<CredentialIdentityStoreState, Error>
    private let replaceResult: Result<Void, Error>
    private(set) var replacements: [[ASPasswordCredentialIdentity]] = []

    init(
        stateResult: Result<CredentialIdentityStoreState, Error> = .success(
            CredentialIdentityStoreState(isEnabled: true, supportsIncrementalUpdates: false)
        ),
        replaceResult: Result<Void, Error> = .success(())
    ) {
        self.stateResult = stateResult
        self.replaceResult = replaceResult
    }

    func state(completion: @escaping (Result<CredentialIdentityStoreState, Error>) -> Void) {
        completion(stateResult)
    }

    func replace(
        _ identities: [ASPasswordCredentialIdentity],
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        replacements.append(identities)
        completion(replaceResult)
    }
}

private final class ControllableCredentialIdentityStore: CredentialIdentityStoreWriting {
    private var stateCallbacks: [(Result<CredentialIdentityStoreState, Error>) -> Void] = []
    private var replaceCallbacks: [(Result<Void, Error>) -> Void] = []
    private(set) var pendingReplacements: [[ASPasswordCredentialIdentity]] = []
    private(set) var committedReplacements: [[ASPasswordCredentialIdentity]] = []

    var pendingStateCount: Int { stateCallbacks.count }
    var pendingReplaceCount: Int { replaceCallbacks.count }

    func state(completion: @escaping (Result<CredentialIdentityStoreState, Error>) -> Void) {
        stateCallbacks.append(completion)
    }

    func replace(
        _ identities: [ASPasswordCredentialIdentity],
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        pendingReplacements.append(identities)
        replaceCallbacks.append(completion)
    }

    func completeNextState(enabled: Bool) {
        stateCallbacks.removeFirst()(.success(CredentialIdentityStoreState(
            isEnabled: enabled,
            supportsIncrementalUpdates: false
        )))
    }

    func completeNextReplace() {
        committedReplacements.append(pendingReplacements.removeFirst())
        replaceCallbacks.removeFirst()(.success(()))
    }
}

private extension CredentialIdentityPublisher {
    func replaceAfterSyncAndWait(_ snapshot: CredentialIdentitySnapshot) throws {
        var result: Result<Void, Error>?
        let completion = DispatchSemaphore(value: 0)
        replaceAfterSync(snapshot) {
            result = $0
            completion.signal()
        }
        guard completion.wait(timeout: .now() + 1) == .success else {
            throw IdentityStoreTestError.callbackTimedOut
        }
        try XCTUnwrap(result).get()
    }

    func removeForLogoutAndWait() throws {
        var result: Result<Void, Error>?
        let completion = DispatchSemaphore(value: 0)
        removeForLogout {
            result = $0
            completion.signal()
        }
        guard completion.wait(timeout: .now() + 1) == .success else {
            throw IdentityStoreTestError.callbackTimedOut
        }
        try XCTUnwrap(result).get()
    }
}

private extension Array {
    var only: Element? { count == 1 ? first : nil }
}
