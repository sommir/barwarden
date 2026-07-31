import { describe, expect, it } from "vitest";

import type { AuthSession } from "../auth/auth-session-store";
import { buildBitwardenEnvironment } from "../bitwarden-api/bitwarden-api";
import { PopupStateStore } from "./popup-state";
import { demoFolders, demoVaultItems } from "./vault-demo";
import { OfficialI18nService } from "./official-ui/official-i18n.service";

describe("PopupStateStore", () => {
  it("defaults the official Vault filter disclosure to open", () => {
    expect(new PopupStateStore().snapshot().isFilterVisible).toBe(true);
  });

  it("emits the initial snapshot and committed mutations in order", () => {
    const store = new PopupStateStore();
    const emissions: string[] = [];
    const subscription = store.state$.subscribe((state) => {
      emissions.push(stateMarker(state));
    });
    const syncedAt = new Date("2026-07-14T00:00:00.000Z");

    store.setItems([demoVaultItems[0]], demoFolders, syncedAt);
    const successfulSync = store.beginVaultSync();
    store.commitVaultSync(syncedAt, successfulSync);
    store.beginVaultSync();
    store.failVaultSync(true);
    store.setFilterFolderId("work");
    store.setFilterType("login");
    store.setFilterVisible(true);
    store.resetFilters();
    store.setLockedAccount("locked@example.com", "https://vault.locked.example.com");
    const lockedState = store.snapshot();
    store.setLoggedOut();
    store.restore(lockedState);
    subscription.unsubscribe();

    expect(emissions).toEqual([
      "locked|initial|||false|||visible",
      "locked|fresh|github||false|||visible",
      "locked|syncing|github||true|||visible",
      "locked|fresh|github||false|||visible",
      "locked|syncing|github||true|||visible",
      "locked|stale|github|无法同步，正在显示已保存的密码库数据。|false|||visible",
      "locked|stale|github|无法同步，正在显示已保存的密码库数据。|false|work||visible",
      "locked|stale|github|无法同步，正在显示已保存的密码库数据。|false|work|login|visible",
      "locked|stale|github|无法同步，正在显示已保存的密码库数据。|false|work|login|visible",
      "locked|stale|github|无法同步，正在显示已保存的密码库数据。|false|||visible",
      "locked:locked@example.com|initial|||false|||visible",
      "locked|initial|||false|||visible",
      "locked:locked@example.com|initial|||false|||visible",
    ]);
  });

  it("does not emit rejected stale vault sync completions", () => {
    const store = new PopupStateStore();
    const emissions: string[] = [];
    const subscription = store.state$.subscribe((state) => {
      emissions.push(stateMarker(state));
    });

    const staleEpoch = store.beginVaultSync();
    store.beginVaultSync();
    store.commitVaultSync(new Date("2026-07-14T00:00:00.000Z"), staleEpoch);
    store.failVaultSync(false, staleEpoch);
    subscription.unsubscribe();

    expect(emissions).toEqual([
      "locked|initial|||false|||visible",
      "locked|syncing|||true|||visible",
      "locked|syncing|||true|||visible",
    ]);
  });

  it("tracks fixed first-load and stale Vault recovery states", () => {
    const store = new PopupStateStore();

    store.beginVaultSync();
    expect(store.snapshot()).toMatchObject({
      isSyncing: true,
      vaultSyncStatus: "syncing",
      vaultSyncMessage: "",
    });

    store.failVaultSync(false);
    expect(store.snapshot()).toMatchObject({
      isSyncing: false,
      vaultSyncStatus: "unavailable",
      vaultSyncMessage: "无法加载密码库，请重试。",
    });

    const syncedAt = new Date("2026-07-12T00:00:00.000Z");
    store.setItems([demoVaultItems[0]], demoFolders, syncedAt);
    store.commitVaultSync(syncedAt);
    store.failVaultSync(true);
    expect(store.snapshot()).toMatchObject({
      vaultSyncStatus: "stale",
      vaultSyncMessage: "无法同步，正在显示已保存的密码库数据。",
      lastSuccessfulSyncDate: syncedAt,
      items: [demoVaultItems[0]],
    });
  });

  it("starts locked with no synced items", () => {
    const store = new PopupStateStore();

    expect(store.snapshot()).toMatchObject({
      isUnlocked: false,
      isLoggingIn: false,
      items: [],
      sends: [],
      statusMessage: "",
      loginError: "",
    });
  });

  it("commits Text Sends and their policy in one state transition", () => {
    const store = new PopupStateStore();
    const emissions: string[][] = [];
    store.state$.subscribe((state) => {
      emissions.push(state.sends.map((send) => send.id));
    });

    store.setSends([{ id: "send", accessId: "access", type: "text", name: "Secret", notes: "", revisionDate: "", deletionDate: "", disabled: false, accessCount: 0 }], {
      disabled: true,
      hideEmailAllowed: false,
    });

    expect(emissions).toEqual([[], ["send"]]);
    expect(store.snapshot().sendPolicy).toEqual({ disabled: true, hideEmailAllowed: false });
    expect(store.snapshot().isSendDisabled).toBe(true);
  });

  it("records unlock, synced items, sends, status, and lock transitions", async () => {
    await new OfficialI18nService().setLocale("zh-CN");
    const store = new PopupStateStore();

    store.setUnlocked("user@example.com");
    store.setItems(demoVaultItems);
    store.setArchivedItems([demoVaultItems[0]]);
    store.setDeletedItems([demoVaultItems[1]]);
    store.setSends([
      {
        id: "send-1",
        accessId: "access-1",
        type: "text",
        name: "Demo Send",
        notes: "",
        revisionDate: "",
        deletionDate: "",
        disabled: false,
        accessCount: 0,
      },
    ]);
    store.setStatus("Synced 3 items");
    store.setLocked();

    expect(store.snapshot().email).toBe("user@example.com");
    expect(store.snapshot().items).toEqual([]);
    expect(store.snapshot().archivedItems).toEqual([]);
    expect(store.snapshot().deletedItems).toEqual([]);
    expect(store.snapshot().sends).toEqual([]);
    expect(store.snapshot().statusMessage).toBe("已锁定");
    expect(store.snapshot().isUnlocked).toBe(false);
  });

  it("stores synchronized organization data and clears it on lock", () => {
    const store = new PopupStateStore();
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

    store.setOrganizationData(organizations, collections);

    expect(store.snapshot().organizations).toEqual(organizations);
    expect(store.snapshot().collections).toEqual(collections);

    store.setLocked();

    expect(store.snapshot().organizations).toEqual([]);
    expect(store.snapshot().collections).toEqual([]);
  });

  it("stores active session and clears decrypted session data on lock versus logout", () => {
    const store = new PopupStateStore();
    const session = fakeAuthSession();
    store.setActiveSession(session);
    store.setUnlocked("user@example.com");
    store.setItems(demoVaultItems, demoFolders, new Date("2026-07-09T10:00:00.000Z"));
    store.setArchivedItems([demoVaultItems[0]]);
    store.setDeletedItems([demoVaultItems[1]]);
    store.setLocked();
    expect(store.snapshot().activeSession).toBeNull();
    expect(store.snapshot().items).toEqual([]);
    expect(store.snapshot().archivedItems).toEqual([]);
    expect(store.snapshot().deletedItems).toEqual([]);
    expect(store.snapshot().email).toBe("user@example.com");

    store.setOrganizationData(
      [{ id: "org-1", name: "Engineering", enabled: true, status: 2 }],
      [{
        id: "collection-1",
        organizationId: "org-1",
        name: "Production",
        readOnly: false,
        manage: true,
      }],
    );
    store.setLoggedOut();
    expect(store.snapshot().activeSession).toBeNull();
    expect(store.snapshot().email).toBe("");
    expect(store.snapshot().items).toEqual([]);
    expect(store.snapshot().organizations).toEqual([]);
    expect(store.snapshot().collections).toEqual([]);
  });

  it("locks a selected account while retaining its identity and clearing decrypted state", () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("current@example.com");
    store.setServerUrl("https://vault.current.example.com");
    store.setItems(demoVaultItems, demoFolders);
    store.setFilterFolderId("work");
    store.setFilterType("login");
    store.setFilterVisible(true);

    store.setLockedAccount("locked@example.com", "https://vault.locked.example.com");

    expect(store.snapshot()).toMatchObject({
      email: "locked@example.com",
      serverUrl: "https://vault.locked.example.com",
      isUnlocked: false,
      activeSession: null,
      items: [],
      filterFolderId: "",
      filterType: "",
      isFilterVisible: true,
      statusMessage: "已锁定",
    });
  });

  it("restores a complete prior popup snapshot", () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("prior@example.com");
    store.setServerUrl("https://vault.prior.example.com");
    store.setItems(demoVaultItems, demoFolders, new Date("2026-07-10T10:00:00.000Z"));
    store.setFilterFolderId("work");
    store.setFilterType("login");
    store.setFilterVisible(true);
    const prior = store.snapshot();
    store.setLoggedOut();

    store.restore(prior);

    expect(store.snapshot()).toEqual(prior);
  });

  it("presents an authentication challenge without prior decrypted state", () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setUnlocked("prior@example.com");
    store.setServerUrl("https://vault.prior.example.com");
    store.setItems(demoVaultItems, demoFolders);

    store.setAuthChallenge({
      type: "twoFactor",
      email: "attempt@example.com",
      serverUrl: "https://vault.attempt.example.com",
      message: "Two-factor authentication required",
    });

    expect(store.snapshot()).toMatchObject({
      email: "attempt@example.com",
      serverUrl: "https://vault.attempt.example.com",
      isUnlocked: false,
      activeSession: null,
      items: [],
      folders: [],
    });
  });

  it("updates active vault item state for row menu actions", () => {
    const store = new PopupStateStore();
    store.setItems([demoVaultItems[0], demoVaultItems[1]], demoFolders);

    store.updateVaultItem("github", (item) => ({ ...item, favorite: false }));
    store.archiveVaultItem("github");
    store.deleteVaultItem("card");

    expect(store.snapshot().items).toEqual([]);
    expect(store.snapshot().archivedItems.map((item) => [item.id, item.favorite])).toEqual([
      ["github", false],
    ]);
    expect(store.snapshot().deletedItems.map((item) => item.id)).toEqual(["card"]);
  });

  it("restores archived and deleted items and deletes trashed items permanently", () => {
    const store = new PopupStateStore();
    store.setArchivedItems([{ ...demoVaultItems[0], id: "archived" }]);
    store.setDeletedItems([{ ...demoVaultItems[1], id: "deleted" }, { ...demoVaultItems[2], id: "purge" }]);

    store.restoreArchivedVaultItem("archived");
    store.restoreDeletedVaultItem("deleted");
    store.permanentlyDeleteVaultItem("purge");

    expect(store.snapshot().items.map((item) => item.id)).toEqual(["deleted", "archived"]);
    expect(store.snapshot().archivedItems).toEqual([]);
    expect(store.snapshot().deletedItems).toEqual([]);
  });

  it("saves an edited archived item in place without reactivating it", () => {
    const store = new PopupStateStore();
    const archived = { ...demoVaultItems[0], id: "archived" };
    store.setArchivedItems([archived]);

    store.saveVaultItem({ ...archived, name: "Edited archived item" });

    expect(store.snapshot().items).toEqual([]);
    expect(store.snapshot().archivedItems).toEqual([
      expect.objectContaining({ id: "archived", name: "Edited archived item" }),
    ]);
  });

  it("adds a returned personal item only to the active collection", () => {
    const store = new PopupStateStore();
    const returned = { ...demoVaultItems[1], id: "returned-personal" };
    store.setArchivedItems([demoVaultItems[0]]);
    store.setDeletedItems([demoVaultItems[2]]);

    expect(store.addActiveVaultItem(returned)).toBe(true);

    expect(store.snapshot().items).toEqual([returned]);
    expect(store.snapshot().items[0]).toBe(returned);
    expect(store.snapshot().archivedItems).toEqual([demoVaultItems[0]]);
    expect(store.snapshot().deletedItems).toEqual([demoVaultItems[2]]);
    expect(store.addActiveVaultItem({ ...returned })).toBe(false);
  });

  it.each(["active", "archived"] as const)(
    "replaces an exact %s source object without moving collections",
    (location) => {
      const store = new PopupStateStore();
      const source = { ...demoVaultItems[1], id: `${location}-source` };
      const returned = { ...source, id: `${location}-returned`, name: "Returned object" };
      if (location === "active") store.setItems([source]);
      else store.setArchivedItems([source]);

      expect(store.replaceVaultItemExact(source, location, returned)).toBe(true);

      expect(store.snapshot().items).toEqual(location === "active" ? [returned] : []);
      expect(store.snapshot().archivedItems).toEqual(location === "archived" ? [returned] : []);
      expect(store.snapshot().deletedItems).toEqual([]);
      expect((location === "active" ? store.snapshot().items : store.snapshot().archivedItems)[0])
        .toBe(returned);
    },
  );

  it("rejects stale-object and deleted exact replacements without mutation", () => {
    const store = new PopupStateStore();
    const active = { ...demoVaultItems[1], id: "active-source" };
    const archived = { ...demoVaultItems[2], id: "archived-source" };
    const deleted = { ...demoVaultItems[3], id: "deleted-source" };
    store.setItems([active]);
    store.setArchivedItems([archived]);
    store.setDeletedItems([deleted]);
    const before = store.snapshot();

    expect(store.replaceVaultItemExact({ ...active }, "active", { ...active })).toBe(false);
    expect(store.replaceVaultItemExact(deleted, "deleted", { ...deleted })).toBe(false);
    expect(store.snapshot()).toBe(before);
  });

  it("creates, renames, and deletes folders while keeping item folder metadata consistent", () => {
    const store = new PopupStateStore();
    store.setItems([demoVaultItems[0]], demoFolders);

    const created = store.saveFolder({ name: "Finance" });
    store.saveFolder({ id: "work", name: "Engineering" });
    store.deleteFolder("work");

    expect(created).toMatchObject({ id: "finance", name: "Finance" });
    expect(store.snapshot().folders.map((folder) => [folder.id, folder.name])).toEqual([
      ["personal", "Personal"],
      ["finance", "Finance"],
    ]);
    expect(store.snapshot().items[0]).toMatchObject({
      id: "github",
      folderId: "",
      folderName: "",
    });
  });

  it("updates existing sends by id when saving local Send changes", () => {
    const store = new PopupStateStore();
    store.setSends([
      {
        id: "send-1",
        accessId: "access-1",
        type: "text",
        name: "Old secret",
        text: "old",
        notes: "",
        revisionDate: "2026-07-09T10:00:00.000Z",
        deletionDate: "2026-07-16T10:00:00.000Z",
        disabled: false,
        accessCount: 0,
      },
    ]);

    store.saveSend({
      ...store.snapshot().sends[0]!,
      name: "Updated secret",
      text: "new",
    });

    expect(store.snapshot().sends).toHaveLength(1);
    expect(store.snapshot().sends[0]).toMatchObject({
      id: "send-1",
      name: "Updated secret",
      text: "new",
    });
  });

  it("deletes local Sends by id for row menu actions", () => {
    const store = new PopupStateStore();
    store.setSends([
      {
        id: "send-1",
        accessId: "access-1",
        type: "text",
        name: "First Send",
        notes: "",
        revisionDate: "2026-07-09T10:00:00.000Z",
        deletionDate: "2026-07-16T10:00:00.000Z",
        disabled: false,
        accessCount: 0,
      },
      {
        id: "send-2",
        accessId: "access-2",
        type: "file",
        name: "Second Send",
        notes: "",
        revisionDate: "2026-07-09T10:00:00.000Z",
        deletionDate: "2026-07-16T10:00:00.000Z",
        disabled: false,
        accessCount: 0,
      },
    ]);

    store.deleteSend("send-1");

    expect(store.snapshot().sends.map((send) => send.id)).toEqual(["send-2"]);
  });
});

function fakeAuthSession(): AuthSession {
  return {
    environment: buildBitwardenEnvironment(),
    token: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
    crypto: {
      userKeyB64: "test-user-key",
    },
  };
}

function stateMarker(state: ReturnType<PopupStateStore["snapshot"]>): string {
  return [
    state.isUnlocked ? `unlocked:${state.email}` : state.email ? `locked:${state.email}` : "locked",
    state.vaultSyncStatus,
    state.items.map((item) => item.id).join(","),
    state.syncError,
    String(state.isSyncing),
    state.filterFolderId,
    state.filterType,
    state.isFilterVisible ? "visible" : "",
  ].join("|");
}
