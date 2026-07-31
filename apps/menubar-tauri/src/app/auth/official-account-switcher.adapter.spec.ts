import "@angular/compiler";

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BehaviorSubject, firstValueFrom, skip } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccountSessionPort } from "../../auth/account-session-port";
import type { StoredAccount } from "../../auth/account-session-store";
import { AuthSessionStore } from "../../auth/auth-session-store";
import { PopupStateStore } from "../popup-state";
import { AccountOperationCancelledError, AuthFacade } from "./auth.facade";

const adapterPath = join(
  process.cwd(),
  "apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.ts",
);

const activeAccount: StoredAccount = {
  id: "active-account",
  email: "active@example.com",
  serverUrl: "https://vault.active.example.com",
  status: "unlocked",
  isActive: true,
};

const unlockedAccount: StoredAccount = {
  id: "unlocked-account",
  email: "unlocked@example.com",
  serverUrl: "https://vault.unlocked.example.com",
  status: "unlocked",
  isActive: false,
};

const lockedAccount: StoredAccount = {
  id: "locked-account",
  email: "locked@example.com",
  serverUrl: "https://vault.locked.example.com",
  status: "locked",
  isActive: false,
};

type AuthDouble = {
  accounts: ReturnType<typeof vi.fn>;
  switchAccount: ReturnType<typeof vi.fn>;
  lockAccount: ReturnType<typeof vi.fn>;
  lockAll: ReturnType<typeof vi.fn>;
  logoutAccount: ReturnType<typeof vi.fn>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function setup(overrides: Partial<AuthDouble> = {}) {
  expect(existsSync(adapterPath), "official account switcher adapter runtime").toBe(true);
  const { OfficialAccountSwitcherAdapter } = await import(
    "./official-account-switcher.adapter"
  );
  const accounts = new BehaviorSubject<readonly StoredAccount[]>([
    activeAccount,
    unlockedAccount,
    lockedAccount,
  ]);
  const auth: AuthDouble = {
    accounts: vi.fn(() => Promise.resolve(accounts.value)),
    switchAccount: vi.fn(async (id: string) => {
      const selected = accounts.value.find((account) => account.id === id) ?? lockedAccount;
      const next = accounts.value.map((account) => ({
        ...account,
        isActive: account.id === selected.id,
      }));
      accounts.next(next);
      return { ...selected, isActive: true };
    }),
    lockAccount: vi.fn(async () => undefined),
    lockAll: vi.fn(async () => undefined),
    logoutAccount: vi.fn(async () => null),
    ...overrides,
  };
  const router = { navigateByUrl: vi.fn(async () => true) };
  const store = new PopupStateStore();
  store.setLockedAccount(activeAccount.email, activeAccount.serverUrl);
  store.setActiveSession({
    environment: {
      apiUrl: "https://api.example.com",
      identityUrl: "https://identity.example.com",
    },
    token: {
      accessToken: "access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  });
  store.setUnlocked(activeAccount.email);
  const adapter = new OfficialAccountSwitcherAdapter(auth as never, router as never, store);
  await adapter.refresh();
  return { accounts, adapter, auth, router, store };
}

describe("OfficialAccountSwitcherAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exists as the only bounded account hierarchy port", () => {
    expect(existsSync(adapterPath), "official account switcher adapter runtime").toBe(true);
    if (!existsSync(adapterPath)) {
      return;
    }

    const source = readFileSync(adapterPath, "utf8");
    expect(source).toContain("export interface OfficialAccountSwitcherPort");
    expect(source).toContain("readonly accounts$: Observable<readonly StoredAccount[]>");
    expect(source).toContain("readonly activeAccount$: Observable<StoredAccount | null>");
    expect(source).toContain("static readonly ACCOUNT_LIMIT = 5");
    expect(source).not.toMatch(
      /chrome\.runtime|BrowserApi|fromChromeEvent|isSafariApi|SafariAccountSwitching|biometric|foreground-lock|extension logout|signup|register|browser\.tabs|chrome\.tabs/i,
    );
  });

  it("publishes active-first accounts and official current-account dependencies", async () => {
    const { adapter } = await setup();

    await expect(firstValueFrom(adapter.accounts$)).resolves.toEqual([
      activeAccount,
      unlockedAccount,
      lockedAccount,
    ]);
    await expect(firstValueFrom(adapter.activeAccount$)).resolves.toEqual(activeAccount);
    await expect(firstValueFrom(adapter.accountService.activeAccount$)).resolves.toMatchObject({
      id: activeAccount.id,
      email: activeAccount.email,
    });
    await expect(firstValueFrom(adapter.authService.activeAccountStatus$)).resolves.toBe(2);
    await expect(firstValueFrom(adapter.avatarService.avatarColor$)).resolves.toMatch(/^#[0-9A-F]{6}$/);
  });

  it("derives current-account authorization from the live session instead of persisted active status", async () => {
    const { adapter, store } = await setup();

    store.setLockedAccount(activeAccount.email, activeAccount.serverUrl);

    await expect(firstValueFrom(adapter.activeAuthorization$)).resolves.toBe(
      "recovery-required",
    );
    await expect(firstValueFrom(adapter.authService.activeAccountStatus$)).resolves.toBe(1);
    await expect(firstValueFrom(adapter.activeAccount$)).resolves.toMatchObject({
      id: activeAccount.id,
      isActive: true,
      status: "unlocked",
    });
  });

  it("navigates add account only to the retained login route below five accounts", async () => {
    const { adapter, auth, router } = await setup();

    await adapter.add();

    expect(router.navigateByUrl).toHaveBeenCalledWith("/login");
    expect(auth.switchAccount).not.toHaveBeenCalled();
  });

  it("rejects add at the exact account limit without navigating", async () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      ...activeAccount,
      id: `account-${index}`,
      email: `account-${index}@example.com`,
      isActive: index === 0,
    }));
    const { adapter, router } = await setup({ accounts: vi.fn(async () => five) });

    await expect(adapter.add()).rejects.toThrow("Account limit reached");
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it("rechecks the authoritative account limit before add navigation", async () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      ...activeAccount,
      id: `authoritative-account-${index}`,
      email: `authoritative-account-${index}@example.com`,
      isActive: index === 0,
    }));
    const { adapter, auth, router } = await setup();
    auth.accounts.mockResolvedValue(five);

    await expect(adapter.add()).rejects.toThrow("Account limit reached");

    expect(auth.accounts).toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it.each([
    [unlockedAccount, "/tabs/vault"],
    [lockedAccount, "/lock"],
  ] as const)("selects an account and routes by retained lock state", async (selected, route) => {
    const { adapter, auth, router } = await setup({
      switchAccount: vi.fn(async () => ({ ...selected, isActive: true })),
    });

    await adapter.select(selected.id);

    expect(auth.switchAccount).toHaveBeenCalledWith(selected.id);
    expect(router.navigateByUrl).toHaveBeenCalledWith(route);
  });

  it("returns an already-unlocked active account to the vault without switching it", async () => {
    const { adapter, auth, router } = await setup();

    await adapter.select(activeAccount.id);

    expect(auth.switchAccount).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledOnce();
    expect(router.navigateByUrl).toHaveBeenCalledWith("/tabs/vault");
  });

  it("locks one account and all accounts through AuthFacade", async () => {
    const { adapter, auth, router } = await setup();

    await adapter.lock(activeAccount.id);
    await adapter.lockAll();

    expect(auth.lockAccount).toHaveBeenCalledWith(activeAccount.id);
    expect(auth.lockAll).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).toHaveBeenNthCalledWith(1, "/lock");
    expect(router.navigateByUrl).toHaveBeenNthCalledWith(2, "/lock");
  });

  it.each([
    [null, "/login"],
    [unlockedAccount, "/tabs/vault"],
    [lockedAccount, "/lock"],
  ] as const)("logs out and routes to the next retained account state", async (next, route) => {
    const { adapter, auth, router } = await setup({
      logoutAccount: vi.fn(async () => next),
    });

    await adapter.logout(activeAccount.id);

    expect(auth.logoutAccount).toHaveBeenCalledWith(activeAccount.id);
    expect(router.navigateByUrl).toHaveBeenCalledWith(route);
  });

  it("does not navigate when retained-account cleanup rejects", async () => {
    const { adapter, router } = await setup({
      logoutAccount: vi.fn(async () => { throw new Error("Unable to log out account"); }),
    });

    await expect(adapter.logout(activeAccount.id)).rejects.toThrow("Account action failed");

    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it("clears the active legacy session before switcher removal", async () => {
    const events: string[] = [];
    let accounts: StoredAccount[] = [activeAccount];
    const accountStore = switcherAccountPort({
      list: async () => accounts,
      remove: async (id) => {
        events.push(`remove:${id}`);
        const removed = accounts.find((account) => account.id === id) ?? null;
        accounts = accounts.filter((account) => account.id !== id);
        return removed;
      },
    });
    vi.spyOn(AuthSessionStore.prototype, "clear").mockImplementation(async () => {
      events.push("legacy-clear");
    });
    const facade = new AuthFacade(
      new PopupStateStore(), null, null, null, undefined, accountStore,
    );
    const router = { navigateByUrl: vi.fn(async () => true) };
    const { OfficialAccountSwitcherAdapter } = await import("./official-account-switcher.adapter");
    const adapter = new OfficialAccountSwitcherAdapter(facade, router as never);
    await adapter.refresh();

    await adapter.logout(activeAccount.id);

    expect(events).toEqual(["legacy-clear", `remove:${activeAccount.id}`]);
    expect(router.navigateByUrl).toHaveBeenCalledWith("/login");
  });

  it("keeps the active account recoverable when switcher legacy cleanup fails", async () => {
    const remove = vi.fn(async () => activeAccount);
    const setStatus = vi.fn(async () => undefined);
    const accountStore = switcherAccountPort({ remove, setStatus });
    const clearSpy = vi.spyOn(AuthSessionStore.prototype, "clear")
      .mockRejectedValue(new Error("legacy secure delete failed"));
    const store = new PopupStateStore();
    store.setServerUrl(activeAccount.serverUrl);
    store.setUnlocked(activeAccount.email);
    const facade = new AuthFacade(store, null, null, null, undefined, accountStore);
    const router = { navigateByUrl: vi.fn(async () => true) };
    const { OfficialAccountSwitcherAdapter } = await import("./official-account-switcher.adapter");
    const adapter = new OfficialAccountSwitcherAdapter(facade, router as never);
    await adapter.refresh();

    await expect(adapter.logout(activeAccount.id)).rejects.toThrow("Account action failed");

    expect(clearSpy).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(activeAccount.id, "locked");
    expect(store.snapshot()).toMatchObject({
      email: activeAccount.email,
      isUnlocked: false,
      activeSession: null,
    });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it("coalesces duplicate actions without duplicating facade cleanup", async () => {
    const completion = deferred<StoredAccount | null>();
    const { adapter, auth } = await setup({
      logoutAccount: vi.fn(() => completion.promise),
    });

    const first = adapter.logout(activeAccount.id);
    const duplicate = adapter.logout(activeAccount.id);

    expect(duplicate).toBe(first);
    expect(auth.logoutAccount).toHaveBeenCalledTimes(1);
    completion.resolve(null);
    await first;
  });

  it("rejects stale completion after another account operation owns navigation", async () => {
    const firstCompletion = deferred<StoredAccount>();
    const secondCompletion = deferred<StoredAccount>();
    const switchAccount = vi.fn()
      .mockReturnValueOnce(firstCompletion.promise)
      .mockReturnValueOnce(secondCompletion.promise);
    const { adapter, router } = await setup({ switchAccount });

    const stale = adapter.select(unlockedAccount.id);
    const current = adapter.select(lockedAccount.id);
    secondCompletion.resolve({ ...lockedAccount, isActive: true });
    await current;
    firstCompletion.resolve({ ...unlockedAccount, isActive: true });

    await expect(stale).rejects.toBeInstanceOf(AccountOperationCancelledError);
    expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).toHaveBeenCalledWith("/lock");
  });

  it("publishes only fixed operation feedback and settles loading after failure", async () => {
    const privateFailure = "private.example.com account-id token-value";
    const { adapter, router } = await setup({
      lockAccount: vi.fn(async () => {
        throw new Error(privateFailure);
      }),
    });
    const loadingStates: boolean[] = [];
    adapter.loading$.subscribe((loading) => loadingStates.push(loading));
    const nextError = firstValueFrom(adapter.error$.pipe(skip(1)));

    await expect(adapter.lock(activeAccount.id)).rejects.toThrow("Account action failed");

    expect(await nextError).toBe("无法完成账户操作。请重试。");
    expect(JSON.stringify(loadingStates)).not.toContain(privateFailure);
    expect(loadingStates.at(-1)).toBe(false);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it.each(["one", "all"] as const)(
    "propagates real account-port lock-%s persistence rejection without success navigation",
    async (mode) => {
      const accountStore = rejectingLockAccountPort(mode);
      const facade = new AuthFacade(
        new PopupStateStore(),
        null,
        null,
        null,
        undefined,
        accountStore,
      );
      const router = { navigateByUrl: vi.fn(async () => true) };
      const { OfficialAccountSwitcherAdapter } = await import("./official-account-switcher.adapter");
      const adapter = new OfficialAccountSwitcherAdapter(facade, router as never);
      await adapter.refresh();

      const operation = mode === "one"
        ? adapter.lock(activeAccount.id)
        : adapter.lockAll();

      await expect(operation).rejects.toThrow("Account action failed");
      await expect(firstValueFrom(adapter.error$)).resolves.toBe("无法完成账户操作。请重试。");
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    },
  );
});

function rejectingLockAccountPort(mode: "one" | "all"): AccountSessionPort {
  return {
    list: async () => [activeAccount],
    saveAccount: async () => { throw new Error("Unexpected saveAccount"); },
    setActive: async () => activeAccount,
    setStatus: async () => {
      if (mode === "one") {
        throw new Error("private persistence detail");
      }
    },
    readSession: async () => null,
    replaceSession: async () => false,
    remove: async () => null,
    lockAll: async () => {
      if (mode === "all") {
        throw new Error("private persistence detail");
      }
    },
  };
}

function switcherAccountPort(overrides: Partial<AccountSessionPort> = {}): AccountSessionPort {
  return {
    list: async () => [activeAccount],
    saveAccount: async () => { throw new Error("Unexpected saveAccount"); },
    setActive: async () => activeAccount,
    setStatus: async () => undefined,
    readSession: async () => null,
    replaceSession: async () => false,
    remove: async () => activeAccount,
    lockAll: async () => undefined,
    ...overrides,
  };
}
