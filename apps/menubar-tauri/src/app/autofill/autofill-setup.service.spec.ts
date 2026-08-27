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
  initialCleanupTarget: { readonly accountId: string | null } | null = null,
  initialOwnerAccountId: string | null = "account-a",
  accessibilityPermission: "granted" | "denied" = "granted",
  showInputFieldIcon = true,
) {
  let enabled = initialEnabled;
  let cleanupTarget = initialCleanupTarget;
  let ownerAccountId = initialOwnerAccountId;
  const storage = {
    readEnabled: vi.fn(() => enabled),
    writeEnabled: vi.fn((value) => { enabled = value; }),
    readCleanupTarget: vi.fn(() => cleanupTarget),
    writeCleanupTarget: vi.fn((value: { readonly accountId: string | null } | null) => {
      cleanupTarget = value;
    }),
  };
  const host: AutoFillSetupHost = {
    autofillAgentRegistrationStatus: vi.fn(async () => status),
    autofillAgentRegister: vi.fn(async () => "enabled"),
    autofillAgentUnregister: vi.fn(async () => "notRegistered"),
    autofillAgentProbe: vi.fn(async () => ({ status: "success" })),
    autofillAgentLock: vi.fn(async () => undefined),
    autofillClearProjection: vi.fn(async () => undefined),
  };
  const store = { snapshot: () => ({
    vaultOwnerAccountId: ownerAccountId,
    isUnlocked: ownerAccountId !== null,
  }) };
  const projection = {
    invalidateAndLock: vi.fn(async () => undefined),
    resetForReprojection: vi.fn(async () => undefined),
    reprojectCurrent: vi.fn(async () => undefined),
  };
  const accessibility = {
    status: vi.fn(async () => ({ permission: accessibilityPermission, observation: "hidden" as const })),
    requestPermissionFromUserAction: vi.fn(async () => ({
      permission: accessibilityPermission,
      observation: "hidden" as const,
    })),
    startUnsupportedFallback: vi.fn(async () => undefined),
    stopForSystemAutoFill: vi.fn(async () => undefined),
    setFloatingIconEnabled: vi.fn(async () => undefined),
  };
  return {
    service: Reflect.construct(AutoFillSetupService, [
      host,
      storage as AutoFillSetupStorage,
      store as never,
      projection as never,
      accessibility as never,
      { snapshot: () => ({ showInputFieldIcon }) },
    ]) as AutoFillSetupService,
    host,
    storage,
    projection,
    accessibility,
    setOwnerAccountId: (accountId: string | null) => { ownerAccountId = accountId; },
  };
}

describe("AutoFillSetupService", () => {
  it("activates focused-field detection after explicit AutoFill opt-in", async () => {
    const { service, accessibility } = harness(false, "enabled");

    await expect(service.enableFromEntry()).resolves.toBe("ready");

    expect(accessibility.status).toHaveBeenCalledOnce();
    expect(accessibility.requestPermissionFromUserAction).not.toHaveBeenCalled();
    expect(accessibility.startUnsupportedFallback).toHaveBeenCalledOnce();
  });

  it("keeps the picker available when optional focused-field detection remains denied", async () => {
    const { service, accessibility } = harness(false, "enabled", null, "account-a", "denied");

    await expect(service.enableFromEntry()).resolves.toBe("ready");

    expect(accessibility.requestPermissionFromUserAction).toHaveBeenCalledOnce();
    expect(accessibility.startUnsupportedFallback).not.toHaveBeenCalled();
    expect(service.blockReason()).toBe("ready");
  });

  it("resumes focused-field detection at startup without prompting", async () => {
    const { service, accessibility } = harness(true, "enabled");

    await expect(service.recoverAtStartup()).resolves.toBe("ready");

    expect(accessibility.status).toHaveBeenCalledOnce();
    expect(accessibility.requestPermissionFromUserAction).not.toHaveBeenCalled();
    expect(accessibility.startUnsupportedFallback).toHaveBeenCalledOnce();
  });

  it("republishes the unlocked vault projection when recovering an already-enabled AutoFill setup", async () => {
    const { service, projection } = harness(true, "enabled", null, "account-a");

    await expect(service.recoverAtStartup()).resolves.toBe("ready");

    expect(projection.reprojectCurrent).toHaveBeenCalledOnce();
  });

  it("synchronizes a disabled field icon without probing or requesting Accessibility permission", async () => {
    const { service, accessibility } = harness(true, "enabled", null, "account-a", "denied", false);

    await expect(service.recoverAtStartup()).resolves.toBe("ready");

    expect(accessibility.setFloatingIconEnabled).toHaveBeenCalledWith(false);
    expect(accessibility.status).not.toHaveBeenCalled();
    expect(accessibility.requestPermissionFromUserAction).not.toHaveBeenCalled();
    expect(accessibility.startUnsupportedFallback).not.toHaveBeenCalled();
  });

  it("applies an explicit icon preference immediately and resumes focused-field observation", async () => {
    const { service, accessibility } = harness(true, "enabled");

    await service.setFloatingIconPreference(false);
    expect(accessibility.setFloatingIconEnabled).toHaveBeenLastCalledWith(false);
    expect(accessibility.status).not.toHaveBeenCalled();

    await service.setFloatingIconPreference(true);
    expect(accessibility.setFloatingIconEnabled).toHaveBeenLastCalledWith(true);
    expect(accessibility.status).toHaveBeenCalledOnce();
    expect(accessibility.startUnsupportedFallback).toHaveBeenCalledOnce();
  });

  it("requests Accessibility from the explicit toggle-on action before resuming observation", async () => {
    const { service, accessibility } = harness(true, "enabled", null, "account-a", "denied");
    accessibility.requestPermissionFromUserAction.mockResolvedValue({
      permission: "granted",
      observation: "hidden",
    });

    await service.setFloatingIconPreference(true);

    expect(accessibility.setFloatingIconEnabled).toHaveBeenCalledWith(true);
    expect(accessibility.status).toHaveBeenCalledOnce();
    expect(accessibility.requestPermissionFromUserAction).toHaveBeenCalledOnce();
    expect(accessibility.startUnsupportedFallback).toHaveBeenCalledOnce();
  });

  it("does not probe Accessibility when the floating icon is enabled while AutoFill remains off", async () => {
    const { service, accessibility } = harness(false, "enabled");

    await service.setFloatingIconPreference(true);

    expect(accessibility.setFloatingIconEnabled).toHaveBeenCalledWith(true);
    expect(accessibility.status).not.toHaveBeenCalled();
    expect(accessibility.requestPermissionFromUserAction).not.toHaveBeenCalled();
    expect(accessibility.startUnsupportedFallback).not.toHaveBeenCalled();
  });

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

  it("does not report ready until the current vault projection is republished", async () => {
    const { service, projection } = harness(false, "enabled");
    let finishProjection: (() => void) | undefined;
    projection.reprojectCurrent.mockImplementation(() => new Promise<void>((resolve) => {
      finishProjection = resolve;
    }));

    let settled = false;
    const enabling = service.enableFromEntry().then((state) => {
      settled = true;
      return state;
    });
    await vi.waitFor(() => expect(projection.reprojectCurrent).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    finishProjection?.();
    await expect(enabling).resolves.toBe("ready");
  });

  it("keeps setup unavailable when the current vault projection cannot be republished", async () => {
    const { service, projection } = harness(false, "enabled");
    projection.reprojectCurrent.mockRejectedValue(new Error("private projection detail"));

    await expect(service.enableFromEntry()).resolves.toBe("unavailable");

    expect(service.blockReason()).toBe("unavailable");
  });

  it("linearizes disable behind an in-flight enable projection and never lets enable return ready", async () => {
    const { service, projection, host, storage } = harness(false, "enabled");
    const projectionGate = deferred<void>();
    projection.reprojectCurrent.mockImplementation(() => projectionGate.promise);

    const enabling = service.enableFromEntry();
    await vi.waitFor(() => expect(projection.reprojectCurrent).toHaveBeenCalledOnce());
    const disabling = service.disable();
    expect(storage.writeEnabled).toHaveBeenLastCalledWith(false);
    expect(host.autofillAgentLock).not.toHaveBeenCalled();

    projectionGate.resolve();
    await expect(enabling).resolves.toBe("disabled");
    await disabling;
    expect(host.autofillAgentLock).toHaveBeenCalledOnce();
    expect(service.blockReason()).toBe("disabled");
  });

  it("recovers an enabled feature after update/restart using status, registration, then probe", async () => {
    const { service, host } = harness(true, "notRegistered");

    await expect(service.recoverAtStartup()).resolves.toBe("ready");

    expect(host.autofillAgentRegistrationStatus).toHaveBeenCalledOnce();
    expect(host.autofillAgentRegister).toHaveBeenCalledOnce();
    expect(host.autofillAgentProbe).toHaveBeenCalledOnce();
  });

  it("replaces a stale enabled Agent registration after an app update", async () => {
    const { service, host } = harness(true, "enabled");
    host.autofillAgentProbe
      .mockRejectedValueOnce(new Error("stale Agent protocol"))
      .mockResolvedValueOnce({ status: "success" });

    await expect(service.recoverAtStartup()).resolves.toBe("ready");

    expect(host.autofillAgentUnregister).toHaveBeenCalledOnce();
    expect(host.autofillAgentRegister).toHaveBeenCalledOnce();
    expect(host.autofillAgentProbe).toHaveBeenCalledTimes(2);
    expect(host.autofillAgentUnregister.mock.invocationCallOrder[0]).toBeLessThan(
      host.autofillAgentRegister.mock.invocationCallOrder[0],
    );
    expect(host.autofillAgentRegister.mock.invocationCallOrder[0]).toBeLessThan(
      host.autofillAgentProbe.mock.invocationCallOrder[1],
    );
  });

  it("accepts an authenticated live Agent when Service Management still reports notFound", async () => {
    const { service, host } = harness(false, "notFound");
    host.autofillAgentRegister.mockResolvedValue("notFound");

    await expect(service.enableFromEntry()).resolves.toBe("ready");

    expect(host.autofillAgentRegister).toHaveBeenCalledOnce();
    expect(host.autofillAgentProbe).toHaveBeenCalledOnce();
  });

  it("uses the authenticated Agent probe when registration returns a transient error", async () => {
    const { service, host } = harness(false, "notRegistered");
    host.autofillAgentRegister.mockRejectedValue(new Error("private Service Management detail"));

    await expect(service.enableFromEntry()).resolves.toBe("ready");

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
    const { service, host, storage, accessibility } = harness(true, "enabled");

    await service.disable();

    expect(storage.writeEnabled).toHaveBeenCalledWith(false);
    expect(storage.writeCleanupTarget).toHaveBeenNthCalledWith(1, { accountId: "account-a" });
    expect(storage.writeEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      storage.writeCleanupTarget.mock.invocationCallOrder[0],
    );
    expect(storage.writeCleanupTarget.mock.invocationCallOrder[0]).toBeLessThan(
      host.autofillAgentLock.mock.invocationCallOrder[0],
    );
    expect(storage.writeCleanupTarget).toHaveBeenLastCalledWith(null);
    expect(accessibility.stopForSystemAutoFill).toHaveBeenCalledOnce();
    expect(accessibility.stopForSystemAutoFill.mock.invocationCallOrder[0]).toBeLessThan(
      host.autofillAgentLock.mock.invocationCallOrder[0],
    );
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
    expect(storage.writeCleanupTarget).toHaveBeenCalledWith({ accountId: "account-a" });
    expect(storage.writeCleanupTarget).not.toHaveBeenCalledWith(null);
    expect(host.autofillAgentLock).toHaveBeenCalledOnce();
    expect(host.autofillAgentUnregister).toHaveBeenCalledOnce();
  });

  it("retries pending lock-clear-unregister cleanup at startup before doing any registration", async () => {
    const { service, host, storage } = harness(
      false,
      "notRegistered",
      { accountId: "account-a" },
      null,
    );

    await expect(service.recoverAtStartup()).resolves.toBe("disabled");

    expect(host.autofillAgentLock).toHaveBeenCalledOnce();
    expect(host.autofillClearProjection).toHaveBeenCalledWith("account-a");
    expect(host.autofillAgentUnregister).toHaveBeenCalledOnce();
    expect(storage.writeCleanupTarget).toHaveBeenLastCalledWith(null);
    expect(host.autofillAgentRegistrationStatus).not.toHaveBeenCalled();
    expect(host.autofillAgentProbe).not.toHaveBeenCalled();
  });

  it("temporarily restarts a missing Agent when interrupted cleanup must be completed", async () => {
    const { service, host, storage } = harness(
      false,
      "notRegistered",
      { accountId: "account-a" },
      null,
    );
    host.autofillAgentLock.mockRejectedValueOnce(new Error("Agent unavailable"));

    await expect(service.recoverAtStartup()).resolves.toBe("disabled");

    expect(host.autofillAgentLock).toHaveBeenCalledTimes(2);
    expect(host.autofillClearProjection).toHaveBeenCalledTimes(2);
    expect(host.autofillAgentUnregister).toHaveBeenCalledTimes(2);
    expect(host.autofillAgentRegister).toHaveBeenCalledOnce();
    expect(host.autofillAgentProbe).toHaveBeenCalledOnce();
    expect(host.autofillAgentUnregister.mock.invocationCallOrder[0]).toBeLessThan(
      host.autofillAgentRegister.mock.invocationCallOrder[0],
    );
    expect(host.autofillAgentRegister.mock.invocationCallOrder[0]).toBeLessThan(
      host.autofillAgentLock.mock.invocationCallOrder[1],
    );
    expect(storage.writeCleanupTarget).toHaveBeenLastCalledWith(null);
  });

  it("resumes focused-field detection while an enabled locked vault awaits reprojection", async () => {
    const { service, host, storage, projection } = harness(
      true,
      "enabled",
      { accountId: "account-a" },
      null,
    );
    host.autofillAgentUnregister.mockRejectedValue(new Error("Service Management unavailable"));

    await expect(service.recoverAtStartup()).resolves.toBe("ready");

    expect(projection.resetForReprojection).toHaveBeenCalledOnce();
    expect(projection.invalidateAndLock).not.toHaveBeenCalled();
    expect(host.autofillAgentLock).not.toHaveBeenCalled();
    expect(host.autofillClearProjection).not.toHaveBeenCalled();
    expect(host.autofillAgentUnregister).not.toHaveBeenCalled();
    expect(storage.writeCleanupTarget).not.toHaveBeenCalledWith(null);
    expect(projection.reprojectCurrent).not.toHaveBeenCalled();
  });

  it("clears the enabled cleanup marker only after an unlocked reprojection succeeds", async () => {
    const { service, host, storage, projection } = harness(
      true,
      "enabled",
      { accountId: "account-a" },
      "account-a",
    );

    await expect(service.recoverAtStartup()).resolves.toBe("ready");

    expect(projection.resetForReprojection).toHaveBeenCalledOnce();
    expect(projection.invalidateAndLock).not.toHaveBeenCalled();
    expect(host.autofillAgentLock).not.toHaveBeenCalled();
    expect(projection.reprojectCurrent).toHaveBeenCalledOnce();
    expect(storage.writeCleanupTarget).toHaveBeenLastCalledWith(null);
  });

  it("resets and republishes the core projection even when optional floating fallback cleanup fails", async () => {
    const { service, storage, projection, accessibility } = harness(
      true,
      "enabled",
      { accountId: "account-a" },
      "account-a",
    );
    accessibility.stopForSystemAutoFill.mockRejectedValueOnce(new Error("private AX detail"));

    await expect(service.enableFromEntry()).resolves.toBe("ready");

    expect(projection.resetForReprojection).toHaveBeenCalledOnce();
    expect(projection.reprojectCurrent).toHaveBeenCalledOnce();
    expect(storage.writeCleanupTarget).toHaveBeenLastCalledWith(null);
  });

  it("retries the persisted original target after failure even when another account becomes current", async () => {
    const { service, host, storage, setOwnerAccountId } = harness(true, "enabled");
    host.autofillClearProjection.mockRejectedValueOnce(new Error("private native detail"));

    await expect(service.disable()).rejects.toThrow("AUTOFILL_CLEANUP_PENDING");
    setOwnerAccountId("account-b");
    await expect(service.recoverAtStartup()).resolves.toBe("disabled");

    expect(host.autofillClearProjection).toHaveBeenNthCalledWith(1, "account-a");
    expect(host.autofillClearProjection).toHaveBeenNthCalledWith(2, "account-a");
    expect(host.autofillClearProjection).not.toHaveBeenCalledWith("account-b");
    expect(storage.writeCleanupTarget).toHaveBeenLastCalledWith(null);
  });

  it("keeps an incomplete marker fail-closed when its target account is missing", async () => {
    const { service, host, storage } = harness(
      false,
      "notRegistered",
      { accountId: null },
      "account-b",
    );

    await expect(service.recoverAtStartup()).resolves.toBe("unavailable");

    expect(host.autofillAgentLock).toHaveBeenCalledOnce();
    expect(host.autofillClearProjection).not.toHaveBeenCalled();
    expect(host.autofillAgentUnregister).toHaveBeenCalledOnce();
    expect(storage.writeCleanupTarget).not.toHaveBeenCalledWith(null);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((completion) => { resolve = completion; });
  return { promise, resolve };
}
