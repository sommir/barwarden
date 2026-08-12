import { Inject, Injectable, Optional } from "@angular/core";

import type { AutoFillSecretField } from "./autofill-candidate.service";
import {
  decodeAutoFillApplicationContext,
  decodeLiveAutoFillContext,
  projectAutoFillAgentSession,
  projectContextualCandidate,
  type ContextualCandidate,
  type LayeredAutoFillContext,
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
    layered: LayeredAutoFillContext,
    session: AutoFillAgentSession,
    candidate: ContextualCandidate,
    field: AutoFillSecretField,
    options: AutoFillFieldActionOptions,
  ): Promise<AutoFillFieldActionOutcome> {
    if (!this.native) return unavailable();
    let projected: LayeredAutoFillContext;
    let projectedSession: AutoFillAgentSession;
    let projectedCandidate: ContextualCandidate;
    try {
      projected = Object.freeze({
        application: decodeAutoFillApplicationContext(layered.application),
        fillContext: layered.fillContext === null ? null : decodeLiveAutoFillContext(layered.fillContext),
      });
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
    if (!await this.isCurrent(projected, projectedSession)) return unavailable();
    if (options.requiresReprompt && !options.repromptVerified) {
      const begin = await this.native.beginReprompt(scope).catch(() => ({ status: "unavailable" as const }));
      return begin.status === "pending"
        ? Object.freeze({ status: "reprompt-required" as const, receipt: begin.receipt, scope })
        : unavailable();
    }
    if (options.requiresReprompt && (!options.repromptReceipt || !options.repromptVerified)) return unavailable();
    if (projected.fillContext !== null) {
      const outcome = await this.native.fillDetected({
        intent: "explicit",
        fillContextToken: projected.fillContext.fillContextToken,
        authorizations: [{ scope, mismatchConfirmed: authorization.requiresMismatchConfirmation }],
        ...(options.repromptReceipt ? { repromptReceipt: options.repromptReceipt } : {}),
      }).catch(() => null);
      return outcome?.status === "success" && outcome.fields.length === 1 && outcome.fields[0] === field
        ? Object.freeze({ status: "filled" as const, field })
        : unavailable();
    }
    const released = await this.native.releaseSecret({
      scope,
      mismatchConfirmed: authorization.requiresMismatchConfirmation,
      ...(options.repromptReceipt ? { repromptReceipt: options.repromptReceipt } : {}),
    }).catch(() => null);
    if (released?.status !== "success" || released.field !== field) return unavailable();
    const copied = await this.native.copyText(released.value).then(() => true, () => false);
    return copied
      ? Object.freeze({ status: "copied" as const, field })
      : unavailable();
  }

  async cancel(scope: AutoFillRepromptScope, receipt: string): Promise<void> {
    await this.native?.cancelReprompt(scope, receipt).catch(() => undefined);
  }

  private async isCurrent(layered: LayeredAutoFillContext, session: AutoFillAgentSession): Promise<boolean> {
    if (!this.native) return false;
    const [entry, liveSession] = await Promise.all([
      this.native.entryContext().catch(() => ({ status: "unavailable" as const })),
      this.native.agentSession().catch(() => ({ status: "error" as const, code: "unavailable" })),
    ]);
    if (entry.status !== "available" || liveSession.status !== "success") return false;
    return entry.application.bundleId === layered.application.bundleId
      && entry.application.appName === layered.application.appName
      && liveSession.accountId === session.accountId
      && liveSession.generation === session.generation
      && liveSession.vaultRevision === session.vaultRevision
      && (layered.fillContext === null
        ? entry.fillContext === null
        : entry.fillContext !== null
          && entry.fillContext.fillContextToken === layered.fillContext.fillContextToken);
  }
}

function unavailable(): AutoFillFieldActionOutcome {
  return Object.freeze({ status: "unavailable" });
}
