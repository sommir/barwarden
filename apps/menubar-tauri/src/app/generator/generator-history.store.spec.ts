import { describe, expect, it, vi } from "vitest";

import type { HostApi } from "../../host/host-api";
import {
  GeneratorHistoryStore,
  type GeneratedCredential,
} from "./generator-history.store";

describe("GeneratorHistoryStore", () => {
  it("keeps account histories separate and newest first", async () => {
    const store = new GeneratorHistoryStore(new MemoryHost());

    await store.track("account-a", credential("first", 1));
    await store.track("account-b", credential("other", 2));
    await store.track("account-a", credential("newest", 3));

    await expect(store.credentials("account-a")).resolves.toMatchObject([
      { credential: "newest" },
      { credential: "first" },
    ]);
    await expect(store.credentials("account-b")).resolves.toMatchObject([{ credential: "other" }]);
  });

  it("deduplicates values and retains the official maximum of 200 entries", async () => {
    const store = new GeneratorHistoryStore(new MemoryHost());

    await Promise.all(
      Array.from({ length: 201 }, (_, index) =>
        store.track("account-a", credential(`value-${index}`, index)),
      ),
    );
    await store.track("account-a", credential("value-200", 202));

    const entries = await store.credentials("account-a");
    expect(entries).toHaveLength(200);
    expect(entries.filter((entry) => entry.credential === "value-200")).toHaveLength(1);
    expect(entries[0]?.credential).toBe("value-200");
    expect(entries.at(-1)?.credential).toBe("value-1");
  });

  it("recovers from malformed secure storage without exposing a stored credential", async () => {
    const host = new MemoryHost();
    host.values.set("generator.history.account-a", "{not json: secret-value}");
    const store = new GeneratorHistoryStore(host);

    await expect(store.credentials("account-a")).resolves.toEqual([]);
  });

  it("canonicalizes duplicate persisted values using the newest occurrence", async () => {
    const host = new MemoryHost();
    host.values.set(
      "generator.history.account-a",
      JSON.stringify([
        { credential: "newest", category: "password", generationDate: 3, algorithm: "password" },
        { credential: "duplicate", category: "password", generationDate: 2, algorithm: "password" },
        { credential: "duplicate", category: "username", generationDate: 1, algorithm: "username" },
      ]),
    );

    await expect(new GeneratorHistoryStore(host).credentials("account-a")).resolves.toEqual([
      credential("newest", 3),
      credential("duplicate", 2),
    ]);
  });

  it("clears only the requested account history", async () => {
    const store = new GeneratorHistoryStore(new MemoryHost());
    await store.track("account-a", credential("remove-me", 1));
    await store.track("account-b", credential("keep-me", 2));

    await store.clear("account-a");

    await expect(store.credentials("account-a")).resolves.toEqual([]);
    await expect(store.credentials("account-b")).resolves.toMatchObject([{ credential: "keep-me" }]);
  });

  it("does not include a generated credential in a secure storage error", async () => {
    const secret = "do-not-leak-generated-value";
    const host = new MemoryHost();
    host.secureSet = vi.fn(async () => {
      throw new Error(`failed to save ${secret}`);
    });
    const store = new GeneratorHistoryStore(host);

    await expect(store.track("account-a", credential(secret, 1))).rejects.toThrow(
      "Unable to update generator history",
    );
    await expect(store.track("account-a", credential(secret, 1))).rejects.not.toThrow(secret);
  });

  it("restores the previous secure value when ownership is lost during a history write", async () => {
    const host = new MemoryHost();
    const store = new GeneratorHistoryStore(host);
    await store.track("account-a", credential("existing", 1));
    let owned = true;
    host.afterSecureSet = () => { owned = false; };

    await expect(
      store.track("account-a", credential("stale", 2), async () => owned),
    ).rejects.toThrow("Generator account changed or locked during generation");

    await expect(store.credentials("account-a")).resolves.toEqual([credential("existing", 1)]);
  });

  it("holds the account mutation queue until a prepared track commits", async () => {
    const host = new MemoryHost();
    const store = new GeneratorHistoryStore(host);
    const pending = await store.prepareTrack("account-a", credential("first", 1), async () => true);

    const second = store.track("account-a", credential("second", 2));
    await Promise.resolve();
    expect(host.secureSet).toHaveBeenCalledTimes(1);

    pending.commit();
    await second;
    await expect(store.credentials("account-a")).resolves.toEqual([
      credential("second", 2),
      credential("first", 1),
    ]);
  });

  it("rolls back before a queued mutation so the restore cannot clobber it", async () => {
    const host = new MemoryHost();
    const store = new GeneratorHistoryStore(host);
    await store.track("account-a", credential("existing", 0));
    const pending = await store.prepareTrack("account-a", credential("stale", 1), async () => true);
    const second = store.track("account-a", credential("second", 2));

    await pending.rollback();
    await second;

    await expect(store.credentials("account-a")).resolves.toEqual([
      credential("second", 2),
      credential("existing", 0),
    ]);
  });

  it("restores secure history when clear loses ownership after the marker write", async () => {
    const host = new MemoryHost();
    const store = new GeneratorHistoryStore(host);
    await store.track("account-a", credential("keep-after-stale-clear", 1));
    let owned = true;
    host.afterSecureSet = () => { owned = false; };

    const transactionalStore = store as GeneratorHistoryStore & {
      prepareClear(accountId: string, isCurrent: () => Promise<boolean>): Promise<unknown>;
    };
    await expect(
      transactionalStore.prepareClear("account-a", async () => owned),
    ).rejects.toThrow("Generator account changed or locked during history clear");

    await expect(store.credentials("account-a")).resolves.toEqual([
      credential("keep-after-stale-clear", 1),
    ]);
  });

  it("restores secure history when the post-delete ownership check fails", async () => {
    const host = new MemoryHost();
    const store = new GeneratorHistoryStore(host);
    await store.track("account-a", credential("keep-after-check-failure", 1));
    let checks = 0;

    await expect(store.prepareClear("account-a", async () => {
      checks += 1;
      if (checks === 1) return true;
      throw new Error("private ownership failure");
    })).rejects.toThrow("Generator account changed or locked during history clear");

    await expect(store.credentials("account-a")).resolves.toEqual([
      credential("keep-after-check-failure", 1),
    ]);
  });

  it("linearizes track and clear across independent webview store instances", async () => {
    const host = new CrossWebviewHost();
    host.values.set(
      "generator.history.account-a",
      JSON.stringify([credential("cleared-before-track-commit", 1)]),
    );
    const mainWindow = new GeneratorHistoryStore(host);
    const popOutWindow = new GeneratorHistoryStore(host);

    const tracking = mainWindow.track("account-a", credential("generated-concurrently", 2));
    await host.firstWriteStarted;
    await popOutWindow.clear("account-a");
    host.releaseFirstWrite();
    await tracking;

    await expect(mainWindow.credentials("account-a")).resolves.toEqual([
      credential("generated-concurrently", 2),
    ]);
  });

  it("restores stale clear without clobbering another webview's new credential", async () => {
    const host = new AtomicMemoryHost();
    host.values.set(
      "generator.history.account-a",
      JSON.stringify([credential("restore-after-stale-clear", 1)]),
    );
    const mainWindow = new GeneratorHistoryStore(host);
    const popOutWindow = new GeneratorHistoryStore(host);
    let checks = 0;
    const postDeleteCheck = deferred<void>();
    const continuePostDeleteCheck = deferred<void>();

    const clearing = mainWindow.prepareClear("account-a", async () => {
      checks += 1;
      if (checks === 1) return true;
      postDeleteCheck.resolve();
      await continuePostDeleteCheck.promise;
      return false;
    });
    await postDeleteCheck.promise;
    await popOutWindow.track("account-a", credential("generated-after-clear", 2));
    continuePostDeleteCheck.resolve();

    await expect(clearing).rejects.toThrow(
      "Generator account changed or locked during history clear",
    );
    await expect(mainWindow.credentials("account-a")).resolves.toEqual([
      credential("generated-after-clear", 2),
      credential("restore-after-stale-clear", 1),
    ]);
  });

  it("does not let a stale clear undo a newer clear from another webview", async () => {
    const host = new AtomicMemoryHost();
    host.values.set(
      "generator.history.account-a",
      JSON.stringify([credential("must-stay-cleared", 1)]),
    );
    const mainWindow = new GeneratorHistoryStore(host);
    const popOutWindow = new GeneratorHistoryStore(host);
    let checks = 0;
    const postClearCheck = deferred<void>();
    const continuePostClearCheck = deferred<void>();

    const staleClear = mainWindow.prepareClear("account-a", async () => {
      checks += 1;
      if (checks === 1) return true;
      postClearCheck.resolve();
      await continuePostClearCheck.promise;
      return false;
    });
    await postClearCheck.promise;
    await popOutWindow.clear("account-a");
    continuePostClearCheck.resolve();

    await expect(staleClear).rejects.toThrow(
      "Generator account changed or locked during history clear",
    );
    await expect(mainWindow.credentials("account-a")).resolves.toEqual([]);
  });

  it("does not restore pre-clear entries after a newer clear followed by a track", async () => {
    const host = new AtomicMemoryHost();
    host.values.set(
      "generator.history.account-a",
      JSON.stringify([credential("old-before-two-clears", 1)]),
    );
    const staleWindow = new GeneratorHistoryStore(host);
    const currentWindow = new GeneratorHistoryStore(host);
    let checks = 0;
    const postClearCheck = deferred<void>();
    const continuePostClearCheck = deferred<void>();

    const staleClear = staleWindow.prepareClear("account-a", async () => {
      checks += 1;
      if (checks === 1) return true;
      postClearCheck.resolve();
      await continuePostClearCheck.promise;
      return false;
    });
    await postClearCheck.promise;
    await currentWindow.clear("account-a");
    await currentWindow.track("account-a", credential("fresh-after-newer-clear", 2));
    continuePostClearCheck.resolve();

    await expect(staleClear).rejects.toThrow(
      "Generator account changed or locked during history clear",
    );
    await expect(staleWindow.credentials("account-a")).resolves.toEqual([
      credential("fresh-after-newer-clear", 2),
    ]);
  });
});

function credential(value: string, timestamp: number): GeneratedCredential {
  return {
    credential: value,
    category: "password",
    generationDate: new Date(timestamp),
    algorithm: "password",
  };
}

class MemoryHost implements HostApi {
  readonly values = new Map<string, string>();
  afterSecureSet: (() => void) | null = null;
  afterSecureDelete: (() => void) | null = null;

  showPopup = async () => undefined;
  hidePopup = async () => undefined;
  copyText = async () => undefined;
  pasteText = async () => undefined;
  openUrl = async () => undefined;
  secureGet = async (key: string) => this.values.get(key) ?? null;
  secureSet = vi.fn(async (key: string, value: string) => {
    this.values.set(key, value);
    this.afterSecureSet?.();
  });
  secureDelete = async (key: string) => {
    this.values.delete(key);
    this.afterSecureDelete?.();
  };
}

class CrossWebviewHost extends MemoryHost {
  private releaseWrite!: () => void;
  private readonly writeBarrier = new Promise<void>((resolve) => { this.releaseWrite = resolve; });
  private startWrite!: () => void;
  readonly firstWriteStarted = new Promise<void>((resolve) => { this.startWrite = resolve; });
  private blockFirstWrite = true;

  override secureSet = vi.fn(async (key: string, value: string) => {
    if (this.blockFirstWrite) {
      this.blockFirstWrite = false;
      this.startWrite();
      await this.writeBarrier;
    }
    this.values.set(key, value);
  });

  async secureCompareAndSwap(
    key: string,
    expected: string | null,
    replacement: string | null,
  ): Promise<boolean> {
    if (this.blockFirstWrite && replacement !== null) {
      this.blockFirstWrite = false;
      this.startWrite();
      await this.writeBarrier;
    }
    if ((this.values.get(key) ?? null) !== expected) return false;
    if (replacement === null) this.values.delete(key);
    else this.values.set(key, replacement);
    return true;
  }

  releaseFirstWrite(): void {
    this.releaseWrite();
  }
}

class AtomicMemoryHost extends MemoryHost {
  async secureCompareAndSwap(
    key: string,
    expected: string | null,
    replacement: string | null,
  ): Promise<boolean> {
    if ((this.values.get(key) ?? null) !== expected) return false;
    if (replacement === null) this.values.delete(key);
    else this.values.set(key, replacement);
    this.afterSecureSet?.();
    if (replacement === null) this.afterSecureDelete?.();
    return true;
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
