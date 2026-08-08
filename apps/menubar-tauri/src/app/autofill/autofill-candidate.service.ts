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
    const normalized = {
      accountId: required(request.accountId),
      lockGeneration: required(request.lockGeneration),
      context: {
        bundleId: bounded(request.context.bundleId, 255),
        appName: bounded(request.context.appName, 255),
        serviceIdentifiers: request.context.serviceIdentifiers.map((value) => bounded(value, 2_048)).slice(0, 32),
        query: bounded(request.context.query.trim(), 512),
      },
    } satisfies AutoFillCandidateQuery;
    return validateCandidateResponse(await this.host.queryCandidates(normalized));
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
      typeof input.contextToken !== "string" || !input.contextToken ||
      !Array.isArray(input.candidates) || input.candidates.length > 500) {
    throw new Error("invalid candidate response");
  }
  const candidates = input.candidates.map((candidate) => {
    const keys = [
      "cipherId", "displayName", "username", "group", "reason", "requiresMismatchConfirmation",
    ];
    if (!isRecord(candidate) || !hasExactKeys(candidate, keys) ||
        typeof candidate.cipherId !== "string" || !candidate.cipherId ||
        typeof candidate.displayName !== "string" ||
        typeof candidate.username !== "string" ||
        !(["exact", "relevant", "other"] as unknown[]).includes(candidate.group) ||
        typeof candidate.reason !== "string" ||
        typeof candidate.requiresMismatchConfirmation !== "boolean") {
      throw new Error("invalid candidate response");
    }
    return candidate as unknown as RankedAutoFillCandidate;
  });
  return { contextToken: input.contextToken, candidates };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasExactKeys(input: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(input).sort();
  return actual.length === expected.length && expected.slice().sort().every((key, index) => key === actual[index]);
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
