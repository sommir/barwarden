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

  it("captures the explicit trigger or the active element when presented", () => {
    const service = new AccessibilityPermissionDialogService({ openUrl: vi.fn() });
    const explicitTrigger = document.createElement("button");
    const activeTrigger = document.createElement("button");
    document.body.append(explicitTrigger, activeTrigger);

    service.present(explicitTrigger);
    expect(service.trigger()).toBe(explicitTrigger);

    activeTrigger.focus();
    service.present();
    expect(service.trigger()).toBe(activeTrigger);

    explicitTrigger.remove();
    activeTrigger.remove();
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
});
