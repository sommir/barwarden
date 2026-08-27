import { Inject, Injectable, Optional } from "@angular/core";

import type { AutoFillSecretField } from "./autofill-candidate.service";
import {
  projectAutoFillAgentSession,
  projectContextualCandidate,
  type ContextualCandidate,
} from "./autofill-fill-context.model";
import {
  AUTOFILL_NATIVE_HOST,
  type AutoFillAgentSession,
  type AutoFillNativeHost,
  type AutoFillRepromptScope,
} from "./autofill-native.host";

export interface AutoFillFieldActionOptions {
  readonly mismatchConfirmed: boolean;
  readonly requiresReprompt: boolean;
  readonly repromptVerified?: boolean;
  readonly repromptReceipt?: string;
}

export type AutoFillFieldActionOutcome =
  | { readonly status: "filled"; readonly field: AutoFillSecretField }
  | { readonly status: "copied"; readonly field: AutoFillSecretField }
  | { readonly status: "confirmation-required" }
  | { readonly status: "reprompt-required"; readonly receipt: string; readonly scope: AutoFillRepromptScope }
  | { readonly status: "unavailable" };

@Injectable({ providedIn: "root" })
export class AutoFillFieldActionService {
  constructor(@Optional() @Inject(AUTOFILL_NATIVE_HOST) private readonly native: AutoFillNativeHost | null) {}

  async execute(
    session: AutoFillAgentSession,
    candidate: ContextualCandidate,
    field: AutoFillSecretField,
    options: AutoFillFieldActionOptions,
  ): Promise<AutoFillFieldActionOutcome> {
    if (!this.native) return unavailable();
    let projectedSession: AutoFillAgentSession;
    let projectedCandidate: ContextualCandidate;
    try {
      projectedSession = projectAutoFillAgentSession(session);
      projectedCandidate = projectContextualCandidate(candidate);
    } catch {
      return unavailable();
    }
    const authorization = projectedCandidate.authorizations.get(field);
    if (!projectedCandidate.availableFields.includes(field) || !authorization) return unavailable();
    if (authorization.requiresMismatchConfirmation && !options.mismatchConfirmed) {
      return Object.freeze({ status: "confirmation-required" });
    }
    const scope = Object.freeze({
      accountId: projectedSession.accountId,
      candidateId: projectedCandidate.cipherId,
      field,
      generation: projectedSession.generation,
      contextToken: authorization.contextToken,
    });
    if (!await this.isCurrentSession(projectedSession)) return unavailable();
    if (options.requiresReprompt && !options.repromptVerified) {
      const begin = await this.native.beginReprompt(scope).catch(() => ({ status: "unavailable" as const }));
      return begin.status === "pending"
        ? Object.freeze({ status: "reprompt-required" as const, receipt: begin.receipt, scope })
        : unavailable();
    }
    if (options.requiresReprompt && (!options.repromptReceipt || !options.repromptVerified)) return unavailable();
    const released = await this.native.releaseSecret({
      scope,
      mismatchConfirmed: authorization.requiresMismatchConfirmation,
      ...(options.repromptReceipt ? { repromptReceipt: options.repromptReceipt } : {}),
    }).catch(() => null);
    if (released?.status !== "success" || released.field !== field) return unavailable();
    const pasted = await this.native.pasteText(released.value).then(() => true, () => false);
    if (pasted) return Object.freeze({ status: "filled" as const, field });
    const copied = await this.native.copyText(released.value).then(() => true, () => false);
    return copied ? Object.freeze({ status: "copied" as const, field }) : unavailable();
  }

  async cancel(scope: AutoFillRepromptScope, receipt: string): Promise<void> {
    await this.native?.cancelReprompt(scope, receipt).catch(() => undefined);
  }

  private async isCurrentSession(session: AutoFillAgentSession): Promise<boolean> {
    if (!this.native) return false;
    const liveSession = await this.native.agentSession()
      .catch(() => ({ status: "error" as const, code: "unavailable" }));
    return liveSession.status === "success"
      && liveSession.accountId === session.accountId
      && liveSession.generation === session.generation
      && liveSession.vaultRevision === session.vaultRevision;
  }
}

function unavailable(): AutoFillFieldActionOutcome {
  return Object.freeze({ status: "unavailable" });
}
