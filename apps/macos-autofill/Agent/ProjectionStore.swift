import CryptoKit
import Darwin
import Foundation

final class ProjectionProvision: Equatable {
    let generation: UUID
    let accountID: String
    let vaultRevision: UInt64
    private(set) var key: Data
    let leaseDurationSeconds: TimeInterval
    let projectionURL: URL?

    init(
        generation: UUID,
        accountID: String,
        vaultRevision: UInt64,
        key: Data,
        leaseDurationSeconds: TimeInterval,
        projectionURL: URL? = nil
    ) {
        self.generation = generation
        self.accountID = accountID
        self.vaultRevision = vaultRevision
        self.key = key
        self.leaseDurationSeconds = leaseDurationSeconds
        self.projectionURL = projectionURL
    }

    deinit { clearKey() }

    func clearKey() {
        key.resetBytes(in: key.indices)
    }

    static func == (lhs: ProjectionProvision, rhs: ProjectionProvision) -> Bool {
        lhs.generation == rhs.generation
            && lhs.accountID == rhs.accountID
            && lhs.vaultRevision == rhs.vaultRevision
            && lhs.key == rhs.key
            && lhs.leaseDurationSeconds == rhs.leaseDurationSeconds
            && lhs.projectionURL == rhs.projectionURL
    }
}

final class ZeroizingKey {
    static let byteCount = 32

    private let pointer: UnsafeMutableRawPointer
    private var isCleared = false
    private let onZeroize: ((UnsafeRawBufferPointer) -> Void)?

    init(
        _ data: Data,
        onZeroize: ((UnsafeRawBufferPointer) -> Void)? = nil
    ) throws {
        guard data.count == Self.byteCount else { throw AgentProtocolError.malformedMessage }
        pointer = UnsafeMutableRawPointer.allocate(
            byteCount: Self.byteCount,
            alignment: MemoryLayout<UInt64>.alignment
        )
        self.onZeroize = onZeroize
        data.copyBytes(to: pointer.assumingMemoryBound(to: UInt8.self), count: Self.byteCount)
    }

    deinit {
        clear()
        pointer.deallocate()
    }

    func withSymmetricKey<T>(_ body: (SymmetricKey) throws -> T) rethrows -> T {
        let bytes = UnsafeRawBufferPointer(start: pointer, count: Self.byteCount)
        return try body(SymmetricKey(data: bytes))
    }

    func clear() {
        guard !isCleared else { return }
        _ = memset(pointer, 0, Self.byteCount)
        isCleared = true
        onZeroize?(UnsafeRawBufferPointer(start: pointer, count: Self.byteCount))
    }
}

final class ProjectionStore {
    private struct Lease {
        let generation: UUID
        let accountID: String
        let vaultRevision: UInt64
        let key: ZeroizingKey
        let projectionName: String
        let device: dev_t
        let inode: ino_t
        var expiresAt: TimeInterval
    }

    private struct OpenedProjection {
        let projection: AutoFillProjection
        let device: dev_t
        let inode: ino_t
    }

    private let defaultProjectionURL: URL?
    private let requestedRootURL: URL
    private let canonicalRootURL: URL
    private let clock: () -> TimeInterval
    private let onKeyZeroize: (() -> Void)?
    private let onVerifiedFileOpen: (() -> Void)?
    private let onCandidateQuerySnapshot: (() -> Void)?
    private let onSecretReleaseSnapshot: (() -> Void)?
    private let retiredGenerationCapacity: Int
    private let candidateAuthorizations: CandidateAuthorizationStore
    private let lockState = NSLock()
    private let leaseTimerQueue = DispatchQueue(label: "com.bitwarden.menubar.autofill-projection-lease")
    private var lease: Lease?
    private var leaseTimer: DispatchSourceTimer?
    private var retiredGenerations = Set<UUID>()

    init(
        projectionURL: URL,
        clock: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 },
        onKeyZeroize: (() -> Void)? = nil,
        onVerifiedFileOpen: (() -> Void)? = nil,
        onCandidateQuerySnapshot: (() -> Void)? = nil,
        onSecretReleaseSnapshot: (() -> Void)? = nil,
        candidateAuthorizations: CandidateAuthorizationStore = CandidateAuthorizationStore(),
        retiredGenerationCapacity: Int = 4_096
    ) {
        precondition(retiredGenerationCapacity > 0)
        defaultProjectionURL = projectionURL
        requestedRootURL = projectionURL.deletingLastPathComponent()
        canonicalRootURL = requestedRootURL.resolvingSymlinksInPath()
        self.clock = clock
        self.onKeyZeroize = onKeyZeroize
        self.onVerifiedFileOpen = onVerifiedFileOpen
        self.onCandidateQuerySnapshot = onCandidateQuerySnapshot
        self.onSecretReleaseSnapshot = onSecretReleaseSnapshot
        self.candidateAuthorizations = candidateAuthorizations
        self.retiredGenerationCapacity = retiredGenerationCapacity
    }

    init(
        allowedRootURL: URL,
        clock: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 },
        onKeyZeroize: (() -> Void)? = nil,
        onVerifiedFileOpen: (() -> Void)? = nil,
        onCandidateQuerySnapshot: (() -> Void)? = nil,
        onSecretReleaseSnapshot: (() -> Void)? = nil,
        candidateAuthorizations: CandidateAuthorizationStore = CandidateAuthorizationStore(),
        retiredGenerationCapacity: Int = 4_096
    ) {
        precondition(retiredGenerationCapacity > 0)
        defaultProjectionURL = nil
        requestedRootURL = allowedRootURL
        canonicalRootURL = allowedRootURL.resolvingSymlinksInPath()
        self.clock = clock
        self.onKeyZeroize = onKeyZeroize
        self.onVerifiedFileOpen = onVerifiedFileOpen
        self.onCandidateQuerySnapshot = onCandidateQuerySnapshot
        self.onSecretReleaseSnapshot = onSecretReleaseSnapshot
        self.candidateAuthorizations = candidateAuthorizations
        self.retiredGenerationCapacity = retiredGenerationCapacity
    }

    deinit {
        leaseTimer?.cancel()
        lease?.key.clear()
    }

    func provision(_ provision: ProjectionProvision, from peer: AuthorizedPeer) throws {
        defer { provision.clearKey() }
        guard peer == .mainApplication,
              !provision.accountID.isEmpty,
              provision.vaultRevision > 0,
              provision.leaseDurationSeconds > 0,
              provision.leaseDurationSeconds <= 300 else {
            throw peer == .mainApplication
                ? AgentProtocolError.malformedMessage
                : AgentProtocolError.unauthorized
        }
        lockState.lock()
        defer { lockState.unlock() }
        guard !retiredGenerations.contains(provision.generation) else {
            throw AgentProtocolError.staleRevision
        }
        guard retiredGenerations.count < retiredGenerationCapacity else {
            throw AgentProtocolError.requestCapacity
        }
        if let current = lease {
            guard current.generation == provision.generation,
                  current.accountID == provision.accountID else {
                throw AgentProtocolError.accountMismatch
            }
            guard provision.vaultRevision > current.vaultRevision else {
                throw AgentProtocolError.staleRevision
            }
        }
        let candidateKey = try ZeroizingKey(provision.key) { [weak self] _ in
            self?.onKeyZeroize?()
        }
        let projectionName = try resolveProjectionName(provision.projectionURL)
        let opened = try decrypt(name: projectionName, using: candidateKey)
        let projection = opened.projection
        guard projection.version == AutoFillProjectionEnvelope.formatVersion,
              projection.accountID == provision.accountID else {
            throw AgentProtocolError.accountMismatch
        }
        guard projection.vaultRevision == provision.vaultRevision else {
            throw AgentProtocolError.staleRevision
        }
        lease?.key.clear()
        lease = Lease(
            generation: provision.generation,
            accountID: provision.accountID,
            vaultRevision: provision.vaultRevision,
            key: candidateKey,
            projectionName: projectionName,
            device: opened.device,
            inode: opened.inode,
            expiresAt: clock() + provision.leaseDurationSeconds
        )
        candidateAuthorizations.clear()
        scheduleExpiration(
            generation: provision.generation,
            after: provision.leaseDurationSeconds
        )
    }

    func renewLease(
        generation: UUID,
        accountID: String,
        durationSeconds: TimeInterval,
        from peer: AuthorizedPeer
    ) throws {
        guard peer == .mainApplication else { throw AgentProtocolError.unauthorized }
        guard durationSeconds > 0, durationSeconds <= 300 else {
            throw AgentProtocolError.malformedMessage
        }
        lockState.lock()
        defer { lockState.unlock() }
        _ = try requireLease(generation: generation, accountID: accountID)
        lease?.expiresAt = clock() + durationSeconds
        scheduleExpiration(generation: generation, after: durationSeconds)
    }

    func read(accountID: String, generation: UUID) throws -> AutoFillProjection {
        lockState.lock()
        defer { lockState.unlock() }
        return try currentProjection(accountID: accountID, generation: generation)
    }

    func queryCandidates(
        accountID: String,
        generation: UUID,
        context: NativeAutoFillContext,
        matchingEngine: MatchingEngine
    ) throws -> CandidateResponsePayload {
        lockState.lock()
        defer { lockState.unlock() }
        let projection = try currentProjection(accountID: accountID, generation: generation)
        let candidates = matchingEngine.rank(
            accountID: projection.accountID,
            logins: projection.logins,
            context: context,
            bindings: projection.bindings.map {
                UserAppBinding(
                    accountID: projection.accountID,
                    bundleID: $0.bundleID,
                    cipherID: $0.cipherID
                )
            },
            history: projection.history.map {
                MatchingHistoryEntry(
                    accountID: projection.accountID,
                    contextKey: $0.contextKey,
                    cipherID: $0.cipherID,
                    successfulSelectionCount: $0.successfulSelectionCount,
                    lastSelectedAt: $0.lastSelectedAt
                )
            }
        )
        let contextDigest = matchingEngine.authorizationContextDigest(context)
        let policyDigest = matchingEngine.authorizationPolicyDigest(
            projection: projection,
            context: context
        )
        onCandidateQuerySnapshot?()
        return try candidateAuthorizations.issue(
            accountID: projection.accountID,
            generation: generation,
            vaultRevision: projection.vaultRevision,
            context: context,
            contextDigest: contextDigest,
            policyDigest: policyDigest,
            candidates: candidates,
            logins: projection.logins
        )
    }

    func withAuthorizedCandidate<T>(
        _ request: SecretReleasePayload,
        matchingEngine: MatchingEngine,
        verifyRepromptGrant: CandidateAuthorizationStore.RepromptGrantVerifier,
        operation: (AutoFillLogin) throws -> T
    ) throws -> T {
        lockState.lock()
        defer { lockState.unlock() }
        let projection = try currentProjection(
            accountID: request.accountID,
            generation: request.generation
        )
        let snapshot = try candidateAuthorizations.snapshot(for: request)
        let contextDigest = matchingEngine.authorizationContextDigest(snapshot.context)
        let policyDigest = matchingEngine.authorizationPolicyDigest(
            projection: projection,
            context: snapshot.context
        )
        guard snapshot.vaultRevision == projection.vaultRevision,
              snapshot.contextDigest == contextDigest,
              snapshot.policyDigest == policyDigest,
              let login = projection.logins.first(where: { $0.cipherID == request.candidateID }) else {
            throw AgentProtocolError.unauthorized
        }
        onSecretReleaseSnapshot?()
        try candidateAuthorizations.validate(
            request,
            currentVaultRevision: projection.vaultRevision,
            currentContextDigest: contextDigest,
            currentPolicyDigest: policyDigest,
            verifyRepromptGrant: verifyRepromptGrant
        )
        return try operation(login)
    }

    private func currentProjection(
        accountID: String,
        generation: UUID
    ) throws -> AutoFillProjection {
        let current = try requireLease(generation: generation, accountID: accountID)
        let opened = try decrypt(
            name: current.projectionName,
            using: current.key,
            expectedDevice: current.device,
            expectedInode: current.inode
        )
        let projection = opened.projection
        guard projection.accountID == current.accountID else {
            throw AgentProtocolError.accountMismatch
        }
        guard projection.vaultRevision == current.vaultRevision else {
            throw AgentProtocolError.staleRevision
        }
        return projection
    }

    func lock() {
        lockState.lock()
        defer { lockState.unlock() }
        clearLease()
    }

    private func requireLease(generation: UUID, accountID: String) throws -> Lease {
        guard let current = lease else { throw AgentProtocolError.locked }
        guard current.expiresAt > clock() else {
            clearLease()
            throw AgentProtocolError.locked
        }
        guard current.generation == generation,
              current.accountID == accountID else {
            throw AgentProtocolError.accountMismatch
        }
        return current
    }

    private func scheduleExpiration(generation: UUID, after durationSeconds: TimeInterval) {
        leaseTimer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: leaseTimerQueue)
        timer.schedule(deadline: .now() + durationSeconds)
        timer.setEventHandler { [weak self] in
            self?.expireLease(generation: generation)
        }
        leaseTimer = timer
        timer.resume()
    }

    private func expireLease(generation: UUID) {
        lockState.lock()
        defer { lockState.unlock() }
        guard lease?.generation == generation else { return }
        clearLease()
    }

    private func clearLease() {
        leaseTimer?.cancel()
        leaseTimer = nil
        if let generation = lease?.generation {
            retiredGenerations.insert(generation)
        }
        lease?.key.clear()
        lease = nil
        candidateAuthorizations.clear()
    }


    private func resolveProjectionName(_ requested: URL?) throws -> String {
        guard let url = requested ?? defaultProjectionURL,
              url.isFileURL,
              url.pathExtension == "bwaf",
              !url.lastPathComponent.isEmpty,
              url.lastPathComponent != ".",
              url.lastPathComponent != "..",
              url.deletingLastPathComponent().resolvingSymlinksInPath().path == canonicalRootURL.path else {
            throw AgentProtocolError.malformedMessage
        }
        return url.lastPathComponent
    }

    private func decrypt(
        name: String,
        using key: ZeroizingKey,
        expectedDevice: dev_t? = nil,
        expectedInode: ino_t? = nil
    ) throws -> OpenedProjection {
        let root = try openVerifiedRoot()
        defer { close(root) }
        let descriptor = openat(root, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        guard descriptor >= 0 else { throw AgentProtocolError.unavailable }
        defer { close(descriptor) }
        var metadata = stat()
        guard fstat(descriptor, &metadata) == 0,
              Self.isSecureFileStat(
                mode: metadata.st_mode,
                owner: metadata.st_uid,
                links: metadata.st_nlink,
                expectedOwner: geteuid()
              ),
              expectedDevice.map({ $0 == metadata.st_dev }) ?? true,
              expectedInode.map({ $0 == metadata.st_ino }) ?? true else {
            throw AgentProtocolError.unavailable
        }
        onVerifiedFileOpen?()
        let bytes = try readAll(descriptor, size: metadata.st_size)
        return OpenedProjection(
            projection: try AutoFillProjectionEnvelope.open(bytes, using: key),
            device: metadata.st_dev,
            inode: metadata.st_ino
        )
    }

    private func openVerifiedRoot() throws -> Int32 {
        var requestedMetadata = stat()
        guard lstat(requestedRootURL.path, &requestedMetadata) == 0,
              requestedMetadata.st_mode & mode_t(S_IFMT) != mode_t(S_IFLNK),
              requestedMetadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              requestedMetadata.st_uid == geteuid(),
              requestedMetadata.st_mode & 0o777 == 0o700 else {
            throw AgentProtocolError.unavailable
        }
        let descriptor = open(
            canonicalRootURL.path,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
        guard descriptor >= 0 else { throw AgentProtocolError.unavailable }
        var openedMetadata = stat()
        guard fstat(descriptor, &openedMetadata) == 0,
              openedMetadata.st_dev == requestedMetadata.st_dev,
              openedMetadata.st_ino == requestedMetadata.st_ino else {
            close(descriptor)
            throw AgentProtocolError.unavailable
        }
        return descriptor
    }

    private func readAll(_ descriptor: Int32, size: off_t) throws -> Data {
        let maximumBytes: off_t = 16 * 1_024 * 1_024
        guard size > 0, size <= maximumBytes else { throw AgentProtocolError.unavailable }
        var result = Data(count: Int(size))
        let amount = result.withUnsafeMutableBytes { buffer -> Int in
            guard let base = buffer.baseAddress else { return -1 }
            var offset = 0
            while offset < buffer.count {
                let count = Darwin.read(descriptor, base.advanced(by: offset), buffer.count - offset)
                if count > 0 {
                    offset += count
                } else if count < 0, errno == EINTR {
                    continue
                } else {
                    return count == 0 ? offset : -1
                }
            }
            return offset
        }
        guard amount == result.count else { throw AgentProtocolError.unavailable }
        return result
    }

    static func isSecureFileStat(
        mode: mode_t,
        owner: uid_t,
        links: nlink_t,
        expectedOwner: uid_t
    ) -> Bool {
        mode & mode_t(S_IFMT) == mode_t(S_IFREG)
            && owner == expectedOwner
            && mode & 0o777 == 0o600
            && links == 1
    }
}
