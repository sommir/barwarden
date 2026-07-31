import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BitwardenEnvironment } from "../bitwarden-api/bitwarden-api";
import { buildBitwardenEnvironment } from "../bitwarden-api/bitwarden-api";
import { AuthSessionStore, type AuthSession } from "./auth-session-store";
import { bytesToBase64 } from "./bitwarden-crypto";
import type { InstallationIdPort } from "./installation-id.service";
import type { MasterPasswordCrypto } from "./master-password-crypto";
import { PasswordLoginService, type PasswordLoginApi } from "./password-login.service";
import type { TwoFactorTrustStore } from "./two-factor-trust-store";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("PasswordLoginService", () => {
  it.each([2, 7, 99])("rejects unsupported two-factor provider %i before any transport request", async (provider) => {
    const api = new RecordingPasswordLoginApi(buildBitwardenEnvironment());
    const service = new PasswordLoginService(
      api,
      new MemorySessionStore(),
      new RecordingMasterPasswordCrypto(),
      3000,
      fixedInstallationId("55555555-5555-4555-8555-555555555555"),
    );

    await expect(service.login({
      email: "operator@example.test",
      masterPassword: "synthetic-master-password",
      twoFactor: { provider, token: "123456" },
    })).rejects.toThrow("Unsupported two-factor provider");
    expect(api.preloginEmail).toBeUndefined();
    expect(api.tokenRequest).toBeUndefined();
  });

  it("sends login email two-factor codes with the persisted installation identifier", async () => {
    const api = new RecordingPasswordLoginApi(buildBitwardenEnvironment());
    const installationId = "33333333-3333-4333-8333-333333333333";
    const service = new PasswordLoginService(
      api,
      new MemorySessionStore(),
      new RecordingMasterPasswordCrypto(),
      3000,
      fixedInstallationId(installationId),
    );

    await service.sendTwoFactorEmail(" USER@example.com ");

    expect(api.twoFactorEmailRequest).toEqual({
      email: "USER@example.com",
      deviceIdentifier: installationId,
    });
  });
  it("runs prelogin, derives the password grant hash, and returns without storing the session", async () => {
    const environment = buildBitwardenEnvironment();
    const api = new RecordingPasswordLoginApi(environment);
    const store = new MemorySessionStore();
    const crypto = new RecordingMasterPasswordCrypto();
    const installationId = "11111111-1111-4111-8111-111111111111";
    const service = new PasswordLoginService(
      api,
      store,
      crypto,
      3000,
      fixedInstallationId(installationId),
    );

    const session = await service.login({
      email: " USER@example.com ",
      masterPassword: "master-password",
    });

    expect(api.preloginEmail).toBe("USER@example.com");
    expect(api.tokenRequest).toMatchObject({
      clientId: "desktop",
      email: "USER@example.com",
      masterPasswordHash: "authentication-hash",
      device: {
        type: "7",
        identifier: installationId,
        name: "Barwarden macOS",
      },
    });
    expect(session).toEqual({
      environment,
      token: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenType: "Bearer",
        expiresIn: 3600,
        clientId: "desktop",
        obtainedAtEpochMs: expect.any(Number),
      },
    });
    expect(store.savedSession).toBeUndefined();
    expect(crypto.deriveInput?.kdf).toEqual({ type: "PBKDF2_SHA256", iterations: 5_000 });
  });

  it("uses the same Argon2id master key object to unwrap and clears sensitive arrays", async () => {
    const environment = buildBitwardenEnvironment();
    const userKey = sequentialBytes(64);
    const expectedUserKeyB64 = bytesToBase64(userKey);
    const api = new RecordingPasswordLoginApi(environment);
    api.preloginResponse = { Kdf: 1, KdfIterations: 3, KdfMemory: 64, KdfParallelism: 4 };
    api.key = "2.a|b|c";
    const store = new MemorySessionStore();
    const masterKey = sequentialBytes(32, 90);
    const crypto = new RecordingMasterPasswordCrypto(masterKey, userKey);
    const service = new PasswordLoginService(api, store, crypto);

    const session = await service.login({
      email: "user@example.com",
      masterPassword: "master-password",
    });

    expect(session.crypto).toEqual({ userKeyB64: expectedUserKeyB64 });
    expect(api.tokenRequest?.masterPasswordHash).toBe("authentication-hash");
    expect(crypto.deriveInput?.kdf).toEqual({
      type: "Argon2id",
      iterations: 3,
      memory: 64,
      parallelism: 4,
    });
    expect(crypto.receivedMasterKey).toBe(masterKey);
    expect(masterKey).toEqual(new Uint8Array(32));
    expect(userKey).toEqual(new Uint8Array(64));
    expect(session).not.toHaveProperty("masterKey");
    expect(session).not.toHaveProperty("authenticationHashB64");
    expect(store.savedSession).toBeUndefined();
  });

  it("clears the master key when the token request fails", async () => {
    const api = new RecordingPasswordLoginApi(buildBitwardenEnvironment());
    api.rejectDesktopIdentity = true;
    const masterKey = sequentialBytes(32, 70);
    const service = new PasswordLoginService(
      api,
      new MemorySessionStore(),
      new RecordingMasterPasswordCrypto(masterKey),
    );

    await expect(service.login({
      email: "user@example.com",
      masterPassword: "master-password",
    })).rejects.toBe(api.desktopIdentityError);
    expect(masterKey).toEqual(new Uint8Array(32));
  });

  it("clears the master key when unwrap fails", async () => {
    const api = new RecordingPasswordLoginApi(buildBitwardenEnvironment());
    api.key = "2.a|b|c";
    const masterKey = sequentialBytes(32, 50);
    const crypto = new RecordingMasterPasswordCrypto(masterKey);
    crypto.unwrapError = new Error("fixed unwrap failure");
    const service = new PasswordLoginService(api, new MemorySessionStore(), crypto);

    await expect(service.login({
      email: "user@example.com",
      masterPassword: "master-password",
    })).rejects.toThrow("fixed unwrap failure");
    expect(masterKey).toEqual(new Uint8Array(32));
  });

  it.each([
    ["malformed uppercase Key", { Key: "not-an-enc-string" }],
    ["malformed lowercase key", { key: "not-an-enc-string" }],
    ["whitespace Key", { Key: "   " }],
    ["unsupported wrapped-key type", { Key: "1.a|b|c" }],
  ])("ignores %s and clears the master key", async (_description, tokenKey) => {
    const api = new RecordingPasswordLoginApi(buildBitwardenEnvironment());
    api.key = tokenKey.Key;
    api.lowercaseKey = tokenKey.key;
    const masterKey = sequentialBytes(32, 30);
    const crypto = new RecordingMasterPasswordCrypto(masterKey);
    const service = new PasswordLoginService(api, new MemorySessionStore(), crypto);

    const session = await service.login({
      email: "user@example.com",
      masterPassword: "master-password",
    });

    expect(session.crypto).toBeUndefined();
    expect(crypto.decryptCalls).toBe(0);
    expect(masterKey).toEqual(new Uint8Array(32));
  });

  it("does not call legacy session persistence", async () => {
    const api = new RecordingPasswordLoginApi(buildBitwardenEnvironment());
    const store = new HangingSessionStore();
    const service = new PasswordLoginService(api, store, new RecordingMasterPasswordCrypto(), 1);

    await expect(
      service.login({
        email: "user@example.com",
        masterPassword: "master-password",
      }),
    ).resolves.toMatchObject({
      token: { accessToken: "access-token" },
    });
    expect(store.saveCalls).toBe(0);
  });

  it("uses the Web Vault client identity first for self-hosted servers", async () => {
    const environment = buildBitwardenEnvironment({
      region: "SelfHosted",
      urls: {
        apiUrl: "https://vault.example.com/api",
        identityUrl: "https://vault.example.com/identity",
        webVaultUrl: "https://vault.example.com",
      },
    });
    const api = new RecordingPasswordLoginApi(environment);
    const store = new MemorySessionStore();
    const installationId = "22222222-2222-4222-8222-222222222222";
    const service = new PasswordLoginService(
      api,
      store,
      new RecordingMasterPasswordCrypto(),
      3000,
      fixedInstallationId(installationId),
    );

    const session = await service.login({
      email: "user@example.com",
      masterPassword: "master-password",
    });

    expect(session.token.accessToken).toBe("access-token");
    expect(session.token.clientId).toBe("web");
    expect(api.tokenRequests.map((request) => [
      request.clientId,
      request.device?.type,
      request.device?.identifier,
    ])).toEqual([
      ["web", "14", installationId],
    ]);
  });

  it("records the client identity that actually obtained a cloud session", async () => {
    const api = new RecordingPasswordLoginApi(buildBitwardenEnvironment());
    const service = new PasswordLoginService(api, new MemorySessionStore(), new RecordingMasterPasswordCrypto());

    const session = await service.login({
      email: "user@example.com",
      masterPassword: "master-password",
    });

    expect(session.token.clientId).toBe("desktop");
  });

  it("does not fall back to Web Vault identity for Bitwarden Cloud", async () => {
    const api = new RecordingPasswordLoginApi(buildBitwardenEnvironment());
    api.rejectDesktopIdentity = true;
    api.desktopIdentityError = { error: "cloud rejection" };
    const service = new PasswordLoginService(api, new MemorySessionStore(), new RecordingMasterPasswordCrypto());

    await expect(
      service.login({
        email: "user@example.com",
        masterPassword: "master-password",
      }),
    ).rejects.toEqual({ error: "cloud rejection" });
    expect(api.tokenRequests.map((request) => request.clientId)).toEqual(["desktop"]);
  });

  it("passes two-factor token details into the Identity password grant", async () => {
    const api = new RecordingPasswordLoginApi(buildBitwardenEnvironment());
    const service = new PasswordLoginService(api, new MemorySessionStore(), new RecordingMasterPasswordCrypto());

    await service.login({
      email: "user@example.com",
      masterPassword: "master-password",
      twoFactor: { provider: 0, token: "123456", remember: true },
    });

    expect(api.tokenRequest?.twoFactor).toEqual({
      provider: 0,
      token: "123456",
      remember: true,
    });
  });

  it("reuses the trusted-device token returned for a remembered two-factor login", async () => {
    const api = new RecordingPasswordLoginApi(buildBitwardenEnvironment());
    api.twoFactorToken = "trusted-device-token";
    const trustStore = new MemoryTwoFactorTrustStore();
    const service = new (
      PasswordLoginService as unknown as PasswordLoginServiceWithTrustStoreConstructor
    )(
      api,
      new MemorySessionStore(),
      new RecordingMasterPasswordCrypto(),
      3000,
      fixedInstallationId("66666666-6666-4666-8666-666666666666"),
      trustStore,
    );

    await service.login({
      email: "trusted-device@example.test",
      masterPassword: "master-password",
      twoFactor: { provider: 0, token: "123456", remember: true },
    });
    await service.login({
      email: "trusted-device@example.test",
      masterPassword: "master-password",
    });

    expect(api.tokenRequests[1]?.twoFactor).toEqual({
      provider: 5,
      token: "trusted-device-token",
      remember: false,
    });
  });

  it("passes new-device OTP into the Identity password grant", async () => {
    const api = new RecordingPasswordLoginApi(buildBitwardenEnvironment());
    const service = new PasswordLoginService(api, new MemorySessionStore(), new RecordingMasterPasswordCrypto());

    await service.login({
      email: "user@example.com",
      masterPassword: "master-password",
      newDeviceOtp: "654321",
    });

    expect(api.tokenRequest?.newDeviceOtp).toBe("654321");
  });

  it("re-derives a normalized email hash for new-device OTP resend without reading the installation identifier", async () => {
    const api = new RecordingPasswordLoginApi(buildBitwardenEnvironment());
    const crypto = new RecordingMasterPasswordCrypto();
    const installationId = vi.fn(async () => "installation-identifier");
    const service = new PasswordLoginService(
      api,
      new MemorySessionStore(),
      crypto,
      undefined,
      { getInstallationId: installationId },
    );

    await service.resendNewDeviceOtp(" user@example.com ", "master-password");

    expect(api.preloginEmail).toBe("user@example.com");
    expect(crypto.deriveInput).toMatchObject({
      email: "user@example.com",
      masterPassword: "master-password",
    });
    expect(api.newDeviceOtpRequest).toEqual({
      email: "user@example.com",
      masterPasswordHash: "authentication-hash",
    });
    expect(installationId).not.toHaveBeenCalled();
  });
});

function fixedInstallationId(value: string): InstallationIdPort {
  return {
    getInstallationId: async () => value,
  };
}

class RecordingPasswordLoginApi implements PasswordLoginApi {
  preloginEmail?: string;
  tokenRequest?: Parameters<PasswordLoginApi["postPasswordToken"]>[0];
  twoFactorEmailRequest?: Parameters<PasswordLoginApi["postTwoFactorEmail"]>[0];
  newDeviceOtpRequest?: { readonly email: string; readonly masterPasswordHash: string };
  tokenRequests: Parameters<PasswordLoginApi["postPasswordToken"]>[0][] = [];
  key?: string;
  lowercaseKey?: string;
  twoFactorToken?: string;
  preloginResponse: unknown = { Kdf: 0, KdfIterations: 5_000 };
  rejectDesktopIdentity = false;
  desktopIdentityError: unknown = new Error("Username or password is incorrect. Try again");

  constructor(readonly environment: BitwardenEnvironment) {}

  async postPasswordPrelogin(request: { email: string }): Promise<unknown> {
    this.preloginEmail = request.email;
    return this.preloginResponse;
  }

  async postPasswordToken(request: Parameters<PasswordLoginApi["postPasswordToken"]>[0]) {
    this.tokenRequest = request;
    this.tokenRequests.push(request);
    if (this.rejectDesktopIdentity && request.clientId === "desktop") {
      throw this.desktopIdentityError;
    }

    return {
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "Bearer",
      expires_in: 3600,
      ...(this.key ? { Key: this.key } : {}),
      ...(this.lowercaseKey ? { key: this.lowercaseKey } : {}),
      ...(this.twoFactorToken ? { TwoFactorToken: this.twoFactorToken } : {}),
    };
  }

  async postTwoFactorEmail(request: Parameters<PasswordLoginApi["postTwoFactorEmail"]>[0]) {
    this.twoFactorEmailRequest = request;
    return {};
  }

  async postResendNewDeviceOtp(request: { readonly email: string; readonly masterPasswordHash: string }) {
    this.newDeviceOtpRequest = request;
    return {};
  }
}

type PasswordLoginServiceWithTrustStoreConstructor = new (
  api: PasswordLoginApi,
  sessionStore: AuthSessionStore,
  masterPasswordCrypto: MasterPasswordCrypto,
  sessionSaveTimeoutMs: number,
  installationId: InstallationIdPort,
  trustStore: TwoFactorTrustStore,
) => PasswordLoginService;

class MemoryTwoFactorTrustStore implements TwoFactorTrustStore {
  private readonly tokens = new Map<string, string>();

  async get(email: string, identityUrl: string): Promise<string | null> {
    return this.tokens.get(`${identityUrl}|${email}`) ?? null;
  }

  async save(email: string, identityUrl: string, token: string): Promise<void> {
    this.tokens.set(`${identityUrl}|${email}`, token);
  }

  async clear(email: string, identityUrl: string): Promise<void> {
    this.tokens.delete(`${identityUrl}|${email}`);
  }
}

class RecordingMasterPasswordCrypto implements MasterPasswordCrypto {
  deriveInput?: Parameters<MasterPasswordCrypto["derive"]>[0];
  receivedMasterKey?: Uint8Array;
  decryptCalls = 0;
  unwrapError?: Error;

  constructor(
    readonly masterKey = sequentialBytes(32, 20),
    readonly userKey = sequentialBytes(64, 40),
  ) {}

  async derive(input: Parameters<MasterPasswordCrypto["derive"]>[0]) {
    this.deriveInput = input;
    return { authenticationHashB64: "authentication-hash", masterKey: this.masterKey };
  }

  async decryptUserKeyWithMasterKey(_value: string, masterKey: Uint8Array) {
    this.decryptCalls += 1;
    this.receivedMasterKey = masterKey;
    if (this.unwrapError) {
      throw this.unwrapError;
    }
    return this.userKey;
  }
}

class MemorySessionStore extends AuthSessionStore {
  savedSession?: AuthSession;

  constructor() {
    super({
      showPopup: () => Promise.resolve(),
      hidePopup: () => Promise.resolve(),
      copyText: () => Promise.resolve(),
      pasteText: () => Promise.resolve(),
      secureGet: () => Promise.resolve(null),
      secureSet: () => Promise.resolve(),
      secureDelete: () => Promise.resolve(),
    });
  }

  override save(session: AuthSession): Promise<void> {
    this.savedSession = session;
    return Promise.resolve();
  }
}

class HangingSessionStore extends AuthSessionStore {
  saveCalls = 0;

  constructor() {
    super({
      showPopup: () => Promise.resolve(),
      hidePopup: () => Promise.resolve(),
      copyText: () => Promise.resolve(),
      pasteText: () => Promise.resolve(),
      secureGet: () => Promise.resolve(null),
      secureSet: () => new Promise<void>(() => undefined),
      secureDelete: () => Promise.resolve(),
    });
  }

  override save(): Promise<void> {
    this.saveCalls += 1;
    return new Promise(() => undefined);
  }
}

function sequentialBytes(length: number, start = 1): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) % 256);
}
