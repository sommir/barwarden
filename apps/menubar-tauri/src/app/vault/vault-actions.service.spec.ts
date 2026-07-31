import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import { buildSelfHostedEnvironmentFromServerUrl } from "../../bitwarden-api/bitwarden-api";
import { PasteError, type HostApi } from "../../host/host-api";
import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";
import { demoVaultItems } from "../vault-demo";
import { VaultActionsService, type VaultCipherActionPort } from "./vault-actions.service";
import { ACCESSIBILITY_PERMISSION_STATUS } from "../official-ui/accessibility-permission-dialog.service";
import { OfficialI18nService } from "../official-ui/official-i18n.service";

class RecordingHost implements HostApi {
  calls: Array<{ type: "copy" | "paste" | "open"; value: string; clearAfterSeconds?: number }> = [];
  failOpen = false;
  failPaste = false;
  failCopy = false;
  pasteFailure: unknown = null;

  showPopup = async () => undefined;
  hidePopup = async () => undefined;
  secureGet = async () => null;
  secureSet = async () => undefined;
  secureDelete = async () => undefined;

  copyText = async (value: string, clearAfterSeconds?: number) => {
    this.calls.push({ type: "copy", value, clearAfterSeconds });
    if (this.failCopy) {
      throw new Error("private clipboard failure");
    }
  };

  pasteText = async (value: string, clearAfterSeconds?: number) => {
    this.calls.push({ type: "paste", value, clearAfterSeconds });
    if (this.pasteFailure) {
      throw this.pasteFailure;
    }
    if (this.failPaste) {
      throw new Error("paste failed");
    }
  };

  openUrl = async (url: string) => {
    this.calls.push({ type: "open", value: url });
    if (this.failOpen) {
      throw new Error("invalid URL");
    }
  };
}

beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  await new OfficialI18nService().setLocale("en-US");
});

describe("VaultActionsService", () => {
  it("copies and fills concrete fields through the host", async () => {
    const host = new RecordingHost();
    const service = new VaultActionsService(host, new SettingsService());

    await service.copyField({ id: "username", label: "Username", value: "u" });
    await service.fillField({ id: "password", label: "Password", value: "p" });

    expect(host.calls).toEqual([
      { type: "copy", value: "u", clearAfterSeconds: 30 },
      { type: "paste", value: "p", clearAfterSeconds: 30 },
    ]);
  });

  it("copies without invoking paste in clipboard-copy mode", async () => {
    const host = new RecordingHost();
    const settings = new SettingsService();
    settings.setFillMode("clipboard-copy");
    const service = new VaultActionsService(host, settings);

    await expect(
      service.fillField({ id: "username", label: "Username", value: "synthetic@example.test" }),
    ).resolves.toBe("Copied Username");

    expect(host.calls).toEqual([
      { type: "copy", value: "synthetic@example.test", clearAfterSeconds: 30 },
    ]);
  });

  it("localizes copy status with the active official locale", async () => {
    await new OfficialI18nService().setLocale("zh-CN");
    const service = new VaultActionsService(new RecordingHost(), new SettingsService());

    await expect(service.copyField({ id: "username", label: "用户名", value: "u" }))
      .resolves.toBe("已复制用户名");
  });

  it("passes exactly one selected field value to paste", async () => {
    const host = new RecordingHost();
    const service = new VaultActionsService(host, new SettingsService());

    await expect(
      service.fillField({ id: "password", label: "Password", value: "selected-password" }),
    ).resolves.toBe("Filled Password");

    expect(host.calls).toEqual([
      { type: "paste", value: "selected-password", clearAfterSeconds: 30 },
    ]);
  });

  it("does not repeat copy for any known native paste failure", async () => {
    for (const code of [
      "no-target",
      "target-not-active",
      "activation-failed",
      "keystroke-failed",
    ] as const) {
      const host = new RecordingHost();
      host.pasteFailure = new PasteError(code, true);
      const service = new VaultActionsService(host, new SettingsService());

      await expect(
        service.fillField({ id: "password", label: "Private Label", value: "selected-only" }),
      ).resolves.toBe("Paste unavailable; value copied.");
      expect(host.calls).toEqual([
        { type: "paste", value: "selected-only", clearAfterSeconds: 30 },
      ]);
    }
  });

  it("returns actionable Accessibility status after the native command copied the value", async () => {
    const host = new RecordingHost();
    host.pasteFailure = new PasteError("accessibility-denied", true);
    const service = new VaultActionsService(host, new SettingsService());

    await expect(
      service.fillField({ id: "password", label: "Private Label", value: "selected-only" }),
    ).resolves.toBe(ACCESSIBILITY_PERMISSION_STATUS);
    expect(host.calls).toEqual([
      { type: "paste", value: "selected-only", clearAfterSeconds: 30 },
    ]);
  });

  it("copies once on an unknown paste rejection and never exposes its detail", async () => {
    const host = new RecordingHost();
    host.pasteFailure = new Error("private paste transport detail");
    const service = new VaultActionsService(host, new SettingsService());

    await expect(
      service.fillField({ id: "password", label: "Private Label", value: "selected-only" }),
    ).resolves.toBe("Paste unavailable; value copied.");
    expect(host.calls).toEqual([
      { type: "paste", value: "selected-only", clearAfterSeconds: 30 },
      { type: "copy", value: "selected-only", clearAfterSeconds: 30 },
    ]);
  });

  it("returns fixed statuses for clipboard failures without exposing host errors", async () => {
    const copyHost = new RecordingHost();
    copyHost.failCopy = true;
    const fillHost = new RecordingHost();
    fillHost.failPaste = true;
    fillHost.failCopy = true;

    await expect(
      new VaultActionsService(copyHost, new SettingsService()).copyField({ id: "username", label: "Username", value: "u" }),
    ).resolves.toBe("Unable to copy field.");
    await expect(
      new VaultActionsService(fillHost, new SettingsService()).fillField({ id: "password", label: "Password", value: "p" }),
    ).resolves.toBe("Unable to fill field.");
  });

  it("uses the configured clipboard timeout for copy and fill", async () => {
    const host = new RecordingHost();
    const settings = new SettingsService();
    settings.setClipboardClearSeconds(60);
    const service = new VaultActionsService(host, settings);

    await service.copyField({ id: "username", label: "Username", value: "u" });
    await service.fillField({ id: "password", label: "Password", value: "p" });

    expect(host.calls.map((call) => call.clearAfterSeconds)).toEqual([60, 60]);
  });

  it("copies and fills the current TOTP code without exposing the synced seed", async () => {
    const host = new RecordingHost();
    const settings = new SettingsService();
    settings.setClipboardClearSeconds(30);
    const service = new VaultActionsService(host, settings);
    const seed = "otpauth://totp/Example:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8";
    const field = { id: "otp", label: "OTP", value: seed, type: "totp" as const };

    await expect(service.copyField(field, 59)).resolves.toBe("Copied OTP");
    await expect(service.fillField(field, 59)).resolves.toBe("Filled OTP");

    expect(host.calls).toEqual([
      { type: "copy", value: "94287082", clearAfterSeconds: 30 },
      { type: "paste", value: "94287082", clearAfterSeconds: 30 },
    ]);
    expect(host.calls.some((call) => call.value === seed)).toBe(false);
  });

  it("fails closed when a TOTP seed cannot generate a current code", async () => {
    const host = new RecordingHost();
    const service = new VaultActionsService(host, new SettingsService());
    const field = { id: "otp", label: "OTP", value: "not-a-valid*seed", type: "totp" as const };

    await expect(service.copyField(field, 59)).resolves.toBe("Unable to generate OTP");
    await expect(service.fillField(field, 59)).resolves.toBe("Unable to generate OTP");
    expect(host.calls).toEqual([]);
  });

  it("falls back to copying only the generated TOTP code when paste fails", async () => {
    const host = new RecordingHost();
    host.failPaste = true;
    const settings = new SettingsService();
    settings.setClipboardClearSeconds(30);
    const service = new VaultActionsService(host, settings);
    const seed = "otpauth://totp/Example:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8";

    await expect(
      service.fillField({ id: "otp", label: "OTP", value: seed, type: "totp" }, 59),
    ).resolves.toBe("Paste unavailable; value copied.");

    expect(host.calls).toEqual([
      { type: "paste", value: "94287082", clearAfterSeconds: 30 },
      { type: "copy", value: "94287082", clearAfterSeconds: 30 },
    ]);
    expect(host.calls.some((call) => call.value === seed)).toBe(false);
  });

  it("floors fractional TOTP epochs before generating the current code", async () => {
    const host = new RecordingHost();
    const settings = new SettingsService();
    settings.setClipboardClearSeconds(30);
    const service = new VaultActionsService(host, settings);
    const seed = "otpauth://totp/Example:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8";

    await expect(
      service.copyField({ id: "otp", label: "OTP", value: seed, type: "totp" }, 59.9),
    ).resolves.toBe("Copied OTP");
    expect(host.calls[0]?.value).toBe("94287082");
  });

  it.each([Number.NaN, -1, Number.POSITIVE_INFINITY])(
    "fails closed for invalid TOTP epoch %s",
    async (epochSeconds) => {
      const host = new RecordingHost();
      const service = new VaultActionsService(host, new SettingsService());

      await expect(
        service.copyField(
          { id: "otp", label: "OTP", value: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", type: "totp" },
          epochSeconds,
        ),
      ).resolves.toBe("Unable to generate OTP");
      expect(host.calls).toEqual([]);
    },
  );

  it("opens item URIs through the host", async () => {
    const host = new RecordingHost();
    const service = new VaultActionsService(host, new SettingsService());

    await expect(service.launchItem(demoVaultItems[0])).resolves.toBe("Opened URL");
    expect(host.calls).toEqual([{ type: "open", value: "https://github.com" }]);
  });

  it("allows an HTTP cipher URI while environment handoffs remain HTTPS-only", async () => {
    const host = new RecordingHost();
    const service = new VaultActionsService(host, new SettingsService());

    await expect(service.launchUri("http://cipher.example.test/path")).resolves.toBe("Opened URL");
    expect(host.calls).toEqual([{ type: "open", value: "http://cipher.example.test/path" }]);
  });

  it("reports empty URI separately from deferred URI launch", async () => {
    const host = new RecordingHost();
    const service = new VaultActionsService(host, new SettingsService());

    await expect(service.launchUri("")).resolves.toBe("No URI");
    expect(host.calls).toEqual([]);
  });

  it.each(["javascript:alert(1)", "file:///private/data", "ftp://example.test/private", "not a uri"])(
    "rejects malformed and non-HTTP URI %s before the host boundary",
    async (uri) => {
      const host = new RecordingHost();
      const service = new VaultActionsService(host, new SettingsService());

      await expect(service.launchUri(uri)).resolves.toBe("Unable to open URL.");
      expect(host.calls).toEqual([]);
    },
  );

  it("reports native URL launch failures as status text", async () => {
    const host = new RecordingHost();
    host.failOpen = true;
    const service = new VaultActionsService(host, new SettingsService());

    await expect(service.launchUri("https://example.test")).resolves.toBe("Unable to open URL.");
    expect(host.calls).toEqual([{ type: "open", value: "https://example.test" }]);
  });

  it.each(["copy", "fill", "launch"] as const)(
    "checks the current-context guard before the %s host boundary",
    async (kind) => {
      const host = new RecordingHost();
      const service = new VaultActionsService(host, new SettingsService());
      const guard = vi.fn(() => false);

      const outcome = kind === "copy"
        ? await service.copyFieldWithOutcome(
            { id: "username", label: "Username", value: "user@example.test" },
            guard,
          )
        : kind === "fill"
          ? await service.fillFieldWithOutcome(
              { id: "password", label: "Password", value: "secret" },
              guard,
            )
          : await service.launchUriWithOutcome("https://example.test", guard);

      expect(outcome).toMatchObject({ committed: false, reason: "stale" });
      expect(host.calls).toEqual([]);
    },
  );

  it.each(["copy", "fill"] as const)(
    "revalidates after deferred TOTP resolution before %s reaches the host",
    async (kind) => {
      const host = new RecordingHost();
      const generation = deferred<{
        code: string;
        formattedCode: string;
        period: number;
        secondsRemaining: number;
        isExpiring: boolean;
      }>();
      let current = true;
      const service = new VaultActionsService(
        host,
        new SettingsService(),
        new PopupStateStore(),
        null,
        () => generation.promise,
      );
      const field = { id: "otp", label: "OTP", value: "TOTP-SEED", type: "totp" as const };

      const pending = kind === "copy"
        ? service.copyFieldWithOutcome(field, () => current, 59)
        : service.fillFieldWithOutcome(field, () => current, 59);
      current = false;
      generation.resolve({
        code: "123456",
        formattedCode: "123 456",
        period: 30,
        secondsRemaining: 1,
        isExpiring: true,
      });

      await expect(pending).resolves.toMatchObject({ committed: false, reason: "stale" });
      expect(host.calls).toEqual([]);
    },
  );

  it("revalidates a rejected paste before attempting fallback copy", async () => {
    const host = new RecordingHost();
    const pasteCompletion = deferred<void>();
    host.pasteText = async (value: string, clearAfterSeconds?: number) => {
      host.calls.push({ type: "paste", value, clearAfterSeconds });
      await pasteCompletion.promise;
    };
    let current = true;
    const service = new VaultActionsService(host, new SettingsService());

    const pending = service.fillFieldWithOutcome(
      { id: "password", label: "Password", value: "secret" },
      () => current,
    );
    await vi.waitFor(() => expect(host.calls).toHaveLength(1));
    current = false;
    pasteCompletion.reject(new Error("private paste failure"));

    await expect(pending).resolves.toMatchObject({ committed: false, reason: "stale" });
    expect(host.calls).toEqual([
      { type: "paste", value: "secret", clearAfterSeconds: 30 },
    ]);
  });

  it("rejects a favorite mutation without an active server session", async () => {
    const store = new PopupStateStore();
    store.setItems([demoVaultItems[0]]);
    const service = new VaultActionsService(new RecordingHost(), new SettingsService(), store);

    await expect(service.toggleFavoriteWithOutcome(demoVaultItems[0])).resolves.toMatchObject({
      committed: false,
      reason: "failure",
      status: "Vault session is unavailable.",
    });

    expect(store.snapshot().items[0]).toBe(demoVaultItems[0]);
  });

  it("updates active session favorite through Bitwarden before toggling local state", async () => {
    const store = new PopupStateStore();
    const session = fakeAuthSession();
    const item = { ...demoVaultItems[0], folderId: "folder-id", favorite: false };
    store.setActiveSession(session);
    store.setItems([item]);
    const cipherActions = new RecordingCipherActions();
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    await expect(service.toggleFavorite(item)).resolves.toBe("Added to favorites");

    expect(cipherActions.calls).toEqual([
      {
        type: "partial",
        session,
        itemId: item.id,
        favorite: true,
        folderId: "folder-id",
      },
    ]);
    expect(store.snapshot().items[0]?.favorite).toBe(true);
  });

  it("returns the exact committed favorite replacement object", async () => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], favorite: false };
    store.setActiveSession(fakeAuthSession());
    store.setItems([item]);
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      new RecordingCipherActions(),
    );

    const outcome = await service.toggleFavoriteWithOutcome(item);

    expect(outcome.committed).toBe(true);
    if (!outcome.committed) {
      return;
    }
    expect(outcome.result.kind).toBe("replacement");
    expect(outcome.result.item).toBe(store.snapshot().items[0]);
    expect(outcome.result.item).not.toBe(item);
  });

  it("preserves favorite state when server partial update fails", async () => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], favorite: false };
    store.setActiveSession(fakeAuthSession());
    store.setItems([item]);
    const cipherActions = new RecordingCipherActions();
    cipherActions.failWith = new Error("server rejected favorite");
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    await expect(service.toggleFavorite(item)).resolves.toBe("Unable to update favorite.");

    expect(store.snapshot().items[0]?.favorite).toBe(false);
  });

  it("does not apply an older account action to a newer active Vault", async () => {
    const store = new PopupStateStore();
    const accountA = fakeAuthSession();
    const accountB = fakeAuthSession();
    const itemA = { ...demoVaultItems[0], favorite: false };
    const itemB = { ...demoVaultItems[0], favorite: true, name: "New account item" };
    const update = deferred<void>();
    const cipherActions: VaultCipherActionPort = {
      updateCipherPartial: async () => update.promise,
      softDeleteCipher: async () => undefined,
      archiveCipher: async () => undefined,
      unarchiveCipher: async () => undefined,
      restoreCipher: async () => undefined,
      deleteCipher: async () => undefined,
    };
    store.setActiveSession(accountA);
    store.setItems([itemA]);
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    const pending = service.toggleFavorite(itemA);
    store.setActiveSession(accountB);
    store.setItems([itemB]);
    update.resolve();

    await expect(pending).resolves.toBe("Vault changed; action not applied.");
    expect(store.snapshot().items).toEqual([itemB]);
  });

  it("suppresses a duplicate favorite request while the same item mutation is in flight", async () => {
    const store = new PopupStateStore();
    const activeSession = fakeAuthSession();
    const item = { ...demoVaultItems[0], favorite: false };
    const update = deferred<void>();
    const cipherActions = new RecordingCipherActions();
    cipherActions.partialCompletion = update.promise;
    store.setActiveSession(activeSession);
    store.setItems([item]);
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    const first = service.toggleFavorite(item);
    const second = service.toggleFavorite(item);
    await Promise.resolve();

    expect(cipherActions.calls.filter((call) => call.type === "partial")).toHaveLength(1);
    await expect(second).resolves.toBe("Favorite update already in progress.");
    update.resolve();
    await expect(first).resolves.toBe("Added to favorites");
    expect(store.snapshot().items[0]?.favorite).toBe(true);
  });

  it("does not overwrite a same-account item projection replaced by sync", async () => {
    const store = new PopupStateStore();
    const activeSession = fakeAuthSession();
    const item = { ...demoVaultItems[0], favorite: false };
    const syncedReplacement = { ...item, name: "Synced replacement", favorite: false };
    const update = deferred<void>();
    const cipherActions = new RecordingCipherActions();
    cipherActions.partialCompletion = update.promise;
    store.setActiveSession(activeSession);
    store.setItems([item]);
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    const pending = service.toggleFavorite(item);
    store.setItems([syncedReplacement]);
    update.resolve();

    await expect(pending).resolves.toBe("Vault changed; action not applied.");
    expect(store.snapshot().items).toEqual([syncedReplacement]);
  });

  it("checks the captured favorite currentness guard before transport", async () => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], favorite: false };
    const cipherActions = new RecordingCipherActions();
    store.setActiveSession(fakeAuthSession());
    store.setItems([item]);
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    const outcome = await (service.toggleFavoriteWithOutcome as unknown as (
      candidate: VaultItem,
      isCurrent: () => boolean,
    ) => ReturnType<VaultActionsService["toggleFavoriteWithOutcome"]>)(item, () => false);

    expect(outcome).toMatchObject({ committed: false, reason: "stale" });
    expect(cipherActions.calls).toEqual([]);
    expect(store.snapshot().items).toEqual([item]);
  });

  it("checks the captured favorite currentness guard after pending transport", async () => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], favorite: false };
    const completion = deferred<void>();
    const cipherActions = new RecordingCipherActions();
    cipherActions.partialCompletion = completion.promise;
    store.setActiveSession(fakeAuthSession());
    store.setItems([item]);
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );
    let current = true;

    const pending = (service.toggleFavoriteWithOutcome as unknown as (
      candidate: VaultItem,
      isCurrent: () => boolean,
    ) => ReturnType<VaultActionsService["toggleFavoriteWithOutcome"]>)(item, () => current);
    await vi.waitFor(() => expect(cipherActions.calls).toHaveLength(1));
    current = false;
    store.setStatus("Newer route status");
    completion.resolve();

    await expect(pending).resolves.toMatchObject({ committed: false, reason: "stale" });
    expect(store.snapshot().items).toEqual([item]);
    expect(store.snapshot().statusMessage).toBe("Newer route status");
  });

  it("moves items to Archive and Trash state lists", async () => {
    const store = new PopupStateStore();
    store.setItems([demoVaultItems[0], demoVaultItems[1]]);
    store.setActiveSession(fakeAuthSession());
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      new RecordingCipherActions(),
    );

    await expect(service.archiveItem(demoVaultItems[0])).resolves.toBe("Archived item");
    await expect(service.deleteItem(demoVaultItems[1])).resolves.toBe("Moved item to trash");

    expect(store.snapshot().items.map((item) => item.id)).toEqual([]);
    expect(store.snapshot().archivedItems.map((item) => item.id)).toEqual(["github"]);
    expect(store.snapshot().deletedItems.map((item) => item.id)).toEqual(["card"]);
  });

  it("restores an item archived then moved to Trash back to Archive", async () => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], id: "archive-trash-restore" };
    store.setItems([item]);
    store.setActiveSession(fakeAuthSession());
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      new RecordingCipherActions(),
    );

    await service.archiveItemWithOutcome(item);
    await service.deleteArchivedItemWithOutcome(store.snapshot().archivedItems[0]!);
    await service.restoreDeletedItemWithOutcome(store.snapshot().deletedItems[0]!);

    expect(store.snapshot().items).toEqual([]);
    expect(store.snapshot().archivedItems.map((candidate) => candidate.id))
      .toEqual(["archive-trash-restore"]);
  });

  it("restores an unarchived item later moved to Trash back to the active Vault", async () => {
    const store = new PopupStateStore();
    const item = {
      ...demoVaultItems[0],
      id: "unarchive-trash-restore",
      archivedDate: "2026-07-01T00:00:00.000Z",
    };
    store.setArchivedItems([item]);
    store.setActiveSession(fakeAuthSession());
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      new RecordingCipherActions(),
    );

    await service.unarchiveItemWithOutcome(item);
    await service.deleteItemWithOutcome(store.snapshot().items[0]!);
    await service.restoreDeletedItemWithOutcome(store.snapshot().deletedItems[0]!);

    expect(store.snapshot().archivedItems).toEqual([]);
    expect(store.snapshot().items.map((candidate) => candidate.id))
      .toEqual(["unarchive-trash-restore"]);
  });

  it.each([
    ["archiveItemWithOutcome", "archivedItems"],
    ["deleteItemWithOutcome", "deletedItems"],
  ] as const)("returns an explicit removal result from %s", async (method, destination) => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0] };
    store.setItems([item]);
    store.setActiveSession(fakeAuthSession());
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      new RecordingCipherActions(),
    );

    const outcome = await service[method](item);

    expect(outcome.committed).toBe(true);
    if (!outcome.committed) {
      return;
    }
    expect(outcome.result).toEqual({ kind: "removed", item });
    expect(store.snapshot().items).toEqual([]);
    expect(store.snapshot()[destination]).toEqual([item]);
  });

  it.each([
    ["unarchiveItemWithOutcome", "archived", "Item unarchived"],
    ["deleteArchivedItemWithOutcome", "archived", "Moved item to trash"],
    ["restoreDeletedItemWithOutcome", "deleted", "Item restored"],
    ["permanentlyDeleteItemWithOutcome", "deleted", "Item permanently deleted"],
  ] as const)("returns an exact typed removal outcome from %s", async (method, location, status) => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], id: `typed-${method}` };
    if (location === "archived") {
      store.setArchivedItems([item]);
    } else {
      store.setDeletedItems([item]);
    }
    store.setActiveSession(fakeAuthSession());
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      new RecordingCipherActions(),
    );

    await expect(service[method](item)).resolves.toEqual({
      committed: true,
      status,
      result: { kind: "removed", item },
    });
  });

  it("types duplicate, failure, and stale favorite outcomes as noncommitted", async () => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], favorite: false };
    const completion = deferred<void>();
    const cipherActions = new RecordingCipherActions();
    cipherActions.partialCompletion = completion.promise;
    store.setActiveSession(fakeAuthSession());
    store.setItems([item]);
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    const pending = service.toggleFavoriteWithOutcome(item);
    await Promise.resolve();
    await expect(service.toggleFavoriteWithOutcome(item)).resolves.toMatchObject({
      committed: false,
      reason: "duplicate",
    });
    store.setItems([{ ...item, name: "Synced replacement" }]);
    completion.resolve();
    await expect(pending).resolves.toMatchObject({ committed: false, reason: "stale" });

    const failedStore = new PopupStateStore();
    const failedItem = { ...item, id: "favorite-failure" };
    const failingActions = new RecordingCipherActions();
    failingActions.failWith = new Error("server rejected favorite");
    failedStore.setActiveSession(fakeAuthSession());
    failedStore.setItems([failedItem]);
    const failedService = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      failedStore,
      failingActions,
    );
    await expect(failedService.toggleFavoriteWithOutcome(failedItem)).resolves.toMatchObject({
      committed: false,
      reason: "failure",
    });
  });

  it("soft deletes active session items through Bitwarden before moving them to Trash", async () => {
    const store = new PopupStateStore();
    const session = fakeAuthSession();
    store.setActiveSession(session);
    store.setItems([demoVaultItems[0]]);
    const cipherActions = new RecordingCipherActions();
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    await expect(service.deleteItem(demoVaultItems[0])).resolves.toBe("Moved item to trash");

    expect(cipherActions.calls).toEqual([
      { type: "softDelete", session, itemId: demoVaultItems[0].id },
    ]);
    expect(store.snapshot().items.map((item) => item.id)).toEqual([]);
    expect(store.snapshot().deletedItems.map((item) => item.id)).toEqual([demoVaultItems[0].id]);
  });

  it("preserves local state when server soft delete fails", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(fakeAuthSession());
    store.setItems([demoVaultItems[0]]);
    const cipherActions = new RecordingCipherActions();
    cipherActions.failWith = new Error("server rejected delete");
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    await expect(service.deleteItem(demoVaultItems[0])).resolves.toBe("Unable to delete item.");

    expect(store.snapshot().items.map((item) => item.id)).toEqual([demoVaultItems[0].id]);
    expect(store.snapshot().deletedItems).toEqual([]);
  });

  it("archives active session items through Bitwarden before moving them to Archive", async () => {
    const store = new PopupStateStore();
    const session = fakeAuthSession();
    store.setActiveSession(session);
    store.setItems([demoVaultItems[0]]);
    const cipherActions = new RecordingCipherActions();
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    await expect(service.archiveItem(demoVaultItems[0])).resolves.toBe("Archived item");

    expect(cipherActions.calls).toEqual([
      { type: "archive", session, itemId: demoVaultItems[0].id },
    ]);
    expect(store.snapshot().items.map((item) => item.id)).toEqual([]);
    expect(store.snapshot().archivedItems.map((item) => item.id)).toEqual([demoVaultItems[0].id]);
  });

  it("unarchives active session items through Bitwarden before restoring them locally", async () => {
    const store = new PopupStateStore();
    const session = fakeAuthSession();
    const archivedItem = { ...demoVaultItems[0], id: "archived-1" };
    store.setActiveSession(session);
    store.setArchivedItems([archivedItem]);
    const cipherActions = new RecordingCipherActions();
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    await expect(service.unarchiveItem(archivedItem)).resolves.toBe("Item unarchived");

    expect(cipherActions.calls).toEqual([
      { type: "unarchive", session, itemId: archivedItem.id },
    ]);
    expect(store.snapshot().archivedItems).toEqual([]);
    expect(store.snapshot().items.map((item) => item.id)).toEqual([archivedItem.id]);
  });

  it("moves archived active session items to Trash through Bitwarden soft delete", async () => {
    const store = new PopupStateStore();
    const session = fakeAuthSession();
    const archivedItem = { ...demoVaultItems[0], id: "archived-1" };
    store.setActiveSession(session);
    store.setArchivedItems([archivedItem]);
    const cipherActions = new RecordingCipherActions();
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    await expect(service.deleteArchivedItem(archivedItem)).resolves.toBe("Moved item to trash");

    expect(cipherActions.calls).toEqual([
      { type: "softDelete", session, itemId: archivedItem.id },
    ]);
    expect(store.snapshot().archivedItems).toEqual([]);
    expect(store.snapshot().deletedItems.map((item) => item.id)).toEqual([archivedItem.id]);
  });

  it("restores active session Trash items through Bitwarden before restoring them locally", async () => {
    const store = new PopupStateStore();
    const session = fakeAuthSession();
    const deletedItem = { ...demoVaultItems[0], id: "deleted-1" };
    store.setActiveSession(session);
    store.setDeletedItems([deletedItem]);
    const cipherActions = new RecordingCipherActions();
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    await expect(service.restoreDeletedItem(deletedItem)).resolves.toBe("Item restored");

    expect(cipherActions.calls).toEqual([
      { type: "restore", session, itemId: deletedItem.id },
    ]);
    expect(store.snapshot().deletedItems).toEqual([]);
    expect(store.snapshot().items.map((item) => item.id)).toEqual([deletedItem.id]);
  });

  it("permanently deletes active session Trash items through Bitwarden before removing them locally", async () => {
    const store = new PopupStateStore();
    const session = fakeAuthSession();
    const deletedItem = { ...demoVaultItems[0], id: "deleted-1" };
    store.setActiveSession(session);
    store.setDeletedItems([deletedItem]);
    const cipherActions = new RecordingCipherActions();
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    await expect(service.permanentlyDeleteItem(deletedItem)).resolves.toBe(
      "Item permanently deleted",
    );

    expect(cipherActions.calls).toEqual([
      { type: "delete", session, itemId: deletedItem.id },
    ]);
    expect(store.snapshot().deletedItems).toEqual([]);
  });

  it("preserves Trash state when server restore fails", async () => {
    const store = new PopupStateStore();
    const deletedItem = { ...demoVaultItems[0], id: "deleted-1" };
    store.setActiveSession(fakeAuthSession());
    store.setDeletedItems([deletedItem]);
    const cipherActions = new RecordingCipherActions();
    cipherActions.failWith = new Error("server rejected restore");
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    await expect(service.restoreDeletedItem(deletedItem)).resolves.toBe("Unable to restore item.");

    expect(store.snapshot().deletedItems.map((item) => item.id)).toEqual([deletedItem.id]);
    expect(store.snapshot().items).toEqual([]);
  });

  it("suppresses a duplicate lifecycle request while an item mutation is in flight", async () => {
    const store = new PopupStateStore();
    const session = fakeAuthSession();
    const item = { ...demoVaultItems[0], id: "archive-once" };
    const completion = deferred<void>();
    const cipherActions = new RecordingCipherActions();
    cipherActions.lifecycleCompletion = completion.promise;
    store.setActiveSession(session);
    store.setItems([item]);
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    const first = service.archiveItem(item);
    const second = service.archiveItem(item);
    await Promise.resolve();

    expect(cipherActions.calls.filter((call) => call.type === "archive")).toHaveLength(1);
    await expect(second).resolves.toBe("Item update already in progress.");
    completion.resolve();
    await expect(first).resolves.toBe("Archived item");
    expect(store.snapshot().archivedItems).toEqual([item]);
  });

  it("does not restore a same-account Trash projection replaced by sync", async () => {
    const store = new PopupStateStore();
    const session = fakeAuthSession();
    const item = { ...demoVaultItems[0], id: "deleted-sync" };
    const replacement = { ...item, name: "Synced deleted replacement" };
    const completion = deferred<void>();
    const cipherActions = new RecordingCipherActions();
    cipherActions.lifecycleCompletion = completion.promise;
    store.setActiveSession(session);
    store.setDeletedItems([item]);
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    const pending = service.restoreDeletedItem(item);
    store.setDeletedItems([replacement]);
    completion.resolve();

    await expect(pending).resolves.toBe("Vault changed; action not applied.");
    expect(store.snapshot().deletedItems).toEqual([replacement]);
    expect(store.snapshot().items).toEqual([]);
  });

  it("does not report success when an archived item disappears during an in-flight request", async () => {
    const store = new PopupStateStore();
    const session = fakeAuthSession();
    const item = { ...demoVaultItems[0], id: "archived-gone" };
    const completion = deferred<void>();
    const cipherActions = new RecordingCipherActions();
    cipherActions.lifecycleCompletion = completion.promise;
    store.setActiveSession(session);
    store.setArchivedItems([item]);
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    const pending = service.unarchiveItem(item);
    store.setArchivedItems([]);
    completion.resolve();

    await expect(pending).resolves.toBe("Vault changed; action not applied.");
    expect(store.snapshot().items).toEqual([]);
    expect(store.snapshot().archivedItems).toEqual([]);
  });

  it.each([
    ["archiveItemWithOutcome", "active"],
    ["deleteItemWithOutcome", "active"],
    ["unarchiveItemWithOutcome", "archived"],
    ["deleteArchivedItemWithOutcome", "archived"],
    ["restoreDeletedItemWithOutcome", "deleted"],
    ["permanentlyDeleteItemWithOutcome", "deleted"],
  ] as const)("fails closed without an active session for %s", async (method, location) => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[0], id: `no-session-${method}` };
    if (location === "active") {
      store.setItems([item]);
    } else if (location === "archived") {
      store.setArchivedItems([item]);
    } else {
      store.setDeletedItems([item]);
    }
    const cipherActions = new RecordingCipherActions();
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    await expect(service[method](item)).resolves.toEqual({
      committed: false,
      reason: "failure",
      status: "Vault session is unavailable.",
    });
    expect(cipherActions.calls).toEqual([]);
    expect(store.snapshot().items).toEqual(location === "active" ? [item] : []);
    expect(store.snapshot().archivedItems).toEqual(location === "archived" ? [item] : []);
    expect(store.snapshot().deletedItems).toEqual(location === "deleted" ? [item] : []);
  });

  it.each(["switch", "lock"] as const)(
    "does not commit a restore after an active-session %s",
    async (race) => {
      const store = new PopupStateStore();
      const item = { ...demoVaultItems[2], id: `deleted-${race}` };
      const completion = deferred<void>();
      const cipherActions = new RecordingCipherActions();
      cipherActions.lifecycleCompletion = completion.promise;
      store.setUnlocked("person@example.test");
      store.setActiveSession(fakeAuthSession());
      store.setDeletedItems([item]);
      const service = new VaultActionsService(
        new RecordingHost(),
        new SettingsService(),
        store,
        cipherActions,
      );

      const pending = service.restoreDeletedItemWithOutcome(item);
      await Promise.resolve();
      if (race === "switch") {
        store.setActiveSession({
          ...fakeAuthSession(),
          token: { ...fakeAuthSession().token, accessToken: "new-account-token" },
        });
      } else {
        store.setLocked();
      }
      completion.resolve();

      await expect(pending).resolves.toMatchObject({ committed: false, reason: "stale" });
      expect(store.snapshot().items).toEqual([]);
      if (race === "switch") {
        expect(store.snapshot().deletedItems).toEqual([item]);
      }
    },
  );

  it("allows a failed restore to retry and commits only the successful transport", async () => {
    const store = new PopupStateStore();
    const item = { ...demoVaultItems[1], id: "restore-retry" };
    const cipherActions = new RecordingCipherActions();
    store.setActiveSession(fakeAuthSession());
    store.setDeletedItems([item]);
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    cipherActions.failWith = new Error("first restore failed");
    await expect(service.restoreDeletedItemWithOutcome(item)).resolves.toMatchObject({
      committed: false,
      reason: "failure",
    });
    cipherActions.failWith = undefined;
    await expect(service.restoreDeletedItemWithOutcome(item)).resolves.toMatchObject({
      committed: true,
      status: "Item restored",
    });
    expect(cipherActions.calls.filter((call) => call.type === "restore")).toHaveLength(2);
    expect(store.snapshot().deletedItems).toEqual([]);
    expect(store.snapshot().items).toEqual([item]);
  });

  it("restores a server-marked archived item from Trash back to Archive", async () => {
    const store = new PopupStateStore();
    const item = {
      ...demoVaultItems[3],
      id: "archived-trash-note",
      archivedDate: "2026-07-01T00:00:00.000Z",
    };
    const cipherActions = new RecordingCipherActions();
    store.setActiveSession(fakeAuthSession());
    store.setDeletedItems([item]);
    const service = new VaultActionsService(
      new RecordingHost(),
      new SettingsService(),
      store,
      cipherActions,
    );

    await expect(service.restoreDeletedItemWithOutcome(item)).resolves.toMatchObject({
      committed: true,
      status: "Archived item restored",
    });
    expect(store.snapshot().deletedItems).toEqual([]);
    expect(store.snapshot().items).toEqual([]);
    expect(store.snapshot().archivedItems).toEqual([item]);
  });
});

class RecordingCipherActions implements VaultCipherActionPort {
  calls: Array<
    | {
        type: "softDelete" | "archive" | "unarchive" | "restore" | "delete";
        session: AuthSession;
        itemId: string;
      }
    | {
        type: "partial";
        session: AuthSession;
        itemId: string;
        favorite: boolean;
        folderId?: string;
      }
  > = [];
  failWith: Error | null = null;
  partialCompletion: Promise<void> | null = null;
  lifecycleCompletion: Promise<void> | null = null;

  async updateCipherPartial(
    session: AuthSession,
    itemId: string,
    request: { readonly favorite: boolean; readonly folderId?: string },
  ): Promise<void> {
    this.calls.push({
      type: "partial",
      session,
      itemId,
      favorite: request.favorite,
      ...(request.folderId ? { folderId: request.folderId } : {}),
    });
    if (this.failWith) {
      throw this.failWith;
    }
    await this.partialCompletion;
  }

  async softDeleteCipher(session: AuthSession, itemId: string): Promise<void> {
    this.calls.push({ type: "softDelete", session, itemId });
    if (this.failWith) {
      throw this.failWith;
    }
    await this.lifecycleCompletion;
  }

  async archiveCipher(session: AuthSession, itemId: string): Promise<void> {
    this.calls.push({ type: "archive", session, itemId });
    if (this.failWith) {
      throw this.failWith;
    }
    await this.lifecycleCompletion;
  }

  async unarchiveCipher(session: AuthSession, itemId: string): Promise<void> {
    this.calls.push({ type: "unarchive", session, itemId });
    if (this.failWith) {
      throw this.failWith;
    }
    await this.lifecycleCompletion;
  }

  async restoreCipher(session: AuthSession, itemId: string): Promise<void> {
    this.calls.push({ type: "restore", session, itemId });
    if (this.failWith) {
      throw this.failWith;
    }
    await this.lifecycleCompletion;
  }

  async deleteCipher(session: AuthSession, itemId: string): Promise<void> {
    this.calls.push({ type: "delete", session, itemId });
    if (this.failWith) {
      throw this.failWith;
    }
    await this.lifecycleCompletion;
  }
}

function fakeAuthSession(): AuthSession {
  return {
    environment: buildSelfHostedEnvironmentFromServerUrl("https://bitwarden.example.com"),
    token: {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
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
