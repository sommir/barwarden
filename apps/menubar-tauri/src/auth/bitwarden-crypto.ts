export interface ParsedEncString {
  readonly type: number;
  readonly ivB64?: string;
  readonly dataB64: string;
  readonly macB64?: string;
}

export function isSerializedEncString(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    parseEncString(value);
    return true;
  } catch {
    return false;
  }
}

export function parseEncString(value: string): ParsedEncString {
  const header = value.match(/^(\d+)\.(.*)$/);
  const type = header ? Number(header[1]) : 0;
  const body = header ? header[2] : value;
  const pieces = body.split("|");

  if (type === 0 && pieces.length === 2) {
    return { type, ivB64: pieces[0], dataB64: pieces[1] };
  }

  if (type === 2 && pieces.length === 3) {
    return { type, ivB64: pieces[0], dataB64: pieces[1], macB64: pieces[2] };
  }

  throw new Error(`Unsupported Bitwarden encrypted string type ${type}`);
}

export async function decryptEncStringToUtf8(
  encryptedValue: string,
  keyB64: string,
): Promise<string> {
  const decrypted = await decryptEncStringToBytes(encryptedValue, base64ToBytes(keyB64));
  return new TextDecoder().decode(decrypted);
}

export async function decryptEncStringToBytes(
  encryptedValue: string,
  key: Uint8Array,
): Promise<Uint8Array> {
  const encString = parseEncString(encryptedValue);
  if (!encString.ivB64) {
    throw new Error("Missing Bitwarden encrypted string IV");
  }

  const iv = base64ToBytes(encString.ivB64);
  const data = base64ToBytes(encString.dataB64);

  if (encString.type === 2) {
    if (!encString.macB64) {
      throw new Error("Missing Bitwarden encrypted string MAC");
    }

    const macKey = key.slice(32, 64);
    const expectedMac = await hmacSha256(macKey, concatBytes(iv, data));
    if (!constantTimeEqual(expectedMac, base64ToBytes(encString.macB64))) {
      throw new Error("Bitwarden encrypted string MAC validation failed");
    }
  }

  const encryptionKey = key.slice(0, 32);
  const cryptoKey = await crypto.subtle.importKey("raw", ownedBytes(encryptionKey), "AES-CBC", false, [
    "decrypt",
  ]);
  const plainBuffer = await crypto.subtle.decrypt({ name: "AES-CBC", iv: ownedBytes(iv) }, cryptoKey, ownedBytes(data));

  return new Uint8Array(plainBuffer);
}

export async function encryptUtf8ToEncString(
  value: string,
  keyB64: string,
  randomBytes: (length: number) => Uint8Array = secureRandomBytes,
): Promise<string> {
  return encryptBytesToEncString(utf8Bytes(value), base64ToBytes(keyB64), randomBytes);
}

export async function encryptBytesToEncString(
  plainValue: Uint8Array,
  key: Uint8Array,
  randomBytes: (length: number) => Uint8Array = secureRandomBytes,
): Promise<string> {
  if (key.byteLength !== 64) {
    throw new Error("Bitwarden encrypted string key must be 64 bytes");
  }

  const iv = randomBytes(16);
  if (iv.byteLength !== 16) {
    throw new Error("Bitwarden encrypted string IV must be 16 bytes");
  }

  const cryptoKey = await crypto.subtle.importKey("raw", ownedBytes(key.slice(0, 32)), "AES-CBC", false, [
    "encrypt",
  ]);
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv: ownedBytes(iv) }, cryptoKey, ownedBytes(plainValue)),
  );
  const mac = await hmacSha256(key.slice(32, 64), concatBytes(iv, data));

  return `2.${bytesToBase64(iv)}|${bytesToBase64(data)}|${bytesToBase64(mac)}`;
}

export async function deriveHkdfSha256Key(
  material: Uint8Array,
  salt: string,
  info: string,
  byteLength: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ownedBytes(material), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: ownedBytes(utf8Bytes(salt)),
      info: ownedBytes(utf8Bytes(info)),
    },
    key,
    byteLength * 8,
  );

  return new Uint8Array(bits);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, outputByteSize: number): Promise<Uint8Array<ArrayBuffer>> {
  const hashLength = 32;
  if (outputByteSize > 255 * hashLength) {
    throw new Error("HKDF output size is too large");
  }

  const n = Math.ceil(outputByteSize / hashLength);
  let previous = new Uint8Array(0);
  const output = new Uint8Array(n * hashLength);
  let offset = 0;

  for (let i = 1; i <= n; i += 1) {
    previous = await hmacSha256(prk, concatBytes(previous, info, new Uint8Array([i])));
    output.set(previous, offset);
    offset += previous.length;
  }

  return output.slice(0, outputByteSize);
}

async function hmacSha256(key: Uint8Array, value: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    ownedBytes(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, ownedBytes(value));

  return new Uint8Array(signature);
}

function ownedBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < left.byteLength; i += 1) {
    mismatch |= left[i] ^ right[i];
  }

  return mismatch === 0;
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

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function secureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}
