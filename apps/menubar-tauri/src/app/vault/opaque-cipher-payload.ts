import type { LoginCipherCreateRequest } from "../../bitwarden-api/bitwarden-api";

export type OpaqueCipherPayload = Readonly<Record<string, unknown>>;

export interface LoginCollectionAssociations {
  readonly uris?: readonly (number | null | undefined)[];
  readonly fields?: readonly (number | null | undefined)[];
}

export type RetainedPersonalCipherType = "card" | "identity" | "secure-note";

export interface OpaqueArrayAssociation {
  readonly path: readonly ["Fields"];
  readonly editedToSource: readonly (number | null)[];
}

export interface PreservedCipherOwnership {
  readonly organizationId: string | null;
  readonly collectionIds: readonly string[];
}

export interface PreservedCipherMutation {
  readonly cipherType: RetainedPersonalCipherType;
  readonly preserved: OpaqueCipherPayload;
  readonly edited: OpaqueCipherPayload;
  readonly ownership: PreservedCipherOwnership;
  readonly associations: readonly OpaqueArrayAssociation[];
}

export interface PreservedCipherPreflight {
  readonly cipherType: RetainedPersonalCipherType;
  readonly preserved: unknown;
  readonly ownership: PreservedCipherOwnership;
  readonly renderedEncryptedKey?: unknown;
}

export interface PreflightedPreservedCipher {
  readonly preserved: OpaqueCipherPayload;
  readonly encryptedKey?: string;
}

const invalidPayloadMessage = "Invalid opaque cipher payload";
const collectionPreservationMessage = "Unable to safely preserve opaque Login collection data";
const historyPreservationMessage = "Unable to safely preserve opaque password history";
const personalPreservationMessage = "Unable to safely preserve opaque personal cipher data";
const personalFieldPreservationMessage = "Unable to safely preserve opaque personal cipher fields";

const loginCanonicalKeys = new Map<string, string>([
  ["fido2credentials", "fido2Credentials"],
]);
const uriCanonicalKeys = new Map<string, string>([
  ["uri", "uri"],
  ["urichecksum", "uriChecksum"],
  ["match", "match"],
]);
const loginFieldCanonicalKeys = new Map<string, string>([
  ["name", "name"],
  ["value", "value"],
  ["type", "type"],
]);
const personalFieldCanonicalKeys = new Map<string, string>([
  ...loginFieldCanonicalKeys,
  ["linkedid", "linkedId"],
]);

const commonPersonalCanonicalKeys = new Map<string, string>([
  ["type", "type"],
  ["folderid", "folderId"],
  ["name", "name"],
  ["notes", "notes"],
  ["favorite", "favorite"],
  ["reprompt", "reprompt"],
  ["lastknownrevisiondate", "lastKnownRevisionDate"],
]);
const cardCanonicalKeys = new Map<string, string>([
  ["cardholdername", "cardholderName"],
  ["brand", "brand"],
  ["number", "number"],
  ["expmonth", "expMonth"],
  ["expyear", "expYear"],
  ["code", "code"],
]);
const identityCanonicalKeys = new Map<string, string>([
  ["title", "title"],
  ["firstname", "firstName"],
  ["middlename", "middleName"],
  ["lastname", "lastName"],
  ["address1", "address1"],
  ["address2", "address2"],
  ["address3", "address3"],
  ["city", "city"],
  ["state", "state"],
  ["postalcode", "postalCode"],
  ["country", "country"],
  ["company", "company"],
  ["email", "email"],
  ["phone", "phone"],
  ["ssn", "ssn"],
  ["username", "username"],
  ["passportnumber", "passportNumber"],
  ["licensenumber", "licenseNumber"],
]);
const secureNoteCanonicalKeys = new Map<string, string>([["type", "type"]]);

export function retainOpaqueCipherPayload(source: unknown): OpaqueCipherPayload {
  const retained = cloneJsonValue(source, new WeakSet());
  if (!isPlainRecord(retained)) {
    throw new TypeError(invalidPayloadMessage);
  }
  return retained;
}

export function preflightPreservedCipherUpdate(
  input: PreservedCipherPreflight,
): PreflightedPreservedCipher {
  const preserved = retainOpaqueCipherPayload(input.preserved);
  const specification = personalCipherSpecification(input.cipherType);

  assertPersonalOwnership(input.ownership, preserved);
  assertUniqueNormalizedKeys(preserved, new Set(["organizationid", "collectionids"]));
  assertCipherType(preserved, specification.type);
  for (const typeKey of ["login", "card", "identity", "securenote"] as const) {
    const active = ownDataEntries(preserved).some(
      ([key, value]) => normalizeKey(key) === typeKey && value !== null,
    );
    if (active !== (typeKey === specification.normalizedKey)) {
      throw new Error(personalPreservationMessage);
    }
  }

  const preservedTypeRecord = requiredUniqueRecordProperty(
    preserved,
    specification.normalizedKey,
    personalPreservationMessage,
  );
  assertUniqueNormalizedKeys(preservedTypeRecord);
  const retainedFields = optionalUniqueRecordArrayProperty(
    preserved,
    "fields",
    personalFieldPreservationMessage,
  );
  retainedFields?.forEach((field) => assertUniqueNormalizedKeys(field));

  const preservedKeyValue = uniqueCaseInsensitiveValue(
    preserved,
    "key",
    personalPreservationMessage,
  );
  const preservedKey = preservedKeyValue === null ? undefined : preservedKeyValue;
  const renderedKey = input.renderedEncryptedKey;
  if (preservedKey !== undefined || renderedKey !== undefined) {
    if (
      typeof preservedKey !== "string" ||
      preservedKey.length === 0 ||
      typeof renderedKey !== "string" ||
      renderedKey.length === 0 ||
      preservedKey !== renderedKey
    ) {
      throw new Error(personalPreservationMessage);
    }
    return { preserved, encryptedKey: preservedKey };
  }
  return { preserved };
}

export function mergePreservedCipherUpdate(
  mutation: PreservedCipherMutation,
): OpaqueCipherPayload {
  const edited = retainOpaqueCipherPayload(mutation.edited);
  assertUniqueNormalizedKeys(edited);
  const renderedEditedKey = uniqueCaseInsensitiveValue(edited, "key", personalPreservationMessage);
  const { preserved } = preflightPreservedCipherUpdate({
    cipherType: mutation.cipherType,
    preserved: mutation.preserved,
    ownership: mutation.ownership,
    ...(renderedEditedKey === undefined ? {} : { renderedEncryptedKey: renderedEditedKey }),
  });
  const specification = personalCipherSpecification(mutation.cipherType);

  assertCipherType(edited, specification.type);

  for (const typeKey of ["card", "identity", "securenote"] as const) {
    const present = ownDataEntries(edited).some(([key]) => normalizeKey(key) === typeKey);
    if (present !== (typeKey === specification.normalizedKey)) {
      throw new Error(personalPreservationMessage);
    }
  }

  const preservedTypeRecord = requiredUniqueRecordProperty(
    preserved,
    specification.normalizedKey,
    personalPreservationMessage,
  );
  const editedTypeRecord = requiredUniqueRecordProperty(
    edited,
    specification.normalizedKey,
    personalPreservationMessage,
  );
  assertOnlyCanonicalKeys(editedTypeRecord, specification.canonicalKeys);
  assertUniqueNormalizedKeys(editedTypeRecord);

  const retainedFields = optionalUniqueRecordArrayProperty(
    preserved,
    "fields",
    personalFieldPreservationMessage,
  );
  const editedFields = requiredUniqueRecordArrayProperty(
    edited,
    "fields",
    personalFieldPreservationMessage,
  );
  const fieldAssociation = uniqueFieldAssociation(mutation.associations);

  const allowedEditedTopLevel = new Set([
    ...commonPersonalCanonicalKeys.keys(),
    "organizationid",
    "collectionids",
    "key",
    "fields",
    "passwordhistory",
    specification.normalizedKey,
  ]);
  for (const [key] of ownDataEntries(edited)) {
    if (!allowedEditedTopLevel.has(normalizeKey(key))) {
      throw new Error(personalPreservationMessage);
    }
  }

  const replacedTopLevel = new Set([
    ...commonPersonalCanonicalKeys.keys(),
    "organizationid",
    "collectionids",
    "key",
    "data",
    "fields",
    "login",
    "card",
    "identity",
    "securenote",
  ]);
  const merged = createRecord();
  for (const [key, value] of ownDataEntries(preserved)) {
    if (!replacedTopLevel.has(normalizeKey(key))) {
      setDataProperty(merged, key, value);
    }
  }
  for (const [key, value] of ownDataEntries(edited)) {
    const normalized = normalizeKey(key);
    const canonical = commonPersonalCanonicalKeys.get(normalized);
    if (canonical) {
      setDataProperty(merged, canonical, value);
    }
  }

  const preservedKey = uniqueCaseInsensitiveValue(preserved, "key", personalPreservationMessage);
  const editedKey = uniqueCaseInsensitiveValue(edited, "key", personalPreservationMessage);
  if (preservedKey !== undefined && editedKey !== undefined && preservedKey !== editedKey) {
    throw new Error(personalPreservationMessage);
  }
  const key = preservedKey ?? editedKey;
  if (key !== undefined) {
    if (typeof key !== "string") {
      throw new Error(personalPreservationMessage);
    }
    setDataProperty(merged, "key", key);
  }

  setDataProperty(merged, "organizationId", mutation.ownership.organizationId);
  setDataProperty(merged, "collectionIds", copyStringArray(mutation.ownership.collectionIds));
  setDataProperty(
    merged,
    specification.canonicalKey,
    mergeEditedRecord(
      preservedTypeRecord,
      editedTypeRecord,
      specification.canonicalKeys,
      personalPreservationMessage,
    ),
  );
  setDataProperty(
    merged,
    "fields",
    mergeRecordArray(
      retainedFields,
      editedFields,
      personalFieldCanonicalKeys,
      fieldAssociation?.editedToSource,
      personalFieldPreservationMessage,
    ),
  );

  return retainOpaqueCipherPayload(merged);
}

export function mergePreservedLoginUpdate(
  preserved: OpaqueCipherPayload,
  edited: LoginCipherCreateRequest,
  ownership: { readonly organizationId: string | null; readonly collectionIds: readonly string[] },
  context?: {
    readonly passwordChanged?: boolean;
    readonly collectionAssociations?: LoginCollectionAssociations;
  },
): LoginCipherCreateRequest & Record<string, unknown> {
  const retained = preserved;
  const preservedLogin = combinedRecordProperty(retained, "login", collectionPreservationMessage);
  const retainedUris = optionalRecordArrayProperty(
    preservedLogin,
    "uris",
    collectionPreservationMessage,
  );
  const retainedFields = optionalRecordArrayProperty(
    retained,
    "fields",
    collectionPreservationMessage,
  );
  const editedLoginWithoutUris = recordWithoutKeys(edited.login, new Set(["uris"]));
  const login = mergeEditedRecord(preservedLogin, editedLoginWithoutUris, loginCanonicalKeys);
  removeCaseInsensitiveKey(login, "uris");
  setDataProperty(
    login,
    "uris",
    mergeRecordArray(
      retainedUris,
      edited.login.uris,
      uriCanonicalKeys,
      context?.collectionAssociations?.uris,
    ),
  );

  const editedTopLevelKeys = new Set([
    ...ownDataEntries(edited).map(([key]) => normalizeKey(key)),
    "collectionids",
    "data",
  ]);
  const merged = createRecord();
  for (const [key, value] of ownDataEntries(retained)) {
    if (!editedTopLevelKeys.has(normalizeKey(key))) {
      setDataProperty(merged, key, value);
    }
  }
  for (const [key, value] of ownDataEntries(edited)) {
    if (!["login", "fields", "passwordhistory", "organizationid"].includes(normalizeKey(key))) {
      setDataProperty(merged, key, value);
    }
  }

  setDataProperty(merged, "organizationId", ownership.organizationId);
  setDataProperty(merged, "collectionIds", copyStringArray(ownership.collectionIds));
  setDataProperty(merged, "login", login);
  setDataProperty(
    merged,
    "fields",
    mergeRecordArray(
      retainedFields,
      edited.fields,
      loginFieldCanonicalKeys,
      context?.collectionAssociations?.fields,
    ),
  );
  setDataProperty(
    merged,
    "passwordHistory",
    mergePasswordHistory(retained, edited.passwordHistory, context?.passwordChanged),
  );

  return freezeKnownJsonGraph(merged) as LoginCipherCreateRequest & Record<string, unknown>;
}

function cloneJsonValue(value: unknown, ancestors: WeakSet<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return value;
    }
    throw new TypeError(invalidPayloadMessage);
  }
  if (typeof value !== "object") {
    throw new TypeError(invalidPayloadMessage);
  }
  if (ancestors.has(value)) {
    throw new TypeError(invalidPayloadMessage);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (!hasIntrinsicPrototype(value, Array, Array.prototype)) {
        throw new TypeError(invalidPayloadMessage);
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      if (!lengthDescriptor || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number") {
        throw new TypeError(invalidPayloadMessage);
      }
      const length = lengthDescriptor.value;
      validateArrayShape(value, length);
      const clone = new Array<unknown>(length);
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) {
          throw new TypeError(invalidPayloadMessage);
        }
        Object.defineProperty(clone, String(index), {
          value: cloneJsonValue(descriptor.value, ancestors),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return Object.freeze(clone);
    }
    if (!isPlainRecord(value)) {
      throw new TypeError(invalidPayloadMessage);
    }

    const clone = createRecord();
    for (const [key, entry] of ownDataEntries(value)) {
      setDataProperty(clone, key, cloneJsonValue(entry, ancestors));
    }
    return Object.freeze(clone);
  } finally {
    ancestors.delete(value);
  }
}

function validateArrayShape(value: readonly unknown[], length: number): void {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1) {
    throw new TypeError(invalidPayloadMessage);
  }
  for (const key of keys) {
    if (typeof key !== "string" || (key !== "length" && !isArrayIndex(key, length))) {
      throw new TypeError(invalidPayloadMessage);
    }
  }
}

function isArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key;
}

function mergeRecordArray(
  retained: readonly Record<string, unknown>[] | undefined,
  edited: readonly Record<string, unknown>[],
  canonicalKeys: ReadonlyMap<string, string>,
  associations?: readonly (number | null | undefined)[],
  errorMessage = collectionPreservationMessage,
): readonly Record<string, unknown>[] {
  if (!retained) {
    return edited;
  }

  const opaqueRetainedIndices = retained
    .map((record, index) => hasNonAllowlistedKeys(record, canonicalKeys) ? index : -1)
    .filter((index) => index >= 0);
  if (opaqueRetainedIndices.length === 0) {
    return edited;
  }

  if (!associations || associations.length !== edited.length) {
    throw new Error(errorMessage);
  }
  const merged: Record<string, unknown>[] = [];
  const usedRetainedIndices = new Set<number>();
  for (let index = 0; index < edited.length; index += 1) {
    const editedRecord = edited[index];
    const retainedIndex = associations[index];
    if (!editedRecord) {
      throw new Error(errorMessage);
    }
    if (retainedIndex == null) {
      merged.push(editedRecord);
      continue;
    }
    if (
      !Number.isInteger(retainedIndex) ||
      retainedIndex < 0 ||
      retainedIndex >= retained.length ||
      usedRetainedIndices.has(retainedIndex)
    ) {
      throw new Error(errorMessage);
    }
    usedRetainedIndices.add(retainedIndex);
    merged.push(mergeEditedRecord(retained[retainedIndex]!, editedRecord, canonicalKeys, errorMessage));
  }
  for (const retainedIndex of opaqueRetainedIndices) {
    if (!usedRetainedIndices.has(retainedIndex)) {
      throw new Error(errorMessage);
    }
  }
  return merged;
}

function hasNonAllowlistedKeys(
  record: Record<string, unknown>,
  canonicalKeys: ReadonlyMap<string, string>,
): boolean {
  return ownDataEntries(record).some(([key]) => !canonicalKeys.has(normalizeKey(key)));
}

function mergeEditedRecord(
  retained: Record<string, unknown>,
  edited: Record<string, unknown>,
  canonicalKeys: ReadonlyMap<string, string>,
  errorMessage = collectionPreservationMessage,
): Record<string, unknown> {
  const editedKeys = new Set(ownDataEntries(edited).map(([key]) => normalizeKey(key)));
  const merged = createRecord();
  for (const [key, value] of ownDataEntries(retained)) {
    const normalized = normalizeKey(key);
    if (!editedKeys.has(normalized)) {
      const targetKey = canonicalKeys.get(normalized) ?? key;
      if (Object.hasOwn(merged, targetKey)) {
        throw new Error(errorMessage);
      }
      setDataProperty(merged, targetKey, value);
    }
  }
  for (const [key, value] of ownDataEntries(edited)) {
    const normalized = normalizeKey(key);
    removeCaseInsensitiveKey(merged, normalized);
    setDataProperty(merged, canonicalKeys.get(normalized) ?? key, value);
  }
  return merged;
}

function personalCipherSpecification(type: RetainedPersonalCipherType) {
  switch (type) {
    case "card":
      return { type: 3, normalizedKey: "card", canonicalKey: "card", canonicalKeys: cardCanonicalKeys } as const;
    case "identity":
      return { type: 4, normalizedKey: "identity", canonicalKey: "identity", canonicalKeys: identityCanonicalKeys } as const;
    case "secure-note":
      return { type: 2, normalizedKey: "securenote", canonicalKey: "secureNote", canonicalKeys: secureNoteCanonicalKeys } as const;
  }
}

function assertPersonalOwnership(
  ownership: PreservedCipherOwnership,
  preserved: OpaqueCipherPayload,
): void {
  if (ownership.organizationId !== null || ownership.collectionIds.length !== 0) {
    throw new Error(personalPreservationMessage);
  }
  for (const [key, value] of ownDataEntries(preserved)) {
    const normalized = normalizeKey(key);
    if (normalized === "organizationid" && value !== null) {
      throw new Error(personalPreservationMessage);
    }
    if (normalized === "collectionids" && !isExactEmptyArray(value)) {
      throw new Error(personalPreservationMessage);
    }
  }
}

function assertCipherType(record: OpaqueCipherPayload, expected: number): void {
  const value = uniqueCaseInsensitiveValue(record, "type", personalPreservationMessage);
  if (value !== expected) {
    throw new Error(personalPreservationMessage);
  }
}

function assertOnlyCanonicalKeys(
  record: Record<string, unknown>,
  canonicalKeys: ReadonlyMap<string, string>,
): void {
  for (const [key] of ownDataEntries(record)) {
    if (!canonicalKeys.has(normalizeKey(key))) {
      throw new Error(personalPreservationMessage);
    }
  }
}

function assertUniqueNormalizedKeys(
  record: Record<string, unknown>,
  allowedDuplicates: ReadonlySet<string> = new Set(),
): void {
  const seen = new Set<string>();
  for (const [key] of ownDataEntries(record)) {
    const normalized = normalizeKey(key);
    if (seen.has(normalized) && !allowedDuplicates.has(normalized)) {
      throw new Error(personalPreservationMessage);
    }
    seen.add(normalized);
  }
}

function uniqueCaseInsensitiveValue(
  record: Record<string, unknown>,
  normalizedName: string,
  errorMessage: string,
): unknown {
  const values = ownDataEntries(record)
    .filter(([key]) => normalizeKey(key) === normalizedName)
    .map(([, value]) => value);
  if (values.length > 1) {
    throw new Error(errorMessage);
  }
  return values[0];
}

function requiredUniqueRecordProperty(
  record: Record<string, unknown>,
  normalizedName: string,
  errorMessage: string,
): Record<string, unknown> {
  const value = uniqueCaseInsensitiveValue(record, normalizedName, errorMessage);
  if (!isPlainRecord(value)) {
    throw new Error(errorMessage);
  }
  return value;
}

function requiredUniqueRecordArrayProperty(
  record: Record<string, unknown>,
  normalizedName: string,
  errorMessage: string,
): readonly Record<string, unknown>[] {
  const value = optionalUniqueRecordArrayProperty(record, normalizedName, errorMessage);
  if (!value) {
    throw new Error(errorMessage);
  }
  return value;
}

function optionalUniqueRecordArrayProperty(
  record: Record<string, unknown>,
  normalizedName: string,
  errorMessage: string,
): readonly Record<string, unknown>[] | undefined {
  const value = uniqueCaseInsensitiveValue(record, normalizedName, errorMessage);
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  const records: Record<string, unknown>[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isPlainRecord(entry)) {
      throw new Error(errorMessage);
    }
    assertUniqueNormalizedKeys(entry);
    records.push(entry);
  }
  return records;
}

function uniqueFieldAssociation(
  associations: readonly OpaqueArrayAssociation[],
): OpaqueArrayAssociation | undefined {
  if (associations.length > 1) {
    throw new Error(personalFieldPreservationMessage);
  }
  const association = associations[0];
  if (!association) {
    return undefined;
  }
  if (
    association.path.length !== 1 ||
    association.path[0] !== "Fields" ||
    Object.getPrototypeOf(association.editedToSource) !== Array.prototype
  ) {
    throw new Error(personalFieldPreservationMessage);
  }
  return association;
}

function isExactEmptyArray(value: unknown): value is readonly never[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return false;
  }
  const length = Object.getOwnPropertyDescriptor(value, "length");
  return Boolean(length && "value" in length && length.value === 0 && Reflect.ownKeys(value).length === 1);
}

function mergePasswordHistory(
  payload: OpaqueCipherPayload,
  edited: LoginCipherCreateRequest["passwordHistory"],
  passwordChanged?: boolean,
): readonly unknown[] {
  if (edited.length > 5) {
    throw new Error(historyPreservationMessage);
  }
  const preserved = optionalArrayProperty(payload, "passwordhistory", historyPreservationMessage);
  if (!preserved) {
    return edited;
  }

  const recognizedEntries: Record<string, unknown>[] = [];
  for (const entry of preserved) {
    if (
      isPlainRecord(entry) &&
      typeof caseInsensitiveProperty(entry, "password") === "string" &&
      typeof caseInsensitiveProperty(entry, "lastuseddate") === "string"
    ) {
      recognizedEntries.push(entry);
    }
  }

  let prepended: boolean;
  if (passwordChanged === true) {
    prepended = true;
    if (edited.length !== Math.min(recognizedEntries.length + 1, 5)) {
      throw new Error(historyPreservationMessage);
    }
  } else if (passwordChanged === false) {
    prepended = false;
    if (edited.length !== recognizedEntries.length) {
      throw new Error(historyPreservationMessage);
    }
  } else if (edited.length === recognizedEntries.length) {
    prepended = false;
  } else if (recognizedEntries.length < 5 && edited.length === recognizedEntries.length + 1) {
    prepended = true;
  } else {
    throw new Error(historyPreservationMessage);
  }

  if (!prepended) {
    if (preserved.length > 5) {
      throw new Error(historyPreservationMessage);
    }
    return preserved;
  }
  const inserted = edited[0];
  if (!inserted) {
    throw new Error(historyPreservationMessage);
  }
  const result: unknown[] = [inserted];
  const retainedRecognizedCount = Math.min(recognizedEntries.length, 4);
  let seenRecognized = 0;
  for (const entry of preserved) {
    if (recognizedEntries[seenRecognized] === entry) {
      if (seenRecognized < retainedRecognizedCount) {
        result.push(entry);
      }
      seenRecognized += 1;
    } else {
      result.push(entry);
    }
  }
  if (result.length > 5) {
    throw new Error(historyPreservationMessage);
  }
  return result;
}

function combinedRecordProperty(
  record: Record<string, unknown>,
  normalizedName: string,
  errorMessage: string,
): Record<string, unknown> {
  const combined = createRecord();
  let found = false;
  for (const [key, value] of ownDataEntries(record)) {
    if (normalizeKey(key) !== normalizedName) {
      continue;
    }
    found = true;
    if (!isPlainRecord(value)) {
      throw new Error(errorMessage);
    }
    for (const [childKey, childValue] of ownDataEntries(value)) {
      setDataProperty(combined, childKey, childValue);
    }
  }
  return found ? combined : createRecord();
}

function optionalRecordArrayProperty(
  record: Record<string, unknown>,
  normalizedName: string,
  errorMessage: string,
): readonly Record<string, unknown>[] | undefined {
  const value = caseInsensitiveProperty(record, normalizedName);
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => !isPlainRecord(entry))) {
    throw new Error(errorMessage);
  }
  return value as readonly Record<string, unknown>[];
}

function optionalArrayProperty(
  record: Record<string, unknown>,
  normalizedName: string,
  errorMessage: string,
): readonly unknown[] | undefined {
  const value = caseInsensitiveProperty(record, normalizedName);
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  return value;
}

function recordWithoutKeys(
  record: Record<string, unknown>,
  excluded: ReadonlySet<string>,
): Record<string, unknown> {
  const result = createRecord();
  for (const [key, value] of ownDataEntries(record)) {
    if (!excluded.has(normalizeKey(key))) {
      setDataProperty(result, key, value);
    }
  }
  return result;
}

function copyStringArray(values: readonly string[]): readonly string[] {
  const copy: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    copy.push(values[index]!);
  }
  return copy;
}

function createRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>;
}

function freezeKnownJsonGraph<T>(value: T, visited = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  if (visited.has(value)) {
    throw new TypeError(invalidPayloadMessage);
  }
  visited.add(value);
  if (Array.isArray(value)) {
    if (!hasIntrinsicPrototype(value, Array, Array.prototype)) {
      throw new TypeError(invalidPayloadMessage);
    }
    validateArrayShape(value, value.length);
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError(invalidPayloadMessage);
      }
      freezeKnownJsonGraph(descriptor.value, visited);
    }
  } else {
    for (const [, child] of ownDataEntries(value as Record<string, unknown>)) {
      freezeKnownJsonGraph(child, visited);
    }
  }
  visited.delete(value);
  return Object.freeze(value);
}

function setDataProperty(record: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function removeCaseInsensitiveKey(record: Record<string, unknown>, normalizedName: string): void {
  for (const [key] of ownDataEntries(record)) {
    if (normalizeKey(key) === normalizedName) {
      Reflect.deleteProperty(record, key);
    }
  }
}

function caseInsensitiveProperty(record: Record<string, unknown>, normalizedName: string): unknown {
  const key = caseInsensitiveOwnKey(record, normalizedName);
  return key ? ownDataValue(record, key) : undefined;
}

function caseInsensitiveOwnKey(
  record: Record<string, unknown>,
  normalizedName: string,
): string | undefined {
  return ownDataEntries(record).find(([key]) => normalizeKey(key) === normalizedName)?.[0];
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError(invalidPayloadMessage);
  }
  return descriptor.value;
}

function ownDataEntries(record: object): readonly [string, unknown][] {
  const entries: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string") {
      throw new TypeError(invalidPayloadMessage);
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw new TypeError(invalidPayloadMessage);
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.getPrototypeOf(value) === null ||
    hasIntrinsicPrototype(value, Object, Object.prototype);
}

function hasIntrinsicPrototype(
  value: object,
  localConstructor: Function,
  localPrototype: object,
): boolean {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === localPrototype) {
    return true;
  }
  if (prototype === null) {
    return false;
  }

  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  if (
    !constructor ||
    !("value" in constructor) ||
    typeof constructor.value !== "function" ||
    constructor.value.prototype !== prototype
  ) {
    return false;
  }

  return Function.prototype.toString.call(constructor.value) ===
    Function.prototype.toString.call(localConstructor);
}

function normalizeKey(key: string): string {
  return key.toLowerCase();
}
