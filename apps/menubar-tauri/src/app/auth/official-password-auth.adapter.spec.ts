import { firstValueFrom } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { PopupStateStore } from "../popup-state";
import { OfficialPasswordAuthAdapter } from "./official-password-auth.adapter";

describe("OfficialPasswordAuthAdapter", () => {
  it("delegates password login through AuthFacade, reports the retained challenge, and clears its transient password", async () => {
    const store = new PopupStateStore();
    const login = vi.fn(async () => {
      store.setAuthChallenge({
        type: "twoFactor",
        email: "person@example.com",
        serverUrl: "https://vault.bitwarden.eu",
        providers: ["0"],
      });
    });
    const adapter = new OfficialPasswordAuthAdapter(
      { login, cancelAuthChallenge: vi.fn() } as never,
      store,
    );

    await expect(adapter.login({
      email: "person@example.com",
      masterPassword: "master-password",
      serverUrl: "https://vault.bitwarden.eu",
    })).resolves.toBe("twoFactor");

    expect(login).toHaveBeenCalledWith({
      email: "person@example.com",
      masterPassword: "master-password",
      serverUrl: "https://vault.bitwarden.eu",
    });
    expect(adapter.hasTransientPassword()).toBe(false);
  });

  it("does not report vault when authentication restores the logged-out state after secure storage fails", async () => {
    const store = new PopupStateStore();
    store.setLoginError("保存账户失败。请重试。");
    const adapter = new OfficialPasswordAuthAdapter(
      { login: vi.fn(async () => undefined), cancelAuthChallenge: vi.fn() } as never,
      store,
    );

    await expect(adapter.login({
      email: "person@example.com",
      masterPassword: "master-password",
      serverUrl: "https://vault.bitwarden.com",
    })).resolves.toBe("login");

    expect(adapter.hasTransientPassword()).toBe(false);
  });

  it("exposes and updates the retained remembered email without retaining a master password", async () => {
    localStorage.clear();
    const adapter = new OfficialPasswordAuthAdapter(
      { login: vi.fn(), cancelAuthChallenge: vi.fn() } as never,
      new PopupStateStore(),
    );

    expect(await firstValueFrom(adapter.rememberedEmail$)).toBe("");
    adapter.rememberEmail("person@example.com", true);
    expect(await firstValueFrom(adapter.rememberedEmail$)).toBe("person@example.com");
    expect(localStorage.getItem("barwarden.login-email")).toBe("person@example.com");

    adapter.rememberEmail("person@example.com", false);
    expect(await firstValueFrom(adapter.rememberedEmail$)).toBe("");
    expect(localStorage.getItem("barwarden.login-email")).toBeNull();
  });

  it("cancels only through the retained facade operation boundary", () => {
    const cancelAuthChallenge = vi.fn();
    const adapter = new OfficialPasswordAuthAdapter(
      { login: vi.fn(), cancelAuthChallenge } as never,
      new PopupStateStore(),
    );

    adapter.cancel();

    expect(cancelAuthChallenge).toHaveBeenCalledOnce();
  });

  it("clears a rejected transient password and keeps ephemeral hint navigation email out of localStorage", async () => {
    localStorage.clear();
    const adapter = new OfficialPasswordAuthAdapter(
      { login: async () => { throw new Error("transport secret"); }, cancelAuthChallenge: vi.fn() } as never,
      new PopupStateStore(),
    );

    await expect(adapter.login({
      email: "person@example.com",
      masterPassword: "master-password",
      serverUrl: "https://vault.bitwarden.com",
    })).rejects.toThrow("transport secret");
    expect(adapter.hasTransientPassword()).toBe(false);

    adapter.setNavigationEmail("route-only@example.com");
    expect(adapter.takeNavigationEmail()).toBe("route-only@example.com");
    expect(adapter.takeNavigationEmail()).toBe("");
    expect(localStorage.getItem("barwarden.login-email")).toBeNull();
  });
});
