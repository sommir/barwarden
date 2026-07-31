import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";
import { VaultTimeoutService } from "./vault-timeout.service";

describe("VaultTimeoutService", () => {
  beforeEach(async () => {
    await new OfficialI18nService().setLocale("en-US");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("locks the vault after the configured timeout while unlocked", () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const settings = new SettingsService();
    const service = new VaultTimeoutService(store, settings);

    store.setUnlocked("user@example.com");
    settings.setVaultTimeoutMinutes(1);
    service.recordActivity();

    vi.advanceTimersByTime(59_000);
    expect(store.snapshot().isUnlocked).toBe(true);

    vi.advanceTimersByTime(1_000);
    expect(store.snapshot().isUnlocked).toBe(false);
    expect(store.snapshot().statusMessage).toBe("Locked");
  });

  it("resets the timeout when user activity is recorded", () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const settings = new SettingsService();
    const service = new VaultTimeoutService(store, settings);

    store.setUnlocked("user@example.com");
    settings.setVaultTimeoutMinutes(1);
    service.recordActivity();
    vi.advanceTimersByTime(45_000);
    service.recordActivity();
    vi.advanceTimersByTime(45_000);

    expect(store.snapshot().isUnlocked).toBe(true);

    vi.advanceTimersByTime(15_000);
    expect(store.snapshot().isUnlocked).toBe(false);
  });

  it("does not schedule a timeout while locked", () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const settings = new SettingsService();
    const service = new VaultTimeoutService(store, settings);

    service.recordActivity();
    vi.advanceTimersByTime(5 * 60_000);

    expect(store.snapshot().isUnlocked).toBe(false);
    expect(store.snapshot().statusMessage).toBe("");
  });

  it("keeps an unlocked vault open when timeout is Never", () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const settings = new SettingsService();
    const service = new VaultTimeoutService(store, settings);
    store.setUnlocked("user@example.com");
    settings.setVaultTimeoutMinutes(-1);

    service.recordActivity();
    vi.advanceTimersByTime(24 * 60 * 60_000);

    expect(store.snapshot().isUnlocked).toBe(true);
  });

  it("delegates a scheduled timeout to the registered lock handler", () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const settings = new SettingsService();
    const service = new VaultTimeoutService(store, settings);
    const lock = vi.fn(() => store.setLocked());
    service.setLockHandler(lock);
    store.setUnlocked("user@example.com");
    settings.setVaultTimeoutMinutes(1);

    service.recordActivity();
    vi.advanceTimersByTime(60_000);

    expect(lock).toHaveBeenCalledTimes(1);
    expect(store.snapshot().isUnlocked).toBe(false);
  });

  it("delegates an immediate timeout to the registered lock handler", () => {
    const store = new PopupStateStore();
    const settings = new SettingsService();
    const service = new VaultTimeoutService(store, settings);
    const lock = vi.fn(() => store.setLocked());
    service.setLockHandler(lock);
    store.setUnlocked("user@example.com");
    settings.setVaultTimeoutMinutes(0);

    service.recordActivity();

    expect(lock).toHaveBeenCalledTimes(1);
    expect(store.snapshot().isUnlocked).toBe(false);
  });

  it("delegates to logout for an account configured with the logout action", () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const settings = new SettingsService();
    const service = new VaultTimeoutService(store, settings);
    const lock = vi.fn();
    const logout = vi.fn(() => store.setLoggedOut());
    service.setTimeoutHandlers(lock, logout);
    service.useAccount("account-a");
    settings.setVaultTimeoutMinutes(1);
    settings.setVaultTimeoutAction("logout");
    store.setUnlocked("user@example.com");

    service.recordActivity();
    vi.advanceTimersByTime(60_000);

    expect(logout).toHaveBeenCalledOnce();
    expect(lock).not.toHaveBeenCalled();
    expect(store.snapshot().email).toBe("");
  });
});
