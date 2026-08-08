import Foundation
import XCTest

final class CredentialProviderTests: XCTestCase {
    func testLockedAgentFailsClosedBeforeReturningCandidates() {
        let coordinator = CredentialProviderCoordinator(agent: StubCredentialProviderAgent(error: .locked))

        XCTAssertThrowsError(try coordinator.load(serviceIdentifiers: ["example.test"], query: "")) {
            XCTAssertEqual($0 as? SystemAutoFillError, .locked)
        }
    }

    func testRepromptRequiredNeverReturnsPasswordWithoutAgentGrant() throws {
        let agent = StubCredentialProviderAgent(releaseError: .unauthorized)
        let coordinator = CredentialProviderCoordinator(agent: agent)
        let snapshot = try coordinator.load(serviceIdentifiers: ["example.test"], query: "")

        XCTAssertThrowsError(try coordinator.complete(
            candidateID: "cipher-a",
            from: snapshot,
            field: .password,
            mismatchConfirmed: false
        )) { XCTAssertEqual($0 as? SystemAutoFillError, .authorizationRequired) }
        XCTAssertEqual(agent.releaseRequests.count, 1)
        XCTAssertFalse(SystemAutoFillError.authorizationRequired.recoveryMessage.localizedCaseInsensitiveContains("approve"))
        XCTAssertTrue(SystemAutoFillError.authorizationRequired.recoveryMessage.contains("in-app AutoFill"))
    }

    func testStaleGenerationFailsClosedAndDoesNotReuseSelection() throws {
        let agent = StubCredentialProviderAgent(releaseError: .accountMismatch)
        let coordinator = CredentialProviderCoordinator(agent: agent)
        let snapshot = try coordinator.load(serviceIdentifiers: ["example.test"], query: "")

        XCTAssertThrowsError(try coordinator.complete(
            candidateID: "cipher-a",
            from: snapshot,
            field: .password,
            mismatchConfirmed: false
        )) { XCTAssertEqual($0 as? SystemAutoFillError, .staleRequest) }
    }

    func testWrongServiceIdentityCannotReleaseEvenWhenOpaqueRecordMatches() {
        let agent = StubCredentialProviderAgent(candidates: [Self.candidate(group: .other, mismatch: true)])
        let coordinator = CredentialProviderCoordinator(agent: agent)
        let recordIdentifier = CredentialIdentityRecordIdentifier.make(
            accountID: agent.session.accountID,
            generation: agent.session.generation,
            opaqueCipherID: "cipher-a"
        )

        XCTAssertThrowsError(try coordinator.completePasswordIdentity(
            recordIdentifier: recordIdentifier,
            serviceIdentifier: "evil.example.test",
            username: "person@example.test"
        )) { XCTAssertEqual($0 as? SystemAutoFillError, .serviceMismatch) }
        XCTAssertTrue(agent.releaseRequests.isEmpty)
    }

    func testExplicitAllLoginSelectionRequiresAndCarriesMismatchConfirmation() throws {
        let agent = StubCredentialProviderAgent(candidates: [Self.candidate(group: .other, mismatch: true)])
        let coordinator = CredentialProviderCoordinator(agent: agent)
        let snapshot = try coordinator.load(serviceIdentifiers: ["example.test"], query: "work")
        let completion = try coordinator.complete(
            candidateID: "cipher-a",
            from: snapshot,
            field: .password,
            mismatchConfirmed: true
        )
        defer { completion.clear() }

        XCTAssertEqual(agent.queries.only?.context.query, "work")
        XCTAssertEqual(agent.releaseRequests.only?.mismatchConfirmed, true)
        XCTAssertEqual(completion.type, .password)
        XCTAssertEqual(completion.username, "person@example.test")
        XCTAssertEqual(try completion.secretString(), "agent-password")
    }

    func testCancelledRequestCannotReleaseASecret() throws {
        let agent = StubCredentialProviderAgent()
        let coordinator = CredentialProviderCoordinator(agent: agent)
        let snapshot = try coordinator.load(serviceIdentifiers: ["example.test"], query: "")
        coordinator.cancel()

        XCTAssertThrowsError(try coordinator.complete(
            candidateID: "cipher-a",
            from: snapshot,
            field: .password,
            mismatchConfirmed: false
        )) { XCTAssertEqual($0 as? SystemAutoFillError, .cancelled) }
        XCTAssertTrue(agent.releaseRequests.isEmpty)
    }

    func testAgentUnavailableIsReportedWithoutFallbackRelease() {
        let agent = StubCredentialProviderAgent(error: .unavailable)
        let coordinator = CredentialProviderCoordinator(agent: agent)

        XCTAssertThrowsError(try coordinator.load(serviceIdentifiers: ["example.test"], query: "")) {
            XCTAssertEqual($0 as? SystemAutoFillError, .agentUnavailable)
        }
        XCTAssertTrue(agent.releaseRequests.isEmpty)
    }

    func testSuccessfulPasswordCompletionUsesCandidateUsernameAndClearsOwnedBuffer() throws {
        let agent = StubCredentialProviderAgent()
        let coordinator = CredentialProviderCoordinator(agent: agent)
        let snapshot = try coordinator.load(serviceIdentifiers: ["example.test"], query: "")
        let completion = try coordinator.complete(
            candidateID: "cipher-a",
            from: snapshot,
            field: .password,
            mismatchConfirmed: false
        )

        XCTAssertEqual(completion.username, "person@example.test")
        XCTAssertEqual(try completion.secretString(), "agent-password")
        completion.clear()
        XCTAssertTrue(completion.isCleared)
        XCTAssertThrowsError(try completion.secretString())
    }

    func testMacOS13And14TOTPUsesStableUnsupportedOutcomeAndNoAgentRequest() throws {
        let agent = StubCredentialProviderAgent()
        let coordinator = CredentialProviderCoordinator(agent: agent)
        let snapshot = try coordinator.load(serviceIdentifiers: ["example.test"], query: "")

        XCTAssertThrowsError(try coordinator.complete(
            candidateID: "cipher-a",
            from: snapshot,
            field: .totp,
            mismatchConfirmed: false,
            supportsSystemTOTP: false
        )) { error in
            XCTAssertEqual(error as? SystemAutoFillError, .unsupportedSystemTOTP)
            XCTAssertEqual((error as? SystemAutoFillError)?.rawValue, "unsupported-system-totp")
            XCTAssertTrue((error as? SystemAutoFillError)?.recoveryMessage.contains("focused-field") == true)
        }
        XCTAssertTrue(agent.releaseRequests.isEmpty)
    }

    func testMacOS15TOTPRequestsOnlyCurrentCodeFromAgent() throws {
        let agent = StubCredentialProviderAgent(secret: "123456")
        let coordinator = CredentialProviderCoordinator(agent: agent)
        let snapshot = try coordinator.load(serviceIdentifiers: ["example.test"], query: "")
        let completion = try coordinator.complete(
            candidateID: "cipher-a",
            from: snapshot,
            field: .totp,
            mismatchConfirmed: false,
            supportsSystemTOTP: true
        )
        defer { completion.clear() }

        XCTAssertEqual(completion.type, .oneTimeCode)
        XCTAssertEqual(agent.releaseRequests.only?.field, .totp)
        XCTAssertEqual(try completion.secretString(), "123456")
    }

    func testCandidateListGroupsExactRelevantOtherInOrderWithReadableReasons() {
        let candidates = [
            Self.candidate(id: "other", group: .other, reason: "other"),
            Self.candidate(id: "exact", group: .exact, reason: "exact_service"),
            Self.candidate(id: "relevant", group: .relevant, reason: "bundle_preset")
        ]

        let model = CredentialCandidateListModel(candidates: candidates)

        XCTAssertEqual(model.sections.map(\.group), [.exact, .relevant, .other])
        XCTAssertEqual(model.sections.flatMap(\.rows).map(\.candidate.cipherID), ["exact", "relevant", "other"])
        XCTAssertTrue(model.sections.flatMap(\.rows).allSatisfy {
            !$0.reasonText.isEmpty && !$0.reasonText.contains("_")
        })
    }

    func testCandidateSelectionNeverSubmitsUntilExplicitConfirmation() {
        var submitted: [String] = []
        let model = CredentialCandidateListModel(
            candidates: [Self.candidate()],
            onSubmit: { submitted.append($0.cipherID) }
        )

        model.select(candidateID: "cipher-a")
        XCTAssertTrue(submitted.isEmpty)
        XCTAssertTrue(model.confirmSelection())
        XCTAssertEqual(submitted, ["cipher-a"])
    }

    fileprivate static func candidate(
        id: String = "cipher-a",
        group: CandidateGroup = .exact,
        mismatch: Bool = false,
        reason: String? = nil
    ) -> RankedCandidate {
        RankedCandidate(
            cipherID: id,
            displayName: "Example",
            username: "person@example.test",
            group: group,
            reason: reason ?? (group == .exact ? "exact_service" : "other"),
            requiresMismatchConfirmation: mismatch
        )
    }
}

private final class StubCredentialProviderAgent: CredentialProviderAgent {
    let session = AgentSessionPayload(
        generation: UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!,
        accountID: "account-a",
        vaultRevision: 7
    )
    private let error: AgentProtocolError?
    private let releaseError: AgentProtocolError?
    private let candidates: [RankedCandidate]
    private let secret: String
    private(set) var queries: [CandidateQueryPayload] = []
    private(set) var releaseRequests: [SecretReleasePayload] = []

    init(
        error: AgentProtocolError? = nil,
        releaseError: AgentProtocolError? = nil,
        candidates: [RankedCandidate] = [CredentialProviderTests.candidate()],
        secret: String = "agent-password"
    ) {
        self.error = error
        self.releaseError = releaseError
        self.candidates = candidates
        self.secret = secret
    }

    func currentSession() throws -> AgentSessionPayload {
        if let error { throw error }
        return session
    }

    func queryCandidates(_ payload: CandidateQueryPayload) throws -> CandidateResponsePayload {
        if let error { throw error }
        queries.append(payload)
        return CandidateResponsePayload(contextToken: "context-token", candidates: candidates)
    }

    func releaseSecret(_ payload: SecretReleasePayload) throws -> ReleasedSecret {
        releaseRequests.append(payload)
        if let releaseError { throw releaseError }
        return ReleasedSecret(field: payload.field, value: Data(secret.utf8))
    }
}

private extension Array {
    var only: Element? { count == 1 ? first : nil }
}
