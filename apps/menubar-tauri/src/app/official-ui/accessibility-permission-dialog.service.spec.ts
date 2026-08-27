import { describe, expect, it, vi } from "vitest";

import {
  ACCESSIBILITY_SETTINGS_URL,
  AccessibilityPermissionDialogService,
} from "./accessibility-permission-dialog.service";

describe("AccessibilityPermissionDialogService", () => {
  it("opens the dedicated macOS Accessibility pane only after the user requests it", async () => {
    const host = { openUrl: vi.fn(async () => undefined) };
    const service = new AccessibilityPermissionDialogService(host);

    service.present();
    expect(service.isOpen()).toBe(true);
    expect(host.openUrl).not.toHaveBeenCalled();

    await service.openSystemSettings();

    expect(host.openUrl).toHaveBeenCalledOnce();
    expect(host.openUrl).toHaveBeenCalledWith(ACCESSIBILITY_SETTINGS_URL);
    expect(service.isOpen()).toBe(false);
  });

  it("keeps the request open and explains when macOS cannot launch Settings", async () => {
    const host = { openUrl: vi.fn(async () => { throw new Error("launch failed"); }) };
    const service = new AccessibilityPermissionDialogService(host);

    service.present();
    await service.openSystemSettings();

    expect(service.isOpen()).toBe(true);
    expect(service.launchFailed()).toBe(true);
  });

  it("captures the explicit trigger or the active element for a new presentation", () => {
    const explicitTrigger = document.createElement("button");
    const activeTrigger = document.createElement("button");
    document.body.append(explicitTrigger, activeTrigger);

    const explicitService = new AccessibilityPermissionDialogService({ openUrl: vi.fn() });
    explicitService.present(explicitTrigger);
    expect(explicitService.trigger()).toBe(explicitTrigger);

    activeTrigger.focus();
    const activeService = new AccessibilityPermissionDialogService({ openUrl: vi.fn() });
    activeService.present();
    expect(activeService.trigger()).toBe(activeTrigger);

    explicitTrigger.remove();
    activeTrigger.remove();
  });

  it("keeps the original trigger until the sheet closes, then accepts a new presentation", () => {
    const service = new AccessibilityPermissionDialogService({ openUrl: vi.fn() });
    const firstTrigger = document.createElement("button");
    const secondTrigger = document.createElement("button");

    service.present(firstTrigger);
    service.present(secondTrigger);
    expect(service.trigger()).toBe(firstTrigger);

    service.dismiss();
    service.present(secondTrigger);
    expect(service.isOpen()).toBe(false);
    expect(service.trigger()).toBe(firstTrigger);

    service.sheetClosed();
    expect(service.trigger()).toBeNull();
    service.present(secondTrigger);
    expect(service.isOpen()).toBe(true);
    expect(service.trigger()).toBe(secondTrigger);
  });

  it("exposes the presentation trigger without a public mutation API", () => {
    const service = new AccessibilityPermissionDialogService({ openUrl: vi.fn() });

    expect("set" in service.trigger).toBe(false);
  });

  it("rejects dismissal while System Settings is opening", async () => {
    let finishOpening!: () => void;
    const host = {
      openUrl: vi.fn(() => new Promise<void>((resolve) => {
        finishOpening = resolve;
      })),
    };
    const service = new AccessibilityPermissionDialogService(host);

    service.present();
    const opening = service.openSystemSettings();
    service.dismiss();

    expect(service.isOpen()).toBe(true);
    finishOpening();
    await opening;
  });

  it("ignores a stale Settings resolve after a later presentation starts", async () => {
    const firstOpening = deferred();
    const secondOpening = deferred();
    const host = {
      openUrl: vi.fn()
        .mockImplementationOnce(() => firstOpening.promise)
        .mockImplementationOnce(() => secondOpening.promise),
    };
    const service = new AccessibilityPermissionDialogService(host);
    const firstTrigger = document.createElement("button");
    const secondTrigger = document.createElement("button");

    service.present(firstTrigger);
    const firstRequest = service.openSystemSettings();
    service.sheetClosed();
    service.present(secondTrigger);
    const secondRequest = service.openSystemSettings();

    firstOpening.resolve();
    await firstRequest;
    expect(service.isOpen()).toBe(true);
    expect(service.openingSettings()).toBe(true);
    expect(service.launchFailed()).toBe(false);
    expect(service.trigger()).toBe(secondTrigger);

    secondOpening.resolve();
    await secondRequest;
  });

  it("ignores a stale Settings rejection after a later presentation starts", async () => {
    const firstOpening = deferred();
    const secondOpening = deferred();
    const host = {
      openUrl: vi.fn()
        .mockImplementationOnce(() => firstOpening.promise)
        .mockImplementationOnce(() => secondOpening.promise),
    };
    const service = new AccessibilityPermissionDialogService(host);
    const firstTrigger = document.createElement("button");
    const secondTrigger = document.createElement("button");

    service.present(firstTrigger);
    const firstRequest = service.openSystemSettings();
    service.sheetClosed();
    service.present(secondTrigger);
    const secondRequest = service.openSystemSettings();

    firstOpening.reject(new Error("stale native failure"));
    await firstRequest;
    expect(service.isOpen()).toBe(true);
    expect(service.openingSettings()).toBe(true);
    expect(service.launchFailed()).toBe(false);
    expect(service.trigger()).toBe(secondTrigger);

    secondOpening.resolve();
    await secondRequest;
  });
});

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
