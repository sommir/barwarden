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

    static func make(accountID: String, generation: UUID, opaqueCipherID: String) -> String {
        var digest = SHA256()
        append(domain, to: &digest)
        append(Data(accountID.utf8), to: &digest)
        append(Data(generation.uuidString.lowercased().utf8), to: &digest)
        append(Data(opaqueCipherID.utf8), to: &digest)
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
    private struct IdentityKey: Hashable {
        let recordIdentifier: String
        let username: String
        let serviceIdentifier: String
        let serviceType: ASCredentialServiceIdentifier.IdentifierType
    }

    private let store: CredentialIdentityStoreWriting

    init(store: CredentialIdentityStoreWriting = SystemCredentialIdentityStore()) {
        self.store = store
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
            let recordIdentifier = CredentialIdentityRecordIdentifier.make(
                accountID: snapshot.accountID,
                generation: snapshot.generation,
                opaqueCipherID: item.opaqueCipherID
            )
            for rawService in item.serviceIdentifiers {
                guard let service = Self.canonicalService(rawService) else { continue }
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
        store.state { [store] result in
            switch result {
            case let .success(state) where state.isEnabled:
                // Full replacement is intentional even when incremental updates are supported.
                store.replace(identities, completion: completion)
            case .success:
                completion(.failure(CredentialIdentityPublisherError.storeDisabled))
            case let .failure(error):
                completion(.failure(error))
            }
        }
    }

    private static func canonicalService(_ rawValue: String) -> ASCredentialServiceIdentifier? {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        if var components = URLComponents(string: value),
           let scheme = components.scheme?.lowercased(),
           (scheme == "http" || scheme == "https"),
           let host = components.host?.lowercased(),
           !host.isEmpty {
            components.scheme = scheme
            components.host = host
            components.fragment = nil
            guard let canonical = components.url?.absoluteString else { return nil }
            return ASCredentialServiceIdentifier(identifier: canonical, type: .URL)
        }
        let domain = value.precomposedStringWithCanonicalMapping
            .lowercased(with: Locale(identifier: "en_US_POSIX"))
        guard !domain.contains("/"), !domain.contains("?") else { return nil }
        return ASCredentialServiceIdentifier(identifier: domain, type: .domain)
    }
}
