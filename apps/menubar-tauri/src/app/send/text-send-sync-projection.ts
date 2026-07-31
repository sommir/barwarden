import {
  base64ToBytes,
  bytesToBase64,
  decryptEncStringToBytes,
  decryptEncStringToUtf8,
  deriveHkdfSha256Key,
  isSerializedEncString,
} from "../../auth/bitwarden-crypto";
import type { SendItem } from "./send-item.model";

export async function textSendFromSyncResponse(
  response: unknown,
  userKeyB64: string | undefined,
  sendId: string,
): Promise<SendItem | undefined> {
  const source = arrayProperty(response, "Sends").find((send) =>
    isRecord(send) && stringProperty(send, "Id") === sendId && numberProperty(send, "Type") === 0,
  );
  if (!isRecord(source)) return undefined;

  const id = stringProperty(source, "Id");
  const accessId = stringProperty(source, "AccessId");
  if (!id || !accessId) return undefined;

  const sendKey = await sendDecryptionMaterial(source, userKeyB64);
  if (!sendKey && sendHasEncryptedStrings(source)) return undefined;
  const name = await decryptedStringProperty(source, "Name", sendKey?.keyB64);
  if (!name) return undefined;
  const textRecord = recordProperty(source, "Text");
  const text = textRecord
    ? await decryptedStringProperty(textRecord, "Text", sendKey?.keyB64)
    : "";
  const notes = await decryptedStringProperty(source, "Notes", sendKey?.keyB64);
  const maxAccessCount = optionalNumberProperty(source, "MaxAccessCount");
  const hasPassword = numberProperty(source, "AuthType") === 1 || !!stringProperty(source, "Password");

  return {
    id,
    accessId,
    ...(sendKey ? { urlB64Key: sendKey.urlB64Key } : {}),
    type: "text",
    name,
    ...(text ? { text } : {}),
    notes,
    ...(textRecord && booleanProperty(textRecord, "Hidden") ? { hidden: true } : {}),
    ...(booleanProperty(source, "HideEmail") ? { hideEmail: true } : {}),
    ...(hasPassword ? { hasPassword: true } : {}),
    ...(maxAccessCount == null ? {} : { maxAccessCount }),
    accessCount: numberProperty(source, "AccessCount"),
    revisionDate: stringProperty(source, "RevisionDate"),
    deletionDate: stringProperty(source, "DeletionDate"),
    disabled: booleanProperty(source, "Disabled"),
  };
}

async function sendDecryptionMaterial(
  send: Record<string, unknown>,
  userKeyB64: string | undefined,
): Promise<{ readonly keyB64: string; readonly urlB64Key: string } | undefined> {
  const encryptedKey = stringProperty(send, "Key");
  if (!encryptedKey || !userKeyB64) return undefined;
  const seed = await decryptEncStringToBytes(encryptedKey, base64ToBytes(userKeyB64));
  return {
    keyB64: bytesToBase64(await deriveHkdfSha256Key(seed, "bitwarden-send", "send", 64)),
    urlB64Key: bytesToBase64(seed),
  };
}

async function decryptedStringProperty(
  value: Record<string, unknown>,
  name: string,
  keyB64: string | undefined,
): Promise<string> {
  const raw = stringProperty(value, name);
  if (!raw || !isSerializedEncString(raw)) return raw;
  if (!keyB64) throw new Error(`Missing Bitwarden decryption key for ${name}`);
  return decryptEncStringToUtf8(raw, keyB64);
}

function sendHasEncryptedStrings(send: Record<string, unknown>): boolean {
  const text = recordProperty(send, "Text");
  return [
    stringProperty(send, "Name"),
    stringProperty(send, "Notes"),
    text ? stringProperty(text, "Text") : "",
  ].some(isSerializedEncString);
}

function arrayProperty(value: unknown, name: string): readonly unknown[] {
  if (!isRecord(value)) return [];
  const result = property(value, name);
  return Array.isArray(result) ? result : [];
}

function recordProperty(value: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const result = property(value, name);
  return isRecord(result) ? result : null;
}

function stringProperty(value: Record<string, unknown>, name: string): string {
  const result = property(value, name);
  return typeof result === "string" ? result : "";
}

function numberProperty(value: Record<string, unknown>, name: string): number {
  const result = property(value, name);
  return typeof result === "number" ? result : 0;
}

function optionalNumberProperty(value: Record<string, unknown>, name: string): number | undefined {
  const result = property(value, name);
  return typeof result === "number" ? result : undefined;
}

function booleanProperty(value: Record<string, unknown>, name: string): boolean {
  return property(value, name) === true;
}

function property(value: Record<string, unknown>, name: string): unknown {
  const lowerFirst = `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
  return value[name] ?? value[lowerFirst] ?? value[name.toLowerCase()] ?? value[name.toUpperCase()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
