import { describe, expect, it, vi } from "vitest";

import type { HostApi } from "../../host/host-api";
import { PopupStateStore } from "../popup-state";
import {
  EnvironmentHandoffService,
  helpUrl,
  sourceUrl,
  twoStepLoginHelpUrl,
} from "./environment-handoff.service";

describe("EnvironmentHandoffService", () => {
  it("opens the official cloud Web Vault route", async () => {
    const host = {
      openUrl: vi.fn(async () => undefined),
    } as unknown as HostApi;
    const service = new EnvironmentHandoffService(new PopupStateStore(), host);

    await service.openWebVault("/#/settings/security/password");

    expect(host.openUrl).toHaveBeenCalledWith(
      "https://vault.bitwarden.com/#/settings/security/password",
    );
  });

  it("preserves the active self-hosted Web Vault URL", async () => {
    const store = new PopupStateStore();
    store.setServerUrl("https://vault.example.test/");
    const host = {
      openUrl: vi.fn(async () => undefined),
    } as unknown as HostApi;
    const service = new EnvironmentHandoffService(store, host);

    await service.openWebVault("/#/settings/security/password");
    await service.openWebVault("");

    expect(host.openUrl).toHaveBeenNthCalledWith(
      1,
      "https://vault.example.test/#/settings/security/password",
    );
    expect(host.openUrl).toHaveBeenNthCalledWith(
      2,
      "https://vault.example.test",
    );
  });

  it("preserves the official EU Web Vault URL", async () => {
    const store = new PopupStateStore();
    store.setServerUrl("https://vault.bitwarden.eu");
    const host = {
      openUrl: vi.fn(async () => undefined),
    } as unknown as HostApi;
    const service = new EnvironmentHandoffService(store, host);

    await service.openWebVault("");

    expect(host.openUrl).toHaveBeenCalledWith("https://vault.bitwarden.eu");
  });

  it("preserves a self-hosted Web Vault base path", async () => {
    const store = new PopupStateStore();
    store.setServerUrl("https://vault.example.test/bitwarden/");
    const host = { openUrl: vi.fn(async () => undefined) } as unknown as HostApi;
    const service = new EnvironmentHandoffService(store, host);

    await service.openWebVault("/#/settings/security/password");

    expect(host.openUrl).toHaveBeenCalledWith(
      "https://vault.example.test/bitwarden/#/settings/security/password",
    );
  });

  it("opens exact US, EU, and self-hosted Web Vault addresses", async () => {
    const store = new PopupStateStore();
    const host = { openUrl: vi.fn(async () => undefined) } as unknown as HostApi;
    const service = new EnvironmentHandoffService(store, host);

    await service.openWebVault("/#/settings/security/password");
    store.setServerUrl("https://vault.bitwarden.eu/");
    await service.openWebVault("");
    store.setServerUrl("https://vault.example.test/bitwarden/");
    await service.openWebVault("/#/settings/security/password");

    expect(host.openUrl).toHaveBeenNthCalledWith(
      1,
      "https://vault.bitwarden.com/#/settings/security/password",
    );
    expect(host.openUrl).toHaveBeenNthCalledWith(2, "https://vault.bitwarden.eu");
    expect(host.openUrl).toHaveBeenNthCalledWith(
      3,
      "https://vault.example.test/bitwarden/#/settings/security/password",
    );
  });

  it("keeps the environment handoff policy HTTPS-only", async () => {
    const store = new PopupStateStore();
    store.setServerUrl("http://vault.example.test");
    const host = { openUrl: vi.fn(async () => undefined) } as unknown as HostApi;
    const service = new EnvironmentHandoffService(store, host);

    await expect(service.openWebVault("")).rejects.toThrow("Unsupported Web Vault URL");
    expect(host.openUrl).not.toHaveBeenCalled();
  });

  it.each([
    "not a URL",
    "http://vault.example.test",
    "//vault.example.test",
  ])("rejects an unsafe active Web Vault URL: %s", async (serverUrl) => {
    const store = new PopupStateStore();
    store.setServerUrl(serverUrl);
    const host = { openUrl: vi.fn(async () => undefined) } as unknown as HostApi;
    const service = new EnvironmentHandoffService(store, host);

    await expect(service.openWebVault("")).rejects.toThrow("Unsupported Web Vault URL");
    expect(host.openUrl).not.toHaveBeenCalled();
  });

  it("rejects a foreign Web Vault route without opening it", async () => {
    const host = { openUrl: vi.fn(async () => undefined) } as unknown as HostApi;
    const service = new EnvironmentHandoffService(new PopupStateStore(), host);

    await expect(service.openWebVault("/account/recovery" as never)).rejects.toThrow(
      "Unsupported Web Vault URL",
    );
    expect(host.openUrl).not.toHaveBeenCalled();
  });

  it("opens only fixed external Help and source destinations", async () => {
    const host = {
      openUrl: vi.fn(async () => undefined),
    } as unknown as HostApi;
    const service = new EnvironmentHandoffService(new PopupStateStore(), host);

    await service.openExternal(helpUrl);
    await service.openExternal(twoStepLoginHelpUrl);
    await service.openExternal(sourceUrl);

    expect(host.openUrl).toHaveBeenNthCalledWith(1, helpUrl);
    expect(host.openUrl).toHaveBeenNthCalledWith(2, twoStepLoginHelpUrl);
    expect(host.openUrl).toHaveBeenNthCalledWith(3, sourceUrl);
  });

  it.each([
    "https://example.test/",
    "http://bitwarden.com/help/",
    "//bitwarden.com/help/",
    "not a URL",
  ])("rejects a foreign external destination: %s", async (url) => {
    const host = { openUrl: vi.fn(async () => undefined) } as unknown as HostApi;
    const service = new EnvironmentHandoffService(new PopupStateStore(), host);

    await expect(service.openExternal(url as never)).rejects.toThrow("Unsupported external URL");
    expect(host.openUrl).not.toHaveBeenCalled();
  });
});
