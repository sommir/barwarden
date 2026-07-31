import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  BitwardenSdkCore,
  type SdkBindings,
} from "./bitwarden-sdk-core.service";

describe("BitwardenSdkCore", () => {
  it("boots the real browser WASM runtime before invoking SDK exports", async () => {
    const browserFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/node_modules/")) {
        return new Response(readFileSync(resolve(process.cwd(), `.${url}`)), {
          headers: { "Content-Type": "application/wasm" },
        });
      }
      return browserFetch(input, init);
    });

    try {
      const core = new BitwardenSdkCore();
      await expect(core.randomNumber(7, 7)).resolves.toBe(7);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("delegates password generation and disposes both SDK wrappers", async () => {
    const wasm = {} as WebAssembly.Module;
    const password = vi.fn(() => "OfficialPassword1");
    const freeGenerator = vi.fn();
    const freeClient = vi.fn();
    const PasswordManagerClient = vi.fn(function PasswordManagerClient() {
      return {
        generator: () => ({ password, passphrase: vi.fn(), free: freeGenerator }),
        free: freeClient,
      };
    });
    const bindings = {
      init: vi.fn(),
      init_sdk: vi.fn(),
      PasswordManagerClient,
      PureCrypto: {
        symmetric_encrypt_filedata: vi.fn(),
        symmetric_encrypt_string: vi.fn(),
        wrap_symmetric_key: vi.fn(),
        unwrap_symmetric_key: vi.fn(),
        symmetric_decrypt_filedata: vi.fn(),
        symmetric_decrypt_bytes: vi.fn(),
        decapsulate_key_unsigned: vi.fn(),
      },
    } as unknown as SdkBindings;
    const core = new BitwardenSdkCore(bindings, async () => wasm);
    const request = {
      lowercase: true,
      uppercase: true,
      numbers: true,
      special: false,
      length: 14,
      avoidAmbiguous: false,
      minLowercase: 1,
      minUppercase: 1,
      minNumber: 1,
      minSpecial: undefined,
    };

    await expect(core.generatePassword(request)).resolves.toBe("OfficialPassword1");

    expect(PasswordManagerClient).toHaveBeenCalledWith(null);
    expect(password).toHaveBeenCalledWith(request);
    expect(freeGenerator).toHaveBeenCalledTimes(1);
    expect(freeClient).toHaveBeenCalledTimes(1);
  });

  it("disposes both SDK wrappers when passphrase generation fails", async () => {
    const passphrase = vi.fn(() => {
      throw new Error("generation failed");
    });
    const freeGenerator = vi.fn();
    const freeClient = vi.fn();
    const bindings = {
      init: vi.fn(),
      init_sdk: vi.fn(),
      PasswordManagerClient: vi.fn(function PasswordManagerClient() {
        return {
          generator: () => ({ password: vi.fn(), passphrase, free: freeGenerator }),
          free: freeClient,
        };
      }),
      PureCrypto: {
        symmetric_encrypt_filedata: vi.fn(),
        symmetric_encrypt_string: vi.fn(),
        wrap_symmetric_key: vi.fn(),
        unwrap_symmetric_key: vi.fn(),
        symmetric_decrypt_filedata: vi.fn(),
        symmetric_decrypt_bytes: vi.fn(),
        decapsulate_key_unsigned: vi.fn(),
      },
    } as unknown as SdkBindings;
    const core = new BitwardenSdkCore(bindings, async () => ({} as WebAssembly.Module));

    await expect(
      core.generatePassphrase({
        numWords: 6,
        wordSeparator: "-",
        capitalize: false,
        includeNumber: false,
      }),
    ).rejects.toThrow("generation failed");

    expect(passphrase).toHaveBeenCalledWith({
      numWords: 6,
      wordSeparator: "-",
      capitalize: false,
      includeNumber: false,
    });
    expect(freeGenerator).toHaveBeenCalledTimes(1);
    expect(freeClient).toHaveBeenCalledTimes(1);
  });

  it("delegates inclusive random numbers to the official SDK", async () => {
    const randomNumber = vi.fn(() => 9);
    const bindings = {
      init: vi.fn(),
      init_sdk: vi.fn(),
      PureCrypto: {
        symmetric_encrypt_filedata: vi.fn(),
        symmetric_encrypt_string: vi.fn(),
        wrap_symmetric_key: vi.fn(),
        unwrap_symmetric_key: vi.fn(),
        symmetric_decrypt_filedata: vi.fn(),
        symmetric_decrypt_bytes: vi.fn(),
        decapsulate_key_unsigned: vi.fn(),
        random_number: randomNumber,
      },
    } as unknown as SdkBindings;
    const core = new BitwardenSdkCore(bindings, async () => ({} as WebAssembly.Module));

    await expect(core.randomNumber(0, 9)).resolves.toBe(9);

    expect(randomNumber).toHaveBeenCalledWith(0, 9);
  });

  it("initializes the official WASM binding once for concurrent string encryption", async () => {
    const wasm = {} as WebAssembly.Module;
    const encryptString = vi.fn((value: string) => `2.${value}`);
    const bindings: SdkBindings = {
      init: vi.fn(),
      init_sdk: vi.fn(),
      PureCrypto: {
        symmetric_encrypt_filedata: vi.fn(),
        symmetric_encrypt_string: encryptString,
        wrap_symmetric_key: vi.fn(),
        unwrap_symmetric_key: vi.fn(),
        symmetric_decrypt_filedata: vi.fn(),
        symmetric_decrypt_bytes: vi.fn(),
        decapsulate_key_unsigned: vi.fn(),
        derive_kdf_material: vi.fn(),
        decrypt_user_key_with_master_key: vi.fn(),
      },
    };
    const loadWasm = vi.fn(async () => wasm);
    const core = new BitwardenSdkCore(bindings, loadWasm);
    const key = new Uint8Array(64);

    const [first, second] = await Promise.all([
      core.encryptString("first", key),
      core.encryptString("second", key),
    ]);

    expect(first).toBe("2.first");
    expect(second).toBe("2.second");
    expect(loadWasm).toHaveBeenCalledTimes(1);
    expect(bindings.init).toHaveBeenCalledWith(wasm);
    expect(bindings.init_sdk).toHaveBeenCalledTimes(1);
    expect(encryptString).toHaveBeenCalledWith("first", key);
    expect(encryptString).toHaveBeenCalledWith("second", key);
  });

  it("delegates attachment filename encryption and attachment-key wrapping to the official SDK", async () => {
    const wasm = {} as WebAssembly.Module;
    const symmetricEncryptString = vi.fn(() => "2.encrypted-file-name");
    const wrapSymmetricKey = vi.fn(() => "2.wrapped-attachment-key");
    const bindings = {
      init: vi.fn(),
      init_sdk: vi.fn(),
      PureCrypto: {
        symmetric_encrypt_filedata: vi.fn(),
        symmetric_encrypt_string: symmetricEncryptString,
        wrap_symmetric_key: wrapSymmetricKey,
        unwrap_symmetric_key: vi.fn(),
        symmetric_decrypt_filedata: vi.fn(),
        symmetric_decrypt_bytes: vi.fn(),
        decapsulate_key_unsigned: vi.fn(),
      },
    } as unknown as SdkBindings;
    const core = new BitwardenSdkCore(bindings, async () => wasm);
    const cipherKey = new Uint8Array(64).fill(1);
    const attachmentKey = new Uint8Array(64).fill(2);
    const attachmentCore = core as unknown as {
      encryptString(value: string, key: Uint8Array): Promise<string>;
      wrapSymmetricKey(keyToWrap: Uint8Array, wrappingKey: Uint8Array): Promise<string>;
    };

    await expect(attachmentCore.encryptString("budget.xlsx", cipherKey)).resolves.toBe(
      "2.encrypted-file-name",
    );
    await expect(attachmentCore.wrapSymmetricKey(attachmentKey, cipherKey)).resolves.toBe(
      "2.wrapped-attachment-key",
    );

    expect(symmetricEncryptString).toHaveBeenCalledWith("budget.xlsx", cipherKey);
    expect(wrapSymmetricKey).toHaveBeenCalledWith(attachmentKey, cipherKey);
    expect(bindings.init).toHaveBeenCalledTimes(1);
    expect(bindings.init_sdk).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed attachment keys before SDK initialization", async () => {
    const bindings = {
      init: vi.fn(),
      init_sdk: vi.fn(),
      PureCrypto: {
        symmetric_encrypt_filedata: vi.fn(),
        symmetric_encrypt_string: vi.fn(),
        wrap_symmetric_key: vi.fn(),
        unwrap_symmetric_key: vi.fn(),
        symmetric_decrypt_filedata: vi.fn(),
        symmetric_decrypt_bytes: vi.fn(),
        decapsulate_key_unsigned: vi.fn(),
      },
    } as unknown as SdkBindings;
    const loadWasm = vi.fn(async () => ({} as WebAssembly.Module));
    const core = new BitwardenSdkCore(bindings, loadWasm);
    const attachmentCore = core as unknown as {
      encryptString(value: string, key: Uint8Array): Promise<string>;
      wrapSymmetricKey(keyToWrap: Uint8Array, wrappingKey: Uint8Array): Promise<string>;
    };

    await expect(attachmentCore.encryptString("budget.xlsx", new Uint8Array(63))).rejects.toThrow(
      "Bitwarden symmetric key must be 64 bytes",
    );
    await expect(
      attachmentCore.wrapSymmetricKey(new Uint8Array(64), new Uint8Array(63)),
    ).rejects.toThrow("Bitwarden symmetric key must be 64 bytes");

    expect(loadWasm).not.toHaveBeenCalled();
    expect(bindings.PureCrypto.symmetric_encrypt_string).not.toHaveBeenCalled();
    expect(bindings.PureCrypto.wrap_symmetric_key).not.toHaveBeenCalled();
  });

  it("delegates symmetric key unwrapping to the official SDK", async () => {
    const unwrapSymmetricKey = vi.fn(() => new Uint8Array(64).fill(3));
    const bindings = {
      init: vi.fn(),
      init_sdk: vi.fn(),
      PureCrypto: {
        symmetric_encrypt_filedata: vi.fn(),
        symmetric_encrypt_string: vi.fn(),
        wrap_symmetric_key: vi.fn(),
        unwrap_symmetric_key: unwrapSymmetricKey,
        symmetric_decrypt_filedata: vi.fn(),
        symmetric_decrypt_bytes: vi.fn(),
        decapsulate_key_unsigned: vi.fn(),
      },
    } as unknown as SdkBindings;
    const core = new BitwardenSdkCore(bindings, async () => ({} as WebAssembly.Module));
    const downloadCore = core as unknown as {
      unwrapSymmetricKey(wrapped: string, key: Uint8Array): Promise<Uint8Array>;
    };
    const cipherKey = new Uint8Array(64).fill(1);

    await expect(downloadCore.unwrapSymmetricKey("2.wrapped-key", cipherKey)).resolves.toEqual(
      new Uint8Array(64).fill(3),
    );

    expect(unwrapSymmetricKey).toHaveBeenCalledWith("2.wrapped-key", cipherKey);
    expect(bindings.init).toHaveBeenCalledTimes(1);
    expect(bindings.init_sdk).toHaveBeenCalledTimes(1);
  });

  it("delegates private-key and organization-key decryption to the official SDK", async () => {
    const decryptBytes = vi.fn(() => new Uint8Array([1, 2, 3]));
    const decapsulateKeyUnsigned = vi.fn(() => new Uint8Array(64).fill(4));
    const bindings = {
      init: vi.fn(),
      init_sdk: vi.fn(),
      PureCrypto: {
        symmetric_encrypt_filedata: vi.fn(),
        symmetric_encrypt_string: vi.fn(),
        wrap_symmetric_key: vi.fn(),
        unwrap_symmetric_key: vi.fn(),
        symmetric_decrypt_filedata: vi.fn(),
        symmetric_decrypt_bytes: decryptBytes,
        decapsulate_key_unsigned: decapsulateKeyUnsigned,
      },
    } as unknown as SdkBindings;
    const core = new BitwardenSdkCore(bindings, async () => ({} as WebAssembly.Module)) as unknown as {
      decryptBytes(encrypted: string, key: Uint8Array): Promise<Uint8Array>;
      decapsulateKeyUnsigned(encrypted: string, privateKey: Uint8Array): Promise<Uint8Array>;
    };
    const userKey = new Uint8Array(64).fill(5);
    const privateKey = new Uint8Array([6, 7, 8]);

    await expect(core.decryptBytes("2.encrypted-private-key", userKey)).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    await expect(
      core.decapsulateKeyUnsigned("4.encapsulated-organization-key", privateKey),
    ).resolves.toEqual(new Uint8Array(64).fill(4));

    expect(decryptBytes).toHaveBeenCalledWith("2.encrypted-private-key", userKey);
    expect(decapsulateKeyUnsigned).toHaveBeenCalledWith(
      "4.encapsulated-organization-key",
      privateKey,
    );
  });

  it("rejects malformed organization key inputs before SDK initialization", async () => {
    const bindings = {
      init: vi.fn(),
      init_sdk: vi.fn(),
      PureCrypto: {
        symmetric_encrypt_filedata: vi.fn(),
        symmetric_encrypt_string: vi.fn(),
        wrap_symmetric_key: vi.fn(),
        unwrap_symmetric_key: vi.fn(),
        symmetric_decrypt_filedata: vi.fn(),
        symmetric_decrypt_bytes: vi.fn(),
        decapsulate_key_unsigned: vi.fn(),
      },
    } as unknown as SdkBindings;
    const loadWasm = vi.fn(async () => ({} as WebAssembly.Module));
    const core = new BitwardenSdkCore(bindings, loadWasm) as unknown as {
      decryptBytes(encrypted: string, key: Uint8Array): Promise<Uint8Array>;
      decapsulateKeyUnsigned(encrypted: string, privateKey: Uint8Array): Promise<Uint8Array>;
    };

    await expect(core.decryptBytes("", new Uint8Array(64))).rejects.toThrow(
      "Bitwarden encrypted bytes are required",
    );
    await expect(core.decryptBytes("2.value", new Uint8Array(63))).rejects.toThrow(
      "Bitwarden symmetric key must be 64 bytes",
    );
    await expect(core.decapsulateKeyUnsigned("", new Uint8Array([1]))).rejects.toThrow(
      "Bitwarden encapsulated key is required",
    );
    await expect(core.decapsulateKeyUnsigned("4.value", new Uint8Array())).rejects.toThrow(
      "Bitwarden private key is required",
    );

    expect(loadWasm).not.toHaveBeenCalled();
  });

  it("forwards an Argon2id KDF to the initialized official SDK", async () => {
    const wasm = {} as WebAssembly.Module;
    const output = new Uint8Array(32).fill(7);
    const deriveKdfMaterial = vi.fn(() => output);
    const bindings = {
      init: vi.fn(),
      init_sdk: vi.fn(),
      PureCrypto: {
        symmetric_encrypt_filedata: vi.fn(),
        symmetric_encrypt_string: vi.fn(),
        wrap_symmetric_key: vi.fn(),
        unwrap_symmetric_key: vi.fn(),
        symmetric_decrypt_filedata: vi.fn(),
        symmetric_decrypt_bytes: vi.fn(),
        decapsulate_key_unsigned: vi.fn(),
        derive_kdf_material: deriveKdfMaterial,
        decrypt_user_key_with_master_key: vi.fn(),
      },
    } as unknown as SdkBindings;
    const core = new BitwardenSdkCore(bindings, async () => wasm);
    const password = new TextEncoder().encode("test-password");
    const salt = new TextEncoder().encode("user@example.com");
    const kdf = { argon2id: { iterations: 3, memory: 64, parallelism: 4 } } as const;

    await expect(core.deriveKdfMaterial(password, salt, kdf)).resolves.toEqual(output);

    expect(bindings.init).toHaveBeenCalledWith(wasm);
    expect(bindings.init_sdk).toHaveBeenCalledOnce();
    expect(deriveKdfMaterial).toHaveBeenCalledWith(password, salt, kdf);
  });

  it("rejects an SDK KDF result that is not 32 bytes", async () => {
    const bindings = {
      init: vi.fn(),
      init_sdk: vi.fn(),
      PureCrypto: {
        symmetric_encrypt_filedata: vi.fn(),
        symmetric_encrypt_string: vi.fn(),
        wrap_symmetric_key: vi.fn(),
        unwrap_symmetric_key: vi.fn(),
        symmetric_decrypt_filedata: vi.fn(),
        symmetric_decrypt_bytes: vi.fn(),
        decapsulate_key_unsigned: vi.fn(),
        derive_kdf_material: vi.fn(() => new Uint8Array(31)),
        decrypt_user_key_with_master_key: vi.fn(),
      },
    } as unknown as SdkBindings;
    const core = new BitwardenSdkCore(bindings, async () => ({} as WebAssembly.Module));

    await expect(
      core.deriveKdfMaterial(new Uint8Array([1]), new Uint8Array([2]), {
        pBKDF2: { iterations: 600_000 },
      }),
    ).rejects.toThrow("Bitwarden SDK KDF output must be 32 bytes");
  });

  it("validates and forwards user-key decryption without constraining its output length", async () => {
    const masterKey = new Uint8Array(32).fill(8);
    const output = new Uint8Array(64).fill(9);
    const decryptUserKeyWithMasterKey = vi.fn(() => output);
    const bindings = {
      init: vi.fn(),
      init_sdk: vi.fn(),
      PureCrypto: {
        symmetric_encrypt_filedata: vi.fn(),
        symmetric_encrypt_string: vi.fn(),
        wrap_symmetric_key: vi.fn(),
        unwrap_symmetric_key: vi.fn(),
        symmetric_decrypt_filedata: vi.fn(),
        symmetric_decrypt_bytes: vi.fn(),
        decapsulate_key_unsigned: vi.fn(),
        derive_kdf_material: vi.fn(),
        decrypt_user_key_with_master_key: decryptUserKeyWithMasterKey,
      },
    } as unknown as SdkBindings;
    const core = new BitwardenSdkCore(bindings, async () => ({} as WebAssembly.Module));

    await expect(
      core.decryptUserKeyWithMasterKey("2.encrypted-user-key", masterKey),
    ).resolves.toEqual(output);
    await expect(core.decryptUserKeyWithMasterKey("  ", masterKey)).rejects.toThrow(
      "Bitwarden encrypted user key is required",
    );
    await expect(
      core.decryptUserKeyWithMasterKey("2.encrypted-user-key", new Uint8Array(31)),
    ).rejects.toThrow("Bitwarden master key must be 32 bytes");

    expect(decryptUserKeyWithMasterKey).toHaveBeenCalledWith("2.encrypted-user-key", masterKey);
  });
});
