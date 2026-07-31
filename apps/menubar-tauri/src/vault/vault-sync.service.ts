import type { AuthSession } from "../auth/auth-session-store";
import {
  BitwardenApiError,
  HttpTransportError,
} from "../bitwarden-api/bitwarden-api";
import {
  base64ToBytes,
  bytesToBase64,
  deriveHkdfSha256Key,
  decryptEncStringToBytes,
  decryptEncStringToUtf8,
  isSerializedEncString,
} from "../auth/bitwarden-crypto";
import type { SendItem, SendItemType } from "../app/send/send-item.model";
import { textSendPolicyFromSync, type TextSendPolicy } from "../app/send/text-send-policy";
import type {
  VaultAttachment,
  VaultCollection,
  VaultField,
  VaultFolder,
  VaultItem,
  VaultOrganization,
  VaultPasswordHistoryEntry,
  VaultItemType,
  VaultUri,
} from "../app/vault/vault-item.model";
import { retainOpaqueCipherPayload } from "../app/vault/opaque-cipher-payload";
import { BitwardenSdkCore } from "../sdk/bitwarden-sdk-core.service";

export interface VaultSyncApi {
  getSync(accessToken: string): Promise<unknown>;
}

export interface VaultSyncResult {
  readonly items: readonly VaultItem[];
  readonly archivedItems: readonly VaultItem[];
  readonly deletedItems: readonly VaultItem[];
  readonly folders: readonly VaultFolder[];
  readonly organizations: readonly VaultOrganization[];
  readonly collections: readonly VaultCollection[];
  readonly sends: readonly SendItem[];
  readonly sendPolicy: TextSendPolicy;
  readonly cipherCount: number;
  readonly encryptedCipherCount: number;
  readonly folderCount: number;
  readonly sendCount: number;
}

const cipherTypeByNumber = new Map<number, VaultItemType>([
  [1, "login"],
  [2, "secure-note"],
  [3, "card"],
  [4, "identity"],
]);

const sendTypeByNumber = new Map<number, SendItemType>([
  [0, "text"],
]);

export class VaultSyncService {
  constructor(
    private readonly api: VaultSyncApi,
    private readonly sdk: BitwardenSdkCore = new BitwardenSdkCore(),
  ) {}

  async sync(session: AuthSession): Promise<VaultSyncResult> {
    let response: unknown;
    try {
      response = await this.api.getSync(session.token.accessToken);
    } catch (error) {
      if (
        error instanceof BitwardenApiError ||
        error instanceof HttpTransportError
      ) {
        throw error;
      }
      throw new VaultSyncError();
    }
    const ciphers = arrayProperty(response, "Ciphers");
    const folders = arrayProperty(response, "Folders");
    const sends = arrayProperty(response, "Sends");
    const organizationContext = await buildOrganizationContext(
      response,
      session.crypto?.userKeyB64,
      this.sdk,
    );
    const collections = await buildCollections(response, organizationContext.keyById);
    const mappedFolders = (
      await Promise.all(
        folders.map((folder) => folderToVaultFolder(folder, session.crypto?.userKeyB64)),
      )
    ).flat();
    const folderNameById = new Map(mappedFolders.map((folder) => [folder.id, folder.name]));
    const mappedCipherItems = await Promise.all(
      ciphers.map((cipher) =>
        cipherToVaultItem(
          cipher,
          session.crypto?.userKeyB64,
          folderNameById,
          organizationContext,
        ),
      ),
    );
    const mappedSends = await Promise.all(
      sends.map((send) => sendToSendItem(send, session.crypto?.userKeyB64)),
    );

    return {
      items: flatItemsForStatus(ciphers, mappedCipherItems, "active"),
      archivedItems: flatItemsForStatus(ciphers, mappedCipherItems, "archived"),
      deletedItems: flatItemsForStatus(ciphers, mappedCipherItems, "deleted"),
      folders: mappedFolders,
      organizations: organizationContext.organizations,
      collections,
      sends: mappedSends.flat(),
      sendPolicy: textSendPolicyFromSync(response),
      cipherCount: ciphers.length,
      encryptedCipherCount: ciphers.filter(cipherHasEncryptedStrings).length,
      folderCount: folders.length,
      sendCount: sends.length,
    };
  }
}

export class VaultSyncError extends Error {
  override readonly name = "VaultSyncError";

  constructor() {
    super("Unable to synchronize vault");
  }
}

interface OrganizationSyncContext {
  readonly organizations: readonly VaultOrganization[];
  readonly keyById: ReadonlyMap<string, string>;
  readonly nameById: ReadonlyMap<string, string>;
}

async function buildOrganizationContext(
  response: unknown,
  userKeyB64: string | undefined,
  sdk: BitwardenSdkCore,
): Promise<OrganizationSyncContext> {
  const empty: OrganizationSyncContext = {
    organizations: [],
    keyById: new Map(),
    nameById: new Map(),
  };
  if (!isRecord(response) || !userKeyB64) {
    return empty;
  }

  const profile = recordProperty(response, "Profile");
  const encryptedPrivateKey = profile ? stringProperty(profile, "PrivateKey") : "";
  const organizationResponses = profile ? arrayProperty(profile, "Organizations") : [];
  if (!encryptedPrivateKey || organizationResponses.length === 0) {
    return empty;
  }

  let privateKey: Uint8Array;
  try {
    privateKey = await sdk.decryptBytes(encryptedPrivateKey, base64ToBytes(userKeyB64));
  } catch {
    return empty;
  }

  const organizations: VaultOrganization[] = [];
  const keyById = new Map<string, string>();
  const nameById = new Map<string, string>();
  for (const value of organizationResponses) {
    if (!isRecord(value)) {
      continue;
    }

    const id = stringProperty(value, "Id");
    const name = stringProperty(value, "Name");
    const encryptedKey = stringProperty(value, "Key");
    if (!id || !name || !encryptedKey) {
      continue;
    }

    try {
      const key = await sdk.decapsulateKeyUnsigned(encryptedKey, privateKey);
      if (key.byteLength !== 64) {
        continue;
      }
      organizations.push({
        id,
        name,
        enabled: booleanProperty(value, "Enabled"),
        status: numberProperty(value, "Status"),
      });
      keyById.set(id, bytesToBase64(key));
      nameById.set(id, name);
    } catch {
      // An unavailable organization must not prevent the personal vault from syncing.
    }
  }

  return { organizations, keyById, nameById };
}

async function buildCollections(
  response: unknown,
  organizationKeyById: ReadonlyMap<string, string>,
): Promise<readonly VaultCollection[]> {
  const collections: VaultCollection[] = [];
  for (const value of arrayProperty(response, "Collections")) {
    if (!isRecord(value)) {
      continue;
    }

    const id = stringProperty(value, "Id");
    const organizationId = stringProperty(value, "OrganizationId");
    const organizationKey = organizationKeyById.get(organizationId);
    if (!id || !organizationId || !organizationKey) {
      continue;
    }

    try {
      const name = await decryptedStringProperty(value, "Name", organizationKey);
      if (!name) {
        continue;
      }
      collections.push({
        id,
        organizationId,
        name,
        readOnly: booleanProperty(value, "ReadOnly"),
        manage: booleanProperty(value, "Manage"),
      });
    } catch {
      // Keep encrypted collection metadata out of the rendered vault.
    }
  }
  return collections;
}

async function sendToSendItem(
  send: unknown,
  userKeyB64: string | undefined,
): Promise<SendItem[]> {
  if (!isRecord(send)) {
    return [];
  }

  const type = sendTypeByNumber.get(numberProperty(send, "Type"));
  if (type !== "text") {
    return [];
  }
  const id = stringProperty(send, "Id");
  const accessId = stringProperty(send, "AccessId");
  if (!id || !accessId) {
    return [];
  }

  try {
    const sendKey = await sendDecryptionMaterial(send, userKeyB64);
    if (!sendKey?.keyB64 && sendHasEncryptedStrings(send)) {
      return [];
    }

    const name = await decryptedStringProperty(send, "Name", sendKey?.keyB64);
    if (!name) {
      return [];
    }

    const notes = await decryptedStringProperty(send, "Notes", sendKey?.keyB64);
    const textRecord = recordProperty(send, "Text");
    const text = type === "text" && textRecord
      ? await decryptedStringProperty(textRecord, "Text", sendKey?.keyB64)
      : "";
    const hidden = textRecord ? booleanProperty(textRecord, "Hidden") : false;
    const hideEmail = booleanProperty(send, "HideEmail");
    const maxAccessCount = optionalNumberProperty(send, "MaxAccessCount");
    const hasPassword = numberProperty(send, "AuthType") === 1 || !!stringProperty(send, "Password");
    return [
      {
        id,
        accessId,
        ...(sendKey?.urlB64Key ? { urlB64Key: sendKey.urlB64Key } : {}),
        type,
        name,
        notes,
        ...(text ? { text } : {}),
        ...(hidden ? { hidden: true } : {}),
        ...(hideEmail ? { hideEmail: true } : {}),
        ...(hasPassword ? { hasPassword: true } : {}),
        ...(maxAccessCount == null ? {} : { maxAccessCount }),
        accessCount: numberProperty(send, "AccessCount"),
        revisionDate: stringProperty(send, "RevisionDate"),
        deletionDate: stringProperty(send, "DeletionDate"),
        disabled: booleanProperty(send, "Disabled"),
      },
    ];
  } catch {
    return [];
  }
}

async function cipherToVaultItem(
  cipher: unknown,
  userKeyB64: string | undefined,
  folderNameById: ReadonlyMap<string, string>,
  organizationContext: OrganizationSyncContext,
): Promise<VaultItem[]> {
  if (!isRecord(cipher)) {
    return [];
  }

  const type = cipherTypeByNumber.get(numberProperty(cipher, "Type"));
  if (!type) {
    return [];
  }

  const id = stringProperty(cipher, "Id");
  if (!id) {
    return [];
  }

  const organizationId = stringProperty(cipher, "OrganizationId");
  if (organizationId && !organizationContext.keyById.has(organizationId)) {
    return [];
  }

  try {
    const cipherKeyB64 = await cipherDecryptionKeyB64(
      cipher,
      userKeyB64,
      organizationContext.keyById,
    );
    if (!cipherKeyB64 && cipherHasEncryptedStrings(cipher)) {
      return [];
    }

    const name = await decryptedStringProperty(cipher, "Name", cipherKeyB64);
    if (!name) {
      return [];
    }

    const folderId = stringProperty(cipher, "FolderId");
    const encryptedKey = stringProperty(cipher, "Key");
    const collectionIds = stringArrayProperty(cipher, "CollectionIds");
    const folderName = folderId ? (folderNameById.get(folderId) ?? "") : "";
    const organizationName = organizationId
      ? (organizationContext.nameById.get(organizationId) ?? "")
      : await decryptedStringProperty(cipher, "OrganizationName", cipherKeyB64);
    const createdDate = stringProperty(cipher, "CreationDate");
    const revisionDate = stringProperty(cipher, "RevisionDate");
    const archivedDate = stringProperty(cipher, "ArchivedDate");
    const deletedDate = stringProperty(cipher, "DeletedDate");
    const notes = await decryptedStringProperty(cipher, "Notes", cipherKeyB64);
    const favorite = booleanProperty(cipher, "Favorite");
    const attachments = await buildAttachments(arrayProperty(cipher, "Attachments"), cipherKeyB64);
    const attachmentCount = attachments.length || attachmentCountProperty(cipher);

    if (type === "login") {
      const login = recordProperty(cipher, "Login");
      if (!login) {
        return [];
      }

      const username = await decryptedStringProperty(login, "Username", cipherKeyB64);
      const password = await decryptedStringProperty(login, "Password", cipherKeyB64);
      const passwordRevisionDate = stringProperty(login, "PasswordRevisionDate");
      const otp = await decryptedStringProperty(login, "Totp", cipherKeyB64);
      const uris = await buildUris(id, arrayProperty(login, "Uris"), cipherKeyB64);
      const passwordHistory = await buildPasswordHistory(
        arrayProperty(cipher, "PasswordHistory").length > 0
          ? arrayProperty(cipher, "PasswordHistory")
          : arrayProperty(login, "PasswordHistory"),
        cipherKeyB64,
      );
      const uri = uris[0]?.uri ?? "";
      const fields = await buildFields(
        username,
        password,
        otp,
        arrayProperty(cipher, "Fields"),
        cipherKeyB64,
      );

      return [
        {
          id,
          opaqueServerPayload: retainOpaqueCipherPayload(cipher),
          ...(encryptedKey ? { encryptedKey } : {}),
          ...(organizationId ? { organizationId, collectionIds } : {}),
          type,
          name,
          subtitle: username || uri || "Login",
          favorite,
          ...(numberProperty(cipher, "Reprompt") !== 0 ? { reprompt: true } : {}),
          folderId,
          folderName,
          organizationName,
          attachmentCount,
          ...(attachments.length > 0 ? { attachments } : {}),
          uris,
          fields,
          createdDate,
          revisionDate,
          ...(archivedDate ? { archivedDate } : {}),
          ...(deletedDate ? { deletedDate } : {}),
          ...(passwordRevisionDate ? { passwordRevisionDate } : {}),
          ...(passwordHistory.length > 0 ? { passwordHistory } : {}),
          notes,
          canLaunch: uri.length > 0,
          canFill: true,
          uri,
        },
      ];
    }

    const typedFields = await buildNonLoginFields(cipher, type, cipherKeyB64, notes);
    const customFields = await buildFields(
      "",
      "",
      "",
      arrayProperty(cipher, "Fields"),
      cipherKeyB64,
    );
    const fields = [...typedFields, ...customFields];
    const subtitle = nonLoginSubtitle(type, fields, notes);
    const card = type === "card"
      ? await buildCardData(recordProperty(cipher, "Card"), cipherKeyB64)
      : undefined;
    const identity = type === "identity"
      ? await buildIdentityData(recordProperty(cipher, "Identity"), cipherKeyB64)
      : undefined;
    const secureNote = type === "secure-note"
      ? buildSecureNoteData(recordProperty(cipher, "SecureNote"))
      : undefined;
    return [
      {
        id,
        opaqueServerPayload: retainOpaqueCipherPayload(cipher),
        ...(encryptedKey ? { encryptedKey } : {}),
        ...(organizationId ? { organizationId, collectionIds } : {}),
        type,
        name,
        subtitle,
        favorite,
        ...(numberProperty(cipher, "Reprompt") !== 0 ? { reprompt: true } : {}),
        ...(card ? { card } : {}),
        ...(identity ? { identity } : {}),
        ...(secureNote ? { secureNote } : {}),
        folderId,
        folderName,
        organizationName,
        attachmentCount,
        ...(attachments.length > 0 ? { attachments } : {}),
        uris: [],
        fields,
        createdDate,
        revisionDate,
        ...(archivedDate ? { archivedDate } : {}),
        ...(deletedDate ? { deletedDate } : {}),
        notes,
        canLaunch: false,
        canFill: false,
        uri: "",
      },
    ];
  } catch {
    return [];
  }
}

async function buildCardData(
  card: Record<string, unknown> | null,
  keyB64: string | undefined,
): Promise<VaultItem["card"]> {
  if (!card) {
    return undefined;
  }

  return {
    cardholderName: await decryptedStringProperty(card, "CardholderName", keyB64),
    brand: await decryptedStringProperty(card, "Brand", keyB64),
    number: await decryptedStringProperty(card, "Number", keyB64),
    expMonth: await decryptedStringProperty(card, "ExpMonth", keyB64),
    expYear: await decryptedStringProperty(card, "ExpYear", keyB64),
    code: await decryptedStringProperty(card, "Code", keyB64),
  };
}

async function buildIdentityData(
  identity: Record<string, unknown> | null,
  keyB64: string | undefined,
): Promise<VaultItem["identity"]> {
  if (!identity) {
    return undefined;
  }

  return {
    title: await decryptedStringProperty(identity, "Title", keyB64),
    firstName: await decryptedStringProperty(identity, "FirstName", keyB64),
    middleName: await decryptedStringProperty(identity, "MiddleName", keyB64),
    lastName: await decryptedStringProperty(identity, "LastName", keyB64),
    username: await decryptedStringProperty(identity, "Username", keyB64),
    company: await decryptedStringProperty(identity, "Company", keyB64),
    ssn: await decryptedStringProperty(identity, "Ssn", keyB64),
    passportNumber: await decryptedStringProperty(identity, "PassportNumber", keyB64),
    licenseNumber: await decryptedStringProperty(identity, "LicenseNumber", keyB64),
    email: await decryptedStringProperty(identity, "Email", keyB64),
    phone: await decryptedStringProperty(identity, "Phone", keyB64),
    address1: await decryptedStringProperty(identity, "Address1", keyB64),
    address2: await decryptedStringProperty(identity, "Address2", keyB64),
    address3: await decryptedStringProperty(identity, "Address3", keyB64),
    city: await decryptedStringProperty(identity, "City", keyB64),
    state: await decryptedStringProperty(identity, "State", keyB64),
    postalCode: await decryptedStringProperty(identity, "PostalCode", keyB64),
    country: await decryptedStringProperty(identity, "Country", keyB64),
  };
}

function buildSecureNoteData(
  secureNote: Record<string, unknown> | null,
): VaultItem["secureNote"] {
  return secureNote ? { type: numberProperty(secureNote, "Type") } : undefined;
}

function flatItemsForStatus(
  ciphers: readonly unknown[],
  mappedItems: readonly VaultItem[][],
  status: "active" | "archived" | "deleted",
): readonly VaultItem[] {
  return mappedItems.flatMap((items, index) =>
    cipherListStatus(ciphers[index]) === status ? items : [],
  );
}

function cipherListStatus(cipher: unknown): "active" | "archived" | "deleted" {
  if (!isRecord(cipher)) {
    return "active";
  }

  if (property(cipher, "DeletedDate")) {
    return "deleted";
  }

  if (property(cipher, "ArchivedDate")) {
    return "archived";
  }

  return "active";
}

async function folderToVaultFolder(
  folder: unknown,
  userKeyB64: string | undefined,
): Promise<VaultFolder[]> {
  if (!isRecord(folder)) {
    return [];
  }

  const id = stringProperty(folder, "Id");
  try {
    const name = await decryptedStringProperty(folder, "Name", userKeyB64);
    return id && name ? [{ id, name }] : [];
  } catch {
    return [];
  }
}

async function cipherDecryptionKeyB64(
  cipher: Record<string, unknown>,
  userKeyB64: string | undefined,
  organizationKeyById: ReadonlyMap<string, string>,
): Promise<string | undefined> {
  const organizationId = stringProperty(cipher, "OrganizationId");
  const parentKeyB64 = organizationId
    ? organizationKeyById.get(organizationId)
    : userKeyB64;
  const key = stringProperty(cipher, "Key");
  if (!key) {
    return parentKeyB64;
  }

  if (!parentKeyB64) {
    return undefined;
  }

  return bytesToBase64(await decryptEncStringToBytes(key, base64ToBytes(parentKeyB64)));
}

async function sendDecryptionMaterial(
  send: Record<string, unknown>,
  userKeyB64: string | undefined,
): Promise<{ readonly keyB64: string; readonly urlB64Key: string } | undefined> {
  const key = stringProperty(send, "Key");
  if (!key) {
    return undefined;
  }

  if (!userKeyB64) {
    return undefined;
  }

  const sendSeed = await decryptEncStringToBytes(key, base64ToBytes(userKeyB64));
  return {
    keyB64: bytesToBase64(await deriveHkdfSha256Key(sendSeed, "bitwarden-send", "send", 64)),
    urlB64Key: bytesToBase64(sendSeed),
  };
}

async function buildFields(
  username: string,
  password: string,
  otp: string,
  customFields: readonly unknown[],
  keyB64: string | undefined,
): Promise<readonly VaultField[]> {
  const fields: VaultField[] = [];
  if (username) {
    fields.push({ id: "username", label: "Username", value: username });
  }
  if (password) {
    fields.push({
      id: "password",
      label: "Password",
      value: password,
      concealed: true,
      type: "hidden",
    });
  }
  if (otp) {
    fields.push({ id: "otp", label: "OTP", value: otp, type: "totp" });
  }

  for (const [index, customField] of customFields.entries()) {
    if (!isRecord(customField)) {
      continue;
    }
    const label = await decryptedStringProperty(customField, "Name", keyB64);
    const value = await decryptedStringProperty(customField, "Value", keyB64);
    const type = customFieldType(customField);
    fields.push({
      id: `custom:${index}`,
      label,
      value: type === "boolean" ? canonicalBooleanFieldValue(value) : value,
      type,
      ...(type === "hidden" ? { concealed: true } : {}),
      ...(type === "linked" ? { linkedId: numberProperty(customField, "LinkedId") } : {}),
    });
  }

  return fields;
}

function canonicalBooleanFieldValue(value: string): string {
  return value.trim().toLowerCase() === "true" ? "true" : "false";
}

function customFieldType(value: unknown): "text" | "hidden" | "boolean" | "linked" {
  if (!isRecord(value)) {
    return "text";
  }

  switch (numberProperty(value, "Type")) {
    case 1:
      return "hidden";
    case 2:
      return "boolean";
    case 3:
      return "linked";
    default:
      return "text";
  }
}

async function buildUris(
  itemId: string,
  values: readonly unknown[],
  keyB64: string | undefined,
): Promise<readonly VaultUri[]> {
  const uris: VaultUri[] = [];
  for (const [index, value] of values.entries()) {
    if (!isRecord(value)) {
      continue;
    }

    const uri = await decryptedStringProperty(value, "Uri", keyB64);
    if (!uri) {
      continue;
    }

    uris.push({
      id: `${itemId}-uri-${index}`,
      uri,
      matchType: uriMatchType(value),
    });
  }

  return uris;
}

async function buildPasswordHistory(
  history: readonly unknown[],
  keyB64: string | undefined,
): Promise<readonly VaultPasswordHistoryEntry[]> {
  const entries = await Promise.all(
    history.map(async (entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const password = await decryptedStringProperty(entry, "Password", keyB64);
      if (!password) {
        return null;
      }

      return {
        password,
        lastUsedDate: stringProperty(entry, "LastUsedDate"),
      };
    }),
  );

  return entries.filter(isPasswordHistoryEntry);
}

async function buildAttachments(
  attachments: readonly unknown[],
  keyB64: string | undefined,
): Promise<readonly VaultAttachment[]> {
  const entries = await Promise.all(
    attachments.map(async (attachment) => {
      if (!isRecord(attachment)) {
        return null;
      }

      const id = stringProperty(attachment, "Id");
      const fileName = await decryptedStringProperty(attachment, "FileName", keyB64);
      if (!id || !fileName) {
        return null;
      }

      return {
        id,
        fileName,
        size: stringProperty(attachment, "Size"),
        ...(stringProperty(attachment, "Key")
          ? { encryptedKey: stringProperty(attachment, "Key") }
          : {}),
      };
    }),
  );

  return entries.filter(isAttachment);
}

async function buildNonLoginFields(
  cipher: Record<string, unknown>,
  type: Exclude<VaultItemType, "login">,
  keyB64: string | undefined,
  notes: string,
): Promise<readonly VaultField[]> {
  switch (type) {
    case "card":
      return withNotes(await buildNamedFields(recordProperty(cipher, "Card"), keyB64, [
        ["Brand", "Brand", "brand"],
        ["CardholderName", "Cardholder", "cardholder-name"],
        ["Number", "Number", "number", true],
        ["ExpMonth", "Expiration month", "exp-month"],
        ["ExpYear", "Expiration year", "exp-year"],
        ["Code", "Security code", "code", true],
      ]), notes);
    case "identity":
      return withNotes(await buildIdentityFields(recordProperty(cipher, "Identity"), keyB64), notes);
    case "secure-note":
      return notes ? [{ id: "notes", label: "Notes", value: notes }] : [];
  }
}

function withNotes(fields: readonly VaultField[], notes: string): readonly VaultField[] {
  return notes ? [...fields, { id: "notes", label: "Notes", value: notes }] : fields;
}

async function buildIdentityFields(
  identity: Record<string, unknown> | null,
  keyB64: string | undefined,
): Promise<readonly VaultField[]> {
  const fields = await buildNamedFields(identity, keyB64, [
    ["Title", "Title", "title"],
    ["FirstName", "First name", "first-name"],
    ["MiddleName", "Middle name", "middle-name"],
    ["LastName", "Last name", "last-name"],
    ["Username", "Username", "username"],
    ["Company", "Company", "company"],
    ["Ssn", "Social security number", "ssn", true],
    ["PassportNumber", "Passport number", "passport-number", true],
    ["LicenseNumber", "License number", "license-number"],
    ["Email", "Email", "email"],
    ["Phone", "Phone", "phone"],
    ["Address1", "Address 1", "address-1"],
    ["Address2", "Address 2", "address-2"],
    ["Address3", "Address 3", "address-3"],
    ["City", "City", "city"],
    ["State", "State / Province", "state"],
    ["PostalCode", "Postal code", "postal-code"],
    ["Country", "Country", "country"],
  ]);
  const byId = new Map(fields.map((field) => [field.id, field.value] as const));
  const fullName = ["title", "first-name", "middle-name", "last-name"]
    .map((id) => byId.get(id))
    .filter(isNonEmptyString)
    .join(" ");
  const locality = [byId.get("city"), byId.get("state")].filter(isNonEmptyString).join(", ");
  const localityAndPostal = [locality, byId.get("postal-code")]
    .filter(isNonEmptyString)
    .join(" ");
  const address = [
    byId.get("address-1"), byId.get("address-2"), byId.get("address-3"),
    localityAndPostal, byId.get("country"),
  ].filter(isNonEmptyString).join("\n");

  return [
    ...fields.slice(0, 4),
    ...(fullName ? [{ id: "full-name", label: "Name", value: fullName }] : []),
    ...fields.slice(4),
    ...(address ? [{ id: "address", label: "Address", value: address }] : []),
  ];
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value);
}

function uriMatchType(value: Record<string, unknown>): string {
  const match = property(value, "Match");
  if (typeof match === "number") {
    return String(match);
  }

  if (typeof match === "string" && match.length > 0) {
    return match;
  }

  return "default";
}

async function buildNamedFields(
  record: Record<string, unknown> | null,
  keyB64: string | undefined,
  definitions: readonly [string, string, string, boolean?][],
): Promise<readonly VaultField[]> {
  if (!record) {
    return [];
  }

  const fields: VaultField[] = [];
  for (const [propertyName, label, id, concealed = false] of definitions) {
    const value = await decryptedStringProperty(record, propertyName, keyB64);
    if (!value) {
      continue;
    }

    fields.push({ id, label, value, ...(concealed ? { concealed: true, type: "hidden" as const } : {}) });
  }

  return fields;
}

function nonLoginSubtitle(
  type: Exclude<VaultItemType, "login">,
  fields: readonly VaultField[],
  notes: string,
): string {
  const primaryField = fields[0]?.value;
  if (primaryField) {
    return primaryField;
  }

  if (type === "secure-note") {
    return notes ? "Secure note" : "Note";
  }

  return type;
}

async function decryptedStringProperty(
  value: Record<string, unknown>,
  name: string,
  keyB64: string | undefined,
): Promise<string> {
  const rawValue = stringProperty(value, name);
  if (!rawValue || !isSerializedEncString(rawValue)) {
    return rawValue;
  }

  if (!keyB64) {
    throw new Error(`Missing Bitwarden decryption key for ${name}`);
  }

  return decryptEncStringToUtf8(rawValue, keyB64);
}

function arrayProperty(value: unknown, name: string): readonly unknown[] {
  if (!isRecord(value)) {
    return [];
  }

  const array = property(value, name);
  return Array.isArray(array) ? array : [];
}

function stringArrayProperty(value: Record<string, unknown>, name: string): readonly string[] {
  const values = property(value, name);
  return Array.isArray(values) ? values.filter((entry): entry is string => typeof entry === "string") : [];
}

function recordProperty(value: Record<string, unknown>, name: string): Record<string, unknown> | null {
  const child = property(value, name);
  return isRecord(child) ? child : null;
}

async function firstDecryptedStringProperty(
  values: readonly unknown[],
  name: string,
  keyB64: string | undefined,
): Promise<string> {
  for (const value of values) {
    if (!isRecord(value)) {
      continue;
    }

    const stringValue = await decryptedStringProperty(value, name, keyB64);
    if (stringValue) {
      return stringValue;
    }
  }

  return "";
}

function stringProperty(value: Record<string, unknown>, name: string): string {
  const stringValue = property(value, name);
  return typeof stringValue === "string" ? stringValue : "";
}

function numberProperty(value: Record<string, unknown>, name: string): number {
  const numberValue = property(value, name);
  return typeof numberValue === "number" ? numberValue : 0;
}

function optionalNumberProperty(value: Record<string, unknown>, name: string): number | undefined {
  const numberValue = property(value, name);
  return typeof numberValue === "number" ? numberValue : undefined;
}

function attachmentCountProperty(value: Record<string, unknown>): number {
  const attachmentValue = property(value, "Attachments");
  if (Array.isArray(attachmentValue)) {
    return attachmentValue.length;
  }

  return typeof attachmentValue === "number" ? attachmentValue : 0;
}

function booleanProperty(value: Record<string, unknown>, name: string): boolean {
  return property(value, name) === true;
}

function property(value: Record<string, unknown>, name: string): unknown {
  return value[name] ?? value[lowerFirst(name)] ?? value[name.toLowerCase()] ?? value[name.toUpperCase()];
}

function cipherHasEncryptedStrings(cipher: unknown): boolean {
  if (!isRecord(cipher)) {
    return false;
  }

  const login = recordProperty(cipher, "Login");
  const card = recordProperty(cipher, "Card");
  const identity = recordProperty(cipher, "Identity");
  return [
    stringProperty(cipher, "Name"),
    stringProperty(cipher, "Notes"),
    stringProperty(cipher, "Key"),
    stringProperty(cipher, "OrganizationName"),
    ...arrayProperty(cipher, "Attachments").flatMap((attachment) =>
      isRecord(attachment) ? [stringProperty(attachment, "FileName")] : [],
    ),
    login ? stringProperty(login, "Username") : "",
    login ? stringProperty(login, "Password") : "",
    login ? stringProperty(login, "Totp") : "",
    ...arrayProperty(login, "PasswordHistory").flatMap((entry) =>
      isRecord(entry) ? [stringProperty(entry, "Password")] : [],
    ),
    card ? stringProperty(card, "Brand") : "",
    card ? stringProperty(card, "CardholderName") : "",
    card ? stringProperty(card, "Number") : "",
    card ? stringProperty(card, "Code") : "",
    identity ? stringProperty(identity, "Title") : "",
    identity ? stringProperty(identity, "FirstName") : "",
    identity ? stringProperty(identity, "LastName") : "",
    identity ? stringProperty(identity, "Email") : "",
    identity ? stringProperty(identity, "Username") : "",
    ...arrayProperty(login, "Uris").flatMap((uri) =>
      isRecord(uri) ? [stringProperty(uri, "Uri")] : [],
    ),
    ...arrayProperty(cipher, "Fields").flatMap((field) =>
      isRecord(field)
        ? [stringProperty(field, "Name"), stringProperty(field, "Value")]
        : [],
    ),
  ].some(isSerializedEncString);
}

function sendHasEncryptedStrings(send: unknown): boolean {
  if (!isRecord(send)) {
    return false;
  }

  const text = recordProperty(send, "Text");
  return [
    stringProperty(send, "Name"),
    stringProperty(send, "Notes"),
    text ? stringProperty(text, "Text") : "",
  ].some(isSerializedEncString);
}

function isPasswordHistoryEntry(value: VaultPasswordHistoryEntry | null): value is VaultPasswordHistoryEntry {
  return value !== null;
}

function isAttachment(value: VaultAttachment | null): value is VaultAttachment {
  return value !== null;
}

function lowerFirst(value: string): string {
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
