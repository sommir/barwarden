import type {
  Kdf,
  PassphraseGeneratorRequest,
  PasswordGeneratorRequest,
} from "@bitwarden/sdk-internal";

interface SdkGeneratorClient {
  password(request: PasswordGeneratorRequest): string;
  passphrase(request: PassphraseGeneratorRequest): string;
  free(): void;
}

interface SdkPasswordManagerClient {
  generator(): SdkGeneratorClient;
  free(): void;
}

export interface SdkBindings {
  init(wasm: WebAssembly.Exports | WebAssembly.Module): void;
  init_sdk(): void;
  PasswordManagerClient?: new (tokenProvider: null) => SdkPasswordManagerClient;
  PureCrypto: {
    symmetric_encrypt_filedata(plain: Uint8Array, key: Uint8Array): Uint8Array;
    symmetric_encrypt_string(plain: string, key: Uint8Array): string;
    wrap_symmetric_key(keyToWrap: Uint8Array, wrappingKey: Uint8Array): string;
    unwrap_symmetric_key(wrapped: string, wrappingKey: Uint8Array): Uint8Array;
    symmetric_decrypt_filedata(encrypted: Uint8Array, key: Uint8Array): Uint8Array;
    symmetric_decrypt_bytes(encrypted: string, key: Uint8Array): Uint8Array;
    decapsulate_key_unsigned(encapsulatedKey: string, privateKey: Uint8Array): Uint8Array;
    derive_kdf_material(password: Uint8Array, salt: Uint8Array, kdf: Kdf): Uint8Array;
    decrypt_user_key_with_master_key(encryptedUserKey: string, masterKey: Uint8Array): Uint8Array;
    random_number?(min: number, max: number): number;
  };
}

interface SdkRuntime {
  bindings: SdkBindings;
  wasm: WebAssembly.Exports | WebAssembly.Module;
}

const loadOfficialSdkRuntime = async (): Promise<SdkRuntime> => {
  const [sdk, bitwardenModule] = await Promise.all([
    import("./bitwarden-sdk-runtime"),
    import("@bitwarden/sdk-internal/bitwarden_wasm_internal_bg.wasm"),
  ]);

  return {
    bindings: sdk as unknown as SdkBindings,
    wasm: bitwardenModule as unknown as WebAssembly.Exports,
  };
};

/**
 * Narrow adapter around the official Bitwarden SDK bootstrap used for encrypted file payloads.
 */
export class BitwardenSdkCore {
  private initialization: Promise<void> | null = null;
  private runtime: SdkRuntime | null = null;

  constructor(
    private readonly bindings?: SdkBindings,
    private readonly loadWasm?: () => Promise<WebAssembly.Module>,
    private readonly loadRuntime: () => Promise<SdkRuntime> = loadOfficialSdkRuntime,
  ) {}

  async encryptString(plain: string, key: Uint8Array): Promise<string> {
    this.assertSymmetricKey(key);
    await this.initialize();
    return this.runtime!.bindings.PureCrypto.symmetric_encrypt_string(plain, key);
  }

  async wrapSymmetricKey(keyToWrap: Uint8Array, wrappingKey: Uint8Array): Promise<string> {
    this.assertSymmetricKey(keyToWrap);
    this.assertSymmetricKey(wrappingKey);
    await this.initialize();
    return this.runtime!.bindings.PureCrypto.wrap_symmetric_key(keyToWrap, wrappingKey);
  }

  async unwrapSymmetricKey(wrapped: string, wrappingKey: Uint8Array): Promise<Uint8Array> {
    if (!wrapped.trim()) {
      throw new Error("Bitwarden wrapped symmetric key is required");
    }
    this.assertSymmetricKey(wrappingKey);
    await this.initialize();
    return this.runtime!.bindings.PureCrypto.unwrap_symmetric_key(wrapped, wrappingKey);
  }

  async decryptBytes(encrypted: string, key: Uint8Array): Promise<Uint8Array> {
    if (!encrypted.trim()) {
      throw new Error("Bitwarden encrypted bytes are required");
    }
    this.assertSymmetricKey(key);
    await this.initialize();
    return this.runtime!.bindings.PureCrypto.symmetric_decrypt_bytes(encrypted, key);
  }

  async deriveKdfMaterial(
    password: Uint8Array,
    salt: Uint8Array,
    kdf: Kdf,
  ): Promise<Uint8Array> {
    await this.initialize();
    const result = this.runtime!.bindings.PureCrypto.derive_kdf_material(password, salt, kdf);
    if (result.byteLength !== 32) {
      throw new Error("Bitwarden SDK KDF output must be 32 bytes");
    }
    return result;
  }

  async decryptUserKeyWithMasterKey(
    encryptedUserKey: string,
    masterKey: Uint8Array,
  ): Promise<Uint8Array> {
    if (!encryptedUserKey.trim()) {
      throw new Error("Bitwarden encrypted user key is required");
    }
    if (masterKey.byteLength !== 32) {
      throw new Error("Bitwarden master key must be 32 bytes");
    }
    await this.initialize();
    return this.runtime!.bindings.PureCrypto.decrypt_user_key_with_master_key(
      encryptedUserKey,
      masterKey,
    );
  }

  async decapsulateKeyUnsigned(
    encapsulatedKey: string,
    privateKey: Uint8Array,
  ): Promise<Uint8Array> {
    if (!encapsulatedKey.trim()) {
      throw new Error("Bitwarden encapsulated key is required");
    }
    if (privateKey.byteLength === 0) {
      throw new Error("Bitwarden private key is required");
    }
    await this.initialize();
    return this.runtime!.bindings.PureCrypto.decapsulate_key_unsigned(
      encapsulatedKey,
      privateKey,
    );
  }

  async generatePassword(request: PasswordGeneratorRequest): Promise<string> {
    return this.withGeneratorClient((generator) => generator.password(request));
  }

  async generatePassphrase(request: PassphraseGeneratorRequest): Promise<string> {
    return this.withGeneratorClient((generator) => generator.passphrase(request));
  }

  async randomNumber(min: number, max: number): Promise<number> {
    await this.initialize();
    const randomNumber = this.runtime!.bindings.PureCrypto.random_number;
    if (!randomNumber) {
      throw new Error("Bitwarden SDK binding does not support random numbers");
    }
    return randomNumber(min, max);
  }

  private initialize(): Promise<void> {
    this.initialization ??= this.initializeOfficialSdk();
    return this.initialization;
  }

  private async initializeOfficialSdk(): Promise<void> {
    if (this.bindings) {
      if (!this.loadWasm) {
        throw new Error("A custom Bitwarden SDK binding requires a WASM loader");
      }
      this.runtime = { bindings: this.bindings, wasm: await this.loadWasm() };
    } else {
      this.runtime = await this.loadRuntime();
    }

    this.runtime.bindings.init(this.runtime.wasm);
    this.runtime.bindings.init_sdk();
  }

  private async withGeneratorClient<T>(operation: (generator: SdkGeneratorClient) => T): Promise<T> {
    await this.initialize();
    const PasswordManagerClient = this.runtime!.bindings.PasswordManagerClient;
    if (!PasswordManagerClient) {
      throw new Error("Bitwarden SDK binding does not support generator clients");
    }

    const client = new PasswordManagerClient(null);
    try {
      const generator = client.generator();
      try {
        return operation(generator);
      } finally {
        generator.free();
      }
    } finally {
      client.free();
    }
  }

  private assertSymmetricKey(key: Uint8Array): void {
    if (key.byteLength !== 64) {
      throw new Error("Bitwarden symmetric key must be 64 bytes");
    }
  }
}
