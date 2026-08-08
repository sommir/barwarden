import { webcrypto } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthSessionStore, type AuthSession } from "../../auth/auth-session-store";
import { OfficialMasterPasswordCrypto } from "../../auth/master-password-crypto";
import { AccountSessionStore, type StoredAccount } from "../../auth/account-session-store";
import type { AccountSessionPort } from "../../auth/account-session-port";
import { BitwardenApiError, buildBitwardenEnvironment } from "../../bitwarden-api/bitwarden-api";
import * as bitwardenApiModule from "../../bitwarden-api/bitwarden-api";
import type {
  HostApi,
  ProcessSessionMutation,
  ProcessSessionSnapshot,
} from "../../host/host-api";
import { SecureStorageError } from "../../host/host-api";
import type { VaultSyncResult } from "../../vault/vault-sync.service";
import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";
import { AuthFacade, AuthStartupError, AuthUnlockError } from "./auth.facade";
import type { AccountLogoutCleanupPort } from "./account-logout-cleanup";
import type { PopupRouterCacheLifecyclePort } from "../platform/popup-router-cache.lifecycle";
import { unsupportedAuthenticationMessage } from "./supported-authentication";
import { VaultTimeoutService } from "./vault-timeout.service";
import {
  AlternativeUnlockError,
  type UnlockMethodsPort,
} from "./unlock-methods.port";
import type { ProcessSessionBrokerPort } from "./process-session-broker.service";
import { encodeProcessSharedPopupState } from "./process-shared-popup-state";
import { ReplaySubject } from "rxjs";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

describe("AuthFacade", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("emits account switch restore, lock, and logout lifecycle replacements in order", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const accountStore = accountPort({
      setActive: async () => { throw new Error("activation failed"); },
    });
    vi.spyOn(AuthSessionStore.prototype, "clear").mockResolvedValue();
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);
    const emissions: string[] = [];
    const subscription = store.state$.subscribe((state) => {
      emissions.push(`${state.isUnlocked}|${state.email}|${state.statusMessage}|${state.syncError}`);
    });

    await expect(facade.switchAccount("next")).rejects.toThrow("activation failed");
    facade.lock();
    await facade.logout();
    subscription.unsubscribe();

    expect(emissions).toEqual([
      "true|current@example.com||",
      "true|current@example.com||",
      "true|current@example.com||",
      "true|current@example.com||Unable to switch account.",
      "true|current@example.com|Unable to switch account.|Unable to switch account.",
      "true|current@example.com|Unable to switch account.|Unable to switch account.",
      `false|current@example.com|${translateOfficialMessage("locked")}|`,
      `false|current@example.com|${translateOfficialMessage("locked")}|`,
      `false|current@example.com|${translateOfficialMessage("locked")}|`,
      `false||${translateOfficialMessage("locked")}|`,
      `false||${translateOfficialMessage("i18nLoggedOut")}|`,
    ]);
  });

  it("invalidates and locks projection state before persisting a selected account", async () => {
    const events: string[] = [];
    const current = storedAccount("current", "current@example.com", true);
    const target = { ...storedAccount("target", "target@example.com", false), status: "locked" as const };
    const accountStore = accountPort({
      setActive: async () => {
        events.push("set-active-target");
        return { ...target, isActive: true };
      },
      list: async () => [{ ...target, isActive: true }, { ...current, isActive: false }],
    });
    const projectionLifecycle = {
      invalidateAndLock: vi.fn(async () => { events.push("projection-locked"); }),
    };
    const facade = new AuthFacade(
      new PopupStateStore(), null, syncPort(), null, undefined, accountStore,
      undefined, null, undefined, null, null, null, null, projectionLifecycle,
    );

    await facade.switchAccount(target.id);

    expect(events).toEqual(["projection-locked", "set-active-target"]);
  });

  it("does not persist a selected account when projection lock cannot be acknowledged", async () => {
    const setActive = vi.fn(async () => storedAccount("target", "target@example.com", true));
    const facade = new AuthFacade(
      new PopupStateStore(), null, syncPort(), null, undefined, accountPort({ setActive }),
      undefined, null, undefined, null, null, null, null,
      { invalidateAndLock: async () => { throw new Error("agent unavailable"); } },
    );

    await expect(facade.switchAccount("target")).rejects.toThrow("Unable to switch account");
    expect(setActive).not.toHaveBeenCalled();
  });

  it("broadcasts explicit lock without putting session credentials in the process event", async () => {
    const store = new PopupStateStore();
    const active = storedAccount("active", "active@example.com", true);
    const broker = new FakeProcessSessionBroker(brokerSnapshot({
      authorization: "unlocked",
      activeAccountId: active.id,
    }));
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({ list: async () => [active] }),
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      broker,
    );
    setRuntimeAccount(facade, active.id);
    store.setActiveSession(session("private-access"));
    store.setUnlocked(active.email);

    facade.lock();

    await vi.waitFor(() =>
      expect(broker.mutations).toContainEqual({ type: "locked" }),
    );
    expect(JSON.stringify(broker.mutations)).not.toContain("private-access");
    expect(JSON.stringify(broker.mutations)).not.toContain("refresh-token");
  });

  it("does not finish logout until the signed-out process state is committed", async () => {
    const store = new PopupStateStore();
    const broker = new FakeProcessSessionBroker(brokerSnapshot({
      authorization: "unlocked",
      activeAccountId: "active",
    }));
    const signedOut = deferred<ProcessSessionSnapshot>();
    vi.spyOn(AuthSessionStore.prototype, "clear").mockResolvedValue();
    vi.spyOn(broker, "mutate").mockImplementation(async (mutation) => {
      broker.mutations.push(mutation);
      if (mutation.type === "logged-out") {
        return signedOut.promise;
      }
      return brokerSnapshot({ version: broker.mutations.length });
    });
    const facade = new AuthFacade(
      store,
      null,
      null,
      null,
      undefined,
      null,
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      broker,
    );
    let resolved = false;

    const logout = facade.logout().then(() => {
      resolved = true;
    });
    await vi.waitFor(() =>
      expect(broker.mutations).toContainEqual({ type: "logged-out" }),
    );

    expect(resolved).toBe(false);
    signedOut.resolve(brokerSnapshot({ version: 1 }));
    await logout;
    expect(resolved).toBe(true);
  });

  it("broadcasts selected-account lock state before a switched account can be unlocked", async () => {
    const store = new PopupStateStore();
    const current = storedAccount("current", "current@example.com", true);
    const target = {
      ...storedAccount("target", "target@example.com", false),
      status: "locked" as const,
    };
    const broker = new FakeProcessSessionBroker(brokerSnapshot({
      authorization: "unlocked",
      activeAccountId: current.id,
    }));
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        setActive: async () => ({ ...target, isActive: true }),
        list: async () => [{ ...target, isActive: true }, { ...current, isActive: false }],
      }),
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      broker,
    );
    setRuntimeAccount(facade, current.id);
    store.setActiveSession(session("current"));
    store.setUnlocked(current.email);

    await facade.switchAccount(target.id);

    expect(broker.mutations).toContainEqual({
      type: "account-selected",
      activeAccountId: target.id,
    });
  });

  it("clears retained popup routes when the runtime account changes, locks, or logs out", async () => {
    const routeCache: PopupRouterCacheLifecyclePort = { clear: vi.fn() };
    const facade = new AuthFacade(
      new PopupStateStore(),
      null,
      null,
      null,
      undefined,
      null,
      undefined,
      null,
      undefined,
      null,
      routeCache,
    );

    (facade as unknown as { setRuntimeAccountId(accountId: string | null): void }).setRuntimeAccountId("one");
    expect(routeCache.clear).not.toHaveBeenCalled();

    (facade as unknown as { setRuntimeAccountId(accountId: string | null): void }).setRuntimeAccountId("two");
    facade.lock();
    await facade.logout();

    expect(routeCache.clear).toHaveBeenCalledTimes(3);
  });

  it("keeps account hierarchy operations behind facade epochs and route-cache cleanup", async () => {
    const routeCache: PopupRouterCacheLifecyclePort = { clear: vi.fn() };
    const active = storedAccount("active", "active@example.com", true);
    const accountStore = accountPort({
      list: async () => [active],
      setActive: async () => active,
      readSession: async () => null,
      setStatus: async () => undefined,
      lockAll: async () => undefined,
      remove: async () => active,
    });
    const facade = new AuthFacade(
      new PopupStateStore(),
      null,
      syncPort(),
      null,
      undefined,
      accountStore,
      undefined,
      null,
      undefined,
      null,
      routeCache,
    );

    await facade.switchAccount(active.id);
    await facade.lockAccount(active.id);
    await facade.lockAll();
    await facade.logoutAccount(active.id);

    expect(routeCache.clear).toHaveBeenCalledTimes(4);
  });

  it("logs in, syncs, stores items, and clears the password", async () => {
    const store = new PopupStateStore();
    let syncedSession: AuthSession | undefined;
    const facade = new AuthFacade(
      store,
      {
        login: async () => session(),
      },
      {
        sync: async (activeSession) => {
          syncedSession = activeSession;
          return syncResult({
            cipherCount: 1,
            items: [
              {
                id: "login-1",
                name: "Example",
                subtitle: "user@example.com",
                uri: "https://example.com",
                favorite: true,
                fields: [{ id: "username", label: "Username", value: "user@example.com" }],
              },
            ],
          });
        },
      },
    );

    await facade.login({
      email: "user@example.com",
      masterPassword: "secret",
      serverUrl: "https://bitwarden.example.com",
    });

    expect(syncedSession?.token.accessToken).toBe("access-token");
    expect(store.snapshot().activeSession?.token.accessToken).toBe("access-token");
    expect(store.snapshot().isUnlocked).toBe(true);
    expect(store.snapshot().email).toBe("user@example.com");
    expect(store.snapshot().items.map((item) => item.name)).toEqual(["Example"]);
    expect(store.snapshot().statusMessage).toBe(translateOfficialMessage("i18nSyncedVaultData", 1, 0));
  });

  it("does not expose the temporary pre-persistence logout while a successful login is committing", async () => {
    const store = new PopupStateStore();
    const observedStates: Array<{ isUnlocked: boolean; isLoggingIn: boolean }> = [];
    const subscription = store.state$.subscribe((state) => observedStates.push({
      isUnlocked: state.isUnlocked,
      isLoggingIn: state.isLoggingIn,
    }));
    const facade = new AuthFacade(
      store,
      { login: async () => session() },
      { sync: async () => emptySyncResult() },
      null,
      undefined,
      accountPort({
        saveAccount: async () => storedAccount("login", "user@example.com", true),
      }),
    );

    await facade.login({
      email: "user@example.com",
      masterPassword: "secret",
      serverUrl: "https://bitwarden.example.com",
    });
    subscription.unsubscribe();

    const firstUnlock = observedStates.findIndex((state) => state.isUnlocked);
    expect(firstUnlock).toBeGreaterThanOrEqual(0);
    expect(observedStates.slice(firstUnlock)).not.toContainEqual({
      isUnlocked: false,
      isLoggingIn: false,
    });
  });

  it("uses exact normalized self-hosted endpoints for prelogin, token, and sync", async () => {
    const store = new PopupStateStore();
    const fetchCalls: string[] = [];
    const masterKey = new Uint8Array(32).fill(7);
    const deriveSpy = vi.spyOn(OfficialMasterPasswordCrypto.prototype, "derive").mockResolvedValue({
      authenticationHashB64: "authentication-hash",
      masterKey,
    });
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      if (String(url).endsWith("/identity/accounts/prelogin/password")) {
        return jsonResponse({ Kdf: 0, KdfIterations: 5_000 });
      }

      if (String(url).endsWith("/identity/connect/token")) {
        return jsonResponse({
          access_token: "preview-access-token",
          refresh_token: "preview-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }

      if (String(url).endsWith("/api/sync?excludeDomains=true")) {
        return jsonResponse({ Ciphers: [], Folders: [], Sends: [] });
      }

      return jsonResponse({ error: "unexpected url" }, 404);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await new AuthFacade(store).login({
      email: "user@example.com",
      masterPassword: "secret",
      serverUrl: "https://self.example.com:8443",
    });

    expect(fetchCalls).toEqual([
      "https://self.example.com:8443/identity/accounts/prelogin/password",
      "https://self.example.com:8443/identity/connect/token",
      "https://self.example.com:8443/api/sync?excludeDomains=true",
    ]);
    expect(store.snapshot().isUnlocked).toBe(true);
    expect(store.snapshot().activeSession?.token.accessToken).toBe("preview-access-token");
    expect(store.snapshot().statusMessage).toBe(translateOfficialMessage("i18nSyncedVaultData", 0, 0));
    expect(deriveSpy).toHaveBeenCalledWith({
      email: "user@example.com",
      masterPassword: "secret",
      kdf: { type: "PBKDF2_SHA256", iterations: 5_000 },
    });
    expect(masterKey).toEqual(new Uint8Array(32));
  });

  it("uses Bitwarden EU Identity and API endpoints for login and sync", async () => {
    const store = new PopupStateStore();
    const fetchCalls: string[] = [];
    vi.spyOn(OfficialMasterPasswordCrypto.prototype, "derive").mockResolvedValue({
      authenticationHashB64: "authentication-hash",
      masterKey: new Uint8Array(32),
    });
    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      if (String(url).endsWith("/accounts/prelogin/password")) {
        return jsonResponse({ Kdf: 0, KdfIterations: 5_000 });
      }
      if (String(url).endsWith("/connect/token")) {
        return jsonResponse({
          access_token: "eu-access-token",
          refresh_token: "eu-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (String(url).endsWith("/sync?excludeDomains=true")) {
        return jsonResponse({ Ciphers: [], Folders: [], Sends: [] });
      }

      return jsonResponse({ error: "unexpected url" }, 404);
    });

    await new AuthFacade(store).login({
      email: "user@example.com",
      masterPassword: "secret",
      serverUrl: "https://vault.bitwarden.eu",
    });

    expect(fetchCalls).toContain("https://identity.bitwarden.eu/connect/token");
    expect(fetchCalls).toContain("https://api.bitwarden.eu/sync?excludeDomains=true");
    expect(store.snapshot().isUnlocked).toBe(true);
  });

  it("maps failed login into locked state with a recoverable error", async () => {
    const store = new PopupStateStore();
    const facade = new AuthFacade(
      store,
      {
        login: async () => {
          throw new Error("invalid_grant");
        },
      },
      {
        sync: async () => emptySyncResult(),
      },
    );

    await facade.login({
      email: "user@example.com",
      masterPassword: "bad",
      serverUrl: "https://bitwarden.example.com",
    });

    expect(store.snapshot().isUnlocked).toBe(false);
    expect(store.snapshot().loginError).toBe("主密码无效。请确认电子邮箱和服务器地址。");
    expect(store.snapshot().isLoggingIn).toBe(false);
  });

  it("maps the official invalid-credential response to a fixed Chinese message", async () => {
    const store = new PopupStateStore();
    const facade = new AuthFacade(store, {
      login: async () => {
        throw new BitwardenApiError(400, {
          ErrorModel: { Message: "Username or password is incorrect. Try again." },
        });
      },
    });

    await facade.login({
      email: "user@example.com",
      masterPassword: "bad",
      serverUrl: "https://vault.example.com",
    });

    expect(store.snapshot().loginError).toBe("主密码无效。请确认电子邮箱和服务器地址。");
    expect(store.snapshot().loginError).not.toContain("vault.example.com");
  });

  it("maps a self-hosted OAuth invalid_grant response to the invalid-master-password message", async () => {
    const store = new PopupStateStore();
    const facade = new AuthFacade(store, {
      login: async () => {
        throw new BitwardenApiError(400, {
          error: "invalid_grant",
          error_description: "Invalid username or password.",
        });
      },
    });

    await facade.login({
      email: "user@example.com",
      masterPassword: "bad",
      serverUrl: "https://vault.example.com",
    });

    expect(store.snapshot().loginError).toBe("主密码无效。请确认电子邮箱和服务器地址。");
    expect(store.snapshot().loginError).not.toContain("invalid_grant");
  });

  it("maps API failures without exposing serialized response data", async () => {
    const store = new PopupStateStore();
    const internalResponse = { ErrorModel: { Message: "database password leaked" }, Debug: "internal details" };
    const facade = new AuthFacade(store, {
      login: async () => {
        throw new BitwardenApiError(500, internalResponse);
      },
    });

    await facade.login({
      email: "user@example.com",
      masterPassword: "bad",
      serverUrl: "https://vault.example.com",
    });

    expect(store.snapshot().loginError).toBe("服务器暂时无法完成登录。请稍后重试。");
    expect(store.snapshot().loginError).not.toContain(JSON.stringify(internalResponse));
  });

  it.each([
    [400, "服务器拒绝了登录请求。请检查账户和服务器设置。"],
    [401, "服务器拒绝了登录请求。请检查账户和服务器设置。"],
    [429, "登录尝试过于频繁。请稍后重试。"],
    [500, "服务器暂时无法完成登录。请稍后重试。"],
    [503, "服务器暂时无法完成登录。请稍后重试。"],
  ] as const)(
    "maps HTTP %i login failures to their actual category without response details",
    async (status, expectedMessage) => {
      const store = new PopupStateStore();
      const privateResponse = { ErrorModel: { Message: "private failure detail" } };
      const facade = new AuthFacade(store, {
        login: async () => { throw new BitwardenApiError(status, privateResponse); },
      });

      await facade.login({
        email: "operator@example.test",
        masterPassword: "synthetic-master-password",
        serverUrl: "https://vault.example.test",
      });

      expect(store.snapshot().loginError).toBe(expectedMessage);
      expect(store.snapshot().loginError).not.toContain("private failure detail");
      expect(store.snapshot().loginError).not.toContain("vault.example.test");
    },
  );

  it.each(["network unreachable", "certificate rejected", "request timed out"])(
    "maps transport failure %s to the fixed Chinese message",
    async (transportFailure) => {
      const store = new PopupStateStore();
      const facade = new AuthFacade(store, {
        login: async () => { throw new Error(`${transportFailure} https://private.example.test`); },
      });

      await facade.login({
        email: "operator@example.test",
        masterPassword: "synthetic-master-password",
        serverUrl: "https://vault.example.test",
      });

      expect(store.snapshot().loginError).toBe("无法登录。请检查服务器连接后重试。");
      expect(store.snapshot().loginError).not.toContain("private.example.test");
    },
  );

  it("recovers from a hung login instead of leaving the popup signing in forever", async () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const facade = new AuthFacade(
      store,
      {
        login: async () => new Promise<AuthSession>(() => undefined),
      },
      {
        sync: async () => emptySyncResult(),
      },
      null,
      50,
    );

    const loginPromise = facade.login({
      email: "user@example.com",
      masterPassword: "secret",
      serverUrl: "https://bitwarden.example.com",
    });

    expect(store.snapshot().isLoggingIn).toBe(true);

    await vi.advanceTimersByTimeAsync(49);
    expect(store.snapshot().isLoggingIn).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    await loginPromise;

    expect(store.snapshot().isUnlocked).toBe(false);
    expect(store.snapshot().isLoggingIn).toBe(false);
    expect(store.snapshot().loginError).toBe("登录超时。请检查服务器连接后重试。");
  });

  it("clears a partially authenticated session when initial sync times out", async () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const facade = new AuthFacade(
      store,
      {
        login: async () => session(),
      },
      {
        sync: async () => new Promise<any>(() => undefined),
      },
      null,
      50,
    );

    const loginPromise = facade.login({
      email: "user@example.com",
      masterPassword: "secret",
      serverUrl: "https://bitwarden.example.com",
    });

    await vi.advanceTimersByTimeAsync(50);
    await loginPromise;

    expect(store.snapshot().isUnlocked).toBe(false);
    expect(store.snapshot().activeSession).toBeNull();
    expect(store.snapshot().isLoggingIn).toBe(false);
    expect(store.snapshot().loginError).toBe("登录超时。请检查服务器连接后重试。");
  });

  it("maps Identity two-factor responses into the official 2FA challenge state with only supported providers", async () => {
    const store = new PopupStateStore();
    const login = vi.fn(async (request: any) => {
      if (!request.twoFactor) {
        throw new Error(JSON.stringify({
          TwoFactorProviders2: {
            3: null,
            1: { Email: "u***@example.com" },
            0: null,
            4: null,
          },
        }));
      }

      return session();
    });
    const facade = new AuthFacade(
      store,
      { login },
      { sync: async () => emptySyncResult() },
    );

    await facade.login({
      email: "user@example.com",
      masterPassword: "secret",
      serverUrl: "https://bitwarden.example.com",
    });

    expect(store.snapshot().isUnlocked).toBe(false);
    expect(store.snapshot().loginError).toBe("");
    expect(store.snapshot().authChallenge).toMatchObject({
      type: "twoFactor",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });
    expect(store.snapshot().authChallenge?.providers).toEqual(["0", "1"]);
    expect(facade.authChallengeExpiresAt()).toBeGreaterThan(Date.now());

    await facade.submitTwoFactor({ provider: 0, token: "123456", remember: true });

    expect(login).toHaveBeenLastCalledWith({
      email: "user@example.com",
      masterPassword: "secret",
      twoFactor: { provider: 0, token: "123456", remember: true },
    });
    expect(store.snapshot().isUnlocked).toBe(true);
    expect(store.snapshot().authChallenge).toBeNull();
    expect(facade.authChallengeExpiresAt()).toBeNull();
  });

  it("does not replay a cleared master-password error while a successful two-factor login is persisted", async () => {
    const store = new PopupStateStore();
    const staleError = "主密码无效。请确认电子邮箱和服务器地址。";
    store.setLoginError(staleError);
    const savedAccount = deferred<StoredAccount>();
    const login = vi.fn(async (request: any) => {
      if (!request.twoFactor) {
        throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
      }
      return session("two-factor-success");
    });
    const facade = new AuthFacade(
      store,
      { login },
      syncPort(),
      null,
      undefined,
      accountPort({ saveAccount: vi.fn(() => savedAccount.promise) }),
    );

    await facade.login(loginRequest("attempt@example.com"));
    const errorsDuringSuccessfulSubmit: string[] = [];
    const subscription = store.state$.subscribe((state) => {
      if (state.isLoggingIn && !state.isUnlocked && state.loginError) {
        errorsDuringSuccessfulSubmit.push(state.loginError);
      }
    });

    const submit = facade.submitTwoFactor({ provider: 0, token: "123456" });
    await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(2));
    savedAccount.resolve(storedAccount("attempt", "attempt@example.com", true));
    await submit;
    subscription.unsubscribe();

    expect(store.snapshot().isUnlocked).toBe(true);
    expect(errorsDuringSuccessfulSubmit).not.toContain(staleError);
  });

  it("surfaces a fixed error when the account offers only unsupported two-factor providers", async () => {
    const store = new PopupStateStore();
    const facade = new AuthFacade(store, {
      login: async () => {
        throw new Error(JSON.stringify({ TwoFactorProviders2: { 3: null, 4: null } }));
      },
    });

    await facade.login({
      email: "user@example.com",
      masterPassword: "secret",
      serverUrl: "https://bitwarden.example.com",
    });

    expect(store.snapshot().authChallenge).toBeNull();
    expect(store.snapshot().loginError).toBe(unsupportedAuthenticationMessage());
    expect(store.snapshot().loginError).not.toContain("3");
    expect(store.snapshot().loginError).not.toContain("4");
  });

  it("maps Identity new-device responses into the official new-device challenge state", async () => {
    const store = new PopupStateStore();
    const login = vi.fn(async (request: any) => {
      if (!request.newDeviceOtp) {
        throw new Error("new device verification required");
      }

      return session();
    });
    const facade = new AuthFacade(
      store,
      { login },
      { sync: async () => emptySyncResult() },
    );

    await facade.login({
      email: "user@example.com",
      masterPassword: "secret",
      serverUrl: "https://bitwarden.example.com",
    });

    expect(store.snapshot().loginError).toBe("");
    expect(store.snapshot().authChallenge).toMatchObject({
      type: "newDevice",
      email: "user@example.com",
      serverUrl: "https://bitwarden.example.com",
    });

    await facade.submitNewDeviceOtp("654321");

    expect(login).toHaveBeenLastCalledWith({
      email: "user@example.com",
      masterPassword: "secret",
      newDeviceOtp: "654321",
    });
    expect(store.snapshot().isUnlocked).toBe(true);
    expect(store.snapshot().authChallenge).toBeNull();
  });

  it("retains a new-device challenge after an invalid OTP so the user can retry", async () => {
    const store = new PopupStateStore();
    const login = vi.fn(async (request: any) => {
      if (!request.newDeviceOtp) {
        throw new Error("new device verification required");
      }
      if (request.newDeviceOtp === "bad") {
        throw new Error("private invalid new-device OTP response");
      }
      return session();
    });
    const facade = new AuthFacade(store, { login }, syncPort());

    await facade.login(loginRequest("attempt@example.com"));
    await expect(facade.submitNewDeviceOtp("bad")).resolves.toBe("newDevice");

    expect(store.snapshot().authChallenge).toMatchObject({
      type: "newDevice",
      email: "attempt@example.com",
    });
    expect(store.snapshot().loginError).toBe("无法登录。请重试。");
    expect(store.snapshot().loginError).not.toContain("private invalid new-device OTP response");
    expect((facade as unknown as { pendingLoginChallenge: unknown }).pendingLoginChallenge).toEqual({});

    await expect(facade.submitNewDeviceOtp("good")).resolves.toBe("unlocked");
    expect(store.snapshot().isUnlocked).toBe(true);
    expect(login).toHaveBeenCalledTimes(3);
  });

  it("refuses new-device submit and resend when the live challenge is two-factor", async () => {
    const store = new PopupStateStore();
    const login = vi.fn(async () => {
      throw new Error("new device verification required");
    });
    const resendNewDeviceOtp = vi.fn(async () => undefined);
    const facade = new AuthFacade(store, { login, resendNewDeviceOtp });

    await facade.login(loginRequest("attempt@example.com"));
    store.setAuthChallenge({
      type: "twoFactor",
      email: "attempt@example.com",
      serverUrl: "https://vault.example.com",
      providers: ["0"],
    });
    await facade.submitNewDeviceOtp("654321");
    await facade.resendNewDeviceOtp();

    expect(login).toHaveBeenCalledOnce();
    expect(resendNewDeviceOtp).not.toHaveBeenCalled();
    expect(store.snapshot().isUnlocked).toBe(false);
    expect(store.snapshot().loginError).toBe("没有待处理的新设备登录请求。");
  });

  it("retains a two-factor challenge after an invalid code so the user can retry", async () => {
    const store = new PopupStateStore();
    const login = vi.fn(async (request: any) => {
      if (!request.twoFactor) {
        throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
      }
      if (request.twoFactor.token === "bad") {
        throw new Error("invalid two-factor code");
      }
      return session();
    });
    const facade = new AuthFacade(store, { login }, syncPort());

    await facade.login(loginRequest("attempt@example.com"));
    await expect(facade.submitTwoFactor({ provider: 0, token: "bad" })).resolves.toBe("twoFactor");

    expect(store.snapshot().authChallenge).toMatchObject({
      type: "twoFactor",
      email: "attempt@example.com",
    });
    expect(store.snapshot().loginError).toBe("无法登录。请重试。");
    expect((facade as unknown as { pendingLoginChallenge: unknown }).pendingLoginChallenge).toEqual({});

    await expect(facade.submitTwoFactor({ provider: 0, token: "good" })).resolves.toBe("unlocked");
    expect(store.snapshot().isUnlocked).toBe(true);
    expect(login).toHaveBeenCalledTimes(3);
  });

  it("sends an email code only while provider 1 is pending", async () => {
    const store = new PopupStateStore();
    const sendTwoFactorEmail = vi.fn(async () => undefined);
    const login = vi.fn(async () => {
      throw new Error(JSON.stringify({ TwoFactorProviders2: { 1: { Email: "u***@example.com" } } }));
    });
    const facade = new AuthFacade(store, { login, sendTwoFactorEmail });

    await facade.login(loginRequest("attempt@example.com"));
    await facade.sendTwoFactorEmail();

    expect(sendTwoFactorEmail).toHaveBeenCalledWith("attempt@example.com");
    expect(store.snapshot().statusMessage).toBe("验证码邮件已发送。");

    facade.cancelAuthChallenge();
    await facade.sendTwoFactorEmail();
    expect(sendTwoFactorEmail).toHaveBeenCalledTimes(1);
    expect(store.snapshot().loginError).toBe("没有待处理的邮箱两步登录请求。");
  });

  it("coalesces concurrent email-code send requests", async () => {
    const store = new PopupStateStore();
    const gate = deferred<void>();
    const sendTwoFactorEmail = vi.fn(async () => gate.promise);
    const login = vi.fn(async () => {
      throw new Error(JSON.stringify({ TwoFactorProviders2: { 1: { Email: "u***@example.com" } } }));
    });
    const facade = new AuthFacade(store, { login, sendTwoFactorEmail });
    await facade.login(loginRequest("attempt@example.com"));

    const first = facade.sendTwoFactorEmail();
    const second = facade.sendTwoFactorEmail();
    expect(sendTwoFactorEmail).toHaveBeenCalledTimes(1);

    gate.resolve();
    await Promise.all([first, second]);
  });

  it("keeps email-send failure retryable and clears it after a successful resend", async () => {
    const store = new PopupStateStore();
    const sendTwoFactorEmail = vi.fn()
      .mockRejectedValueOnce(new Error("private mail failure"))
      .mockResolvedValueOnce(undefined);
    const login = vi.fn(async () => {
      throw new Error(JSON.stringify({ TwoFactorProviders2: { 1: { Email: "u***@example.com" } } }));
    });
    const facade = new AuthFacade(store, { login, sendTwoFactorEmail });
    await facade.login(loginRequest("attempt@example.com"));

    await facade.sendTwoFactorEmail();
    expect(store.snapshot().authChallenge).toMatchObject({ type: "twoFactor" });
    expect(store.snapshot().loginError).toBe("无法发送验证码邮件。请重试。");
    expect(store.snapshot().loginError).not.toContain("private mail failure");

    await facade.sendTwoFactorEmail();
    expect(store.snapshot().loginError).toBe("");
    expect(store.snapshot().statusMessage).toBe("验证码邮件已发送。");
  });

  it("isolates a canceled email send from a new challenge using the same login request", async () => {
    const store = new PopupStateStore();
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    const sendTwoFactorEmail = vi.fn()
      .mockImplementationOnce(async () => firstGate.promise)
      .mockImplementationOnce(async () => secondGate.promise);
    const login = vi.fn(async () => {
      throw new Error(JSON.stringify({ TwoFactorProviders2: { 1: { Email: "u***@example.com" } } }));
    });
    const facade = new AuthFacade(store, { login, sendTwoFactorEmail });
    const request = loginRequest("attempt@example.com");

    await facade.login(request);
    const firstSend = facade.sendTwoFactorEmail();
    facade.cancelAuthChallenge();
    await facade.login(request);
    const secondSend = facade.sendTwoFactorEmail();

    expect(sendTwoFactorEmail).toHaveBeenCalledTimes(2);
    firstGate.resolve();
    await firstSend;
    expect(store.snapshot().statusMessage).not.toBe("验证码邮件已发送。");

    secondGate.resolve();
    await secondSend;
    expect(store.snapshot().statusMessage).toBe("验证码邮件已发送。");
  });

  it("chains new-device verification into two-factor without losing the device OTP", async () => {
    const store = new PopupStateStore();
    const login = vi.fn(async (request: any) => {
      if (!request.newDeviceOtp) {
        throw new Error("new device verification required");
      }
      if (!request.twoFactor) {
        throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
      }
      return session();
    });
    const facade = new AuthFacade(store, { login }, syncPort());

    await facade.login(loginRequest("attempt@example.com"));
    await expect(facade.submitNewDeviceOtp("device-code")).resolves.toBe("twoFactor");

    expect(store.snapshot().authChallenge).toMatchObject({ type: "twoFactor" });
    expect((facade as unknown as { pendingLoginChallenge: unknown }).pendingLoginChallenge).toEqual({
      newDeviceOtp: "device-code",
    });
    await facade.submitTwoFactor({ provider: 0, token: "two-factor-code" });

    expect(login).toHaveBeenLastCalledWith({
      email: "attempt@example.com",
      masterPassword: "secret",
      newDeviceOtp: "device-code",
      twoFactor: { provider: 0, token: "two-factor-code" },
    });
    expect(store.snapshot().isUnlocked).toBe(true);
  });

  it("rejects challenge submissions from a component that does not own the active challenge type", async () => {
    const store = new PopupStateStore();
    const login = vi.fn(async (request: any) => {
      if (!request.newDeviceOtp) {
        throw new Error("new device verification required");
      }
      throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
    });
    const facade = new AuthFacade(store, { login });

    await facade.login(loginRequest("attempt@example.test"));
    await expect(facade.submitTwoFactor({ provider: 0, token: "wrong-owner" }))
      .resolves.toBe("newDevice");
    expect(store.snapshot().authChallenge).toMatchObject({ type: "newDevice" });
    expect(login).toHaveBeenCalledTimes(1);

    await expect(facade.submitNewDeviceOtp("accepted-device-code")).resolves.toBe("twoFactor");
    await expect(facade.submitNewDeviceOtp("wrong-owner-retry")).resolves.toBe("twoFactor");
    expect(store.snapshot().authChallenge).toMatchObject({ type: "twoFactor" });
    expect(login).toHaveBeenCalledTimes(2);
    expect((facade as unknown as { pendingLoginChallenge: unknown }).pendingLoginChallenge).toEqual({
      newDeviceOtp: "accepted-device-code",
    });
  });

  it("disposes pending challenge credentials before a failed handoff returns to login", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const baseline = store.snapshot();
    const login = vi.fn(async (request: any) => {
      if (!request.newDeviceOtp) {
        throw new Error("new device verification required");
      }
      throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
    });
    const facade = new AuthFacade(store, { login });

    await facade.login(loginRequest("attempt@example.test"));
    await facade.submitNewDeviceOtp("accepted-device-code");
    facade.cancelAuthChallenge();

    expect(store.snapshot()).toEqual(baseline);
    expect((facade as unknown as { pendingLoginRequest: unknown }).pendingLoginRequest).toBeNull();
    expect((facade as unknown as { pendingLoginState: unknown }).pendingLoginState).toBeNull();
    expect((facade as unknown as { pendingLoginChallenge: unknown }).pendingLoginChallenge).toEqual({});
    await expect(facade.submitNewDeviceOtp("must-not-retry")).resolves.toBe("unlocked");
    expect(login).toHaveBeenCalledTimes(2);
  });

  it("resends only for the live new-device challenge and deduplicates concurrent requests", async () => {
    const store = new PopupStateStore();
    const resendGate = deferred<void>();
    const resendNewDeviceOtp = vi.fn(async () => resendGate.promise);
    const login = vi.fn(async () => {
      throw new Error("new device verification required");
    });
    const facade = new AuthFacade(store, { login, resendNewDeviceOtp });

    await facade.login(loginRequest("attempt@example.com"));
    const first = facade.resendNewDeviceOtp();
    const second = facade.resendNewDeviceOtp();

    expect(resendNewDeviceOtp).toHaveBeenCalledOnce();
    expect(resendNewDeviceOtp).toHaveBeenCalledWith("attempt@example.com", "secret");
    resendGate.resolve();
    await Promise.all([first, second]);
    expect(store.snapshot().statusMessage).toBe("验证码邮件已发送。");
  });

  it("does not let a stale new-device resend completion overwrite a cancelled challenge", async () => {
    const store = new PopupStateStore();
    const resendGate = deferred<void>();
    const resendNewDeviceOtp = vi.fn(async () => resendGate.promise);
    const facade = new AuthFacade(store, {
      login: async () => { throw new Error("new device verification required"); },
      resendNewDeviceOtp,
    });

    await facade.login(loginRequest("attempt@example.com"));
    const resend = facade.resendNewDeviceOtp();
    facade.cancelAuthChallenge();
    resendGate.resolve();
    await resend;

    expect(store.snapshot().authChallenge).toBeNull();
    expect(store.snapshot().statusMessage).not.toBe("验证码邮件已发送。");
  });

  it("uses a fixed resend failure message without retaining request secrets", async () => {
    const store = new PopupStateStore();
    const facade = new AuthFacade(store, {
      login: async () => { throw new Error("new device verification required"); },
      resendNewDeviceOtp: async () => {
        throw new Error("resend failed: email=user@example.com hash=derived-hash");
      },
    });

    await facade.login(loginRequest("attempt@example.com"));
    await facade.resendNewDeviceOtp();

    expect(store.snapshot().authChallenge).toMatchObject({ type: "newDevice" });
    expect(store.snapshot().loginError).toBe("无法发送验证码邮件。请重试。");
    expect(JSON.stringify(store.snapshot())).not.toContain("derived-hash");
  });

  it("refuses new-device resend after the retained challenge timeout", async () => {
    vi.useFakeTimers();
    try {
      const store = new PopupStateStore();
      const resendNewDeviceOtp = vi.fn(async () => undefined);
      const facade = new AuthFacade(
        store,
        {
          login: async () => { throw new Error("new device verification required"); },
          resendNewDeviceOtp,
        },
        null,
        null,
        undefined,
        null,
        undefined,
        null,
        50,
      );

      await facade.login(loginRequest("attempt@example.com"));
      await vi.advanceTimersByTimeAsync(50);
      await facade.resendNewDeviceOtp();

      expect(resendNewDeviceOtp).not.toHaveBeenCalled();
      expect(store.snapshot().loginError).toBe("没有待处理的新设备登录请求。");
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires a new-device challenge and releases its retained login context", async () => {
    vi.useFakeTimers();
    try {
      const store = new PopupStateStore();
      setPriorPopupState(store);
      const prior = store.snapshot();
      const login = vi.fn(async () => {
        throw new Error("new device verification required");
      });
      const resendNewDeviceOtp = vi.fn(async () => undefined);
      const facade = new AuthFacade(
        store,
        { login, resendNewDeviceOtp },
        null,
        null,
        undefined,
        null,
        undefined,
        null,
        50,
      );

      await facade.login(loginRequest("attempt@example.com"));
      expect(store.snapshot().authChallenge).toMatchObject({ type: "newDevice" });
      await vi.advanceTimersByTimeAsync(50);

      expect(store.snapshot()).toMatchObject({
        email: prior.email,
        serverUrl: prior.serverUrl,
        isUnlocked: prior.isUnlocked,
        activeSession: prior.activeSession,
        authChallenge: null,
        loginError: "登录验证已过期。请重新登录。",
      });
      await facade.submitNewDeviceOtp("late");
      await facade.resendNewDeviceOtp();
      expect(login).toHaveBeenCalledOnce();
      expect(resendNewDeviceOtp).not.toHaveBeenCalled();
      expect(store.snapshot().loginError).toBe("没有待处理的新设备登录请求。");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a stale new-device resend completion after a replacement login owns the challenge route", async () => {
    const store = new PopupStateStore();
    const resendGate = deferred<void>();
    const resendNewDeviceOtp = vi.fn(async () => resendGate.promise);
    const login = vi.fn(async () => {
      throw new Error("new device verification required");
    });
    const facade = new AuthFacade(store, { login, resendNewDeviceOtp });

    await facade.login(loginRequest("first@example.com"));
    const resend = facade.resendNewDeviceOtp();
    await facade.login(loginRequest("second@example.com"));
    resendGate.resolve();
    await resend;

    expect(store.snapshot().authChallenge).toMatchObject({
      type: "newDevice",
      email: "second@example.com",
    });
    expect(store.snapshot().statusMessage).not.toBe("验证码邮件已发送。");
  });

  it("ignores a stale new-device submit completion after a replacement login owns the account attempt", async () => {
    const store = new PopupStateStore();
    const completion = deferred<AuthSession>();
    const login = vi.fn(async (request: any) => {
      if (request.email === "first@example.com" && request.newDeviceOtp) {
        return completion.promise;
      }
      throw new Error("new device verification required");
    });
    const facade = new AuthFacade(store, { login }, syncPort());

    await facade.login(loginRequest("first@example.com"));
    const submit = facade.submitNewDeviceOtp("654321");
    await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(2));
    await facade.login(loginRequest("second@example.com"));
    completion.resolve(session("stale-first-account"));
    await submit;

    expect(store.snapshot()).toMatchObject({
      isUnlocked: false,
      activeSession: null,
      authChallenge: {
        type: "newDevice",
        email: "second@example.com",
      },
    });
  });

  it("expires a pending challenge and releases the retained master password context", async () => {
    vi.useFakeTimers();
    try {
      const store = new PopupStateStore();
      setPriorPopupState(store);
      const prior = store.snapshot();
      const login = vi.fn(async (request: any) => {
        if (request.twoFactor) {
          throw new Error("invalid two-factor code");
        }
        throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
      });
      const facade = new AuthFacade(
        store,
        { login },
        null,
        null,
        undefined,
        null,
        undefined,
        null,
        50,
      );

      await facade.login(loginRequest("attempt@example.com"));
      expect(store.snapshot().authChallenge).toMatchObject({ type: "twoFactor" });

      await vi.advanceTimersByTimeAsync(40);
      await facade.submitTwoFactor({ provider: 0, token: "bad" });
      expect(store.snapshot().authChallenge).toMatchObject({ type: "twoFactor" });
      await vi.advanceTimersByTimeAsync(10);

      expect(store.snapshot()).toMatchObject({
        email: prior.email,
        serverUrl: prior.serverUrl,
        isUnlocked: prior.isUnlocked,
        activeSession: prior.activeSession,
        authChallenge: null,
      });
      await facade.submitTwoFactor({ provider: 0, token: "late" });
      expect(store.snapshot().loginError).toBe("没有待处理的两步登录请求。");
      expect(login).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears retained login context when challenge chaining reaches only unsupported providers", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const prior = store.snapshot();
    const login = vi.fn(async (request: any) => {
      if (!request.newDeviceOtp) {
        throw new Error("new device verification required");
      }
      throw new Error(JSON.stringify({ TwoFactorProviders2: { 3: null, 4: null } }));
    });
    const facade = new AuthFacade(store, { login });

    await facade.login(loginRequest("attempt@example.com"));
    await facade.submitNewDeviceOtp("device-code");

    expect(store.snapshot()).toMatchObject({
      email: prior.email,
      serverUrl: prior.serverUrl,
      isUnlocked: prior.isUnlocked,
      activeSession: prior.activeSession,
      authChallenge: null,
      loginError: unsupportedAuthenticationMessage(),
    });
    await facade.submitTwoFactor({ provider: 0, token: "must-not-run" });
    expect(login).toHaveBeenCalledTimes(2);
  });

  it("rejects a successful challenge response that arrives after the fixed deadline", async () => {
    vi.useFakeTimers();
    try {
      const store = new PopupStateStore();
      setPriorPopupState(store);
      const prior = store.snapshot();
      const completion = deferred<AuthSession>();
      const login = vi.fn(async (request: any) => {
        if (!request.twoFactor) {
          throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
        }
        return completion.promise;
      });
      const facade = new AuthFacade(
        store, { login }, syncPort(), null, undefined, null, undefined, null, 50,
      );

      await facade.login(loginRequest("attempt@example.com"));
      await vi.advanceTimersByTimeAsync(40);
      const submit = facade.submitTwoFactor({ provider: 0, token: "valid" });
      await vi.advanceTimersByTimeAsync(10);

      expect(store.snapshot()).toMatchObject({
        email: prior.email,
        isUnlocked: prior.isUnlocked,
        activeSession: prior.activeSession,
        authChallenge: null,
      });

      completion.resolve(session("late-session"));
      await submit;

      expect(store.snapshot()).toMatchObject({
        email: prior.email,
        serverUrl: prior.serverUrl,
        isUnlocked: prior.isUnlocked,
        activeSession: prior.activeSession,
        authChallenge: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores the pre-login baseline and clears retained challenge state when cancelling auth challenge", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const prior = store.snapshot();
    const login = vi.fn(async (request: any) => {
      if (!request.twoFactor) {
        throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
      }
      return session("unexpected");
    });
    const facade = new AuthFacade(store, { login });

    await facade.login(loginRequest("attempt@example.com"));
    expect(store.snapshot().authChallenge).toMatchObject({
      type: "twoFactor",
      email: "attempt@example.com",
    });

    facade.cancelAuthChallenge();

    expect(store.snapshot()).toMatchObject({
      email: prior.email,
      serverUrl: prior.serverUrl,
      isUnlocked: prior.isUnlocked,
      activeSession: prior.activeSession,
      items: prior.items,
      authChallenge: null,
      loginError: prior.loginError,
    });

    await facade.submitTwoFactor({ provider: 0, token: "123456" });
    expect(store.snapshot().loginError).toBe("没有待处理的两步登录请求。");
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("ignores auth challenge cancellation when no challenge is pending", () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const before = store.snapshot();
    const facade = new AuthFacade(store);

    facade.cancelAuthChallenge();
    facade.cancelAuthChallenge();

    expect(store.snapshot()).toEqual(before);
  });

  it("uses fixed Chinese login errors for every retained missing-auth context", async () => {
    const store = new PopupStateStore();
    const facade = new AuthFacade(store);

    await facade.submitTwoFactor({ provider: 0, token: "123456" });
    expect(store.snapshot().loginError).toBe("没有待处理的两步登录请求。");

    await facade.submitNewDeviceOtp("123456");
    expect(store.snapshot().loginError).toBe("没有待处理的新设备登录请求。");

    await expect(facade.unlock("master-password")).rejects.toThrow("Unable to unlock vault");
    expect(store.snapshot().loginError).toBe("没有已锁定的账户。");
  });

  it("invalidates an in-flight challenge submit when cancellation wins first", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const baseline = store.snapshot();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    await accountStore.saveAccount({
      email: "current@example.com",
      serverUrl: "https://vault.current.example.com",
      session: session(jwt({ sub: "current-account" })),
    });
    const saveAccount = vi.spyOn(accountStore, "saveAccount");
    const completion = deferred<AuthSession>();
    const login = vi.fn(async (request: any) => {
      if (!request.twoFactor) {
        throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
      }
      return completion.promise;
    });
    const facade = new AuthFacade(store, { login }, syncPort(), null, undefined, accountStore);

    await facade.login(loginRequest("attempt@example.com"));
    const submit = facade.submitTwoFactor({ provider: 0, token: "123456" });
    await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(2));

    facade.cancelAuthChallenge();
    completion.resolve(session("attempt"));
    await submit;

    expect(saveAccount).not.toHaveBeenCalled();
    expect(await facade.accounts()).toEqual([
      expect.objectContaining({
        email: "current@example.com",
        serverUrl: "https://vault.current.example.com",
        isActive: true,
      }),
    ]);
    expect(store.snapshot()).toMatchObject({
      email: baseline.email,
      serverUrl: baseline.serverUrl,
      isUnlocked: baseline.isUnlocked,
      activeSession: baseline.activeSession,
      items: baseline.items,
      authChallenge: null,
      loginError: baseline.loginError,
    });
  });

  it("treats cancel during guarded account save as an operation cancellation instead of a registration error", async () => {
    const store = new PopupStateStore();
    store.setLockedAccount("current@example.com", "https://vault.current.example.com");
    const host = new DeferredIndexHost();
    const accountStore = new AccountSessionStore(host);
    await accountStore.saveAccount({
      email: "current@example.com",
      serverUrl: "https://vault.current.example.com",
      session: session("current"),
    });
    host.deferIndexWrites = true;
    const login = vi.fn(async (request: any) => {
      if (!request.twoFactor) {
        throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
      }
      return session(jwt({ sub: "attempt-account" }));
    });
    const facade = new AuthFacade(store, { login }, syncPort(), null, undefined, accountStore);
    await facade.login(loginRequest("attempt@example.com"));

    const submit = facade.submitTwoFactor({ provider: 0, token: "123456" });
    await host.indexWriteStarted.promise;
    facade.cancelAuthChallenge();
    host.releaseIndexWrite();
    await submit;

    expect(store.snapshot()).toMatchObject({
      email: "current@example.com",
      serverUrl: "https://vault.current.example.com",
      isUnlocked: false,
      activeSession: null,
      authChallenge: null,
    });
    expect(store.snapshot().loginError).toBe("");
    expect(await facade.accounts()).toEqual([
      expect.objectContaining({
        email: "current@example.com",
        serverUrl: "https://vault.current.example.com",
        isActive: true,
      }),
    ]);
    expect(await accountStore.readSession("attempt-account")).toBeNull();
  });

  it("unlocks with the locked account email and server URL", async () => {
    const store = new PopupStateStore();
    store.setUnlocked("user@example.com");
    store.setServerUrl("https://vault.example.com");
    store.setLocked();
    const login = vi.fn(async () => session());
    const facade = new AuthFacade(
      store,
      { login },
      {
        sync: async () => emptySyncResult(),
      },
    );

    await facade.unlock("master-password");

    expect(login).toHaveBeenCalledWith({
      email: "user@example.com",
      masterPassword: "master-password",
    });
    expect(store.snapshot().isUnlocked).toBe(true);
  });

  it("activates the persisted PIN only after a successful master-password unlock", async () => {
    const store = new PopupStateStore();
    store.setLockedAccount("user@example.com", "https://vault.example.com");
    const activatePersistedPin = vi.fn(async () => undefined);
    const accountStore = accountPort({
      saveAccount: async () => storedAccount("a".repeat(64), "user@example.com", true),
    });
    const facade = new AuthFacade(
      store,
      { login: async () => session() },
      { sync: async () => emptySyncResult() },
      null,
      undefined,
      accountStore,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      unlockMethodsPort({ activatePersistedPin }),
    );

    await facade.unlock("master-password");

    expect(activatePersistedPin).toHaveBeenCalledWith("a".repeat(64));
  });

  it("rejects unlock when authentication fails without exposing private failure details", async () => {
    const store = new PopupStateStore();
    store.setLockedAccount("user@example.com", "https://vault.private.example.com");
    const facade = new AuthFacade(store, {
      login: async () => { throw new Error("password=master-password session=private-token"); },
    });

    const result = facade.unlock("master-password");

    await expect(result).rejects.toEqual(new AuthUnlockError("unexpected"));
    await expect(result).rejects.not.toThrow(/private|password|session|token/i);
    expect(store.snapshot().isUnlocked).toBe(false);
    expect(store.snapshot().activeSession).toBeNull();
  });

  it("classifies invalid credentials separately from post-authentication Keychain persistence failure", async () => {
    const invalidStore = new PopupStateStore();
    invalidStore.setLockedAccount("user@example.com", "https://vault.example.com");
    const invalidFacade = new AuthFacade(invalidStore, {
      login: async () => {
        throw new BitwardenApiError(400, {
          ErrorModel: { Message: "Username or password is incorrect. Try again." },
        });
      },
    });

    await expect(invalidFacade.unlock("incorrect-password")).rejects.toEqual(
      new AuthUnlockError("invalid-credentials"),
    );

    const persistenceStore = new PopupStateStore();
    persistenceStore.setLockedAccount("user@example.com", "https://vault.example.com");
    const persistenceFacade = new AuthFacade(
      persistenceStore,
      { login: async () => session("authenticated") },
      syncPort(),
      null,
      undefined,
      accountPort({
        saveAccount: async () => {
          throw new Error("keychain access denied");
        },
      }),
    );

    await expect(persistenceFacade.unlock("correct-password")).rejects.toEqual(
      new AuthUnlockError("storage-unavailable"),
    );
  });

  it.each([
    [
      "two-factor",
      new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } })),
      "twoFactor",
    ],
    [
      "new-device verification",
      new Error("new device verification required"),
      "newDeviceVerification",
    ],
  ] as const)("returns the retained %s challenge from locked-account authentication", async (
    _case,
    challenge,
    expected,
  ) => {
    const store = new PopupStateStore();
    store.setLockedAccount("user@example.com", "https://vault.example.com");
    const facade = new AuthFacade(store, {
      login: async () => {
        throw challenge;
      },
    });

    await expect(facade.unlock("correct-password")).resolves.toBe(expected);
    expect(store.snapshot().isUnlocked).toBe(false);
  });

  it("starts the vault timeout after a successful login", async () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const settings = new SettingsService();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const vaultTimeout = new VaultTimeoutService(store, settings);
    const facade = new AuthFacade(
      store,
      {
        login: async () => session(),
      },
      {
        sync: async () => emptySyncResult(),
      },
      vaultTimeout,
      undefined,
      accountStore,
    );

    await facade.login({
      email: "user@example.com",
      masterPassword: "secret",
      serverUrl: "https://bitwarden.example.com",
    });

    expect(store.snapshot().isUnlocked).toBe(true);

    settings.setVaultTimeoutMinutes(1);
    vaultTimeout.recordActivity();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(store.snapshot().isUnlocked).toBe(false);
    expect((await accountStore.list())[0]?.status).toBe("locked");
  });

  it("logout clears the persisted session and popup session state", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(session());
    store.setUnlocked("user@example.com");
    const clearSpy = vi.spyOn(AuthSessionStore.prototype, "clear").mockResolvedValue();

    await new AuthFacade(store).logout();

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(store.snapshot().activeSession).toBeNull();
    expect(store.snapshot().email).toBe("");
    expect(store.snapshot().statusMessage).toBe(translateOfficialMessage("i18nLoggedOut"));
  });

  it("keeps runtime locked while awaiting a hanging legacy session clear", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(session("current"));
    store.setUnlocked("current@example.com");
    const clear = deferred<void>();
    vi.spyOn(AuthSessionStore.prototype, "clear").mockReturnValue(clear.promise);
    const facade = new AuthFacade(store, null, null, null, undefined, null, 10);
    let resolved = false;

    const logout = facade.logout().then(() => { resolved = true; });

    expect(store.snapshot()).toMatchObject({ isUnlocked: false, activeSession: null });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(resolved).toBe(false);
    clear.resolve();
    await logout;
    expect(resolved).toBe(true);
    expect(store.snapshot().email).toBe("");
  });

  it("registers a successful login without removing existing accounts", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    const facade = new AuthFacade(store, { login: async () => session("two") }, syncPort(), null, undefined, accountStore);

    await facade.login(loginRequest("two@example.com"));

    const accounts = await facade.accounts();
    expect(accounts.map((account) => account.email)).toEqual([
      "two@example.com",
      "one@example.com",
    ]);
    expect(store.snapshot().vaultOwnerAccountId).toBe(
      accounts.find((account) => account.email === "two@example.com")?.id,
    );
  });

  it("uses a fixed Chinese error when account registration fails without exposing persistence details", async () => {
    const store = new PopupStateStore();
    const facade = new AuthFacade(
      store,
      { login: async () => session("registered") },
      syncPort(),
      null,
      undefined,
      accountPort({
        saveAccount: async () => {
          throw new Error("keychain write failed for https://private.example.com");
        },
      }),
    );

    await facade.login(loginRequest("user@example.com"));

    expect(store.snapshot().loginError).toBe("保存账户失败。请重试。");
    expect(store.snapshot().loginError).not.toContain("keychain");
    expect(store.snapshot().loginError).not.toContain("private.example.com");
  });

  it("does not register a login when its initial synchronization fails", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    const facade = new AuthFacade(
      store,
      { login: async () => session("two") },
      { sync: async () => { throw new Error("sync failed"); } },
      null,
      undefined,
      accountStore,
    );

    await facade.login(loginRequest("two@example.com"));

    expect((await facade.accounts()).map((account) => account.email)).toEqual(["one@example.com"]);
    expect(store.snapshot().syncError).toBe("");
    expect(store.snapshot().loginError).toBe("登录成功，但无法同步密码库。请稍后重试。");
  });

  it("keeps same-email accounts on different environments isolated across sequential logins", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const login = vi
      .fn()
      .mockResolvedValueOnce(session("us"))
      .mockResolvedValueOnce(session("eu"));
    const facade = new AuthFacade(store, { login }, syncPort(), null, undefined, accountStore);

    await facade.login({
      email: "same@example.com",
      masterPassword: "secret",
      serverUrl: "https://vault.bitwarden.com",
    });
    await facade.login({
      email: "same@example.com",
      masterPassword: "secret",
      serverUrl: "https://vault.bitwarden.eu",
    });

    expect(await facade.accounts()).toEqual([
      expect.objectContaining({
        email: "same@example.com",
        serverUrl: "https://vault.bitwarden.eu",
        isActive: true,
      }),
      expect.objectContaining({
        email: "same@example.com",
        serverUrl: "https://vault.bitwarden.com",
        isActive: false,
      }),
    ]);
  });

  it("routes a first launch with no accounts to login", async () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    setPriorPopupState(store);
    store.setStatus("Prior status");
    const settings = new SettingsService();
    settings.setVaultTimeoutMinutes(1);
    const vaultTimeout = new VaultTimeoutService(store, settings);
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      vaultTimeout,
      undefined,
      accountPort({}),
    );
    vaultTimeout.start();

    await expect(facade.restoreStartup()).resolves.toBe("login");

    expect(store.snapshot()).toMatchObject({
      isUnlocked: false,
      email: "",
      activeSession: null,
      items: [],
      archivedItems: [],
      deletedItems: [],
      folders: [],
      organizations: [],
      collections: [],
      sends: [],
      loginError: "",
      syncError: "",
      authChallenge: null,
      statusMessage: "Prior status",
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(store.snapshot().statusMessage).toBe("Prior status");
  });

  it("restores an active locked account without reading its session", async () => {
    const store = new PopupStateStore();
    const activeAccount = { ...storedAccount("locked", "locked@example.com", true), status: "locked" as const };
    const readSession = vi.fn(async () => session("locked"));
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        list: async () => [activeAccount],
        readSession,
      }),
    );

    await expect(facade.restoreStartup()).resolves.toBe("locked");

    expect(readSession).not.toHaveBeenCalled();
    expect(store.snapshot()).toMatchObject({
      email: activeAccount.email,
      serverUrl: activeAccount.serverUrl,
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("forces an active unlocked account to locked without reading or syncing its session", async () => {
    const store = new PopupStateStore();
    const activeAccount = storedAccount("restore", "restore@example.com", true);
    const readSession = vi.fn(async () => session("restore"));
    const setStatus = vi.fn(async () => undefined);
    const sync = vi.fn(syncPort().sync);
    const facade = new AuthFacade(
      store,
      null,
      { sync },
      null,
      undefined,
      accountPort({
        list: async () => [activeAccount],
        readSession,
        setStatus,
      }),
    );

    await expect(facade.restoreStartup()).resolves.toBe("locked");

    expect(readSession).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(
      activeAccount.id,
      "locked",
      expect.any(Function),
    );
    expect(store.snapshot()).toMatchObject({
      email: activeAccount.email,
      serverUrl: activeAccount.serverUrl,
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("attaches an additional window to the active unlocked session without persisting a lock", async () => {
    const store = new PopupStateStore();
    const activeAccount = storedAccount("shared", "shared@example.com", true);
    const restoredSession = session("shared");
    const readSession = vi.fn(async () => restoredSession);
    const setStatus = vi.fn(async () => undefined);
    const sync = vi.fn(async () => emptySyncResult());
    const facade = new AuthFacade(
      store,
      null,
      { sync },
      null,
      undefined,
      accountPort({
        list: async () => [activeAccount],
        readSession,
        setStatus,
      }),
    );

    await expect(facade.restoreStartup("additional-window")).resolves.toBe("unlocked");

    expect(readSession).toHaveBeenCalledWith(activeAccount.id);
    expect(setStatus).not.toHaveBeenCalled();
    expect(sync).toHaveBeenCalledWith(restoredSession);
    expect(store.snapshot()).toMatchObject({
      email: activeAccount.email,
      serverUrl: activeAccount.serverUrl,
      isUnlocked: true,
      activeSession: restoredSession,
      syncError: "",
    });
  });

  it("reports a missing additional-window secure session from its restore origin", async () => {
    const activeAccount = storedAccount("missing", "missing@example.com", true);
    const facade = new AuthFacade(
      new PopupStateStore(),
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        list: async () => [activeAccount],
        readSession: async () => null,
      }),
    );

    const failure = await facade.restoreStartup("additional-window").then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AuthStartupError);
    expect(failure).toMatchObject({ code: "session-missing" });
  });

  it.each([
    ["programming TypeError", () => new TypeError("undefined is not iterable"), "sync-failed"],
    [
      "HTTP response error",
      () => new BitwardenApiError(503, { ErrorModel: { Message: "private server detail" } }),
      "sync-failed",
    ],
    ["typed transport error", () => startupTransportFailure(), "transport"],
  ] as const)(
    "propagates additional-window %s as typed startup code %s",
    async (_label, failureFactory, expectedCode) => {
      const activeAccount = storedAccount("attach-failure", "attach@example.com", true);
      const facade = new AuthFacade(
        new PopupStateStore(),
        null,
        {
          sync: async () => {
            throw failureFactory();
          },
        },
        null,
        undefined,
        accountPort({
          list: async () => [activeAccount],
          readSession: async () => session("attach-failure"),
        }),
      );

      const failure = await facade.restoreStartup("additional-window").then(
        () => null,
        (error: unknown) => error,
      );

      expect(failure).toBeInstanceOf(AuthStartupError);
      expect(failure).toMatchObject({ code: expectedCode });
    },
  );

  it("attaches public process metadata and hydrates omitted vault secrets locally", async () => {
    const source = new PopupStateStore();
    const restoredSession = session("shared-process");
    source.setLockedAccount("shared@example.com", "https://vault.shared.example.com");
    source.setActiveSession(restoredSession);
    source.setUnlocked("shared@example.com");
    source.setItems([processTestItem("process-item", "Process item")]);
    const processSnapshot = brokerSnapshot({
      version: 4,
      authorization: "unlocked",
      activeAccountId: "shared",
      syncState: "fresh",
      sharedSnapshot: encodeProcessSharedPopupState(source.snapshot()),
    });
    const broker = new FakeProcessSessionBroker(processSnapshot);
    const syncCompletion = deferred<VaultSyncResult>();
    const sync = vi.fn(() => syncCompletion.promise);
    const store = new PopupStateStore();
    const facade = new AuthFacade(
      store,
      null,
      { sync },
      null,
      undefined,
      accountPort({
        list: async () => [storedAccount("shared", "shared@example.com", true)],
        readSession: async () => restoredSession,
      }),
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      broker,
    );

    await expect(facade.attachProcessSession(processSnapshot)).resolves.toBe("unlocked");

    expect(store.snapshot()).toMatchObject({
      isUnlocked: true,
      activeSession: restoredSession,
      items: [expect.objectContaining({ id: "process-item" })],
    });
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith(restoredSession));
    syncCompletion.resolve(emptySyncResult());
  });

  it("uses the process-memory handoff before secure storage when a sibling window is already unlocked", async () => {
    const source = new PopupStateStore();
    const restoredSession = session("shared-process-handoff");
    source.setLockedAccount("shared@example.com", "https://vault.shared.example.com");
    source.setActiveSession(restoredSession);
    source.setUnlocked("shared@example.com");
    source.setItems([
      processTestItem("process-handoff-item", "Process handoff item"),
    ]);
    const processSnapshot = brokerSnapshot({
      version: 5,
      authorization: "unlocked",
      activeAccountId: "shared",
      syncState: "fresh",
      sharedSnapshot: encodeProcessSharedPopupState(source.snapshot()),
    });
    const broker = new FakeProcessSessionBroker(processSnapshot, restoredSession);
    const list = vi.fn(async () => {
      throw new Error("Secure storage must not gate a sibling window");
    });
    const store = new PopupStateStore();
    const syncCompletion = deferred<VaultSyncResult>();
    const facade = new AuthFacade(
      store,
      null,
      { sync: vi.fn(() => syncCompletion.promise) },
      null,
      undefined,
      accountPort({ list }),
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      broker,
    );

    await expect(facade.attachProcessSession(processSnapshot)).resolves.toBe("unlocked");

    expect(list).not.toHaveBeenCalled();
    expect(store.snapshot()).toMatchObject({
      isUnlocked: true,
      activeSession: restoredSession,
      items: [expect.objectContaining({ id: "process-handoff-item" })],
    });
    syncCompletion.resolve(emptySyncResult());
  });

  it("publishes the sanitized unlocked snapshot even when the process-memory handoff write fails", async () => {
    const broker = new FakeProcessSessionBroker(brokerSnapshot());
    broker.setSessionHandoff = async () => {
      throw new Error("handoff unavailable");
    };
    const store = new PopupStateStore();
    const activeSession = session("publish-after-handoff-failure");
    store.setLockedAccount("shared@example.com", "https://vault.shared.example.com");
    store.setActiveSession(activeSession);
    store.setUnlocked("shared@example.com");
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      null,
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      broker,
    );
    setRuntimeAccount(facade, "shared");

    await (
      facade as unknown as { publishCurrentUnlockedState(): Promise<void> }
    ).publishCurrentUnlockedState();

    expect(broker.mutations).toContainEqual(expect.objectContaining({
      type: "unlocked",
      activeAccountId: "shared",
      sharedSnapshot: expect.objectContaining({
        isUnlocked: true,
      }),
    }));
    expect(
      broker.mutations.find((mutation) => mutation.type === "unlocked")
        ?.sharedSnapshot,
    ).not.toHaveProperty("activeSession");
  });

  it("classifies an oversized local projection as deterministic without calling the broker", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(session("oversized-projection"));
    store.setUnlocked("shared@example.com");
    store.setItems(Array.from({ length: 8_000 }, (_, index) => ({
      ...processTestItem(`oversized-${index}`, "n".repeat(400)),
    })));
    const broker = new FakeProcessSessionBroker(brokerSnapshot({
      authorization: "unlocked",
      activeAccountId: "shared",
    }));
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      null,
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      broker,
    );

    await expect(facade.publishProcessStateProjection()).resolves.toBeUndefined();
    expect(broker.mutations).toEqual([]);
    expect(store.snapshot().isUnlocked).toBe(true);
  });

  it("returns an attached session before background synchronization and types a programming failure as sync-failed", async () => {
    const syncCompletion = deferred<VaultSyncResult>();
    const restoredSession = session("background-sync");
    const processSnapshot = brokerSnapshot({
      authorization: "unlocked",
      activeAccountId: "shared",
      syncState: "stale",
      failureCode: "transport",
    });
    const broker = new FakeProcessSessionBroker(processSnapshot);
    const store = new PopupStateStore();
    const facade = new AuthFacade(
      store,
      null,
      { sync: vi.fn(() => syncCompletion.promise) },
      null,
      undefined,
      accountPort({
        list: async () => [storedAccount("shared", "shared@example.com", true)],
        readSession: async () => restoredSession,
      }),
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      broker,
    );

    await expect(facade.attachProcessSession(processSnapshot)).resolves.toBe("unlocked");
    expect(store.snapshot()).toMatchObject({
      isUnlocked: true,
      activeSession: restoredSession,
    });
    expect(broker.mutations).toContainEqual({ type: "sync-started" });

    syncCompletion.reject(new TypeError("network unavailable"));
    await vi.waitFor(() =>
      expect(broker.mutations).toContainEqual({
        type: "sync-failed",
        code: "sync-failed",
      }),
    );
    expect(store.snapshot()).toMatchObject({
      isUnlocked: true,
      activeSession: restoredSession,
      vaultSyncStatus: "unavailable",
    });
  });

  it("uses a typed session-missing recovery state only when an unlocked broker has no secure session", async () => {
    const processSnapshot = brokerSnapshot({
      authorization: "unlocked",
      activeAccountId: "shared",
    });
    const broker = new FakeProcessSessionBroker(processSnapshot);
    const store = new PopupStateStore();
    const account = storedAccount("shared", "shared@example.com", true);
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        list: async () => [account],
        readSession: async () => null,
      }),
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      broker,
    );

    await expect(facade.attachProcessSession(processSnapshot)).resolves.toBe("locked");

    expect(broker.mutations).toContainEqual({
      type: "recovery-required",
      activeAccountId: account.id,
      code: "session-missing",
    });
    expect(store.snapshot()).toMatchObject({
      isUnlocked: false,
      email: account.email,
      statusMessage: "会话需要恢复。请重试。",
    });
  });

  it("persists a refreshed Touch ID session before retrying a 401 sync", async () => {
    const store = new PopupStateStore();
    const activeAccount = storedAccount("restore", "restore@example.com", true);
    const restoredSession = session("expired");
    const accountStore = accountPort({
      list: async () => [activeAccount],
      replaceSession: vi.fn(async () => undefined),
    });
    const sync = vi
      .fn()
      .mockRejectedValueOnce(new BitwardenApiError(401, {}))
      .mockResolvedValueOnce(emptySyncResult());

    const facade = new AuthFacade(
      store,
      null,
      { sync },
      null,
      undefined,
      accountStore,
      undefined,
      {
        refresh: async (activeSession) => ({
          ...activeSession,
          token: {
            ...activeSession.token,
            accessToken: "fresh-startup-access",
            refreshToken: "fresh-startup-refresh",
            clientId: "browser" as const,
          },
        }),
      },
      undefined,
      null,
      null,
      unlockMethodsPort({
        unlockWithBiometric: async () => restoredSession,
      }),
    );
    setRuntimeAccount(facade, activeAccount.id);
    store.setLockedAccount(activeAccount.email, activeAccount.serverUrl);

    await expect(facade.unlockWithBiometric()).resolves.toBeUndefined();

    expect(accountStore.replaceSession).toHaveBeenCalled();
    expect(accountStore.replaceSession.mock.calls[0]?.[0]).toBe(activeAccount.id);
    expect(accountStore.replaceSession.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      token: expect.objectContaining({ accessToken: expect.not.stringMatching(/^expired$/) }),
    }));
    expect(sync).toHaveBeenCalledTimes(2);
    expect(store.snapshot()).toMatchObject({
      email: activeAccount.email,
      isUnlocked: true,
      syncError: "",
    });
  });

  it("does not replace the old active account session when new-login initial sync refreshes", async () => {
    const store = new PopupStateStore();
    const oldActiveAccount = storedAccount("old-active", "old@example.com", true);
    const loginSession = session("login-expired");
    const saveAccount = vi.fn(async (_input: {
      readonly email: string;
      readonly serverUrl: string;
      readonly session: AuthSession;
    }) => storedAccount("new-login", "new@example.com", true));
    const replaceSession = vi.fn(async () => undefined);
    const sync = vi
      .fn()
      .mockRejectedValueOnce(new BitwardenApiError(401, {}))
      .mockResolvedValueOnce(emptySyncResult());
    const facade = new AuthFacade(
      store,
      { login: async () => loginSession },
      { sync },
      null,
      undefined,
      accountPort({
        list: async () => [oldActiveAccount],
        saveAccount,
        replaceSession,
      }),
      undefined,
      {
        refresh: async (activeSession) => ({
          ...activeSession,
          token: {
            ...activeSession.token,
            accessToken: "login-fresh",
            refreshToken: "login-fresh-refresh",
            clientId: "browser" as const,
          },
        }),
      },
    );

    await facade.login({
      email: "new@example.com",
      masterPassword: "secret",
      serverUrl: "https://vault.new.example.com",
    });

    expect(replaceSession).not.toHaveBeenCalled();
    expect(saveAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@example.com",
        session: expect.objectContaining({
          token: expect.objectContaining({ accessToken: "login-fresh" }),
        }),
      }),
      expect.any(Function),
    );
    expect(sync).toHaveBeenCalledTimes(2);
    expect(store.snapshot()).toMatchObject({
      email: "new@example.com",
      isUnlocked: true,
      activeSession: { token: { accessToken: "login-fresh" } },
    });
  });

  it("does not start the vault timeout while restoring the locked startup boundary", async () => {
    const store = new PopupStateStore();
    const settings = new SettingsService();
    const vaultTimeout = new VaultTimeoutService(store, settings);
    const activeAccount = storedAccount("restore", "restore@example.com", true);
    settings.useAccount(activeAccount.id);
    settings.setVaultTimeoutMinutes(0);
    const start = vi.spyOn(vaultTimeout, "start");
    const readSession = vi.fn(async () => session("restore"));
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      vaultTimeout,
      undefined,
      accountPort({
        list: async () => [activeAccount],
        readSession,
      }),
    );

    await expect(facade.restoreStartup()).resolves.toBe("locked");

    expect(start).not.toHaveBeenCalled();
    expect(readSession).not.toHaveBeenCalled();
    expect(store.snapshot()).toMatchObject({
      email: activeAccount.email,
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("locks the account index without opening a corrupt startup session", async () => {
    const store = new PopupStateStore();
    const host = new MemoryHostApi();
    const accountStore = new AccountSessionStore(host);
    const account = await accountStore.saveAccount({
      email: "corrupt@example.com",
      serverUrl: "https://vault.corrupt.example.com",
      session: session("corrupt"),
    });
    await host.secureSet(`auth.account.${account.id}`, "{bad json");
    const secureGet = vi.spyOn(host, "secureGet");
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    await expect(facade.restoreStartup()).resolves.toBe("locked");

    expect(secureGet).not.toHaveBeenCalledWith(`auth.account.${account.id}`);
    expect((await facade.accounts())[0]).toMatchObject({ id: account.id, status: "locked", isActive: true });
    expect(store.snapshot()).toMatchObject({
      email: account.email,
      serverUrl: account.serverUrl,
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("does not synchronize an active account during startup", async () => {
    const store = new PopupStateStore();
    const activeAccount = storedAccount("restore", "restore@example.com", true);
    const setStatus = vi.fn(async () => undefined);
    const sync = vi.fn(async () => {
      throw new Error("startup sync must not run");
    });
    const facade = new AuthFacade(
      store,
      null,
      { sync },
      null,
      undefined,
      accountPort({
        list: async () => [activeAccount],
        readSession: async () => session("restore"),
        setStatus,
      }),
    );

    await expect(facade.restoreStartup()).resolves.toBe("locked");

    expect(sync).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(
      activeAccount.id,
      "locked",
      expect.any(Function),
    );
    expect(store.snapshot()).toMatchObject({
      email: activeAccount.email,
      serverUrl: activeAccount.serverUrl,
      isUnlocked: false,
      activeSession: null,
    });
    expect(store.snapshot().syncError).toBe("");
  });

  it("uses a fixed error for a startup account-list failure containing an access token", async () => {
    const store = new PopupStateStore();
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        list: async () => { throw new Error('account list failed: {"accessToken":"opaque-access-token"}'); },
      }),
    );

    await expect(facade.restoreStartup()).rejects.toThrow("Unable to restore saved accounts.");

    expect(store.snapshot().syncError).toBe("Unable to restore saved accounts.");
    expect(store.snapshot().statusMessage).toBe("");
  });

  it.each([
    [new SecureStorageError("unavailable"), "secure-storage"],
    [new SecureStorageError("invalid-key"), "local-data-corrupt"],
    [new TypeError("Failed to fetch"), "unexpected"],
    [new BitwardenApiError(503, {}), "unexpected"],
    [startupTransportFailure(), "transport"],
  ] as const)(
    "propagates startup failure %s as stable code %s without leaking dependency text",
    async (failure, code) => {
      const facade = new AuthFacade(
        new PopupStateStore(),
        null,
        syncPort(),
        null,
        undefined,
        accountPort({
          list: async () => {
            throw failure;
          },
        }),
      );

      const result = await facade.restoreStartup().then(
        () => null,
        (error: unknown) => error,
      );

      expect(result).toBeInstanceOf(AuthStartupError);
      expect(result).toMatchObject({
        name: "AuthStartupError",
        code,
        message: "Unable to restore saved accounts.",
      });
    },
  );

  it("types a bounded account-list timeout at its restore origin", async () => {
    vi.useFakeTimers();
    const facade = new AuthFacade(
      new PopupStateStore(),
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        list: async () => new Promise<readonly StoredAccount[]>(() => undefined),
      }),
      25,
    );

    const restoring = facade.restoreStartup().then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(25);

    await expect(restoring).resolves.toMatchObject({
      name: "AuthStartupError",
      code: "timeout",
    });
  });

  it("keeps a known self-hosted account on the lock screen when startup storage is transiently unavailable", async () => {
    localStorage.setItem(
      "barwarden.active-account-hint.v1",
      JSON.stringify({
        id: "cached-account",
        email: "cached@example.com",
        serverUrl: "https://vault.cached.example.com",
      }),
    );
    const store = new PopupStateStore();
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        list: async () => {
          throw new Error("transient keychain startup failure");
        },
      }),
    );

    await expect(facade.restoreStartup()).resolves.toBe("locked");
    expect(store.snapshot()).toMatchObject({
      email: "cached@example.com",
      serverUrl: "https://vault.cached.example.com",
      isUnlocked: false,
    });
  });

  it("never opens session storage during startup", async () => {
    const store = new PopupStateStore();
    const activeAccount = storedAccount("restore", "restore@example.com", true);
    const readSession = vi.fn(async () => {
      throw new Error("session storage must not be opened");
    });
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        list: async () => [activeAccount],
        readSession,
      }),
    );

    await expect(facade.restoreStartup()).resolves.toBe("locked");

    expect(readSession).not.toHaveBeenCalled();
    expect(store.snapshot()).toMatchObject({
      email: activeAccount.email,
      isUnlocked: false,
      activeSession: null,
      syncError: "",
    });
  });

  it("uses a fixed error for a startup downgrade failure containing a JSON payload", async () => {
    const store = new PopupStateStore();
    const activeAccount = storedAccount("restore", "restore@example.com", true);
    const setStatus = vi.fn(async () => {
      throw new Error('{"error":"status write failed","payload":{"accessToken":"opaque","refreshToken":"opaque","userKeyB64":"MDEyMzQ1Njc4OWFiY2RlZg=="}}');
    });
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        list: async () => [activeAccount],
        readSession: async () => null,
        setStatus,
      }),
    );

    const failure = await facade.restoreStartup().then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toBe("Unable to restore saved accounts.");
    expect(store.snapshot()).toMatchObject({
      email: activeAccount.email,
      serverUrl: activeAccount.serverUrl,
      isUnlocked: false,
      activeSession: null,
    });
    expect(store.snapshot().syncError).toBe("Unable to restore saved accounts.");
    expect(store.snapshot().statusMessage).toBe(translateOfficialMessage("locked"));
  });

  it("does not let a stale startup downgrade rejection overwrite a newer switch state", async () => {
    const store = new PopupStateStore();
    const startupAccount = storedAccount("startup", "startup@example.com", true);
    const switchedAccount = storedAccount("switched", "switched@example.com", false);
    let activeAccountId = startupAccount.id;
    const startupStatus = deferred<void>();
    const setStatus = vi.fn((id: string) => {
      if (id === startupAccount.id) {
        return startupStatus.promise;
      }
      return Promise.resolve();
    });
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        list: async () => [
          { ...startupAccount, isActive: activeAccountId === startupAccount.id },
          { ...switchedAccount, isActive: activeAccountId === switchedAccount.id },
        ],
        setActive: async (id) => {
          if (id !== switchedAccount.id) {
            throw new Error("Unexpected account switch");
          }
          activeAccountId = id;
          return { ...switchedAccount, isActive: true };
        },
        readSession: async (id) => {
          if (id === startupAccount.id) {
            throw new Error("startup secure read failed");
          }
          if (id === switchedAccount.id) {
            return session("switched");
          }
          return null;
        },
        setStatus,
      }),
    );

    const restoring = facade.restoreStartup();
    const restoreResult = restoring.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith(
        startupAccount.id,
        "locked",
        expect.any(Function),
      ),
    );

    await facade.switchAccount(switchedAccount.id);
    startupStatus.reject(new Error("stale status write failed"));

    expect(await restoreResult).toMatchObject({ name: "AccountOperationCancelledError" });
    expect(store.snapshot()).toMatchObject({
      email: switchedAccount.email,
      serverUrl: switchedAccount.serverUrl,
      isUnlocked: true,
      activeSession: { token: { accessToken: "switched" } },
      syncError: "",
      statusMessage: translateOfficialMessage("i18nSyncedVaultData", 0, 0),
    });
  });

  it("rejects a superseded startup restoration with an explicit cancellation error", async () => {
    const store = new PopupStateStore();
    const activeAccount = storedAccount("restore", "restore@example.com", true);
    const statusWrite = deferred<void>();
    let staleWriteCommitted = false;
    const setStatus = vi.fn(async (
      _id: string,
      _status: "unlocked" | "locked",
      isCurrent?: () => boolean,
    ) => {
      await statusWrite.promise;
      if (isCurrent?.()) {
        staleWriteCommitted = true;
      }
    });
    const sync = vi.fn(syncPort().sync);
    const facade = new AuthFacade(
      store,
      { login: async () => session("login") },
      { sync },
      null,
      undefined,
      accountPort({
        list: async () => [activeAccount],
        setStatus,
        saveAccount: async () => storedAccount("login", "login@example.com", true),
      }),
    );

    const restoring = facade.restoreStartup();
    const restoreResult = restoring.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() =>
      expect(setStatus).toHaveBeenCalledWith(
        activeAccount.id,
        "locked",
        expect.any(Function),
      ),
    );

    await facade.login(loginRequest("login@example.com"));
    statusWrite.resolve();

    expect(await restoreResult).toMatchObject({ name: "AccountOperationCancelledError" });
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.objectContaining({ accessToken: "login" }) }),
    );
    expect(setStatus).toHaveBeenCalledOnce();
    expect(setStatus).toHaveBeenCalledWith(
      activeAccount.id,
      "locked",
      expect.any(Function),
    );
    expect(staleWriteCommitted).toBe(false);
    expect(store.snapshot()).toMatchObject({
      email: "login@example.com",
      isUnlocked: true,
      activeSession: { token: { accessToken: "login" } },
    });
  });

  it("switches an unlocked account and synchronizes its stored session", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const firstAccount = await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    await accountStore.saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.two.example.com",
      session: session("two"),
    });
    const sync = vi.fn(syncPort().sync);
    const facade = new AuthFacade(store, null, { sync }, null, undefined, accountStore);

    const result = await facade.switchAccount(firstAccount.id);

    expect(result.status).toBe("unlocked");
    expect(store.snapshot()).toMatchObject({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      isUnlocked: true,
      activeSession: { token: { accessToken: "one" } },
    });
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.objectContaining({ accessToken: "one" }) }),
    );
  });

  it("selects a locked account without restoring a session into runtime state", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const lockedAccount = await accountStore.saveAccount({
      email: "locked@example.com",
      serverUrl: "https://vault.locked.example.com",
      session: session("locked"),
    });
    await accountStore.setStatus(lockedAccount.id, "locked");
    store.setActiveSession(session("current"));
    store.setUnlocked("current@example.com");
    const sync = vi.fn(syncPort().sync);
    const facade = new AuthFacade(store, null, { sync }, null, undefined, accountStore);

    const result = await facade.switchAccount(lockedAccount.id);

    expect(result.status).toBe("locked");
    expect(store.snapshot()).toMatchObject({
      email: "locked@example.com",
      serverUrl: "https://vault.locked.example.com",
      isUnlocked: false,
      activeSession: null,
    });
    expect(sync).not.toHaveBeenCalled();
  });

  it("downgrades an unlocked account with a missing session to locked state", async () => {
    const store = new PopupStateStore();
    const host = new MemoryHostApi();
    const accountStore = new AccountSessionStore(host);
    const account = await accountStore.saveAccount({
      email: "missing@example.com",
      serverUrl: "https://vault.missing.example.com",
      session: session("missing"),
    });
    await host.secureDelete(`auth.account.${account.id}`);
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    const result = await facade.switchAccount(account.id);

    expect(result.status).toBe("locked");
    expect((await facade.accounts())[0]).toMatchObject({ id: account.id, status: "locked", isActive: true });
    expect(store.snapshot().activeSession).toBeNull();
  });

  it("does not install a deferred switched session after lockAll", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(session("current"));
    store.setUnlocked("current@example.com");
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const account = await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    const pendingSession = deferred<AuthSession | null>();
    vi.spyOn(accountStore, "readSession").mockReturnValue(pendingSession.promise);
    const sync = vi.fn(syncPort().sync);
    const facade = new AuthFacade(store, null, { sync }, null, undefined, accountStore);

    const switching = facade.switchAccount(account.id);
    const switchResult = switching.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(accountStore.readSession).toHaveBeenCalledWith(account.id));
    const locking = facade.lockAll();

    expect(store.snapshot().activeSession).toBeNull();
    pendingSession.resolve(session("one"));
    await locking;

    expect(await switchResult).toMatchObject({ name: "AccountOperationCancelledError" });
    expect(store.snapshot()).toMatchObject({ isUnlocked: false, activeSession: null });
    expect((await accountStore.list())[0]?.status).toBe("locked");
    expect(sync).not.toHaveBeenCalled();
  });

  it("keeps the newest account when overlapping switches resolve out of order", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const firstAccount = await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    const secondAccount = await accountStore.saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.two.example.com",
      session: session("two"),
    });
    const firstSync = deferred<ReturnType<typeof emptySyncResult>>();
    const sync = vi.fn(async (activeSession: AuthSession) =>
      activeSession.token.accessToken === "one" ? firstSync.promise : emptySyncResult(),
    );
    const facade = new AuthFacade(store, null, { sync }, null, undefined, accountStore);

    const firstSwitch = facade.switchAccount(firstAccount.id);
    const firstResult = firstSwitch.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.objectContaining({ accessToken: "one" }) }),
    ));
    const secondSwitch = facade.switchAccount(secondAccount.id);
    expect(store.snapshot()).toMatchObject({ isUnlocked: false, activeSession: null });
    firstSync.resolve(emptySyncResult());
    await secondSwitch;

    expect(await firstResult).toMatchObject({ name: "AccountOperationCancelledError" });
    expect(store.snapshot()).toMatchObject({
      email: "two@example.com",
      isUnlocked: true,
      activeSession: { token: { accessToken: "two" } },
    });
    expect(sync).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.objectContaining({ accessToken: "two" }) }),
    );
  });

  it("locks every account and clears the current runtime session", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    await accountStore.saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.two.example.com",
      session: session("two"),
    });
    store.setActiveSession(session("two"));
    store.setUnlocked("two@example.com");
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    await facade.lockAll();

    expect((await facade.accounts()).map((account) => account.status)).toEqual(["locked", "locked"]);
    expect(store.snapshot().activeSession).toBeNull();
    expect(store.snapshot().isUnlocked).toBe(false);
  });

  it("clears an active account before lock persistence and surfaces rejection", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(session("one"));
    store.setUnlocked("one@example.com");
    const persistence = deferred<void>();
    const activeAccount = storedAccount("one", "one@example.com", true);
    const accountStore = accountPort({
      list: async () => [activeAccount],
      setStatus: () => persistence.promise,
    });
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    const locking = facade.lockAccount(activeAccount.id);
    await vi.waitFor(() => expect(store.snapshot()).toMatchObject({ isUnlocked: false, activeSession: null }));
    persistence.reject(new Error("secure status failed"));
    await expect(locking).rejects.toThrow("Unable to save account lock");
    expect(store.snapshot().syncError).toBe("Unable to save account lock.");
    expect(store.snapshot().statusMessage).toBe("Unable to save account lock.");
  });

  it("clears all runtime state before lockAll persistence and surfaces rejection", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(session("one"));
    store.setUnlocked("one@example.com");
    const persistence = deferred<void>();
    const accountStore = accountPort({ lockAll: () => persistence.promise });
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    const locking = facade.lockAll();

    expect(store.snapshot()).toMatchObject({ isUnlocked: false, activeSession: null });
    persistence.reject(new Error("secure lock-all failed"));
    await expect(locking).rejects.toThrow("Unable to save account locks");
    expect(store.snapshot().syncError).toBe("Unable to save account locks.");
    expect(store.snapshot().statusMessage).toBe("Unable to save account locks.");
  });

  it("catches lock persistence rejection without skipping the active account", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(session("one"));
    store.setUnlocked("one@example.com");
    store.setServerUrl("https://vault.one.example.com/");
    const activeAccount = storedAccount("one", "one@example.com", true);
    const setStatus = vi.fn(async () => { throw new Error("secure lock failed"); });
    const accountStore = accountPort({
      list: async () => [activeAccount],
      setStatus,
    });
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    facade.lock();

    expect(store.snapshot()).toMatchObject({ isUnlocked: false, activeSession: null });
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith(activeAccount.id, "locked"));
    await vi.waitFor(() => expect(store.snapshot().syncError).toBe("Unable to save account lock."));
    expect(store.snapshot().statusMessage).toBe("Unable to save account lock.");
  });

  it("removes an inactive account without changing the current runtime identity", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const firstAccount = await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    const activeAccount = await accountStore.saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.two.example.com",
      session: session("two"),
    });
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);
    await facade.switchAccount(activeAccount.id);

    const result = await facade.logoutAccount(firstAccount.id);

    expect(result).toMatchObject({ id: activeAccount.id, isActive: true });
    expect(store.snapshot().email).toBe("two@example.com");
    expect((await facade.accounts()).map((account) => account.id)).toEqual([activeAccount.id]);
  });

  it("clears account-local secrets before removing an account", async () => {
    const store = new PopupStateStore();
    const activeAccount = storedAccount("active", "active@example.com", true);
    const events: string[] = [];
    const accountStore = accountPort({
      list: async () => [activeAccount],
      remove: async (id) => {
        events.push(`remove:${id}`);
        return activeAccount;
      },
    });
    const cleanup: AccountLogoutCleanupPort = {
      clearAccount: async (id) => { events.push(`cleanup:${id}`); },
    };
    vi.spyOn(AuthSessionStore.prototype, "clear").mockImplementation(async () => {
      events.push("legacy-clear");
    });
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountStore,
      undefined,
      null,
      undefined,
      cleanup,
    );

    await facade.logoutAccount(activeAccount.id);

    expect(events).toEqual(["legacy-clear", "cleanup:active", "remove:active"]);
  });

  it("does not clear the active legacy session when removing an inactive account", async () => {
    const store = new PopupStateStore();
    const activeAccount = storedAccount("active", "active@example.test", true);
    const inactiveAccount = storedAccount("inactive", "inactive@example.test", false);
    let accounts = [activeAccount, inactiveAccount];
    const remove = vi.fn(async (id: string) => {
      const removed = accounts.find((account) => account.id === id) ?? null;
      accounts = accounts.filter((account) => account.id !== id);
      return removed;
    });
    const accountStore = accountPort({ list: async () => accounts, remove });
    const clearSpy = vi.spyOn(AuthSessionStore.prototype, "clear").mockResolvedValue();
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    await facade.logoutAccount(inactiveAccount.id);

    expect(clearSpy).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(inactiveAccount.id);
  });

  it("keeps the account locked and stored when local secret cleanup fails", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(session("active"));
    store.setUnlocked("active@example.com");
    const activeAccount = storedAccount("active", "active@example.com", true);
    const remove = vi.fn(async () => activeAccount);
    const setStatus = vi.fn(async () => undefined);
    const accountStore = accountPort({
      list: async () => [activeAccount],
      remove,
      setStatus,
    });
    const cleanup: AccountLogoutCleanupPort = {
      clearAccount: vi.fn(async () => { throw new Error("secret cleanup failed"); }),
    };
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountStore,
      undefined,
      null,
      undefined,
      cleanup,
    );

    await expect(facade.logoutAccount(activeAccount.id)).rejects.toThrow("Unable to log out account");

    expect(remove).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(activeAccount.id, "locked");
    expect(store.snapshot()).toMatchObject({ isUnlocked: false, email: activeAccount.email });
    expect(store.snapshot().syncError).toBe("Unable to log out account.");
  });

  it("selects and synchronizes the next account after logging out the active account", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const nextAccount = await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    const activeAccount = await accountStore.saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.two.example.com",
      session: session("two"),
    });
    const sync = vi.fn(syncPort().sync);
    const facade = new AuthFacade(store, null, { sync }, null, undefined, accountStore);

    const result = await facade.logoutAccount(activeAccount.id);

    expect(result).toMatchObject({ id: nextAccount.id, isActive: true, status: "unlocked" });
    expect(store.snapshot()).toMatchObject({ email: "one@example.com", isUnlocked: true });
    expect(sync).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.objectContaining({ accessToken: "one" }) }),
    );
  });

  it("clears removed active runtime and stays safe when successor activation fails", async () => {
    const store = new PopupStateStore();
    store.setActiveSession(session("active"));
    store.setUnlocked("active@example.com");
    const activeAccount = storedAccount("active", "active@example.com", true);
    const nextAccount = storedAccount("next", "next@example.com", false);
    let removed = false;
    let runtimeSessionAtRemove: AuthSession | null | undefined;
    const accountStore = accountPort({
      list: async () => removed ? [nextAccount] : [activeAccount, nextAccount],
      remove: async () => {
        runtimeSessionAtRemove = store.snapshot().activeSession;
        removed = true;
        return activeAccount;
      },
      setActive: async () => { throw new Error("successor activation failed"); },
    });
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    await expect(facade.logoutAccount(activeAccount.id)).resolves.toBeNull();

    expect(runtimeSessionAtRemove).toBeNull();
    expect(store.snapshot()).toMatchObject({
      email: "",
      isUnlocked: false,
      activeSession: null,
    });
    expect((await accountStore.list()).some((account) => account.isActive)).toBe(false);
    expect(store.snapshot().syncError).toBe("Unable to activate another account.");
  });

  it("locks and surfaces a successor synchronization failure", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const nextAccount = await accountStore.saveAccount({
      email: "next@example.com",
      serverUrl: "https://vault.next.example.com",
      session: session("next"),
    });
    const activeAccount = await accountStore.saveAccount({
      email: "active@example.com",
      serverUrl: "https://vault.active.example.com",
      session: session("active"),
    });
    store.setActiveSession(session("active"));
    store.setUnlocked("active@example.com");
    const facade = new AuthFacade(
      store,
      null,
      { sync: async () => { throw new Error("successor sync failed"); } },
      null,
      undefined,
      accountStore,
    );

    const result = await facade.logoutAccount(activeAccount.id);

    expect(result).toMatchObject({ id: nextAccount.id, status: "locked", isActive: true });
    expect(store.snapshot()).toMatchObject({
      email: "next@example.com",
      isUnlocked: false,
      activeSession: null,
    });
    expect(store.snapshot().syncError).toBe("Unable to synchronize account.");
  });

  it("logs out when the last account is removed", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const account = await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    store.setActiveSession(session("one"));
    store.setUnlocked("one@example.com");
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    await expect(facade.logoutAccount(account.id)).resolves.toBeNull();

    expect(await facade.accounts()).toEqual([]);
    expect(store.snapshot()).toMatchObject({ email: "", activeSession: null, isUnlocked: false });
  });

  it("keeps legacy logout compatibility while removing the active registry account", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    store.setActiveSession(session("one"));
    store.setUnlocked("one@example.com");
    const clearSpy = vi.spyOn(AuthSessionStore.prototype, "clear").mockResolvedValue();
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    await facade.logout();

    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(await facade.accounts()).toEqual([]);
    expect(store.snapshot().email).toBe("");
  });

  it("restores the prior popup state when a sixth account cannot be registered", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    for (let index = 1; index <= AccountSessionStore.ACCOUNT_LIMIT; index += 1) {
      await accountStore.saveAccount({
        email: `user${index}@example.com`,
        serverUrl: `https://vault.user${index}.example.com`,
        session: session(`token-${index}`),
      });
    }
    store.setServerUrl("https://vault.user5.example.com");
    store.setActiveSession(session("token-5"));
    store.setUnlocked("user5@example.com");
    store.setItems([{
      id: "prior-item",
      name: "Prior item",
      subtitle: "user5@example.com",
      uri: "https://example.com",
      favorite: false,
      fields: [],
    }]);
    const previousState = store.snapshot();
    const facade = new AuthFacade(store, { login: async () => session("token-6") }, syncPort(), null, undefined, accountStore);

    await facade.login(loginRequest("user6@example.com"));

    expect(await facade.accounts()).toHaveLength(AccountSessionStore.ACCOUNT_LIMIT);
    expect(store.snapshot()).toMatchObject({
      email: previousState.email,
      serverUrl: previousState.serverUrl,
      isUnlocked: true,
      activeSession: previousState.activeSession,
      items: previousState.items,
    });
    expect(store.snapshot().loginError).toBe("保存账户失败。请重试。");
    expect(store.snapshot().loginError).not.toContain("Account limit reached");
  });

  it.each(["lock", "switch", "logout"] as const)(
    "cancels a deferred login when %s supersedes it",
    async (action) => {
      const store = new PopupStateStore();
      const accountStore = new AccountSessionStore(new MemoryHostApi());
      const nextAccount = await accountStore.saveAccount({
        email: "next@example.com",
        serverUrl: "https://vault.next.example.com",
        session: session("next"),
      });
      const currentAccount = await accountStore.saveAccount({
        email: "current@example.com",
        serverUrl: "https://vault.current.example.com",
        session: session("current"),
      });
      setPriorPopupState(store);
      const pendingLogin = deferred<AuthSession>();
      const facade = new AuthFacade(
        store,
        { login: () => pendingLogin.promise },
        syncPort(),
        null,
        undefined,
        accountStore,
      );
      const login = facade.login(loginRequest("attempt@example.com"));

      let lifecycle: Promise<unknown> = Promise.resolve();
      if (action === "lock") {
        facade.lock();
      } else if (action === "switch") {
        lifecycle = facade.switchAccount(nextAccount.id);
      } else {
        lifecycle = facade.logoutAccount(currentAccount.id);
      }
      pendingLogin.resolve(session("attempt"));
      await Promise.all([login, lifecycle]);

      expect((await facade.accounts()).map((account) => account.email)).not.toContain("attempt@example.com");
      if (action === "lock") {
        await vi.waitFor(async () => expect((await facade.accounts())[0]?.status).toBe("locked"));
        expect(store.snapshot()).toMatchObject({
          email: "current@example.com",
          serverUrl: "https://vault.current.example.com",
          isUnlocked: false,
          activeSession: null,
        });
      } else {
        expect(store.snapshot()).toMatchObject({
          email: "next@example.com",
          isUnlocked: true,
          activeSession: { token: { accessToken: "next" } },
        });
      }
    },
  );

  it("cancels a deferred two-factor completion when lock supersedes it", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    await accountStore.saveAccount({
      email: "current@example.com",
      serverUrl: "https://vault.current.example.com",
      session: session("current"),
    });
    const challengeCompletion = deferred<AuthSession>();
    const login = vi.fn(async (request: any) => {
      if (!request.twoFactor) {
        throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
      }
      return challengeCompletion.promise;
    });
    const facade = new AuthFacade(store, { login }, syncPort(), null, undefined, accountStore);
    await facade.login(loginRequest("attempt@example.com"));
    const completion = facade.submitTwoFactor({ provider: 0, token: "123456" });
    await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(2));

    facade.lock();
    challengeCompletion.resolve(session("attempt"));
    await completion;

    expect(store.snapshot()).toMatchObject({ isUnlocked: false, activeSession: null, authChallenge: null });
    expect((await facade.accounts()).map((account) => account.email)).toEqual(["current@example.com"]);
  });

  it("restores prior popup state after a current login failure", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const prior = store.snapshot();
    const facade = new AuthFacade(store, { login: async () => { throw new Error("private server body"); } });

    await facade.login(loginRequest("attempt@example.com"));

    expect(store.snapshot()).toMatchObject({
      email: prior.email,
      serverUrl: prior.serverUrl,
      isUnlocked: prior.isUnlocked,
      activeSession: prior.activeSession,
      items: prior.items,
    });
    expect(store.snapshot().loginError).toBe("无法登录。请重试。");
    expect(store.snapshot().loginError).not.toContain("private server body");
  });

  it("keeps prior decrypted state hidden while a failed challenge remains retryable", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const prior = store.snapshot();
    const login = vi.fn(async (request: any) => {
      if (!request.twoFactor) {
        throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
      }
      throw new Error("bad token with private response");
    });
    const facade = new AuthFacade(store, { login });

    await facade.login(loginRequest("attempt@example.com"));
    expect(store.snapshot()).toMatchObject({
      email: "attempt@example.com",
      serverUrl: "https://vault.attempt.example.com",
      isUnlocked: false,
      activeSession: null,
      items: [],
    });
    await facade.submitTwoFactor({ provider: 0, token: "bad" });

    expect(store.snapshot()).toMatchObject({
      email: "attempt@example.com",
      serverUrl: "https://vault.attempt.example.com",
      isUnlocked: false,
      activeSession: null,
      items: [],
      authChallenge: { type: "twoFactor" },
    });
    expect(store.snapshot().loginError).toBe("无法登录。请重试。");
  });

  it("leaves prior runtime untouched when selecting an account fails", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const prior = store.snapshot();
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({ setActive: async () => { throw new Error("select failed with secret"); } }),
    );

    await expect(facade.switchAccount("missing")).rejects.toThrow();

    expect(store.snapshot()).toMatchObject({
      email: prior.email,
      serverUrl: prior.serverUrl,
      isUnlocked: true,
      activeSession: prior.activeSession,
      items: prior.items,
    });
    expect(store.snapshot().syncError).toBe("Unable to switch account.");
  });

  it("locks the selected identity and registry when reading its session rejects", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const selected = storedAccount("selected", "selected@example.com", true);
    const setStatus = vi.fn(async () => undefined);
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        setActive: async () => selected,
        list: async () => [selected],
        readSession: async () => { throw new Error("read failed with token eyJsecret"); },
        setStatus,
      }),
    );

    await expect(facade.switchAccount(selected.id)).rejects.toThrow();

    expect(setStatus).toHaveBeenCalledWith(selected.id, "locked", expect.any(Function));
    expect(store.snapshot()).toMatchObject({
      email: "selected@example.com",
      isUnlocked: false,
      activeSession: null,
    });
    expect(store.snapshot().syncError).toBe("Unable to switch account.");
  });

  it("rejects a superseded switch with an explicit cancellation error", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const first = await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    const second = await accountStore.saveAccount({
      email: "two@example.com",
      serverUrl: "https://vault.two.example.com",
      session: session("two"),
    });
    const read = deferred<AuthSession | null>();
    vi.spyOn(accountStore, "readSession").mockImplementation((id) =>
      id === first.id ? read.promise : Promise.resolve(session("two")),
    );
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);
    const staleSwitch = facade.switchAccount(first.id);
    await vi.waitFor(() => expect(accountStore.readSession).toHaveBeenCalledWith(first.id));
    const currentSwitch = facade.switchAccount(second.id);
    read.resolve(session("one"));

    await expect(staleSwitch).rejects.toMatchObject({ name: "AccountOperationCancelledError" });
    await currentSwitch;
  });

  it("locks an inactive account without clearing the active runtime", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const inactive = await accountStore.saveAccount({
      email: "inactive@example.com",
      serverUrl: "https://vault.inactive.example.com",
      session: session("inactive"),
    });
    const active = await accountStore.saveAccount({
      email: "active@example.com",
      serverUrl: "https://vault.active.example.com",
      session: session("active"),
    });
    store.setServerUrl(active.serverUrl);
    store.setActiveSession(session("active"));
    store.setUnlocked(active.email);
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    await facade.lockAccount(inactive.id);

    expect(store.snapshot()).toMatchObject({
      email: active.email,
      isUnlocked: true,
      activeSession: { token: { accessToken: "active" } },
    });
    expect((await accountStore.list()).find((account) => account.id === inactive.id)?.status).toBe("locked");
  });

  it("keeps the removed account identity locked when active removal rejects", async () => {
    const store = new PopupStateStore();
    const active = storedAccount("active", "active@example.com", true);
    const next = storedAccount("next", "next@example.com", false);
    const remove = vi.fn(async () => { throw new Error("remove failed"); });
    const accountStore = accountPort({ list: async () => [active, next], remove });
    store.setServerUrl(active.serverUrl);
    store.setActiveSession(session("active"));
    store.setUnlocked(active.email);
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    await expect(facade.logoutAccount(active.id)).rejects.toThrow("Unable to log out account");

    expect(remove).toHaveBeenCalledWith(active.id);
    expect((await accountStore.list()).find((account) => account.isActive)?.id).toBe(active.id);
    expect(store.snapshot()).toMatchObject({ email: active.email, isUnlocked: false, activeSession: null });
  });

  it("does not remove an account after logout is superseded", async () => {
    const store = new PopupStateStore();
    const active = storedAccount("active", "active@example.com", true);
    const pendingList = deferred<readonly StoredAccount[]>();
    const list = vi.fn()
      .mockReturnValueOnce(pendingList.promise)
      .mockResolvedValue([active]);
    const remove = vi.fn(async () => active);
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({ list, remove }),
    );
    const logout = facade.logoutAccount(active.id);
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    facade.lock();
    pendingList.resolve([active]);

    await expect(logout).rejects.toMatchObject({ name: "AccountOperationCancelledError" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("bounds a hung session read so a later lockAll completes", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const account = await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    const read = deferred<AuthSession | null>();
    const readStarted = deferred<void>();
    vi.spyOn(accountStore, "readSession").mockImplementation(() => {
      readStarted.resolve();
      return read.promise;
    });
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore, 10);
    const switching = facade.switchAccount(account.id);
    const switchResult = switching.then(
      () => null,
      (error: unknown) => error,
    );
    await readStarted.promise;
    let lockResolved = false;
    const locking = facade.lockAll().then(() => { lockResolved = true; });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect.soft(lockResolved).toBe(true);
    read.resolve(session("one"));
    await locking;

    expect(lockResolved).toBe(true);
    expect(await switchResult).toMatchObject({ name: "AccountOperationCancelledError" });
    expect(store.snapshot()).toMatchObject({ isUnlocked: false, activeSession: null });
  });

  it("bounds a hung switch sync so active logout clears immediately and completes", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const account = await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    const sync = deferred<ReturnType<typeof emptySyncResult>>();
    const syncStarted = deferred<void>();
    const syncFn = vi.fn(() => {
      syncStarted.resolve();
      return sync.promise;
    });
    const facade = new AuthFacade(store, null, { sync: syncFn }, null, undefined, accountStore, 10);
    const switching = facade.switchAccount(account.id);
    const switchResult = switching.then(
      () => null,
      (error: unknown) => error,
    );
    await syncStarted.promise;
    let logoutResolved = false;
    const logout = facade.logoutAccount(account.id).then(() => { logoutResolved = true; });

    expect(store.snapshot()).toMatchObject({ isUnlocked: false, activeSession: null });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect.soft(logoutResolved).toBe(true);
    sync.resolve(emptySyncResult());
    await logout;

    expect(logoutResolved).toBe(true);
    expect(await switchResult).toMatchObject({ name: "AccountOperationCancelledError" });
    expect(store.snapshot()).toMatchObject({ email: "", isUnlocked: false, activeSession: null });
  });

  it("invalidates a timed login before its Identity request resolves late", async () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const baseline = store.snapshot();
    const identity = deferred<AuthSession>();
    const saveAccount = vi.fn();
    const facade = new AuthFacade(
      store,
      { login: () => identity.promise },
      syncPort(),
      null,
      10,
      accountPort({ saveAccount }),
    );
    const login = facade.login(loginRequest("attempt@example.com"));

    await vi.advanceTimersByTimeAsync(10);
    await login;
    const timedOutState = store.snapshot();
    identity.resolve(session("attempt"));
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(timedOutState).toMatchObject({
      email: baseline.email,
      serverUrl: baseline.serverUrl,
      activeSession: baseline.activeSession,
      items: baseline.items,
    });
    expect(store.snapshot()).toEqual(timedOutState);
    expect(saveAccount).not.toHaveBeenCalled();
  });

  it("invalidates a timed challenge before its Identity request resolves late", async () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const baseline = store.snapshot();
    const completion = deferred<AuthSession>();
    const loginPort = vi.fn(async (request: any) => {
      if (!request.twoFactor) {
        throw new Error(JSON.stringify({ TwoFactorProviders2: { 0: null } }));
      }
      return completion.promise;
    });
    const facade = new AuthFacade(store, { login: loginPort }, syncPort(), null, 10);
    await facade.login(loginRequest("attempt@example.com"));
    const challenge = facade.submitTwoFactor({ provider: 0, token: "123456" });

    await vi.advanceTimersByTimeAsync(10);
    await challenge;
    const timedOutState = store.snapshot();
    completion.resolve(session("attempt"));
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(timedOutState).toMatchObject({
      email: baseline.email,
      serverUrl: baseline.serverUrl,
      activeSession: baseline.activeSession,
      items: baseline.items,
      authChallenge: null,
    });
    expect(store.snapshot()).toEqual(timedOutState);
  });

  it("cancels an in-flight switch when a new login starts", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const selected = storedAccount("selected", "selected@example.com", true);
    const read = deferred<AuthSession | null>();
    const accountStore = accountPort({
      setActive: async () => selected,
      list: async () => [selected],
      readSession: () => read.promise,
      setStatus: async () => undefined,
      saveAccount: async () => storedAccount("login", "login@example.com", true),
    });
    const facade = new AuthFacade(store, { login: async () => session("login") }, syncPort(), null, undefined, accountStore);
    const switching = facade.switchAccount(selected.id);
    const switchResult = switching.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(store.snapshot().email).toBe("selected@example.com"));

    const login = facade.login(loginRequest("login@example.com"));
    read.resolve(session("selected"));
    await login;

    expect(await switchResult).toMatchObject({ name: "AccountOperationCancelledError" });
    expect(store.snapshot()).toMatchObject({
      email: "login@example.com",
      isUnlocked: true,
      activeSession: { token: { accessToken: "login" } },
    });
  });

  it("does not let an older failed switch lock the same account after a newer switch succeeds", async () => {
    const store = new PopupStateStore();
    const accountStore = new AccountSessionStore(new MemoryHostApi());
    const account = await accountStore.saveAccount({
      email: "one@example.com",
      serverUrl: "https://vault.one.example.com",
      session: session("one"),
    });
    const firstSync = deferred<ReturnType<typeof emptySyncResult>>();
    const firstSyncStarted = deferred<void>();
    let syncCalls = 0;
    const sync = vi.fn(async () => {
      syncCalls += 1;
      if (syncCalls === 1) {
        firstSyncStarted.resolve();
        return firstSync.promise;
      }
      return emptySyncResult();
    });
    const facade = new AuthFacade(store, null, { sync }, null, undefined, accountStore);

    const olderSwitch = facade.switchAccount(account.id);
    await firstSyncStarted.promise;
    const newerSwitch = facade.switchAccount(account.id);
    await newerSwitch;

    firstSync.reject(new Error("older synchronization failed"));
    await expect(olderSwitch).rejects.toMatchObject({ name: "AccountOperationCancelledError" });

    expect((await accountStore.list())[0]).toMatchObject({ id: account.id, status: "unlocked" });
    expect(store.snapshot()).toMatchObject({
      email: "one@example.com",
      isUnlocked: true,
      activeSession: { token: { accessToken: "one" } },
    });
  });

  it("restores the auth baseline before lock clears a temporary login session", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const sync = deferred<ReturnType<typeof emptySyncResult>>();
    const syncStarted = deferred<void>();
    const facade = new AuthFacade(
      store,
      { login: async () => session("attempt") },
      { sync: () => { syncStarted.resolve(); return sync.promise; } },
    );
    const login = facade.login(loginRequest("attempt@example.com"));
    await syncStarted.promise;
    expect(store.snapshot().email).toBe("attempt@example.com");

    facade.lock();

    expect(store.snapshot()).toMatchObject({
      email: "current@example.com",
      serverUrl: "https://vault.current.example.com",
      isUnlocked: false,
      activeSession: null,
    });
    const lockedState = store.snapshot();
    sync.resolve(emptySyncResult());
    await login;
    expect(store.snapshot()).toEqual(lockedState);
  });

  it("rejects a missing-session downgrade when locking registry status fails", async () => {
    const store = new PopupStateStore();
    const selected = storedAccount("selected", "selected@example.com", true);
    const accountStore = accountPort({
      setActive: async () => selected,
      list: async () => [selected],
      readSession: async () => null,
      setStatus: async () => { throw new Error("status write failed"); },
    });
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    await expect(facade.switchAccount(selected.id)).rejects.toThrow("status write failed");
    expect(store.snapshot()).toMatchObject({
      email: "selected@example.com",
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("keeps the active locked identity when logout wrapper removal fails", async () => {
    const store = new PopupStateStore();
    const active = storedAccount("active", "active@example.com", true);
    const accountStore = accountPort({
      list: async () => [active],
      remove: async () => { throw new Error("remove failed"); },
      setStatus: async () => undefined,
    });
    store.setServerUrl(active.serverUrl);
    store.setActiveSession(session("active"));
    store.setUnlocked(active.email);
    const clearSpy = vi.spyOn(AuthSessionStore.prototype, "clear").mockResolvedValue();
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    await expect(facade.logout()).rejects.toThrow("Unable to log out account");

    expect(clearSpy).toHaveBeenCalledOnce();
    expect(store.snapshot()).toMatchObject({
      email: active.email,
      isUnlocked: false,
      activeSession: null,
    });
    expect((await accountStore.list()).find((account) => account.isActive)?.id).toBe(active.id);
  });

  it("rejects a stale logout instead of resolving after a newer lifecycle operation", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const clear = deferred<void>();
    vi.spyOn(AuthSessionStore.prototype, "clear").mockReturnValue(clear.promise);
    const facade = new AuthFacade(store);

    const logout = facade.logout();
    const logoutResult = logout.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(AuthSessionStore.prototype.clear).toHaveBeenCalledOnce());
    facade.lock();
    clear.resolve();

    expect(await logoutResult).toMatchObject({ name: "AccountOperationCancelledError" });
  });

  it("cancels the first of two rapid facade logouts and removes the account only once", async () => {
    const store = new PopupStateStore();
    const active = storedAccount("active", "active@example.test", true);
    const firstClear = deferred<void>();
    const clearSpy = vi.spyOn(AuthSessionStore.prototype, "clear")
      .mockReturnValueOnce(firstClear.promise)
      .mockResolvedValueOnce();
    const remove = vi.fn(async () => active);
    const accountStore = accountPort({
      list: async () => remove.mock.calls.length === 0 ? [active] : [],
      remove,
      setStatus: async () => undefined,
    });
    store.setServerUrl(active.serverUrl);
    store.setActiveSession(session("active"));
    store.setUnlocked(active.email);
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    const first = facade.logout();
    const firstResult = first.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(clearSpy).toHaveBeenCalledTimes(1));
    const second = facade.logout();
    firstClear.resolve();
    await second;

    expect(await firstResult).toMatchObject({ name: "AccountOperationCancelledError" });
    expect(clearSpy).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("rejects logoutAccount when a newer lifecycle operation supersedes account removal", async () => {
    const store = new PopupStateStore();
    const active = storedAccount("active", "active@example.test", true);
    const target = storedAccount("target", "target@example.test", false);
    const removal = deferred<typeof target>();
    const remove = vi.fn(() => removal.promise);
    const accountStore = accountPort({ list: async () => [active, target], remove });
    store.setServerUrl(active.serverUrl);
    store.setActiveSession(session("active"));
    store.setUnlocked(active.email);
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    const logout = facade.logoutAccount(target.id);
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    facade.lock();
    removal.resolve(target);

    await expect(logout).rejects.toMatchObject({ name: "AccountOperationCancelledError" });
  });

  it("requires legacy Keychain cleanup before removing the active registry account", async () => {
    const store = new PopupStateStore();
    const active = storedAccount("active", "active@example.test", true);
    const remove = vi.fn(async () => active);
    const setStatus = vi.fn(async () => undefined);
    const accountStore = accountPort({ list: async () => [active], remove, setStatus });
    store.setServerUrl(active.serverUrl);
    store.setActiveSession(session("active"));
    store.setUnlocked(active.email);
    vi.spyOn(AuthSessionStore.prototype, "clear").mockRejectedValue(new Error("legacy secure delete failed"));
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    await expect(facade.logout()).rejects.toMatchObject({ name: "AccountLogoutRetainedError" });

    expect(remove).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(active.id, "locked");
    expect(store.snapshot()).toMatchObject({
      email: active.email,
      serverUrl: active.serverUrl,
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("requires legacy Keychain cleanup for direct active logoutAccount", async () => {
    const store = new PopupStateStore();
    const active = storedAccount("active", "active@example.test", true);
    const remove = vi.fn(async () => active);
    const setStatus = vi.fn(async () => undefined);
    const accountStore = accountPort({ list: async () => [active], remove, setStatus });
    store.setServerUrl(active.serverUrl);
    store.setActiveSession(session("active"));
    store.setUnlocked(active.email);
    const clearSpy = vi.spyOn(AuthSessionStore.prototype, "clear")
      .mockRejectedValue(new Error("legacy secure delete failed"));
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);

    await expect(facade.logoutAccount(active.id)).rejects.toMatchObject({
      name: "AccountLogoutRetainedError",
    });

    expect(clearSpy).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(active.id, "locked");
    expect(store.snapshot()).toMatchObject({
      email: active.email,
      serverUrl: active.serverUrl,
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("clears runtime while an unbounded setActive settles and rejects it when superseded", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const first = storedAccount("first", "first@example.com", true);
    const second = storedAccount("second", "second@example.com", true);
    const firstActivation = deferred<StoredAccount>();
    const setActive = vi.fn()
      .mockReturnValueOnce(firstActivation.promise)
      .mockResolvedValueOnce(second);
    const accountStore = accountPort({
      setActive,
      list: async () => [second],
      readSession: async () => session("second"),
      setStatus: async () => undefined,
    });
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);
    const stale = facade.switchAccount(first.id);
    const staleResult = stale.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(setActive).toHaveBeenCalledTimes(1));

    const current = facade.switchAccount(second.id);
    expect(store.snapshot()).toMatchObject({ isUnlocked: false, activeSession: null });
    firstActivation.resolve(first);
    await current;

    expect(await staleResult).toMatchObject({ name: "AccountOperationCancelledError" });
    expect(store.snapshot().email).toBe("second@example.com");
  });

  it("lets lock win after an unbounded account save settles late", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const current = storedAccount("current", "current@example.com", true);
    const added = storedAccount("added", "added@example.com", true);
    let accounts: StoredAccount[] = [current];
    const save = deferred<StoredAccount>();
    const saveAccount = vi.fn(() => save.promise);
    const setStatus = vi.fn(async (id: string, status: "unlocked" | "locked") => {
      accounts = accounts.map((account) => account.id === id ? { ...account, status } : account);
    });
    const accountStore = accountPort({
      list: async () => accounts,
      saveAccount,
      setStatus,
    });
    const facade = new AuthFacade(
      store,
      { login: async () => session("added") },
      syncPort(),
      null,
      undefined,
      accountStore,
    );
    const login = facade.login(loginRequest("added@example.com"));
    await vi.waitFor(() => expect(saveAccount).toHaveBeenCalled());

    facade.lock();
    accounts = [{ ...current, isActive: false }, added];
    save.resolve(added);
    await login;
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith(added.id, "locked"));

    expect(accounts.find((account) => account.id === added.id)?.status).toBe("locked");
    expect(store.snapshot()).toMatchObject({
      email: "current@example.com",
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("lets a newer switch win after an unbounded remove settles late", async () => {
    const store = new PopupStateStore();
    const host = new DeferredDeleteHost();
    const accountStore = new AccountSessionStore(host);
    const next = await accountStore.saveAccount({
      email: "next@example.com",
      serverUrl: "https://vault.next.example.com",
      session: session("next"),
    });
    const active = await accountStore.saveAccount({
      email: "active@example.com",
      serverUrl: "https://vault.active.example.com",
      session: session("active"),
    });
    store.setServerUrl(active.serverUrl);
    store.setActiveSession(session("active"));
    store.setUnlocked(active.email);
    host.deferDeletes = true;
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);
    const logout = facade.logoutAccount(active.id);
    const logoutResult = logout.then(() => null, (error: unknown) => error);
    await host.deleteStarted.promise;

    const switching = facade.switchAccount(next.id);
    host.releaseDelete();
    await switching;

    expect(await logoutResult).toMatchObject({ name: "AccountOperationCancelledError" });
    expect((await accountStore.list())[0]).toMatchObject({ id: next.id, isActive: true });
    expect(store.snapshot()).toMatchObject({
      email: next.email,
      isUnlocked: true,
      activeSession: { token: { accessToken: "next" } },
    });
  });

  it.each([
    ["first login", false],
    ["add account", true],
  ] as const)("hides synchronized candidate state while %s save is pending", async (_case, hasBaseline) => {
    const store = new PopupStateStore();
    if (hasBaseline) {
      setPriorPopupState(store);
    }
    const baseline = store.snapshot();
    const save = deferred<StoredAccount>();
    const saveAccount = vi.fn(() => save.promise);
    const accountStore = accountPort({ saveAccount });
    const facade = new AuthFacade(
      store,
      { login: async () => session("candidate") },
      syncPort(),
      null,
      undefined,
      accountStore,
    );
    const login = facade.login(loginRequest("candidate@example.com"));
    await vi.waitFor(() => expect(saveAccount).toHaveBeenCalled());

    expect(store.snapshot()).toMatchObject({
      email: baseline.email,
      serverUrl: baseline.serverUrl,
      isUnlocked: baseline.isUnlocked,
      activeSession: baseline.activeSession,
      items: baseline.items,
    });

    save.resolve(storedAccount("candidate", "candidate@example.com", true));
    await login;
    expect(store.snapshot()).toMatchObject({
      email: "candidate@example.com",
      isUnlocked: true,
      activeSession: { token: { accessToken: "candidate" } },
    });
  });

  it("does not let a superseded logout postlude overwrite a newer login", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const clear = deferred<void>();
    vi.spyOn(AuthSessionStore.prototype, "clear").mockReturnValue(clear.promise);
    const loginPort = vi.fn(async () => session("new-login"));
    const facade = new AuthFacade(store, { login: loginPort }, syncPort());
    const logout = facade.logout();
    const logoutResult = logout.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(AuthSessionStore.prototype.clear).toHaveBeenCalled());

    await facade.login(loginRequest("new@example.com"));
    const newLoginState = store.snapshot();
    clear.resolve();
    expect(await logoutResult).toMatchObject({ name: "AccountOperationCancelledError" });

    expect(store.snapshot()).toEqual(newLoginState);
    expect(store.snapshot()).toMatchObject({
      email: "new@example.com",
      isUnlocked: true,
      activeSession: { token: { accessToken: "new-login" } },
    });
  });

  it("revokes timed-out switch cleanup writes when a newer login starts", async () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const selected = storedAccount("selected", "selected@example.com", true);
    const statusWrite = deferred<void>();
    const syncPending = deferred<ReturnType<typeof emptySyncResult>>();
    const sync = vi.fn()
      .mockReturnValueOnce(syncPending.promise)
      .mockResolvedValueOnce(emptySyncResult());
    const setStatus = vi.fn(() => statusWrite.promise);
    const accountStore = accountPort({
      setActive: async () => selected,
      list: async () => [selected],
      readSession: async () => session("selected"),
      setStatus,
      saveAccount: async () => storedAccount("new", "new@example.com", true),
    });
    const facade = new AuthFacade(
      store,
      { login: async () => session("new") },
      { sync },
      null,
      undefined,
      accountStore,
      10,
    );
    const switching = facade.switchAccount(selected.id);
    const switchResult = switching.then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalled());

    await facade.login(loginRequest("new@example.com"));
    const newerState = store.snapshot();
    statusWrite.resolve();
    await switchResult;

    expect(store.snapshot()).toEqual(newerState);
    expect(store.snapshot()).toMatchObject({
      email: "new@example.com",
      isUnlocked: true,
      activeSession: { token: { accessToken: "new" } },
    });
  });

  it("does not enqueue a stale lock after an overlapping same-account switch", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const account = storedAccount("same", "same@example.com", true);
    const firstActivation = deferred<StoredAccount>();
    const setActive = vi.fn()
      .mockReturnValueOnce(firstActivation.promise)
      .mockResolvedValueOnce(account);
    const setStatus = vi.fn(async () => undefined);
    const accountStore = accountPort({
      setActive,
      list: async () => [account],
      readSession: async () => session("same"),
      setStatus,
    });
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);
    const stale = facade.switchAccount(account.id);
    const staleResult = stale.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(setActive).toHaveBeenCalledTimes(1));
    const current = facade.switchAccount(account.id);
    firstActivation.resolve(account);
    await current;

    expect(await staleResult).toMatchObject({ name: "AccountOperationCancelledError" });
    expect(setStatus).not.toHaveBeenCalled();
    expect(store.snapshot()).toMatchObject({ email: account.email, isUnlocked: true });
  });

  it("does not lock a stale saved account before a newer same-account switch", async () => {
    const store = new PopupStateStore();
    setPriorPopupState(store);
    const account = storedAccount("same", "same@example.com", true);
    const save = deferred<StoredAccount>();
    const saveAccount = vi.fn(() => save.promise);
    const setStatus = vi.fn(async () => undefined);
    const setActive = vi.fn(async () => account);
    const accountStore = accountPort({
      saveAccount,
      setStatus,
      setActive,
      list: async () => [account],
      readSession: async () => session("same"),
    });
    const facade = new AuthFacade(
      store,
      { login: async () => session("same") },
      syncPort(),
      null,
      undefined,
      accountStore,
    );
    const staleLogin = facade.login(loginRequest("same@example.com"));
    await vi.waitFor(() => expect(saveAccount).toHaveBeenCalled());
    const switching = facade.switchAccount(account.id);
    save.resolve(account);
    await Promise.all([staleLogin, switching]);

    expect(setStatus).not.toHaveBeenCalled();
    expect(store.snapshot()).toMatchObject({ email: account.email, isUnlocked: true });
  });

  it("locks the account activated by a setActive mutation that started before lock", async () => {
    const store = new PopupStateStore();
    const accountA = storedAccount("a", "a@example.com", false);
    const accountB = storedAccount("b", "b@example.com", true);
    let accounts: StoredAccount[] = [accountB, accountA];
    store.setServerUrl(accountB.serverUrl);
    store.setActiveSession(session("b"));
    store.setUnlocked(accountB.email);
    const activation = deferred<void>();
    const setActive = vi.fn(async (id: string) => {
      await activation.promise;
      accounts = accounts.map((account) => ({ ...account, isActive: account.id === id }));
      return accounts.find((account) => account.id === id)!;
    });
    const setStatus = vi.fn(async (id: string, status: "unlocked" | "locked") => {
      accounts = accounts.map((account) => account.id === id ? { ...account, status } : account);
    });
    const accountStore = accountPort({
      list: async () => accounts,
      setActive,
      setStatus,
      readSession: async () => session("a"),
    });
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);
    const switching = facade.switchAccount(accountA.id);
    const switchResult = switching.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(setActive).toHaveBeenCalledWith(accountA.id));

    facade.lock();
    expect(store.snapshot()).toMatchObject({ isUnlocked: false, activeSession: null });
    activation.resolve();
    await switchResult;
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledWith(accountA.id, "locked"));

    expect(accounts.find((account) => account.id === accountA.id)).toMatchObject({
      isActive: true,
      status: "locked",
    });
  });

  it("allows a switch started after lock to win after earlier mutations and lock settle", async () => {
    const store = new PopupStateStore();
    const accountA = storedAccount("a", "a@example.com", false);
    const accountB = storedAccount("b", "b@example.com", true);
    let accounts: StoredAccount[] = [accountB, accountA];
    store.setServerUrl(accountB.serverUrl);
    store.setActiveSession(session("b"));
    store.setUnlocked(accountB.email);
    const activationA = deferred<void>();
    const setActive = vi.fn(async (id: string) => {
      if (id === accountA.id) {
        await activationA.promise;
      }
      accounts = accounts.map((account) => ({
        ...account,
        isActive: account.id === id,
        status: account.id === id ? "unlocked" as const : account.status,
      }));
      return accounts.find((account) => account.id === id)!;
    });
    const setStatus = vi.fn(async (id: string, status: "unlocked" | "locked") => {
      accounts = accounts.map((account) => account.id === id ? { ...account, status } : account);
    });
    const accountStore = accountPort({
      list: async () => accounts,
      setActive,
      setStatus,
      readSession: async (id) => session(id),
    });
    const facade = new AuthFacade(store, null, syncPort(), null, undefined, accountStore);
    const stale = facade.switchAccount(accountA.id);
    const staleResult = stale.then(() => null, (error: unknown) => error);
    await vi.waitFor(() => expect(setActive).toHaveBeenCalledWith(accountA.id));
    facade.lock();
    const current = facade.switchAccount(accountB.id);

    activationA.resolve();
    await current;
    await staleResult;

    expect(accounts.find((account) => account.id === accountB.id)).toMatchObject({
      isActive: true,
      status: "unlocked",
    });
    expect(store.snapshot()).toMatchObject({
      email: accountB.email,
      isUnlocked: true,
      activeSession: { token: { accessToken: accountB.id } },
    });
  });

  it("seals the current PIN session and opens a lock epoch before clearing runtime state", () => {
    const store = new PopupStateStore();
    const activeSession = session("current-access");
    store.setServerUrl("https://vault.current.example.com");
    store.setActiveSession(activeSession);
    store.setUnlocked("current@example.com");
    const events: string[] = [];
    const unlockMethods = unlockMethodsPort({
      prepareForLock: (id, currentSession) => {
        events.push(`prepare:${id}:${currentSession.token.accessToken}`);
        expect(store.snapshot().activeSession).toBe(activeSession);
      },
      beginLockEpoch: (id) => {
        events.push(`epoch:${id}`);
        expect(store.snapshot().activeSession).toBe(activeSession);
        return 1;
      },
    });
    const facade = facadeWithUnlockMethods(store, null, unlockMethods);
    setRuntimeAccount(facade, alternativeAccountId);

    facade.lock();

    expect(events).toEqual([
      `prepare:${alternativeAccountId}:current-access`,
      `epoch:${alternativeAccountId}`,
    ]);
    expect(store.snapshot()).toMatchObject({
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("seals the active account session when runtime account identity is recovered during lock", async () => {
    const store = new PopupStateStore();
    const active = storedAccount(alternativeAccountId, "active@example.com", true);
    const activeSession = session("recovered-access");
    store.setServerUrl(active.serverUrl);
    store.setActiveSession(activeSession);
    store.setUnlocked(active.email);
    const prepareForLock = vi.fn();
    const facade = facadeWithUnlockMethods(
      store,
      accountPort({ list: async () => [active] }),
      unlockMethodsPort({ prepareForLock }),
    );

    await facade.lockAccount(active.id);

    expect(prepareForLock).toHaveBeenCalledWith(active.id, activeSession);
    expect(store.snapshot()).toMatchObject({
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("restores the auth baseline before sealing a recovered runtime account", async () => {
    const store = new PopupStateStore();
    const active = storedAccount(alternativeAccountId, "active@example.com", true);
    const baselineSession = session("baseline-access");
    store.setServerUrl(active.serverUrl);
    store.setActiveSession(baselineSession);
    store.setUnlocked(active.email);
    const baseline = store.snapshot();
    store.setActiveSession(session("temporary-login-access"));
    store.setUnlocked("temporary@example.com");
    const prepareForLock = vi.fn();
    const facade = facadeWithUnlockMethods(
      store,
      accountPort({ list: async () => [active] }),
      unlockMethodsPort({ prepareForLock }),
    );
    (
      facade as unknown as {
        authBaseline: ReturnType<PopupStateStore["snapshot"]>;
      }
    ).authBaseline = baseline;

    await facade.lockAccount(active.id);

    expect(prepareForLock).toHaveBeenCalledWith(active.id, baselineSession);
    expect(prepareForLock).not.toHaveBeenCalledWith(
      active.id,
      expect.objectContaining({
        token: expect.objectContaining({ accessToken: "temporary-login-access" }),
      }),
    );
  });

  it("does not seal or advance the old account when switching persistence fails", async () => {
    const store = new PopupStateStore();
    const current = storedAccount(alternativeAccountId, "current@example.com", true);
    store.setServerUrl(current.serverUrl);
    store.setActiveSession(session("current-access"));
    store.setUnlocked(current.email);
    const prepareForLock = vi.fn();
    const beginLockEpoch = vi.fn(() => 1);
    const facade = facadeWithUnlockMethods(
      store,
      accountPort({
        setActive: async () => {
          throw new Error("activation failed");
        },
      }),
      unlockMethodsPort({ prepareForLock, beginLockEpoch }),
    );
    setRuntimeAccount(facade, current.id);

    await expect(facade.switchAccount("b".repeat(64))).rejects.toThrow(
      "activation failed",
    );

    expect(prepareForLock).not.toHaveBeenCalled();
    expect(beginLockEpoch).not.toHaveBeenCalled();
    expect(store.snapshot()).toMatchObject({
      isUnlocked: true,
      activeSession: expect.objectContaining({
        token: expect.objectContaining({ accessToken: "current-access" }),
      }),
    });
  });

  it("opens the lock epoch for the target account after switching to it locked", async () => {
    const store = new PopupStateStore();
    const current = storedAccount(alternativeAccountId, "current@example.com", true);
    const target = {
      ...storedAccount("b".repeat(64), "target@example.com", false),
      status: "locked" as const,
    };
    store.setServerUrl(current.serverUrl);
    store.setActiveSession(session("current-access"));
    store.setUnlocked(current.email);
    const beginLockEpoch = vi.fn(() => 1);
    const facade = facadeWithUnlockMethods(
      store,
      accountPort({
        setActive: async () => ({ ...target, isActive: true }),
        list: async () => [{ ...target, isActive: true }],
      }),
      unlockMethodsPort({ beginLockEpoch }),
    );
    setRuntimeAccount(facade, current.id);

    await facade.switchAccount(target.id);

    expect(beginLockEpoch).toHaveBeenLastCalledWith(target.id);
    expect(store.snapshot()).toMatchObject({
      email: target.email,
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("restores a Touch ID session, syncs it, then persists unlocked status", async () => {
    const store = new PopupStateStore();
    const active = storedAccount(alternativeAccountId, "active@example.com", true);
    const restored = session("biometric-access");
    const unlockMethods = unlockMethodsPort({
      unlockWithBiometric: vi.fn(async () => restored),
    });
    const setStatus = vi.fn(async () => undefined);
    const sync = vi.fn(async () => emptySyncResult());
    const facade = facadeWithUnlockMethods(
      store,
      accountPort({
        list: async () => [active],
        setStatus,
      }),
      unlockMethods,
      { sync },
    );
    setRuntimeAccount(facade, active.id);
    store.setLockedAccount(active.email, active.serverUrl);

    await facade.unlockWithBiometric();

    expect(unlockMethods.unlockWithBiometric).toHaveBeenCalledWith(active.id);
    expect(sync).toHaveBeenCalledWith(restored);
    expect(setStatus).toHaveBeenCalledWith(
      active.id,
      "unlocked",
      expect.any(Function),
    );
    expect(store.snapshot()).toMatchObject({
      email: active.email,
      isUnlocked: true,
      activeSession: restored,
      syncError: "",
    });
  });

  it("restores a PIN session through the same synchronization path", async () => {
    const store = new PopupStateStore();
    const active = storedAccount(alternativeAccountId, "active@example.com", true);
    const restored = session("pin-access");
    const unlockMethods = unlockMethodsPort({
      unlockWithPin: vi.fn(async () => restored),
    });
    const facade = facadeWithUnlockMethods(
      store,
      accountPort({ list: async () => [active] }),
      unlockMethods,
    );
    setRuntimeAccount(facade, active.id);
    store.setLockedAccount(active.email, active.serverUrl);

    await facade.unlockWithPin("123456");

    expect(unlockMethods.unlockWithPin).toHaveBeenCalledWith(active.id, "123456");
    expect(store.snapshot()).toMatchObject({
      isUnlocked: true,
      activeSession: restored,
    });
  });

  it("uses a fixed failure when the runtime account is no longer active", async () => {
    const store = new PopupStateStore();
    const facade = facadeWithUnlockMethods(
      store,
      accountPort({ list: async () => [] }),
      unlockMethodsPort({
        unlockWithBiometric: async () => session("must-not-install"),
      }),
    );
    setRuntimeAccount(facade, alternativeAccountId);
    store.setLockedAccount("missing@example.com", "https://missing.example.com");

    await expect(facade.unlockWithBiometric()).rejects.toEqual(
      new AlternativeUnlockError("session-unavailable"),
    );
    expect(store.snapshot()).toMatchObject({
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("sanitizes an unexpected alternative-unlock rejection", async () => {
    const store = new PopupStateStore();
    const active = storedAccount(alternativeAccountId, "active@example.com", true);
    const facade = facadeWithUnlockMethods(
      store,
      accountPort({ list: async () => [active] }),
      unlockMethodsPort({
        unlockWithBiometric: async () => {
          throw new Error("refreshToken=secret https://private.example");
        },
      }),
    );
    setRuntimeAccount(facade, active.id);
    store.setLockedAccount(active.email, active.serverUrl);

    const failure = await facade.unlockWithBiometric().catch((error) => error);

    expect(failure).toEqual(new AlternativeUnlockError("session-unavailable"));
    expect(String(failure)).not.toContain("secret");
    expect(String(failure)).not.toContain("private");
  });

  it("does not install a Touch ID session after a newer lock operation", async () => {
    const store = new PopupStateStore();
    const active = storedAccount(alternativeAccountId, "active@example.com", true);
    const restored = deferred<AuthSession>();
    const unlockWithBiometric = vi.fn(() => restored.promise);
    const facade = facadeWithUnlockMethods(
      store,
      accountPort({ list: async () => [active] }),
      unlockMethodsPort({ unlockWithBiometric }),
    );
    setRuntimeAccount(facade, active.id);
    store.setLockedAccount(active.email, active.serverUrl);

    const pending = facade.unlockWithBiometric().then(
      () => null,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(unlockWithBiometric).toHaveBeenCalledOnce());
    facade.lock();
    restored.resolve(session("late-access"));

    await expect(pending).resolves.toMatchObject({
      name: "AccountOperationCancelledError",
    });
    expect(store.snapshot()).toMatchObject({
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("seals the candidate session before a synchronization timeout locks it", async () => {
    const store = new PopupStateStore();
    const active = storedAccount(alternativeAccountId, "active@example.com", true);
    const prepareForLock = vi.fn();
    const unlockMethods = unlockMethodsPort({
      unlockWithBiometric: async () => session("candidate-access"),
      prepareForLock,
    });
    const facade = new AuthFacade(
      store,
      null,
      { sync: async () => new Promise<VaultSyncResult>(() => undefined) },
      null,
      undefined,
      accountPort({ list: async () => [active] }),
      10,
      null,
      undefined,
      null,
      null,
      unlockMethods,
    );
    setRuntimeAccount(facade, active.id);
    store.setLockedAccount(active.email, active.serverUrl);

    await expect(facade.unlockWithBiometric()).rejects.toMatchObject({
      name: "AccountOperationCancelledError",
    });

    expect(prepareForLock).toHaveBeenCalledWith(
      active.id,
      expect.objectContaining({
        token: expect.objectContaining({ accessToken: "candidate-access" }),
      }),
    );
    expect(store.snapshot()).toMatchObject({
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("rolls an alternative session back to locked when synchronization fails", async () => {
    const store = new PopupStateStore();
    const active = storedAccount(alternativeAccountId, "active@example.com", true);
    const setStatus = vi.fn(async () => undefined);
    const prepareForLock = vi.fn();
    const unlockMethods = unlockMethodsPort({
      unlockWithBiometric: async () => session("candidate-access"),
      prepareForLock,
    });
    const facade = facadeWithUnlockMethods(
      store,
      accountPort({
        list: async () => [active],
        setStatus,
      }),
      unlockMethods,
      { sync: async () => { throw new Error("private sync detail"); } },
    );
    setRuntimeAccount(facade, active.id);
    store.setLockedAccount(active.email, active.serverUrl);

    await expect(facade.unlockWithBiometric()).rejects.toEqual(
      new AlternativeUnlockError("sync-failed"),
    );

    expect(prepareForLock).toHaveBeenCalledWith(
      active.id,
      expect.objectContaining({
        token: expect.objectContaining({ accessToken: "candidate-access" }),
      }),
    );
    expect(setStatus).toHaveBeenCalledWith(
      active.id,
      "locked",
      expect.any(Function),
    );
    expect(store.snapshot()).toMatchObject({
      email: active.email,
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("forces a persisted unlocked account to locked at every process startup", async () => {
    const store = new PopupStateStore();
    const active = storedAccount(alternativeAccountId, "active@example.com", true);
    const readSession = vi.fn(async () => session("must-not-restore"));
    const setStatus = vi.fn(async () => undefined);
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        list: async () => [active],
        readSession,
        setStatus,
      }),
    );

    await expect(facade.restoreStartup()).resolves.toBe("locked");

    expect(readSession).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(
      active.id,
      "locked",
      expect.any(Function),
    );
    expect(store.snapshot()).toMatchObject({
      email: active.email,
      isUnlocked: false,
      activeSession: null,
    });
  });

  it("bounds a stalled startup lock write instead of leaving the launch screen pending", async () => {
    vi.useFakeTimers();
    const store = new PopupStateStore();
    const active = storedAccount(alternativeAccountId, "active@example.com", true);
    const stalledWrite = deferred<void>();
    const facade = new AuthFacade(
      store,
      null,
      syncPort(),
      null,
      undefined,
      accountPort({
        list: async () => [active],
        setStatus: vi.fn(() => stalledWrite.promise),
      }),
      20,
    );

    const startup = facade.restoreStartup();
    const startupFailure = expect(startup).rejects.toThrow(
      "Unable to restore saved accounts.",
    );
    await vi.advanceTimersByTimeAsync(20);

    await startupFailure;
    expect(store.snapshot()).toMatchObject({
      email: active.email,
      isUnlocked: false,
      activeSession: null,
    });
  });
});

function loginRequest(email: string) {
  return {
    email,
    masterPassword: "secret",
    serverUrl: `https://vault.${email.split("@")[0]}.example.com`,
  };
}

function syncPort() {
  return {
    sync: async () => emptySyncResult(),
  };
}

function emptySyncResult(): VaultSyncResult {
  return syncResult();
}

function syncResult(overrides: Partial<VaultSyncResult> = {}): VaultSyncResult {
  return {
    cipherCount: 0,
    encryptedCipherCount: 0,
    folderCount: 0,
    items: [],
    archivedItems: [],
    deletedItems: [],
    folders: [],
    organizations: [],
    collections: [],
    sends: [],
    sendCount: 0,
    ...overrides,
  };
}

function session(accessToken = "access-token"): AuthSession {
  return {
    environment: buildBitwardenEnvironment(),
    token: {
      accessToken,
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
    },
  };
}

function processTestItem(id: string, name: string) {
  return {
    id,
    type: "login" as const,
    name,
    subtitle: "shared@example.com",
    favorite: false,
    folderId: "",
    folderName: "",
    organizationName: "",
    attachmentCount: 0,
    uris: [{ id: `${id}-uri`, uri: "https://example.com", matchType: "domain" }],
    fields: [],
    createdDate: "2026-01-01T00:00:00.000Z",
    revisionDate: "2026-01-01T00:00:00.000Z",
    notes: "",
    canLaunch: true,
    canFill: true,
    uri: "https://example.com",
  };
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object): string =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

function setPriorPopupState(store: PopupStateStore): void {
  store.setServerUrl("https://vault.current.example.com");
  store.setActiveSession(session("current"));
  store.setUnlocked("current@example.com");
  store.setItems([{
    id: "prior-item",
    name: "Prior item",
    subtitle: "current@example.com",
    uri: "https://example.com",
    favorite: false,
    fields: [],
  }]);
}

class MemoryHostApi implements HostApi {
  readonly values = new Map<string, string>();
  private readonly lockedAccountIds = new Set<string>();

  showPopup(): Promise<void> { return Promise.resolve(); }
  hidePopup(): Promise<void> { return Promise.resolve(); }
  copyText(): Promise<void> { return Promise.resolve(); }
  pasteText(): Promise<void> { return Promise.resolve(); }
  openUrl(): Promise<void> { return Promise.resolve(); }
  secureGet(key: string): Promise<string | null> { return Promise.resolve(this.values.get(key) ?? null); }
  secureSet(key: string, value: string): Promise<void> { this.values.set(key, value); return Promise.resolve(); }
  secureDelete(key: string): Promise<void> { this.values.delete(key); return Promise.resolve(); }
  getAccountLockIntents(): Promise<readonly string[]> { return Promise.resolve([...this.lockedAccountIds]); }
  setAccountLockIntents(accountIds: readonly string[], locked: boolean): Promise<void> {
    for (const accountId of accountIds) {
      if (locked) this.lockedAccountIds.add(accountId);
      else this.lockedAccountIds.delete(accountId);
    }
    return Promise.resolve();
  }
}

class DeferredDeleteHost extends MemoryHostApi {
  readonly deleteStarted = deferred<void>();
  deferDeletes = false;
  private deleteRelease = deferred<void>();

  releaseDelete(): void {
    this.deleteRelease.resolve();
  }

  override async secureDelete(key: string): Promise<void> {
    if (this.deferDeletes && key.startsWith("auth.account.")) {
      this.deleteStarted.resolve();
      await this.deleteRelease.promise;
    }
    await super.secureDelete(key);
  }
}

class DeferredIndexHost extends MemoryHostApi {
  readonly indexWriteStarted = deferred<void>();
  deferIndexWrites = false;
  private indexWriteRelease = deferred<void>();
  private started = false;

  releaseIndexWrite(): void {
    this.indexWriteRelease.resolve();
  }

  override async secureSet(key: string, value: string): Promise<void> {
    await super.secureSet(key, value);
    if (this.deferIndexWrites && key === "auth.accounts" && !this.started) {
      this.started = true;
      this.deferIndexWrites = false;
      this.indexWriteStarted.resolve();
      await this.indexWriteRelease.promise;
    }
  }
}

function storedAccount(id: string, email: string, isActive: boolean): StoredAccount {
  return {
    id,
    email,
    serverUrl: `https://vault.${email.split("@")[0]}.example.com`,
    status: "unlocked",
    isActive,
  };
}

class FakeProcessSessionBroker implements ProcessSessionBrokerPort {
  readonly changesSubject = new ReplaySubject<ProcessSessionSnapshot>(1);
  readonly changes$ = this.changesSubject.asObservable();
  readonly mutations: ProcessSessionMutation[] = [];

  constructor(
    private current: ProcessSessionSnapshot,
    private handoff: unknown | null = null,
  ) {
    this.changesSubject.next(current);
  }

  async attach() {
    return { startupMode: "attach" as const, snapshot: this.current };
  }

  async mutate(mutation: ProcessSessionMutation): Promise<ProcessSessionSnapshot> {
    this.mutations.push(mutation);
    this.current = {
      ...this.current,
      version: this.current.version + 1,
      authorization:
        mutation.type === "unlocked"
          ? "unlocked"
          : mutation.type === "locked" || mutation.type === "account-selected"
            ? "locked"
            : mutation.type === "logged-out"
              ? "signed-out"
              : mutation.type === "recovery-required"
                ? "recovery-required"
                : this.current.authorization,
      activeAccountId:
        "activeAccountId" in mutation
          ? mutation.activeAccountId
          : mutation.type === "logged-out"
            ? null
            : this.current.activeAccountId,
      syncState:
        mutation.type === "sync-started"
          ? "syncing"
          : mutation.type === "sync-succeeded"
            ? "fresh"
            : mutation.type === "sync-failed"
              ? "stale"
              : this.current.syncState,
      failureCode:
        "code" in mutation
          ? mutation.code
          : mutation.type === "sync-started" || mutation.type === "sync-succeeded"
            ? null
            : this.current.failureCode,
      sharedSnapshot:
        "sharedSnapshot" in mutation
          ? mutation.sharedSnapshot ?? this.current.sharedSnapshot
          : mutation.type === "locked" ||
              mutation.type === "logged-out" ||
              mutation.type === "account-selected" ||
              mutation.type === "recovery-required"
            ? null
            : this.current.sharedSnapshot,
    };
    this.changesSubject.next(this.current);
    return this.current;
  }

  async setSessionHandoff(session: unknown): Promise<void> {
    this.handoff = session;
  }

  async sessionHandoff(): Promise<unknown | null> {
    return this.handoff;
  }

  destroy(): void {
    this.changesSubject.complete();
  }
}

function brokerSnapshot(
  overrides: Partial<ProcessSessionSnapshot> = {},
): ProcessSessionSnapshot {
  return {
    processGeneration: "process-generation",
    version: 0,
    syncVersion: 0,
    authorization: "signed-out",
    activeAccountId: null,
    syncState: "idle",
    failureCode: null,
    sharedSnapshot: null,
    originWindowLabel: "main",
    ...overrides,
  };
}

function accountPort(overrides: Partial<AccountSessionPort>): AccountSessionPort {
  return {
    list: async () => [],
    saveAccount: async () => { throw new Error("Unexpected saveAccount"); },
    setActive: async () => { throw new Error("Unexpected setActive"); },
    setStatus: async () => undefined,
    readSession: async () => null,
    replaceSession: async () => undefined,
    remove: async () => null,
    lockAll: async () => undefined,
    ...overrides,
  };
}

const alternativeAccountId = "a".repeat(64);

function facadeWithUnlockMethods(
  store: PopupStateStore,
  accountStore: AccountSessionPort | null,
  unlockMethods: UnlockMethodsPort,
  vaultSync = syncPort(),
): AuthFacade {
  return new AuthFacade(
    store,
    null,
    vaultSync,
    null,
    undefined,
    accountStore,
    undefined,
    null,
    undefined,
    null,
    null,
    unlockMethods,
  );
}

function setRuntimeAccount(facade: AuthFacade, accountId: string): void {
  (
    facade as unknown as {
      setRuntimeAccountId(id: string): void;
    }
  ).setRuntimeAccountId(accountId);
}

function unlockMethodsPort(overrides: Partial<UnlockMethodsPort> = {}): UnlockMethodsPort {
  return {
    availability: async () => ({
      pinEnabled: false,
      biometricEnabled: false,
      biometricAvailability: "available",
    }),
    enablePin: async () => undefined,
    disablePin: async () => undefined,
    enableBiometric: async () => undefined,
    disableBiometric: async () => undefined,
    unlockWithPin: async () => {
      throw new AlternativeUnlockError("pin-unavailable");
    },
    unlockWithBiometric: async () => {
      throw new AlternativeUnlockError("biometric-unavailable");
    },
    prepareForLock: () => undefined,
    beginLockEpoch: () => 1,
    currentLockEpoch: () => 1,
    consumeAutomaticBiometricPrompt: () => false,
    clearAccount: async () => undefined,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function startupTransportFailure(): Error {
  const TransportError = (
    bitwardenApiModule as unknown as {
      HttpTransportError?: new (code: "unavailable") => Error;
    }
  ).HttpTransportError;
  return TransportError
    ? new TransportError("unavailable")
    : new Error("opaque synthetic failure");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
