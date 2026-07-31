import { beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserHostService } from "./browser-host.service";

describe("BrowserHostService launch at login", () => {
  it("stores and returns the last confirmed browser fallback state", async () => {
    const host = new BrowserHostService();

    await expect(host.getLaunchAtLogin()).resolves.toBe(false);
    await expect(host.setLaunchAtLogin(true)).resolves.toBe(true);
    await expect(host.getLaunchAtLogin()).resolves.toBe(true);
    await expect(host.setLaunchAtLogin(false)).resolves.toBe(false);
  });
});

describe("BrowserHostService account lock intents", () => {
  beforeEach(() => {
    localStorage.clear();
    let tail = Promise.resolve();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: {
        request: vi.fn((_name: string, operation: () => Promise<unknown>) => {
          const result = tail.then(operation);
          tail = result.then(() => undefined, () => undefined);
          return result;
        }),
      },
    });
  });

  it("serializes updates across browser host instances without losing account locks", async () => {
    const first = new BrowserHostService();
    const second = new BrowserHostService();

    await Promise.all([
      first.setAccountLockIntents(["account-one"], true),
      second.setAccountLockIntents(["account-two"], true),
    ]);

    await expect(first.getAccountLockIntents()).resolves.toEqual([
      "account-one",
      "account-two",
    ]);
  });

  it("fails closed when persisted lock intent data is malformed", async () => {
    localStorage.setItem("barwarden.account-lock-intents", "{not-json");

    await expect(new BrowserHostService().getAccountLockIntents()).rejects.toThrow();
  });

  it("keeps secure values in memory without writing them to localStorage", async () => {
    const first = new BrowserHostService();
    const second = new BrowserHostService();

    await first.secureSet("auth.account.preview", "private-session-value");

    await expect(second.secureGet("auth.account.preview")).resolves.toBe("private-session-value");
    expect(Object.keys(localStorage)).not.toContain("barwarden.secure.auth.account.preview");
    expect(JSON.stringify(localStorage)).not.toContain("private-session-value");
  });

});

describe("BrowserHostService popup size", () => {
  it("returns deterministic logical metrics without changing browser state", async () => {
    const open = vi.spyOn(window, "open");
    const host = new BrowserHostService();

    await expect(host.getPopupWindowMetrics()).resolves.toEqual({
      currentHeight: 600,
      maximumHeight: 600,
    });
    await expect(host.setPopupHeight(920)).resolves.toEqual({
      currentHeight: 600,
      maximumHeight: 600,
    });

    expect(open).not.toHaveBeenCalled();
  });
});
