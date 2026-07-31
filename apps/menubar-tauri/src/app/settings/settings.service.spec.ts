import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OfficialI18nService, resolveOfficialLocale } from "../official-ui/official-i18n.service";
import { accountSettingsStorageKey, SettingsService } from "./settings.service";

const accountA = "a".repeat(64);
const accountB = "b".repeat(64);

describe("SettingsService", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.bwTheme;
    delete document.documentElement.dataset.bwCompactMode;
    delete document.documentElement.dataset.bwAnimations;
    document.documentElement.classList.remove("theme_dark");
    document.body.classList.remove("tw-bit-compact");
  });

  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.bwTheme;
    delete document.documentElement.dataset.bwCompactMode;
    delete document.documentElement.dataset.bwAnimations;
    document.documentElement.classList.remove("theme_dark");
    document.body.classList.remove("tw-bit-compact");
  });

  it("stores supported settings in memory", () => {
    const service = new SettingsService();

    service.setClipboardClearSeconds(60);
    service.setFillMode("clipboard-paste");
    service.setTheme("system");
    service.setCompactMode(true);
    service.setAnimations(false);
    service.setShowFavicons(false);
    service.setShowQuickCopyActions(false);
    service.setVaultTimeoutMinutes(15);
    service.setVaultTimeoutAction("logout");

    expect(service.snapshot()).toEqual({
      animations: false,
      clipboardClearSeconds: 60,
      compactMode: true,
      fillMode: "clipboard-paste",
      language: null,
      showFavicons: false,
      showQuickCopyActions: false,
      theme: "system",
      vaultTimeoutMinutes: 15,
      vaultTimeoutAction: "logout",
      biometricEnabled: false,
    });
  });

  it("persists an explicit language choice and applies it immediately", () => {
    const i18n = new OfficialI18nService();
    const settings = new SettingsService(i18n);

    settings.setLanguage("en-US");

    expect(settings.snapshot().language).toBe("en-US");
    expect(i18n.translationLocale).toBe("en-US");
    expect(JSON.parse(localStorage.getItem("barwarden.settings") ?? "{}")).toMatchObject({
      language: "en-US",
    });
  });

  it("clears the language override and restores the system language", () => {
    const i18n = new OfficialI18nService();
    const settings = new SettingsService(i18n);
    settings.setLanguage("en-US");

    settings.setLanguage(null);

    expect(settings.snapshot().language).toBeNull();
    expect(i18n.translationLocale).toBe(resolveOfficialLocale(globalThis.navigator?.language));
    expect(JSON.parse(localStorage.getItem("barwarden.settings") ?? "{}")).toMatchObject({
      language: null,
    });
  });

  it("persists only the biometric hint per account and never stores PIN state", () => {
    const settings = new SettingsService();
    settings.useAccount(accountA);
    expect(settings.snapshot().biometricEnabled).toBe(false);
    expect(settings.setBiometricEnabled(true)).toBe(true);

    settings.useAccount(accountB);
    expect(settings.snapshot().biometricEnabled).toBe(false);

    const restored = new SettingsService();
    restored.useAccount(accountA);
    expect(restored.snapshot().biometricEnabled).toBe(true);
    expect(restored.isBiometricEnabled(accountA)).toBe(true);
    const stored = localStorage.getItem(accountSettingsStorageKey(accountA)) ?? "";
    expect(stored).not.toContain("pin");
    expect(JSON.parse(stored)).toEqual({
      vaultTimeoutMinutes: 5,
      vaultTimeoutAction: "lock",
      biometricEnabled: true,
    });
  });

  it("writes and clears biometric preferences only for canonical account IDs", () => {
    const settings = new SettingsService();

    expect(settings.writeBiometricEnabled("account-a", true)).toBe(false);
    expect(settings.isBiometricEnabled("account-a")).toBe(false);
    expect(settings.writeBiometricEnabled(accountA, true)).toBe(true);
    expect(settings.writeBiometricEnabled(accountB, true)).toBe(true);

    settings.clearAccount(accountA);

    expect(settings.isBiometricEnabled(accountA)).toBe(false);
    expect(settings.isBiometricEnabled(accountB)).toBe(true);
    expect(localStorage.getItem(accountSettingsStorageKey(accountA))).toBeNull();
  });

  it("does not update the biometric hint when account persistence fails", () => {
    const settings = new SettingsService();
    settings.useAccount(accountA);
    const failedStorage = Object.create(localStorage) as Storage;
    failedStorage.setItem = () => {
      throw new Error("storage unavailable");
    };
    vi.stubGlobal("localStorage", failedStorage);

    try {
      expect(settings.setBiometricEnabled(true)).toBe(false);
      expect(settings.snapshot().biometricEnabled).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails account cleanup when persisted security settings cannot be removed", () => {
    const settings = new SettingsService();
    settings.useAccount(accountA);
    expect(settings.setBiometricEnabled(true)).toBe(true);
    const failedStorage = Object.create(localStorage) as Storage;
    failedStorage.removeItem = () => {
      throw new Error("private storage failure");
    };
    vi.stubGlobal("localStorage", failedStorage);

    try {
      expect(() => settings.clearAccount(accountA)).toThrow("account-settings-unavailable");
      expect(settings.snapshot().biometricEnabled).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(["clipboard-copy", "clipboard-paste"] as const)(
    "persists the %s single-field fill mode",
    (fillMode) => {
      const service = new SettingsService();

      service.setFillMode(fillMode);

      expect(new SettingsService().snapshot().fillMode).toBe(fillMode);
    },
  );

  it("rejects clipboard clear delays outside the official fixed choices", () => {
    localStorage.setItem(
      "barwarden.settings",
      JSON.stringify({ clipboardClearSeconds: 45 }),
    );

    const service = new SettingsService();
    expect(service.snapshot().clipboardClearSeconds).toBe(30);

    service.setClipboardClearSeconds(60);
    service.setClipboardClearSeconds(45);
    expect(service.snapshot().clipboardClearSeconds).toBe(60);
  });

  it("keeps vault timeout preferences isolated per account", () => {
    const service = new SettingsService();
    service.useAccount("account-a");
    service.setVaultTimeoutMinutes(15);
    service.setVaultTimeoutAction("logout");

    service.useAccount("account-b");
    expect(service.snapshot()).toMatchObject({ vaultTimeoutMinutes: 5, vaultTimeoutAction: "lock" });
    service.setVaultTimeoutMinutes(30);

    service.useAccount("account-a");
    expect(service.snapshot()).toMatchObject({ vaultTimeoutMinutes: 15, vaultTimeoutAction: "logout" });

    const restored = new SettingsService();
    restored.useAccount("account-b");
    expect(restored.snapshot()).toMatchObject({ vaultTimeoutMinutes: 30, vaultTimeoutAction: "lock" });
  });

  it("does not apply account timeout settings when local storage persistence fails", () => {
    const service = new SettingsService();
    service.useAccount("account-a");
    const failedStorage = Object.create(localStorage) as Storage;
    failedStorage.setItem = () => {
      throw new Error("storage unavailable");
    };
    vi.stubGlobal("localStorage", failedStorage);

    try {
      expect(service.setVaultTimeoutMinutes(15)).toBe(false);
      expect(service.snapshot()).toMatchObject({ vaultTimeoutMinutes: 5, vaultTimeoutAction: "lock" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("drops browser-only settings and invalid timeouts during restore and persistence", () => {
    localStorage.setItem(
      "barwarden.settings",
      JSON.stringify({
        blockedDomains: ["example.test"],
        excludedDomains: ["example.test"],
        vaultTimeoutMinutes: 999,
        vaultTimeoutAction: "logout",
        theme: "dark",
      }),
    );

    const service = new SettingsService();

    expect(service.snapshot()).toMatchObject({ theme: "dark", vaultTimeoutMinutes: 5 });
    expect(service.snapshot()).not.toHaveProperty("blockedDomains");
    expect(service.snapshot()).not.toHaveProperty("excludedDomains");

    service.setCompactMode(true);

    expect(JSON.parse(localStorage.getItem("barwarden.settings") ?? "{}")).toEqual({
      animations: true,
      clipboardClearSeconds: 30,
      compactMode: true,
      fillMode: "clipboard-paste",
      language: null,
      showFavicons: true,
      showQuickCopyActions: true,
      theme: "dark",
    });
  });

  it("persists global settings separately from validated account timeout settings", () => {
    const original = new SettingsService();
    original.setTheme("dark");
    original.useAccount("account-a");
    original.setVaultTimeoutMinutes(15);
    original.setVaultTimeoutAction("logout");

    const restored = new SettingsService();
    expect(restored.snapshot()).toMatchObject({
      theme: "dark",
      vaultTimeoutMinutes: 5,
      vaultTimeoutAction: "lock",
    });

    restored.useAccount("account-a");
    expect(restored.snapshot()).toMatchObject({
      theme: "dark",
      vaultTimeoutMinutes: 15,
      vaultTimeoutAction: "logout",
    });
    expect(JSON.parse(localStorage.getItem("barwarden.settings") ?? "{}")).not.toHaveProperty(
      "vaultTimeoutMinutes",
    );

    localStorage.setItem(
      accountSettingsStorageKey("account-b"),
      JSON.stringify({ vaultTimeoutMinutes: 999, vaultTimeoutAction: "logout" }),
    );
    restored.useAccount("account-b");
    expect(restored.snapshot()).toMatchObject({ vaultTimeoutMinutes: 5, vaultTimeoutAction: "logout" });
  });

  it("enables favicons by default for new and previously stored settings", () => {
    expect(new SettingsService().snapshot().showFavicons).toBe(true);

    localStorage.setItem(
      "barwarden.settings",
      JSON.stringify({ theme: "dark", showQuickCopyActions: false }),
    );

    expect(new SettingsService().snapshot()).toMatchObject({
      showFavicons: true,
      showQuickCopyActions: false,
      theme: "dark",
    });
  });

  it("restores and persists the favicon setting", () => {
    localStorage.setItem(
      "barwarden.settings",
      JSON.stringify({ showFavicons: false }),
    );
    const service = new SettingsService();

    expect(service.snapshot().showFavicons).toBe(false);

    service.setShowFavicons(true);

    expect(JSON.parse(localStorage.getItem("barwarden.settings") ?? "{}")).toMatchObject({
      showFavicons: true,
    });
  });

  it("restores supported appearance settings from local storage and applies them to the document root", () => {
    localStorage.setItem(
      "barwarden.settings",
      JSON.stringify({
        animations: false,
        clipboardClearSeconds: 60,
        compactMode: true,
        fillMode: "clipboard-paste",
        showFavicons: false,
        showQuickCopyActions: false,
        theme: "dark",
        vaultTimeoutMinutes: 15,
      }),
    );

    const service = new SettingsService();

    expect(service.snapshot()).toMatchObject({
      animations: false,
      compactMode: true,
      showFavicons: false,
      showQuickCopyActions: false,
      theme: "dark",
    });
    expect(document.documentElement.dataset.bwTheme).toBe("dark");
    expect(document.documentElement.dataset.bwCompactMode).toBe("true");
    expect(document.documentElement.dataset.bwAnimations).toBe("false");
    expect(document.documentElement.classList.contains("theme_dark")).toBe(true);
    expect(document.body.classList.contains("tw-bit-compact")).toBe(true);
  });

  it("persists appearance setting changes and keeps the document root in sync", () => {
    const service = new SettingsService();

    service.setTheme("light");
    service.setCompactMode(true);
    service.setAnimations(false);
    service.setShowFavicons(false);
    service.setShowQuickCopyActions(false);

    const stored = JSON.parse(localStorage.getItem("barwarden.settings") ?? "{}");
    expect(stored).toMatchObject({
      animations: false,
      compactMode: true,
      showFavicons: false,
      showQuickCopyActions: false,
      theme: "light",
    });
    expect(document.documentElement.dataset.bwTheme).toBe("light");
    expect(document.documentElement.dataset.bwCompactMode).toBe("true");
    expect(document.documentElement.dataset.bwAnimations).toBe("false");
    expect(document.documentElement.classList.contains("theme_dark")).toBe(false);
    expect(document.body.classList.contains("tw-bit-compact")).toBe(true);
  });

  it("tracks system theme changes once and detaches them for explicit themes or cleanup", () => {
    let dark = false;
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const addEventListener = vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    });
    const removeEventListener = vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    });
    const query = {
      get matches() { return dark; },
      addEventListener,
      removeEventListener,
    };
    vi.stubGlobal("matchMedia", vi.fn(() => query));
    localStorage.setItem("barwarden.settings", JSON.stringify({ theme: "system" }));

    const service = new SettingsService();
    expect(document.documentElement.classList.contains("theme_dark")).toBe(false);
    expect(addEventListener).toHaveBeenCalledTimes(1);

    dark = true;
    listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
    expect(document.documentElement.classList.contains("theme_dark")).toBe(true);

    dark = false;
    listeners.forEach((listener) => listener({ matches: false } as MediaQueryListEvent));
    expect(document.documentElement.classList.contains("theme_dark")).toBe(false);

    service.setTheme("dark");
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    dark = false;
    listeners.forEach((listener) => listener({ matches: false } as MediaQueryListEvent));
    expect(document.documentElement.classList.contains("theme_dark")).toBe(true);

    service.setTheme("system");
    service.setTheme("system");
    expect(addEventListener).toHaveBeenCalledTimes(2);
    service.ngOnDestroy();
    expect(removeEventListener).toHaveBeenCalledTimes(2);
  });

});
