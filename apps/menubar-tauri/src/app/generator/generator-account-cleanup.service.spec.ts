import "@angular/compiler";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { generatorSettingsStorageKey } from "./generator.service";
import { GeneratorAccountCleanupService } from "./generator-account-cleanup.service";

describe("GeneratorAccountCleanupService", () => {
  beforeEach(() => localStorage.clear());

  it("clears only the selected account history and settings", async () => {
    const historyStore = { clear: vi.fn(async () => undefined) };
    localStorage.setItem(generatorSettingsStorageKey("account-a"), "a-settings");
    localStorage.setItem(generatorSettingsStorageKey("account-b"), "b-settings");
    const settings = { clearAccount: vi.fn() };
    const service = new GeneratorAccountCleanupService(historyStore as never, settings as never);

    await service.clearAccount("account-a");

    expect(historyStore.clear).toHaveBeenCalledWith("account-a");
    expect(localStorage.getItem(generatorSettingsStorageKey("account-a"))).toBeNull();
    expect(localStorage.getItem(generatorSettingsStorageKey("account-b"))).toBe("b-settings");
    expect(settings.clearAccount).toHaveBeenCalledWith("account-a");
  });

  it("keeps settings reachable when secure history erasure fails", async () => {
    const historyStore = { clear: vi.fn(async () => { throw new Error("keychain failure"); }) };
    localStorage.setItem(generatorSettingsStorageKey("account-a"), "settings");
    const settings = { clearAccount: vi.fn() };
    const service = new GeneratorAccountCleanupService(historyStore as never, settings as never);

    await expect(service.clearAccount("account-a")).rejects.toThrow("keychain failure");

    expect(localStorage.getItem(generatorSettingsStorageKey("account-a"))).toBe("settings");
    expect(settings.clearAccount).not.toHaveBeenCalled();
  });
});
