import { SEND_KDF_ITERATIONS } from "@bitwarden/common/tools/send/send-kdf";

import {
  base64ToBytes,
  bytesToBase64,
  deriveHkdfSha256Key,
  encryptBytesToEncString,
  encryptUtf8ToEncString,
} from "../../auth/bitwarden-crypto";
import type { TextSendCreateRequest } from "../../bitwarden-api/bitwarden-api";

export interface TextSendCreateInput {
  readonly userKeyB64: string;
  readonly name: string;
  readonly text: string;
  readonly notes: string;
  readonly authType?: "none" | "password";
  readonly password?: string;
  readonly maxAccessCount?: number;
  readonly deletionDate: string;
  readonly hidden?: boolean;
  readonly hideEmail?: boolean;
  readonly seedBytes?: Uint8Array;
  readonly randomBytes?: (length: number) => Uint8Array;
}

export interface TextSendUpdateInput {
  readonly userKeyB64: string;
  readonly urlB64Key: string;
  readonly name: string;
  readonly text: string;
  readonly notes: string;
  readonly authType?: "none" | "password";
  readonly password?: string;
  readonly preservePassword?: boolean;
  readonly maxAccessCount?: number;
  readonly deletionDate: string;
  readonly existingDeletionDate?: string;
  readonly hidden?: boolean;
  readonly hideEmail?: boolean;
  readonly randomBytes?: (length: number) => Uint8Array;
}

export interface TextSendCreateBuildResult {
  readonly request: TextSendCreateRequest;
  readonly urlB64Key: string;
}

export async function buildTextSendCreateRequest(
  input: TextSendCreateInput,
): Promise<TextSendCreateBuildResult> {
  const randomBytes = input.randomBytes ?? secureRandomBytes;
  const seed = input.seedBytes ?? randomBytes(16);

  return buildTextSendRequest({ ...input, seed, randomBytes });
}

export async function buildTextSendUpdateRequest(
  input: TextSendUpdateInput,
): Promise<TextSendCreateBuildResult> {
  const randomBytes = input.randomBytes ?? secureRandomBytes;
  const seed = base64ToBytes(input.urlB64Key);

  return buildTextSendRequest({ ...input, seed, randomBytes });
}

async function buildTextSendRequest(
  input: Omit<TextSendCreateInput, "seedBytes"> & {
    readonly seed: Uint8Array;
    readonly randomBytes: (length: number) => Uint8Array;
  },
): Promise<TextSendCreateBuildResult> {
  const deletionDate = requiredDeletionIsoDate(
    input.deletionDate,
    "existingDeletionDate" in input && typeof input.existingDeletionDate === "string"
      ? input.existingDeletionDate
      : undefined,
    new Date(),
  );
  const seed = input.seed;
  const userKey = base64ToBytes(input.userKeyB64);
  const sendKey = await deriveHkdfSha256Key(seed, "bitwarden-send", "send", 64);
  const sendKeyB64 = bytesToBase64(sendKey);
  const notes = input.notes.trim();
  const password = input.authType === "none" ? undefined : input.password?.trim();
  const authType = input.authType === "none"
    ? 2
    : input.authType === "password" || password || ("preservePassword" in input && input.preservePassword)
      ? 1
      : 2;

  return {
    urlB64Key: bytesToBase64(seed),
    request: {
      type: 0,
      name: await encryptUtf8ToEncString(input.name.trim(), sendKeyB64, input.randomBytes),
      notes: notes ? await encryptUtf8ToEncString(notes, sendKeyB64, input.randomBytes) : null,
      key: await encryptBytesToEncString(seed, userKey, input.randomBytes),
      ...(input.maxAccessCount == null ? {} : { maxAccessCount: input.maxAccessCount }),
      expirationDate: null,
      deletionDate,
      text: {
        text: await encryptUtf8ToEncString(input.text, sendKeyB64, input.randomBytes),
        hidden: input.hidden ?? false,
      },
      file: null,
      password: password ? await deriveSendPasswordProofB64(password, seed) : null,
      emails: null,
      disabled: false,
      hideEmail: input.hideEmail ?? false,
      authType,
    },
  };
}

function requiredDeletionIsoDate(value: string, existingValue: string | undefined, now: Date): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Invalid Text Send deletion date");
  }
  if (value === existingValue) return value;
  if (timestamp <= now.getTime()) throw new Error("Invalid Text Send deletion date");
  return new Date(timestamp).toISOString();
}

async function deriveSendPasswordProofB64(password: string, seed: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bufferSource(seed),
      iterations: SEND_KDF_ITERATIONS,
    },
    key,
    256,
  );

  return bytesToBase64(new Uint8Array(bits));
}

function secureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
