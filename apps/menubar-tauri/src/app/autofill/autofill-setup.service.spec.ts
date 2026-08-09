import "@angular/compiler";

import { describe, expect, it, vi } from "vitest";

import {
  AutoFillSetupService,
  type AutoFillSetupHost,
  type AutoFillSetupStorage,
} from "./autofill-setup.service";

function harness(
  initialEnabled = false,
  status: "notRegistered" | "enabled" | "requiresApproval" | "notFound" = "notRegistered",
  initialCleanupPending = false,
) {
  let enabled = initialEnabled;
  let cleanupPending = initialCleanupPending;
  const storage = {
    readEnabled: vi.fn(() => enabled),
    writeEnabled: vi.fn((value) => { enabled = value; }),
    readCleanupPending: vi.fn(() => cleanupPending),
    writeCleanupPending: vi.fn((value: boolean) => { cleanupPending = value; }),
  };
  const host: AutoFillSetupHost = {
    autofillAgentRegistrationStatus: vi.fn(async () => status),
    autofillAgentRegister: vi.fn(async () => "enabled"),
    autofillAgentUnregister: vi.fn(async () => "notRegistered"),
    autofillAgentProbe: vi.fn(async () => ({ status: "success" })),
    autofillAgentLock: vi.fn(async () => undefined),
    autofillClearProjection: vi.fn(async () => undefined),
  };
  const store = { snapshot: () => ({ vaultOwnerAccountId: "account-a" }) };
  return {
    service: new AutoFillSetupService(host, storage as AutoFillSetupStorage, store as never),
    host,
    storage,
  };
}

describe("AutoFillSetupService", () => {
  it("persists first-use opt-in, registers a fresh install, and probes before becoming ready", async () => {
    const { service, host, storage } = harness();

    await expect(service.enableFromEntry()).resolves.toBe("ready");

    expect(storage.writeEnabled).toHaveBeenCalledWith(true);
    expect(host.autofillAgentRegistrationStatus).toHaveBeenCalledOnce();
    expect(host.autofillAgentRegister).toHaveBeenCalledOnce();
    expect(host.autofillAgentProbe).toHaveBeenCalledOnce();
    expect(host.autofillAgentRegister.mock.invocationCallOrder[0]).toBeLessThan(
      host.autofillAgentProbe.mock.invocationCallOrder[0],
    );
  });

  it("recovers an enabled feature after update/restart using status, registration, then probe", async () => {
    const { service, host } = harness(true, "notRegistered");

    await expect(service.recoverAtStartup()).resolves.toBe("ready");

    expect(host.autofillAgentRegistrationStatus).toHaveBeenCalledOnce();
    expect(host.autofillAgentRegister).toHaveBeenCalledOnce();
    expect(host.autofillAgentProbe).toHaveBeenCalledOnce();
  });

  it("does nothing at startup until a dedicated AutoFill entry opts in", async () => {
    const { service, host } = harness(false);

    await expect(service.recoverAtStartup()).resolves.toBe("disabled");

    expect(host.autofillAgentRegistrationStatus).not.toHaveBeenCalled();
    expect(host.autofillAgentRegister).not.toHaveBeenCalled();
    expect(host.autofillAgentProbe).not.toHaveBeenCalled();
  });

  it("surfaces requiresApproval without probing or allowing a secret query", async () => {
    const { service, host } = harness(false, "requiresApproval");

    await expect(service.enableFromEntry()).resolves.toBe("requiresApproval");

    expect(service.blockReason()).toBe("requiresApproval");
    expect(host.autofillAgentRegister).not.toHaveBeenCalled();
    expect(host.autofillAgentProbe).not.toHaveBeenCalled();
  });

  it("disables fail-closed by clearing the flag, locking, clearing the account, and unregistering", async () => {
    const { service, host, storage } = harness(true, "enabled");

    await service.disable();

    expect(storage.writeEnabled).toHaveBeenCalledWith(false);
    expect(host.autofillAgentLock).toHaveBeenCalledOnce();
    expect(host.autofillClearProjection).toHaveBeenCalledWith("account-a");
    expect(host.autofillAgentUnregister).toHaveBeenCalledOnce();
    expect(service.blockReason()).toBe("disabled");
  });

  it("finishes disable cleanup in lock, clear, unregister order", async () => {
    const { service, host } = harness(true, "enabled");
    let finishLock: (() => void) | undefined;
    host.autofillAgentLock.mockImplementation(() => new Promise((resolve) => {
      finishLock = () => resolve(undefined);
    }));

    const disabling = service.disable();
    await vi.waitFor(() => expect(host.autofillAgentLock).toHaveBeenCalledOnce());
    expect(host.autofillClearProjection).not.toHaveBeenCalled();
    expect(host.autofillAgentUnregister).not.toHaveBeenCalled();

    finishLock?.();
    await disabling;
    expect(host.autofillAgentLock.mock.invocationCallOrder[0]).toBeLessThan(
      host.autofillClearProjection.mock.invocationCallOrder[0],
    );
    expect(host.autofillClearProjection.mock.invocationCallOrder[0]).toBeLessThan(
      host.autofillAgentUnregister.mock.invocationCallOrder[0],
    );
  });

  it("attempts clear and unregister even if lock fails", async () => {
    const { service, host } = harness(true, "enabled");
    host.autofillAgentLock.mockRejectedValue(new Error("lock failed"));

    await expect(service.disable()).rejects.toThrow("AUTOFILL_CLEANUP_PENDING");

    expect(host.autofillClearProjection).toHaveBeenCalledWith("account-a");
    expect(host.autofillAgentUnregister).toHaveBeenCalledOnce();
  });

  it("persists cleanup pending and exposes only a fixed failure when any disable step fails", async () => {
    const { service, host, storage } = harness(true, "enabled");
    host.autofillClearProjection.mockRejectedValue(new Error("private native detail"));

    await expect(service.disable()).rejects.toThrow("AUTOFILL_CLEANUP_PENDING");

    expect(storage.writeEnabled).toHaveBeenCalledWith(false);
    expect(storage.writeCleanupPending).toHaveBeenCalledWith(true);
    expect(storage.writeCleanupPending).not.toHaveBeenCalledWith(false);
    expect(host.autofillAgentLock).toHaveBeenCalledOnce();
    expect(host.autofillAgentUnregister).toHaveBeenCalledOnce();
  });

  it("retries pending lock-clear-unregister cleanup at startup before doing any registration", async () => {
    const { service, host, storage } = harness(false, "notRegistered", true);

    await expect(service.recoverAtStartup()).resolves.toBe("disabled");

    expect(host.autofillAgentLock).toHaveBeenCalledOnce();
    expect(host.autofillClearProjection).toHaveBeenCalledWith("account-a");
    expect(host.autofillAgentUnregister).toHaveBeenCalledOnce();
    expect(storage.writeCleanupPending).toHaveBeenLastCalledWith(false);
    expect(host.autofillAgentRegistrationStatus).not.toHaveBeenCalled();
    expect(host.autofillAgentProbe).not.toHaveBeenCalled();
  });
});
