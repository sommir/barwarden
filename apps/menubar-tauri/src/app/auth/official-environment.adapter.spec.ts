import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PopupStateStore } from "../popup-state";

const adapterPath = "./official-environment.adapter";
const adapterSourcePath = join(
  process.cwd(),
  "apps/menubar-tauri/src/app/auth/official-environment.adapter.ts",
);

describe("OfficialEnvironmentAdapter", () => {
  it("exposes explicit account readiness before an account refresh settles", async () => {
    expect(existsSync(adapterSourcePath)).toBe(true);

    const { OfficialEnvironmentAdapter } = await import(adapterPath);
    let resolveAccounts: ((value: readonly unknown[]) => void) | undefined;
    const accounts = new Promise<readonly unknown[]>((resolve) => { resolveAccounts = resolve; });
    const adapter = new OfficialEnvironmentAdapter(new PopupStateStore(), new Map(), {
      list: () => accounts,
    } as never);

    expect(typeof adapter.refreshAccounts).toBe("function");
    expect(adapter.accountReadiness()).toEqual({ state: "loading" });
    expect(adapter.environmentForAccount("saved-account")).toBeNull();

    resolveAccounts?.([{ id: "saved-account", serverUrl: "https://vault.bitwarden.eu" }]);
    await adapter.ready;

    expect(adapter.accountReadiness()).toEqual({ state: "ready" });
  });

  it("retains only the official US and EU cloud selections", async () => {
    expect(existsSync(adapterSourcePath)).toBe(true);

    const { OfficialEnvironmentAdapter } = await import(adapterPath);
    const store = new PopupStateStore();
    const adapter = new OfficialEnvironmentAdapter(store);
    const selected: string[] = [];
    const subscription = adapter.selected$.subscribe((region: string) => selected.push(region));

    adapter.selectCloud("EU");
    expect(store.snapshot().serverUrl).toBe("https://vault.bitwarden.eu");
    adapter.selectCloud("US");

    expect(store.snapshot().serverUrl).toBe("https://vault.bitwarden.com");
    expect(selected).toEqual(["US", "EU", "US"]);
    subscription.unsubscribe();
  });

  it("derives retained self-hosted endpoints from one HTTPS base URL", async () => {
    expect(existsSync(adapterSourcePath)).toBe(true);

    const { OfficialEnvironmentAdapter } = await import(adapterPath);
    const store = new PopupStateStore();
    const adapter = new OfficialEnvironmentAdapter(store);

    adapter.selectSelfHosted("https://vault.example.test/path/");

    expect(store.snapshot().serverUrl).toBe("https://vault.example.test/path");
    expect(adapter.environmentForAccount("pending")).toBeNull();
    expect(adapter.currentEnvironment()).toEqual({
      apiUrl: "https://vault.example.test/path/api",
      identityUrl: "https://vault.example.test/path/identity",
      iconsUrl: "https://vault.example.test/path/icons",
      webVaultUrl: "https://vault.example.test/path",
      sendUrl: "https://vault.example.test/path",
    });
  });

  it("remembers the last self-hosted URL after the login state is recreated", async () => {
    localStorage.clear();
    const { OfficialEnvironmentAdapter } = await import(adapterPath);
    const original = new OfficialEnvironmentAdapter(new PopupStateStore());

    original.selectSelfHosted("https://vault.example.test/path/");

    const recreated = new OfficialEnvironmentAdapter(new PopupStateStore());
    expect(recreated.lastSelfHostedServerUrl()).toBe("https://vault.example.test/path");
  });

  it("rejects HTTP and preserves the saved account server identity", async () => {
    expect(existsSync(adapterSourcePath)).toBe(true);

    const { OfficialEnvironmentAdapter } = await import(adapterPath);
    const store = new PopupStateStore();
    const adapter = new OfficialEnvironmentAdapter(store, new Map([
      ["saved-account", "https://vault.bitwarden.eu"],
    ]));

    expect(() => adapter.selectSelfHosted("http://vault.example.test")).toThrow(
      "Self-hosted server URL must be an HTTPS base URL",
    );
    expect(adapter.environmentForAccount("saved-account")).toEqual({
      apiUrl: "https://api.bitwarden.eu",
      identityUrl: "https://identity.bitwarden.eu",
      iconsUrl: "https://icons.bitwarden.eu",
      webVaultUrl: "https://vault.bitwarden.eu",
      sendUrl: "https://vault.bitwarden.eu",
    });
  });

  it("loads saved account server identity from the existing account state", async () => {
    expect(existsSync(adapterSourcePath)).toBe(true);

    const { OfficialEnvironmentAdapter } = await import(adapterPath);
    const adapter = new OfficialEnvironmentAdapter(
      new PopupStateStore(),
      new Map(),
      {
        list: async () => [{
          id: "saved-account",
          email: "user@example.com",
          serverUrl: "https://vault.bitwarden.eu",
          status: "locked",
          isActive: true,
        }],
      } as never,
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(adapter.environmentForAccount("saved-account")?.identityUrl).toBe(
      "https://identity.bitwarden.eu",
    );
  });

  it("keeps only the current refresh, clears removed accounts, and redacts refresh failures", async () => {
    expect(existsSync(adapterSourcePath)).toBe(true);

    const { OfficialEnvironmentAdapter } = await import(adapterPath);
    const deferred: Array<{ resolve: (value: readonly unknown[]) => void; reject: () => void }> = [];
    const adapter = new OfficialEnvironmentAdapter(new PopupStateStore(), new Map(), {
      list: () => new Promise<readonly unknown[]>((resolve, reject) => deferred.push({ resolve, reject })),
    } as never);

    expect(typeof adapter.refreshAccounts).toBe("function");
    const stale = adapter.ready;
    const current = adapter.refreshAccounts();
    deferred[1].resolve([{ id: "current", serverUrl: "https://vault.bitwarden.eu" }]);
    await current;
    deferred[0].resolve([{ id: "stale", serverUrl: "https://vault.bitwarden.com" }]);
    await stale;

    expect(adapter.environmentForAccount("current")?.identityUrl).toBe("https://identity.bitwarden.eu");
    expect(adapter.environmentForAccount("stale")).toBeNull();

    const removal = adapter.refreshAccounts();
    deferred[2].resolve([]);
    await removal;
    expect(adapter.environmentForAccount("current")).toBeNull();

    const failure = adapter.refreshAccounts();
    deferred[3].reject();
    await failure;
    expect(adapter.accountReadiness()).toEqual({
      state: "error",
      message: "Unable to load saved account environments.",
    });
  });

  it("never derives environments from stored HTTP or malformed server URLs", async () => {
    expect(existsSync(adapterSourcePath)).toBe(true);

    const { OfficialEnvironmentAdapter } = await import(adapterPath);
    const adapter = new OfficialEnvironmentAdapter(new PopupStateStore(), new Map(), {
      list: async () => [
        { id: "http", serverUrl: "http://vault.example.test" },
        { id: "invalid", serverUrl: "not a URL" },
        { id: "cloud", serverUrl: "https://vault.bitwarden.com" },
        { id: "self-hosted", serverUrl: "https://vault.example.test" },
      ],
    } as never);

    await adapter.ready;

    expect(adapter.environmentForAccount("http")).toBeNull();
    expect(adapter.environmentForAccount("invalid")).toBeNull();
    expect(adapter.environmentForAccount("cloud")?.apiUrl).toBe("https://api.bitwarden.com");
    expect(adapter.environmentForAccount("self-hosted")?.identityUrl).toBe(
      "https://vault.example.test/identity",
    );
  });
});
