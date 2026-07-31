import { describe, expect, it } from "vitest";

import { PopupStateStore } from "../popup-state";
import {
  applyVaultMainEvidenceState,
  parseVaultMainEvidenceState,
  resolveVaultMainEvidenceState,
  vaultMainEvidenceRoute,
  vaultMainEvidenceStates,
} from "./vault-main-evidence-preview";

describe("Vault Main evidence preview", () => {
  it("enumerates every fixed M5-M6 runtime evidence state", () => {
    expect(vaultMainEvidenceStates).toEqual(expect.arrayContaining([
      "populated",
      "large-list",
      "search-results",
      "folder-filter",
      "type-filter",
      "menu-open",
      "loading",
      "empty",
      "no-results",
      "stale",
      "unavailable",
      "long-text",
      "compact",
      "light",
      "dark",
    ]));
  });

  it("accepts only fixed sanitized evidence states", () => {
    for (const state of vaultMainEvidenceStates) {
      expect(parseVaultMainEvidenceState(state)).toBe(state);
    }
    expect(() => parseVaultMainEvidenceState("https://private.example.test")).toThrow(
      "Invalid Vault evidence state",
    );
    expect(() => parseVaultMainEvidenceState("populated&token=value")).toThrow(
      "Invalid Vault evidence state",
    );
    expect(parseVaultMainEvidenceState("login-history-empty")).toBe("login-history-empty");
    expect(parseVaultMainEvidenceState("login-history-protected")).toBe("login-history-protected");
  });

  it("ignores query state unless the compile-time evidence gate is enabled", () => {
    expect(resolveVaultMainEvidenceState(false, "?vaultEvidence=populated")).toBeNull();
    expect(resolveVaultMainEvidenceState(true, "?vaultEvidence=filtered")).toBe("filtered");
    expect(resolveVaultMainEvidenceState(true, "")).toBe("populated");
    expect(() => resolveVaultMainEvidenceState(true, "?vaultEvidence=populated&token=value")).toThrow(
      "Invalid Vault evidence query",
    );
    expect(() => resolveVaultMainEvidenceState(true, "?vaultEvidence=populated&vaultEvidence=stale")).toThrow(
      "Invalid Vault evidence query",
    );
  });

  it.each(vaultMainEvidenceStates)("builds credential-free %s state", (evidenceState) => {
    const store = new PopupStateStore();
    applyVaultMainEvidenceState(store, evidenceState);
    const serialized = JSON.stringify(store.snapshot());

    expect(store.snapshot().isUnlocked).toBe(true);
    expect(store.snapshot().serverUrl).toBe("https://vault.example.test");
    expect(serialized).not.toMatch(/access-token|refresh-token|PRIVATE KEY|@[a-z0-9]/i);
  });

  it("builds deterministic large-list, folder, type, stale, and unavailable fixtures", () => {
    const large = new PopupStateStore();
    applyVaultMainEvidenceState(large, "large-list");
    expect(large.snapshot().items).toHaveLength(120);
    expect(large.snapshot().items.at(-1)).toMatchObject({
      id: "large-119",
      name: "Synthetic Vault Item 120",
    });

    const folder = new PopupStateStore();
    applyVaultMainEvidenceState(folder, "folder-filter");
    expect(folder.snapshot().filterFolderId).toBe("work");

    const type = new PopupStateStore();
    applyVaultMainEvidenceState(type, "type-filter");
    expect(type.snapshot().filterType).toBe("card");

    const stale = new PopupStateStore();
    applyVaultMainEvidenceState(stale, "stale");
    expect(stale.snapshot()).toMatchObject({
      vaultSyncStatus: "stale",
      vaultSyncMessage: "无法同步，正在显示已保存的密码库数据。",
    });

    const unavailable = new PopupStateStore();
    applyVaultMainEvidenceState(unavailable, "unavailable");
    expect(unavailable.snapshot()).toMatchObject({
      items: [],
      vaultSyncStatus: "unavailable",
      vaultSyncMessage: "无法加载密码库，请重试。",
    });
  });

  it.each([
    ["login-detail", "/view-cipher/calendar"],
    ["login-detail-reprompt", "/view-cipher/calendar"],
    ["login-history", "/cipher-password-history?cipherId=calendar"],
    ["login-history-empty", "/cipher-password-history?cipherId=calendar"],
    ["login-history-protected", "/view-cipher/calendar"],
    ["login-add", "/add-cipher?type=1"],
    ["login-edit", "/edit-cipher?cipherId=calendar&type=1"],
    ["login-clone", "/clone-cipher?cipherId=calendar&type=1"],
    ["login-archive", "/archive"],
    ["login-trash", "/trash"],
  ] as const)("maps %s to a fixed secret-free route", (state, route) => {
    expect(vaultMainEvidenceRoute(state)).toBe(route);
    expect(route).not.toMatch(/[?&](?:password|totp|username)=/i);
  });

  it("places the synthetic Login in only the requested lifecycle list", () => {
    const archivedStore = new PopupStateStore();
    applyVaultMainEvidenceState(archivedStore, "login-archive");
    expect(archivedStore.snapshot().archivedItems.map((item) => item.id)).toEqual(["calendar"]);
    expect(archivedStore.snapshot().archivedItems[0]?.reprompt).toBe(true);
    expect(archivedStore.snapshot().deletedItems).toEqual([]);

    const deletedStore = new PopupStateStore();
    applyVaultMainEvidenceState(deletedStore, "login-trash");
    expect(deletedStore.snapshot().deletedItems.map((item) => item.id)).toEqual(["calendar"]);
    expect(deletedStore.snapshot().deletedItems[0]?.reprompt).toBe(true);
    expect(deletedStore.snapshot().archivedItems).toEqual([]);
  });

  it("builds populated, empty, and protected password-history evidence without credentials", () => {
    const populated = new PopupStateStore();
    applyVaultMainEvidenceState(populated, parseVaultMainEvidenceState("login-history"));
    expect(populated.snapshot().items.find((item) => item.id === "calendar")?.passwordHistory).toHaveLength(2);

    const empty = new PopupStateStore();
    applyVaultMainEvidenceState(empty, parseVaultMainEvidenceState("login-history-empty"));
    expect(empty.snapshot().items.find((item) => item.id === "calendar")?.passwordHistory).toEqual([]);

    const protectedStore = new PopupStateStore();
    applyVaultMainEvidenceState(protectedStore, parseVaultMainEvidenceState("login-history-protected"));
    expect(protectedStore.snapshot().items.find((item) => item.id === "calendar")).toMatchObject({
      reprompt: true,
      passwordHistory: expect.any(Array),
    });
  });

  it("keeps M10 selected history values distinct and non-empty until the copy proof clears them", () => {
    const store = new PopupStateStore();
    applyVaultMainEvidenceState(store, "password-history-populated");
    const history = store.snapshot().items.find((item) => item.id === "calendar")?.passwordHistory ?? [];

    expect(history).toHaveLength(2);
    expect(history.every((entry) => entry.password.length > 0)).toBe(true);
    expect(new Set(history.map((entry) => entry.password)).size).toBe(2);
  });

  it.each([
    ["card-detail", "/view-cipher/billing"],
    ["card-detail-reprompt", "/view-cipher/billing"],
    ["card-add", "/add-cipher?type=3"],
    ["card-edit", "/edit-cipher?cipherId=billing&type=3"],
    ["card-clone", "/clone-cipher?cipherId=billing&type=3"],
    ["card-archive", "/archive"],
    ["card-trash", "/trash"],
  ] as const)("maps %s to a fixed Card route", (state, route) => {
    expect(vaultMainEvidenceRoute(state)).toBe(route);
  });

  it("builds protected typed Card lifecycle evidence", () => {
    const detailStore = new PopupStateStore();
    applyVaultMainEvidenceState(detailStore, "card-detail-reprompt");
    expect(detailStore.snapshot().items.find((item) => item.id === "billing")).toMatchObject({
      reprompt: true,
      name: "Example Card",
      card: {
        cardholderName: "Example Holder",
        brand: "Visa",
        expMonth: "04",
        expYear: "2029",
      },
      fields: expect.arrayContaining([
        expect.objectContaining({ id: "card-hidden", type: "hidden" }),
        expect.objectContaining({ id: "card-linked", type: "linked", linkedId: 305 }),
      ]),
    });

    const archivedStore = new PopupStateStore();
    applyVaultMainEvidenceState(archivedStore, "card-archive");
    expect(archivedStore.snapshot().archivedItems.map((item) => item.id)).toEqual(["billing"]);

    const deletedStore = new PopupStateStore();
    applyVaultMainEvidenceState(deletedStore, "card-trash");
    expect(deletedStore.snapshot().deletedItems.map((item) => item.id)).toEqual(["billing"]);
  });

  it.each([
    ["identity-detail", "/view-cipher/profile"],
    ["identity-detail-reprompt", "/view-cipher/profile"],
    ["identity-add", "/add-cipher?type=4"],
    ["identity-edit", "/edit-cipher?cipherId=profile&type=4"],
    ["identity-clone", "/clone-cipher?cipherId=profile&type=4"],
    ["identity-archive", "/archive"],
    ["identity-trash", "/trash"],
  ] as const)("maps %s to a fixed Identity route", (state, route) => {
    expect(vaultMainEvidenceRoute(state)).toBe(route);
  });

  it("builds protected typed Identity lifecycle evidence", () => {
    const detailStore = new PopupStateStore();
    applyVaultMainEvidenceState(detailStore, "identity-detail-reprompt");
    expect(detailStore.snapshot().items.find((item) => item.id === "profile")).toMatchObject({
      reprompt: true,
      name: "Example Identity",
      identity: {
        title: "Mx",
        firstName: "Example",
        middleName: "Test",
        lastName: "Identity",
        ssn: "000-00-0000",
        passportNumber: "P-EXAMPLE-123",
        city: "Example City",
        country: "US",
      },
      fields: expect.arrayContaining([
        expect.objectContaining({ id: "identity-hidden", type: "hidden" }),
        expect.objectContaining({ id: "identity-linked", type: "linked", linkedId: 410 }),
      ]),
    });

    const archivedStore = new PopupStateStore();
    applyVaultMainEvidenceState(archivedStore, "identity-archive");
    expect(archivedStore.snapshot().archivedItems.map((item) => item.id)).toEqual(["profile"]);

    const deletedStore = new PopupStateStore();
    applyVaultMainEvidenceState(deletedStore, "identity-trash");
    expect(deletedStore.snapshot().deletedItems.map((item) => item.id)).toEqual(["profile"]);
  });

  it.each([
    ["note-detail", "/view-cipher/recovery"],
    ["note-add", "/add-cipher?type=2"],
    ["note-edit", "/edit-cipher?cipherId=recovery&type=2"],
    ["note-clone", "/clone-cipher?cipherId=recovery&type=2"],
    ["note-archive", "/archive"],
    ["note-trash", "/trash"],
  ] as const)("maps %s to a fixed Secure Note route", (state, route) => {
    expect(vaultMainEvidenceRoute(state)).toBe(route);
  });

  it("builds typed Secure Note lifecycle evidence", () => {
    const detailStore = new PopupStateStore();
    applyVaultMainEvidenceState(detailStore, "note-detail");
    expect(detailStore.snapshot().items.find((item) => item.id === "recovery")).toMatchObject({
      name: "Example Secure Note",
      secureNote: { type: 0 },
      notes: "Synthetic example.test secure note body",
      fields: expect.arrayContaining([
        expect.objectContaining({ id: "note-hidden", type: "hidden" }),
      ]),
    });

    const archivedStore = new PopupStateStore();
    applyVaultMainEvidenceState(archivedStore, "note-archive");
    expect(archivedStore.snapshot().archivedItems.map((item) => item.id)).toEqual(["recovery"]);

    const deletedStore = new PopupStateStore();
    applyVaultMainEvidenceState(deletedStore, "note-trash");
    expect(deletedStore.snapshot().deletedItems.map((item) => item.id)).toEqual(["recovery"]);
  });

  it("builds exact M10 recovery collections with preserved folders and favorites", () => {
    const active = new PopupStateStore();
    applyVaultMainEvidenceState(active, "folders-list");
    expect(active.snapshot().folders).toEqual([
      { id: "m10-work", name: "Example Work" },
      { id: "m10-personal", name: "Example Personal" },
    ]);
    expect(active.snapshot().items.map(({ type }) => type)).toEqual([
      "login", "card", "identity", "secure-note",
    ]);
    expect(active.snapshot().items.find(({ id }) => id === "m10-card")).toMatchObject({
      favorite: true,
      folderId: "m10-personal",
      folderName: "Example Personal",
      card: { code: "M10-CVC-731" },
    });

    const archived = new PopupStateStore();
    applyVaultMainEvidenceState(archived, "archive-list");
    expect(archived.snapshot().items).toEqual([]);
    expect(archived.snapshot().archivedItems).toHaveLength(4);

    const deleted = new PopupStateStore();
    applyVaultMainEvidenceState(deleted, "trash-list");
    expect(deleted.snapshot().items).toEqual([]);
    expect(deleted.snapshot().deletedItems).toHaveLength(4);
  });
});
