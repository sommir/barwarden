import "zone.js";
import "@angular/compiler";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { AlternativeUnlockError, type UnlockMethodsPort } from "../auth/unlock-methods.port";
import { PopupStateStore } from "../popup-state";
import { AccountSecurityPageComponent } from "./account-security-page.component";

const accountId = "a".repeat(64);

describe("AccountSecurityPageComponent unlock options", () => {
  afterEach(async () => {
    await new OfficialI18nService().setLocale("zh-CN");
  });

  it("opens PIN setup only after a current master-password reprompt", async () => {
    const harness = await setup();

    harness.component.requestEnablePin();

    expect(harness.reprompt.openFor).toHaveBeenCalledOnce();
    expect(harness.pinDialog.open).not.toHaveBeenCalled();
    expect(harness.unlockMethods.enablePin).not.toHaveBeenCalled();

    await harness.runRepromptContinuation();
    expect(harness.pinDialog.open).toHaveBeenCalledOnce();
    expect(harness.unlockMethods.enablePin).not.toHaveBeenCalled();

    await harness.component.completePinSetup("123456");

    expect(harness.unlockMethods.enablePin).toHaveBeenCalledWith(
      accountId,
      "123456",
      harness.session,
    );
    expect(harness.component.pinEnabled).toBe(true);
  });

  it("keeps PIN disabled and exposes a fixed error when enable fails", async () => {
    const harness = await setup();
    harness.unlockMethods.enablePin.mockRejectedValue(new Error("private failure"));
    harness.component.requestEnablePin();
    await harness.runRepromptContinuation();

    await harness.component.completePinSetup("123456");

    expect(harness.component.pinEnabled).toBe(false);
    expect(harness.component.unlockMethodError).toBe("无法设置 PIN。请重试。");
    expect(harness.component.unlockMethodError).not.toContain("private");
  });

  it("exposes account-security failures in the active English locale", async () => {
    await new OfficialI18nService().setLocale("en-US");
    const harness = await setup();
    harness.unlockMethods.enablePin.mockRejectedValue(new Error("private failure"));
    harness.component.requestEnablePin();
    await harness.runRepromptContinuation();

    await harness.component.completePinSetup("123456");

    expect(harness.component.unlockMethodError).toBe(
      "Unable to set the PIN. Try again.",
    );
  });

  it("rechecks the protected epoch before PIN setup", async () => {
    const harness = await setup();
    harness.component.requestEnablePin();
    harness.store.cancelProtectedOperations();

    await harness.runRepromptContinuation();

    expect(harness.pinDialog.open).not.toHaveBeenCalled();
    expect(harness.component.unlockMethodError).toBe(
      "账户状态已更改，请重新验证主密码。",
    );
  });

  it("enables Touch ID only after reprompt and keeps the hint false on failure", async () => {
    const harness = await setup();
    harness.unlockMethods.enableBiometric.mockRejectedValue(
      new AlternativeUnlockError("biometric-unavailable"),
    );

    harness.component.requestEnableBiometric();
    expect(harness.unlockMethods.enableBiometric).not.toHaveBeenCalled();

    await harness.runRepromptContinuation();

    expect(harness.unlockMethods.enableBiometric).toHaveBeenCalledWith(accountId);
    expect(harness.component.biometricEnabled).toBe(false);
    expect(harness.component.unlockMethodError).toBe(
      "Touch ID 当前不可用，请检查系统设置。",
    );
  });

  it("treats cancelled Touch ID setup as a silent no-op", async () => {
    const harness = await setup();
    harness.unlockMethods.enableBiometric.mockRejectedValue(
      new AlternativeUnlockError("biometric-cancelled"),
    );

    harness.component.requestEnableBiometric();
    await harness.runRepromptContinuation();

    expect(harness.component.biometricEnabled).toBe(false);
    expect(harness.component.unlockMethodError).toBe("");
  });

  it("uses the current refreshed session when PIN setup starts", async () => {
    const harness = await setup();
    const refreshed = session("refreshed");
    harness.store.setActiveSession(refreshed);

    harness.component.requestEnablePin();
    await harness.runRepromptContinuation();
    await harness.component.completePinSetup("123456");

    expect(harness.unlockMethods.enablePin).toHaveBeenCalledWith(
      accountId,
      "123456",
      refreshed,
    );
  });

  it("removes a PIN written after the protected setup context changes", async () => {
    const harness = await setup();
    const write = deferred<void>();
    harness.unlockMethods.enablePin.mockImplementation(async () => write.promise);
    harness.component.requestEnablePin();
    await harness.runRepromptContinuation();

    const completion = harness.component.completePinSetup("123456");
    await vi.waitFor(() => {
      expect(harness.unlockMethods.enablePin).toHaveBeenCalledOnce();
    });
    harness.store.cancelProtectedOperations();
    write.resolve();
    await completion;

    expect(harness.unlockMethods.disablePin).toHaveBeenCalledWith(accountId);
    expect(harness.component.pinEnabled).toBe(false);
    expect(harness.component.unlockMethodError).toBe(
      "账户状态已更改，请重新验证主密码。",
    );
  });

  it("removes Touch ID written after the protected setup context changes", async () => {
    const harness = await setup();
    const write = deferred<void>();
    harness.unlockMethods.enableBiometric.mockImplementation(
      async () => write.promise,
    );
    harness.component.requestEnableBiometric();

    const completion = harness.runRepromptContinuation();
    await vi.waitFor(() => {
      expect(harness.unlockMethods.enableBiometric).toHaveBeenCalledOnce();
    });
    harness.store.cancelProtectedOperations();
    write.resolve();
    await completion;

    expect(harness.unlockMethods.disableBiometric).toHaveBeenCalledWith(accountId);
    expect(harness.component.biometricEnabled).toBe(false);
    expect(harness.component.unlockMethodError).toBe(
      "账户状态已更改，请重新验证主密码。",
    );
  });

  it("surfaces a recoverable cleanup state when stale Touch ID rollback fails", async () => {
    const harness = await setup();
    const write = deferred<void>();
    harness.unlockMethods.enableBiometric.mockImplementation(
      async () => write.promise,
    );
    harness.unlockMethods.disableBiometric.mockRejectedValue(
      new AlternativeUnlockError("biometric-failed"),
    );
    harness.component.requestEnableBiometric();

    const completion = harness.runRepromptContinuation();
    await vi.waitFor(() => {
      expect(harness.unlockMethods.enableBiometric).toHaveBeenCalledOnce();
    });
    harness.store.cancelProtectedOperations();
    write.resolve();
    await completion;

    expect(harness.component.biometricEnabled).toBe(true);
    expect(harness.component.unlockMethodError).toBe(
      "Touch ID 已启用，但无法清理。请返回原账户后关闭 Touch ID。",
    );
  });

  it("maps Touch ID availability to a fixed disabled reason", async () => {
    const harness = await setup({
      biometricAvailability: "not-enrolled",
    });

    expect(harness.component.biometricAvailable).toBe(false);
    expect(harness.component.biometricUnavailableReason).toBe(
      "请先在系统设置中录入 Touch ID。",
    );
  });

  it("disables methods immediately only while the same account is unlocked", async () => {
    const harness = await setup({
      pinEnabled: true,
      biometricEnabled: true,
    });

    harness.component.disablePin();
    await harness.component.disableBiometric();

    expect(harness.unlockMethods.disablePin).toHaveBeenCalledWith(accountId);
    expect(harness.unlockMethods.disableBiometric).toHaveBeenCalledWith(accountId);

    harness.unlockMethods.disablePin.mockClear();
    harness.unlockMethods.disableBiometric.mockClear();
    harness.store.setLocked();
    harness.component.disablePin();
    await harness.component.disableBiometric();

    expect(harness.unlockMethods.disablePin).not.toHaveBeenCalled();
    expect(harness.unlockMethods.disableBiometric).not.toHaveBeenCalled();
  });

  it("does not disable the previous account after the active account changes", async () => {
    const harness = await setup({
      pinEnabled: true,
      biometricEnabled: true,
    });
    harness.auth.accounts.mockResolvedValue([{
      id: "b".repeat(64),
      email: "other@example.test",
      serverUrl: "https://other.example.test",
      status: "unlocked" as const,
      isActive: true,
    }]);

    harness.component.disablePin();
    await harness.component.disableBiometric();
    await Promise.resolve();

    expect(harness.unlockMethods.disablePin).not.toHaveBeenCalled();
    expect(harness.unlockMethods.disableBiometric).not.toHaveBeenCalled();
  });
});

async function setup(overrides: Partial<{
  pinEnabled: boolean;
  biometricEnabled: boolean;
  biometricAvailability: "available" | "not-enrolled" | "not-available" | "locked-out";
}> = {}) {
  const store = new PopupStateStore();
  const activeSession = session();
  store.setUnlocked("user@example.test");
  store.setActiveSession(activeSession);

  const unlockMethods = {
    availability: vi.fn(async () => ({
      pinEnabled: overrides.pinEnabled ?? false,
      biometricEnabled: overrides.biometricEnabled ?? false,
      biometricAvailability: overrides.biometricAvailability ?? "available",
    })),
    enablePin: vi.fn(async () => undefined),
    disablePin: vi.fn(),
    enableBiometric: vi.fn(async () => undefined),
    disableBiometric: vi.fn(async () => undefined),
  };
  const auth = {
    accounts: vi.fn(async () => [{
      id: accountId,
      email: "user@example.test",
      serverUrl: "https://vault.example.test",
      status: "unlocked" as const,
      isActive: true,
    }]),
  };
  const settings = {
    snapshot: () => ({
      vaultTimeoutMinutes: 5,
      vaultTimeoutAction: "lock" as const,
      biometricEnabled: false,
    }),
    setVaultTimeoutMinutes: vi.fn(),
    setVaultTimeoutAction: vi.fn(),
  };
  const component = new AccountSecurityPageComponent(
    settings as never,
    { back: vi.fn() } as never,
    { openExternal: vi.fn(), openWebVault: vi.fn() } as never,
    { reschedule: vi.fn() } as never,
    auth as never,
    store,
    unlockMethods as unknown as UnlockMethodsPort,
  );
  let continuation: (() => void | Promise<void>) | null = null;
  const reprompt = {
    operationEpoch: 0,
    openFor: vi.fn((_operation: string, next: () => void | Promise<void>) => {
      continuation = next;
      reprompt.operationEpoch = store.beginProtectedOperation();
    }),
  };
  const pinDialog = { open: vi.fn() };
  Object.assign(component as object, {
    repromptDialog: reprompt,
    pinSetupDialog: pinDialog,
  });

  await component.ngOnInit();

  return {
    component,
    store,
    session: activeSession,
    unlockMethods,
    auth,
    reprompt,
    pinDialog,
    runRepromptContinuation: async () => {
      if (!continuation) {
        throw new Error("Missing reprompt continuation");
      }
      await continuation();
    },
  };
}

function session(accessToken = "access"): AuthSession {
  return {
    environment: {
      apiUrl: "https://api.example.test",
      identityUrl: "https://identity.example.test",
      iconsUrl: null,
      webVaultUrl: "https://vault.example.test",
      sendUrl: null,
    },
    token: {
      accessToken,
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresIn: 3600,
      clientId: "browser",
    },
    crypto: {
      userKeyB64: "dXNlci1rZXk=",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
