import type { HostApi, SecureCompareAndSwapHost } from "../../host/host-api";

export type GeneratedCredential = {
  readonly credential: string;
  readonly category: "password" | "username";
  readonly generationDate: Date;
  readonly algorithm: "password" | "passphrase" | "username";
};

export interface PendingGeneratorHistoryTrack {
  commit(): void;
  rollback(): Promise<void>;
}

export interface PendingGeneratorHistoryClear {
  commit(): void;
  rollback(): Promise<void>;
}

const HISTORY_KEY_PREFIX = "generator.history.";
const MAX_HISTORY_ENTRIES = 200;
const CLEAR_MARKER_KIND = "barwarden.generator-history-clear-v1";
const HISTORY_ENVELOPE_KIND = "barwarden.generator-history-v2";

/** Persists generated credentials in account-scoped secure storage. */
export class GeneratorHistoryStore {
  private readonly mutationQueues = new Map<string, Promise<void>>();

  constructor(private readonly host: HostApi) {}

  async credentials(accountId: string): Promise<readonly GeneratedCredential[]> {
    let raw: string | null;
    try {
      raw = await this.host.secureGet(generatorHistoryStorageKey(accountId));
    } catch {
      throw storageError("read");
    }

    return deserializeCredentials(raw);
  }

  track(
    accountId: string,
    credential: GeneratedCredential,
    isCurrent: () => Promise<boolean> = async () => true,
  ): Promise<void> {
    return this.prepareTrack(accountId, credential, isCurrent).then((pending) => {
      pending.commit();
    });
  }

  async prepareTrack(
    accountId: string,
    credential: GeneratedCredential,
    isCurrent: () => Promise<boolean> = async () => true,
  ): Promise<PendingGeneratorHistoryTrack> {
    const previous = this.mutationQueues.get(accountId) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const pendingGate = new Promise<void>((resolve) => { releaseQueue = resolve; });
    let settled = false;
    let key = "";
    let previousRaw: string | null = null;
    let writtenRaw: string | null = null;
    let wrote = false;

    const prepared = previous.then(async () => {
      key = generatorHistoryStorageKey(accountId);
      for (let attempt = 0; attempt < 32; attempt += 1) {
        previousRaw = await this.readRaw(key);
        const history = deserializeHistory(previousRaw);
        const entries = history.credentials;
        if (entries.some((entry) => entry.credential === credential.credential)) {
          return;
        }
        if (!await retainsOwnership(isCurrent)) {
          throw ownershipError();
        }
        writtenRaw = serializeCredentials(
          [credential, ...entries],
          history.clearLineage,
        );
        if (await this.compareAndSwap(key, previousRaw, writtenRaw, "update")) {
          wrote = true;
          break;
        }
      }
      if (!wrote) throw storageError("update");
      if (!await retainsOwnership(isCurrent)) {
        await this.rollbackTrack(key, credential.credential, writtenRaw, previousRaw);
        wrote = false;
        throw ownershipError();
      }
    });

    const queueTail = prepared.then(() => pendingGate, () => undefined);
    this.mutationQueues.set(accountId, queueTail);
    const cleanupQueue = () => {
      if (this.mutationQueues.get(accountId) === queueTail) {
        this.mutationQueues.delete(accountId);
      }
    };
    void queueTail.then(cleanupQueue, cleanupQueue);

    try {
      await prepared;
    } catch (error) {
      settled = true;
      releaseQueue();
      throw error;
    }

    return {
      commit: () => {
        if (settled) return;
        settled = true;
        releaseQueue();
      },
      rollback: async () => {
        if (settled) return;
        settled = true;
        try {
          if (wrote) {
            await this.rollbackTrack(key, credential.credential, writtenRaw, previousRaw);
          }
        } finally {
          releaseQueue();
        }
      },
    };
  }

  clear(
    accountId: string,
    isCurrent: () => Promise<boolean> = async () => true,
  ): Promise<void> {
    return this.prepareClear(accountId, isCurrent).then((pending) => {
      pending.commit();
    });
  }

  async prepareClear(
    accountId: string,
    isCurrent: () => Promise<boolean> = async () => true,
  ): Promise<PendingGeneratorHistoryClear> {
    const previous = this.mutationQueues.get(accountId) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const pendingGate = new Promise<void>((resolve) => { releaseQueue = resolve; });
    let settled = false;
    let key = "";
    let previousRaw: string | null = null;
    const clearMarker = createClearMarker();
    let wroteClearMarker = false;

    const prepared = previous.then(async () => {
      key = generatorHistoryStorageKey(accountId);
      let cleared = false;
      for (let attempt = 0; attempt < 32; attempt += 1) {
        previousRaw = await this.readRaw(key);
        if (!await retainsOwnership(isCurrent)) {
          throw clearOwnershipError();
        }
        if (await this.compareAndSwap(key, previousRaw, clearMarker, "clear")) {
          wroteClearMarker = true;
          cleared = true;
          break;
        }
      }
      if (!cleared) throw storageError("clear");
      if (!await retainsOwnership(isCurrent)) {
        await this.restoreCleared(key, clearMarker, previousRaw);
        wroteClearMarker = false;
        throw clearOwnershipError();
      }
    });

    const queueTail = prepared.then(() => pendingGate, () => undefined);
    this.mutationQueues.set(accountId, queueTail);
    const cleanupQueue = () => {
      if (this.mutationQueues.get(accountId) === queueTail) {
        this.mutationQueues.delete(accountId);
      }
    };
    void queueTail.then(cleanupQueue, cleanupQueue);

    try {
      await prepared;
    } catch (error) {
      settled = true;
      releaseQueue();
      throw error;
    }

    return {
      commit: () => {
        if (settled) return;
        settled = true;
        releaseQueue();
      },
      rollback: async () => {
        if (settled) return;
        settled = true;
        try {
          if (wroteClearMarker) {
            await this.restoreCleared(key, clearMarker, previousRaw);
          }
        } finally {
          releaseQueue();
        }
      },
    };
  }

  private async readRaw(key: string): Promise<string | null> {
    try {
      return await this.host.secureGet(key);
    } catch {
      throw storageError("read");
    }
  }

  private async compareAndSwap(
    key: string,
    expected: string | null,
    replacement: string | null,
    operation: "update" | "clear",
  ): Promise<boolean> {
    try {
      if (isCompareAndSwapHost(this.host)) {
        return await this.host.secureCompareAndSwap(key, expected, replacement);
      }
      if (await this.host.secureGet(key) !== expected) return false;
      if (replacement === null) await this.host.secureDelete(key);
      else await this.host.secureSet(key, replacement);
      return true;
    } catch {
      throw storageError(operation);
    }
  }

  private async rollbackTrack(
    key: string,
    credential: string,
    writtenRaw: string | null,
    previousRaw: string | null,
  ): Promise<void> {
    if (writtenRaw !== null && await this.compareAndSwap(key, writtenRaw, previousRaw, "update")) {
      return;
    }
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const currentRaw = await this.readRaw(key);
      const currentHistory = deserializeHistory(currentRaw);
      const current = currentHistory.credentials;
      const retained = current.filter((entry) => entry.credential !== credential);
      if (retained.length === current.length) return;
      const replacement = retained.length === 0 && currentHistory.clearLineage === null
        ? null
        : serializeCredentials(retained, currentHistory.clearLineage);
      if (await this.compareAndSwap(key, currentRaw, replacement, "update")) return;
    }
    throw storageError("update");
  }

  private async restoreCleared(
    key: string,
    clearMarker: string,
    previousRaw: string | null,
  ): Promise<void> {
    const ownClearLineage = clearMarkerId(clearMarker);
    if (ownClearLineage === null) throw storageError("update");
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const currentRaw = await this.readRaw(key);
      if (currentRaw === clearMarker) {
        if (await this.compareAndSwap(key, clearMarker, previousRaw, "update")) return;
        continue;
      }
      if (currentRaw === null || isClearMarker(currentRaw)) return;
      const currentHistory = deserializeHistory(currentRaw);
      if (currentHistory.clearLineage !== ownClearLineage) return;
      const previousHistory = deserializeHistory(previousRaw);
      const replacement = serializeCredentials([
        ...currentHistory.credentials,
        ...previousHistory.credentials,
      ], previousHistory.clearLineage);
      if (await this.compareAndSwap(key, currentRaw, replacement, "update")) return;
    }
    throw storageError("update");
  }
}

export function generatorHistoryStorageKey(accountId: string): string {
  return `${HISTORY_KEY_PREFIX}${encodeURIComponent(accountId)}`;
}

function deserializeCredentials(raw: string | null): GeneratedCredential[] {
  return deserializeHistory(raw).credentials;
}

function deserializeHistory(raw: string | null): {
  credentials: GeneratedCredential[];
  clearLineage: string | null;
} {
  if (!raw) {
    return { credentials: [], clearLineage: null };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const clearLineage = clearMarkerIdFromValue(parsed);
    if (clearLineage !== null) return { credentials: [], clearLineage };
    const values = Array.isArray(parsed)
      ? parsed
      : isHistoryEnvelope(parsed)
        ? parsed["entries"]
        : [];
    const envelopeLineage = isHistoryEnvelope(parsed) ? parsed["clearLineage"] : null;

    const credentials: GeneratedCredential[] = [];
    const credentialValues = new Set<string>();
    for (const credential of values.flatMap(deserializeCredential)) {
      if (!credentialValues.has(credential.credential)) {
        credentialValues.add(credential.credential);
        credentials.push(credential);
      }
      if (credentials.length === MAX_HISTORY_ENTRIES) {
        break;
      }
    }

    return { credentials, clearLineage: envelopeLineage };
  } catch {
    return { credentials: [], clearLineage: null };
  }
}

function deserializeCredential(value: unknown): GeneratedCredential[] {
  if (!isRecord(value)) {
    return [];
  }

  const generationDate = new Date(value["generationDate"] as string | number);
  if (
    typeof value["credential"] !== "string" ||
    (value["category"] !== "password" && value["category"] !== "username") ||
    !isAlgorithm(value["algorithm"]) ||
    Number.isNaN(generationDate.valueOf())
  ) {
    return [];
  }

  return [
    {
      credential: value["credential"],
      category: value["category"],
      generationDate,
      algorithm: value["algorithm"],
    },
  ];
}

function serializeCredential(credential: GeneratedCredential) {
  return {
    credential: credential.credential,
    category: credential.category,
    generationDate: credential.generationDate.valueOf(),
    algorithm: credential.algorithm,
  };
}

function serializeCredentials(
  credentials: readonly GeneratedCredential[],
  clearLineage: string | null = null,
): string {
  return JSON.stringify({
    kind: HISTORY_ENVELOPE_KIND,
    clearLineage,
    entries: credentials
      .filter((credential, index, all) =>
        all.findIndex((candidate) => candidate.credential === credential.credential) === index)
      .slice(0, MAX_HISTORY_ENTRIES)
      .map(serializeCredential),
  });
}

function createClearMarker(): string {
  return JSON.stringify({ kind: CLEAR_MARKER_KIND, id: globalThis.crypto.randomUUID() });
}

function isClearMarker(raw: string): boolean {
  return clearMarkerId(raw) !== null;
}

function clearMarkerId(raw: string): string | null {
  try {
    const value = JSON.parse(raw) as unknown;
    return clearMarkerIdFromValue(value);
  } catch {
    return null;
  }
}

function clearMarkerIdFromValue(value: unknown): string | null {
  return isRecord(value)
    && value["kind"] === CLEAR_MARKER_KIND
    && typeof value["id"] === "string"
    ? value["id"]
    : null;
}

function isHistoryEnvelope(value: unknown): value is Record<string, unknown> & {
  entries: unknown[];
  clearLineage: string | null;
} {
  return isRecord(value)
    && value["kind"] === HISTORY_ENVELOPE_KIND
    && Array.isArray(value["entries"])
    && (value["clearLineage"] === null || typeof value["clearLineage"] === "string");
}

function isCompareAndSwapHost(host: HostApi): host is HostApi & SecureCompareAndSwapHost {
  return "secureCompareAndSwap" in host
    && typeof host.secureCompareAndSwap === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAlgorithm(value: unknown): value is GeneratedCredential["algorithm"] {
  return value === "password" || value === "passphrase" || value === "username";
}

function storageError(operation: "read" | "update" | "clear"): Error {
  switch (operation) {
    case "read":
      return new Error("Unable to read generator history");
    case "update":
      return new Error("Unable to update generator history");
    case "clear":
      return new Error("Unable to clear generator history");
  }
}

function ownershipError(): Error {
  return new Error("Generator account changed or locked during generation");
}

function clearOwnershipError(): Error {
  return new Error("Generator account changed or locked during history clear");
}

async function retainsOwnership(isCurrent: () => Promise<boolean>): Promise<boolean> {
  try {
    return await isCurrent();
  } catch {
    return false;
  }
}
