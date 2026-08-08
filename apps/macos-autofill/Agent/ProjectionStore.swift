import CryptoKit
import Darwin
import Foundation

struct ProjectionProvision: Equatable {
    let generation: UUID
    let accountID: String
    let vaultRevision: UInt64
    let key: Data
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
        let projectionURL: URL
        var expiresAt: TimeInterval
    }

    private let defaultProjectionURL: URL?
    private let allowedRootURL: URL
    private let clock: () -> TimeInterval
    private let onKeyZeroize: (() -> Void)?
    private let lockState = NSLock()
    private let leaseTimerQueue = DispatchQueue(label: "com.bitwarden.menubar.autofill-projection-lease")
    private var lease: Lease?
    private var leaseTimer: DispatchSourceTimer?

    init(
        projectionURL: URL,
        clock: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 },
        onKeyZeroize: (() -> Void)? = nil
    ) {
        defaultProjectionURL = projectionURL
        allowedRootURL = projectionURL.deletingLastPathComponent().standardizedFileURL
        self.clock = clock
        self.onKeyZeroize = onKeyZeroize
    }

    init(
        allowedRootURL: URL,
        clock: @escaping () -> TimeInterval = { Date().timeIntervalSince1970 },
        onKeyZeroize: (() -> Void)? = nil
    ) {
        defaultProjectionURL = nil
        self.allowedRootURL = allowedRootURL.standardizedFileURL
        self.clock = clock
        self.onKeyZeroize = onKeyZeroize
    }

    deinit {
        leaseTimer?.cancel()
        lease?.key.clear()
    }

    func provision(_ provision: ProjectionProvision, from peer: AuthorizedPeer) throws {
        guard peer == .mainApplication,
              !provision.accountID.isEmpty,
              provision.vaultRevision > 0,
              provision.leaseDurationSeconds > 0,
              provision.leaseDurationSeconds <= 300 else {
            throw peer == .mainApplication
                ? AgentProtocolError.malformedMessage
                : AgentProtocolError.unauthorized
        }
        let candidateKey = try ZeroizingKey(provision.key) { [weak self] _ in
            self?.onKeyZeroize?()
        }
        let projectionURL = try resolveProjectionURL(provision.projectionURL)
        let projection = try decrypt(at: projectionURL, using: candidateKey)
        guard projection.version == AutoFillProjectionEnvelope.formatVersion,
              projection.accountID == provision.accountID else {
            throw AgentProtocolError.accountMismatch
        }
        guard projection.vaultRevision == provision.vaultRevision else {
            throw AgentProtocolError.staleRevision
        }

        lockState.lock()
        defer { lockState.unlock() }
        lease?.key.clear()
        lease = Lease(
            generation: provision.generation,
            accountID: provision.accountID,
            vaultRevision: provision.vaultRevision,
            key: candidateKey,
            projectionURL: projectionURL,
            expiresAt: clock() + provision.leaseDurationSeconds
        )
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
        let current = try requireLease(generation: generation, accountID: accountID)
        let projection = try decrypt(at: current.projectionURL, using: current.key)
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
        lease?.key.clear()
        lease = nil
    }


    private func resolveProjectionURL(_ requested: URL?) throws -> URL {
        guard let url = (requested ?? defaultProjectionURL)?.standardizedFileURL,
              url.pathExtension == "bwaf",
              url.deletingLastPathComponent() == allowedRootURL else {
            throw AgentProtocolError.malformedMessage
        }
        return url
    }

    private func decrypt(at projectionURL: URL, using key: ZeroizingKey) throws -> AutoFillProjection {
        let bytes: Data
        do {
            bytes = try Data(contentsOf: projectionURL, options: .mappedIfSafe)
        } catch {
            throw AgentProtocolError.unavailable
        }
        return try AutoFillProjectionEnvelope.open(bytes, using: key)
    }
}
