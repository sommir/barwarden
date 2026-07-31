import { describe, expect, it } from "vitest";

import type { AuthSession } from "../../src/auth/auth-session-store";
import { BitwardenApiError } from "../../src/bitwarden-api/bitwarden-api";
import type { VaultItem } from "../../src/app/vault/vault-item.model";
import type { VaultSyncResult } from "../../src/vault/vault-sync.service";
import {
  runFolderScenario,
  runPersonalCipherScenario,
  runVaultReadOnlyScenario,
  type LiveVaultDependencies,
  type LiveVaultReadOnlyDependencies,
  type VaultScenarioKind,
} from "./live-vault-scenarios";
import { createLiveRunContext } from "./live-test-protocol";

describe("live vault scenarios", () => {
  it("owns a Folder from create through final absence by its exact server id", async () => {
    const harness = new VaultScenarioHarness();

    await expect(runFolderScenario(harness.dependencies())).resolves.toEqual({
      service: "self-hosted",
      mode: "mutation",
      stage: "folder",
      status: "passed",
    });

    expect(harness.folderDeleteCalls).toBe(1);
    expect(harness.syncSnapshots).toEqual([
      "folder:active",
      "folder:active",
      "folder:absent",
      "folder:absent",
    ]);
  });

  it.each(["login", "card", "identity", "secure-note"] as const)(
    "owns the complete %s lifecycle and final deletion by exact server id",
    async (kind) => {
      const harness = new VaultScenarioHarness();

      await expect(runPersonalCipherScenario(kind, harness.dependencies())).resolves.toEqual({
        service: "self-hosted",
        mode: "mutation",
        stage: kind,
        status: "passed",
      });

      expect(harness.cipherDeleteCalls).toBe(1);
      expect(harness.syncSnapshots).toEqual([
        `${kind}:active`,
        `${kind}:active`,
        `${kind}:active`,
        `${kind}:archived`,
        `${kind}:active`,
        `${kind}:deleted`,
        `${kind}:active`,
        `${kind}:absent`,
        `${kind}:absent`,
      ]);
      expect(harness.favorited).toBe(true);
      if (kind === "login") {
        expect(harness.passwordHistoryWasVerified).toBe(true);
      }
    },
  );

  it("updates a Login from the authoritative post-create sync projection", async () => {
    const harness = new VaultScenarioHarness();
    const base = harness.dependencies();
    let updateInput: VaultItem | undefined;
    const deps: LiveVaultDependencies = {
      ...base,
      writes: {
        ...base.writes,
        createLoginCipher: async (session, draft) => ({
          ...await base.writes.createLoginCipher(session, draft),
          requiresVaultSyncBeforeEdit: true,
        }),
        updateLoginCipher: async (session, item, draft) => {
          updateInput = item;
          return base.writes.updateLoginCipher(session, item, draft);
        },
      },
    };

    await expect(runPersonalCipherScenario("login", deps)).resolves.toMatchObject({
      status: "passed",
    });
    expect(updateInput?.requiresVaultSyncBeforeEdit).toBeUndefined();
  });

  it.each([
    "create-sync", "update", "update-sync", "favorite", "favorite-sync", "archive",
    "archive-sync", "unarchive", "unarchive-sync", "trash", "trash-sync", "restore",
    "restore-sync", "delete", "delete-sync",
  ] as const)("cleans a created personal cipher exactly once when %s fails", async (failureStage) => {
    const harness = new VaultScenarioHarness(failureStage);

    await expect(runPersonalCipherScenario("card", harness.dependencies())).rejects.toThrow(
      "Live mutation did not complete",
    );

    expect(harness.cipherDeleteCalls).toBe(1);
    expect(harness.currentCipher).toBeNull();
    expect(harness.cleanupVerified).toBe(true);
  });

  it.each(["create-sync", "update", "update-sync", "delete", "delete-sync"] as const)(
    "cleans a created Folder exactly once when %s fails",
    async (failureStage) => {
      const harness = new VaultScenarioHarness(failureStage);

      await expect(runFolderScenario(harness.dependencies())).rejects.toThrow(
        "Live mutation did not complete",
      );

      expect(harness.folderDeleteCalls).toBe(1);
      expect(harness.currentFolder).toBeNull();
      expect(harness.cleanupVerified).toBe(true);
    },
  );

  it("runs one real sync projection, then retains cache as stale after an offline failure", async () => {
    const harness = new VaultScenarioHarness();

    await expect(runVaultReadOnlyScenario(harness.readOnlyDependencies())).resolves.toEqual([
      { service: "self-hosted", mode: "read-only", stage: "sync", status: "passed" },
      { service: "self-hosted", mode: "read-only", stage: "sync", status: "passed" },
    ]);
    expect(harness.readOnlyAssertions).toEqual(["fresh", "stale", "unavailable"]);
    expect(harness.readOnlyServiceSyncCalls).toBe(2);
    expect(harness.readOnlyTransportSwitches).toBe(1);
  });

  it("sanitizes a private Bitwarden sync error at the read-only boundary", async () => {
    const privateValues = [
      "https://private.example.test/api/sync",
      "private-user@example.test",
      "private-token-value",
      "private-server-id",
      "decrypted private text",
    ];
    const privateError = new BitwardenApiError(500, {
      url: privateValues[0], email: privateValues[1], token: privateValues[2],
      id: privateValues[3], text: privateValues[4],
    });
    const deps = new VaultScenarioHarness().readOnlyDependencies();
    const caught = await runVaultReadOnlyScenario({
      ...deps,
      syncNow: async () => { throw privateError; },
    }).then(() => null, (error: unknown) => error);

    expect(caught).toBeInstanceOf(Error);
    const publicError = {
      name: (caught as Error).name,
      message: (caught as Error).message,
      fields: Object.keys(caught as object),
    };
    expect(publicError).toEqual({
      name: "Error",
      message: "Live vault read-only sync did not complete",
      fields: [],
    });
    for (const privateValue of privateValues) {
      expect(JSON.stringify(publicError)).not.toContain(privateValue);
    }
  });

  it.each([
    ["snapshot", "Live vault read-only cache apply did not complete"],
    ["switch", "Live vault read-only transport switch did not complete"],
    ["offline", "Live vault read-only offline sync did not complete"],
    ["initial", "Live vault read-only initial sync did not complete"],
    ["assert", "Live vault read-only cache assertion did not complete"],
  ] as const)("sanitizes a read-only %s callback failure", async (failure, message) => {
    const deps = new VaultScenarioHarness().readOnlyDependencies();
    let syncCalls = 0;
    const rejected = runVaultReadOnlyScenario({
      ...deps,
      ...(failure === "snapshot" ? { snapshot: () => { throw new Error("private snapshot"); } } : {}),
      ...(failure === "switch" ? { useTransportFailure: () => { throw new Error("private switch"); } } : {}),
      ...(failure === "offline" ? {
        syncNow: async () => {
          syncCalls += 1;
          if (syncCalls === 2) throw new Error("private offline");
        },
      } : {}),
      ...(failure === "initial" ? { failInitial: async () => { throw new Error("private initial"); } } : {}),
      ...(failure === "assert" ? { assertRetained: () => { throw new Error("private assertion"); } } : {}),
    });

    await expect(rejected).rejects.toThrow(message);
  });

  it.each([
    [1, "Live folder create projection did not match"],
    [2, "Live folder update projection did not match"],
  ] as const)("rejects a mismatched projected Folder name after sync %i", async (projectionCall) => {
    const harness = new VaultScenarioHarness();
    const deps = withProjectionFault(harness.dependencies(), projectionCall, (result) => ({
      ...result,
      folders: result.folders.map((folder) => ({ ...folder, name: "private mismatched folder" })),
    }));

    await expect(runFolderScenario(deps)).rejects.toThrow("Live mutation did not complete");
  });

  it.each(["login", "card", "identity", "secure-note"] as const)(
    "rejects a mismatched projected updated %s name by exact id",
    async (kind) => {
      const harness = new VaultScenarioHarness();
      const deps = withProjectionFault(harness.dependencies(), 2, (result) => ({
        ...result,
        items: result.items.map((item) => ({ ...item, name: "private mismatched name" })),
      }));

      await expect(runPersonalCipherScenario(kind, deps)).rejects.toThrow("Live mutation did not complete");
    },
  );

  it.each(["login", "card", "identity", "secure-note"] as const)(
    "rejects a mismatched projected updated %s type payload by exact id",
    async (kind) => {
      const harness = new VaultScenarioHarness();
      const deps = withProjectionFault(harness.dependencies(), 2, (result) => ({
        ...result,
        items: result.items.map((item) => corruptUpdatedTypePayload(kind, item)),
      }));

      await expect(runPersonalCipherScenario(kind, deps)).rejects.toThrow("Live mutation did not complete");
    },
  );

  it.each(["login", "card", "identity", "secure-note"] as const)(
    "rejects a corrupted projected created %s payload with generic output",
    async (kind) => {
      const harness = new VaultScenarioHarness(undefined, kind);
      const caught = await runPersonalCipherScenario(kind, harness.dependencies())
        .then(() => null, (error: unknown) => error);

      expect(caught).toBeInstanceOf(Error);
      expect({
        name: (caught as Error).name,
        message: (caught as Error).message,
        fields: Object.keys(caught as object),
      }).toEqual({
        name: "Error",
        message: "Live mutation did not complete",
        fields: [],
      });
    },
  );
});

function withProjectionFault(
  deps: LiveVaultDependencies,
  faultCall: number,
  corrupt: (result: VaultSyncResult) => VaultSyncResult,
): LiveVaultDependencies {
  let callCount = 0;
  return {
    ...deps,
    syncProjection: async () => {
      const result = await deps.syncProjection();
      callCount += 1;
      return callCount === faultCall ? corrupt(result) : result;
    },
  };
}

function corruptUpdatedTypePayload(kind: VaultScenarioKind, item: VaultItem): VaultItem {
  switch (kind) {
    case "login":
      return { ...item, fields: item.fields.map((field) =>
        field.id === "username" ? { ...field, value: "private mismatch" } : field) };
    case "card":
      return { ...item, card: item.card ? { ...item.card, brand: "private mismatch" } : undefined };
    case "identity":
      return { ...item, identity: item.identity ? { ...item.identity, firstName: "private mismatch" } : undefined };
    case "secure-note":
      return { ...item, notes: "private mismatch" };
  }
}

class VaultScenarioHarness {
  readonly context = createLiveRunContext("self-hosted", "mutation", () => new Uint8Array(16).fill(9));
  readonly syncSnapshots: string[] = [];
  readonly failureStage: string | undefined;
  currentCipher: VaultItem | null = null;
  currentFolder: { id: string; name: string } | null = null;
  cipherDeleteCalls = 0;
  folderDeleteCalls = 0;
  favorited = false;
  passwordHistoryWasVerified = false;
  cleanupVerified = false;
  private pendingSyncStage = "";
  private failureConsumed = false;
  private lastCipherKind: VaultScenarioKind | null = null;
  readonly readOnlyAssertions: string[] = [];
  readOnlyServiceSyncCalls = 0;
  readOnlyTransportSwitches = 0;
  private readOnlyOffline = false;
  private readonly corruptCreateKind: VaultScenarioKind | undefined;

  constructor(failureStage?: string, corruptCreateKind?: VaultScenarioKind) {
    this.failureStage = failureStage;
    this.corruptCreateKind = corruptCreateKind;
  }

  dependencies(): LiveVaultDependencies {
    return {
      session: fakeSession(),
      context: this.context,
      api: {
        getSync: async () => this.rawSync(),
        putPartialCipher: async () => this.advance("favorite"),
        putArchiveCiphers: async () => this.advance("archive"),
        putUnarchiveCiphers: async () => this.advance("unarchive"),
        putDeleteCipher: async () => this.advance("trash"),
        putRestoreCipher: async () => this.advance("restore"),
        deleteCipher: async () => this.deleteCipher(),
      },
      folders: {
        create: async (_session, name) => {
          this.currentFolder = { id: "folder-server-id", name };
          this.pendingSyncStage = "create";
          return { committed: true, folder: this.currentFolder, status: "" };
        },
        update: async (_session, id, name) => {
          this.fail("update");
          this.currentFolder = { id, name };
          this.pendingSyncStage = "update";
          return { committed: true, folder: this.currentFolder, status: "" };
        },
        delete: async () => {
          this.fail("delete");
          this.folderDeleteCalls += 1;
          this.currentFolder = null;
          this.pendingSyncStage = "delete";
          return { committed: true, status: "" };
        },
      },
      writes: {
        createLoginCipher: async (_session, draft) => this.createCipher("login", draft.name),
        updateLoginCipher: async (_session, item, draft) => this.updateCipher("login", item, draft.name),
        createCardCipher: async (_session, draft) => this.createCipher("card", draft.name),
        updateCardCipher: async (_session, item, draft) => this.updateCipher("card", item, draft.name),
        createIdentityCipher: async (_session, draft) => this.createCipher("identity", draft.name),
        updateIdentityCipher: async (_session, item, draft) => this.updateCipher("identity", item, draft.name),
        createSecureNoteCipher: async (_session, draft) => this.createCipher("secure-note", draft.name),
        updateSecureNoteCipher: async (_session, item, draft) => this.updateCipher("secure-note", item, draft.name),
      },
      syncProjection: async () => this.projection(),
    };
  }

  readOnlyDependencies(): LiveVaultReadOnlyDependencies {
    const retainedItem = fakeItem("card", "retained");
    return {
      service: "self-hosted",
      syncNow: async () => {
        this.readOnlyServiceSyncCalls += 1;
        if (!this.readOnlyOffline) this.readOnlyAssertions.push("fresh");
      },
      snapshot: () => ({
        vaultSyncStatus: this.readOnlyOffline ? "stale" : "fresh",
        lastSuccessfulSyncDate: new Date(0),
        items: [retainedItem],
        folders: [],
        sends: [],
        ...(this.readOnlyOffline ? { message: "无法同步，正在显示已保存的密码库数据。" } : {}),
      }),
      useTransportFailure: () => {
        this.readOnlyTransportSwitches += 1;
        this.readOnlyOffline = true;
      },
      failInitial: async () => ({
        vaultSyncStatus: "unavailable",
        lastSuccessfulSyncDate: null,
        items: [],
        folders: [],
        sends: [],
        message: "无法加载密码库，请重试。",
      }),
      assertRetained: (snapshot) => {
        if (snapshot.vaultSyncStatus === "stale") this.readOnlyAssertions.push("stale");
        if (snapshot.vaultSyncStatus === "unavailable") this.readOnlyAssertions.push("unavailable");
      },
    };
  }

  private createCipher(kind: VaultScenarioKind, name: string): VaultItem {
    const created = fakeItem(kind, name);
    this.currentCipher = this.corruptCreateKind === kind
      ? corruptCreatedServerPayload(kind, created)
      : created;
    this.lastCipherKind = kind;
    this.pendingSyncStage = "create";
    return this.currentCipher;
  }

  private updateCipher(kind: VaultScenarioKind, item: VaultItem, name: string): VaultItem {
    this.fail("update");
    this.currentCipher = {
      ...item,
      type: kind,
      name,
      favorite: true,
      ...updatedTypePayload(kind),
    };
    this.pendingSyncStage = "update";
    return this.currentCipher;
  }

  private advance(stage: string): void {
    this.fail(stage);
    if (!this.currentCipher) throw new Error("missing cipher");
    if (stage === "favorite") this.favorited = true;
    if (stage === "archive") this.currentCipher = { ...this.currentCipher, archivedDate: "2026-01-01" };
    if (stage === "unarchive") this.currentCipher = { ...this.currentCipher, archivedDate: undefined };
    if (stage === "trash") this.currentCipher = { ...this.currentCipher, deletedDate: "2026-01-01" };
    if (stage === "restore") this.currentCipher = { ...this.currentCipher, deletedDate: undefined };
    this.pendingSyncStage = stage;
  }

  private deleteCipher(): void {
    this.fail("delete");
    this.cipherDeleteCalls += 1;
    this.currentCipher = null;
    this.pendingSyncStage = "delete";
  }

  private rawSync(): unknown {
    const stage = this.currentCipher
      ? this.currentCipher.deletedDate ? "deleted" : this.currentCipher.archivedDate ? "archived" : "active"
      : this.currentFolder ? "active" : "absent";
    this.syncSnapshots.push(`${this.currentCipher?.type ?? this.lastCipherKind ?? "folder"}:${stage}`);
    const syncStage = this.pendingSyncStage;
    this.pendingSyncStage = "";
    this.fail(syncStage ? `${syncStage}-sync` : "");
    if (stage === "absent") this.cleanupVerified = true;
    return {
      Ciphers: this.currentCipher ? [{
        Id: this.currentCipher.id,
        ...(this.currentCipher.archivedDate ? { ArchivedDate: this.currentCipher.archivedDate } : {}),
        ...(this.currentCipher.deletedDate ? { DeletedDate: this.currentCipher.deletedDate } : {}),
      }] : [],
      Folders: this.currentFolder ? [{ Id: this.currentFolder.id }] : [],
      Sends: [],
    };
  }

  private projection(): VaultSyncResult {
    const item = this.currentCipher;
    if (item?.type === "login" && item.passwordHistory?.some((entry) => entry.password === "synthetic-password")) {
      this.passwordHistoryWasVerified = true;
    }
    return {
      items: item && !item.archivedDate && !item.deletedDate ? [item] : [],
      archivedItems: item?.archivedDate ? [item] : [],
      deletedItems: item?.deletedDate ? [item] : [],
      folders: this.currentFolder ? [this.currentFolder] : [],
      organizations: [], collections: [], sends: [], sendPolicy: { disabled: false, hideEmailAllowed: true },
      cipherCount: item ? 1 : 0, encryptedCipherCount: 0, folderCount: this.currentFolder ? 1 : 0, sendCount: 0,
    };
  }

  private fail(stage: string): void {
    if (!this.failureConsumed && this.failureStage === stage) {
      this.failureConsumed = true;
      throw new Error(`fail ${stage}`);
    }
  }
}

function fakeSession(): AuthSession {
  return {
    environment: { apiUrl: "https://example.test", identityUrl: "https://identity.example.test", webVaultUrl: "https://vault.example.test" },
    token: { accessToken: "access", refreshToken: "refresh", tokenType: "Bearer", expiresIn: 3600 },
  };
}

function fakeItem(type: VaultScenarioKind, name: string): VaultItem {
  return {
    id: "cipher-server-id", type, name, subtitle: "", favorite: false, folderId: "", folderName: "", organizationName: "",
    attachmentCount: 0, uris: [], fields: [], createdDate: "", revisionDate: "", notes: "", canLaunch: false, canFill: false, uri: "",
    ...createdTypePayload(type),
  };
}

function createdTypePayload(kind: VaultScenarioKind): Partial<VaultItem> {
  switch (kind) {
    case "login":
      return {
        passwordHistory: [],
        fields: [
          { id: "username", label: "Username", value: "synthetic-user" },
          { id: "password", label: "Password", value: "synthetic-password" },
        ],
      };
    case "card":
      return {
        card: {
          cardholderName: "Synthetic User", brand: "Visa", number: "4111111111111111",
          expMonth: "04", expYear: "2029", code: "123",
        },
      };
    case "identity":
      return {
        identity: {
          title: "Dr", firstName: "Ada", middleName: "Augusta", lastName: "Lovelace",
          username: "synthetic-identity", company: "Analytical Engines", ssn: "000-00-0000",
          passportNumber: "P1234567", licenseNumber: "L7654321", email: "identity@example.test",
          phone: "+44 20 0000", address1: "12 Engine Lane", address2: "Suite 2",
          address3: "Research Park", city: "London", state: "Greater London", postalCode: "N1 1AA",
          country: "United Kingdom",
        },
      };
    case "secure-note":
      return { notes: "isolated mutation smoke", secureNote: { type: 0 } };
  }
}

function corruptCreatedServerPayload(kind: VaultScenarioKind, item: VaultItem): VaultItem {
  const mismatchedName = `${item.name} server mismatch`;
  switch (kind) {
    case "login":
      return {
        ...item,
        name: mismatchedName,
        fields: item.fields.map((field) =>
          field.id === "username" ? { ...field, value: "server mismatch" } : field),
      };
    case "card":
      return {
        ...item,
        name: mismatchedName,
        card: item.card ? { ...item.card, brand: "server mismatch" } : undefined,
      };
    case "identity":
      return {
        ...item,
        name: mismatchedName,
        identity: item.identity ? { ...item.identity, firstName: "server mismatch" } : undefined,
      };
    case "secure-note":
      return { ...item, name: mismatchedName, notes: "server mismatch" };
  }
}

function updatedTypePayload(kind: VaultScenarioKind): Partial<VaultItem> {
  switch (kind) {
    case "login":
      return {
        fields: [
          { id: "username", label: "Username", value: "synthetic-user-updated" },
          { id: "password", label: "Password", value: "synthetic-password-updated" },
        ],
        passwordHistory: [{ password: "synthetic-password", lastUsedDate: "2026-01-01" }],
      };
    case "card":
      return {
        card: {
          cardholderName: "Synthetic User Updated", brand: "Mastercard", number: "5555555555554444",
          expMonth: "08", expYear: "2031", code: "987",
        },
      };
    case "identity":
      return {
        identity: {
          title: "Prof", firstName: "Grace", middleName: "Brewster", lastName: "Hopper",
          username: "synthetic-identity-updated", company: "Compiler Systems", ssn: "111-11-1111",
          passportNumber: "P7654321", licenseNumber: "L1234567", email: "identity-updated@example.test",
          phone: "+1 555 0100", address1: "1 Compiler Way", address2: "Floor 3", address3: "",
          city: "Arlington", state: "Virginia", postalCode: "22201", country: "United States",
        },
      };
    case "secure-note":
      return { notes: "isolated mutation smoke updated", secureNote: { type: 0 } };
  }
}
