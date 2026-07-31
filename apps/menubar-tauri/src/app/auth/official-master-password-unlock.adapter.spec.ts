import { firstValueFrom, skip } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { AccountOperationCancelledError } from "./auth.facade";
import { OfficialMasterPasswordUnlockAdapter } from "./official-master-password-unlock.adapter";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

describe("OfficialMasterPasswordUnlockAdapter", () => {
  it("publishes only the active account identity and server from AuthFacade.accounts", async () => {
    const adapter = new OfficialMasterPasswordUnlockAdapter({
      accounts: async () => [
        {
          id: "inactive",
          email: "inactive@example.test",
          serverUrl: "https://inactive.example.test",
          status: "locked",
          isActive: false,
        },
        {
          id: "account-1",
          email: "user@example.test",
          serverUrl: "https://vault.example.test",
          status: "locked",
          isActive: true,
        },
      ],
      unlock: vi.fn(),
      logout: vi.fn(),
    } as never);

    const account = firstValueFrom(adapter.account$.pipe(skip(1)));
    await adapter.refresh();

    await expect(account).resolves.toEqual({
      id: "account-1",
      email: "user@example.test",
      server: "https://vault.example.test",
    });
  });

  it("falls back to the non-secret lock identity when the authoritative account list fails", async () => {
    const accounts = vi.fn()
      .mockResolvedValueOnce([{
        id: "account-1",
        email: "authoritative@example.test",
        serverUrl: "https://authoritative.example.test",
        status: "locked",
        isActive: true,
      }])
      .mockRejectedValueOnce(new Error("account store unavailable"));
    const adapter = new OfficialMasterPasswordUnlockAdapter({
      accounts,
      unlock: vi.fn(),
      logout: vi.fn(),
      lockedAccountIdentity: vi.fn(() => ({
        id: "account-1",
        email: "authoritative@example.test",
        serverUrl: "https://authoritative.example.test",
        status: "locked",
        isActive: true,
      })),
    } as never);

    await adapter.refresh();
    await expect(firstValueFrom(adapter.account$)).resolves.toMatchObject({
      email: "authoritative@example.test",
    });
    await adapter.refresh();

    await expect(firstValueFrom(adapter.account$)).resolves.toEqual({
      id: "account-1",
      email: "authoritative@example.test",
      server: "https://authoritative.example.test",
    });
  });

  it("passes the method parameter directly without retaining a password field while pending", async () => {
    const pending = deferred<"unlocked">();
    const unlock = vi.fn(() => pending.promise);
    const adapter = new OfficialMasterPasswordUnlockAdapter({
      accounts: vi.fn(),
      unlock,
      logout: vi.fn(),
    } as never);

    const result = adapter.unlock("master-password");

    expect(unlock).toHaveBeenCalledWith("master-password");
    expect(Object.getOwnPropertyNames(adapter)).not.toContain("transientPassword");
    expect(Object.values(adapter)).not.toContain("master-password");
    pending.resolve("unlocked");
    await expect(result).resolves.toBe("unlocked");
  });

  it.each([
    "unlocked",
    "twoFactor",
    "newDeviceVerification",
  ] as const)("returns the facade %s outcome without translating it into an error", async (outcome) => {
    const adapter = new OfficialMasterPasswordUnlockAdapter({
      accounts: vi.fn(),
      unlock: vi.fn(async () => outcome),
      logout: vi.fn(),
    } as never);

    await expect(adapter.unlock("master-password")).resolves.toBe(outcome);
  });

  it("does not retain a password after unlock failure or logout", async () => {
    const adapter = new OfficialMasterPasswordUnlockAdapter({
      accounts: async () => [],
      unlock: async () => { throw new Error("private unlock failure"); },
      logout: vi.fn(async () => undefined),
    } as never);

    const failure = adapter.unlock("master-password");
    await expect(failure).rejects.toThrow("无法解锁。请重试。");
    await expect(failure).rejects.not.toThrow("private unlock failure");
    await adapter.logout();

    expect(Object.getOwnPropertyNames(adapter)).not.toContain("transientPassword");
    expect(Object.values(adapter)).not.toContain("master-password");
  });

  it("propagates a superseded logout cancellation after refreshing the retained account", async () => {
    const cancellation = new AccountOperationCancelledError();
    const accounts = vi.fn(async () => []);
    const adapter = new OfficialMasterPasswordUnlockAdapter({
      accounts,
      unlock: vi.fn(),
      logout: vi.fn(async () => { throw cancellation; }),
    } as never);

    await expect(adapter.logout()).rejects.toBe(cancellation);
    expect(accounts).toHaveBeenCalledOnce();
  });
});
