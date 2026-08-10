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
  if (!isRecord(input) || !hasExactKeys(input, ["contextToken", "candidates"]) ||
      typeof input.contextToken !== "string" || !input.contextToken || input.contextToken.length > 512 ||
      !Array.isArray(input.candidates) || input.candidates.length > 500) {
    throw new Error("invalid candidate response");
  }
  const cipherIds = new Set<string>();
  const candidates = input.candidates.map((candidate) => {
    const keys = [
      "cipherId", "displayName", "username", "group", "reason", "requiresMismatchConfirmation",
    ];
    if (!isRecord(candidate) || !hasExactKeys(candidate, keys) ||
        typeof candidate.cipherId !== "string" || !candidate.cipherId.trim() || candidate.cipherId.length > 512 ||
        typeof candidate.displayName !== "string" || candidate.displayName.length > 2_048 ||
        typeof candidate.username !== "string" || candidate.username.length > 2_048 ||
        !(["exact", "relevant", "other"] as unknown[]).includes(candidate.group) ||
        typeof candidate.reason !== "string" || candidate.reason.length > 512 ||
        typeof candidate.requiresMismatchConfirmation !== "boolean") {
      throw new Error("invalid candidate response");
    }
    const cipherId = candidate.cipherId.normalize("NFC");
    if (cipherIds.has(cipherId)) throw new Error("invalid candidate response");
    cipherIds.add(cipherId);
    return Object.freeze({
      cipherId,
      displayName: candidate.displayName.normalize("NFC"),
      username: candidate.username.normalize("NFC"),
      group: candidate.group as AutoFillCandidateGroup,
      reason: candidate.reason.normalize("NFC"),
      requiresMismatchConfirmation: candidate.requiresMismatchConfirmation,
    });
  });
  return Object.freeze({
    contextToken: input.contextToken.normalize("NFC"),
    candidates: Object.freeze(candidates),
  });
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
