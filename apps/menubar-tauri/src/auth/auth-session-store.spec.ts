import { describe, expect, it } from "vitest";

import { buildBitwardenEnvironment } from "../bitwarden-api/bitwarden-api";
import type { HostApi } from "../host/host-api";
import { AUTH_SESSION_KEY, AuthSessionStore, type AuthSession } from "./auth-session-store";

describe("AuthSessionStore", () => {
  it("saves and reads the auth session through secure host storage", async () => {
    const host = new MemoryHostApi();
    const store = new AuthSessionStore(host);
    const session: AuthSession = {
      environment: buildBitwardenEnvironment(),
      token: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenType: "Bearer",
        expiresIn: 3600,
      },
    };

    await store.save(session);

    expect(host.values.get(AUTH_SESSION_KEY)).toBe(JSON.stringify(session));
    await expect(store.read()).resolves.toEqual(session);
  });

  it("restores an official cloud session using the desktop client identity", async () => {
    const host = new MemoryHostApi();
    const store = new AuthSessionStore(host);
    const session: AuthSession = {
      environment: buildBitwardenEnvironment(),
      token: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenType: "Bearer",
        expiresIn: 3600,
        clientId: "desktop",
      },
    };
    await host.secureSet(AUTH_SESSION_KEY, JSON.stringify(session));

    await expect(store.read()).resolves.toEqual(session);
  });

  it("returns null when no session is stored", async () => {
    const store = new AuthSessionStore(new MemoryHostApi());

    await expect(store.read()).resolves.toBeNull();
  });

  it("deletes the stored auth session", async () => {
    const host = new MemoryHostApi();
    const store = new AuthSessionStore(host);
    await host.secureSet(AUTH_SESSION_KEY, "session");
    await host.secureSet("auth.account.other", "encrypted-account-session");

    await store.clear();

    expect(host.values.has(AUTH_SESSION_KEY)).toBe(false);
    expect(host.values.get("auth.account.other")).toBe("encrypted-account-session");
  });

  it("ignores malformed stored sessions", async () => {
    const host = new MemoryHostApi();
    await host.secureSet(AUTH_SESSION_KEY, "{not-json");
    const store = new AuthSessionStore(host);

    await expect(store.read()).resolves.toBeNull();
  });

  it("ignores stored JSON that is not an auth session", async () => {
    const host = new MemoryHostApi();
    await host.secureSet(AUTH_SESSION_KEY, JSON.stringify({ token: { accessToken: "token" } }));
    const store = new AuthSessionStore(host);

    await expect(store.read()).resolves.toBeNull();
  });
});

class MemoryHostApi implements HostApi {
  readonly values = new Map<string, string>();

  showPopup(): Promise<void> {
    return Promise.resolve();
  }

  hidePopup(): Promise<void> {
    return Promise.resolve();
  }

  copyText(): Promise<void> {
    return Promise.resolve();
  }

  pasteText(): Promise<void> {
    return Promise.resolve();
  }

  openUrl(): Promise<void> {
    return Promise.resolve();
  }

  secureGet(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  secureSet(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  secureDelete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}
