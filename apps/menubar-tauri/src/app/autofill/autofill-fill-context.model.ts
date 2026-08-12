import type {
  AutoFillCandidateGroup,
  AutoFillSecretField,
} from "./autofill-candidate.service";
import type { AutoFillRepromptScope } from "./autofill-native.host";
import type { AutoFillAgentSession } from "./autofill-native.host";

export type DetectedFieldKind = "username" | "email" | "password" | "one-time-code" | "unknown";
export type FieldConfidence = "high" | "medium" | "low";
export type DetectedFillMode = "field" | "form" | "choose";

export interface AutoFillApplicationContext {
  readonly bundleId: string;
  readonly appName: string;
}

export interface LayeredAutoFillContext {
  readonly application: AutoFillApplicationContext;
  readonly fillContext: LiveAutoFillContext | null;
}

export interface LiveAutoFillContext {
  readonly bundleId: string;
  readonly appName: string;
  readonly fillContextToken: string;
  readonly focusedField: {
    readonly kind: DetectedFieldKind;
    readonly confidence: FieldConfidence;
  };
  readonly action: {
    readonly mode: DetectedFillMode;
    readonly fields: readonly AutoFillSecretField[];
  };
}

export interface ContextualCandidateAuthorization {
  readonly contextToken: string;
  readonly requiresMismatchConfirmation: boolean;
}

export interface ContextualCandidate {
  readonly cipherId: string;
  readonly displayName: string;
  readonly username: string;
  readonly group: AutoFillCandidateGroup;
  readonly reason: string;
  readonly availableFields: readonly AutoFillSecretField[];
  readonly authorizations: ReadonlyMap<AutoFillSecretField, ContextualCandidateAuthorization>;
}

export function immutableAuthorizationMap(
  entries: Iterable<readonly [AutoFillSecretField, ContextualCandidateAuthorization]>,
): ReadonlyMap<AutoFillSecretField, ContextualCandidateAuthorization> {
  return new ImmutableAuthorizationMap(entries);
}

class ImmutableAuthorizationMap implements ReadonlyMap<AutoFillSecretField, ContextualCandidateAuthorization> {
  readonly #values: Map<AutoFillSecretField, ContextualCandidateAuthorization>;

  constructor(entries: Iterable<readonly [AutoFillSecretField, ContextualCandidateAuthorization]>) {
    try {
      this.#values = new Map([...entries].map(([field, authorization]) => {
        const value = exactRecord(authorization, ["contextToken", "requiresMismatchConfirmation"]);
        if (typeof value["requiresMismatchConfirmation"] !== "boolean") throw new Error("invalid authorization");
        return [decodeAutoFillField(field), Object.freeze({
          contextToken: boundedString(value["contextToken"], 512, false),
          requiresMismatchConfirmation: value["requiresMismatchConfirmation"],
        })];
      }));
    } catch {
      throw new Error("invalid authorization");
    }
    Object.freeze(this);
  }

  get size(): number { return this.#values.size; }
  get(field: AutoFillSecretField): ContextualCandidateAuthorization | undefined { return this.#values.get(field); }
  has(field: AutoFillSecretField): boolean { return this.#values.has(field); }
  entries(): MapIterator<[AutoFillSecretField, ContextualCandidateAuthorization]> { return this.#values.entries(); }
  keys(): MapIterator<AutoFillSecretField> { return this.#values.keys(); }
  values(): MapIterator<ContextualCandidateAuthorization> { return this.#values.values(); }
  [Symbol.iterator](): MapIterator<[AutoFillSecretField, ContextualCandidateAuthorization]> {
    return this.#values[Symbol.iterator]();
  }
  forEach(
    callbackfn: (
      value: ContextualCandidateAuthorization,
      key: AutoFillSecretField,
      map: ReadonlyMap<AutoFillSecretField, ContextualCandidateAuthorization>,
    ) => void,
    thisArg?: unknown,
  ): void {
    this.#values.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }
}

export interface DetectedFillAuthorization {
  readonly scope: AutoFillRepromptScope;
  readonly mismatchConfirmed: boolean;
}

export interface DetectedFillRequest {
  readonly intent: "auto" | "explicit";
  readonly fillContextToken: string;
  readonly authorizations: readonly DetectedFillAuthorization[];
  readonly repromptReceipt?: string;
}

export type DetectedFillErrorCode =
  | "unauthorized"
  | "invalid-request"
  | "stale-context"
  | "reprompt-failed"
  | "secret-release-failed";
export type DetectedFillPartialCode = "stale-context" | "fill-failed";

export type DetectedFillOutcome =
  | { readonly status: "success"; readonly fields: readonly AutoFillSecretField[] }
  | {
    readonly status: "partial";
    readonly filled: readonly AutoFillSecretField[];
    readonly failed: AutoFillSecretField;
    readonly code: DetectedFillPartialCode;
  }
  | { readonly status: "error"; readonly code: DetectedFillErrorCode };

const FIELD_ORDER: readonly AutoFillSecretField[] = ["username", "password", "totp"];
const FIELD_KINDS = new Set<DetectedFieldKind>([
  "username", "email", "password", "one-time-code", "unknown",
]);
const CONFIDENCES = new Set<FieldConfidence>(["high", "medium", "low"]);
const MODES = new Set<DetectedFillMode>(["field", "form", "choose"]);
const ERROR_CODES = new Set<DetectedFillErrorCode>([
  "unauthorized", "invalid-request", "stale-context", "reprompt-failed", "secret-release-failed",
]);
const PARTIAL_CODES = new Set<DetectedFillPartialCode>(["stale-context", "fill-failed"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function decodeAutoFillApplicationContext(input: unknown): AutoFillApplicationContext {
  try {
    const value = exactRecord(input, ["bundleId", "appName"]);
    return Object.freeze({
      bundleId: boundedString(value["bundleId"], 255, false),
      appName: boundedString(value["appName"], 255, false),
    });
  } catch {
    throw new Error("invalid AutoFill application context");
  }
}

export function decodeLiveAutoFillContext(input: unknown): LiveAutoFillContext {
  try {
    const value = exactRecord(input, ["bundleId", "appName", "fillContextToken", "focusedField", "action"]);
    const focusedField = exactRecord(value["focusedField"], ["kind", "confidence"]);
    const action = exactRecord(value["action"], ["mode", "fields"]);
    const kind = member(valueAt(focusedField, "kind"), FIELD_KINDS);
    const confidence = member(valueAt(focusedField, "confidence"), CONFIDENCES);
    const mode = member(valueAt(action, "mode"), MODES);
    const fields = canonicalFields(valueAt(action, "fields"), false);
    return Object.freeze({
      bundleId: boundedString(value["bundleId"], 255, false),
      appName: boundedString(value["appName"], 255, false),
      fillContextToken: uuid(value["fillContextToken"]),
      focusedField: Object.freeze({ kind, confidence }),
      action: Object.freeze({ mode, fields }),
    });
  } catch {
    throw new Error("invalid detected AutoFill context");
  }
}

export function projectAutoFillAgentSession(input: unknown): AutoFillAgentSession {
  try {
    const value = exactRecord(input, ["accountId", "generation", "vaultRevision"]);
    if (!Number.isSafeInteger(value["vaultRevision"]) || Number(value["vaultRevision"]) < 0) {
      throw new Error("invalid revision");
    }
    return Object.freeze({
      accountId: boundedString(value["accountId"], 512, false),
      generation: uuid(value["generation"]),
      vaultRevision: value["vaultRevision"] as number,
    });
  } catch {
    throw new Error("invalid AutoFill Agent session");
  }
}

export function projectContextualCandidate(input: unknown): ContextualCandidate {
  try {
    const value = exactRecord(input, [
      "cipherId", "displayName", "username", "group", "reason", "availableFields", "authorizations",
    ]);
    const fields = canonicalFields(value["availableFields"], true);
    const source = value["authorizations"];
    const plainMap = source instanceof Map && Object.getPrototypeOf(source) === Map.prototype;
    const immutableMap = source instanceof ImmutableAuthorizationMap
      && Object.getPrototypeOf(source) === ImmutableAuthorizationMap.prototype;
    if ((!plainMap && !immutableMap) || Reflect.ownKeys(source as object).length !== 0) {
      throw new Error("invalid authorization map");
    }
    const entries = fields.map((field) => {
      const authorization = source.get(field);
      if (authorization === undefined) throw new Error("missing authorization");
      return [field, authorization] as const;
    });
    if (source.size !== entries.length) throw new Error("unexpected authorization");
    return Object.freeze({
      cipherId: boundedString(value["cipherId"], 512, false),
      displayName: boundedString(value["displayName"], 2_048, true),
      username: boundedString(value["username"], 2_048, true),
      group: member(value["group"], new Set<AutoFillCandidateGroup>(["exact", "relevant", "other"])),
      reason: boundedString(value["reason"], 512, true),
      availableFields: fields,
      authorizations: immutableAuthorizationMap(entries),
    });
  } catch {
    throw new Error("invalid contextual AutoFill candidate");
  }
}

export function validateDetectedFillRequest(input: unknown): DetectedFillRequest {
  try {
    const value = exactRecordVariant(input, [
      ["fillContextToken", "authorizations"],
      ["fillContextToken", "authorizations", "repromptReceipt"],
    ]);
    const rawAuthorizations = snapshotDenseArray(value["authorizations"], 1, 3);
    const authorizations = rawAuthorizations.map((entry) => {
      const authorization = exactRecord(entry, ["scope", "mismatchConfirmed"]);
      const scopeValue = exactRecord(authorization["scope"], [
        "accountId", "candidateId", "field", "generation", "contextToken",
      ]);
      const field = decodeAutoFillField(scopeValue["field"]);
      if (typeof authorization["mismatchConfirmed"] !== "boolean") throw new Error("invalid mismatch");
      const scope: AutoFillRepromptScope = Object.freeze({
        accountId: boundedString(scopeValue["accountId"], 512, false),
        candidateId: boundedString(scopeValue["candidateId"], 512, false),
        field,
        generation: uuid(scopeValue["generation"]),
        contextToken: boundedString(scopeValue["contextToken"], 512, false),
      });
      return Object.freeze({ scope, mismatchConfirmed: authorization["mismatchConfirmed"] });
    });
    canonicalFields(authorizations.map(({ scope }) => scope.field), false);
    const first = authorizations[0].scope;
    if (authorizations.some(({ scope }) => scope.accountId !== first.accountId
      || scope.candidateId !== first.candidateId || scope.generation !== first.generation)
      || new Set(authorizations.map(({ scope }) => scope.contextToken)).size !== authorizations.length) {
      throw new Error("incompatible scopes");
    }
    const hasReceipt = Object.prototype.hasOwnProperty.call(value, "repromptReceipt");
    const receipt = hasReceipt ? boundedString(value["repromptReceipt"], 512, false) : undefined;
    return Object.freeze({
      fillContextToken: uuid(value["fillContextToken"]),
      authorizations: Object.freeze(authorizations),
      ...(receipt === undefined ? {} : { repromptReceipt: receipt }),
    });
  } catch {
    throw new Error("invalid detected fill request");
  }
}

export function validateAutoFillRepromptScopes(input: unknown): readonly AutoFillRepromptScope[] {
  try {
    const rawScopes = snapshotDenseArray(input, 1, 3);
    const scopes = rawScopes.map((entry) => {
      const scope = exactRecord(entry, ["accountId", "candidateId", "field", "generation", "contextToken"]);
      return Object.freeze({
        accountId: boundedString(scope["accountId"], 512, false),
        candidateId: boundedString(scope["candidateId"], 512, false),
        field: decodeAutoFillField(scope["field"]),
        generation: uuid(scope["generation"]),
        contextToken: boundedString(scope["contextToken"], 512, false),
      });
    });
    canonicalFields(scopes.map((scope) => scope.field), false);
    const first = scopes[0];
    if (scopes.some((scope) => scope.accountId !== first.accountId
      || scope.candidateId !== first.candidateId || scope.generation !== first.generation)
      || new Set(scopes.map((scope) => scope.contextToken)).size !== scopes.length) {
      throw new Error("incompatible scopes");
    }
    return Object.freeze(scopes);
  } catch {
    throw new Error("invalid AutoFill reprompt scopes");
  }
}

export function decodeDetectedFillOutcome(input: unknown): DetectedFillOutcome {
  try {
    const snapshot = snapshotObjectRecord(input);
    switch (snapshot["status"]) {
      case "success": {
        const value = exactRecord(snapshot, ["status", "fields"]);
        return Object.freeze({ status: "success", fields: canonicalFields(value["fields"], false) });
      }
      case "partial": {
        const value = exactRecord(snapshot, ["status", "filled", "failed", "code"]);
        const filled = canonicalFields(value["filled"], true);
        const failed = decodeAutoFillField(value["failed"]);
        const code = member(value["code"], PARTIAL_CODES);
        const failedIndex = FIELD_ORDER.indexOf(failed);
        if (filled.includes(failed)
            || filled.some((field) => FIELD_ORDER.indexOf(field) >= failedIndex)) {
          throw new Error("invalid partial order");
        }
        return Object.freeze({ status: "partial", filled, failed, code });
      }
      case "error": {
        const value = exactRecord(snapshot, ["status", "code"]);
        return Object.freeze({ status: "error", code: member(value["code"], ERROR_CODES) });
      }
      default:
        throw new Error("invalid status");
    }
  } catch {
    throw new Error("invalid detected fill outcome");
  }
}

export function contextsEqual(left: LiveAutoFillContext, right: LiveAutoFillContext): boolean {
  return left.bundleId === right.bundleId
    && left.appName === right.appName
    && left.fillContextToken === right.fillContextToken
    && left.focusedField.kind === right.focusedField.kind
    && left.focusedField.confidence === right.focusedField.confidence
    && left.action.mode === right.action.mode
    && left.action.fields.length === right.action.fields.length
    && left.action.fields.every((field, index) => field === right.action.fields[index]);
}

function canonicalFields(input: unknown, allowEmpty: boolean): readonly AutoFillSecretField[] {
  const fields = snapshotDenseArray(input, allowEmpty ? 0 : 1, 3).map(decodeAutoFillField);
  if (new Set(fields).size !== fields.length
      || fields.some((field, index) => FIELD_ORDER.indexOf(field) <= (index ? FIELD_ORDER.indexOf(fields[index - 1]) : -1))) {
    throw new Error("invalid field order");
  }
  return Object.freeze(fields);
}

function snapshotDenseArray(input: unknown, minimum: number, maximum: number): readonly unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
    throw new Error("invalid array");
  }
  const keys = Reflect.ownKeys(input);
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(input, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < minimum || lengthDescriptor.value > maximum) {
    throw new Error("invalid array length");
  }
  const length = lengthDescriptor.value as number;
  const expectedKeys = new Set<string>(["length", ...Array.from({ length }, (_, index) => String(index))]);
  if (keys.length !== expectedKeys.size
      || keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))) {
    throw new Error("invalid array keys");
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor)) throw new Error("invalid array descriptor");
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function decodeAutoFillField(input: unknown): AutoFillSecretField {
  if (input === "username" || input === "password" || input === "totp") return input;
  throw new Error("invalid secret field");
}

function uuid(input: unknown): string {
  const value = boundedString(input, 36, false);
  if (!UUID.test(value)) throw new Error("invalid UUID");
  return value;
}

function boundedString(input: unknown, maximum: number, allowEmpty: boolean): string {
  if (typeof input !== "string" || input.length > maximum || (!allowEmpty && input.trim().length === 0)) {
    throw new Error("invalid string");
  }
  return input.normalize("NFC");
}

function member<T extends string>(input: unknown, values: ReadonlySet<T>): T {
  if (typeof input !== "string" || !values.has(input as T)) throw new Error("invalid enum");
  return input as T;
}

function valueAt(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

function exactRecord(input: unknown, keys: readonly string[]): Record<string, unknown> {
  const snapshot = snapshotObjectRecord(input);
  if (!hasExactOwnKeys(snapshot, keys)) throw new Error("invalid keys");
  return snapshot;
}

function exactRecordVariant(input: unknown, variants: readonly (readonly string[])[]): Record<string, unknown> {
  const snapshot = snapshotObjectRecord(input);
  if (!variants.some((keys) => hasExactOwnKeys(snapshot, keys))) {
    throw new Error("invalid keys");
  }
  return snapshot;
}

function snapshotObjectRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("invalid record");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid prototype");
  const keys = Reflect.ownKeys(input);
  if (keys.some((key) => typeof key !== "string")) throw new Error("invalid keys");
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor)) throw new Error("invalid descriptor");
    snapshot[key as string] = descriptor.value;
  }
  return snapshot;
}

function hasExactOwnKeys(input: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(input);
  return actual.length === expected.length
    && actual.every((key) => typeof key === "string" && expected.includes(key));
}
