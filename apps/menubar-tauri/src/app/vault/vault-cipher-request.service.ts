import {
  base64ToBytes,
  bytesToBase64,
  decryptEncStringToBytes,
  encryptUtf8ToEncString,
} from "../../auth/bitwarden-crypto";
import type {
  CardCipherCreateRequest,
  IdentityCipherCreateRequest,
  LoginCipherCreateRequest,
  SecureNoteCipherCreateRequest,
} from "../../bitwarden-api/bitwarden-api";
import {
  CardLinkedId,
  IdentityLinkedId,
} from "@bitwarden/common/vault/enums/linked-id-type.enum";
import {
  mergePreservedCipherUpdate,
  mergePreservedLoginUpdate,
  preflightPreservedCipherUpdate,
  type LoginCollectionAssociations,
  type OpaqueArrayAssociation,
  type OpaqueCipherPayload,
  type PreservedCipherOwnership,
} from "./opaque-cipher-payload";
import type { CipherCustomFieldInput } from "./personal-cipher-draft";

export type { CipherCustomFieldInput } from "./personal-cipher-draft";

export interface LoginCipherCreateInput {
  readonly userKeyB64: string;
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
  readonly encryptedKey?: string;
  readonly currentPassword?: string;
  readonly passwordRevisionDate?: string;
  readonly passwordHistory?: readonly {
    readonly password: string;
    readonly lastUsedDate: string;
  }[];
  readonly revisionDateNow?: string;
  readonly randomBytes?: (length: number) => Uint8Array;
}

export interface LoginCipherUpdateInput extends LoginCipherCreateInput {
  readonly lastKnownRevisionDate: string;
  readonly preserved?: OpaqueCipherPayload;
  readonly ownership?: {
    readonly organizationId: string | null;
    readonly collectionIds: readonly string[];
  };
  readonly collectionAssociations?: LoginCollectionAssociations;
}

export interface CardCipherCreateInput {
  readonly userKeyB64: string;
  readonly name: string;
  readonly cardholderName: string;
  readonly brand?: string;
  readonly number: string;
  readonly expMonth: string;
  readonly expYear: string;
  readonly code: string;
  readonly notes: string;
  readonly favorite?: boolean;
  readonly folderId?: string;
  readonly reprompt?: boolean;
  readonly fields?: readonly CipherCustomFieldInput[];
  readonly randomBytes?: (length: number) => Uint8Array;
}

export interface CardCipherUpdateInput extends CardCipherCreateInput {
  readonly lastKnownRevisionDate: string;
  readonly encryptedKey?: string;
  readonly preserved?: OpaqueCipherPayload;
  readonly ownership?: PreservedCipherOwnership;
  readonly associations?: readonly OpaqueArrayAssociation[];
}

export interface IdentityCipherCreateInput {
  readonly userKeyB64: string;
  readonly name: string;
  readonly title?: string;
  readonly firstName: string;
  readonly middleName?: string;
  readonly lastName: string;
  readonly username?: string;
  readonly company?: string;
  readonly ssn?: string;
  readonly passportNumber?: string;
  readonly licenseNumber?: string;
  readonly email: string;
  readonly phone: string;
  readonly address1: string;
  readonly address2?: string;
  readonly address3?: string;
  readonly city?: string;
  readonly state?: string;
  readonly postalCode?: string;
  readonly country?: string;
  readonly notes: string;
  readonly favorite?: boolean;
  readonly folderId?: string;
  readonly reprompt?: boolean;
  readonly fields?: readonly CipherCustomFieldInput[];
  readonly randomBytes?: (length: number) => Uint8Array;
}

export interface IdentityCipherUpdateInput extends IdentityCipherCreateInput {
  readonly lastKnownRevisionDate: string;
  readonly encryptedKey?: string;
  readonly preserved?: OpaqueCipherPayload;
  readonly ownership?: PreservedCipherOwnership;
  readonly associations?: readonly OpaqueArrayAssociation[];
}

export interface SecureNoteCipherCreateInput {
  readonly userKeyB64: string;
  readonly name: string;
  readonly notes: string;
  readonly noteType?: number;
  readonly favorite?: boolean;
  readonly folderId?: string;
  readonly reprompt?: boolean;
  readonly fields?: readonly CipherCustomFieldInput[];
  readonly randomBytes?: (length: number) => Uint8Array;
}

export interface SecureNoteCipherUpdateInput extends SecureNoteCipherCreateInput {
  readonly lastKnownRevisionDate: string;
  readonly encryptedKey?: string;
  readonly preserved?: OpaqueCipherPayload;
  readonly ownership?: PreservedCipherOwnership;
  readonly associations?: readonly OpaqueArrayAssociation[];
}

export async function buildLoginCipherCreateRequest(
  input: LoginCipherCreateInput,
): Promise<LoginCipherCreateRequest> {
  return buildLoginCipherRequest(input);
}

export async function buildLoginCipherUpdateRequest(
  input: LoginCipherUpdateInput,
): Promise<LoginCipherCreateRequest> {
  if (input.preserved && !input.ownership) {
    throw new Error("Preserved Login updates require explicit ownership");
  }
  const edited = {
    ...(await buildLoginCipherRequest(input)),
    lastKnownRevisionDate: input.lastKnownRevisionDate,
  };
  return input.preserved
    ? mergePreservedLoginUpdate(
        input.preserved,
        edited,
        input.ownership!,
        {
          passwordChanged:
            input.currentPassword != null &&
            input.currentPassword.length > 0 &&
            input.currentPassword !== input.password,
          collectionAssociations: input.collectionAssociations,
        },
      )
    : edited;
}

export async function buildCardCipherCreateRequest(
  input: CardCipherCreateInput,
): Promise<CardCipherCreateRequest> {
  return buildCardCipherRequest(input);
}

export async function buildCardCipherUpdateRequest(
  input: CardCipherUpdateInput,
): Promise<CardCipherCreateRequest> {
  const preflightedInput = preflightPersonalUpdate("card", input);
  const edited = {
    ...(await buildCardCipherRequest(preflightedInput)),
    lastKnownRevisionDate: input.lastKnownRevisionDate,
  };
  return mergePersonalUpdate("card", preflightedInput, edited) as unknown as CardCipherCreateRequest;
}

export async function buildIdentityCipherCreateRequest(
  input: IdentityCipherCreateInput,
): Promise<IdentityCipherCreateRequest> {
  return buildIdentityCipherRequest(input);
}

export async function buildIdentityCipherUpdateRequest(
  input: IdentityCipherUpdateInput,
): Promise<IdentityCipherCreateRequest> {
  const preflightedInput = preflightPersonalUpdate("identity", input);
  const edited = {
    ...(await buildIdentityCipherRequest(preflightedInput)),
    lastKnownRevisionDate: input.lastKnownRevisionDate,
  };
  return mergePersonalUpdate("identity", preflightedInput, edited) as unknown as IdentityCipherCreateRequest;
}

export async function buildSecureNoteCipherCreateRequest(
  input: SecureNoteCipherCreateInput,
): Promise<SecureNoteCipherCreateRequest> {
  return buildSecureNoteCipherRequest(input);
}

export async function buildSecureNoteCipherUpdateRequest(
  input: SecureNoteCipherUpdateInput,
): Promise<SecureNoteCipherCreateRequest> {
  const preflightedInput = preflightPersonalUpdate("secure-note", input);
  const edited = {
    ...(await buildSecureNoteCipherRequest(preflightedInput)),
    lastKnownRevisionDate: input.lastKnownRevisionDate,
  };
  return mergePersonalUpdate("secure-note", preflightedInput, edited) as unknown as SecureNoteCipherCreateRequest;
}

function preflightPersonalUpdate<
  T extends CardCipherUpdateInput | IdentityCipherUpdateInput | SecureNoteCipherUpdateInput,
>(
  cipherType: "card" | "identity" | "secure-note",
  input: T,
): T {
  if (!input.preserved) {
    return input;
  }
  if (!input.ownership) {
    throw new Error("Preserved personal cipher updates require explicit ownership");
  }
  const preflight = preflightPreservedCipherUpdate({
    cipherType,
    preserved: input.preserved,
    ownership: input.ownership,
    ...(input.encryptedKey === undefined ? {} : { renderedEncryptedKey: input.encryptedKey }),
  });
  return {
    ...input,
    preserved: preflight.preserved,
    encryptedKey: preflight.encryptedKey,
  };
}

function mergePersonalUpdate(
  cipherType: "card" | "identity" | "secure-note",
  input: CardCipherUpdateInput | IdentityCipherUpdateInput | SecureNoteCipherUpdateInput,
  edited: object,
): OpaqueCipherPayload {
  if (!input.preserved) {
    return retainEditedRequest(edited);
  }
  if (!input.ownership) {
    throw new Error("Preserved personal cipher updates require explicit ownership");
  }
  return mergePreservedCipherUpdate({
    cipherType,
    preserved: input.preserved,
    edited: retainEditedRequest(edited),
    ownership: input.ownership,
    associations: input.associations ?? [],
  });
}

function retainEditedRequest(edited: object): OpaqueCipherPayload {
  return edited as OpaqueCipherPayload;
}

async function buildLoginCipherRequest(
  input: LoginCipherCreateInput,
): Promise<LoginCipherCreateRequest> {
  const randomBytes = input.randomBytes ?? secureRandomBytes;
  const encryptionKeyB64 = input.encryptedKey
    ? bytesToBase64(
        await decryptEncStringToBytes(input.encryptedKey, base64ToBytes(input.userKeyB64)),
      )
    : input.userKeyB64;
  const name = input.name.trim();
  const username = input.username.trim();
  const password = input.password;
  const totp = input.totp.trim();
  const uri = input.uri.trim();
  const uris = input.uris ?? (uri ? [{ uri, matchType: "default" }] : []);
  const fields = input.fields ?? [];
  const notes = input.notes.trim();
  const passwordChanged =
    input.currentPassword != null &&
    input.currentPassword.length > 0 &&
    input.currentPassword !== password;
  const passwordRevisionDate = passwordChanged
    ? (input.revisionDateNow ?? new Date().toISOString())
    : (input.passwordRevisionDate ?? null);
  const passwordHistory = [
    ...(passwordChanged
      ? [{ password: input.currentPassword ?? "", lastUsedDate: passwordRevisionDate ?? "" }]
      : []),
    ...(input.passwordHistory ?? []),
  ].slice(0, 5);

  return {
    type: 1,
    folderId: input.folderId?.trim() || null,
    organizationId: null,
    ...(input.encryptedKey ? { key: input.encryptedKey } : {}),
    name: await encryptUtf8ToEncString(name, encryptionKeyB64, randomBytes),
    notes: notes ? await encryptUtf8ToEncString(notes, encryptionKeyB64, randomBytes) : null,
    favorite: input.favorite ?? false,
    reprompt: input.reprompt ? 1 : 0,
    login: {
      username: username ? await encryptUtf8ToEncString(username, encryptionKeyB64, randomBytes) : null,
      password: password ? await encryptUtf8ToEncString(password, encryptionKeyB64, randomBytes) : null,
      passwordRevisionDate,
      totp: totp ? await encryptUtf8ToEncString(totp, encryptionKeyB64, randomBytes) : null,
      autofillOnPageLoad: null,
      uris: await Promise.all(
        uris
          .map((entry) => ({ uri: entry.uri.trim(), matchType: entry.matchType }))
          .filter((entry) => entry.uri.length > 0)
          .map(async (entry) => {
            const checksum = bytesToBase64(
              new Uint8Array(
                await crypto.subtle.digest("SHA-256", new TextEncoder().encode(entry.uri)),
              ),
            );
            return {
              uri: await encryptUtf8ToEncString(entry.uri, encryptionKeyB64, randomBytes),
              uriChecksum: await encryptUtf8ToEncString(
                checksum,
                encryptionKeyB64,
                randomBytes,
              ),
              match: cipherUriMatch(entry.matchType),
            };
          }),
      ),
    },
    fields: await Promise.all(
      fields
        .map((field) => ({ ...field, name: field.name.trim() }))
        .filter((field) => field.name.length > 0)
        .map(async (field) => ({
          name: await encryptUtf8ToEncString(field.name, encryptionKeyB64, randomBytes),
          value: await encryptUtf8ToEncString(
            field.type === 2 ? canonicalBooleanValue(field.value) : field.value,
            encryptionKeyB64,
            randomBytes,
          ),
          type: field.type,
        })),
    ),
    passwordHistory: await Promise.all(
      passwordHistory.map(async (entry) => ({
        password: await encryptUtf8ToEncString(entry.password, encryptionKeyB64, randomBytes),
        lastUsedDate: entry.lastUsedDate,
      })),
    ),
  };
}

function canonicalBooleanValue(value: string | boolean | null): string {
  return value === true || (typeof value === "string" && value.trim().toLowerCase() === "true")
    ? "true"
    : "false";
}

function cipherUriMatch(value: string): number | null {
  if (value === "default" || value.trim() === "") {
    return null;
  }

  const match = Number(value);
  return Number.isInteger(match) && match >= 0 ? match : null;
}

async function buildSecureNoteCipherRequest(
  input: SecureNoteCipherCreateInput & { readonly encryptedKey?: string },
): Promise<SecureNoteCipherCreateRequest> {
  const randomBytes = input.randomBytes ?? secureRandomBytes;
  const encryptionKeyB64 = await personalEncryptionKeyB64(input);
  const name = input.name.trim();
  const notes = input.notes.trim();

  return {
    type: 2,
    folderId: input.folderId?.trim() || null,
    organizationId: null,
    ...(input.encryptedKey ? { key: input.encryptedKey } : {}),
    name: await encryptUtf8ToEncString(name, encryptionKeyB64, randomBytes),
    notes: notes ? await encryptUtf8ToEncString(notes, encryptionKeyB64, randomBytes) : null,
    favorite: input.favorite ?? false,
    reprompt: input.reprompt ? 1 : 0,
    secureNote: { type: input.noteType ?? 0 },
    fields: await buildEncryptedCustomFields(
      input.fields ?? [],
      encryptionKeyB64,
      randomBytes,
      "secure-note",
    ),
    passwordHistory: [],
  };
}

async function buildCardCipherRequest(
  input: CardCipherCreateInput & { readonly encryptedKey?: string },
): Promise<CardCipherCreateRequest> {
  const randomBytes = input.randomBytes ?? secureRandomBytes;
  const encryptionKeyB64 = await personalEncryptionKeyB64(input);
  const name = input.name.trim();
  const cardholderName = input.cardholderName.trim();
  const brand = input.brand?.trim() ?? "";
  const number = input.number.trim();
  const expMonth = input.expMonth.trim();
  const expYear = input.expYear.trim();
  const code = input.code.trim();
  const notes = input.notes.trim();

  return {
    type: 3,
    folderId: input.folderId?.trim() || null,
    organizationId: null,
    ...(input.encryptedKey ? { key: input.encryptedKey } : {}),
    name: await encryptUtf8ToEncString(name, encryptionKeyB64, randomBytes),
    notes: notes ? await encryptUtf8ToEncString(notes, encryptionKeyB64, randomBytes) : null,
    favorite: input.favorite ?? false,
    reprompt: input.reprompt ? 1 : 0,
    card: {
      cardholderName: cardholderName
        ? await encryptUtf8ToEncString(cardholderName, encryptionKeyB64, randomBytes)
        : null,
      brand: brand ? await encryptUtf8ToEncString(brand, encryptionKeyB64, randomBytes) : null,
      number: number ? await encryptUtf8ToEncString(number, encryptionKeyB64, randomBytes) : null,
      expMonth: expMonth ? await encryptUtf8ToEncString(expMonth, encryptionKeyB64, randomBytes) : null,
      expYear: expYear ? await encryptUtf8ToEncString(expYear, encryptionKeyB64, randomBytes) : null,
      code: code ? await encryptUtf8ToEncString(code, encryptionKeyB64, randomBytes) : null,
    },
    fields: await buildEncryptedCustomFields(
      input.fields ?? [],
      encryptionKeyB64,
      randomBytes,
      "card",
    ),
    passwordHistory: [],
  };
}

async function buildEncryptedCustomFields(
  fields: readonly CipherCustomFieldInput[],
  keyB64: string,
  randomBytes: (length: number) => Uint8Array,
  cipherType: "card" | "identity" | "secure-note",
) {
  return Promise.all(
    fields
      .map((field) => ({ ...field, name: field.name.trim() }))
      .filter((field) => field.name.length > 0)
      .map(async (field) => {
        const name = await encryptUtf8ToEncString(field.name, keyB64, randomBytes);
        if (field.type === 3) {
          assertValidLinkedId(cipherType, field.linkedId);
          return { name, value: null, type: 3 as const, linkedId: field.linkedId! };
        }
        if (field.value === null) {
          throw new TypeError("Non-linked custom fields require a value");
        }
        return {
          name,
          value: await encryptUtf8ToEncString(
            field.type === 2 ? canonicalBooleanValue(field.value) : String(field.value),
            keyB64,
            randomBytes,
          ),
          type: field.type,
        };
      }),
  );
}

async function buildIdentityCipherRequest(
  input: IdentityCipherCreateInput & { readonly encryptedKey?: string },
): Promise<IdentityCipherCreateRequest> {
  const randomBytes = input.randomBytes ?? secureRandomBytes;
  const encryptionKeyB64 = await personalEncryptionKeyB64(input);
  const name = input.name.trim();
  const title = input.title?.trim() ?? "";
  const firstName = input.firstName.trim();
  const middleName = input.middleName?.trim() ?? "";
  const lastName = input.lastName.trim();
  const username = input.username?.trim() ?? "";
  const company = input.company?.trim() ?? "";
  const ssn = input.ssn?.trim() ?? "";
  const passportNumber = input.passportNumber?.trim() ?? "";
  const licenseNumber = input.licenseNumber?.trim() ?? "";
  const email = input.email.trim();
  const phone = input.phone.trim();
  const address1 = input.address1.trim();
  const address2 = input.address2?.trim() ?? "";
  const address3 = input.address3?.trim() ?? "";
  const city = input.city?.trim() ?? "";
  const state = input.state?.trim() ?? "";
  const postalCode = input.postalCode?.trim() ?? "";
  const country = input.country?.trim() ?? "";
  const notes = input.notes.trim();
  const encryptOptional = (value: string) =>
    value ? encryptUtf8ToEncString(value, encryptionKeyB64, randomBytes) : Promise.resolve(null);

  return {
    type: 4,
    folderId: input.folderId?.trim() || null,
    organizationId: null,
    ...(input.encryptedKey ? { key: input.encryptedKey } : {}),
    name: await encryptUtf8ToEncString(name, encryptionKeyB64, randomBytes),
    notes: await encryptOptional(notes),
    favorite: input.favorite ?? false,
    reprompt: input.reprompt ? 1 : 0,
    identity: {
      title: await encryptOptional(title),
      firstName: await encryptOptional(firstName),
      middleName: await encryptOptional(middleName),
      lastName: await encryptOptional(lastName),
      address1: await encryptOptional(address1),
      address2: await encryptOptional(address2),
      address3: await encryptOptional(address3),
      city: await encryptOptional(city),
      state: await encryptOptional(state),
      postalCode: await encryptOptional(postalCode),
      country: await encryptOptional(country),
      company: await encryptOptional(company),
      email: await encryptOptional(email),
      phone: await encryptOptional(phone),
      ssn: await encryptOptional(ssn),
      username: await encryptOptional(username),
      passportNumber: await encryptOptional(passportNumber),
      licenseNumber: await encryptOptional(licenseNumber),
    },
    fields: await buildEncryptedCustomFields(
      input.fields ?? [],
      encryptionKeyB64,
      randomBytes,
      "identity",
    ),
    passwordHistory: [],
  };
}

async function personalEncryptionKeyB64(input: {
  readonly userKeyB64: string;
  readonly encryptedKey?: string;
}): Promise<string> {
  return input.encryptedKey
    ? bytesToBase64(
        await decryptEncStringToBytes(input.encryptedKey, base64ToBytes(input.userKeyB64)),
      )
    : input.userKeyB64;
}

const cardLinkedIds: ReadonlySet<number> = numericEnumValues(CardLinkedId);
const identityLinkedIds: ReadonlySet<number> = numericEnumValues(IdentityLinkedId);

function assertValidLinkedId(
  cipherType: "card" | "identity" | "secure-note",
  linkedId: number | undefined,
): void {
  const valid = typeof linkedId === "number" && Number.isInteger(linkedId) && (
    cipherType === "card"
      ? cardLinkedIds.has(linkedId)
      : cipherType === "identity" && identityLinkedIds.has(linkedId)
  );
  if (!valid) {
    throw new TypeError("Linked field target is not valid for this personal cipher type");
  }
}

function numericEnumValues(value: object): ReadonlySet<number> {
  return new Set(Object.values(value).filter((entry): entry is number => typeof entry === "number"));
}

function secureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
