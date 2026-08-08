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

private extension CredentialIdentityPublisher {
    func replaceAfterSyncAndWait(_ snapshot: CredentialIdentitySnapshot) throws {
        var result: Result<Void, Error>?
        replaceAfterSync(snapshot) { result = $0 }
        try XCTUnwrap(result).get()
    }

    func removeForLogoutAndWait() throws {
        var result: Result<Void, Error>?
        removeForLogout { result = $0 }
        try XCTUnwrap(result).get()
    }
}

private extension Array {
    var only: Element? { count == 1 ? first : nil }
}
