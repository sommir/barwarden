import { Inject, Injectable } from "@angular/core";

import {
  AutoFillCandidateService,
  type AutoFillCandidateGroup,
  type AutoFillCandidateResponse,
  type AutoFillSecretField,
  type RankedAutoFillCandidate,
} from "./autofill-candidate.service";
import {
  contextsEqual,
  immutableAuthorizationMap,
  type ContextualCandidate,
  type LiveAutoFillContext,
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

interface MutableCandidate {
  candidate: RankedAutoFillCandidate;
  firstAgentOrder: number;
  authorizations: Map<AutoFillSecretField, {
    readonly contextToken: string;
    readonly requiresMismatchConfirmation: boolean;
  }>;
}

@Injectable({ providedIn: "root" })
export class AutoFillContextualCandidatesService {
  constructor(
    private readonly candidates: AutoFillCandidateService,
    @Inject(AUTOFILL_NATIVE_HOST) private readonly native: AutoFillNativeHost,
  ) {}

  async queryAll(
    context: LiveAutoFillContext,
    session: AutoFillAgentSession,
    query: string,
  ): Promise<readonly ContextualCandidate[]> {
    const requests = FIELDS.map((field) => this.candidates.query({
      accountId: session.accountId,
      lockGeneration: session.generation,
      field,
      context: {
        bundleId: context.bundleId,
        appName: context.appName,
        serviceIdentifiers: [],
        query,
      },
    }));
    const settled = await Promise.allSettled(requests);
    const [liveContext, liveSession] = await Promise.all([
      this.native.entryContext(),
      this.native.agentSession(),
    ]);
    if (liveContext.status !== "available" || liveSession.status !== "success"
        || !contextsEqual(context, liveContext.context) || !sessionsEqual(session, liveSession)) {
      throw new AutoFillContextChangedError();
    }
    const rejection = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejection) throw rejection.reason;
    return mergeResponses(settled.map((result) => (result as PromiseFulfilledResult<AutoFillCandidateResponse>).value));
  }
}

function mergeResponses(responses: readonly AutoFillCandidateResponse[]): readonly ContextualCandidate[] {
  const merged = new Map<string, MutableCandidate>();
  let agentOrder = 0;
  responses.forEach((response, fieldIndex) => {
    const field = FIELDS[fieldIndex];
    response.candidates.forEach((candidate) => {
      const existing = merged.get(candidate.cipherId);
      const authorization = Object.freeze({
        contextToken: response.contextToken,
        requiresMismatchConfirmation: candidate.requiresMismatchConfirmation,
      });
      if (!existing) {
        merged.set(candidate.cipherId, {
          candidate,
          firstAgentOrder: agentOrder,
          authorizations: new Map([[field, authorization]]),
        });
      } else {
        existing.authorizations.set(field, authorization);
        if (GROUP_RANK[candidate.group] < GROUP_RANK[existing.candidate.group]) {
          existing.candidate = candidate;
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
