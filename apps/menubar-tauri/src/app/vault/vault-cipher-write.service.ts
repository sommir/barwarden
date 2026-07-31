import { InjectionToken } from "@angular/core";

import type { AuthSession } from "../../auth/auth-session-store";
import { BitwardenApiClient } from "../../bitwarden-api/bitwarden-api";
import type { HostApi } from "../../host/host-api";
import { TauriHostService } from "../../host/tauri-host.service";
import type { VaultItem } from "../vault-demo";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import {
  preflightPreservedCipherUpdate,
  retainOpaqueCipherPayload,
  type LoginCollectionAssociations,
  type OpaqueArrayAssociation,
  type OpaqueCipherPayload,
} from "./opaque-cipher-payload";
import {
  personalCipherFieldInputs,
  type CardCipherDraft,
  type CipherCustomFieldInput,
  type IdentityCipherDraft,
  type SecureNoteCipherDraft,
} from "./personal-cipher-draft";
import {
  buildCardCipherCreateRequest,
  buildCardCipherUpdateRequest,
  buildIdentityCipherCreateRequest,
  buildIdentityCipherUpdateRequest,
  buildLoginCipherCreateRequest,
  buildLoginCipherUpdateRequest,
  buildSecureNoteCipherCreateRequest,
  buildSecureNoteCipherUpdateRequest,
} from "./vault-cipher-request.service";

let pendingSyncCipherCounter = 0;

export type { CardCipherDraft, IdentityCipherDraft, SecureNoteCipherDraft } from "./personal-cipher-draft";

export interface LoginCipherCreateDraft {
  readonly name: string;
  readonly username: string;
  readonly password: string;
  readonly totp: string;
  readonly uri: string;
  readonly uris?: readonly {
    readonly uri: string;
    readonly matchType: string;
  }[];
  readonly fields?: readonly {
    readonly name: string;
    readonly value: string;
    readonly type: 0 | 1 | 2;
  }[];
  readonly notes: string;
  readonly favorite?: boolean;
  readonly folderId?: string;
  readonly reprompt?: boolean;
}

export interface VaultCipherWritePort {
  createLoginCipher(session: AuthSession, draft: LoginCipherCreateDraft): Promise<VaultItem>;
  updateLoginCipher(session: AuthSession, item: VaultItem, draft: LoginCipherCreateDraft): Promise<VaultItem>;
  createCardCipher(session: AuthSession, draft: CardCipherDraft): Promise<VaultItem>;
  updateCardCipher(session: AuthSession, item: VaultItem, draft: CardCipherDraft): Promise<VaultItem>;
  createIdentityCipher(session: AuthSession, draft: IdentityCipherDraft): Promise<VaultItem>;
  updateIdentityCipher(session: AuthSession, item: VaultItem, draft: IdentityCipherDraft): Promise<VaultItem>;
  createSecureNoteCipher(session: AuthSession, draft: SecureNoteCipherDraft): Promise<VaultItem>;
  updateSecureNoteCipher(
    session: AuthSession,
    item: VaultItem,
    draft: SecureNoteCipherDraft,
  ): Promise<VaultItem>;
}

export type LoginCipherWriteResult =
  | { readonly committed: true; readonly item: VaultItem }
  | {
      readonly committed: false;
      readonly reason: "stale" | "failure";
    };

export type LoginCipherSaveOperationResult =
  | LoginCipherWriteResult
  | { readonly committed: false; readonly reason: "duplicate" };

export type PersonalCipherWriteResult =
  | { readonly committed: true; readonly item: VaultItem }
  | {
      readonly committed: false;
      readonly reason: "stale" | "failure";
    };

export async function runLoginCipherWrite(
  write: () => Promise<VaultItem>,
  isCurrent: () => boolean,
): Promise<LoginCipherWriteResult> {
  try {
    const item = await write();
    return isCurrent()
      ? { committed: true, item }
      : { committed: false, reason: "stale" };
  } catch {
    return {
      committed: false,
      reason: isCurrent() ? "failure" : "stale",
    };
  }
}

export async function runPersonalCipherWrite(
  write: () => Promise<VaultItem>,
  isCurrent: () => boolean,
): Promise<PersonalCipherWriteResult> {
  try {
    const item = await write();
    return isCurrent()
      ? { committed: true, item }
      : { committed: false, reason: "stale" };
  } catch {
    return {
      committed: false,
      reason: isCurrent() ? "failure" : "stale",
    };
  }
}

export const VAULT_CIPHER_WRITE_PORT = new InjectionToken<VaultCipherWritePort | null>(
  "VAULT_CIPHER_WRITE_PORT",
  {
    providedIn: "root",
    factory: () => null,
  },
);

export class BitwardenVaultCipherWriteActions implements VaultCipherWritePort {
  private readonly api: BitwardenApiClient;

  constructor(
    session: AuthSession,
    transport: HostApi = new TauriHostService(),
  ) {
    this.api = new BitwardenApiClient(session.environment, transport);
  }

  async createLoginCipher(session: AuthSession, draft: LoginCipherCreateDraft): Promise<VaultItem> {
    if (!session.crypto?.userKeyB64) {
      throw new Error("Missing Bitwarden user key for cipher encryption");
    }

    const request = await buildLoginCipherCreateRequest({
      userKeyB64: session.crypto.userKeyB64,
      name: draft.name,
      username: draft.username,
      password: draft.password,
      totp: draft.totp,
      uri: draft.uri,
      ...(draft.uris ? { uris: draft.uris } : {}),
      ...(draft.fields ? { fields: draft.fields } : {}),
      notes: draft.notes,
      favorite: draft.favorite,
      folderId: draft.folderId,
      reprompt: draft.reprompt,
    });
    const response = await this.api.postCipher<unknown>(request, session.token.accessToken);

    return loginVaultItemFromCreateResponse(response, draft, undefined, undefined, undefined, true);
  }

  async updateLoginCipher(
    session: AuthSession,
    item: VaultItem,
    draft: LoginCipherCreateDraft,
  ): Promise<VaultItem> {
    const preservedOpaqueServerPayload = item.opaqueServerPayload
      ? retainOpaqueCipherPayload(item.opaqueServerPayload)
      : undefined;
    if (!session.crypto?.userKeyB64) {
      throw new Error("Missing Bitwarden user key for cipher encryption");
    }
    if (item.requiresVaultSyncBeforeEdit) {
      throw new Error("Login requires vault sync before editing");
    }
    if (item.organizationId || hasNonPersonalOpaqueOwnership(preservedOpaqueServerPayload)) {
      throw new Error("Organization-owned Login editing requires an organization encryption key");
    }
    const collectionIds = personalCollectionIds(item, preservedOpaqueServerPayload);

    const revisionDateNow = new Date().toISOString();
    const effectiveDraft: LoginCipherCreateDraft = {
      ...draft,
      uris: draft.uris ?? replacePrimaryUri(item.uris, draft.uri),
      fields: draft.fields ?? retainedCustomFieldRequests(item),
      favorite: draft.favorite ?? item.favorite,
      folderId: draft.folderId ?? item.folderId,
      reprompt: draft.reprompt ?? item.reprompt ?? false,
    };
    const collectionAssociations = preservedOpaqueServerPayload
      ? deriveOpaqueLoginCollectionAssociations(preservedOpaqueServerPayload, item, effectiveDraft)
      : undefined;
    const request = await buildLoginCipherUpdateRequest({
      userKeyB64: session.crypto.userKeyB64,
      name: effectiveDraft.name,
      username: effectiveDraft.username,
      password: effectiveDraft.password,
      totp: effectiveDraft.totp,
      uri: effectiveDraft.uri,
      uris: effectiveDraft.uris,
      fields: effectiveDraft.fields,
      notes: effectiveDraft.notes,
      favorite: effectiveDraft.favorite,
      folderId: effectiveDraft.folderId,
      reprompt: effectiveDraft.reprompt,
      ...(item.encryptedKey ? { encryptedKey: item.encryptedKey } : {}),
      currentPassword: item.fields.find((field) => field.id === "password")?.value ?? "",
      ...(item.passwordRevisionDate ? { passwordRevisionDate: item.passwordRevisionDate } : {}),
      passwordHistory: item.passwordHistory ?? [],
      revisionDateNow,
      lastKnownRevisionDate: item.revisionDate,
      ...(preservedOpaqueServerPayload
        ? {
            preserved: preservedOpaqueServerPayload,
            ownership: {
              organizationId: item.organizationId ?? null,
              collectionIds,
            },
            collectionAssociations,
          }
        : {}),
    });
    const sentOpaqueServerPayload = preservedOpaqueServerPayload
      ? request as OpaqueCipherPayload
      : undefined;
    const response = await this.api.putCipher<unknown>(
      item.id,
      request,
      session.token.accessToken,
    );
    return loginVaultItemFromCreateResponse(
      response,
      effectiveDraft,
      item,
      revisionDateNow,
      sentOpaqueServerPayload,
      Boolean(sentOpaqueServerPayload),
    );
  }

  async createCardCipher(session: AuthSession, draft: CardCipherDraft): Promise<VaultItem> {
    if (!session.crypto?.userKeyB64) {
      throw new Error("Missing Bitwarden user key for cipher encryption");
    }

    const request = await buildCardCipherCreateRequest({
      userKeyB64: session.crypto.userKeyB64,
      name: draft.name,
      cardholderName: draft.cardholderName,
      brand: draft.brand,
      number: draft.number,
      expMonth: draft.expMonth,
      expYear: draft.expYear,
      code: draft.code,
      notes: draft.notes,
      favorite: draft.favorite,
      folderId: draft.folderId,
      reprompt: draft.reprompt,
      fields: draft.fields,
    });
    const response = await this.api.postCipher<unknown>(request, session.token.accessToken);

    return cardVaultItemFromCreateResponse(response, draft, undefined, undefined, true);
  }

  async updateCardCipher(
    session: AuthSession,
    item: VaultItem,
    draft: CardCipherDraft,
  ): Promise<VaultItem> {
    const preflight = preflightPersonalCipherUpdate(item, "card");
    const fieldPlan = preparePersonalFieldUpdate(
      preflight.preserved,
      item,
      "card",
      draft.fields,
    );
    if (!session.crypto?.userKeyB64) {
      throw new Error("Missing Bitwarden user key for cipher encryption");
    }
    const effectiveDraft: CardCipherDraft = { ...draft, fields: fieldPlan.fields };

    const request = await buildCardCipherUpdateRequest({
      userKeyB64: session.crypto.userKeyB64,
      name: effectiveDraft.name,
      cardholderName: effectiveDraft.cardholderName,
      brand: effectiveDraft.brand ?? item.card?.brand ?? "",
      number: effectiveDraft.number,
      expMonth: effectiveDraft.expMonth,
      expYear: effectiveDraft.expYear,
      code: effectiveDraft.code,
      notes: effectiveDraft.notes,
      favorite: effectiveDraft.favorite ?? item.favorite,
      folderId: effectiveDraft.folderId ?? item.folderId,
      reprompt: effectiveDraft.reprompt ?? item.reprompt ?? false,
      fields: fieldPlan.fields,
      ...(preflight.encryptedKey ? { encryptedKey: preflight.encryptedKey } : {}),
      lastKnownRevisionDate: item.revisionDate,
      preserved: preflight.preserved,
      ownership: preflight.ownership,
      associations: fieldPlan.associations,
    });
    const sentOpaqueServerPayload = request as unknown as OpaqueCipherPayload;
    const response = await this.api.putCipher<unknown>(
      item.id,
      request,
      session.token.accessToken,
    );

    return cardVaultItemFromCreateResponse(
      response,
      effectiveDraft,
      item,
      sentOpaqueServerPayload,
      true,
    );
  }

  async createIdentityCipher(
    session: AuthSession,
    draft: IdentityCipherDraft,
  ): Promise<VaultItem> {
    if (!session.crypto?.userKeyB64) {
      throw new Error("Missing Bitwarden user key for cipher encryption");
    }

    const request = await buildIdentityCipherCreateRequest({
      userKeyB64: session.crypto.userKeyB64,
      name: draft.name,
      title: draft.title,
      firstName: draft.firstName,
      middleName: draft.middleName,
      lastName: draft.lastName,
      username: draft.username,
      company: draft.company,
      ssn: draft.ssn,
      passportNumber: draft.passportNumber,
      licenseNumber: draft.licenseNumber,
      email: draft.email,
      phone: draft.phone,
      address1: draft.address1,
      address2: draft.address2,
      address3: draft.address3,
      city: draft.city,
      state: draft.state,
      postalCode: draft.postalCode,
      country: draft.country,
      notes: draft.notes,
      favorite: draft.favorite,
      folderId: draft.folderId,
      reprompt: draft.reprompt,
      fields: draft.fields,
    });
    const response = await this.api.postCipher<unknown>(request, session.token.accessToken);

    return identityVaultItemFromCreateResponse(response, draft, undefined, undefined, true);
  }

  async updateIdentityCipher(
    session: AuthSession,
    item: VaultItem,
    draft: IdentityCipherDraft,
  ): Promise<VaultItem> {
    const preflight = preflightPersonalCipherUpdate(item, "identity");
    const fieldPlan = preparePersonalFieldUpdate(
      preflight.preserved,
      item,
      "identity",
      draft.fields,
    );
    if (!session.crypto?.userKeyB64) {
      throw new Error("Missing Bitwarden user key for cipher encryption");
    }
    const effectiveDraft: IdentityCipherDraft = { ...draft, fields: fieldPlan.fields };

    const request = await buildIdentityCipherUpdateRequest({
      userKeyB64: session.crypto.userKeyB64,
      name: effectiveDraft.name,
      title: effectiveDraft.title ?? item.identity?.title ?? "",
      firstName: effectiveDraft.firstName,
      middleName: effectiveDraft.middleName ?? item.identity?.middleName ?? "",
      lastName: effectiveDraft.lastName,
      username: effectiveDraft.username ?? item.identity?.username ?? "",
      company: effectiveDraft.company ?? item.identity?.company ?? "",
      ssn: effectiveDraft.ssn ?? item.identity?.ssn ?? "",
      passportNumber: effectiveDraft.passportNumber ?? item.identity?.passportNumber ?? "",
      licenseNumber: effectiveDraft.licenseNumber ?? item.identity?.licenseNumber ?? "",
      email: effectiveDraft.email,
      phone: effectiveDraft.phone,
      address1: effectiveDraft.address1,
      address2: effectiveDraft.address2 ?? item.identity?.address2 ?? "",
      address3: effectiveDraft.address3 ?? item.identity?.address3 ?? "",
      city: effectiveDraft.city ?? item.identity?.city ?? "",
      state: effectiveDraft.state ?? item.identity?.state ?? "",
      postalCode: effectiveDraft.postalCode ?? item.identity?.postalCode ?? "",
      country: effectiveDraft.country ?? item.identity?.country ?? "",
      notes: effectiveDraft.notes,
      favorite: effectiveDraft.favorite ?? item.favorite,
      folderId: effectiveDraft.folderId ?? item.folderId,
      reprompt: effectiveDraft.reprompt ?? item.reprompt ?? false,
      fields: fieldPlan.fields,
      ...(preflight.encryptedKey ? { encryptedKey: preflight.encryptedKey } : {}),
      lastKnownRevisionDate: item.revisionDate,
      preserved: preflight.preserved,
      ownership: preflight.ownership,
      associations: fieldPlan.associations,
    });
    const sentOpaqueServerPayload = request as unknown as OpaqueCipherPayload;
    const response = await this.api.putCipher<unknown>(
      item.id,
      request,
      session.token.accessToken,
    );

    return identityVaultItemFromCreateResponse(
      response,
      effectiveDraft,
      item,
      sentOpaqueServerPayload,
      true,
    );
  }

  async createSecureNoteCipher(
    session: AuthSession,
    draft: SecureNoteCipherDraft,
  ): Promise<VaultItem> {
    if (!session.crypto?.userKeyB64) {
      throw new Error("Missing Bitwarden user key for cipher encryption");
    }

    const request = await buildSecureNoteCipherCreateRequest({
      userKeyB64: session.crypto.userKeyB64,
      name: draft.name,
      notes: draft.notes,
      noteType: draft.noteType,
      favorite: draft.favorite,
      folderId: draft.folderId,
      reprompt: draft.reprompt,
      fields: draft.fields,
    });
    const response = await this.api.postCipher<unknown>(request, session.token.accessToken);

    return secureNoteVaultItemFromCreateResponse(response, draft, undefined, undefined, true);
  }

  async updateSecureNoteCipher(
    session: AuthSession,
    item: VaultItem,
    draft: SecureNoteCipherDraft,
  ): Promise<VaultItem> {
    const preflight = preflightPersonalCipherUpdate(item, "secure-note");
    const fieldPlan = preparePersonalFieldUpdate(
      preflight.preserved,
      item,
      "secure-note",
      draft.fields,
    );
    if (!session.crypto?.userKeyB64) {
      throw new Error("Missing Bitwarden user key for cipher encryption");
    }
    const effectiveDraft: SecureNoteCipherDraft = { ...draft, fields: fieldPlan.fields };

    const request = await buildSecureNoteCipherUpdateRequest({
      userKeyB64: session.crypto.userKeyB64,
      name: effectiveDraft.name,
      notes: effectiveDraft.notes,
      noteType: effectiveDraft.noteType ?? item.secureNote?.type ?? 0,
      favorite: effectiveDraft.favorite ?? item.favorite,
      folderId: effectiveDraft.folderId ?? item.folderId,
      reprompt: effectiveDraft.reprompt ?? item.reprompt ?? false,
      fields: fieldPlan.fields,
      ...(preflight.encryptedKey ? { encryptedKey: preflight.encryptedKey } : {}),
      lastKnownRevisionDate: item.revisionDate,
      preserved: preflight.preserved,
      ownership: preflight.ownership,
      associations: fieldPlan.associations,
    });
    const sentOpaqueServerPayload = request as unknown as OpaqueCipherPayload;
    const response = await this.api.putCipher<unknown>(
      item.id,
      request,
      session.token.accessToken,
    );

    return secureNoteVaultItemFromCreateResponse(
      response,
      effectiveDraft,
      item,
      sentOpaqueServerPayload,
      true,
    );
  }
}

const uriOpaqueAllowlist = new Set(["uri", "urichecksum", "match"]);
const loginFieldOpaqueAllowlist = new Set(["name", "value", "type"]);
const personalFieldOpaqueAllowlist = new Set(["name", "value", "type", "linkedid"]);

function preflightPersonalCipherUpdate(
  item: VaultItem,
  expectedType: "card" | "identity" | "secure-note",
): {
  readonly preserved: OpaqueCipherPayload;
  readonly ownership: { readonly organizationId: null; readonly collectionIds: readonly [] };
  readonly encryptedKey?: string;
} {
  const type = ownDataValue(item, "type", "Unable to safely preserve opaque personal cipher data");
  if (type !== expectedType) {
    throw new TypeError("Personal cipher update type does not match the selected item");
  }
  const syncRequired = ownDataValue(
    item,
    "requiresVaultSyncBeforeEdit",
    "Unable to safely preserve opaque personal cipher data",
  );
  if (syncRequired === true) {
    throw new Error("Personal cipher requires vault sync before editing");
  }

  const organizationId = ownDataValue(
    item,
    "organizationId",
    "Organization-owned personal cipher editing is not supported",
  );
  if (organizationId !== absentOwnDataValue && organizationId != null) {
    throw new Error("Organization-owned personal cipher editing is not supported");
  }
  const collectionIds = ownDataValue(
    item,
    "collectionIds",
    "Collection-associated personal cipher editing is not supported",
  );
  if (collectionIds !== absentOwnDataValue && !isEmptyStringArray(collectionIds)) {
    throw new Error("Collection-associated personal cipher editing is not supported");
  }

  const payload = ownDataValue(
    item,
    "opaqueServerPayload",
    "Unable to safely preserve opaque personal cipher data",
  );
  if (payload === absentOwnDataValue || payload === undefined) {
    throw new Error("Personal cipher update requires a fresh opaque server payload");
  }
  const renderedKey = ownDataValue(
    item,
    "encryptedKey",
    "Unable to safely preserve opaque personal cipher data",
  );
  if (
    renderedKey !== absentOwnDataValue &&
    renderedKey !== undefined &&
    typeof renderedKey !== "string"
  ) {
    throw new Error("Unable to safely preserve opaque personal cipher data");
  }

  const ownership = { organizationId: null, collectionIds: [] } as const;
  const preflight = preflightPreservedCipherUpdate({
    cipherType: expectedType,
    preserved: payload,
    ownership,
    ...(typeof renderedKey === "string" ? { renderedEncryptedKey: renderedKey } : {}),
  });
  return { ...preflight, ownership };
}

const absentOwnDataValue = Symbol("absent own data value");

function ownDataValue(
  source: object,
  key: string,
  errorMessage: string,
): unknown | typeof absentOwnDataValue {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(source, key);
  } catch {
    throw new Error(errorMessage);
  }
  if (!descriptor) {
    return absentOwnDataValue;
  }
  if (!("value" in descriptor)) {
    throw new Error(errorMessage);
  }
  return descriptor.value;
}

function preparePersonalFieldUpdate(
  payload: OpaqueCipherPayload,
  item: VaultItem,
  type: "card" | "identity" | "secure-note",
  submittedFields: readonly CipherCustomFieldInput[] | undefined,
): {
  readonly fields: readonly CipherCustomFieldInput[];
  readonly associations: readonly OpaqueArrayAssociation[];
} {
  const originalFields = personalCipherFieldInputs(item);
  const fields = submittedFields
    ? normalizeLegacyPersonalFields(type, originalFields, submittedFields)
    : originalFields;
  return {
    fields,
    associations: personalFieldAssociations(payload, originalFields, fields),
  };
}

function normalizeLegacyPersonalFields(
  type: "card" | "identity" | "secure-note",
  originalFields: readonly CipherCustomFieldInput[],
  submittedFields: readonly CipherCustomFieldInput[],
): readonly CipherCustomFieldInput[] {
  const originalNames = originalFields.map(personalFieldIdentitySignature);
  const submittedNames = submittedFields.map(personalFieldIdentitySignature);
  return submittedFields.map((submitted, index) => {
    if (type === "secure-note" && submitted.type === 3) {
      throw new TypeError("Linked field target is not valid for this personal cipher type");
    }
    const identity = submittedNames[index]!;
    if (
      countSignatures(originalNames, identity) !== 1 ||
      countSignatures(submittedNames, identity) !== 1
    ) {
      return submitted;
    }
    const source = originalFields[findSignatureIndex(originalNames, identity)];
    if (!source) {
      return submitted;
    }
    if (source.type !== 3) {
      if (submitted.type === 3) {
        throw new Error("Unable to safely preserve opaque personal cipher fields");
      }
      return submitted;
    }
    if (type === "secure-note") {
      throw new TypeError("Linked field target is not valid for this personal cipher type");
    }
    if (submitted.type === 3) {
      if (submitted.value !== null || submitted.linkedId !== source.linkedId) {
        throw new Error("Unable to safely preserve opaque personal cipher fields");
      }
      return source;
    }
    if (submitted.type !== 0 || String(submitted.value ?? "") !== "") {
      throw new Error("Unable to safely preserve opaque personal cipher fields");
    }
    return source;
  });
}

function personalFieldAssociations(
  payload: OpaqueCipherPayload,
  originalFields: readonly CipherCustomFieldInput[],
  fields: readonly CipherCustomFieldInput[],
): readonly OpaqueArrayAssociation[] {
  const retainedFields = optionalPayloadRecordArray(payload, "fields");
  const association = provePositionalOpaquePersonalFieldAssociations(
    retainedFields,
    originalFields.map(personalFieldIdentitySignature),
    fields.map(personalFieldIdentitySignature),
  );
  return association ? [{ path: ["Fields"], editedToSource: association }] : [];
}

function provePositionalOpaquePersonalFieldAssociations(
  retained: readonly Record<string, unknown>[] | undefined,
  originalSignatures: readonly CollectionSignature[],
  editedSignatures: readonly CollectionSignature[],
): readonly (number | null)[] | undefined {
  if (!retained) {
    return undefined;
  }
  const opaqueRetainedIndices = retained
    .map((record, index) => payloadRecordHasOpaqueExtras(record, personalFieldOpaqueAllowlist) ? index : -1)
    .filter((index) => index >= 0);
  if (opaqueRetainedIndices.length === 0) {
    return undefined;
  }
  const errorMessage = "Unable to safely preserve opaque personal cipher fields";
  if (retained.length !== originalSignatures.length) {
    throw new Error(errorMessage);
  }
  const associations: (number | null)[] = Array.from({ length: editedSignatures.length }, () => null);
  for (const retainedIndex of opaqueRetainedIndices) {
    const original = originalSignatures[retainedIndex];
    const edited = editedSignatures[retainedIndex];
    if (
      original == null ||
      edited == null ||
      !signaturesEqual(original, edited) ||
      countSignatures(originalSignatures, original) !== 1 ||
      countSignatures(editedSignatures, edited) !== 1
    ) {
      throw new Error(errorMessage);
    }
    associations[retainedIndex] = retainedIndex;
  }
  return associations;
}

function deriveOpaqueLoginCollectionAssociations(
  payload: OpaqueCipherPayload,
  item: VaultItem,
  draft: LoginCipherCreateDraft,
): LoginCollectionAssociations {
  const login = combinedPayloadRecord(payload, "login");
  const retainedUris = optionalPayloadRecordArray(login, "uris");
  const retainedFields = optionalPayloadRecordArray(payload, "fields");
  return {
    uris: proveOpaqueCollectionAssociations(
      retainedUris,
      item.uris.map(uriSignature),
      (draft.uris ?? []).map(draftUriSignature),
      uriOpaqueAllowlist,
    ),
    fields: proveOpaqueCollectionAssociations(
      retainedFields,
      retainedCustomFieldRequests(item).map(fieldSignature),
      (draft.fields ?? []).map(fieldSignature),
      loginFieldOpaqueAllowlist,
    ),
  };
}

type CollectionSignature = readonly (string | number | boolean | null)[];

function proveOpaqueCollectionAssociations(
  retained: readonly Record<string, unknown>[] | undefined,
  originalSignatures: readonly CollectionSignature[],
  editedSignatures: readonly CollectionSignature[],
  allowlistedKeys: ReadonlySet<string>,
  errorMessage = "Unable to safely preserve opaque Login collection data",
): readonly (number | null)[] | undefined {
  if (!retained) {
    return undefined;
  }
  const opaqueRetainedIndices = retained
    .map((record, index) => payloadRecordHasOpaqueExtras(record, allowlistedKeys) ? index : -1)
    .filter((index) => index >= 0);
  if (opaqueRetainedIndices.length === 0) {
    return undefined;
  }
  if (retained.length !== originalSignatures.length) {
    throw new Error(errorMessage);
  }
  const associations: (number | null)[] = Array.from({ length: editedSignatures.length }, () => null);
  for (const retainedIndex of opaqueRetainedIndices) {
    const signature = originalSignatures[retainedIndex];
    if (
      signature == null ||
      countSignatures(originalSignatures, signature) !== 1 ||
      countSignatures(editedSignatures, signature) !== 1
    ) {
      throw new Error(errorMessage);
    }
    associations[findSignatureIndex(editedSignatures, signature)] = retainedIndex;
  }
  return associations;
}

function countSignatures(
  values: readonly CollectionSignature[],
  target: CollectionSignature,
): number {
  return values.reduce((count, value) => count + (signaturesEqual(value, target) ? 1 : 0), 0);
}

function findSignatureIndex(values: readonly CollectionSignature[], target: CollectionSignature): number {
  return values.findIndex((value) => signaturesEqual(value, target));
}

function signaturesEqual(left: CollectionSignature, right: CollectionSignature): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function payloadRecordHasOpaqueExtras(
  record: Record<string, unknown>,
  allowlistedKeys: ReadonlySet<string>,
): boolean {
  return payloadOwnDataEntries(record).some(([key]) => !allowlistedKeys.has(normalizePayloadKey(key)));
}

function uriSignature(entry: VaultItem["uris"][number]): CollectionSignature {
  return [entry.uri.trim(), canonicalUriMatchType(entry.matchType)];
}

function draftUriSignature(entry: NonNullable<LoginCipherCreateDraft["uris"]>[number]): CollectionSignature {
  return [entry.uri.trim(), canonicalUriMatchType(entry.matchType)];
}

function fieldSignature(
  entry: { readonly name: string; readonly value: string; readonly type: 0 | 1 | 2 },
): CollectionSignature {
  const value = entry.type === 2 ? canonicalBooleanFieldValue(entry.value) : entry.value;
  return [entry.name.trim(), value, entry.type];
}

function personalFieldIdentitySignature(entry: CipherCustomFieldInput): CollectionSignature {
  return [entry.name.trim()];
}

function canonicalUriMatchType(value: string): string {
  const trimmed = value.trim();
  if (value === "default" || trimmed.length === 0) {
    return "default";
  }
  const match = Number(trimmed);
  return Number.isInteger(match) && match >= 0 ? String(match) : "default";
}

function canonicalBooleanFieldValue(value: string): string {
  return value.trim().toLowerCase() === "true" ? "true" : "false";
}

function hasNonPersonalOpaqueOwnership(payload: OpaqueCipherPayload | undefined): boolean {
  if (!payload) {
    return false;
  }
  for (const [key, value] of payloadOwnDataEntries(payload)) {
    if (normalizePayloadKey(key) !== "organizationid") {
      continue;
    }
    if (value !== null && value !== "") {
      return true;
    }
  }
  return false;
}

function personalCollectionIds(
  item: VaultItem,
  payload: OpaqueCipherPayload | undefined,
): readonly string[] {
  const renderedDescriptor = Object.getOwnPropertyDescriptor(item, "collectionIds");
  if (renderedDescriptor && (!("value" in renderedDescriptor) || !isEmptyStringArray(renderedDescriptor.value))) {
    throw new Error("Collection-associated Login editing is not supported");
  }
  if (payload) {
    for (const [key, value] of payloadOwnDataEntries(payload)) {
      if (normalizePayloadKey(key) === "collectionids" && !isEmptyStringArray(value)) {
        throw new Error("Collection-associated Login editing is not supported");
      }
    }
  }
  return [];
}

function isEmptyStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return false;
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  return Boolean(
    lengthDescriptor &&
    "value" in lengthDescriptor &&
    lengthDescriptor.value === 0 &&
    Reflect.ownKeys(value).length === 1
  );
}

function combinedPayloadRecord(
  record: Record<string, unknown>,
  normalizedName: string,
): Record<string, unknown> {
  const combined = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of payloadOwnDataEntries(record)) {
    if (normalizePayloadKey(key) !== normalizedName) {
      continue;
    }
    if (!isPayloadRecord(value)) {
      throw new Error("Unable to safely preserve opaque Login collection data");
    }
    for (const [childKey, childValue] of payloadOwnDataEntries(value)) {
      setPayloadDataProperty(combined, childKey, childValue);
    }
  }
  return combined;
}

function optionalPayloadRecordArray(
  record: Record<string, unknown>,
  normalizedName: string,
): readonly Record<string, unknown>[] | undefined {
  const value = payloadCaseInsensitiveValue(record, normalizedName);
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => !isPayloadRecord(entry))) {
    throw new Error("Unable to safely preserve opaque Login collection data");
  }
  return value as readonly Record<string, unknown>[];
}

function payloadCaseInsensitiveValue(
  record: Record<string, unknown>,
  normalizedName: string,
): unknown {
  const entry = payloadOwnDataEntries(record)
    .find(([key]) => normalizePayloadKey(key) === normalizedName);
  return entry?.[1];
}

function payloadOwnDataEntries(record: Record<string, unknown>): readonly [string, unknown][] {
  const entries: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string") {
      throw new TypeError("Invalid opaque cipher payload");
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError("Invalid opaque cipher payload");
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function setPayloadDataProperty(record: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function isPayloadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePayloadKey(key: string): string {
  return key.toLowerCase();
}

function loginVaultItemFromCreateResponse(
  response: unknown,
  draft: LoginCipherCreateDraft,
  fallback?: VaultItem,
  passwordChangeDate?: string,
  opaqueServerPayload?: OpaqueCipherPayload,
  requiresVaultSyncBeforeEdit = false,
): VaultItem {
  const now = new Date().toISOString();
  const id = safeResponseString(response, "id") || fallback?.id || pendingSyncCipherId("login");

  const uri = draft.uri.trim();
  const uris = draft.uris !== undefined
    ? draft.uris
        .map((entry, index) => ({
          id: `${id}-uri-${index}`,
          uri: entry.uri.trim(),
          matchType: entry.matchType,
        }))
        .filter((entry) => entry.uri.length > 0)
    : fallback?.uris ?? (uri ? [{ id: `${id}-uri-0`, uri, matchType: "default" }] : []);
  const primaryUri = uris[0]?.uri ?? "";
  const username = draft.username.trim();
  const password = draft.password;
  const previousPassword = fallback?.fields.find((candidate) => candidate.id === "password")?.value ?? "";
  const passwordChanged = Boolean(fallback && previousPassword && previousPassword !== password);
  const totp = draft.totp.trim();
  const customFields = draft.fields
    ? draft.fields.map((candidate, index) => ({
        id: `custom:${index}`,
        label: candidate.name,
        value: candidate.type === 2 ? (candidate.value === "true" ? "true" : "false") : candidate.value,
        type: candidate.type === 1 ? "hidden" as const : candidate.type === 2 ? "boolean" as const : "text" as const,
        ...(candidate.type === 1 ? { concealed: true } : {}),
      }))
    : retainedCustomFields(fallback);
  const fields = [
    field("username", translateOfficialMessage("username"), username),
    field("password", translateOfficialMessage("password"), password, true, "hidden"),
    field("otp", translateOfficialMessage("verificationCodeTotp"), totp, false, "totp"),
  ].filter((candidate) => candidate.value.length > 0).concat(customFields);
  const folderId = draft.folderId ?? fallback?.folderId ?? "";

  return {
    id,
    ...(opaqueServerPayload
      ? { opaqueServerPayload }
      : fallback?.opaqueServerPayload ? { opaqueServerPayload: fallback.opaqueServerPayload } : {}),
    ...(requiresVaultSyncBeforeEdit ? { requiresVaultSyncBeforeEdit: true } : {}),
    ...(fallback?.encryptedKey ? { encryptedKey: fallback.encryptedKey } : {}),
    ...(fallback?.organizationId
      ? { organizationId: fallback.organizationId, collectionIds: fallback.collectionIds ?? [] }
      : {}),
    type: "login",
    name: draft.name.trim(),
    subtitle: username || primaryUri || translateOfficialMessage("typeLogin"),
    favorite: draft.favorite ?? fallback?.favorite ?? false,
    ...((draft.reprompt ?? fallback?.reprompt) ? { reprompt: true } : {}),
    folderId,
    folderName: folderId && folderId === fallback?.folderId ? fallback.folderName : "",
    organizationName: fallback?.organizationName || "",
    attachmentCount: fallback?.attachmentCount ?? 0,
    ...(fallback?.attachments ? { attachments: fallback.attachments } : {}),
    uris,
    fields,
    createdDate: fallback?.createdDate || now,
    revisionDate: safeResponseString(response, "revisiondate") || passwordChangeDate || now,
    ...((passwordChanged ? passwordChangeDate : fallback?.passwordRevisionDate)
      ? { passwordRevisionDate: (passwordChanged ? passwordChangeDate : fallback?.passwordRevisionDate)! }
      : {}),
    ...((passwordChanged || (fallback?.passwordHistory?.length ?? 0) > 0)
      ? {
          passwordHistory: [
            ...(passwordChanged
              ? [{ password: previousPassword, lastUsedDate: passwordChangeDate ?? now }]
              : []),
            ...(fallback?.passwordHistory ?? []),
          ].slice(0, 5),
        }
      : {}),
    notes: draft.notes.trim(),
    canLaunch: uris.length > 0,
    canFill: true,
    uri: primaryUri,
  };
}

function retainedCustomFieldRequests(item: VaultItem): readonly {
  readonly name: string;
  readonly value: string;
  readonly type: 0 | 1 | 2;
}[] {
  return retainedCustomFields(item).map((field) => ({
    name: field.label,
    value: field.value,
    type: field.type === "hidden" ? 1 : field.type === "boolean" ? 2 : 0,
  }));
}

function replacePrimaryUri(
  existing: VaultItem["uris"],
  nextPrimaryValue: string,
): readonly { readonly uri: string; readonly matchType: string }[] {
  const nextPrimary = nextPrimaryValue.trim();
  const remaining = existing.slice(1).map((entry) => ({
    uri: entry.uri,
    matchType: entry.matchType,
  }));
  if (!nextPrimary) {
    return remaining;
  }

  return [
    { uri: nextPrimary, matchType: existing[0]?.matchType ?? "default" },
    ...remaining,
  ];
}

function retainedCustomFields(item: VaultItem | undefined) {
  if (!item) {
    return [];
  }
  return item.fields.filter((field) => !standardActionFieldIds[item.type].has(field.id));
}

const standardActionFieldIds: Readonly<Record<VaultItem["type"], ReadonlySet<string>>> = {
  login: new Set(["username", "password", "otp"]),
  card: new Set([
    "brand", "cardholder-name", "number", "exp-month", "exp-year", "code", "notes",
  ]),
  identity: new Set([
    "title", "first-name", "middle-name", "last-name", "full-name", "username", "company",
    "ssn", "passport-number", "license-number", "email", "phone", "address", "address1",
    "address2", "address3", "address-1", "address-2", "address-3", "city", "state",
    "postal-code", "country", "notes",
  ]),
  "secure-note": new Set(["notes"]),
  ssh: new Set(),
};

function cardVaultItemFromCreateResponse(
  response: unknown,
  draft: CardCipherDraft,
  fallback?: VaultItem,
  opaqueServerPayload?: OpaqueCipherPayload,
  requiresVaultSyncBeforeEdit = false,
): VaultItem {
  const now = new Date().toISOString();
  const id = fallback?.id || requiredPersonalServerCipherId(response);

  const number = draft.number.trim();
  const customFields = draft.fields
    ? draftCustomFields(draft.fields)
    : retainedCustomFields(fallback);
  const fields = [
    field("brand", translateOfficialMessage("brand"), draft.brand ?? ""),
    field("cardholder-name", translateOfficialMessage("cardholderName"), draft.cardholderName),
    field("number", translateOfficialMessage("number"), number, true),
    field("exp-month", translateOfficialMessage("expirationMonth"), draft.expMonth),
    field("exp-year", translateOfficialMessage("expirationYear"), draft.expYear),
    field("code", translateOfficialMessage("securityCode"), draft.code, true, "hidden"),
  ].filter((candidate) => candidate.value.length > 0).concat(
    draft.notes.trim() ? [field("notes", translateOfficialMessage("notes"), draft.notes.trim())] : [],
    customFields,
  );
  const folderId =
    safeResponseNullableString(response, "folderid") ??
    draft.folderId ??
    fallback?.folderId ??
    "";

  return {
    id,
    ...retainedPersonalWriteState(fallback, opaqueServerPayload, requiresVaultSyncBeforeEdit),
    type: "card",
    name: draft.name.trim(),
    subtitle: number ? `•••• ${number.slice(-4)}` : translateOfficialMessage("typeCard"),
    favorite: safeResponseBoolean(response, "favorite") ?? draft.favorite ?? fallback?.favorite ?? false,
    ...((draft.reprompt ?? fallback?.reprompt) ? { reprompt: true } : {}),
    card: {
      cardholderName: draft.cardholderName.trim(),
      brand: draft.brand?.trim() ?? "",
      number,
      expMonth: draft.expMonth.trim(),
      expYear: draft.expYear.trim(),
      code: draft.code.trim(),
    },
    folderId,
    folderName: folderId && folderId === fallback?.folderId ? fallback.folderName : "",
    organizationName: fallback?.organizationName || "",
    attachmentCount: fallback?.attachmentCount ?? 0,
    ...(fallback?.attachments ? { attachments: fallback.attachments } : {}),
    uris: [],
    fields,
    createdDate:
      safeResponseString(response, "creationdate") ||
      fallback?.createdDate ||
      now,
    revisionDate:
      safeResponseString(response, "revisiondate") ||
      fallback?.revisionDate ||
      now,
    notes: draft.notes.trim(),
    canLaunch: false,
    canFill: false,
    uri: "",
  };
}

function identityVaultItemFromCreateResponse(
  response: unknown,
  draft: IdentityCipherDraft,
  fallback?: VaultItem,
  opaqueServerPayload?: OpaqueCipherPayload,
  requiresVaultSyncBeforeEdit = false,
): VaultItem {
  const now = new Date().toISOString();
  const id = fallback?.id || requiredPersonalServerCipherId(response);

  const identity = {
    title: draft.title?.trim() ?? fallback?.identity?.title ?? "",
    firstName: draft.firstName.trim(),
    middleName: draft.middleName?.trim() ?? fallback?.identity?.middleName ?? "",
    lastName: draft.lastName.trim(),
    username: draft.username?.trim() ?? fallback?.identity?.username ?? "",
    company: draft.company?.trim() ?? fallback?.identity?.company ?? "",
    ssn: draft.ssn?.trim() ?? fallback?.identity?.ssn ?? "",
    passportNumber:
      draft.passportNumber?.trim() ?? fallback?.identity?.passportNumber ?? "",
    licenseNumber: draft.licenseNumber?.trim() ?? fallback?.identity?.licenseNumber ?? "",
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    address1: draft.address1.trim(),
    address2: draft.address2?.trim() ?? fallback?.identity?.address2 ?? "",
    address3: draft.address3?.trim() ?? fallback?.identity?.address3 ?? "",
    city: draft.city?.trim() ?? fallback?.identity?.city ?? "",
    state: draft.state?.trim() ?? fallback?.identity?.state ?? "",
    postalCode: draft.postalCode?.trim() ?? fallback?.identity?.postalCode ?? "",
    country: draft.country?.trim() ?? fallback?.identity?.country ?? "",
  };
  const identityName = [identity.title, identity.firstName, identity.middleName, identity.lastName]
    .filter(Boolean)
    .join(" ");
  const locality = [identity.city, identity.state].filter(Boolean).join(", ");
  const localityAndPostal = [locality, identity.postalCode].filter(Boolean).join(" ");
  const address = [
    identity.address1, identity.address2, identity.address3, localityAndPostal, identity.country,
  ].filter(Boolean).join("\n");
  const customFields = draft.fields
    ? draftCustomFields(draft.fields)
    : retainedCustomFields(fallback);
  const fields = [
    field("title", translateOfficialMessage("title"), identity.title),
    field("first-name", translateOfficialMessage("firstName"), identity.firstName),
    field("middle-name", translateOfficialMessage("middleName"), identity.middleName),
    field("last-name", translateOfficialMessage("lastName"), identity.lastName),
    field("full-name", translateOfficialMessage("name"), identityName),
    field("username", translateOfficialMessage("username"), identity.username),
    field("company", translateOfficialMessage("company"), identity.company),
    field("ssn", translateOfficialMessage("ssn"), identity.ssn, true, "hidden"),
    field("passport-number", translateOfficialMessage("passportNumber"), identity.passportNumber, true, "hidden"),
    field("license-number", translateOfficialMessage("licenseNumber"), identity.licenseNumber),
    field("email", translateOfficialMessage("email"), identity.email),
    field("phone", translateOfficialMessage("phone"), identity.phone),
    field("address-1", translateOfficialMessage("address1"), identity.address1),
    field("address-2", translateOfficialMessage("address2"), identity.address2),
    field("address-3", translateOfficialMessage("address3"), identity.address3),
    field("city", translateOfficialMessage("cityTown"), identity.city),
    field("state", translateOfficialMessage("stateProvince"), identity.state),
    field("postal-code", translateOfficialMessage("zipPostalCodeLabel"), identity.postalCode),
    field("country", translateOfficialMessage("country"), identity.country),
    field("address", translateOfficialMessage("address"), address),
    field("notes", translateOfficialMessage("notes"), draft.notes.trim()),
  ].filter((candidate) => candidate.value.length > 0).concat(customFields);
  const folderId =
    safeResponseNullableString(response, "folderid") ??
    draft.folderId ??
    fallback?.folderId ??
    "";

  return {
    id,
    ...retainedPersonalWriteState(fallback, opaqueServerPayload, requiresVaultSyncBeforeEdit),
    type: "identity",
    name: draft.name.trim(),
    subtitle: identity.email || identityName || translateOfficialMessage("typeIdentity"),
    favorite: safeResponseBoolean(response, "favorite") ?? draft.favorite ?? fallback?.favorite ?? false,
    ...((draft.reprompt ?? fallback?.reprompt) ? { reprompt: true } : {}),
    identity,
    folderId,
    folderName: folderId && folderId === fallback?.folderId ? fallback.folderName : "",
    organizationName: fallback?.organizationName || "",
    attachmentCount: fallback?.attachmentCount ?? 0,
    ...(fallback?.attachments ? { attachments: fallback.attachments } : {}),
    uris: [],
    fields,
    createdDate:
      safeResponseString(response, "creationdate") ||
      fallback?.createdDate ||
      now,
    revisionDate:
      safeResponseString(response, "revisiondate") ||
      fallback?.revisionDate ||
      now,
    notes: draft.notes.trim(),
    canLaunch: false,
    canFill: false,
    uri: "",
  };
}

function secureNoteVaultItemFromCreateResponse(
  response: unknown,
  draft: SecureNoteCipherDraft,
  fallback?: VaultItem,
  opaqueServerPayload?: OpaqueCipherPayload,
  requiresVaultSyncBeforeEdit = false,
): VaultItem {
  const now = new Date().toISOString();
  const id = fallback?.id || requiredPersonalServerCipherId(response);

  const notes = draft.notes.trim();
  const customFields = draft.fields
    ? draftCustomFields(draft.fields)
    : retainedCustomFields(fallback);
  const folderId =
    safeResponseNullableString(response, "folderid") ??
    draft.folderId ??
    fallback?.folderId ??
    "";

  return {
    id,
    ...retainedPersonalWriteState(fallback, opaqueServerPayload, requiresVaultSyncBeforeEdit),
    type: "secure-note",
    name: draft.name.trim(),
    subtitle: translateOfficialMessage("notes"),
    favorite: safeResponseBoolean(response, "favorite") ?? draft.favorite ?? fallback?.favorite ?? false,
    ...((draft.reprompt ?? fallback?.reprompt) ? { reprompt: true } : {}),
    secureNote: { type: draft.noteType ?? fallback?.secureNote?.type ?? 0 },
    folderId,
    folderName: folderId && folderId === fallback?.folderId ? fallback.folderName : "",
    organizationName: fallback?.organizationName || "",
    attachmentCount: fallback?.attachmentCount ?? 0,
    ...(fallback?.attachments ? { attachments: fallback.attachments } : {}),
    uris: [],
    fields: [...customFields, ...(notes ? [field("notes", translateOfficialMessage("notes"), notes)] : [])],
    createdDate:
      safeResponseString(response, "creationdate") ||
      fallback?.createdDate ||
      now,
    revisionDate:
      safeResponseString(response, "revisiondate") ||
      fallback?.revisionDate ||
      now,
    notes,
    canLaunch: false,
    canFill: false,
    uri: "",
  };
}

function draftCustomFields(fields: readonly CipherCustomFieldInput[]): VaultItem["fields"] {
  return fields.map((candidate, index) => ({
    id: `custom:${index}`,
    label: candidate.name,
    value: candidate.type === 2
      ? (canonicalBooleanFieldValue(String(candidate.value)) === "true" ? "true" : "false")
      : candidate.type === 3 ? "" : String(candidate.value ?? ""),
    type: candidate.type === 1
      ? "hidden" as const
      : candidate.type === 2
        ? "boolean" as const
        : candidate.type === 3 ? "linked" as const : "text" as const,
    ...(candidate.type === 1 ? { concealed: true } : {}),
    ...(candidate.type === 3 ? { linkedId: candidate.linkedId } : {}),
  }));
}

function retainedPersonalWriteState(
  fallback: VaultItem | undefined,
  opaqueServerPayload: OpaqueCipherPayload | undefined,
  requiresVaultSyncBeforeEdit: boolean,
) {
  const state: {
    opaqueServerPayload?: OpaqueCipherPayload;
    requiresVaultSyncBeforeEdit?: true;
    encryptedKey?: string;
    organizationId?: string;
    collectionIds?: readonly string[];
  } = {};
  if (opaqueServerPayload) {
    state.opaqueServerPayload = opaqueServerPayload;
  }
  if (requiresVaultSyncBeforeEdit) {
    state.requiresVaultSyncBeforeEdit = true;
  }
  if (fallback?.encryptedKey) {
    state.encryptedKey = fallback.encryptedKey;
  }
  if (fallback && Object.hasOwn(fallback, "organizationId") && fallback.organizationId !== undefined) {
    state.organizationId = fallback.organizationId;
  }
  if (fallback && Object.hasOwn(fallback, "collectionIds") && fallback.collectionIds !== undefined) {
    state.collectionIds = fallback.collectionIds;
  }
  return state;
}

function field(
  id: string,
  label: string,
  value: string,
  concealed = false,
  type?: "text" | "hidden" | "totp",
) {
  return {
    id,
    label,
    value,
    ...(concealed ? { concealed: true } : {}),
    ...(type ? { type } : {}),
  };
}

function safeResponseString(response: unknown, normalizedName: string): string {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    return "";
  }
  try {
    for (const key of Reflect.ownKeys(response)) {
      if (typeof key !== "string" || key.toLowerCase() !== normalizedName) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(response, key);
      if (descriptor?.enumerable && "value" in descriptor && typeof descriptor.value === "string") {
        return descriptor.value;
      }
    }
  } catch {
    return "";
  }
  return "";
}

function safeResponseBoolean(response: unknown, normalizedName: string): boolean | undefined {
  const value = safeResponseValue(response, normalizedName);
  return typeof value === "boolean" ? value : undefined;
}

function safeResponseNullableString(response: unknown, normalizedName: string): string | undefined {
  const value = safeResponseValue(response, normalizedName);
  return typeof value === "string" ? value : value === null ? "" : undefined;
}

function safeResponseValue(response: unknown, normalizedName: string): unknown {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    return undefined;
  }
  try {
    for (const key of Reflect.ownKeys(response)) {
      if (typeof key !== "string" || key.toLowerCase() !== normalizedName) {
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(response, key);
      return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function requiredPersonalServerCipherId(response: unknown): string {
  try {
    const retainedResponse = retainOpaqueCipherPayload(response);

    let id: string | undefined;
    let idCount = 0;
    for (const key of Reflect.ownKeys(retainedResponse)) {
      if (typeof key !== "string") {
        throw new TypeError();
      }
      const descriptor = Object.getOwnPropertyDescriptor(retainedResponse, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError();
      }
      if (key.toLowerCase() !== "id") {
        continue;
      }
      idCount += 1;
      if (typeof descriptor.value !== "string" || descriptor.value.trim().length === 0) {
        throw new TypeError();
      }
      id = descriptor.value;
    }
    if (idCount !== 1 || id === undefined) {
      throw new TypeError();
    }
    return id;
  } catch {
    throw new TypeError("Missing server cipher ID");
  }
}

function pendingSyncCipherId(type: "login"): string {
  try {
    return `pending-sync-${type}:${crypto.randomUUID()}`;
  } catch {
    pendingSyncCipherCounter += 1;
    return `pending-sync-${type}:${Date.now()}:${pendingSyncCipherCounter}`;
  }
}
