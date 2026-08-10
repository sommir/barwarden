import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";

export type AutoFillCandidateGroup = "exact" | "relevant" | "other";

export interface NativeAutoFillContext {
  readonly bundleId: string;
  readonly appName: string;
  readonly serviceIdentifiers: readonly string[];
  readonly query: string;
}

export interface RankedAutoFillCandidate {
  readonly cipherId: string;
  readonly displayName: string;
  readonly username: string;
  readonly group: AutoFillCandidateGroup;
  readonly reason: string;
  readonly requiresMismatchConfirmation: boolean;
}

export interface AutoFillCandidateQuery {
  readonly accountId: string;
  readonly lockGeneration: string;
  readonly field?: AutoFillSecretField;
  readonly context: NativeAutoFillContext;
}

export interface AutoFillCandidateResponse {
  readonly contextToken: string;
  readonly candidates: readonly RankedAutoFillCandidate[];
}

export interface AutoFillCandidateHost {
  queryCandidates(request: AutoFillCandidateQuery): Promise<unknown>;
}

export const AUTOFILL_CANDIDATE_HOST = new InjectionToken<AutoFillCandidateHost | null>(
  "AUTOFILL_CANDIDATE_HOST",
  { providedIn: "root", factory: () => null },
);

const unavailableHost: AutoFillCandidateHost = {
  queryCandidates: async () => { throw new Error("AutoFill Agent unavailable"); },
};

@Injectable({ providedIn: "root" })
export class AutoFillCandidateService {
  private readonly host: AutoFillCandidateHost;

  constructor(
    @Optional() @Inject(AUTOFILL_CANDIDATE_HOST) host: AutoFillCandidateHost | null = null,
  ) {
    this.host = host ?? unavailableHost;
  }

  async query(request: AutoFillCandidateQuery): Promise<AutoFillCandidateResponse> {
    try {
      const field = request.field ?? "password";
      if (!(["username", "password", "totp"] as unknown[]).includes(field)
          || !Array.isArray(request.context.serviceIdentifiers)
          || request.context.serviceIdentifiers.length > 32) {
        throw new Error("invalid candidate request");
      }
      const normalized = Object.freeze({
        accountId: required(request.accountId),
        lockGeneration: required(request.lockGeneration),
        field,
        context: Object.freeze({
          bundleId: bounded(request.context.bundleId, 255),
          appName: bounded(request.context.appName, 255),
          serviceIdentifiers: Object.freeze(request.context.serviceIdentifiers.map((value) => bounded(value, 2_048))),
          query: bounded(request.context.query.trim(), 512),
        }),
      }) satisfies AutoFillCandidateQuery;
      return validateCandidateResponse(await this.host.queryCandidates(normalized));
    } catch {
      throw new Error("AutoFill candidates unavailable");
    }
  }
}

export type AutoFillSecretField = "username" | "password" | "totp";
export type AutoFillRepromptResult =
  | { readonly result: "not_required" }
  | { readonly result: "grant"; readonly grant: string };

export interface AutoFillSecretReleaseRequest {
  readonly accountId: string;
  readonly candidateId: string;
  readonly field: AutoFillSecretField;
  readonly contextToken: string;
  readonly lockGeneration: string;
  readonly mismatchConfirmed: boolean;
  readonly reprompt: AutoFillRepromptResult;
}

export function validateSecretReleaseRequest(input: AutoFillSecretReleaseRequest): AutoFillSecretReleaseRequest {
  if (!isRecord(input) || !hasExactKeys(input, [
    "accountId", "candidateId", "field", "contextToken", "lockGeneration",
    "mismatchConfirmed", "reprompt",
  ]) || typeof input.mismatchConfirmed !== "boolean" || !isRecord(input.reprompt)) {
    throw new Error("invalid secret release request");
  }
  required(input.accountId);
  required(input.candidateId);
  required(input.contextToken);
  required(input.lockGeneration);
  if (!(new Set<string>(["username", "password", "totp"])).has(input.field)) {
    throw new Error("invalid secret field");
  }
  if (input.reprompt.result === "grant") {
    if (!hasExactKeys(input.reprompt, ["result", "grant"])) throw new Error("invalid reprompt result");
    required(input.reprompt.grant);
  } else if (input.reprompt.result === "not_required") {
    if (!hasExactKeys(input.reprompt, ["result"])) throw new Error("invalid reprompt result");
  } else {
    throw new Error("invalid reprompt result");
  }
  return input;
}

function validateCandidateResponse(input: unknown): AutoFillCandidateResponse {
  const value = snapshotExactRecord(input, ["contextToken", "candidates"]);
  const contextToken = candidateToken(value["contextToken"]);
  const rawCandidates = value["candidates"];
  if (!Array.isArray(rawCandidates) || rawCandidates.length > 500) {
    throw new Error("invalid candidate response");
  }
  const cipherIds = new Set<string>();
  const candidates = rawCandidates.map((candidate) => {
    const keys = [
      "cipherId", "displayName", "username", "group", "reason", "requiresMismatchConfirmation",
    ];
    const projected = snapshotExactRecord(candidate, keys);
    const cipherId = boundedCandidateString(projected["cipherId"], 512, false);
    const displayName = boundedCandidateString(projected["displayName"], 2_048, true);
    const username = boundedCandidateString(projected["username"], 2_048, true);
    const group = projected["group"];
    const reason = boundedCandidateString(projected["reason"], 512, true);
    const requiresMismatchConfirmation = projected["requiresMismatchConfirmation"];
    if (!(["exact", "relevant", "other"] as unknown[]).includes(group)
        || typeof requiresMismatchConfirmation !== "boolean") {
      throw new Error("invalid candidate response");
    }
    if (cipherIds.has(cipherId)) throw new Error("invalid candidate response");
    cipherIds.add(cipherId);
    return Object.freeze({
      cipherId,
      displayName,
      username,
      group: group as AutoFillCandidateGroup,
      reason,
      requiresMismatchConfirmation,
    });
  });
  return Object.freeze({
    contextToken,
    candidates: Object.freeze(candidates),
  });
}

function snapshotExactRecord(input: unknown, expected: readonly string[]): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("invalid candidate response");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("invalid candidate response");
  const keys = Reflect.ownKeys(input);
  if (keys.length !== expected.length
      || keys.some((key) => typeof key !== "string" || !expected.includes(key))) {
    throw new Error("invalid candidate response");
  }
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor)) throw new Error("invalid candidate response");
    snapshot[key as string] = descriptor.value;
  }
  return snapshot;
}

function boundedCandidateString(input: unknown, maximum: number, allowEmpty: boolean): string {
  if (typeof input !== "string" || input.length > maximum || (!allowEmpty && input.trim().length === 0)) {
    throw new Error("invalid candidate response");
  }
  return input.normalize("NFC");
}

function candidateToken(input: unknown): string {
  return boundedCandidateString(input, 512, false);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(input: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(input);
  return actual.length === expected.length
    && actual.every((key) => typeof key === "string" && expected.includes(key));
}

function bounded(value: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) throw new Error("invalid candidate request");
  return value.normalize("NFC");
}

function required(value: string): string {
  const normalized = bounded(value, 2_048).trim();
  if (!normalized) throw new Error("missing candidate request field");
  return normalized;
}
