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
        XCTAssertEqual(
            SystemAutoFillError.authorizationRequired.recoveryMessage,
            "Open Barwarden to unlock this item, then try AutoFill again."
        )
        XCTAssertFalse(SystemAutoFillError.authorizationRequired.recoveryMessage.localizedCaseInsensitiveContains("approve"))
        XCTAssertFalse(SystemAutoFillError.authorizationRequired.recoveryMessage.localizedCaseInsensitiveContains("in-app"))
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
            opaqueCipherID: "cipher-a",
            service: PublishedCredentialService(identifier: "evil.example.test", kind: .domain)
        )

        XCTAssertThrowsError(try coordinator.completePasswordIdentity(
            recordIdentifier: recordIdentifier,
            serviceIdentifier: "evil.example.test",
            serviceKind: .domain,
            username: "person@example.test"
        )) { XCTAssertEqual($0 as? SystemAutoFillError, .serviceMismatch) }
        XCTAssertTrue(agent.releaseRequests.isEmpty)
    }

    func testDirectIdentityRecordIsBoundToOneCanonicalPublishedService() {
        let agent = StubCredentialProviderAgent()
        let coordinator = CredentialProviderCoordinator(agent: agent)
        let firstService = PublishedCredentialService(
            identifier: "https://first.example.test/login",
            kind: .URL
        )
        let firstRecord = CredentialIdentityRecordIdentifier.make(
            accountID: agent.session.accountID,
            generation: agent.session.generation,
            opaqueCipherID: "cipher-a",
            service: firstService
        )

        XCTAssertThrowsError(try coordinator.completePasswordIdentity(
            recordIdentifier: firstRecord,
            serviceIdentifier: "https://second.example.test/login",
            serviceKind: .URL,
            username: "person@example.test"
        )) { XCTAssertEqual($0 as? SystemAutoFillError, .serviceMismatch) }
        XCTAssertTrue(agent.releaseRequests.isEmpty)
    }

    func testDirectIdentityCarriesExactCanonicalServiceIntoAtomicRelease() throws {
        let agent = StubCredentialProviderAgent()
        let coordinator = CredentialProviderCoordinator(agent: agent)
        let service = PublishedCredentialService(
            identifier: "https://example.test/login",
            kind: .URL
        )
        let record = CredentialIdentityRecordIdentifier.make(
            accountID: agent.session.accountID,
            generation: agent.session.generation,
            opaqueCipherID: "cipher-a",
            service: service
        )

        let completion = try coordinator.completePasswordIdentity(
            recordIdentifier: record,
            serviceIdentifier: "HTTPS://EXAMPLE.TEST/login#ignored",
            serviceKind: .URL,
            username: "person@example.test"
        )
        defer { completion.clear() }

        XCTAssertEqual(agent.releaseRequests.only?.publishedService, service)
        XCTAssertEqual(agent.queries.only?.field, .password)
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

    func testTerminalGateAllowsExactlyOneSuccessErrorOrCancellationCallback() {
        for first in [CredentialTerminalOutcome.success, .failure, .cancelled] {
            let gate = CredentialRequestTerminalGate()
            XCTAssertTrue(gate.claim(first))
            XCTAssertFalse(gate.claim(.success))
            XCTAssertFalse(gate.claim(.failure))
            XCTAssertFalse(gate.claim(.cancelled))
            XCTAssertEqual(gate.outcome, first)
        }
    }

    func testCancelAfterAgentReleaseClearsSecretAndCannotComplete() throws {
        let gate = CredentialRequestTerminalGate()
        var releasedSecret: ReleasedSecret?
        var coordinator: CredentialProviderCoordinator!
        let agent = StubCredentialProviderAgent(onRelease: { secret in
            releasedSecret = secret
            XCTAssertTrue(coordinator.cancel())
        })
        coordinator = CredentialProviderCoordinator(agent: agent, terminalGate: gate)
        let snapshot = try coordinator.load(serviceIdentifiers: ["example.test"], query: "")

        XCTAssertThrowsError(try coordinator.complete(
            candidateID: "cipher-a",
            from: snapshot,
            field: .password,
            mismatchConfirmed: false
        )) { XCTAssertEqual($0 as? SystemAutoFillError, .cancelled) }

        XCTAssertTrue(releasedSecret?.isCleared == true)
        XCTAssertEqual(gate.outcome, .cancelled)
        XCTAssertFalse(gate.claim(.success), "main-thread finish must not complete after cancellation")
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
        let snapshot = try coordinator.load(
            serviceIdentifiers: ["example.test"],
            query: "",
            field: .totp
        )
        let completion = try coordinator.complete(
            candidateID: "cipher-a",
            from: snapshot,
            field: .totp,
            mismatchConfirmed: false,
            supportsSystemTOTP: true
        )
        defer { completion.clear() }

        XCTAssertEqual(completion.type, .oneTimeCode)
        XCTAssertEqual(agent.queries.only?.field, .totp)
        XCTAssertEqual(agent.releaseRequests.only?.field, .totp)
        XCTAssertEqual(try completion.secretString(), "123456")
    }

    func testCandidateReasonsUseSpecificFixedLocalCopyWithSafeUnknownFallback() {
        let expected: [(String, CandidateGroup, String)] = [
            ("user_binding", .exact, "Previously linked to this app"),
            ("service_identifier", .exact, "Matches the requesting service"),
            ("app_preset", .relevant, "Matches this known app"),
            ("vault_uri_rule", .relevant, "Matches this Login's saved URI rule"),
            ("host_or_domain", .relevant, "Shares the requesting host or domain"),
            ("fuzzy_name", .relevant, "Login name may relate to this app"),
            ("selection_history", .relevant, "Previously filled for this context"),
            ("favorite", .relevant, "Saved as a favorite Login"),
            ("recent", .relevant, "Recently used Login"),
            ("other", .other, "Available from all Logins")
        ]

        for (reason, group, copy) in expected {
            let model = CredentialCandidateListModel(candidates: [
                Self.candidate(id: reason, group: group, reason: reason)
            ])
            XCTAssertEqual(model.sections.only?.rows.only?.reasonText, copy, reason)
        }

        let unknown = "unknown_secret://service.example/path"
        let model = CredentialCandidateListModel(candidates: [
            Self.candidate(id: "unknown", group: .relevant, reason: unknown)
        ])
        XCTAssertEqual(model.sections.only?.rows.only?.reasonText, "May be relevant to this request")
        XCTAssertFalse(model.sections.only?.rows.only?.reasonText.contains(unknown) == true)
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
            onSubmit: {
                submitted.append($0.cipherID)
                return true
            }
        )

        model.select(candidateID: "cipher-a")
        XCTAssertTrue(submitted.isEmpty)
        XCTAssertTrue(model.confirmSelection())
        XCTAssertEqual(submitted, ["cipher-a"])
    }

    func testRejectedFillAttemptKeepsSelectionAvailableForRetry() {
        var accepted = false
        var attempts = 0
        let model = CredentialCandidateListModel(
            candidates: [Self.candidate(group: .other, mismatch: true)],
            onSubmit: { _ in
                attempts += 1
                return accepted
            }
        )

        model.select(candidateID: "cipher-a")
        XCTAssertFalse(model.confirmSelection())
        XCTAssertEqual(attempts, 1)

        accepted = true
        XCTAssertTrue(model.confirmSelection())
        XCTAssertEqual(attempts, 2)
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
    private let onRelease: ((ReleasedSecret) -> Void)?
    private(set) var queries: [CandidateQueryPayload] = []
    private(set) var releaseRequests: [SecretReleasePayload] = []

    init(
        error: AgentProtocolError? = nil,
        releaseError: AgentProtocolError? = nil,
        candidates: [RankedCandidate] = [CredentialProviderTests.candidate()],
        secret: String = "agent-password",
        onRelease: ((ReleasedSecret) -> Void)? = nil
    ) {
        self.error = error
        self.releaseError = releaseError
        self.candidates = candidates
        self.secret = secret
        self.onRelease = onRelease
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
        let released = ReleasedSecret(field: payload.field, value: Data(secret.utf8))
        onRelease?(released)
        return released
    }
}

private extension Array {
    var only: Element? { count == 1 ? first : nil }
}
