import "@angular/compiler";

import { describe, expect, it, vi } from "vitest";

import type { HostApi } from "../../host/host-api";
import { SettingsService } from "./settings.service";
import { ClipboardPolicyService } from "./clipboard-policy.service";

describe("ClipboardPolicyService", () => {
  it.each([0, 10, 20, 30, 60, 120, 300] as const)(
    "passes the configured %i second clear interval to the native host",
    async (clearAfterSeconds) => {
      localStorage.clear();
      const settings = new SettingsService();
      settings.setClipboardClearSeconds(clearAfterSeconds);
      const host = { copyText: vi.fn(async () => undefined) } as unknown as HostApi;
      const service = new ClipboardPolicyService(settings, host);

      await service.copy("secret");

      expect(host.copyText).toHaveBeenCalledWith("secret", clearAfterSeconds);
    },
  );

  it("can apply the same policy to a surface-specific host adapter", async () => {
    localStorage.clear();
    const settings = new SettingsService();
    const defaultHost = { copyText: vi.fn(async () => undefined) } as unknown as HostApi;
    const surfaceHost = { copyText: vi.fn(async () => undefined) } as unknown as HostApi;
    const service = new ClipboardPolicyService(settings, defaultHost);

    await service.copy("link", surfaceHost);

    expect(surfaceHost.copyText).toHaveBeenCalledWith("link", 30);
    expect(defaultHost.copyText).not.toHaveBeenCalled();
  });
});
