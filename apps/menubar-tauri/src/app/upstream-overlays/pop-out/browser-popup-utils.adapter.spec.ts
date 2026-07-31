import { describe, expect, it, vi } from "vitest";

import { TauriHostService } from "../../../host/tauri-host.service";

import BrowserPopupUtils from "./browser-popup-utils.adapter";

describe("native PopOut BrowserPopupUtils adapter", () => {
  it("passes only the local SPA hash route to the native pop_out command", async () => {
    const popOut = vi.spyOn(TauriHostService.prototype, "popOut").mockResolvedValue();
    window.history.replaceState({}, "", "/?evidence#\/tabs\/generator");

    await BrowserPopupUtils.openCurrentPagePopout(window);

    expect(popOut).toHaveBeenCalledWith("/tabs/generator");
  });

  it("falls back before the native command when the current hash is not retained", async () => {
    const popOut = vi.spyOn(TauriHostService.prototype, "popOut").mockResolvedValue();
    window.history.replaceState({}, "", "/?evidence#/attachments?token=synthetic-secret");

    await BrowserPopupUtils.openCurrentPagePopout(window);

    expect(popOut).toHaveBeenCalledWith("/tabs/vault");
  });

  it("recognizes only the official uilocation=popout state", () => {
    window.history.replaceState({}, "", "/?uilocation=popout#/tabs/vault");
    expect(BrowserPopupUtils.inPopout(window)).toBe(true);
    expect(BrowserPopupUtils.inSidebar(window)).toBe(false);
  });
});
