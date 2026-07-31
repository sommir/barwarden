import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import type { HostApi } from "../../host/host-api";
import { AppFeedbackService } from "../official-ui/app-feedback.service";
import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";
import { demoVaultItems, type VaultField, type VaultItem } from "../vault-demo";
import {
  VaultActionsService,
  type VaultRemovalMutationOutcome,
} from "./vault-actions.service";
import {
  VaultDetailActionsAdapter,
  type DetailRepromptRequest,
} from "./vault-detail-actions.adapter";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
});

describe("VaultDetailActionsAdapter", () => {
  it("announces a committed detail action while retaining the popup status state", async () => {
    const feedback = new AppFeedbackService();
    const harness = setup({ feedback });
    const field = harness.item.fields.find((candidate) => candidate.id === "username")!;

    await harness.adapter.run(harness.item, { kind: "copy", field });

    expect(harness.store.snapshot().statusMessage).toBe("Copied Username");
    expect(feedback.snapshot()).toMatchObject({ kind: "success", message: "Copied Username" });
  });
  it("accepts only exact item fields and exact synthetic Login notes and URI indexes", async () => {
    const harness = setup();
    const item = harness.item;
    const username = item.fields.find((field) => field.id === "username")!;

    await harness.adapter.run(item, { kind: "copy", field: username });
    await harness.adapter.run(item, {
      kind: "copy",
      field: { id: "notes", label: "Notes", value: item.notes },
    });
    await harness.adapter.run(item, {
      kind: "copy",
      field: { id: "uri:0", label: "Website", value: item.uris[0]!.uri },
    });
    await harness.adapter.run(item, {
      kind: "copy",
      field: { id: "notes", label: "Notes", value: "forged" },
    });
    await harness.adapter.run(item, {
      kind: "copy",
      field: { id: "uri:1", label: "Website", value: item.uris[0]!.uri },
    });

    expect(harness.actions.copyFieldWithOutcome).toHaveBeenCalledTimes(3);
    expect(harness.actions.copyFieldWithOutcome).toHaveBeenNthCalledWith(
      1,
      username,
      expect.any(Function),
    );
    expect(harness.actions.copyFieldWithOutcome).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "notes", value: item.notes }),
      expect.any(Function),
    );
    expect(harness.actions.copyFieldWithOutcome).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ id: "uri:0", value: item.uris[0]!.uri }),
      expect.any(Function),
    );
  });

  it("accepts only exact Card standard action field objects and rejects forged lookalikes", async () => {
    const harness = setup({
      item: {
        ...demoVaultItems.find((item) => item.id === "card")!,
        card: {
          cardholderName: "Travel Ops",
          brand: "Visa",
          number: "4111111111111111",
          expMonth: "04",
          expYear: "2029",
          code: "123",
        },
        fields: [
          { id: "number", label: "Number", value: "4111111111111111", concealed: true, type: "hidden" as const },
          { id: "code", label: "Security code", value: "123", concealed: true, type: "hidden" as const },
        ],
      },
    });
    const number = harness.item.fields[0]!;

    await harness.adapter.run(harness.item, { kind: "copy", field: number });
    await harness.adapter.run(harness.item, {
      kind: "copy",
      field: { id: "number", label: "Number", value: "4111111111111111", concealed: true, type: "hidden" },
    });
    expect(harness.actions.copyFieldWithOutcome).toHaveBeenCalledOnce();
    expect(harness.actions.copyFieldWithOutcome).toHaveBeenCalledWith(number, expect.any(Function));
  });

  it("allows personal notes copy but not notes fill", async () => {
    const harness = setup({
      item: {
        ...demoVaultItems.find((item) => item.id === "card")!,
        notes: "Owned Card notes",
      },
    });
    const notes = { id: "notes", label: "Notes", value: "Owned Card notes" };

    await harness.adapter.run(harness.item, { kind: "copy", field: notes });
    await harness.adapter.run(harness.item, { kind: "fill", field: notes });

    expect(harness.actions.copyFieldWithOutcome).toHaveBeenCalledOnce();
    expect(harness.actions.fillFieldWithOutcome).not.toHaveBeenCalled();
  });

  it("accepts only exact Identity standard action field objects and rejects derived forgeries", async () => {
    const harness = setup({
      item: {
        ...demoVaultItems.find((item) => item.id === "identity")!,
        canFill: true,
        identity: {
          title: "Dr",
          firstName: "Ada",
          middleName: "Augusta",
          lastName: "Lovelace",
          username: "ada",
          company: "Analytical Engines",
          ssn: "000-00-0000",
          passportNumber: "P1234567",
          licenseNumber: "L7654321",
          email: "ada@example.test",
          phone: "+44 20 0000",
          address1: "12 Engine Lane",
          address2: "Suite 2",
          address3: "Research Park",
          city: "London",
          state: "Greater London",
          postalCode: "N1 1AA",
          country: "United Kingdom",
        },
        fields: [
          { id: "ssn", label: "Social security number", value: "000-00-0000", concealed: true, type: "hidden" as const },
          { id: "passport-number", label: "Passport number", value: "P1234567", concealed: true, type: "hidden" as const },
          { id: "full-name", label: "Name", value: "Dr Ada Augusta Lovelace" },
          { id: "address", label: "Address", value: "12 Engine Lane\nSuite 2\nResearch Park\nLondon, Greater London N1 1AA\nUnited Kingdom" },
        ],
      },
    });
    const ssn = harness.item.fields[0]!;
    const fullName = harness.item.fields[2]!;

    await harness.adapter.run(harness.item, { kind: "fill", field: ssn });
    await harness.adapter.run(harness.item, { kind: "copy", field: fullName });
    await harness.adapter.run(harness.item, {
      kind: "copy",
      field: { id: "full-name", label: "Name", value: "Dr Ada Augusta Lovelace" },
    });
    await harness.adapter.run(harness.item, {
      kind: "copy",
      field: { id: "address", label: "Address", value: "forged" },
    });

    expect(harness.actions.fillFieldWithOutcome).toHaveBeenCalledOnce();
    expect(harness.actions.fillFieldWithOutcome).toHaveBeenCalledWith(ssn, expect.any(Function));
    expect(harness.actions.copyFieldWithOutcome).toHaveBeenCalledOnce();
    expect(harness.actions.copyFieldWithOutcome).toHaveBeenCalledWith(fullName, expect.any(Function));
  });

  it("requests one reprompt and runs the protected continuation once after verification", async () => {
    const continuations: Array<() => Promise<void>> = [];
    const requestReprompt: DetailRepromptRequest = (_itemId, continuation) => {
      continuations.push(continuation);
      return true;
    };
    const harness = setup({ requestReprompt, reprompt: true });
    const password = harness.item.fields.find((field) => field.id === "password")!;

    await expect(
      harness.adapter.run(harness.item, { kind: "copy", field: password }),
    ).resolves.toMatchObject({ committed: false, terminal: false });

    expect(continuations).toHaveLength(1);
    expect(harness.actions.copyFieldWithOutcome).not.toHaveBeenCalled();
    await continuations[0]!();
    expect(harness.actions.copyFieldWithOutcome).toHaveBeenCalledOnce();
    expect(harness.store.snapshot().statusMessage).toBe("Copied Password");
  });

  it.each(["lock", "account", "route", "item", "epoch"] as const)(
    "rejects a protected continuation after %s invalidation",
    async (staleKind) => {
      let continuation: (() => Promise<void>) | undefined;
      const harness = setup({
        reprompt: true,
        requestReprompt: (_itemId, next) => {
          continuation = next;
          return true;
        },
      });
      const password = harness.item.fields.find((field) => field.id === "password")!;
      await harness.adapter.run(harness.item, { kind: "fill", field: password });

      if (staleKind === "lock") {
        harness.store.setLocked();
      } else if (staleKind === "account") {
        harness.store.setActiveSession(fakeSession("account-b"));
      } else if (staleKind === "route") {
        harness.router.url = "/tabs/settings";
      } else if (staleKind === "item") {
        harness.store.setItems([{ ...harness.item, name: "Synced replacement" }]);
      } else {
        harness.adapter.invalidate();
      }

      await continuation!();
      expect(harness.actions.fillFieldWithOutcome).not.toHaveBeenCalled();
      expect(harness.store.snapshot().statusMessage).not.toBe("Filled Password");
    },
  );

  it.each(["lock", "account", "route", "item", "epoch"] as const)(
    "rejects a native completion after %s invalidation",
    async (staleKind) => {
      const completion = deferred<{
        committed: false;
        reason: "stale";
        status: string;
      }>();
      const harness = setup();
      harness.actions.copyFieldWithOutcome.mockReturnValueOnce(completion.promise);
      const username = harness.item.fields.find((field) => field.id === "username")!;
      const pending = harness.adapter.run(harness.item, { kind: "copy", field: username });

      if (staleKind === "lock") {
        harness.store.setLocked();
      } else if (staleKind === "account") {
        harness.store.setActiveSession(fakeSession("account-b"));
      } else if (staleKind === "route") {
        harness.router.url = "/tabs/settings";
      } else if (staleKind === "item") {
        harness.store.setItems([{ ...harness.item, name: "Synced replacement" }]);
      } else {
        harness.adapter.invalidate();
      }
      completion.resolve({ committed: false, reason: "stale", status: "Vault changed" });

      await expect(pending).resolves.toMatchObject({ committed: false, terminal: false });
      expect(harness.store.snapshot().statusMessage).not.toBe("Copied Username");
    },
  );

  it.each(
    (["lock", "account", "route", "item", "epoch"] as const).flatMap((staleKind) =>
      (["copy", "fill"] as const).map((kind) => [kind, staleKind] as const),
    ),
  )(
    "blocks real host %s after deferred TOTP resolution and %s invalidation",
    async (kind, staleKind) => {
      const generation = deferred<{
        code: string;
        formattedCode: string;
        period: number;
        secondsRemaining: number;
        isExpiring: boolean;
      }>();
      const host = new RecordingHost();
      const store = new PopupStateStore();
      store.setUnlocked("account-a@example.test");
      store.setActiveSession(fakeSession("account-a"));
      const otp = { id: "otp", label: "OTP", value: "TOTP-SEED", type: "totp" as const };
      const item = { ...demoVaultItems[0], fields: [...demoVaultItems[0].fields, otp] };
      store.setItems([item]);
      const router = {
        url: `/view-cipher/${item.id}`,
        navigateByUrl: vi.fn(async () => true),
      };
      const actions = new VaultActionsService(
        host,
        new SettingsService(),
        store,
        null,
        () => generation.promise,
      );
      const adapter = new VaultDetailActionsAdapter(store, router as never, actions);

      const pending = adapter.run(item, { kind, field: otp });
      invalidate(staleKind, { adapter, item, router, store });
      generation.resolve({
        code: "123456",
        formattedCode: "123 456",
        period: 30,
        secondsRemaining: 1,
        isExpiring: true,
      });

      await expect(pending).resolves.toMatchObject({ committed: false, terminal: false });
      expect(host.copies).toEqual([]);
      expect(host.pastes).toEqual([]);
    },
  );

  it.each(["lock", "account", "route", "item", "epoch"] as const)(
    "blocks real host launch when the captured guard sees %s invalidation",
    async (staleKind) => {
      const host = new RecordingHost();
      const store = new PopupStateStore();
      store.setUnlocked("account-a@example.test");
      store.setActiveSession(fakeSession("account-a"));
      const item = demoVaultItems[0];
      store.setItems([item]);
      const router = {
        url: `/view-cipher/${item.id}`,
        navigateByUrl: vi.fn(async () => true),
      };
      const actions = new VaultActionsService(host, new SettingsService(), store);
      const adapter = new VaultDetailActionsAdapter(store, router as never, actions);
      const guard = adapter.captureGuard(item);

      invalidate(staleKind, { adapter, item, router, store });
      await expect(
        actions.launchUriWithOutcome(item.uris[0]!.uri, guard),
      ).resolves.toMatchObject({ committed: false, reason: "stale" });
      expect(host.opens).toEqual([]);
    },
  );

  it("suppresses a duplicate action while the first native request is in flight", async () => {
    const completion = deferred<{ committed: true; status: string }>();
    const harness = setup();
    harness.actions.copyFieldWithOutcome.mockReturnValueOnce(completion.promise);
    const username = harness.item.fields.find((field) => field.id === "username")!;

    const first = harness.adapter.run(harness.item, { kind: "copy", field: username });
    await expect(
      harness.adapter.run(harness.item, { kind: "copy", field: username }),
    ).resolves.toMatchObject({ committed: false, status: "Action already in progress." });
    expect(harness.actions.copyFieldWithOutcome).toHaveBeenCalledOnce();

    completion.resolve({ committed: true, status: "Copied Username" });
    await expect(first).resolves.toMatchObject({ committed: true });
  });

  it("classifies copy failure and clipboard fallback without exposing native errors", async () => {
    const harness = setup();
    const username = harness.item.fields.find((field) => field.id === "username")!;
    harness.actions.copyFieldWithOutcome.mockResolvedValueOnce({
      committed: false,
      reason: "failure",
      status: "Unable to copy field.",
    });
    harness.actions.fillFieldWithOutcome.mockResolvedValueOnce({
      committed: true,
      status: "Paste failed; copied Username",
    });

    await expect(
      harness.adapter.run(harness.item, { kind: "copy", field: username }),
    ).resolves.toEqual({ committed: false, status: "Unable to copy field.", terminal: false });
    await expect(
      harness.adapter.run(harness.item, { kind: "fill", field: username }),
    ).resolves.toEqual({
      committed: true,
      status: "Paste failed; copied Username",
      terminal: false,
    });
  });

  it("uses typed native outcomes instead of parsing localized or nonstandard statuses", async () => {
    const harness = setup();
    const username = harness.item.fields.find((field) => field.id === "username")!;
    harness.actions.copyFieldWithOutcome.mockResolvedValueOnce({
      committed: true,
      status: "コピーが完了しました",
    });
    harness.actions.fillFieldWithOutcome.mockResolvedValueOnce({
      committed: false,
      reason: "failure",
      status: "Policy denied this transfer",
    });

    await expect(
      harness.adapter.run(harness.item, { kind: "copy", field: username }),
    ).resolves.toEqual({ committed: true, status: "コピーが完了しました", terminal: false });
    await expect(
      harness.adapter.run(harness.item, { kind: "fill", field: username }),
    ).resolves.toEqual({
      committed: false,
      status: "Policy denied this transfer",
      terminal: false,
    });
  });

  it("sends only the generated current TOTP code through the host boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(59_000));
    const host = new RecordingHost();
    const store = new PopupStateStore();
    store.setUnlocked("account-a@example.test");
    store.setActiveSession(fakeSession("account-a"));
    const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const otp = { id: "otp", label: "OTP", value: seed, type: "totp" as const };
    const item = { ...demoVaultItems[0], fields: [...demoVaultItems[0].fields, otp] };
    store.setItems([item]);
    const router = { url: `/view-cipher/${item.id}`, navigateByUrl: vi.fn(async () => true) };
    const actions = new VaultActionsService(host, new SettingsService(), store);
    const adapter = new VaultDetailActionsAdapter(store, router as never, actions);

    await adapter.run(item, { kind: "fill", field: otp });

    expect(host.pastes).toEqual(["287082"]);
    expect(host.pastes).not.toContain(seed);
    vi.useRealTimers();
  });

  it("routes an archived Trash restore from detail back to Archive", async () => {
    const harness = setup();
    harness.store.setItems([]);
    harness.store.setDeletedItems([harness.item]);
    harness.actions.restoreDeletedItemWithOutcome.mockImplementationOnce(async () => {
      harness.store.setDeletedItems([]);
      harness.store.setArchivedItems([harness.item]);
      return committedRemoval(harness.item, "Archived item restored");
    });

    await expect(harness.adapter.run(harness.item, { kind: "restore" })).resolves.toEqual({
      committed: true,
      status: "Archived item restored",
      terminal: true,
    });
    expect(harness.actions.restoreDeletedItemWithOutcome)
      .toHaveBeenCalledWith(harness.item, expect.any(Function));
    expect(harness.router.navigateByUrl).toHaveBeenCalledWith("/archive");
  });

  it("invalidates late continuations after an exact successful terminal removal", async () => {
    const copyCompletion = deferred<{
      committed: false;
      reason: "stale";
      status: string;
    }>();
    const harness = setup();
    harness.actions.copyFieldWithOutcome.mockReturnValueOnce(copyCompletion.promise);
    harness.actions.deleteItemWithOutcome.mockImplementationOnce(async () => {
      harness.store.setItems([]);
      return committedRemoval(harness.item, "Moved item to trash");
    });
    const username = harness.item.fields.find((field) => field.id === "username")!;
    const lateCopy = harness.adapter.run(harness.item, { kind: "copy", field: username });

    await expect(
      harness.adapter.run(harness.item, { kind: "trash" }),
    ).resolves.toEqual({ committed: true, status: "Moved item to trash", terminal: true });
    copyCompletion.resolve({ committed: false, reason: "stale", status: "Vault changed" });

    await expect(lateCopy).resolves.toMatchObject({ committed: false });
    expect(harness.router.navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
    expect(harness.store.snapshot().statusMessage).toBe("Moved item to trash");
  });

  it("runs terminal navigation through the supplied UI execution boundary", async () => {
    const harness = setup();
    harness.actions.deleteItemWithOutcome.mockImplementationOnce(async () => {
      harness.store.setItems([]);
      return committedRemoval(harness.item, "Moved item to trash");
    });
    const runInUi = vi.fn(
      async <T>(operation: () => Promise<T>): Promise<T> => operation(),
    );
    const adapter = Reflect.construct(
      VaultDetailActionsAdapter,
      [harness.store, harness.router, harness.actions, undefined, runInUi],
    ) as VaultDetailActionsAdapter;

    await adapter.run(harness.item, { kind: "trash" });

    expect(runInUi).toHaveBeenCalledOnce();
    expect(harness.router.navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
  });

  it.each(["route", "account"] as const)(
    "keeps a committed terminal receipt when %s context becomes stale after the server outcome",
    async (staleKind) => {
      const harness = setup();
      const completion = deferred<VaultRemovalMutationOutcome>();
      harness.actions.deleteItemWithOutcome.mockReturnValueOnce(completion.promise);

      const pending = harness.adapter.run(harness.item, { kind: "trash" });
      harness.store.setItems([]);
      completion.resolve(committedRemoval(harness.item, "Server committed removal"));
      if (staleKind === "route") {
        harness.router.url = "/tabs/settings";
      } else {
        harness.store.setActiveSession(fakeSession("account-b"));
      }

      await expect(pending).resolves.toEqual({
        committed: true,
        status: "Server committed removal",
        terminal: true,
      });
      expect(harness.router.navigateByUrl).not.toHaveBeenCalled();
      expect(harness.store.snapshot().statusMessage).not.toBe("Server committed removal");
    },
  );

  it.each(["false", "rejection"] as const)(
    "preserves a committed terminal receipt when navigation returns %s",
    async (navigationFailure) => {
      const harness = setup();
      harness.actions.deleteItemWithOutcome.mockImplementationOnce(async () => {
        harness.store.setItems([]);
        return committedRemoval(harness.item, "Server committed removal");
      });
      harness.router.navigateByUrl.mockImplementationOnce(() =>
        navigationFailure === "false"
          ? Promise.resolve(false)
          : Promise.reject(new Error("private navigation failure")),
      );

      await expect(
        harness.adapter.run(harness.item, { kind: "trash" }),
      ).resolves.toEqual({
        committed: true,
        status: "Server committed removal",
        terminal: true,
      });
      expect(harness.store.snapshot().statusMessage).toBe("Server committed removal");
    },
  );
});

function setup(options: {
  readonly feedback?: AppFeedbackService;
  readonly requestReprompt?: DetailRepromptRequest;
  readonly reprompt?: boolean;
  readonly item?: VaultItem;
} = {}) {
  const store = new PopupStateStore();
  store.setUnlocked("account-a@example.test");
  store.setActiveSession(fakeSession("account-a"));
  const item = {
    ...(options.item ?? demoVaultItems[0]),
    notes: options.item?.notes ?? "Owned Login notes",
    reprompt: options.reprompt ?? false,
  };
  store.setItems([item]);
  const router = {
    url: `/view-cipher/${item.id}`,
    navigateByUrl: vi.fn(async () => true),
  };
  const actions = {
    copyFieldWithOutcome: vi.fn(async (field: VaultField) => ({
      committed: true as const,
      status: `Copied ${field.label}`,
    })),
    fillFieldWithOutcome: vi.fn(async (field: VaultField) => ({
      committed: true as const,
      status: `Filled ${field.label}`,
    })),
    launchUriWithOutcome: vi.fn(async () => ({
      committed: true as const,
      status: "Opened URL",
    })),
    archiveItemWithOutcome: vi.fn(async () => committedRemoval(item, "Archived item")),
    unarchiveItemWithOutcome: vi.fn(async () => committedRemoval(item, "Item unarchived")),
    deleteItemWithOutcome: vi.fn(async () => committedRemoval(item, "Moved item to trash")),
    deleteArchivedItemWithOutcome: vi.fn(async () => committedRemoval(item, "Moved item to trash")),
    restoreDeletedItemWithOutcome: vi.fn(async () => committedRemoval(item, "Item restored")),
    permanentlyDeleteItemWithOutcome: vi.fn(async () => committedRemoval(item, "Item permanently deleted")),
  };
  const adapter = new VaultDetailActionsAdapter(
    store,
    router as never,
    actions as unknown as VaultActionsService,
    options.requestReprompt,
    undefined,
    options.feedback,
  );
  return { actions, adapter, item, router, store };
}

function committedRemoval(item: VaultItem, status: string): VaultRemovalMutationOutcome {
  return { committed: true, status, result: { kind: "removed", item } };
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

class RecordingHost implements HostApi {
  readonly copies: string[] = [];
  readonly pastes: string[] = [];
  readonly opens: string[] = [];

  showPopup = async () => undefined;
  hidePopup = async () => undefined;
  copyText = async (value: string) => {
    this.copies.push(value);
  };
  pasteText = async (value: string) => {
    this.pastes.push(value);
  };
  openUrl = async (value: string) => {
    this.opens.push(value);
  };
  secureGet = async () => null;
  secureSet = async () => undefined;
  secureDelete = async () => undefined;
  getAccountLockIntents = async () => [];
  setAccountLockIntents = async () => undefined;
}

function invalidate(
  staleKind: "lock" | "account" | "route" | "item" | "epoch",
  harness: {
    readonly adapter: VaultDetailActionsAdapter;
    readonly item: VaultItem;
    readonly router: { url: string };
    readonly store: PopupStateStore;
  },
): void {
  if (staleKind === "lock") {
    harness.store.setLocked();
  } else if (staleKind === "account") {
    harness.store.setActiveSession(fakeSession("account-b"));
  } else if (staleKind === "route") {
    harness.router.url = "/tabs/settings";
  } else if (staleKind === "item") {
    harness.store.setItems([{ ...harness.item, name: "Synced replacement" }]);
  } else {
    harness.adapter.invalidate();
  }
}
