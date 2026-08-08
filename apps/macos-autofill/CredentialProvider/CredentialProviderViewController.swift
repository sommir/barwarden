import AppKit
import AuthenticationServices

enum SystemAutoFillError: String, Error, Equatable {
    case locked
    case authorizationRequired = "authorization-required"
    case staleRequest = "stale-request"
    case serviceMismatch = "service-mismatch"
    case cancelled
    case agentUnavailable = "agent-unavailable"
    case malformedResponse = "malformed-response"
    case unsupportedSystemTOTP = "unsupported-system-totp"

    var recoveryMessage: String {
        switch self {
        case .unsupportedSystemTOTP:
            return "System one-time-code AutoFill requires macOS 15. Use Barwarden focused-field actions."
        case .locked, .authorizationRequired:
            return "Open Barwarden to unlock, then try again. Reprompt-protected Logins require Barwarden in-app AutoFill."
        case .agentUnavailable:
            return "Barwarden AutoFill Agent is unavailable. Open Barwarden to repair AutoFill."
        case .staleRequest:
            return "The vault changed. Choose AutoFill again."
        case .serviceMismatch:
            return "This Login does not match the requesting service."
        case .cancelled:
            return "The AutoFill request was cancelled."
        case .malformedResponse:
            return "Barwarden could not validate the AutoFill response."
        }
    }
}

protocol CredentialProviderAgent {
    func currentSession() throws -> AgentSessionPayload
    func queryCandidates(_ payload: CandidateQueryPayload) throws -> CandidateResponsePayload
    func releaseSecret(_ payload: SecretReleasePayload) throws -> ReleasedSecret
}

extension AgentClient: CredentialProviderAgent {}

struct CredentialCandidateSnapshot {
    let session: AgentSessionPayload
    let query: CandidateQueryPayload
    let response: CandidateResponsePayload

    var candidates: [RankedCandidate] { response.candidates }
}

enum CredentialCompletionType: Equatable {
    case password
    case oneTimeCode
}

final class CredentialCompletion {
    let type: CredentialCompletionType
    let username: String
    private let releasedSecret: ReleasedSecret

    init(type: CredentialCompletionType, username: String, releasedSecret: ReleasedSecret) {
        self.type = type
        self.username = username
        self.releasedSecret = releasedSecret
    }

    deinit { clear() }

    var isCleared: Bool { releasedSecret.isCleared }

    func secretString() throws -> String { try releasedSecret.string() }

    func clear() { releasedSecret.clear() }
}

final class CredentialProviderCoordinator {
    private let agent: CredentialProviderAgent
    private let cancellationLock = NSLock()
    private var isCancelled = false

    init(agent: CredentialProviderAgent = AgentClient()) {
        self.agent = agent
    }

    func load(serviceIdentifiers: [String], query: String) throws -> CredentialCandidateSnapshot {
        try requireActive()
        do {
            let session = try agent.currentSession()
            try requireActive()
            let payload = CandidateQueryPayload(
                generation: session.generation,
                accountID: session.accountID,
                context: NativeAutoFillContext(
                    bundleID: "",
                    appName: "",
                    serviceIdentifiers: serviceIdentifiers,
                    query: query
                )
            )
            let snapshot = CredentialCandidateSnapshot(
                session: session,
                query: payload,
                response: try agent.queryCandidates(payload)
            )
            try requireActive()
            return snapshot
        } catch {
            throw Self.map(error)
        }
    }

    func completePasswordIdentity(
        recordIdentifier: String,
        serviceIdentifier: String,
        username: String
    ) throws -> CredentialCompletion {
        try completeIdentity(
            recordIdentifier: recordIdentifier,
            serviceIdentifier: serviceIdentifier,
            presentedName: username,
            field: .password
        )
    }

    func completeIdentity(
        recordIdentifier: String,
        serviceIdentifier: String,
        presentedName: String,
        field: AutoFillSecretField
    ) throws -> CredentialCompletion {
        let snapshot = try load(serviceIdentifiers: [serviceIdentifier], query: "")
        guard let candidate = snapshot.candidates.first(where: {
            CredentialIdentityRecordIdentifier.make(
                accountID: snapshot.session.accountID,
                generation: snapshot.session.generation,
                opaqueCipherID: $0.cipherID
            ) == recordIdentifier
        }),
        (field == .totp ? candidate.displayName : candidate.username) == presentedName,
        !candidate.requiresMismatchConfirmation else {
            throw SystemAutoFillError.serviceMismatch
        }
        return try complete(
            candidateID: candidate.cipherID,
            from: snapshot,
            field: field,
            mismatchConfirmed: false
        )
    }

    func complete(
        candidateID: String,
        from snapshot: CredentialCandidateSnapshot,
        field: AutoFillSecretField,
        mismatchConfirmed: Bool,
        supportsSystemTOTP: Bool = true
    ) throws -> CredentialCompletion {
        try requireActive()
        guard field != .totp || supportsSystemTOTP else {
            throw SystemAutoFillError.unsupportedSystemTOTP
        }
        guard let candidate = snapshot.candidates.first(where: { $0.cipherID == candidateID }),
              !candidate.requiresMismatchConfirmation || mismatchConfirmed else {
            throw SystemAutoFillError.serviceMismatch
        }
        do {
            let secret = try agent.releaseSecret(SecretReleasePayload(
                generation: snapshot.session.generation,
                accountID: snapshot.session.accountID,
                candidateID: candidateID,
                field: field,
                contextToken: snapshot.response.contextToken,
                mismatchConfirmed: mismatchConfirmed,
                reprompt: RepromptResultPayload(result: .notRequired, grant: nil)
            ))
            do {
                try requireActive()
            } catch {
                secret.clear()
                throw error
            }
            return CredentialCompletion(
                type: field == .totp ? .oneTimeCode : .password,
                username: candidate.username,
                releasedSecret: secret
            )
        } catch {
            throw Self.map(error)
        }
    }

    func cancel() {
        cancellationLock.lock()
        isCancelled = true
        cancellationLock.unlock()
    }

    private func requireActive() throws {
        cancellationLock.lock()
        let cancelled = isCancelled
        cancellationLock.unlock()
        if cancelled { throw SystemAutoFillError.cancelled }
    }

    private static func map(_ error: Error) -> SystemAutoFillError {
        if let error = error as? SystemAutoFillError { return error }
        guard let code = error as? AgentProtocolError else { return .agentUnavailable }
        switch code {
        case .locked:
            return .locked
        case .accountMismatch, .staleRevision:
            return .staleRequest
        case .unauthorized:
            return .authorizationRequired
        case .unavailable, .transport, .timeout:
            return .agentUnavailable
        default:
            return .malformedResponse
        }
    }
}

final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let coordinator = CredentialProviderCoordinator()
    private let worker = DispatchQueue(label: "com.sommir.barwarden.credential-provider", qos: .userInitiated)
    private let candidateList = CandidateListViewController()
    private var services: [String] = []
    private var requestedField = AutoFillSecretField.password
    private var snapshot: CredentialCandidateSnapshot?
    private var requestRevision = 0

    override func loadView() {
        candidateList.onSearch = { [weak self] query in self?.reloadCandidates(query: query) }
        candidateList.onFill = { [weak self] candidate in self?.fill(candidate) }
        candidateList.onCancel = { [weak self] in self?.cancelRequest() }
        view = candidateList.view
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        presentList(for: serviceIdentifiers, field: .password)
    }

    @available(macOS 14.0, *)
    override func prepareCredentialList(
        for serviceIdentifiers: [ASCredentialServiceIdentifier],
        requestParameters: ASPasskeyCredentialRequestParameters
    ) {
        // Barwarden does not advertise or return passkeys; the combined picker still lists passwords.
        presentList(for: serviceIdentifiers, field: .password)
    }

    @available(macOS 15.0, *)
    override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        presentList(for: serviceIdentifiers, field: .totp)
    }

    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {
        completePasswordIdentity(credentialIdentity)
    }

    override func prepareInterfaceToProvideCredential(for credentialIdentity: ASPasswordCredentialIdentity) {
        completePasswordIdentity(credentialIdentity)
    }

    @available(macOS 14.0, *)
    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        completeSystemRequest(credentialRequest)
    }

    @available(macOS 14.0, *)
    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        completeSystemRequest(credentialRequest)
    }

    private func presentList(
        for serviceIdentifiers: [ASCredentialServiceIdentifier],
        field: AutoFillSecretField
    ) {
        _ = view
        services = serviceIdentifiers.map(\.identifier)
        requestedField = field
        candidateList.showLoading()
        reloadCandidates(query: "")
    }

    private func reloadCandidates(query: String) {
        requestRevision += 1
        let revision = requestRevision
        let serviceSnapshot = services
        worker.async { [weak self] in
            guard let self else { return }
            let result = Result {
                try self.coordinator.load(serviceIdentifiers: serviceSnapshot, query: query)
            }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.requestRevision == revision else { return }
                switch result {
                case let .success(snapshot):
                    self.install(snapshot)
                case let .failure(error):
                    self.show(error)
                }
            }
        }
    }

    private func install(_ snapshot: CredentialCandidateSnapshot) {
        self.snapshot = snapshot
        candidateList.install(candidates: snapshot.candidates)
    }

    private func fill(_ candidate: RankedCandidate) {
        guard let snapshot else { return }
        var mismatchConfirmed = false
        if candidate.requiresMismatchConfirmation {
            let alert = NSAlert()
            alert.messageText = "This Login does not match the requesting service"
            alert.informativeText = "Only continue if you trust the current app or website."
            alert.addButton(withTitle: "Fill Anyway")
            alert.addButton(withTitle: "Cancel")
            guard alert.runModal() == .alertFirstButtonReturn else { return }
            mismatchConfirmed = true
        }
        complete(
            candidateID: candidate.cipherID,
            snapshot: snapshot,
            field: requestedField,
            mismatchConfirmed: mismatchConfirmed
        )
    }

    private func cancelRequest() {
        coordinator.cancel()
        extensionContext.cancelRequest(withError: extensionError(SystemAutoFillError.cancelled))
    }

    private func completePasswordIdentity(_ identity: ASPasswordCredentialIdentity) {
        guard let recordIdentifier = identity.recordIdentifier else {
            extensionContext.cancelRequest(withError: extensionError(SystemAutoFillError.serviceMismatch))
            return
        }
        worker.async { [weak self] in
            guard let self else { return }
            let result = Result {
                try self.coordinator.completePasswordIdentity(
                    recordIdentifier: recordIdentifier,
                    serviceIdentifier: identity.serviceIdentifier.identifier,
                    username: identity.user
                )
            }
            DispatchQueue.main.async { [weak self] in self?.finish(result) }
        }
    }

    @available(macOS 14.0, *)
    private func completeSystemRequest(_ request: any ASCredentialRequest) {
        if let passwordRequest = request as? ASPasswordCredentialRequest,
           let identity = passwordRequest.credentialIdentity as? ASPasswordCredentialIdentity {
            completePasswordIdentity(identity)
            return
        }
        if #available(macOS 15.0, *),
           let oneTimeCodeRequest = request as? ASOneTimeCodeCredentialRequest,
           let identity = oneTimeCodeRequest.credentialIdentity as? ASOneTimeCodeCredentialIdentity,
           let recordIdentifier = oneTimeCodeRequest.credentialIdentity.recordIdentifier {
            worker.async { [weak self] in
                guard let self else { return }
                let result = Result {
                    try self.coordinator.completeIdentity(
                        recordIdentifier: recordIdentifier,
                        serviceIdentifier: identity.serviceIdentifier.identifier,
                        presentedName: identity.label,
                        field: .totp
                    )
                }
                DispatchQueue.main.async { [weak self] in self?.finish(result) }
            }
            return
        }
        extensionContext.cancelRequest(withError: extensionError(SystemAutoFillError.malformedResponse))
    }

    private func complete(
        candidateID: String,
        snapshot: CredentialCandidateSnapshot,
        field: AutoFillSecretField,
        mismatchConfirmed: Bool
    ) {
        worker.async { [weak self] in
            guard let self else { return }
            let result = Result {
                try self.coordinator.complete(
                    candidateID: candidateID,
                    from: snapshot,
                    field: field,
                    mismatchConfirmed: mismatchConfirmed,
                    supportsSystemTOTP: field != .totp || Self.supportsSystemTOTP
                )
            }
            DispatchQueue.main.async { [weak self] in self?.finish(result) }
        }
    }

    private static var supportsSystemTOTP: Bool {
        if #available(macOS 15.0, *) { return true }
        return false
    }

    private func finish(_ result: Result<CredentialCompletion, Error>) {
        switch result {
        case let .success(completion):
            defer { completion.clear() }
            do {
                let value = try completion.secretString()
                switch completion.type {
                case .password:
                    extensionContext.completeRequest(
                        withSelectedCredential: ASPasswordCredential(
                            user: completion.username,
                            password: value
                        ),
                        completionHandler: nil
                    )
                case .oneTimeCode:
                    guard #available(macOS 15.0, *) else {
                        throw SystemAutoFillError.unsupportedSystemTOTP
                    }
                    extensionContext.completeOneTimeCodeRequest(
                        using: ASOneTimeCodeCredential(code: value),
                        completionHandler: nil
                    )
                }
            } catch {
                extensionContext.cancelRequest(withError: extensionError(error))
            }
        case let .failure(error):
            if isViewLoaded {
                show(error)
            } else {
                extensionContext.cancelRequest(withError: extensionError(error))
            }
        }
    }

    private func show(_ error: Error) {
        let mapped = error as? SystemAutoFillError ?? .agentUnavailable
        candidateList.show(errorMessage: mapped.recoveryMessage)
    }

    private func extensionError(_ error: Error) -> NSError {
        let mapped = error as? SystemAutoFillError ?? .agentUnavailable
        let code: ASExtensionError.Code
        switch mapped {
        case .cancelled:
            code = .userCanceled
        case .locked, .authorizationRequired:
            code = .userInteractionRequired
        case .serviceMismatch, .staleRequest:
            code = .credentialIdentityNotFound
        case .agentUnavailable, .malformedResponse, .unsupportedSystemTOTP:
            code = .failed
        }
        return NSError(
            domain: ASExtensionErrorDomain,
            code: code.rawValue,
            userInfo: [NSLocalizedDescriptionKey: mapped.recoveryMessage]
        )
    }
}
