import { Inject, Injectable } from "@angular/core";

import {
  AutoFillCandidateService,
  type AutoFillCandidateGroup,
  type AutoFillCandidateResponse,
  type AutoFillSecretField,
  type RankedAutoFillCandidate,
} from "./autofill-candidate.service";
import {
  decodeAutoFillApplicationContext,
  immutableAuthorizationMap,
  projectAutoFillAgentSession,
  type ContextualCandidate,
  type AutoFillApplicationContext,
} from "./autofill-fill-context.model";
import {
  AUTOFILL_NATIVE_HOST,
  type AutoFillAgentSession,
  type AutoFillNativeHost,
} from "./autofill-native.host";

const FIELDS: readonly AutoFillSecretField[] = ["username", "password", "totp"];
const GROUP_RANK: Readonly<Record<AutoFillCandidateGroup, number>> = {
  exact: 0,
  relevant: 1,
  other: 2,
};

export class AutoFillContextChangedError extends Error {
  override readonly name = "AutoFillContextChangedError";

  constructor() {
    super("AutoFill context changed.");
  }
}

export class AutoFillCandidatesUnavailableError extends Error {
  override readonly name = "AutoFillCandidatesUnavailableError";

  constructor() {
    super("AutoFill candidates unavailable.");
  }
}

interface MutableCandidate {
  candidate: RankedAutoFillCandidate;
  firstAgentOrder: number;
  authorizations: Map<AutoFillSecretField, {
    readonly contextToken: string;
    readonly requiresMismatchConfirmation: boolean;
  }>;
}

interface CandidateFieldResponse {
  readonly field: AutoFillSecretField;
  readonly response: AutoFillCandidateResponse;
}

@Injectable({ providedIn: "root" })
export class AutoFillContextualCandidatesService {
  constructor(
    private readonly candidates: AutoFillCandidateService,
    @Inject(AUTOFILL_NATIVE_HOST) private readonly native: AutoFillNativeHost,
  ) {}

  async queryAll(
    context: AutoFillApplicationContext,
    session: AutoFillAgentSession,
    query: string,
    serviceIdentifiers: readonly string[] = [],
  ): Promise<readonly ContextualCandidate[]> {
    let requestContext: AutoFillApplicationContext;
    let requestSession: AutoFillAgentSession;
    let requestQuery: string;
    let requestServiceIdentifiers: readonly string[];
    try {
      requestContext = decodeAutoFillApplicationContext(context);
      requestSession = projectAutoFillAgentSession(session);
      if (typeof query !== "string" || query.length > 512) throw new Error("invalid query");
      requestQuery = query.normalize("NFC");
      if (!Array.isArray(serviceIdentifiers) || serviceIdentifiers.length > 32) {
        throw new Error("invalid service identifiers");
      }
      requestServiceIdentifiers = Object.freeze(serviceIdentifiers.map((value) => {
        if (typeof value !== "string" || value.length > 2_048) {
          throw new Error("invalid service identifier");
        }
        return value.normalize("NFC");
      }));
    } catch {
      throw new AutoFillCandidatesUnavailableError();
    }
    const requests = FIELDS.map((field) => this.candidates.query({
      accountId: requestSession.accountId,
      lockGeneration: requestSession.generation,
      field,
      context: Object.freeze({
        bundleId: requestContext.bundleId,
        appName: requestContext.appName,
        serviceIdentifiers: requestServiceIdentifiers,
        query: requestQuery,
      }),
    }));
    const settled = await Promise.allSettled(requests);
    let liveContext: Awaited<ReturnType<AutoFillNativeHost["entryContext"]>>;
    let liveSession: Awaited<ReturnType<AutoFillNativeHost["agentSession"]>>;
    try {
      [liveContext, liveSession] = await Promise.all([
        this.native.entryContext(),
        this.native.agentSession(),
      ]);
    } catch {
      throw new AutoFillContextChangedError();
    }
    if (liveContext.status !== "available" || liveSession.status !== "success") {
      throw new AutoFillContextChangedError();
    }
    let projectedLiveContext: AutoFillApplicationContext;
    let projectedLiveSession: AutoFillAgentSession;
    try {
      projectedLiveContext = decodeAutoFillApplicationContext(liveContext.application);
      projectedLiveSession = projectAutoFillAgentSession({
        accountId: liveSession.accountId,
        generation: liveSession.generation,
        vaultRevision: liveSession.vaultRevision,
      });
    } catch {
      throw new AutoFillContextChangedError();
    }
    if (!applicationsEqual(requestContext, projectedLiveContext)
        || !sessionsEqual(requestSession, projectedLiveSession)) {
      throw new AutoFillContextChangedError();
    }
    const fulfilled = settled.flatMap((result, index): CandidateFieldResponse[] => result.status === "fulfilled"
      ? [{ field: FIELDS[index], response: result.value }]
      : []);
    if (!fulfilled.length) throw new AutoFillCandidatesUnavailableError();
    try {
      return mergeResponses(fulfilled);
    } catch {
      throw new AutoFillCandidatesUnavailableError();
    }
  }
}

function applicationsEqual(left: AutoFillApplicationContext, right: AutoFillApplicationContext): boolean {
  return left.bundleId === right.bundleId && left.appName === right.appName;
}

function mergeResponses(responses: readonly CandidateFieldResponse[]): readonly ContextualCandidate[] {
  const merged = new Map<string, MutableCandidate>();
  let agentOrder = 0;
  responses.forEach(({ field, response }) => {
    response.candidates.forEach((candidate) => {
      const existing = merged.get(candidate.cipherId);
      const authorization = Object.freeze({
        contextToken: response.contextToken,
        requiresMismatchConfirmation: candidate.requiresMismatchConfirmation,
      });
      if (!existing) {
        merged.set(candidate.cipherId, {
          candidate: Object.freeze({
            cipherId: candidate.cipherId,
            displayName: candidate.displayName,
            username: candidate.username,
            group: candidate.group,
            reason: candidate.reason,
            requiresMismatchConfirmation: candidate.requiresMismatchConfirmation,
          }),
          firstAgentOrder: agentOrder,
          authorizations: new Map([[field, authorization]]),
        });
      } else {
        existing.authorizations.set(field, authorization);
        if (GROUP_RANK[candidate.group] < GROUP_RANK[existing.candidate.group]) {
          existing.candidate = Object.freeze({
            cipherId: candidate.cipherId,
            displayName: candidate.displayName,
            username: candidate.username,
            group: candidate.group,
            reason: candidate.reason,
            requiresMismatchConfirmation: candidate.requiresMismatchConfirmation,
          });
        }
      }
      agentOrder += 1;
    });
  });
  return Object.freeze([...merged.values()]
    .sort((left, right) => GROUP_RANK[left.candidate.group] - GROUP_RANK[right.candidate.group]
      || left.firstAgentOrder - right.firstAgentOrder)
    .map(({ candidate, authorizations }) => Object.freeze({
      cipherId: candidate.cipherId,
      displayName: candidate.displayName,
      username: candidate.username,
      group: candidate.group,
      reason: candidate.reason,
      availableFields: Object.freeze(FIELDS.filter((field) => authorizations.has(field))),
      authorizations: immutableAuthorizationMap(authorizations),
    })));
}

function sessionsEqual(left: AutoFillAgentSession, right: AutoFillAgentSession): boolean {
  return left.accountId === right.accountId
    && left.generation === right.generation
    && left.vaultRevision === right.vaultRevision;
}
