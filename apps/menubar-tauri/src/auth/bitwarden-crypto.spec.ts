import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  base64ToBytes,
  bytesToBase64,
  deriveHkdfSha256Key,
  encryptBytesToEncString,
  decryptEncStringToUtf8,
} from "./bitwarden-crypto";
import * as bitwardenCrypto from "./bitwarden-crypto";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("Bitwarden crypto adapter", () => {
  it("contains no retired master-key stretching or private PBKDF2 helper", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/menubar-tauri/src/auth/bitwarden-crypto.ts"),
      "utf8",
    );

    expect(source).not.toContain("stretchKey");
    expect(source).not.toContain("pbkdf2Bytes");
  });

  it("decrypts AES-CBC/HMAC encrypted strings and rejects MAC tampering", async () => {
    const key = sequentialBytes(64);
    const encrypted = await encryptBytesAsType2(new TextEncoder().encode("secret value"), key);

    await expect(decryptEncStringToUtf8(encrypted, bytesToBase64(key))).resolves.toBe(
      "secret value",
    );
    await expect(
      decryptEncStringToUtf8(`${encrypted.slice(0, -2)}AA`, bytesToBase64(key)),
    ).rejects.toThrow("MAC validation failed");
  });

  it("encrypts UTF-8 strings as Bitwarden type 2 EncString values", async () => {
    const key = sequentialBytes(64);
    const encryptUtf8ToEncString = (bitwardenCrypto as {
      encryptUtf8ToEncString?: (value: string, keyB64: string) => Promise<string>;
    }).encryptUtf8ToEncString;

    expect(encryptUtf8ToEncString).toBeTypeOf("function");
    const encrypted = await encryptUtf8ToEncString!("server-created send", bytesToBase64(key));

    expect(encrypted).toMatch(/^2\.[^|]+\|[^|]+\|[^|]+$/);
    await expect(decryptEncStringToUtf8(encrypted, bytesToBase64(key))).resolves.toBe(
      "server-created send",
    );
  });

  it("passes owned ArrayBuffer-backed copies to every Web Crypto boundary", async () => {
    const subtle = webcrypto.subtle;
    const captured: BufferSource[] = [];
    const cryptoBoundary = {
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
      subtle: {
        importKey: vi.fn(async (...args: Parameters<SubtleCrypto["importKey"]>) => {
          captured.push(args[1] as BufferSource);
          return subtle.importKey(...args);
        }),
        encrypt: vi.fn(async (...args: Parameters<SubtleCrypto["encrypt"]>) => {
          captured.push((args[0] as AesCbcParams).iv, args[2]);
          return subtle.encrypt(...args);
        }),
        sign: vi.fn(async (...args: Parameters<SubtleCrypto["sign"]>) => {
          captured.push(args[2]);
          return subtle.sign(...args);
        }),
        deriveBits: vi.fn(async (...args: Parameters<SubtleCrypto["deriveBits"]>) => {
          const algorithm = args[0] as HkdfParams;
          captured.push(algorithm.salt, algorithm.info);
          return subtle.deriveBits(...args);
        }),
      },
    };
    vi.stubGlobal("crypto", cryptoBoundary);
    const backing = new Uint8Array(96);
    backing.set(sequentialBytes(80), 8);
    const key = backing.subarray(8, 72);
    const plain = backing.subarray(72, 80);

    await encryptBytesToEncString(plain, key, () => backing.subarray(80, 96));
    await deriveHkdfSha256Key(backing.subarray(8, 24), "salt", "info", 32);

    expect(captured.length).toBeGreaterThan(0);
    for (const value of captured) {
      const view = ArrayBuffer.isView(value) ? value : new Uint8Array(value);
      expect(view.buffer).toBeInstanceOf(ArrayBuffer);
      expect(view.buffer).not.toBe(backing.buffer);
      expect(view.byteOffset).toBe(0);
      expect(view.byteLength).toBe(view.buffer.byteLength);
    }
  });
});

async function encryptBytesAsType2(plainValue: Uint8Array, key: Uint8Array): Promise<string> {
  const iv = sequentialBytes(16, 100);
  const cryptoKey = await crypto.subtle.importKey("raw", key.slice(0, 32), "AES-CBC", false, [
    "encrypt",
  ]);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, plainValue));
  const mac = await hmacSha256(key.slice(32, 64), concatBytes(iv, data));

  return `2.${bytesToBase64(iv)}|${bytesToBase64(data)}|${bytesToBase64(mac)}`;
}

async function hmacSha256(key: Uint8Array, value: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, value));
}

function sequentialBytes(length: number, start = 1): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) % 256);
}

function concatBytes(...arrays: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((total, array) => total + array.byteLength, 0));
  let offset = 0;

  for (const array of arrays) {
    result.set(array, offset);
    offset += array.byteLength;
  }

  return result;
}
