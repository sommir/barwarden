import { describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import { BitwardenApiError } from "../../bitwarden-api/bitwarden-api";
import type { MasterPasswordCrypto } from "../../auth/master-password-crypto";
import { PopupStateStore } from "../popup-state";
import {
  VaultRepromptError,
  VaultRepromptService,
  type VaultRepromptApi,
} from "./vault-reprompt.service";

const session: AuthSession = {
  environment: {
    apiUrl: "https://api.example.test",
    identityUrl: "https://identity.example.test",
    iconsUrl: null,
    webVaultUrl: "https://vault.example.test",
    sendUrl: "https://send.example.test",
  },
  token: {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenType: "Bearer",
    expiresIn: 3600,
  },
};

function setup(overrides: Partial<VaultRepromptApi> = {}) {
  const store = new PopupStateStore();
  store.setUnlocked("user@example.test");
  store.setActiveSession(session);
  const masterKey = new Uint8Array([1, 2, 3, 4]);
  const api: VaultRepromptApi = {
    postPasswordPrelogin: vi.fn().mockResolvedValue({ Kdf: 0, KdfIterations: 600_000 }),
    postVerifyPassword: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const crypto: MasterPasswordCrypto = {
    derive: vi.fn().mockResolvedValue({ authenticationHashB64: "derived-hash", masterKey }),
    decryptUserKeyWithMasterKey: vi.fn(),
  };
  return {
    api,
    crypto,
    masterKey,
    service: new VaultRepromptService(store, () => api, crypto),
    store,
  };
}

describe("VaultRepromptService", () => {
  it("derives and verifies the password against the active standard server", async () => {
    const { api, crypto, masterKey, service, store } = setup();
    const epoch = store.beginProtectedOperation();

    await expect(service.verify("correct horse", epoch)).resolves.toBe(true);

    expect(api.postPasswordPrelogin).toHaveBeenCalledWith({ email: "user@example.test" });
    expect(crypto.derive).toHaveBeenCalledWith({
      masterPassword: "correct horse",
      email: "user@example.test",
      kdf: { type: "PBKDF2_SHA256", iterations: 600_000 },
    });
    expect(api.postVerifyPassword).toHaveBeenCalledWith(
      { masterPasswordHash: "derived-hash" },
      "access-token",
    );
    expect(masterKey).toEqual(new Uint8Array(4));
  });

  it("fails closed when the account changes during verification", async () => {
    let resolveVerification!: () => void;
    const verification = new Promise<void>((resolve) => { resolveVerification = resolve; });
    const { masterKey, service, store } = setup({
      postVerifyPassword: vi.fn().mockReturnValue(verification),
    });
    const epoch = store.beginProtectedOperation();

    const result = service.verify("correct horse", epoch);
    await Promise.resolve();
    store.setLoggedOut();
    resolveVerification();

    await expect(result).resolves.toBe(false);
    expect(masterKey).toEqual(new Uint8Array(4));
  });

  it("uses fixed errors for invalid passwords and unavailable verification", async () => {
    const invalid = setup({
      postVerifyPassword: vi.fn().mockRejectedValue(new BitwardenApiError(400, { private: "ignored" })),
    });
    await expect(invalid.service.verify("wrong", invalid.store.beginProtectedOperation()))
      .rejects.toEqual(new VaultRepromptError("主密码不正确。"));

    const unavailable = setup({
      postVerifyPassword: vi.fn().mockRejectedValue(new Error("private network detail")),
    });
    await expect(unavailable.service.verify("secret", unavailable.store.beginProtectedOperation()))
      .rejects.toEqual(new VaultRepromptError("无法验证主密码。"));
  });

  it("rejects empty input and stale operation epochs without API traffic", async () => {
    const { api, service, store } = setup();
    const epoch = store.beginProtectedOperation();
    store.cancelProtectedOperations();

    await expect(service.verify("secret", epoch)).resolves.toBe(false);
    await expect(service.verify("", store.beginProtectedOperation()))
      .rejects.toEqual(new VaultRepromptError("请输入主密码。"));
    expect(api.postPasswordPrelogin).not.toHaveBeenCalled();
  });
});
