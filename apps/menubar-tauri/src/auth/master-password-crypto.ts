import { BitwardenSdkCore } from "../sdk/bitwarden-sdk-core.service";

type SdkKdf = Parameters<BitwardenSdkCore["deriveKdfMaterial"]>[2];

export interface PasswordPreloginResponseShape {
  readonly Kdf?: number;
  readonly KdfIterations?: number;
  readonly KdfMemory?: number;
  readonly KdfParallelism?: number;
  readonly kdf?: number;
  readonly kdfIterations?: number;
  readonly kdfMemory?: number;
  readonly kdfParallelism?: number;
}

export type BitwardenKdfConfig =
  | {
      readonly type: "PBKDF2_SHA256";
      readonly iterations: number;
    }
  | {
      readonly type: "Argon2id";
      readonly iterations: number;
      readonly memory: number;
      readonly parallelism: number;
    };

export interface MasterPasswordDerivationInput {
  readonly masterPassword: string;
  readonly email: string;
  readonly kdf: BitwardenKdfConfig;
}

export interface MasterPasswordDerivation {
  readonly authenticationHashB64: string;
  readonly masterKey: Uint8Array;
}

export interface MasterPasswordCrypto {
  derive(input: MasterPasswordDerivationInput): Promise<MasterPasswordDerivation>;
  decryptUserKeyWithMasterKey(
    encryptedUserKey: string,
    masterKey: Uint8Array,
  ): Promise<Uint8Array>;
}

export function kdfConfigFromPrelogin(
  response: PasswordPreloginResponseShape,
): BitwardenKdfConfig {
  const kdf = response.Kdf ?? response.kdf;
  const iterations = response.KdfIterations ?? response.kdfIterations;
  const memory = response.KdfMemory ?? response.kdfMemory;
  const parallelism = response.KdfParallelism ?? response.kdfParallelism;

  if (kdf === 0) {
    return {
      type: "PBKDF2_SHA256",
      iterations: requireKdfU32(iterations, "PBKDF2 iterations", 5_000),
    };
  }

  if (kdf === 1) {
    return {
      type: "Argon2id",
      iterations: requireKdfU32(iterations, "Argon2id iterations", 2),
      memory: requireKdfU32(memory, "Argon2id memory", 16),
      parallelism: requireKdfU32(parallelism, "Argon2id parallelism", 1),
    };
  }

  throw new Error("Unsupported password KDF");
}

export function kdfConfigToSdk(config: BitwardenKdfConfig): SdkKdf {
  return config.type === "PBKDF2_SHA256"
    ? { pBKDF2: { iterations: config.iterations } }
    : {
        argon2id: {
          iterations: config.iterations,
          memory: config.memory,
          parallelism: config.parallelism,
        },
      };
}

function requireKdfU32(value: number | undefined, label: string, minimum: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > 0xffff_ffff
  ) {
    throw new Error(`Invalid ${label}`);
  }

  return value;
}

export class OfficialMasterPasswordCrypto implements MasterPasswordCrypto {
  constructor(
    private readonly sdk: Pick<
      BitwardenSdkCore,
      "deriveKdfMaterial" | "decryptUserKeyWithMasterKey"
    > = new BitwardenSdkCore(),
  ) {}

  async derive(input: MasterPasswordDerivationInput): Promise<MasterPasswordDerivation> {
    const password = new TextEncoder().encode(input.masterPassword);
    const salt = new TextEncoder().encode(input.email.toLowerCase().trim());
    let masterKey: Uint8Array | undefined;
    let authenticationHash: Uint8Array | undefined;

    try {
      masterKey = await this.sdk.deriveKdfMaterial(password, salt, kdfConfigToSdk(input.kdf));
      authenticationHash = await pbkdf2Bytes(masterKey, password, 1);
      return {
        authenticationHashB64: bytesToBase64(authenticationHash),
        masterKey,
      };
    } catch {
      masterKey?.fill(0);
      throw new Error("Unable to derive master password");
    } finally {
      password.fill(0);
      salt.fill(0);
      authenticationHash?.fill(0);
    }
  }

  async decryptUserKeyWithMasterKey(
    encryptedUserKey: string,
    masterKey: Uint8Array,
  ): Promise<Uint8Array> {
    try {
      return await this.sdk.decryptUserKeyWithMasterKey(encryptedUserKey, masterKey);
    } catch {
      throw new Error("Unable to decrypt user key");
    }
  }
}

async function pbkdf2Bytes(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations,
    },
    key,
    256,
  );

  return new Uint8Array(bits);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
