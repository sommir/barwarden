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
});
