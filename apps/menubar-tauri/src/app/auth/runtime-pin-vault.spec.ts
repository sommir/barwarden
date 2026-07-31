import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import {
  RuntimePinVault,
  type PinEnvelope,
  type PinRecordStorePort,
} from "./runtime-pin-vault";

const accountA = "a".repeat(64);
const accountB = "b".repeat(64);

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("RuntimePinVault", () => {
  it.each(["12345", "123456789", "abcdef", "１２３４５６", "123 456"])(
    "rejects invalid PIN %s",
    async (pin) => {
      const vault = new RuntimePinVault();

      await expect(vault.enable(accountA, pin, session("access-a"))).rejects.toThrow(
        "invalid-pin",
      );
      expect(vault.isEnabled(accountA)).toBe(false);
    },
  );

  it.each(["123456", "1234567", "12345678"])(
    "accepts a %s ASCII digit PIN",
    async (pin) => {
      const vault = new RuntimePinVault();
      const expected = session(`access-${pin.length}`);

      await vault.enable(accountA, pin, expected);

      await expect(vault.unlock(accountA, pin)).resolves.toEqual({
        status: "success",
        session: expected,
      });
    },
  );

  it("enables and unlocks a valid official desktop session", async () => {
    const vault = new RuntimePinVault();
    const expected = session("desktop-access", "desktop");

    await vault.enable(accountA, "123456", expected);

    expect(vault.isEnabled(accountA)).toBe(true);
    await expect(vault.unlock(accountA, "123456")).resolves.toEqual({
      status: "success",
      session: expected,
    });
  });

  it("requires a master-password activation before a persisted PIN can unlock a restarted app", async () => {
    const store = new MemoryPinStore();
    const firstProcess = new RuntimePinVault(store);
    const expected = session("persisted-access");
    await firstProcess.enable(accountA, "123456", expected);

    const restartedProcess = new RuntimePinVault(store);
    expect(restartedProcess.isEnabled(accountA)).toBe(false);
    await expect(restartedProcess.unlock(accountA, "123456")).resolves.toEqual({
      status: "unavailable",
    });

    await restartedProcess.activatePersistedPin(accountA);
    expect(restartedProcess.isEnabled(accountA)).toBe(true);
    await expect(restartedProcess.unlock(accountA, "123456")).resolves.toEqual({
      status: "success",
      session: expected,
    });
  });

  it("removes the persisted PIN record when disabled", async () => {
    const store = new MemoryPinStore();
    const vault = new RuntimePinVault(store);
    await vault.enable(accountA, "123456", session("access-a"));

    await vault.disable(accountA);

    const restartedProcess = new RuntimePinVault(store);
    await restartedProcess.activatePersistedPin(accountA);
    expect(restartedProcess.isEnabled(accountA)).toBe(false);
  });

  it("isolates PIN envelopes and attempts by account", async () => {
    const vault = new RuntimePinVault();
    const sessionA = session("access-a");
    const sessionB = session("access-b");
    await vault.enable(accountA, "123456", sessionA);
    await vault.enable(accountB, "87654321", sessionB);

    await expect(vault.unlock(accountA, "123456")).resolves.toEqual({
      status: "success",
      session: sessionA,
    });
    await expect(vault.unlock(accountB, "123456")).resolves.toEqual({
      status: "incorrect",
      attemptsRemaining: 4,
    });
    await expect(vault.unlock(accountB, "87654321")).resolves.toEqual({
      status: "success",
      session: sessionB,
    });
  });

  it("destroys only the matching account envelope after five failures", async () => {
    const vault = new RuntimePinVault();
    await vault.enable(accountA, "123456", session("access-a"));
    await vault.enable(accountB, "87654321", session("access-b"));

    for (let attemptsRemaining = 4; attemptsRemaining > 0; attemptsRemaining -= 1) {
      await expect(vault.unlock(accountA, "000000")).resolves.toEqual({
        status: "incorrect",
        attemptsRemaining,
      });
    }

    await expect(vault.unlock(accountA, "000000")).resolves.toEqual({
      status: "exhausted",
    });
    expect(vault.isEnabled(accountA)).toBe(false);
    expect(vault.isEnabled(accountB)).toBe(true);
    await expect(vault.unlock(accountA, "123456")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("resets failed attempts after a successful unlock", async () => {
    const vault = new RuntimePinVault();
    await vault.enable(accountA, "123456", session("access-a"));

    await expect(vault.unlock(accountA, "000000")).resolves.toMatchObject({
      status: "incorrect",
    });
    await expect(vault.unlock(accountA, "123456")).resolves.toMatchObject({
      status: "success",
    });
    await expect(vault.unlock(accountA, "000000")).resolves.toEqual({
      status: "incorrect",
      attemptsRemaining: 4,
    });
  });

  it("re-derives the key after the cached key is cleared", async () => {
    const vault = new RuntimePinVault();
    const expected = session("access-a");
    await vault.enable(accountA, "123456", expected);

    vault.clearDerivedKey(accountA);

    await expect(vault.unlock(accountA, "123456")).resolves.toEqual({
      status: "success",
      session: expected,
    });
  });

  it("replaces the encrypted session before lock and waits for replacement", async () => {
    const vault = new RuntimePinVault();
    await vault.enable(accountA, "123456", session("old-access"));

    vault.prepareForLock(accountA, session("refreshed-access"));

    await expect(vault.unlock(accountA, "123456")).resolves.toEqual({
      status: "success",
      session: session("refreshed-access"),
    });
  });

  it("retains the existing PIN envelope when another unlock method did not derive its key", async () => {
    const vault = new RuntimePinVault();
    await vault.enable(accountA, "123456", session("initial-access"));
    vault.prepareForLock(accountA, session("latest-pin-access"));
    await expect(vault.unlock(accountA, "123456")).resolves.toMatchObject({
      status: "success",
    });
    vault.clearDerivedKey(accountA);

    vault.prepareForLock(accountA, session("biometric-access"));

    expect(vault.isEnabled(accountA)).toBe(true);
    await expect(vault.unlock(accountA, "123456")).resolves.toEqual({
      status: "success",
      session: session("latest-pin-access"),
    });
  });

  it("disables and clears accounts independently", async () => {
    const vault = new RuntimePinVault();
    await vault.enable(accountA, "123456", session("access-a"));
    await vault.enable(accountB, "87654321", session("access-b"));

    await vault.disable(accountA);
    expect(vault.isEnabled(accountA)).toBe(false);
    expect(vault.isEnabled(accountB)).toBe(true);

    await vault.clearAccount(accountB);
    expect(vault.isEnabled(accountB)).toBe(false);
  });

  it("does not expose PIN, session, token, envelope, or CryptoKey as enumerable state", async () => {
    const vault = new RuntimePinVault();
    const expected = session("top-secret-access");
    await vault.enable(accountA, "123456", expected);

    const enumerable = JSON.stringify({
      keys: Object.keys(vault),
      spread: { ...vault },
      value: vault,
    });

    expect(enumerable).not.toContain("123456");
    expect(enumerable).not.toContain("top-secret-access");
    expect(enumerable).not.toContain("refresh-token");
    expect(enumerable).not.toContain("ciphertext");
    expect(enumerable).not.toContain("CryptoKey");
    expect(enumerable).toBe('{"keys":[],"spread":{},"value":{}}');
  });
});

function session(
  accessToken: string,
  clientId: AuthSession["token"]["clientId"] = "browser",
): AuthSession {
  return {
    environment: {
      apiUrl: "https://api.example.com",
      identityUrl: "https://identity.example.com",
      iconsUrl: "https://icons.example.com",
      webVaultUrl: "https://vault.example.com",
      sendUrl: "https://send.example.com",
    },
    token: {
      accessToken,
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
      clientId,
      obtainedAtEpochMs: 1_700_000_000_000,
    },
    crypto: {
      userKeyB64: "dXNlci1rZXk=",
    },
  };
}

class MemoryPinStore implements PinRecordStorePort {
  readonly values = new Map<string, PinEnvelope>();

  read(accountId: string): Promise<PinEnvelope | null> {
    return Promise.resolve(this.values.get(accountId) ?? null);
  }

  write(accountId: string, envelope: PinEnvelope): Promise<void> {
    this.values.set(accountId, envelope);
    return Promise.resolve();
  }

  remove(accountId: string): Promise<void> {
    this.values.delete(accountId);
    return Promise.resolve();
  }
}
