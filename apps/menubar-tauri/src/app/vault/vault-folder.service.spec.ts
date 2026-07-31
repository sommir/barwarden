import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import { buildBitwardenEnvironment } from "../../bitwarden-api/bitwarden-api";
import { PopupStateStore } from "../popup-state";
import {
  VaultFolderService,
  type VaultFolderApi,
  type VaultFolderCrypto,
} from "./vault-folder.service";

describe("VaultFolderService", () => {
  it("encrypts and creates a folder using the server-returned id", async () => {
    const store = new PopupStateStore();
    const api: VaultFolderApi = {
      postFolder: vi.fn(async () => ({ Id: "server-folder-id" })),
      putFolder: vi.fn(),
      deleteFolder: vi.fn(),
    };
    const crypto: VaultFolderCrypto = {
      encryptString: vi.fn(async () => "2.encrypted-finance"),
    };
    const activeSession = session();
    store.setActiveSession(activeSession);
    const ownership = ownershipGuard();

    const folder = await new VaultFolderService(store, api, crypto).create(
      activeSession,
      " Finance ",
      ownership.guard,
    );

    expect(crypto.encryptString).toHaveBeenCalledWith("Finance", expect.any(Uint8Array));
    expect(api.postFolder).toHaveBeenCalledWith(
      { name: "2.encrypted-finance" },
      "access-token",
    );
    expect(api.postFolder).toHaveBeenCalledTimes(1);
    expect(ownership.isCurrent).toHaveBeenCalledTimes(3);
    expect(folder).toEqual({
      committed: true,
      folder: { id: "server-folder-id", name: "Finance" },
      status: "",
    });
    expect(store.snapshot().folders).toEqual([]);
  });

  it("updates an existing folder only after the API succeeds", async () => {
    const store = new PopupStateStore();
    store.saveFolder({ id: "folder-1", name: "Old" });
    const api: VaultFolderApi = {
      postFolder: vi.fn(),
      putFolder: vi.fn(async () => ({ Id: "folder-1" })),
      deleteFolder: vi.fn(),
    };
    const crypto: VaultFolderCrypto = {
      encryptString: vi.fn(async () => "2.encrypted-engineering"),
    };
    const activeSession = session();
    store.setActiveSession(activeSession);
    const ownership = ownershipGuard();

    const result = await new VaultFolderService(store, api, crypto).update(
      activeSession,
      "folder-1",
      "Engineering",
      ownership.guard,
    );

    expect(api.putFolder).toHaveBeenCalledWith(
      "folder-1",
      { name: "2.encrypted-engineering" },
      "access-token",
    );
    expect(api.putFolder).toHaveBeenCalledTimes(1);
    expect(ownership.isCurrent).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      committed: true,
      folder: { id: "folder-1", name: "Engineering" },
      status: "",
    });
    expect(store.snapshot().folders).toEqual([{ id: "folder-1", name: "Old" }]);
  });

  it("deletes a folder only after the API succeeds", async () => {
    const store = new PopupStateStore();
    store.saveFolder({ id: "folder-1", name: "Finance" });
    const api: VaultFolderApi = {
      postFolder: vi.fn(),
      putFolder: vi.fn(),
      deleteFolder: vi.fn(async () => null),
    };

    const activeSession = session();
    store.setActiveSession(activeSession);
    const ownership = ownershipGuard();
    const result = await new VaultFolderService(store, api, crypto()).delete(
      activeSession,
      "folder-1",
      ownership.guard,
    );

    expect(api.deleteFolder).toHaveBeenCalledWith("folder-1", "access-token");
    expect(api.deleteFolder).toHaveBeenCalledTimes(1);
    expect(ownership.isCurrent).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ committed: true, status: "" });
    expect(store.snapshot().folders).toEqual([{ id: "folder-1", name: "Finance" }]);
  });

  it("returns fixed noncommitted failures and preserves local state", async () => {
    const store = new PopupStateStore();
    store.saveFolder({ id: "folder-1", name: "Private Folder" });
    const api: VaultFolderApi = {
      postFolder: vi.fn(),
      putFolder: vi.fn(async () => {
        throw new Error("Private Folder and encrypted response body");
      }),
      deleteFolder: vi.fn(async () => {
        throw new Error("Private Folder and encrypted response body");
      }),
    };
    const service = new VaultFolderService(store, api, crypto());

    const activeSession = session();
    store.setActiveSession(activeSession);
    await expect(service.update(
      activeSession,
      "folder-1",
      "Renamed Private Folder",
      ownershipGuard().guard,
    )).resolves.toEqual({
      committed: false,
      reason: "failure",
      status: "无法保存文件夹，请重试。",
    });
    await expect(service.delete(activeSession, "folder-1", ownershipGuard().guard)).resolves.toEqual({
      committed: false,
      reason: "failure",
      status: "无法删除文件夹，请重试。",
    });

    expect(store.snapshot().folders).toEqual([{ id: "folder-1", name: "Private Folder" }]);
  });

  it("ignores a successful create response after the active account changes", async () => {
    const store = new PopupStateStore();
    const originalSession = session();
    store.setActiveSession(originalSession);
    const response = deferred<{ Id: string }>();
    const api: VaultFolderApi = {
      postFolder: vi.fn(async () => response.promise),
      putFolder: vi.fn(),
      deleteFolder: vi.fn(),
    };
    const service = new VaultFolderService(store, api, crypto());
    const ownership = ownershipGuard();

    const create = service.create(originalSession, "Finance", ownership.guard);
    store.setActiveSession({
      ...session(),
      token: { ...session().token, accessToken: "other-account-token" },
    });
    response.resolve({ Id: "stale-folder" });

    await expect(create).resolves.toEqual({ committed: false, reason: "stale", status: "" });
    expect(store.snapshot().folders).toEqual([]);
  });

  it("ignores successful update and delete responses after the active account changes", async () => {
    for (const action of ["update", "delete"] as const) {
      const store = new PopupStateStore();
      store.saveFolder({ id: "folder-1", name: "Original" });
      const originalSession = session();
      store.setActiveSession(originalSession);
      const completion = deferred<void>();
      const api: VaultFolderApi = {
        postFolder: vi.fn(),
        putFolder: vi.fn(async () => completion.promise),
        deleteFolder: vi.fn(async () => completion.promise),
      };
      const service = new VaultFolderService(store, api, crypto());
      const ownership = ownershipGuard();

      const operation = action === "update"
        ? service.update(originalSession, "folder-1", "Renamed", ownership.guard)
        : service.delete(originalSession, "folder-1", ownership.guard);
      store.setActiveSession({
        ...session(),
        token: { ...session().token, accessToken: `other-${action}-token` },
      });
      completion.resolve();

      await expect(operation).resolves.toEqual({ committed: false, reason: "stale", status: "" });
      expect(store.snapshot().folders).toEqual([{ id: "folder-1", name: "Original" }]);
    }
  });

  it("rejects a blank folder name before encryption or network access", async () => {
    const store = new PopupStateStore();
    const api: VaultFolderApi = {
      postFolder: vi.fn(),
      putFolder: vi.fn(),
      deleteFolder: vi.fn(),
    };
    const folderCrypto = crypto();

    await expect(new VaultFolderService(store, api, folderCrypto).create(
      session(),
      "   ",
      ownershipGuard().guard,
    )).resolves.toEqual({
      committed: false,
      reason: "failure",
      status: "无法保存文件夹，请重试。",
    });

    expect(folderCrypto.encryptString).not.toHaveBeenCalled();
    expect(api.postFolder).not.toHaveBeenCalled();
  });

  it("stops before transport when the active session locks during encryption", async () => {
    const store = new PopupStateStore();
    const activeSession = session();
    store.setActiveSession(activeSession);
    const encryption = deferred<string>();
    const api: VaultFolderApi = { postFolder: vi.fn(), putFolder: vi.fn(), deleteFolder: vi.fn() };
    const crypto: VaultFolderCrypto = { encryptString: vi.fn(() => encryption.promise) };

    const create = new VaultFolderService(store, api, crypto).create(
      activeSession,
      "Finance",
      ownershipGuard().guard,
    );
    store.setLocked();
    encryption.resolve("2.encrypted-finance");

    await expect(create).resolves.toEqual({ committed: false, reason: "stale", status: "" });
    expect(api.postFolder).not.toHaveBeenCalled();
    expect(store.snapshot().folders).toEqual([]);
  });

  it("returns a fixed failure without crypto or Web API access when no session is active", async () => {
    const store = new PopupStateStore();
    const api: VaultFolderApi = { postFolder: vi.fn(), putFolder: vi.fn(), deleteFolder: vi.fn() };
    const folderCrypto = crypto();

    await expect(new VaultFolderService(store, api, folderCrypto).create(
      null,
      "Finance",
      ownershipGuard().guard,
    )).resolves.toEqual({
      committed: false,
      reason: "failure",
      status: "无法保存文件夹，请重试。",
    });
    expect(folderCrypto.encryptString).not.toHaveBeenCalled();
    expect(api.postFolder).not.toHaveBeenCalled();
    expect(store.snapshot().folders).toEqual([]);
  });

  it("rejects stale operation ownership at entry before encryption or transport", async () => {
    const store = new PopupStateStore();
    const activeSession = session();
    store.setActiveSession(activeSession);
    const api: VaultFolderApi = { postFolder: vi.fn(), putFolder: vi.fn(), deleteFolder: vi.fn() };
    const folderCrypto = crypto();
    const ownership = ownershipGuard(false);

    await expect(new VaultFolderService(store, api, folderCrypto).create(
      activeSession,
      "Finance",
      ownership.guard,
    )).resolves.toEqual({ committed: false, reason: "stale", status: "" });

    expect(folderCrypto.encryptString).not.toHaveBeenCalled();
    expect(api.postFolder).not.toHaveBeenCalled();
  });

  it("rechecks exact operation ownership immediately before transport after encryption", async () => {
    const store = new PopupStateStore();
    const activeSession = session();
    store.setActiveSession(activeSession);
    const encryption = deferred<string>();
    const api: VaultFolderApi = { postFolder: vi.fn(), putFolder: vi.fn(), deleteFolder: vi.fn() };
    const folderCrypto: VaultFolderCrypto = { encryptString: vi.fn(() => encryption.promise) };
    const ownership = ownershipGuard();

    const create = new VaultFolderService(store, api, folderCrypto).create(
      activeSession,
      "Finance",
      ownership.guard,
    );
    ownership.invalidate();
    encryption.resolve("2.encrypted-finance");

    await expect(create).resolves.toEqual({ committed: false, reason: "stale", status: "" });
    expect(api.postFolder).not.toHaveBeenCalled();
  });

  it("rechecks exact operation ownership after create, update, and delete transport", async () => {
    for (const action of ["create", "update", "delete"] as const) {
      const store = new PopupStateStore();
      const activeSession = session();
      store.setActiveSession(activeSession);
      const completion = deferred<unknown>();
      const transportStarted = deferred<void>();
      const api: VaultFolderApi = {
        postFolder: vi.fn(() => {
          transportStarted.resolve();
          return completion.promise;
        }),
        putFolder: vi.fn(() => {
          transportStarted.resolve();
          return completion.promise;
        }),
        deleteFolder: vi.fn(() => {
          transportStarted.resolve();
          return completion.promise;
        }),
      };
      const ownership = ownershipGuard();
      const service = new VaultFolderService(store, api, crypto());

      const operation = action === "create"
        ? service.create(activeSession, "Finance", ownership.guard)
        : action === "update"
          ? service.update(activeSession, "folder-1", "Finance", ownership.guard)
          : service.delete(activeSession, "folder-1", ownership.guard);
      await transportStarted.promise;
      ownership.invalidate();
      completion.resolve(action === "create" ? { Id: "server-folder" } : null);

      await expect(operation).resolves.toEqual({ committed: false, reason: "stale", status: "" });
      expect(api.postFolder).toHaveBeenCalledTimes(action === "create" ? 1 : 0);
      expect(api.putFolder).toHaveBeenCalledTimes(action === "update" ? 1 : 0);
      expect(api.deleteFolder).toHaveBeenCalledTimes(action === "delete" ? 1 : 0);
    }
  });
});

function crypto(): VaultFolderCrypto {
  return { encryptString: vi.fn(async () => "2.encrypted-name") };
}

function session(): AuthSession {
  return {
    environment: buildBitwardenEnvironment(),
    token: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
    crypto: {
      userKeyB64: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==",
    },
  };
}

function ownershipGuard(initiallyCurrent = true) {
  let current = initiallyCurrent;
  const isCurrent = vi.fn(() => current);
  return {
    guard: { isCurrent },
    isCurrent,
    invalidate: () => {
      current = false;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
