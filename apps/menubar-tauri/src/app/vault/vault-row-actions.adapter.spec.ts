import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import { AppFeedbackService } from "../official-ui/app-feedback.service";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";
import { demoVaultItems, type VaultField, type VaultItem } from "../vault-demo";
import {
  VaultActionsService,
  type VaultCipherActionPort,
  type VaultFavoriteMutationOutcome,
  type VaultRemovalMutationOutcome,
} from "./vault-actions.service";
import { VaultRowActionsAdapter } from "./vault-row-actions.adapter";
import type { VaultSessionService } from "./vault-session.service";

beforeEach(async () => {
  await new OfficialI18nService().setLocale("en-US");
});

describe("VaultRowActionsAdapter", () => {
  it("announces a committed copy while retaining the popup status state", async () => {
    const feedback = new AppFeedbackService();
    const { adapter, store } = setup(feedback);
    const field = demoVaultItems[0].fields[0]!;

    await adapter.copy(demoVaultItems[0], field);

    expect(store.snapshot().statusMessage).toBe(`Copied ${field.label}`);
    expect(feedback.snapshot()).toMatchObject({ kind: "success", message: `Copied ${field.label}` });
  });
  it("delegates View, Edit, and Clone through retained routes and query parameters", async () => {
    const { adapter, router } = setup();

    await adapter.view(demoVaultItems[0]);
    await adapter.edit(demoVaultItems[1]);
    await adapter.clone(demoVaultItems[2]);

    expect(router.navigateByUrl).toHaveBeenCalledWith("/view-cipher/github");
    expect(router.navigate).toHaveBeenNthCalledWith(1, ["/edit-cipher"], {
      queryParams: { cipherId: "card", type: "3" },
    });
    expect(router.navigate).toHaveBeenNthCalledWith(2, ["/clone-cipher"], {
      queryParams: { cipherId: "identity", type: "4" },
    });
  });

  it.each([
    ["view", "navigateByUrl", demoVaultItems[0]],
    ["edit", "navigate", demoVaultItems[1]],
    ["clone", "navigate", demoVaultItems[2]],
  ] as const)("does not own a stale %s navigation completion", async (method, routerMethod, item) => {
    const completion = deferred<boolean>();
    const { adapter, router, store } = setup();
    router[routerMethod].mockReturnValueOnce(completion.promise);

    const pending = adapter[method](item);
    router.url = "/tabs/settings";
    completion.resolve(true);
    await pending;

    expect(store.snapshot().statusMessage).toBe("");
    expect(router.navigateByUrl).toHaveBeenCalledTimes(method === "view" ? 1 : 0);
    expect(router.navigate).toHaveBeenCalledTimes(method === "view" ? 0 : 1);
  });

  it("delegates exactly one owned field to copy and single-field paste actions", async () => {
    const { actions, adapter, store } = setup();
    const username = demoVaultItems[0].fields.find((field) => field.id === "username")!;
    const password = demoVaultItems[0].fields.find((field) => field.id === "password")!;

    await adapter.copy(demoVaultItems[0], username);
    expect(actions.copyField).toHaveBeenCalledWith(username);
    expect(store.snapshot().statusMessage).toBe("Copied Username");

    await adapter.fill(demoVaultItems[0], password);
    expect(actions.fillField).toHaveBeenCalledWith(password);
    expect(store.snapshot().statusMessage).toBe("Filled Password");
  });

  it("never sends an empty, foreign, or second field to a field action", async () => {
    const { actions, adapter } = setup();
    const empty = { id: "custom:empty", label: "Empty", value: "" } satisfies VaultField;
    const foreign = { id: "custom:foreign", label: "Foreign", value: "private" } satisfies VaultField;

    await adapter.copy(demoVaultItems[0], empty);
    await adapter.fill(demoVaultItems[0], foreign);

    expect(actions.copyField).not.toHaveBeenCalled();
    expect(actions.fillField).not.toHaveBeenCalled();
  });

  it("delegates the exact TOTP and custom field once each", async () => {
    const { actions, adapter, store } = setup();
    const totp = { id: "otp", label: "Authenticator key", value: "JBSWY3DPEHPK3PXP", type: "totp" } satisfies VaultField;
    const custom = { id: "custom:pin", label: "PIN", value: "4829" } satisfies VaultField;
    const item = { ...demoVaultItems[0], fields: [...demoVaultItems[0].fields, totp, custom] };
    store.setItems([item]);

    await adapter.copy(item, totp);
    await adapter.fill(item, custom);

    expect(actions.copyField).toHaveBeenCalledTimes(1);
    expect(actions.copyField).toHaveBeenCalledWith(totp);
    expect(actions.fillField).toHaveBeenCalledTimes(1);
    expect(actions.fillField).toHaveBeenCalledWith(custom);
  });

  it("delegates launch and commits its current status", async () => {
    const { actions, adapter, store } = setup();
    actions.launchItem.mockResolvedValueOnce("Opened URL");

    await adapter.launch(demoVaultItems[0]);

    expect(actions.launchItem).toHaveBeenCalledWith(demoVaultItems[0]);
    expect(store.snapshot().statusMessage).toBe("Opened URL");
  });

  it.each(["locked", "account", "route", "item", "destroyed"] as const)(
    "suppresses a copy completion after the %s context becomes stale",
    async (staleKind) => {
      const completion = deferred<string>();
      const harness = setup();
      harness.actions.copyField.mockReturnValueOnce(completion.promise);
      const field = demoVaultItems[0].fields[0]!;
      const pending = harness.adapter.copy(demoVaultItems[0], field);

      if (staleKind === "locked") {
        harness.store.setLocked();
      } else if (staleKind === "account") {
        harness.store.setActiveSession(fakeSession("account-b"));
      } else if (staleKind === "route") {
        harness.router.url = "/tabs/settings";
      } else if (staleKind === "item") {
        harness.store.setItems([{ ...demoVaultItems[0], name: "Synced replacement" }]);
      } else {
        harness.adapter.ngOnDestroy();
      }
      completion.resolve("Copied Username");
      await pending;

      expect(harness.store.snapshot().statusMessage).not.toBe("Copied Username");
    },
  );

  it("suppresses the service stale-result marker after an item replacement", async () => {
    const completion = deferred<VaultFavoriteMutationOutcome>();
    const { actions, adapter, store } = setup();
    actions.toggleFavoriteWithOutcome.mockReturnValueOnce(completion.promise);
    const pending = adapter.favorite(demoVaultItems[0]);
    store.setItems([{ ...demoVaultItems[0], name: "Synced replacement" }]);
    completion.resolve({
      committed: false,
      reason: "stale",
      status: "Vault changed; action not applied.",
    });

    await pending;

    expect(store.snapshot().statusMessage).not.toBe("Vault changed; action not applied.");
  });

  it("commits active favorite success from the exact service replacement", async () => {
    const { adapter, store } = setupServiceAdapter();
    const item = { ...demoVaultItems[0], favorite: false };
    store.setItems([item]);

    await adapter.favorite(item);

    expect(store.snapshot().items[0]).not.toBe(item);
    expect(store.snapshot().statusMessage).toBe("Added to favorites");
  });

  it.each([
    ["archive", "archiveItemWithOutcome", "Unable to archive item."],
    ["delete", "deleteItemWithOutcome", "Unable to delete item."],
  ] as const)("suppresses a failed %s status when external sync removes the item", async (method, actionName, failureStatus) => {
    const completion = deferred<VaultRemovalMutationOutcome>();
    const { actions, adapter, store } = setup();
    actions[actionName].mockReturnValueOnce(completion.promise);

    const pending = adapter[method](demoVaultItems[0]);
    store.setItems([]);
    completion.resolve({ committed: false, reason: "failure", status: failureStatus });
    await pending;

    expect(store.snapshot().statusMessage).not.toBe(failureStatus);
  });

  it.each([
    ["archive", "archiveItemWithOutcome", "Archived item"],
    ["delete", "deleteItemWithOutcome", "Moved item to trash"],
  ] as const)("commits the successful %s status only after its own removal outcome", async (method, actionName, successStatus) => {
    const { actions, adapter, store } = setup();
    actions[actionName].mockImplementationOnce(async () => {
      store.setItems([]);
      return {
        committed: true,
        status: successStatus,
        result: { kind: "removed", item: demoVaultItems[0] },
      } satisfies VaultRemovalMutationOutcome;
    });

    await adapter[method](demoVaultItems[0]);

    expect(store.snapshot().statusMessage).toBe(successStatus);
  });

  it.each([
    ["favorite", "toggleFavoriteWithOutcome"],
    ["archive", "archiveItemWithOutcome"],
    ["delete", "deleteItemWithOutcome"],
  ] as const)("passes the captured currentness guard through %s", async (method, actionName) => {
    const { actions, adapter } = setup();

    await adapter[method](demoVaultItems[0]);

    expect(actions[actionName]).toHaveBeenCalledWith(demoVaultItems[0], expect.any(Function));
    const guard = actions[actionName].mock.calls[0]![1] as () => boolean;
    expect(guard()).toBe(true);
    adapter.ngOnDestroy();
    expect(guard()).toBe(false);
  });

  it.each(["route navigation", "route destruction"] as const)(
    "does not let pending favorite mutate newer state after %s",
    async (staleKind) => {
      const store = new PopupStateStore();
      const item = { ...demoVaultItems[0], favorite: false };
      const completion = deferred<void>();
      const cipherActions: VaultCipherActionPort = {
        updateCipherPartial: vi.fn(async () => completion.promise),
        softDeleteCipher: vi.fn(async () => undefined),
        archiveCipher: vi.fn(async () => undefined),
        unarchiveCipher: vi.fn(async () => undefined),
        restoreCipher: vi.fn(async () => undefined),
        deleteCipher: vi.fn(async () => undefined),
      };
      store.setUnlocked("account-a@example.test");
      store.setActiveSession(fakeSession("account-a"));
      store.setItems([item]);
      const router = {
        url: "/tabs/vault",
        navigateByUrl: vi.fn(async () => true),
        navigate: vi.fn(async () => true),
      };
      const actions = new VaultActionsService(
        null,
        new SettingsService(),
        store,
        cipherActions,
      );
      const adapter = new VaultRowActionsAdapter(
        store,
        router as never,
        actions,
        { syncNow: vi.fn(async () => undefined) } as unknown as VaultSessionService,
      );

      const pending = adapter.favorite(item);
      await vi.waitFor(() => expect(cipherActions.updateCipherPartial).toHaveBeenCalledOnce());
      router.url = "/tabs/settings";
      if (staleKind === "route destruction") {
        adapter.ngOnDestroy();
      }
      store.setStatus("Newer route status");
      completion.resolve();
      await pending;

      expect(store.snapshot().items).toEqual([item]);
      expect(store.snapshot().statusMessage).toBe("Newer route status");
    },
  );

  it.each([
    ["archive", "archiveItemWithOutcome", "Archived item"],
    ["delete", "deleteItemWithOutcome", "Moved item to trash"],
  ] as const)("suppresses a successful %s status after a same-ID replacement", async (method, actionName, successStatus) => {
    const completion = deferred<VaultRemovalMutationOutcome>();
    const { actions, adapter, store } = setup();
    actions[actionName].mockReturnValueOnce(completion.promise);

    const pending = adapter[method](demoVaultItems[0]);
    store.setItems([{ ...demoVaultItems[0], name: "Synced replacement" }]);
    completion.resolve({
      committed: true,
      status: successStatus,
      result: { kind: "removed", item: demoVaultItems[0] },
    });
    await pending;

    expect(store.snapshot().statusMessage).not.toBe(successStatus);
  });

  it("permanently rejects actions started after destruction", async () => {
    const { actions, adapter, router, session } = setup();
    const field = demoVaultItems[0].fields[0]!;
    adapter.ngOnDestroy();

    await adapter.view(demoVaultItems[0]);
    await adapter.edit(demoVaultItems[0]);
    await adapter.clone(demoVaultItems[0]);
    await adapter.copy(demoVaultItems[0], field);
    await adapter.fill(demoVaultItems[0], field);
    await adapter.launch(demoVaultItems[0]);
    await adapter.favorite(demoVaultItems[0]);
    await adapter.archive(demoVaultItems[0]);
    await adapter.delete(demoVaultItems[0]);
    await adapter.retrySync();

    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
    expect(actions.copyField).not.toHaveBeenCalled();
    expect(actions.fillField).not.toHaveBeenCalled();
    expect(actions.launchItem).not.toHaveBeenCalled();
    expect(actions.toggleFavoriteWithOutcome).not.toHaveBeenCalled();
    expect(actions.archiveItemWithOutcome).not.toHaveBeenCalled();
    expect(actions.deleteItemWithOutcome).not.toHaveBeenCalled();
    expect(session.syncNow).not.toHaveBeenCalled();
  });

  it("passes a lifecycle-aware current callback to manual sync Retry", async () => {
    const { adapter, session } = setup();

    await adapter.retrySync();

    expect(session.syncNow).toHaveBeenCalledOnce();
    const isCurrent = session.syncNow.mock.calls[0]![0];
    expect(isCurrent()).toBe(true);
    adapter.ngOnDestroy();
    expect(isCurrent()).toBe(false);
  });

  it.each(["locked", "account", "route", "item", "destroyed"] as const)(
    "invalidates a captured protected-action guard after the %s context changes",
    (staleKind) => {
      const harness = setup();
      const guard = harness.adapter.captureGuard(demoVaultItems[0]);

      if (staleKind === "locked") {
        harness.store.setLocked();
      } else if (staleKind === "account") {
        harness.store.setActiveSession(fakeSession("account-b"));
      } else if (staleKind === "route") {
        harness.router.url = "/tabs/settings";
      } else if (staleKind === "item") {
        harness.store.setItems([{ ...demoVaultItems[0], name: "Synced replacement" }]);
      } else {
        harness.adapter.ngOnDestroy();
      }

      expect(guard()).toBe(false);
    },
  );

  it("suppresses favorite success when a microtask replaces the committed object", async () => {
    const { actions, adapter, store } = setupServiceAdapter();
    const item = { ...demoVaultItems[0], favorite: false };
    store.setItems([item]);
    const commitFavorite = actions.toggleFavoriteWithOutcome.bind(actions);
    vi.spyOn(actions, "toggleFavoriteWithOutcome").mockImplementationOnce(async (candidate) => {
      const outcome = await commitFavorite(candidate);
      queueMicrotask(() => {
        if (outcome.committed) {
          store.setItems([{ ...outcome.result.item, name: "External same-ID replacement" }]);
        }
      });
      return outcome;
    });

    await adapter.favorite(item);

    expect(store.snapshot().items[0]?.name).toBe("External same-ID replacement");
    expect(store.snapshot().statusMessage).not.toBe("Added to favorites");
  });
});

function setup(feedback?: AppFeedbackService) {
  const store = new PopupStateStore();
  store.setUnlocked("account-a@example.test");
  store.setActiveSession(fakeSession("account-a"));
  store.setItems(demoVaultItems);
  const router = {
    url: "/tabs/vault",
    navigateByUrl: vi.fn(async () => true),
    navigate: vi.fn(async () => true),
  };
  const actions = {
    copyField: vi.fn(async (field: VaultField) => `Copied ${field.label}`),
    fillField: vi.fn(async (field: VaultField) => `Filled ${field.label}`),
    launchItem: vi.fn(async (_item: VaultItem) => "Opened URL"),
    toggleFavoriteWithOutcome: vi.fn(async (_item: VaultItem): Promise<VaultFavoriteMutationOutcome> => ({
      committed: false,
      reason: "failure",
      status: "Unable to update favorite.",
    })),
    archiveItemWithOutcome: vi.fn(async (_item: VaultItem): Promise<VaultRemovalMutationOutcome> => ({
      committed: false,
      reason: "failure",
      status: "Unable to archive item.",
    })),
    deleteItemWithOutcome: vi.fn(async (_item: VaultItem): Promise<VaultRemovalMutationOutcome> => ({
      committed: false,
      reason: "failure",
      status: "Unable to delete item.",
    })),
  };
  const session = { syncNow: vi.fn(async (_isCurrent: () => boolean) => undefined) };
  const adapter = new VaultRowActionsAdapter(
    store,
    router as never,
    actions as unknown as VaultActionsService,
    session as unknown as VaultSessionService,
    feedback,
  );
  return { actions, adapter, router, session, store };
}

function setupServiceAdapter() {
  const store = new PopupStateStore();
  store.setUnlocked("account-a@example.test");
  store.setActiveSession(fakeSession("account-a"));
  store.setItems(demoVaultItems);
  const router = {
    url: "/tabs/vault",
    navigateByUrl: vi.fn(async () => true),
    navigate: vi.fn(async () => true),
  };
  const cipherActions: VaultCipherActionPort = {
    updateCipherPartial: vi.fn(async () => undefined),
    softDeleteCipher: vi.fn(async () => undefined),
    archiveCipher: vi.fn(async () => undefined),
    unarchiveCipher: vi.fn(async () => undefined),
    restoreCipher: vi.fn(async () => undefined),
    deleteCipher: vi.fn(async () => undefined),
  };
  const actions = new VaultActionsService(null, new SettingsService(), store, cipherActions);
  const session = { syncNow: vi.fn(async (_isCurrent: () => boolean) => undefined) };
  const adapter = new VaultRowActionsAdapter(
    store,
    router as never,
    actions,
    session as unknown as VaultSessionService,
  );
  return { actions, adapter, router, session, store };
}

function fakeSession(accessToken: string): AuthSession {
  return {
    environment: {
      apiUrl: "https://api.example.test",
      identityUrl: "https://identity.example.test",
      iconsUrl: null,
      webVaultUrl: "https://vault.example.test",
      sendUrl: "https://send.example.test",
    },
    token: {
      accessToken,
      refreshToken: `${accessToken}-refresh`,
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
