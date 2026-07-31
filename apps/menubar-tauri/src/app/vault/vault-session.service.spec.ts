import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import {
  AccountSessionReplacementConsistencyError,
  type AccountSessionPort,
} from "../../auth/account-session-port";
import {
  BitwardenApiError,
  buildBitwardenEnvironment,
  buildSelfHostedEnvironmentFromServerUrl,
} from "../../bitwarden-api/bitwarden-api";
import { PopupStateStore } from "../popup-state";
import { demoFolders, demoVaultItems } from "../vault-demo";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { VaultSessionService } from "./vault-session.service";

describe("VaultSessionService", () => {
  it("syncNow uses the active session and preserves previous items on failure", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("user@example.com");
    store.setItems([demoVaultItems[0]], demoFolders);
    const sync = new VaultSessionService(store, {
      sync: async () => {
        throw new Error("network down");
      },
    });

    await sync.syncNow();

    expect(store.snapshot().items).toEqual([demoVaultItems[0]]);
    expect(store.snapshot()).toMatchObject({
      syncError: "无法同步，正在显示已保存的密码库数据。",
      vaultSyncStatus: "stale",
      vaultSyncMessage: "无法同步，正在显示已保存的密码库数据。",
    });
    expect(store.snapshot().syncError).not.toContain("network down");
  });

  it("marks an initial sync failure unavailable without exposing the server error", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("user@example.com");
    const sync = new VaultSessionService(store, {
      sync: async () => {
        throw new Error("opaque private response");
      },
    });

    await sync.syncNow();

    expect(store.snapshot()).toMatchObject({
      items: [],
      vaultSyncStatus: "unavailable",
      syncError: "无法加载密码库，请重试。",
    });
    expect(store.snapshot().statusMessage).not.toContain("opaque private response");
  });

  it("marks a folder-only retained vault stale after an offline failure", async () => {
    const state = await offlineState((store) => store.setItems([], demoFolders, retainedDate));
    expect(state.vaultSyncStatus).toBe("stale");
  });

  it("marks a Text-Send-only retained vault stale after an offline failure", async () => {
    const state = await offlineState((store) => {
      store.setItems([], [], retainedDate);
      store.setSends([retainedTextSend]);
    });
    expect(state.vaultSyncStatus).toBe("stale");
  });

  it("marks an archived-only retained vault stale after an offline failure", async () => {
    const state = await offlineState((store) => {
      store.setItems([], [], retainedDate);
      store.setArchivedItems([demoVaultItems[0]]);
    });
    expect(state.vaultSyncStatus).toBe("stale");
  });

  it("marks a deleted-only retained vault stale after an offline failure", async () => {
    const state = await offlineState((store) => {
      store.setItems([], [], retainedDate);
      store.setDeletedItems([demoVaultItems[0]]);
    });
    expect(state.vaultSyncStatus).toBe("stale");
  });

  it("marks a truly empty retained vault unavailable after an offline failure", async () => {
    const state = await offlineState((store) => store.setItems([], [], retainedDate));
    expect(state.vaultSyncStatus).toBe("unavailable");
  });

  it("does not count excluded SSH ciphers or File Sends as retained cache", async () => {
    const state = await offlineState((store) => {
      store.setItems([{ ...demoVaultItems[0], type: "ssh-key" }], [], retainedDate);
      store.setSends([{ ...retainedTextSend, type: "file" }]);
    });
    expect(state.vaultSyncStatus).toBe("unavailable");
  });

  it("retains projected items, folders, sends, and the successful date after an offline retry", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("user@example.com");
    const sends = [{
      id: "send-1", accessId: "access-1", type: "text" as const, name: "Retained send", notes: "",
      accessCount: 0, revisionDate: "", deletionDate: "", disabled: false,
    }];
    const sync = new VaultSessionService(store, {
      sync: vi.fn()
        .mockResolvedValueOnce({
          cipherCount: 1, encryptedCipherCount: 0, folderCount: demoFolders.length, sendCount: sends.length,
          items: [demoVaultItems[0]], archivedItems: [], deletedItems: [], folders: demoFolders,
          organizations: [], collections: [], sends,
        })
        .mockRejectedValueOnce(new Error("offline private response")),
    });

    await sync.syncNow();
    const successfulDate = store.snapshot().lastSuccessfulSyncDate;
    await sync.syncNow();

    expect(store.snapshot()).toMatchObject({
      items: [demoVaultItems[0]], folders: demoFolders, sends, vaultSyncStatus: "stale",
      lastSuccessfulSyncDate: successfulDate,
      vaultSyncMessage: "无法同步，正在显示已保存的密码库数据。",
    });
  });

  it("stores organizations and collections returned by sync", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("user@example.com");
    const organizations = [
      { id: "org-1", name: "Engineering", enabled: true, status: 2 },
    ];
    const collections = [
      {
        id: "collection-1",
        organizationId: "org-1",
        name: "Production",
        readOnly: false,
        manage: true,
      },
    ];
    const sync = new VaultSessionService(store, {
      sync: async () => ({
        cipherCount: 0,
        encryptedCipherCount: 0,
        folderCount: 0,
        sendCount: 0,
        items: [],
        archivedItems: [],
        deletedItems: [],
        folders: [],
        sends: [],
        organizations,
        collections,
      }),
    });

    await sync.syncNow();

    expect(store.snapshot().organizations).toEqual(organizations);
    expect(store.snapshot().collections).toEqual(collections);
  });

  it("publishes fresh active, archived, and deleted collection identities for a completed sync", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("user@example.com");
    store.setItems([demoVaultItems[0]]);
    store.setArchivedItems([demoVaultItems[1]]);
    store.setDeletedItems([demoVaultItems[2]]);
    const before = store.snapshot();
    const synced = {
      items: [demoVaultItems[1]],
      archivedItems: [demoVaultItems[2]],
      deletedItems: [demoVaultItems[3]],
      folders: demoFolders,
      organizations: [],
      collections: [],
      sends: [],
      cipherCount: 3,
      encryptedCipherCount: 0,
      folderCount: demoFolders.length,
      sendCount: 0,
    };

    await new VaultSessionService(store, { sync: vi.fn(async () => synced) }).syncNow();

    expect(store.snapshot().items).toBe(synced.items);
    expect(store.snapshot().archivedItems).toBe(synced.archivedItems);
    expect(store.snapshot().deletedItems).toBe(synced.deletedItems);
    expect(store.snapshot().items).not.toBe(before.items);
    expect(store.snapshot().archivedItems).not.toBe(before.archivedItems);
    expect(store.snapshot().deletedItems).not.toBe(before.deletedItems);
  });

  it("builds the default sync client from the active session environment instead of popup serverUrl", async () => {
    const store = new PopupStateStore();
    const session = fakeAuthSession("https://session.example.com");
    store.setActiveSession(session);
    store.setUnlocked("user@example.com");
    store.setServerUrl("https://popup.example.com");

    const fetchSpy = vi.fn(async () =>
      jsonResponse({
        Ciphers: [],
        Folders: [],
        Sends: [
          {
            Id: "send-1",
            AccessId: "access-1",
            Type: 0,
            Name: "Demo Send",
            AccessCount: 0,
            RevisionDate: "",
            DeletionDate: "",
            Disabled: false,
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await new VaultSessionService(store).syncNow();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      "https://session.example.com/api/sync?excludeDomains=true",
    );
    expect(store.snapshot().sends.map((send) => send.name)).toEqual(["Demo Send"]);
  });

  it("marks sync as loading only while the request is pending", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("user@example.com");
    let resolveSync = () => undefined;
    const syncPort = {
      sync: vi.fn(
        () =>
          new Promise<any>((resolve) => {
            resolveSync = () =>
              resolve({
                cipherCount: demoVaultItems.length,
                encryptedCipherCount: 0,
                folderCount: demoFolders.length,
                folders: demoFolders,
                items: demoVaultItems,
                sends: [],
                sendCount: 0,
              });
          }),
      ),
    };

    const syncPromise = new VaultSessionService(store, syncPort).syncNow();

    expect(store.snapshot().isSyncing).toBe(true);
    resolveSync();
    await syncPromise;

    expect(store.snapshot().isSyncing).toBe(false);
  });

  it("ignores an older failed sync after a newer sync succeeds", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("user@example.com");
    const older = deferred<any>();
    const newer = deferred<any>();
    const syncPort = { sync: vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise) };
    const service = new VaultSessionService(store, syncPort);

    const first = service.syncNow();
    const second = service.syncNow();
    newer.resolve({
      cipherCount: 1,
      encryptedCipherCount: 0,
      folderCount: demoFolders.length,
      sendCount: 0,
      items: [demoVaultItems[0]],
      archivedItems: [],
      deletedItems: [],
      folders: demoFolders,
      organizations: [],
      collections: [],
      sends: [],
    });
    await second;
    older.reject(new Error("older private failure"));
    await first;

    expect(store.snapshot()).toMatchObject({
      items: [demoVaultItems[0]],
      vaultSyncStatus: "fresh",
      syncError: "",
    });
  });

  it("emits nothing when a stale vault sync completes after lock", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("user@example.com");
    const pending = deferred<any>();
    const emissions: string[] = [];
    const subscription = store.state$.subscribe((state) => {
      emissions.push(`${state.isUnlocked}|${state.isSyncing}|${state.vaultSyncStatus}|${state.items.length}`);
    });

    const syncing = new VaultSessionService(store, { sync: () => pending.promise }).syncNow();
    store.setLocked();
    pending.resolve({
      cipherCount: 1,
      encryptedCipherCount: 0,
      folderCount: demoFolders.length,
      sendCount: 0,
      items: [demoVaultItems[0]],
      archivedItems: [],
      deletedItems: [],
      folders: demoFolders,
      organizations: [],
      collections: [],
      sends: [],
    });
    await syncing;
    subscription.unsubscribe();

    expect(emissions).toEqual([
      "true|false|initial|0",
      "true|true|syncing|0",
      "false|false|initial|0",
    ]);
  });

  it("shares sync ordering across separate service instances", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("user@example.com");
    const older = deferred<any>();
    const newer = deferred<any>();
    const first = new VaultSessionService(store, { sync: () => older.promise }).syncNow();
    const second = new VaultSessionService(store, { sync: () => newer.promise }).syncNow();

    newer.resolve({
      cipherCount: 1,
      encryptedCipherCount: 0,
      folderCount: demoFolders.length,
      sendCount: 0,
      items: [demoVaultItems[0]],
      archivedItems: [],
      deletedItems: [],
      folders: demoFolders,
      organizations: [],
      collections: [],
      sends: [],
    });
    await second;
    older.reject(new Error("older cross-instance failure"));
    await first;

    expect(store.snapshot()).toMatchObject({
      items: [demoVaultItems[0]],
      vaultSyncStatus: "fresh",
      syncError: "",
    });
  });

  it("syncNow does not call the API while locked even when a session is present", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    const syncPort = {
      sync: vi.fn(async () => ({
        cipherCount: 0,
        encryptedCipherCount: 0,
        folderCount: 0,
        items: [],
        sends: [],
        sendCount: 0,
      })),
    };

    await new VaultSessionService(store, syncPort).syncNow();

    expect(syncPort.sync).not.toHaveBeenCalled();
    expect(store.snapshot().syncError).toBe("会话已锁定。");
    expect(store.snapshot().statusMessage).toBe("会话已锁定。");
  });

  it("localizes session and sync feedback with the active official locale", async () => {
    await new OfficialI18nService().setLocale("zh-CN");
    try {
      const lockedStore = new PopupStateStore();
      await new VaultSessionService(lockedStore).syncNow();
      expect(lockedStore.snapshot()).toMatchObject({
        syncError: "会话已锁定。",
        statusMessage: "会话已锁定。",
      });

      const store = new PopupStateStore();
      store.setUnlocked("user@example.com");
      store.setActiveSession(fakeAuthSession());
      await new VaultSessionService(store, {
        sync: async () => ({
          cipherCount: 2,
          encryptedCipherCount: 2,
          folderCount: 0,
          items: demoVaultItems.slice(0, 2),
          archivedItems: [],
          deletedItems: [],
          folders: [],
          organizations: [],
          collections: [],
          sends: [],
          sendCount: 0,
          sendPolicy: { disabled: false, hideEmailAllowed: true },
        }),
      }).syncNow();
      expect(store.snapshot().statusMessage).toBe("已同步 2 个项目和 0 个 Send。");
    } finally {
      await new OfficialI18nService().setLocale("zh-CN");
    }
  });

  it("discards sync results when the vault locks before the request finishes", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("user@example.com");
    const syncPort = {
      sync: vi.fn(async () => {
        store.setLocked();
        return {
          cipherCount: 1,
          encryptedCipherCount: 0,
          folderCount: demoFolders.length,
          folders: demoFolders,
          items: [demoVaultItems[0]],
          sends: [
            {
              id: "send-1",
              accessId: "access-1",
              type: "text" as const,
              name: "Demo Send",
              notes: "",
              revisionDate: "",
              deletionDate: "",
              disabled: false,
              accessCount: 0,
            },
          ],
          sendCount: 1,
        };
      }),
    };

    await new VaultSessionService(store, syncPort).syncNow();

    expect(syncPort.sync).toHaveBeenCalledTimes(1);
    expect(store.snapshot().isUnlocked).toBe(false);
    expect(store.snapshot().activeSession).toBeNull();
    expect(store.snapshot().items).toEqual([]);
    expect(store.snapshot().sends).toEqual([]);
    expect(store.snapshot()).toMatchObject({
      syncError: "",
      vaultSyncStatus: "initial",
      vaultSyncMessage: "",
    });
  });

  it("does not let a pending sync pollute logged-out state", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("user@example.com");
    const pending = deferred<any>();
    const syncing = new VaultSessionService(store, { sync: () => pending.promise }).syncNow();

    store.setLoggedOut();
    const loggedOutState = store.snapshot();
    pending.reject(new Error("late private failure"));
    await syncing;

    expect(store.snapshot()).toEqual(loggedOutState);
  });

  it("makes no popup writes when an operation guard becomes stale", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("attempt@example.com");
    const pending = deferred<any>();
    let current = true;
    const service = new VaultSessionService(store, { sync: () => pending.promise });
    const syncing = service.syncNow(() => current);
    expect(store.snapshot().isSyncing).toBe(true);

    current = false;
    store.setLockedAccount("baseline@example.com", "https://vault.baseline.example.com");
    store.setStatus("Baseline locked");
    const canceledState = store.snapshot();
    pending.resolve({
      cipherCount: 1,
      encryptedCipherCount: 0,
      folderCount: demoFolders.length,
      sendCount: 0,
      items: demoVaultItems,
      archivedItems: [],
      deletedItems: [],
      folders: demoFolders,
      organizations: [],
      collections: [],
      sends: [],
    });
    await syncing;

    expect(store.snapshot()).toEqual(canceledState);
  });

  it("persists a refreshed active session before retrying sync exactly once", async () => {
    const store = new PopupStateStore();
    const staleSession = fakeAuthSession();
    store.setActiveSession(staleSession);
    store.setUnlocked("user@example.com");
    const accountStore = {
      replaceSession: vi.fn(async () => undefined),
    };
    const syncPort = {
      sync: vi
        .fn()
        .mockRejectedValueOnce(new BitwardenApiError(401, { ErrorModel: { Message: "expired" } }))
        .mockResolvedValueOnce({
          cipherCount: 0,
          encryptedCipherCount: 0,
          folderCount: 0,
          sendCount: 0,
          items: [],
          archivedItems: [],
          deletedItems: [],
          folders: [],
          organizations: [],
          collections: [],
          sends: [],
        }),
    };
    const refresh = {
      refresh: vi.fn(async () => ({
        ...staleSession,
        token: {
          ...staleSession.token,
          accessToken: "fresh-access",
          refreshToken: "fresh-refresh",
          clientId: "browser" as const,
        },
      })),
    };

    await new VaultSessionService(
      store,
      syncPort,
      accountStore as unknown as AccountSessionPort,
      refresh,
    ).syncNow(() => true, { accountId: "account-1" });

    expect(refresh.refresh).toHaveBeenCalledWith(staleSession);
    expect(accountStore.replaceSession).toHaveBeenCalled();
    expect(accountStore.replaceSession.mock.calls[0]?.[0]).toBe("account-1");
    expect(accountStore.replaceSession.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      token: expect.objectContaining({ accessToken: "fresh-access" }),
    }));
    expect(syncPort.sync).toHaveBeenCalledTimes(2);
    expect(syncPort.sync).toHaveBeenLastCalledWith(expect.objectContaining({
      token: expect.objectContaining({ accessToken: "fresh-access" }),
    }));
    expect(store.snapshot().activeSession?.token.accessToken).toBe("fresh-access");
    expect(store.snapshot().syncError).toBe("");
  });

  it("locks the account without retrying or exposing a rejected refresh message after a 401", async () => {
    const store = new PopupStateStore();
    const staleSession = fakeAuthSession();
    store.setActiveSession(staleSession);
    store.setUnlocked("user@example.com");
    const accountStore = {
      setStatus: vi.fn(async () => undefined),
    };
    const syncPort = {
      sync: vi.fn(async () => {
        throw new BitwardenApiError(401, { ErrorModel: { Message: "expired" } });
      }),
    };
    const refresh = {
      refresh: vi.fn(async () => {
        throw new Error("private refresh rejection");
      }),
    };
    const beforeLock = vi.fn((session: AuthSession) => {
      expect(session).toBe(staleSession);
      expect(store.snapshot()).toMatchObject({
        isUnlocked: true,
        activeSession: staleSession,
      });
    });

    await new VaultSessionService(
      store,
      syncPort,
      accountStore as unknown as AccountSessionPort,
      refresh,
    ).syncNow(() => true, { accountId: "account-1", beforeLock });

    expect(syncPort.sync).toHaveBeenCalledTimes(1);
    expect(beforeLock).toHaveBeenCalledOnce();
    expect(accountStore.setStatus).toHaveBeenCalledWith("account-1", "locked", expect.any(Function));
    expect(store.snapshot()).toMatchObject({
      isUnlocked: false,
      activeSession: null,
      syncError: "会话已失效",
      statusMessage: "会话已失效",
    });
    expect(store.snapshot().syncError).not.toContain("private refresh rejection");
  });

  it("does not let an older refresh failure lock a newer successful sync", async () => {
    const store = new PopupStateStore();
    const staleSession = fakeAuthSession();
    store.setActiveSession(staleSession);
    store.setUnlocked("user@example.com");
    const releaseStatusWrite = deferred<void>();
    const accountStore = {
      setStatus: vi.fn(async (_id: string, _status: string, isCurrent?: () => boolean) => {
        await releaseStatusWrite.promise;
        if (!isCurrent?.()) {
          return;
        }
      }),
    };
    const older = new VaultSessionService(
      store,
      { sync: async () => { throw new BitwardenApiError(401, {}); } },
      accountStore as unknown as AccountSessionPort,
      { refresh: async () => { throw new Error("old refresh failed"); } },
    ).syncNow(() => true, { accountId: "account-1" });
    await vi.waitFor(() => expect(accountStore.setStatus).toHaveBeenCalled());

    const newer = new VaultSessionService(store, {
      sync: async () => ({
        cipherCount: 1,
        encryptedCipherCount: 0,
        folderCount: demoFolders.length,
        sendCount: 0,
        items: [demoVaultItems[0]],
        archivedItems: [],
        deletedItems: [],
        folders: demoFolders,
        organizations: [],
        collections: [],
        sends: [],
      }),
    }).syncNow();
    await newer;
    releaseStatusWrite.resolve();
    await older;

    expect(accountStore.setStatus).toHaveBeenCalledWith("account-1", "locked", expect.any(Function));
    expect(store.snapshot()).toMatchObject({
      isUnlocked: true,
      items: [demoVaultItems[0]],
      vaultSyncStatus: "fresh",
      syncError: "",
    });
  });

  it("does not write an expired-session error after a newer post-lock continuation", async () => {
    const store = new PopupStateStore();
    const staleSession = fakeAuthSession();
    const newerSession = fakeAuthSession("https://newer.example.com");
    store.setActiveSession(staleSession);
    store.setUnlocked("user@example.com");
    const setLocked = store.setLocked.bind(store);
    vi.spyOn(store, "setLocked").mockImplementation(() => {
      setLocked();
      queueMicrotask(() => {
        store.setActiveSession(newerSession);
        store.setUnlocked("newer@example.com");
        const epoch = store.beginVaultSync();
        store.setItems([demoVaultItems[0]], demoFolders);
        store.commitVaultSync(new Date("2026-07-12T00:00:00Z"), epoch);
        store.setStatus("Newer sync");
      });
    });

    await new VaultSessionService(
      store,
      { sync: async () => { throw new BitwardenApiError(401, {}); } },
      { setStatus: vi.fn(async () => undefined) } as unknown as AccountSessionPort,
      { refresh: async () => { throw new Error("old refresh failed"); } },
    ).syncNow(() => true, { accountId: "account-1" });

    expect(store.snapshot()).toMatchObject({
      isUnlocked: true,
      activeSession: newerSession,
      vaultSyncStatus: "fresh",
      syncError: "",
      statusMessage: "Newer sync",
    });
  });

  it("does not persist or retry when a refresh resolves after the operation becomes stale", async () => {
    const store = new PopupStateStore();
    const staleSession = fakeAuthSession();
    store.setActiveSession(staleSession);
    store.setUnlocked("user@example.com");
    const refreshed = deferred<AuthSession>();
    const accountStore = {
      replaceSession: vi.fn(async () => undefined),
    };
    const syncPort = {
      sync: vi.fn(async () => {
        throw new BitwardenApiError(401, {});
      }),
    };
    let current = true;
    const syncing = new VaultSessionService(
      store,
      syncPort,
      accountStore as unknown as AccountSessionPort,
      { refresh: () => refreshed.promise },
    ).syncNow(() => current, { accountId: "account-1" });
    await vi.waitFor(() => expect(syncPort.sync).toHaveBeenCalledTimes(1));

    current = false;
    store.setLockedAccount("baseline@example.com", "https://vault.baseline.example.com");
    const canceledState = store.snapshot();
    refreshed.resolve({
      ...staleSession,
      token: { ...staleSession.token, accessToken: "late-access" },
    });
    await syncing;

    expect(accountStore.replaceSession).not.toHaveBeenCalled();
    expect(syncPort.sync).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toEqual(canceledState);
  });

  it("keeps newer popup state when stale replacement quarantine reports a consistency error", async () => {
    const store = new PopupStateStore();
    const staleSession = fakeAuthSession();
    store.setActiveSession(staleSession);
    store.setUnlocked("user@example.com");
    const replacement = deferred<never>();
    const accountStore = {
      replaceSession: vi.fn(() => replacement.promise),
      setStatus: vi.fn(async () => undefined),
    };
    const syncPort = {
      sync: vi.fn(async () => {
        throw new BitwardenApiError(401, {});
      }),
    };
    let current = true;
    const syncing = new VaultSessionService(
      store,
      syncPort,
      accountStore as unknown as AccountSessionPort,
      {
        refresh: async (session) => ({
          ...session,
          token: { ...session.token, accessToken: "fresh-access" },
        }),
      },
    ).syncNow(() => current, { accountId: "account-1" });
    await vi.waitFor(() => expect(accountStore.replaceSession).toHaveBeenCalled());

    current = false;
    store.setLockedAccount("newer@example.com", "https://vault.newer.example.com");
    store.setStatus("Newer account state");
    const newerState = store.snapshot();
    replacement.reject(new AccountSessionReplacementConsistencyError());
    await syncing;

    expect(syncPort.sync).toHaveBeenCalledTimes(1);
    expect(accountStore.setStatus).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual(newerState);
  });

  it("locks current popup state on replacement consistency errors without retrying", async () => {
    const store = new PopupStateStore();
    const staleSession = fakeAuthSession();
    store.setActiveSession(staleSession);
    store.setUnlocked("user@example.com");
    const accountStore = {
      replaceSession: vi.fn(async () => {
        throw new AccountSessionReplacementConsistencyError();
      }),
      setStatus: vi.fn(async () => undefined),
    };
    const syncPort = {
      sync: vi.fn(async () => {
        throw new BitwardenApiError(401, {});
      }),
    };

    await new VaultSessionService(
      store,
      syncPort,
      accountStore as unknown as AccountSessionPort,
      {
        refresh: async (session) => ({
          ...session,
          token: { ...session.token, accessToken: "fresh-access" },
        }),
      },
    ).syncNow(() => true, { accountId: "account-1" });

    expect(syncPort.sync).toHaveBeenCalledTimes(1);
    expect(accountStore.setStatus).toHaveBeenCalledWith("account-1", "locked", expect.any(Function));
    expect(store.snapshot()).toMatchObject({
      isUnlocked: false,
      activeSession: null,
      syncError: "Unable to safely save session.",
      statusMessage: "Unable to safely save session.",
    });
  });
});

const retainedDate = new Date("2026-07-20T00:00:00.000Z");
const retainedTextSend = {
  id: "retained-send", accessId: "retained-access", type: "text" as const,
  name: "Retained send", notes: "", revisionDate: "", deletionDate: "",
  disabled: false, accessCount: 0,
};

async function offlineState(seed: (store: PopupStateStore) => void) {
  const store = new PopupStateStore();
  store.setActiveSession(fakeAuthSession());
  store.setUnlocked("user@example.com");
  seed(store);
  await new VaultSessionService(store, {
    sync: async () => { throw new Error("private offline response"); },
  }).syncNow();
  return store.snapshot();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fakeAuthSession(serverUrl?: string): AuthSession {
  return {
    environment: serverUrl
      ? buildSelfHostedEnvironmentFromServerUrl(serverUrl)
      : buildBitwardenEnvironment(),
    token: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
