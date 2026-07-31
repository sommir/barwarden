import { describe, expect, it, vi } from "vitest";

import type { AccountSessionPort } from "../../auth/account-session-port";
import type { AuthSession } from "../../auth/auth-session-store";
import type {
  BiometricAvailability,
  BiometricHost,
  BiometricOperationStatus,
} from "../../host/biometric-host";
import type { RuntimePinVaultPort } from "./runtime-pin-vault";
import {
  AlternativeUnlockError,
  type BiometricPreferencePort,
} from "./unlock-methods.port";
import { UnlockMethodsService } from "./unlock-methods.service";

const accountA = "a".repeat(64);
const accountB = "b".repeat(64);

describe("UnlockMethodsService", () => {
  it("returns availability without opening a biometric authentication prompt", async () => {
    const pinVault = pinVaultPort({ isEnabled: (id) => id === accountA });
    const biometric = biometricHost({ status: "available" });
    const preferences = preferencePort({ [accountA]: true });
    const service = new UnlockMethodsService(
      pinVault,
      biometric.host,
      accountStore([storedAccount(accountA), storedAccount(accountB)]),
      preferences.port,
    );

    await expect(service.availability(accountA)).resolves.toEqual({
      pinEnabled: true,
      biometricEnabled: true,
      biometricAvailability: "available",
    });
    expect(biometric.unlock).not.toHaveBeenCalled();
  });

  it("activates a persisted PIN only for an existing account after master-password login", async () => {
    const activatePersistedPin = vi.fn(async () => undefined);
    const service = new UnlockMethodsService(
      pinVaultPort({ activatePersistedPin }),
      biometricHost().host,
      accountStore([storedAccount(accountA)]),
      preferencePort().port,
    );

    await service.activatePersistedPin(accountA);

    expect(activatePersistedPin).toHaveBeenCalledOnce();
    expect(activatePersistedPin).toHaveBeenCalledWith(accountA);
  });

  it("Touch ID success reads only the matching account session", async () => {
    const sessionA = session("access-a");
    const readSession = vi.fn(async (id: string) => (id === accountA ? sessionA : session("access-b")));
    const biometric = biometricHost({ unlock: "success" });
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometric.host,
      accountStore([storedAccount(accountA), storedAccount(accountB)], { readSession }),
      preferencePort({ [accountA]: true }).port,
    );

    await expect(service.unlockWithBiometric(accountA)).resolves.toEqual(sessionA);

    expect(biometric.unlock).toHaveBeenCalledWith(accountA);
    expect(readSession).toHaveBeenCalledOnce();
    expect(readSession).toHaveBeenCalledWith(accountA);
  });

  it("fails closed without prompting when the biometric preference is disabled", async () => {
    const biometric = biometricHost({ unlock: "success" });
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometric.host,
      accountStore([storedAccount(accountA)]),
      preferencePort().port,
    );

    await expect(service.unlockWithBiometric(accountA)).rejects.toEqual(
      new AlternativeUnlockError("biometric-unavailable"),
    );
    expect(biometric.unlock).not.toHaveBeenCalled();
  });

  it("sanitizes account-list failures before alternative unlock", async () => {
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometricHost().host,
      accountStore([], {
        list: async () => {
          throw new Error("https://private.example accessToken=private-access");
        },
      }),
      preferencePort({ [accountA]: true }).port,
    );

    const failure = await service.unlockWithBiometric(accountA).catch((error) => error);

    expect(failure).toEqual(new AlternativeUnlockError("session-unavailable"));
    expect(String(failure)).not.toContain("private");
  });

  it("sanitizes persisted-session read failures after successful Touch ID", async () => {
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometricHost({ unlock: "success" }).host,
      accountStore([storedAccount(accountA)], {
        readSession: async () => {
          throw new Error("refreshToken=private-refresh https://private.example");
        },
      }),
      preferencePort({ [accountA]: true }).port,
    );

    const failure = await service.unlockWithBiometric(accountA).catch((error) => error);

    expect(failure).toEqual(new AlternativeUnlockError("session-unavailable"));
    expect(String(failure)).not.toContain("private");
  });

  it("rejects unknown accounts before invoking Touch ID or reading a session", async () => {
    const biometric = biometricHost({ unlock: "success" });
    const readSession = vi.fn(async () => session("wrong"));
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometric.host,
      accountStore([storedAccount(accountB)], { readSession }),
      preferencePort({ [accountA]: true }).port,
    );

    await expect(service.unlockWithBiometric(accountA)).rejects.toEqual(
      new AlternativeUnlockError("session-unavailable"),
    );
    expect(biometric.unlock).not.toHaveBeenCalled();
    expect(readSession).not.toHaveBeenCalled();
  });

  it("disables only the matching biometric preference when Touch ID is invalidated", async () => {
    const biometric = biometricHost({ unlock: "invalidated" });
    const preferences = preferencePort({ [accountA]: true, [accountB]: true });
    const readSession = vi.fn(async () => session("must-not-read"));
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometric.host,
      accountStore([storedAccount(accountA), storedAccount(accountB)], { readSession }),
      preferences.port,
    );

    await expect(service.unlockWithBiometric(accountA)).rejects.toEqual(
      new AlternativeUnlockError("biometric-invalidated"),
    );

    expect(preferences.writeBiometricEnabled).toHaveBeenCalledWith(accountA, false);
    expect(preferences.clearAccount).not.toHaveBeenCalled();
    expect(preferences.values.get(accountA)).toBe(false);
    expect(preferences.values.get(accountB)).toBe(true);
    expect(readSession).not.toHaveBeenCalled();
  });

  it("keeps the fixed invalidated result when preference cleanup storage fails", async () => {
    const biometric = biometricHost({ unlock: "invalidated" });
    const preferences = preferencePort({ [accountA]: true });
    preferences.writeBiometricEnabled.mockImplementation(() => false);
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometric.host,
      accountStore([storedAccount(accountA)]),
      preferences.port,
    );

    const failure = await service.unlockWithBiometric(accountA).catch((error) => error);

    expect(failure).toEqual(new AlternativeUnlockError("biometric-invalidated"));
    expect(String(failure)).not.toContain("private");
    await expect(service.availability(accountA)).resolves.toMatchObject({
      biometricEnabled: false,
    });
    expect(preferences.values.get(accountA)).toBe(true);
  });

  it.each([
    ["cancelled", "biometric-cancelled"],
    ["failed", "biometric-failed"],
    ["not-enrolled", "biometric-unavailable"],
    ["not-available", "biometric-unavailable"],
    ["locked-out", "biometric-unavailable"],
    ["storage-unavailable", "biometric-unavailable"],
    ["invalid-account", "biometric-unavailable"],
  ] as const)("maps Touch ID %s to %s", async (nativeStatus, expectedCode) => {
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometricHost({ unlock: nativeStatus }).host,
      accountStore([storedAccount(accountA)]),
      preferencePort({ [accountA]: true }).port,
    );

    await expect(service.unlockWithBiometric(accountA)).rejects.toEqual(
      new AlternativeUnlockError(expectedCode),
    );
  });

  it("rejects a missing persisted session after successful Touch ID", async () => {
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometricHost({ unlock: "success" }).host,
      accountStore([storedAccount(accountA)]),
      preferencePort({ [accountA]: true }).port,
    );

    await expect(service.unlockWithBiometric(accountA)).rejects.toEqual(
      new AlternativeUnlockError("session-unavailable"),
    );
  });

  it.each([
    [{ status: "incorrect", attemptsRemaining: 3 } as const, "incorrect-pin", 3],
    [{ status: "exhausted" } as const, "pin-exhausted", undefined],
    [{ status: "unavailable" } as const, "pin-unavailable", undefined],
  ] as const)("maps PIN result $0 to a sanitized failure", async (
    result,
    expectedCode,
    expectedAttemptsRemaining,
  ) => {
    const service = new UnlockMethodsService(
      pinVaultPort({ unlock: async () => result }),
      biometricHost().host,
      accountStore([storedAccount(accountA)]),
      preferencePort().port,
    );

    const failure = await service.unlockWithPin(accountA, "123456").catch(
      (error) => error,
    );

    expect(failure).toBeInstanceOf(AlternativeUnlockError);
    expect(failure).toMatchObject({
      code: expectedCode,
      attemptsRemaining: expectedAttemptsRemaining,
      message: "Unable to unlock vault.",
    });
  });

  it("returns only the PIN vault session for the requested account", async () => {
    const sessionA = session("access-a");
    const unlock = vi.fn(async (id: string) =>
      id === accountA
        ? { status: "success" as const, session: sessionA }
        : { status: "unavailable" as const },
    );
    const service = new UnlockMethodsService(
      pinVaultPort({ unlock }),
      biometricHost().host,
      accountStore([storedAccount(accountA), storedAccount(accountB)]),
      preferencePort().port,
    );

    await expect(service.unlockWithPin(accountA, "123456")).resolves.toEqual(sessionA);
    expect(unlock).toHaveBeenCalledWith(accountA, "123456");
  });

  it("returns a valid official desktop session from the PIN vault", async () => {
    const desktopSession: AuthSession = {
      ...session("desktop-access"),
      token: {
        ...session("desktop-access").token,
        clientId: "desktop",
      },
    };
    const service = new UnlockMethodsService(
      pinVaultPort({
        unlock: async () => ({ status: "success", session: desktopSession }),
      }),
      biometricHost().host,
      accountStore([storedAccount(accountA)]),
      preferencePort().port,
    );

    await expect(service.unlockWithPin(accountA, "123456")).resolves.toEqual(
      desktopSession,
    );
  });

  it("sets the biometric preference only after native enable succeeds", async () => {
    const successfulBiometric = biometricHost({ enable: "enabled" });
    const preferences = preferencePort();
    const service = new UnlockMethodsService(
      pinVaultPort(),
      successfulBiometric.host,
      accountStore([storedAccount(accountA)]),
      preferences.port,
    );

    await service.enableBiometric(accountA);

    expect(preferences.writeBiometricEnabled).toHaveBeenCalledWith(accountA, true);
    expect(preferences.values.get(accountA)).toBe(true);
  });

  it("does not set the preference when native enable fails", async () => {
    const preferences = preferencePort();
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometricHost({ enable: "failed" }).host,
      accountStore([storedAccount(accountA)]),
      preferences.port,
    );

    await expect(service.enableBiometric(accountA)).rejects.toEqual(
      new AlternativeUnlockError("biometric-failed"),
    );
    expect(preferences.writeBiometricEnabled).not.toHaveBeenCalled();
  });

  it("keeps a failed preference write fail-closed when native rollback also fails", async () => {
    const biometric = biometricHost({ enable: "enabled", disable: "failed", unlock: "success" });
    const preferences = preferencePort();
    preferences.writeBiometricEnabled.mockImplementation(() => false);
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometric.host,
      accountStore([storedAccount(accountA)], {
        readSession: async () => session("must-not-restore"),
      }),
      preferences.port,
    );

    await expect(service.enableBiometric(accountA)).rejects.toEqual(
      new AlternativeUnlockError("biometric-failed"),
    );
    await expect(service.unlockWithBiometric(accountA)).rejects.toEqual(
      new AlternativeUnlockError("biometric-unavailable"),
    );
    expect(biometric.disable).toHaveBeenCalledWith(accountA);
    expect(biometric.unlock).not.toHaveBeenCalled();
  });

  it("keeps the preference when native disable fails", async () => {
    const preferences = preferencePort({ [accountA]: true });
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometricHost({ disable: "failed" }).host,
      accountStore([storedAccount(accountA)]),
      preferences.port,
    );

    await expect(service.disableBiometric(accountA)).rejects.toEqual(
      new AlternativeUnlockError("biometric-failed"),
    );
    expect(preferences.values.get(accountA)).toBe(true);
    expect(preferences.writeBiometricEnabled).not.toHaveBeenCalled();
  });

  it("can remove a stale biometric credential after the account is no longer listed", async () => {
    const biometric = biometricHost({ disable: "disabled" });
    const preferences = preferencePort({ [accountA]: true });
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometric.host,
      accountStore([storedAccount(accountB)]),
      preferences.port,
    );

    await service.disableBiometric(accountA);

    expect(biometric.disable).toHaveBeenCalledWith(accountA);
    expect(preferences.values.get(accountA)).toBe(false);
  });

  it("does not require the optional biometric store when Touch ID was never enabled", async () => {
    const biometric = biometricHost({ disable: "storage-unavailable" });
    const preferences = preferencePort({ [accountA]: false });
    const clearPinAccount = vi.fn();
    const service = new UnlockMethodsService(
      pinVaultPort({ clearAccount: clearPinAccount }),
      biometric.host,
      accountStore([storedAccount(accountA)]),
      preferences.port,
    );

    await expect(service.clearAccount(accountA)).resolves.toBeUndefined();

    expect(clearPinAccount).toHaveBeenCalledWith(accountA);
    expect(biometric.disable).not.toHaveBeenCalled();
    expect(preferences.clearAccount).toHaveBeenCalledWith(accountA);
  });

  it("erases an enabled biometric credential before clearing its preference", async () => {
    const biometric = biometricHost({ disable: "disabled" });
    const preferences = preferencePort({ [accountA]: true });
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometric.host,
      accountStore([storedAccount(accountA)]),
      preferences.port,
    );

    await service.clearAccount(accountA);

    expect(biometric.disable).toHaveBeenCalledWith(accountA);
    expect(preferences.clearAccount).toHaveBeenCalledWith(accountA);
  });

  it("allows one automatic Touch ID prompt per account lock epoch", () => {
    const service = new UnlockMethodsService(
      pinVaultPort(),
      biometricHost().host,
      accountStore([storedAccount(accountA)]),
      preferencePort().port,
    );

    expect(service.currentLockEpoch(accountA)).toBeNull();
    const firstEpoch = service.beginLockEpoch(accountA);
    expect(service.currentLockEpoch(accountA)).toBe(firstEpoch);
    expect(service.consumeAutomaticBiometricPrompt(accountA, firstEpoch)).toBe(true);
    expect(service.consumeAutomaticBiometricPrompt(accountA, firstEpoch)).toBe(false);

    const secondEpoch = service.beginLockEpoch(accountA);
    expect(secondEpoch).toBe(firstEpoch + 1);
    expect(service.currentLockEpoch(accountA)).toBe(secondEpoch);
    expect(service.consumeAutomaticBiometricPrompt(accountA, firstEpoch)).toBe(false);
    expect(service.consumeAutomaticBiometricPrompt(accountA, secondEpoch)).toBe(true);
  });
});

function pinVaultPort(overrides: Partial<RuntimePinVaultPort> = {}): RuntimePinVaultPort {
  return {
    enable: async () => undefined,
    activatePersistedPin: async () => undefined,
    unlock: async () => ({ status: "unavailable" }),
    prepareForLock: () => undefined,
    disable: async () => undefined,
    clearDerivedKey: () => undefined,
    clearAccount: async () => undefined,
    isEnabled: () => false,
    ...overrides,
  };
}

function biometricHost(overrides: {
  readonly status?: BiometricAvailability;
  readonly enable?: BiometricOperationStatus;
  readonly unlock?: BiometricOperationStatus;
  readonly disable?: BiometricOperationStatus;
} = {}) {
  const status = vi.fn(async () => overrides.status ?? "available");
  const enable = vi.fn(async () => overrides.enable ?? "enabled");
  const unlock = vi.fn(async () => overrides.unlock ?? "success");
  const disable = vi.fn(async () => overrides.disable ?? "disabled");
  const host: BiometricHost = {
    biometricStatus: status,
    biometricEnable: enable,
    biometricUnlock: unlock,
    biometricDisable: disable,
  };
  return { host, status, enable, unlock, disable };
}

function preferencePort(initial: Readonly<Record<string, boolean>> = {}) {
  const values = new Map(Object.entries(initial));
  const writeBiometricEnabled = vi.fn((id: string, enabled: boolean) => {
    values.set(id, enabled);
    return true;
  });
  const clearAccount = vi.fn((id: string) => {
    values.delete(id);
  });
  const port: BiometricPreferencePort = {
    isBiometricEnabled: (id) => values.get(id) ?? false,
    writeBiometricEnabled,
    clearAccount,
  };
  return { port, values, writeBiometricEnabled, clearAccount };
}

function accountStore(
  accounts: readonly ReturnType<typeof storedAccount>[],
  overrides: Partial<AccountSessionPort> = {},
): AccountSessionPort {
  return {
    list: async () => accounts,
    saveAccount: async () => {
      throw new Error("Unexpected saveAccount");
    },
    setActive: async () => {
      throw new Error("Unexpected setActive");
    },
    setStatus: async () => undefined,
    readSession: async () => null,
    replaceSession: async () => false,
    remove: async () => null,
    lockAll: async () => undefined,
    ...overrides,
  };
}

function storedAccount(id: string) {
  return {
    id,
    email: `${id[0]}@example.com`,
    serverUrl: `https://${id[0]}.example.com`,
    status: "locked" as const,
    isActive: id === accountA,
  };
}

function session(accessToken: string): AuthSession {
  return {
    environment: {
      apiUrl: "https://api.example.com",
      identityUrl: "https://identity.example.com",
      iconsUrl: null,
      webVaultUrl: "https://vault.example.com",
      sendUrl: null,
    },
    token: {
      accessToken,
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
}
