import type { AuthSession } from "../../auth/auth-session-store";
import { isBitwardenClientId } from "../../bitwarden-api/bitwarden-api";
import { createDefaultHostService } from "../../host/default-host.service";

const PIN_PATTERN = /^[0-9]{6,8}$/;
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{64}$/;
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MAX_ATTEMPTS = 5;
const PIN_RECORD_KEY_PREFIX = "auth.pin.";

export type PinUnlockResult =
  | { readonly status: "success"; readonly session: AuthSession }
  | { readonly status: "incorrect"; readonly attemptsRemaining: number }
  | { readonly status: "exhausted" }
  | { readonly status: "unavailable" };

export interface RuntimePinVaultPort {
  enable(accountId: string, pin: string, session: AuthSession): Promise<void>;
  /** Enables a persisted PIN only after this app process has accepted the master password. */
  activatePersistedPin(accountId: string): Promise<void>;
  unlock(accountId: string, pin: string): Promise<PinUnlockResult>;
  prepareForLock(accountId: string, session: AuthSession): void;
  disable(accountId: string): Promise<void>;
  clearDerivedKey(accountId: string): void;
  clearAccount(accountId: string): Promise<void>;
  isEnabled(accountId: string): boolean;
}

export interface PinEnvelope {
  readonly salt: string;
  readonly iv: string;
  readonly ciphertext: string;
}

interface PinRecord {
  envelope: PinEnvelope;
  derivedKey: CryptoKey | null;
  attemptsRemaining: number;
  pendingReplacement: Promise<void> | null;
}

interface PinPayload {
  readonly version: 1;
  readonly accountId: string;
  readonly session: AuthSession;
}

export interface PinRecordStorePort {
  read(accountId: string): Promise<PinEnvelope | null>;
  write(accountId: string, envelope: PinEnvelope): Promise<void>;
  remove(accountId: string): Promise<void>;
}

/**
 * PIN ciphertext is protected twice: by the PIN-derived AES key and by the
 * platform keychain. The process never persists a raw PIN or derived key.
 */
export class SecurePinRecordStore implements PinRecordStorePort {
  private readonly host = createDefaultHostService();

  async read(accountId: string): Promise<PinEnvelope | null> {
    validateAccountId(accountId);
    const raw = await this.host.secureGet(pinRecordStorageKey(accountId));
    if (!raw) return null;
    const envelope = decodeEnvelope(raw);
    if (!envelope) {
      await this.host.secureDelete(pinRecordStorageKey(accountId));
      return null;
    }
    return envelope;
  }

  write(accountId: string, envelope: PinEnvelope): Promise<void> {
    validateAccountId(accountId);
    return this.host.secureSet(pinRecordStorageKey(accountId), JSON.stringify(envelope));
  }

  remove(accountId: string): Promise<void> {
    validateAccountId(accountId);
    return this.host.secureDelete(pinRecordStorageKey(accountId));
  }
}

export function pinRecordStorageKey(accountId: string): string {
  validateAccountId(accountId);
  return `${PIN_RECORD_KEY_PREFIX}${accountId}`;
}

export class RuntimePinVault implements RuntimePinVaultPort {
  #records = new Map<string, PinRecord>();
  #store: PinRecordStorePort;

  constructor(store: PinRecordStorePort = new SecurePinRecordStore()) {
    this.#store = store;
  }

  async enable(accountId: string, pin: string, session: AuthSession): Promise<void> {
    validateAccountId(accountId);
    validatePin(pin);
    const serialized = serializePayload(accountId, session);
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    let key: CryptoKey | null = null;

    try {
      key = await deriveKey(pin, salt);
      const envelope = await encryptSerialized(key, salt, serialized);
      await this.#store.write(accountId, envelope);
      this.#records.set(accountId, {
        envelope,
        derivedKey: key,
        attemptsRemaining: MAX_ATTEMPTS,
        pendingReplacement: null,
      });
    } catch (error) {
      key = null;
      this.#records.delete(accountId);
      throw error;
    } finally {
      salt.fill(0);
    }
  }

  async activatePersistedPin(accountId: string): Promise<void> {
    validateAccountId(accountId);
    if (this.#records.has(accountId)) return;

    const envelope = await this.#store.read(accountId);
    if (!envelope) return;
    this.#records.set(accountId, {
      envelope,
      derivedKey: null,
      attemptsRemaining: MAX_ATTEMPTS,
      pendingReplacement: null,
    });
  }

  async unlock(accountId: string, pin: string): Promise<PinUnlockResult> {
    if (!ACCOUNT_ID_PATTERN.test(accountId)) {
      return { status: "unavailable" };
    }

    let record = this.#records.get(accountId);
    if (!record) {
      return { status: "unavailable" };
    }

    await record.pendingReplacement;
    record = this.#records.get(accountId);
    if (!record) {
      return { status: "unavailable" };
    }

    if (!PIN_PATTERN.test(pin)) {
      return this.#incorrect(accountId, record);
    }

    let key: CryptoKey | null = null;
    try {
      key = await deriveKeyFromEnvelope(pin, record.envelope);
      const payload = await decryptPayload(key, record.envelope);
      if (!payload || payload.accountId !== accountId) {
        await this.#remove(accountId, record);
        key = null;
        return { status: "unavailable" };
      }

      record.derivedKey = key;
      record.attemptsRemaining = MAX_ATTEMPTS;
      return { status: "success", session: payload.session };
    } catch {
      key = null;
      return this.#incorrect(accountId, record);
    }
  }

  prepareForLock(accountId: string, session: AuthSession): void {
    const record = this.#records.get(accountId);
    if (!record) {
      return;
    }

    const key = record.derivedKey;
    if (!key) {
      return;
    }

    let serialized: string;
    try {
      serialized = serializePayload(accountId, session);
    } catch {
      void this.#remove(accountId, record);
      return;
    }

    const salt = fromBase64(record.envelope.salt);
    const replacement = encryptSerialized(key, salt, serialized)
      .then(async (envelope) => {
        await this.#store.write(accountId, envelope);
        if (this.#records.get(accountId) === record) {
          record.envelope = envelope;
        }
      })
      .catch(() => {
        if (this.#records.get(accountId) === record) {
          this.#records.delete(accountId);
        }
        void this.#store.remove(accountId).catch(() => undefined);
      })
      .finally(() => {
        salt.fill(0);
        if (this.#records.get(accountId) === record) {
          record.derivedKey = null;
          record.pendingReplacement = null;
        }
      });
    record.pendingReplacement = replacement;
  }

  async disable(accountId: string): Promise<void> {
    this.#records.delete(accountId);
    await this.#store.remove(accountId);
  }

  clearDerivedKey(accountId: string): void {
    const record = this.#records.get(accountId);
    if (record) {
      record.derivedKey = null;
    }
  }

  clearAccount(accountId: string): Promise<void> {
    return this.disable(accountId);
  }

  isEnabled(accountId: string): boolean {
    return this.#records.has(accountId);
  }

  #incorrect(accountId: string, record: PinRecord): PinUnlockResult {
    record.derivedKey = null;
    record.attemptsRemaining -= 1;
    if (record.attemptsRemaining <= 0) {
      this.#records.delete(accountId);
      void this.#store.remove(accountId).catch(() => undefined);
      return { status: "exhausted" };
    }
    return {
      status: "incorrect",
      attemptsRemaining: record.attemptsRemaining,
    };
  }

  async #remove(accountId: string, record?: PinRecord): Promise<void> {
    if (!record || this.#records.get(accountId) === record) {
      this.#records.delete(accountId);
    }
    try {
      await this.#store.remove(accountId);
    } catch {
      // Invalid encrypted material must never become usable in this process.
    }
  }
}

function decodeEnvelope(raw: string): PinEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const { salt, iv, ciphertext } = parsed;
    return typeof salt === "string" && typeof iv === "string" && typeof ciphertext === "string"
      ? { salt, iv, ciphertext }
      : null;
  } catch {
    return null;
  }
}

function validateAccountId(accountId: string): void {
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error("invalid-account");
  }
}

function validatePin(pin: string): void {
  if (!PIN_PATTERN.test(pin)) {
    throw new Error("invalid-pin");
  }
}

function serializePayload(accountId: string, session: AuthSession): string {
  if (!isAuthSession(session)) {
    throw new Error("invalid-session");
  }
  return JSON.stringify({
    version: 1,
    accountId,
    session,
  } satisfies PinPayload);
}

async function deriveKeyFromEnvelope(pin: string, envelope: PinEnvelope): Promise<CryptoKey> {
  const salt = fromBase64(envelope.salt);
  try {
    return await deriveKey(pin, salt);
  } finally {
    salt.fill(0);
  }
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const pinBytes = new TextEncoder().encode(pin);
  try {
    const keyMaterial = await crypto.subtle.importKey("raw", pinBytes, "PBKDF2", false, [
      "deriveKey",
    ]);
    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations: PBKDF2_ITERATIONS,
      },
      keyMaterial,
      {
        name: "AES-GCM",
        length: 256,
      },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    pinBytes.fill(0);
  }
}

async function encryptSerialized(
  key: CryptoKey,
  salt: Uint8Array,
  serialized: string,
): Promise<PinEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(serialized);
  let ciphertext: Uint8Array | null = null;
  try {
    ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
        },
        key,
        plaintext,
      ),
    );
    return {
      salt: toBase64(salt),
      iv: toBase64(iv),
      ciphertext: toBase64(ciphertext),
    };
  } finally {
    plaintext.fill(0);
    iv.fill(0);
    ciphertext?.fill(0);
  }
}

async function decryptPayload(key: CryptoKey, envelope: PinEnvelope): Promise<PinPayload | null> {
  const iv = fromBase64(envelope.iv);
  const ciphertext = fromBase64(envelope.ciphertext);
  let plaintext: Uint8Array | null = null;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
        },
        key,
        ciphertext,
      ),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    return isPinPayload(parsed) ? parsed : null;
  } finally {
    iv.fill(0);
    ciphertext.fill(0);
    plaintext?.fill(0);
  }
}

function isPinPayload(value: unknown): value is PinPayload {
  return (
    isRecord(value) &&
    value["version"] === 1 &&
    typeof value["accountId"] === "string" &&
    ACCOUNT_ID_PATTERN.test(value["accountId"]) &&
    isAuthSession(value["session"])
  );
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!isRecord(value) || !isRecord(value["environment"]) || !isRecord(value["token"])) {
    return false;
  }

  const environment = value["environment"];
  const token = value["token"];
  const cryptoState = value["crypto"];

  return (
    isNonEmptyString(environment["apiUrl"]) &&
    isNonEmptyString(environment["identityUrl"]) &&
    isNullableString(environment["iconsUrl"]) &&
    isNullableString(environment["webVaultUrl"]) &&
    isNullableString(environment["sendUrl"]) &&
    isNonEmptyString(token["accessToken"]) &&
    isNonEmptyString(token["refreshToken"]) &&
    isNonEmptyString(token["tokenType"]) &&
    typeof token["expiresIn"] === "number" &&
    Number.isFinite(token["expiresIn"]) &&
    (token["clientId"] == null || isBitwardenClientId(token["clientId"])) &&
    (token["obtainedAtEpochMs"] == null ||
      (typeof token["obtainedAtEpochMs"] === "number" &&
        Number.isFinite(token["obtainedAtEpochMs"]))) &&
    (cryptoState == null ||
      (isRecord(cryptoState) && isNonEmptyString(cryptoState["userKeyB64"])))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
