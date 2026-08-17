import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import { buildSelfHostedEnvironmentFromServerUrl } from "../../bitwarden-api/bitwarden-api";
import { AppFeedbackService } from "../official-ui/app-feedback.service";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";
import { demoVaultItems, type VaultItem } from "../vault-demo";
import { toRecoveryPopupCipherView } from "./popup-cipher-view.adapter";
import {
  RecoveryPageActionsAdapter,
  type RecoveryPageActionResult,
  type RecoveryConfirmationRequest,
  type RecoveryRepromptRequest,
} from "./recovery-page-actions.adapter";
import { VaultActionsService, type VaultCipherActionPort } from "./vault-actions.service";

beforeEach(async () => {
  await new OfficialI18nService().setLocale("en-US");
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});

describe("RecoveryPageActionsAdapter", () => {
  it("announces a committed recovery action while retaining the popup status state", async () => {
    const feedback = new AppFeedbackService();
    const harness = setup({ feedback, location: "trash" });

    await harness.adapter.execute({ command: "restore", location: "trash", item: harness.view });

    expect(harness.store.snapshot().statusMessage).toBe("Item restored");
    expect(feedback.snapshot()).toMatchObject({ kind: "success", message: "Item restored" });
  });
  it.each(demoVaultItems.slice(0, 4).map((item) => [item.type, item] as const))(
    "restores one personal %s through the server and exact Trash source",
    async (_type, source) => {
      const harness = setup({ location: "trash", item: { ...source, id: `deleted-${source.type}` } });

      await expect(harness.adapter.execute({
        command: "restore",
        location: "trash",
        item: harness.view,
      })).resolves.toEqual({ terminal: true, status: "Item restored" });

      expect(harness.store.snapshot().deletedItems).not.toContain(harness.item);
      expect(harness.server.restoreCipher).toHaveBeenCalledTimes(1);
      expect(harness.store.snapshot().items).toContain(harness.item);
      expect(harness.store.snapshot().statusMessage).toBe("Item restored");
    },
  );

  it.each(demoVaultItems.slice(0, 4).map((item) => [item.type, item] as const))(
    "proves the complete pending, retry, stale, and restore matrix for %s",
    async (_type, source) => {
      const item = { ...source, id: `matrix-${source.type}` };

      const duplicateCompletion = deferred<void>();
      const duplicate = setup({
        location: "archive",
        item,
        lifecycleCompletion: duplicateCompletion.promise,
      });
      const first = duplicate.adapter.execute({
        command: "unarchive",
        location: "archive",
        item: duplicate.view,
      });
      await vi.waitFor(() => expect(duplicate.server.unarchiveCipher).toHaveBeenCalledOnce());
      await expect(duplicate.adapter.execute({
        command: "unarchive",
        location: "archive",
        item: duplicate.view,
      })).resolves.toEqual({ terminal: false, status: "Action already in progress." });
      expect(duplicate.server.unarchiveCipher).toHaveBeenCalledOnce();
      duplicateCompletion.resolve();
      await expect(first).resolves.toEqual({ terminal: true, status: "Item unarchived" });

      const retry = setup({ location: "trash", item, failFirst: "restore" });
      const restore = { command: "restore", location: "trash", item: retry.view } as const;
      await expect(retry.adapter.execute(restore))
        .resolves.toEqual({ terminal: false, status: "Unable to restore item." });
      expect(retry.store.snapshot().deletedItems).toEqual([retry.item]);
      await expect(retry.adapter.execute(restore))
        .resolves.toEqual({ terminal: true, status: "Item restored" });
      expect(retry.server.restoreCipher).toHaveBeenCalledTimes(2);

      for (const staleKind of ["lock", "account-switch", "route-destruction", "source-replacement"] as const) {
        const completion = deferred<void>();
        const stale = setup({
          location: "trash",
          item,
          lifecycleCompletion: completion.promise,
        });
        const pending = stale.adapter.execute({
          command: "restore",
          location: "trash",
          item: stale.view,
        });
        await vi.waitFor(() => expect(stale.server.restoreCipher).toHaveBeenCalledOnce());

        if (staleKind === "lock") {
          stale.store.setLocked();
        } else if (staleKind === "account-switch") {
          stale.store.setActiveSession(fakeSession("account-b"));
          stale.store.setDeletedItems([{ ...stale.item, name: "New account item" }]);
        } else if (staleKind === "route-destruction") {
          stale.router.url = "/tabs/settings";
          stale.adapter.ngOnDestroy();
          stale.store.setDeletedItems([{ ...stale.item, name: "New route item" }]);
        } else {
          stale.store.setDeletedItems([{ ...stale.item, name: "Fresh sync replacement" }]);
        }
        stale.store.setOrganizationData(
          [{
            id: `organization-${staleKind}`,
            name: "New organization",
            enabled: true,
            status: 2,
          }],
          [{
            id: `collection-${staleKind}`,
            name: "New collection",
            organizationId: `organization-${staleKind}`,
            readOnly: false,
            manage: true,
          }],
        );
        stale.store.setStatus(`Newer ${staleKind} status`);
        const newer = stale.store.snapshot();
        completion.resolve();

        await expect(pending)
          .resolves.toEqual({ terminal: false, status: "Vault changed; action not applied." });
        const after = stale.store.snapshot();
        expect(after.activeSession).toBe(newer.activeSession);
        expect(after.items).toBe(newer.items);
        expect(after.archivedItems).toBe(newer.archivedItems);
        expect(after.deletedItems).toBe(newer.deletedItems);
        expect(after.organizations).toBe(newer.organizations);
        expect(after.collections).toBe(newer.collections);
        expect(after.statusMessage).toBe(`Newer ${staleKind} status`);
        expect(stale.router.url).toBe(staleKind === "route-destruction" ? "/tabs/settings" : "/trash");
      }

      const activeRestore = setup({ location: "trash", item: { ...item, archivedDate: undefined } });
      await activeRestore.adapter.execute({
        command: "restore",
        location: "trash",
        item: activeRestore.view,
      });
      expect(activeRestore.store.snapshot().items).toEqual([activeRestore.item]);
      expect(activeRestore.store.snapshot().archivedItems).toEqual([]);

      const archiveRestore = setup({
        location: "trash",
        item: { ...item, archivedDate: "2026-07-01T00:00:00.000Z" },
      });
      await archiveRestore.adapter.execute({
        command: "restore",
        location: "trash",
        item: archiveRestore.view,
      });
      expect(archiveRestore.store.snapshot().items).toEqual([]);
      expect(archiveRestore.store.snapshot().archivedItems).toEqual([archiveRestore.item]);
      expect(archiveRestore.router.navigateByUrl).toHaveBeenCalledWith("/archive");
    },
  );

  it("preserves view, edit, and clone route identity for the exact Archive source", async () => {
    const harness = setup({ location: "archive" });

    await harness.adapter.execute({ command: "view", location: "archive", item: harness.view });
    harness.router.url = "/archive";
    await harness.adapter.execute({ command: "edit", location: "archive", item: harness.view });
    harness.router.url = "/archive";
    await harness.adapter.execute({ command: "clone", location: "archive", item: harness.view });

    expect(harness.router.navigateByUrl).toHaveBeenCalledWith(`/view-cipher/${harness.item.id}`);
    expect(harness.router.navigate).toHaveBeenNthCalledWith(1, ["/edit-cipher"], {
      queryParams: { cipherId: harness.item.id, type: "1" },
    });
    expect(harness.router.navigate).toHaveBeenNthCalledWith(2, ["/clone-cipher"], {
      queryParams: { cipherId: harness.item.id, type: "1" },
    });
  });

  it("resolves an authentic projection to the exact original source object", async () => {
    const harness = setup({ location: "archive" });
    const action = vi.spyOn(harness.actions, "unarchiveItemWithOutcome");

    await expect(harness.adapter.execute({
      command: "unarchive",
      location: "archive",
      item: harness.view,
    })).resolves.toEqual({ terminal: true, status: "Item unarchived" });

    expect(action).toHaveBeenCalledOnce();
    expect(action.mock.calls[0]?.[0]).toBe(harness.item);
  });

  it("queues one reprompt and rejects a cancelled reprompt without transport", async () => {
    let continuation: (() => Promise<void>) | undefined;
    const requestReprompt: RecoveryRepromptRequest = (_itemId, next) => {
      continuation = next;
      return true;
    };
    const accepted = setup({ location: "trash", reprompt: true, requestReprompt });

    await expect(accepted.adapter.execute({
      command: "restore",
      location: "trash",
      item: accepted.view,
    })).resolves.toEqual({ terminal: false, status: "Verification required." });
    expect(accepted.server.restoreCipher).not.toHaveBeenCalled();
    await continuation!();
    expect(accepted.server.restoreCipher).toHaveBeenCalledOnce();

    const rejected = setup({
      location: "trash",
      reprompt: true,
      requestReprompt: () => false,
    });
    await expect(rejected.adapter.execute({
      command: "restore",
      location: "trash",
      item: rejected.view,
    })).resolves.toEqual({ terminal: false, status: "Unable to verify master password." });
    expect(rejected.server.restoreCipher).not.toHaveBeenCalled();
  });

  it.each(["soft-delete", "permanent-delete"] as const)(
    "requires explicit confirmation before %s",
    async (command) => {
      let continuation: (() => Promise<RecoveryPageActionResult>) | undefined;
      const requestConfirmation: RecoveryConfirmationRequest = (_command, _item, next) => {
        continuation = next;
        return true;
      };
      const location = command === "soft-delete" ? "archive" : "trash";
      const harness = setup({ location, requestConfirmation });

      await expect(harness.adapter.execute({ command, location, item: harness.view }))
        .resolves.toEqual({ terminal: false, status: "Confirmation required." });
      expect(harness.server.softDeleteCipher).not.toHaveBeenCalled();
      expect(harness.server.deleteCipher).not.toHaveBeenCalled();
      await continuation!();
      expect(command === "soft-delete" ? harness.server.softDeleteCipher : harness.server.deleteCipher)
        .toHaveBeenCalledOnce();

      const cancelled = setup({ location, requestConfirmation: () => false });
      await expect(cancelled.adapter.execute({ command, location, item: cancelled.view }))
        .resolves.toEqual({ terminal: false, status: "Action cancelled." });
      expect(cancelled.server.softDeleteCipher).not.toHaveBeenCalled();
      expect(cancelled.server.deleteCipher).not.toHaveBeenCalled();
    },
  );

  it("reprompts before opening permanent-delete confirmation and forwards the trigger", async () => {
    const sequence: string[] = [];
    const trigger = document.createElement("button");
    let confirmationTrigger: HTMLElement | undefined;
    let confirmationContinuation: (() => Promise<RecoveryPageActionResult>) | undefined;
    let repromptContinuation: (() => Promise<void>) | undefined;
    const harness = setup({
      location: "trash",
      reprompt: true,
      requestReprompt: (_itemId, next) => {
        sequence.push("reprompt");
        repromptContinuation = next;
        return true;
      },
      requestConfirmation: (_command, _item, next, invokingTrigger) => {
        sequence.push("confirmation");
        confirmationContinuation = next;
        confirmationTrigger = invokingTrigger;
        return true;
      },
    });

    await expect(harness.adapter.execute({
      command: "permanent-delete",
      location: "trash",
      item: harness.view,
      trigger,
    })).resolves.toEqual({ terminal: false, status: "Verification required." });
    expect(sequence).toEqual(["reprompt"]);
    expect(harness.server.deleteCipher).not.toHaveBeenCalled();
    await repromptContinuation!();
    expect(sequence).toEqual(["reprompt", "confirmation"]);
    expect(confirmationTrigger).toBe(trigger);
    await expect(confirmationContinuation!())
      .resolves.toEqual({ terminal: true, status: "Item permanently deleted" });
    expect(harness.server.deleteCipher).toHaveBeenCalledOnce();
  });

  it("rejects a wrong location, unsupported command, forged projection, and source replacement", async () => {
    const harness = setup({ location: "archive" });
    const forged = { ...harness.view };
    const replaced = toRecoveryPopupCipherView({ ...harness.item })!;

    await expect(harness.adapter.execute({ command: "restore", location: "archive", item: harness.view }))
      .resolves.toEqual({ terminal: false, status: "Vault changed; action not applied." });
    await expect(harness.adapter.execute({ command: "unarchive", location: "trash", item: harness.view }))
      .resolves.toEqual({ terminal: false, status: "Vault changed; action not applied." });
    await expect(harness.adapter.execute({ command: "unarchive", location: "archive", item: forged }))
      .resolves.toEqual({ terminal: false, status: "Vault changed; action not applied." });
    await expect(harness.adapter.execute({ command: "unarchive", location: "archive", item: replaced }))
      .resolves.toEqual({ terminal: false, status: "Vault changed; action not applied." });

    harness.store.setArchivedItems([{ ...harness.item, name: "Synced replacement" }]);
    await expect(harness.adapter.execute({ command: "unarchive", location: "archive", item: harness.view }))
      .resolves.toEqual({ terminal: false, status: "Vault changed; action not applied." });
    expect(harness.server.unarchiveCipher).not.toHaveBeenCalled();
  });

  it("does not let a destroyed page completion mutate collections, status, or route", async () => {
    const completion = deferred<void>();
    const harness = setup({ location: "trash", lifecycleCompletion: completion.promise });
    const pending = harness.adapter.execute({ command: "restore", location: "trash", item: harness.view });
    await Promise.resolve();

    harness.adapter.ngOnDestroy();
    harness.router.url = "/tabs/settings";
    harness.store.setStatus("Newer status");
    completion.resolve();

    await expect(pending).resolves.toEqual({ terminal: false, status: "Vault changed; action not applied." });
    expect(harness.store.snapshot().deletedItems).toEqual([harness.item]);
    expect(harness.store.snapshot().items).toEqual([]);
    expect(harness.store.snapshot().statusMessage).toBe("Newer status");
    expect(harness.router.navigateByUrl).not.toHaveBeenCalled();
  });

  it("returns a restored archived Trash item to Archive", async () => {
    const harness = setup({
      location: "trash",
      item: { ...demoVaultItems[3], id: "deleted-archived-note", archivedDate: "2026-07-01T00:00:00Z" },
    });

    await expect(harness.adapter.execute({ command: "restore", location: "trash", item: harness.view }))
      .resolves.toEqual({ terminal: true, status: "Archived item restored" });
    expect(harness.store.snapshot().items).toEqual([]);
    expect(harness.store.snapshot().archivedItems).toEqual([harness.item]);
    expect(harness.router.navigateByUrl).toHaveBeenCalledWith("/archive");
  });

  it.each([
    ["returning false", false],
    ["rejecting", "reject"],
  ] as const)(
    "keeps a committed lifecycle result terminal with fixed status when routing is %s",
    async (_label, navigationOutcome) => {
      const harness = setup({ location: "archive", navigationOutcome });

      const command = { command: "unarchive", location: "archive", item: harness.view } as const;
      await expect(harness.adapter.execute(command))
        .resolves.toEqual({ terminal: true, status: "Item unarchived" });

      expect(harness.store.snapshot().archivedItems).not.toContain(harness.item);
      expect(harness.store.snapshot().items).toContain(harness.item);
      expect(harness.store.snapshot().statusMessage).toBe("Item unarchived");

      await expect(harness.adapter.execute(command))
        .resolves.toEqual({ terminal: false, status: "Vault changed; action not applied." });
      expect(harness.store.snapshot().archivedItems).not.toContain(harness.item);
      expect(harness.store.snapshot().items).toContain(harness.item);
      expect(harness.store.snapshot().statusMessage).toBe("Item unarchived");
    },
  );
});

function setup(options: SetupOptions = {}) {
  const store = new PopupStateStore();
  const session = fakeSession("account-a");
  const item = {
    ...(options.item ?? demoVaultItems[0]),
    ...(options.reprompt ? { reprompt: true } : {}),
  } as VaultItem;
  const location = options.location ?? "archive";
  store.setUnlocked("person@example.test");
  store.setActiveSession(session);
  if (location === "archive") {
    store.setArchivedItems([item]);
  } else {
    store.setDeletedItems([item]);
  }
  let failed = false;
  const maybeFail = async (action: SetupOptions["failFirst"]): Promise<void> => {
    if (options.failFirst === action && !failed) {
      failed = true;
      throw new Error("Synthetic server failure");
    }
    await options.lifecycleCompletion;
  };
  const server = {
    updateCipherPartial: vi.fn(async () => undefined),
    softDeleteCipher: vi.fn(async () => maybeFail("soft-delete")),
    archiveCipher: vi.fn(async () => maybeFail("archive")),
    unarchiveCipher: vi.fn(async () => maybeFail("unarchive")),
    restoreCipher: vi.fn(async () => maybeFail("restore")),
    deleteCipher: vi.fn(async () => maybeFail("permanent-delete")),
  } satisfies VaultCipherActionPort;
  const actions = new VaultActionsService(null, new SettingsService(), store, server);
  const router = {
    url: location === "archive" ? "/archive" : "/trash",
    navigateByUrl: vi.fn(async (url: string) => {
      if (options.navigationOutcome === "reject") {
        throw new Error("route refresh failed");
      }
      if (options.navigationOutcome === false) {
        return false;
      }
      router.url = url;
      return true;
    }),
    navigate: vi.fn(async (commands: readonly string[]) => {
      router.url = commands[0] ?? router.url;
      return true;
    }),
  };
  const view = toRecoveryPopupCipherView(item)!;
  const adapter = new RecoveryPageActionsAdapter(
    store,
    router as never,
    actions,
    options.requestReprompt,
    options.requestConfirmation,
    options.feedback,
  );
  return { actions, adapter, item, router, server, session, store, view };
}

interface SetupOptions {
  readonly feedback?: AppFeedbackService;
  readonly failFirst?: "archive" | "unarchive" | "soft-delete" | "restore" | "permanent-delete";
  readonly item?: VaultItem;
  readonly lifecycleCompletion?: Promise<void>;
  readonly navigationOutcome?: false | "reject";
  readonly location?: "archive" | "trash";
  readonly reprompt?: boolean;
  readonly requestConfirmation?: RecoveryConfirmationRequest;
  readonly requestReprompt?: RecoveryRepromptRequest;
}

function fakeSession(account: string): AuthSession {
  return {
    environment: buildSelfHostedEnvironmentFromServerUrl(`https://${account}.example.test`),
    token: {
      accessToken: `${account}-access-token`,
      refreshToken: `${account}-refresh-token`,
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
