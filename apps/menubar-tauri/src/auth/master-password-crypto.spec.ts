import { webcrypto } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OfficialMasterPasswordCrypto,
  kdfConfigFromPrelogin,
  kdfConfigToSdk,
} from "./master-password-crypto";
import { base64ToBytes, bytesToBase64 } from "./bitwarden-crypto";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("kdfConfigFromPrelogin", () => {
  it("maps the official PBKDF2 prelogin response shape", () => {
    expect(kdfConfigFromPrelogin({ Kdf: 0, KdfIterations: 600000 })).toEqual({
      type: "PBKDF2_SHA256",
      iterations: 600000,
    });
  });

  it("maps the lowercase Vaultwarden PBKDF2 prelogin response shape", () => {
    expect(kdfConfigFromPrelogin({ kdf: 0, kdfIterations: 600000 })).toEqual({
      type: "PBKDF2_SHA256",
      iterations: 600000,
    });
  });

  it("maps complete Argon2id prelogin fields to the official SDK shape", () => {
    expect(kdfConfigFromPrelogin({
        Kdf: 1,
        KdfIterations: 3,
        KdfMemory: 64,
        KdfParallelism: 4,
    })).toEqual({
      type: "Argon2id",
      iterations: 3,
      memory: 64,
      parallelism: 4,
    });
    expect(kdfConfigToSdk(kdfConfigFromPrelogin({
      kdf: 1,
      kdfIterations: 3,
      kdfMemory: 64,
      kdfParallelism: 4,
    }))).toEqual({ argon2id: { iterations: 3, memory: 64, parallelism: 4 } });
  });

  it("maps PBKDF2 to the official SDK shape", () => {
    expect(kdfConfigToSdk({ type: "PBKDF2_SHA256", iterations: 600_000 })).toEqual({
      pBKDF2: { iterations: 600_000 },
    });
  });

  it.each([
    [{}, "Unsupported password KDF"],
    [{ Kdf: 2, KdfIterations: 600_000 }, "Unsupported password KDF"],
    [{ Kdf: 0, KdfIterations: 4_999 }, "Invalid PBKDF2 iterations"],
    [{ Kdf: 0, KdfIterations: Number.POSITIVE_INFINITY }, "Invalid PBKDF2 iterations"],
    [{ Kdf: 0, KdfIterations: 2 ** 32 }, "Invalid PBKDF2 iterations"],
    [{ Kdf: 1, KdfIterations: 1, KdfMemory: 64, KdfParallelism: 4 }, "Invalid Argon2id iterations"],
    [{ Kdf: 1, KdfIterations: 3, KdfMemory: 15, KdfParallelism: 4 }, "Invalid Argon2id memory"],
    [{ Kdf: 1, KdfIterations: 3, KdfMemory: 64, KdfParallelism: 1.5 }, "Invalid Argon2id parallelism"],
  ])("rejects malformed KDF data before SDK invocation", (response, message) => {
    expect(() => kdfConfigFromPrelogin(response)).toThrow(message);
  });
});

describe("OfficialMasterPasswordCrypto", () => {
  it("derives the Argon2id password grant hash from official SDK master material", async () => {
    const masterKey = base64ToBytes("ZduKRvezs8F8103A1ZUk/1ZN+rk3Kv+D1sFgvpnaAG0=");
    let capturedPassword: Uint8Array | undefined;
    let capturedSalt: Uint8Array | undefined;
    const sdk = {
      deriveKdfMaterial: vi.fn(async (password: Uint8Array, salt: Uint8Array) => {
        capturedPassword = new Uint8Array(password);
        capturedSalt = new Uint8Array(salt);
        return masterKey;
      }),
      decryptUserKeyWithMasterKey: vi.fn(),
    };
    const crypto = new OfficialMasterPasswordCrypto(sdk);

    const result = await crypto.derive({
      masterPassword: "test-password",
      email: "USER@example.com",
      kdf: { type: "Argon2id", iterations: 3, memory: 64, parallelism: 4 },
    });

    expect(result.authenticationHashB64).toBe(
      "JkZL2iNDoefUIm/QSPWTdzwGzSvXmWxAn6JyYsdyKEg=",
    );
    expect(result.masterKey).toBe(masterKey);
    expect(bytesToBase64(result.masterKey)).toBe(
      "ZduKRvezs8F8103A1ZUk/1ZN+rk3Kv+D1sFgvpnaAG0=",
    );
    expect(capturedPassword).toEqual(new TextEncoder().encode("test-password"));
    expect(capturedSalt).toEqual(new TextEncoder().encode("user@example.com"));
    expect(sdk.deriveKdfMaterial).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.any(Uint8Array),
      { argon2id: { iterations: 3, memory: 64, parallelism: 4 } },
    );
  });

  it("maps SDK derivation failures to a fixed error", async () => {
    const crypto = new OfficialMasterPasswordCrypto({
      deriveKdfMaterial: vi.fn(async () => { throw new Error("sensitive SDK details"); }),
      decryptUserKeyWithMasterKey: vi.fn(),
    });

    await expect(crypto.derive({
      masterPassword: "test-password",
      email: "user@example.com",
      kdf: { type: "PBKDF2_SHA256", iterations: 600_000 },
    })).rejects.toThrow("Unable to derive master password");
  });

  it("maps SDK user-key unwrap failures to a fixed error", async () => {
    const crypto = new OfficialMasterPasswordCrypto({
      deriveKdfMaterial: vi.fn(),
      decryptUserKeyWithMasterKey: vi.fn(async () => {
        throw new Error("sensitive SDK details");
      }),
    });

    await expect(
      crypto.decryptUserKeyWithMasterKey("2.a|b|c", new Uint8Array(32)),
    ).rejects.toThrow("Unable to decrypt user key");
  });
});
