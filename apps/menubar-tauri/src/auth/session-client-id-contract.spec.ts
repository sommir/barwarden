import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import * as bitwardenApi from "../bitwarden-api/bitwarden-api";
import type {
  BitwardenClientId,
} from "../bitwarden-api/bitwarden-api";
import type {
  GlobalShortcutBinding,
  GlobalShortcutMutationOutcome,
  GlobalShortcutSnapshot,
} from "../host/global-shortcut";
import type { HostApi } from "../host/host-api";
import {
  ACCOUNT_INDEX_KEY,
  AccountSessionStore,
} from "./account-session-store";
import {
  AUTH_SESSION_KEY,
  AuthSessionStore,
  type AuthSession,
} from "./auth-session-store";
const validateClientId: (value: unknown) => value is BitwardenClientId =
  bitwardenApi.isBitwardenClientId;

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("canonical session client ID contract", () => {
  it("accepts exactly the three client identities used by stored sessions", () => {
    for (const value of ["browser", "web", "desktop"]) {
      expect(validateClientId(value)).toBe(true);
    }

    for (const value of [
      null,
      undefined,
      "",
      "Desktop",
      "mobile",
      "browser ",
      "web\n",
      0,
      {},
      [],
    ]) {
      expect(validateClientId(value)).toBe(false);
    }
  });

  it("typechecks and round-trips an official desktop AuthSession", async () => {
    const host = new MemoryHost();
    const store = new AuthSessionStore(host);
    const session = desktopSession();

    await store.save(session);

    expect(host.values.get(AUTH_SESSION_KEY)).toBe(JSON.stringify(session));
    await expect(new AuthSessionStore(host).read()).resolves.toEqual(session);
  });

  it("typechecks and round-trips an official desktop account session", async () => {
    const host = new MemoryHost();
    const session = desktopSession(jwt({ sub: "desktop-account" }));
    const account = await new AccountSessionStore(host).saveAccount({
      email: "desktop@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session,
    });

    await expect(new AccountSessionStore(host).readSession(account.id)).resolves.toEqual(
      session,
    );
  });

  it("rejects hostile client identities at both canonical storage boundaries", async () => {
    const host = new MemoryHost();
    const valid = browserSession(jwt({ sub: "hostile-account" }));
    const account = await new AccountSessionStore(host).saveAccount({
      email: "hostile@example.com",
      serverUrl: "https://vault.bitwarden.com",
      session: valid,
    });
    const hostile = {
      ...valid,
      token: {
        ...valid.token,
        clientId: "mobile",
      },
    };
    await host.secureSet(AUTH_SESSION_KEY, JSON.stringify(hostile));
    await host.secureSet(`auth.account.${account.id}`, JSON.stringify(hostile));

    await expect(new AuthSessionStore(host).read()).resolves.toBeNull();
    await expect(new AccountSessionStore(host).readSession(account.id)).resolves.toBeNull();
    expect(host.values.has(ACCOUNT_INDEX_KEY)).toBe(true);
  });
});

function desktopSession(accessToken = "desktop-access-token"): AuthSession {
  return {
    ...browserSession(accessToken),
    token: {
      ...browserSession(accessToken).token,
      clientId: "desktop",
    },
  };
}

function browserSession(accessToken: string): AuthSession {
  return {
    environment: bitwardenApi.buildBitwardenEnvironment(),
    token: {
      accessToken,
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
      clientId: "browser",
    },
  };
}

class MemoryHost implements HostApi {
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

  getAccountLockIntents(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }

  setAccountLockIntents(): Promise<void> {
    return Promise.resolve();
  }

  getGlobalShortcut(): Promise<GlobalShortcutSnapshot> {
    return Promise.resolve({
      shortcut: null,
      availability: "cleared",
    });
  }

  setGlobalShortcut(
    shortcut: GlobalShortcutBinding,
  ): Promise<GlobalShortcutMutationOutcome> {
    return Promise.resolve({
      status: "updated",
      snapshot: {
        shortcut,
        availability: "active",
      },
    });
  }

  clearGlobalShortcut(): Promise<GlobalShortcutMutationOutcome> {
    return Promise.resolve({
      status: "unchanged",
      snapshot: {
        shortcut: null,
        availability: "cleared",
      },
    });
  }
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object): string =>
    btoa(JSON.stringify(value))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");

  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}
