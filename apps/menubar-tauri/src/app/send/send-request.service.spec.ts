import { SEND_KDF_ITERATIONS } from "@bitwarden/common/tools/send/send-kdf";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { base64ToBytes, bytesToBase64, decryptEncStringToBytes, decryptEncStringToUtf8 } from "../../auth/bitwarden-crypto";
import { buildTextSendCreateRequest, buildTextSendUpdateRequest } from "./send-request.service";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

describe("buildTextSendCreateRequest", () => {
  it.each(["", "not-a-date", "2000-01-01T00:00:00.000Z"])(
    "rejects an invalid deletion timestamp before encryption: %s",
    async (deletionDate) => {
      await expect(buildTextSendCreateRequest({
        userKeyB64: bytesToBase64(sequentialBytes(64, 1)),
        name: "Secret",
        text: "value",
        notes: "",
        deletionDate,
      })).rejects.toThrow("Invalid Text Send deletion date");
    },
  );

  it("builds the official encrypted text Send request without leaking plaintext", async () => {
    const userKey = sequentialBytes(64, 1);
    const sendSeed = sequentialBytes(16, 200);
    const result = await buildTextSendCreateRequest({
      userKeyB64: bytesToBase64(userKey),
      name: "One time secret",
      text: "launch code",
      notes: "private note",
      maxAccessCount: 3,
      hidden: true,
      hideEmail: true,
      deletionDate: "2030-07-17T00:00:00.000Z",
      seedBytes: sendSeed,
      randomBytes: (length) => sequentialBytes(length, 100),
    } as Parameters<typeof buildTextSendCreateRequest>[0] & { hideEmail: true });

    expect(JSON.stringify(result.request)).not.toContain("One time secret");
    expect(JSON.stringify(result.request)).not.toContain("launch code");
    expect(result.request).toMatchObject({
      type: 0,
      expirationDate: null,
      deletionDate: "2030-07-17T00:00:00.000Z",
      maxAccessCount: 3,
      disabled: false,
      hideEmail: true,
      authType: 2,
      password: null,
      emails: null,
      file: null,
      text: {
        hidden: true,
      },
    });
    expect(result.urlB64Key).toBe(bytesToBase64(sendSeed));

    const decryptedSeed = await decryptEncStringToBytes(result.request.key, userKey);
    const sendKeyB64 = bytesToBase64(await deriveSendKey(decryptedSeed));
    await expect(decryptEncStringToUtf8(result.request.name, sendKeyB64)).resolves.toBe(
      "One time secret",
    );
    await expect(decryptEncStringToUtf8(result.request.text.text, sendKeyB64)).resolves.toBe(
      "launch code",
    );
    await expect(decryptEncStringToUtf8(result.request.notes, sendKeyB64)).resolves.toBe(
      "private note",
    );
  });

  it("keeps every Text Send request on the null File payload boundary", async () => {
    const result = await buildTextSendCreateRequest({
      userKeyB64: bytesToBase64(sequentialBytes(64, 1)),
      name: "Text only",
      text: "synthetic text",
      notes: "",
      deletionDate: "2030-07-17T00:00:00.000Z",
      seedBytes: sequentialBytes(16, 200),
      randomBytes: (length) => sequentialBytes(length, 100),
    });

    expect(result.request.file).toBeNull();
    expect(Object.keys(result.request)).not.toContain("fileName");
  });

  it("hashes Send passwords as an official PBKDF2 proof using the Send seed", async () => {
    expect(SEND_KDF_ITERATIONS).toBe(100_000);
    const userKey = sequentialBytes(64, 1);
    const sendSeed = sequentialBytes(16, 200);
    const result = await buildTextSendCreateRequest({
      userKeyB64: bytesToBase64(userKey),
      name: "Protected secret",
      text: "launch code",
      notes: "",
      password: "view-password",
      deletionDate: "2030-07-17T00:00:00.000Z",
      seedBytes: sendSeed,
      randomBytes: (length) => sequentialBytes(length, 100),
    });

    expect(result.request.authType).toBe(1);
    expect(result.request.password).toBe(
      await pbkdf2B64("view-password", sendSeed, SEND_KDF_ITERATIONS),
    );
    expect(JSON.stringify(result.request)).not.toContain("view-password");
  });

  it("retains no numeric Text Send password KDF iteration literal", () => {
    const source = readFileSync(
      "apps/menubar-tauri/src/app/send/send-request.service.ts",
      "utf8",
    );

    expect(source).toContain("iterations: SEND_KDF_ITERATIONS");
    expect(source).not.toMatch(/iterations:\s*100_?000\b/);
  });

  it("builds edit requests by reusing the existing Send URL key", async () => {
    const userKey = sequentialBytes(64, 1);
    const sendSeed = sequentialBytes(16, 220);
    const result = await buildTextSendUpdateRequest({
      userKeyB64: bytesToBase64(userKey),
      urlB64Key: bytesToBase64(sendSeed),
      name: "Updated secret",
      text: "new value",
      notes: "updated note",
      deletionDate: "2030-07-18T00:00:00.000Z",
      randomBytes: (length) => sequentialBytes(length, 120),
    });

    expect(result.urlB64Key).toBe(bytesToBase64(sendSeed));
    const decryptedSeed = await decryptEncStringToBytes(result.request.key, userKey);
    expect(bytesToBase64(decryptedSeed)).toBe(bytesToBase64(sendSeed));
    const sendKeyB64 = bytesToBase64(await deriveSendKey(decryptedSeed));
    await expect(decryptEncStringToUtf8(result.request.name, sendKeyB64)).resolves.toBe(
      "Updated secret",
    );
    await expect(decryptEncStringToUtf8(result.request.text.text, sendKeyB64)).resolves.toBe(
      "new value",
    );
  });

  it("allows only the exact existing past deletion timestamp on update", async () => {
    const input = {
      userKeyB64: bytesToBase64(sequentialBytes(64, 1)),
      urlB64Key: bytesToBase64(sequentialBytes(16, 220)),
      name: "Updated secret",
      text: "new value",
      notes: "",
      existingDeletionDate: "2000-01-01T08:00:00+08:00",
      deletionDate: "2000-01-01T08:00:00+08:00",
      randomBytes: (length: number) => sequentialBytes(length, 120),
    };

    await expect(buildTextSendUpdateRequest(input)).resolves.toMatchObject({
      request: { deletionDate: input.existingDeletionDate },
    });
    await expect(buildTextSendUpdateRequest({
      ...input,
      deletionDate: "2000-01-02T00:00:00.000Z",
    })).rejects.toThrow("Invalid Text Send deletion date");
  });

  it("preserves existing Send password protection on edit without resending plaintext", async () => {
    const userKey = sequentialBytes(64, 1);
    const sendSeed = sequentialBytes(16, 230);
    const result = await buildTextSendUpdateRequest({
      userKeyB64: bytesToBase64(userKey),
      urlB64Key: bytesToBase64(sendSeed),
      name: "Protected update",
      text: "new value",
      notes: "",
      deletionDate: "2030-07-18T00:00:00.000Z",
      preservePassword: true,
      randomBytes: (length) => sequentialBytes(length, 130),
    } as Parameters<typeof buildTextSendUpdateRequest>[0] & { preservePassword: true });

    expect(result.request.authType).toBe(1);
    expect(result.request.password).toBeNull();
    expect(JSON.stringify(result.request)).not.toContain("view-password");
  });

  it("removes existing password protection when the explicit authorization is none", async () => {
    const result = await buildTextSendUpdateRequest({
      userKeyB64: bytesToBase64(sequentialBytes(64, 1)),
      urlB64Key: bytesToBase64(sequentialBytes(16, 230)),
      name: "Public update",
      text: "new value",
      notes: "",
      authType: "none",
      password: "must-not-be-sent",
      deletionDate: "2030-07-18T00:00:00.000Z",
      preservePassword: true,
      randomBytes: (length) => sequentialBytes(length, 130),
    } as Parameters<typeof buildTextSendUpdateRequest>[0] & {
      authType: "none";
      preservePassword: true;
    });

    expect(result.request.authType).toBe(2);
    expect(result.request.password).toBeNull();
    expect(JSON.stringify(result.request)).not.toContain("must-not-be-sent");
  });
});

async function deriveSendKey(seed: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", seed, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("bitwarden-send"),
      info: new TextEncoder().encode("send"),
    },
    key,
    64 * 8,
  );

  return new Uint8Array(bits);
}

function sequentialBytes(length: number, start: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) % 256);
}

async function pbkdf2B64(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<string> {
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
      salt,
      iterations,
    },
    key,
    256,
  );

  return bytesToBase64(new Uint8Array(bits));
}
