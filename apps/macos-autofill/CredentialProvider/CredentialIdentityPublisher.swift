import AuthenticationServices
import CryptoKit
import Foundation

struct CredentialIdentityItem: Equatable {
    enum Kind: Equatable {
        case login
        case card
        case identity
        case secureNote
    }

    let kind: Kind
    let opaqueCipherID: String
    let username: String
    let serviceIdentifiers: [String]
    let isArchived: Bool
    let isDeleted: Bool
}

struct CredentialIdentitySnapshot: Equatable {
    let accountID: String
    let generation: UUID
    let items: [CredentialIdentityItem]
}

struct CredentialIdentityStoreState: Equatable {
    let isEnabled: Bool
    let supportsIncrementalUpdates: Bool
}

enum CredentialIdentityPublisherError: Error, Equatable {
    case storeDisabled
    case superseded
}

protocol CredentialIdentityStoreWriting {
    func state(completion: @escaping (Result<CredentialIdentityStoreState, Error>) -> Void)

    func replace(
        _ identities: [ASPasswordCredentialIdentity],
        completion: @escaping (Result<Void, Error>) -> Void
    )
}

struct SystemCredentialIdentityStore: CredentialIdentityStoreWriting {
    private let store: ASCredentialIdentityStore

    init(store: ASCredentialIdentityStore = .shared) {
        self.store = store
    }

    func state(completion: @escaping (Result<CredentialIdentityStoreState, Error>) -> Void) {
        store.getState { state in
            completion(.success(CredentialIdentityStoreState(
                isEnabled: state.isEnabled,
                supportsIncrementalUpdates: state.supportsIncrementalUpdates
            )))
        }
    }

    func replace(
        _ identities: [ASPasswordCredentialIdentity],
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        store.replaceCredentialIdentities(with: identities) { success, error in
            if success {
                completion(.success(()))
            } else {
                completion(.failure(error ?? AgentProtocolError.unavailable))
            }
        }
    }
}

enum CredentialIdentityRecordIdentifier {
    private static let domain = Data("barwarden-credential-identity-v1".utf8)

    static func make(
        accountID: String,
        generation: UUID,
        opaqueCipherID: String,
        service: PublishedCredentialService
    ) -> String {
        var digest = SHA256()
        append(domain, to: &digest)
        append(Data(accountID.utf8), to: &digest)
        append(Data(generation.uuidString.lowercased().utf8), to: &digest)
        append(Data(opaqueCipherID.utf8), to: &digest)
        append(Data(service.kind.rawValue.utf8), to: &digest)
        append(Data(service.identifier.utf8), to: &digest)
        let encoded = digest.finalize().map { String(format: "%02x", $0) }.joined()
        return "bwaf-id-v1.\(encoded)"
    }

    private static func append(_ data: Data, to digest: inout SHA256) {
        var length = UInt64(data.count).bigEndian
        withUnsafeBytes(of: &length) { digest.update(bufferPointer: $0) }
        digest.update(data: data)
    }
}

final class CredentialIdentityPublisher {
    private struct Request {
        let epoch: UInt64
        let identities: [ASPasswordCredentialIdentity]
        let completion: (Result<Void, Error>) -> Void
    }

    private struct IdentityKey: Hashable {
        let recordIdentifier: String
        let username: String
        let serviceIdentifier: String
        let serviceType: ASCredentialServiceIdentifier.IdentifierType
    }

    private let store: CredentialIdentityStoreWriting
    private let queue = DispatchQueue(label: "com.sommir.barwarden.credential-identities")
    private let queueKey = DispatchSpecificKey<Void>()
    private var nextEpoch: UInt64 = 0
    private var active: Request?
    private var pending: Request?

    init(store: CredentialIdentityStoreWriting = SystemCredentialIdentityStore()) {
        self.store = store
        queue.setSpecific(key: queueKey, value: ())
    }

    func replaceAfterSync(
        _ snapshot: CredentialIdentitySnapshot,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        guard !snapshot.accountID.isEmpty else {
            completion(.failure(AgentProtocolError.malformedMessage))
            return
        }
        var seen = Set<IdentityKey>()
        var identities: [ASPasswordCredentialIdentity] = []
        for item in snapshot.items where item.kind == .login && !item.isArchived && !item.isDeleted {
            guard !item.opaqueCipherID.isEmpty else { continue }
            for rawService in item.serviceIdentifiers {
                guard let canonical = PublishedCredentialServiceCanonicalizer
                    .canonicalVaultService(rawService) else { continue }
                let service = ASCredentialServiceIdentifier(
                    identifier: canonical.identifier,
                    type: canonical.kind == .URL ? .URL : .domain
                )
                let recordIdentifier = CredentialIdentityRecordIdentifier.make(
                    accountID: snapshot.accountID,
                    generation: snapshot.generation,
                    opaqueCipherID: item.opaqueCipherID,
                    service: canonical
                )
                let key = IdentityKey(
                    recordIdentifier: recordIdentifier,
                    username: item.username,
                    serviceIdentifier: service.identifier,
                    serviceType: service.type
                )
                guard seen.insert(key).inserted else { continue }
                identities.append(ASPasswordCredentialIdentity(
                    serviceIdentifier: service,
                    user: item.username,
                    recordIdentifier: recordIdentifier
                ))
            }
        }
        replaceWhenEnabled(identities, completion: completion)
    }

    func preserveOnLock() {
        // Apple's protected identity store may retain this safe metadata while secrets stay locked in Agent.
    }

    func removeForLogout(completion: @escaping (Result<Void, Error>) -> Void) {
        replaceWhenEnabled([], completion: completion)
    }

    private func replaceWhenEnabled(
        _ identities: [ASPasswordCredentialIdentity],
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        onQueue {
            nextEpoch &+= 1
            let request = Request(epoch: nextEpoch, identities: identities, completion: completion)
            if let pending {
                pending.completion(.failure(CredentialIdentityPublisherError.superseded))
            }
            pending = request
            startNextIfNeeded()
        }
    }

    private func startNextIfNeeded() {
        guard active == nil, let request = pending else { return }
        pending = nil
        active = request
        store.state { [weak self] result in
            self?.onQueue { self?.handleState(result, for: request) }
        }
    }

    private func handleState(
        _ result: Result<CredentialIdentityStoreState, Error>,
        for request: Request
    ) {
        guard active?.epoch == request.epoch else { return }
        guard request.epoch == nextEpoch else {
            finish(request, with: .failure(CredentialIdentityPublisherError.superseded))
            return
        }
        switch result {
        case let .success(state) where state.isEnabled:
            // Full replacement is intentional even when incremental updates are supported.
            store.replace(request.identities) { [weak self] result in
                self?.onQueue { self?.handleReplace(result, for: request) }
            }
        case .success:
            finish(request, with: .failure(CredentialIdentityPublisherError.storeDisabled))
        case let .failure(error):
            finish(request, with: .failure(error))
        }
    }

    private func handleReplace(_ result: Result<Void, Error>, for request: Request) {
        guard active?.epoch == request.epoch else { return }
        let finalResult: Result<Void, Error> = request.epoch == nextEpoch
            ? result
            : .failure(CredentialIdentityPublisherError.superseded)
        finish(request, with: finalResult)
    }

    private func finish(_ request: Request, with result: Result<Void, Error>) {
        guard active?.epoch == request.epoch else { return }
        active = nil
        request.completion(result)
        startNextIfNeeded()
    }

    private func onQueue(_ operation: () -> Void) {
        if DispatchQueue.getSpecific(key: queueKey) != nil {
            operation()
        } else {
            queue.sync(execute: operation)
        }
    }
}
