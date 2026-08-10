import { Inject, Injectable, Optional } from "@angular/core";

import type { AutoFillSecretField } from "./autofill-candidate.service";
import { AutoFillContextSessionService } from "./autofill-context-session.service";
import {
  contextsEqual,
  decodeLiveAutoFillContext,
  projectAutoFillAgentSession,
  projectContextualCandidate,
  type ContextualCandidate,
  type DetectedFillOutcome,
  type LiveAutoFillContext,
} from "./autofill-fill-context.model";
import {
  AUTOFILL_NATIVE_HOST,
  type AutoFillAgentSession,
  type AutoFillNativeHost,
  type AutoFillRepromptScope,
} from "./autofill-native.host";

type ReadyAction = Extract<PreparedAutoFillAction, { readonly status: "ready" }>;

export type PreparedAutoFillAction =
  | { readonly status: "choose"; readonly fields: readonly AutoFillSecretField[] }
  | { readonly status: "unavailable"; readonly reason: "missing-required-field" }
  | {
    readonly status: "ready";
    readonly context: LiveAutoFillContext;
    readonly session: AutoFillAgentSession;
    readonly fields: readonly AutoFillSecretField[];
    readonly scopes: readonly AutoFillRepromptScope[];
    readonly mismatchRequiredFields: readonly AutoFillSecretField[];
    readonly requiresMismatchConfirmation: boolean;
  };

export interface ExecuteAutoFillOptions {
  readonly mismatchConfirmed: boolean;
  readonly requiresReprompt: boolean;
  readonly repromptVerified?: boolean;
}

export type AutoFillActionOutcome = DetectedFillOutcome
  | {
    readonly status: "reprompt-required";
    readonly receipt: string;
    readonly scopes: readonly AutoFillRepromptScope[];
  }
  | { readonly status: "confirmation-required" }
  | {
    readonly status: "unavailable";
    readonly reason:
      | "reprompt-unavailable"
      | "reprompt-already-started"
      | "action-consumed"
      | "action-in-progress"
      | "fill-unavailable"
      | "stale-context";
  };

interface ActionState {
  readonly prepared: ReadyAction;
  phase: "idle" | "validating" | "beginning" | "awaiting-reprompt" | "filling" | "consumed";
  epoch: number;
  receipt?: string;
}

@Injectable({ providedIn: "root" })
export class AutoFillFillActionService {
  private readonly states = new WeakMap<ReadyAction, ActionState>();
  private readonly activeStates = new Set<ActionState>();

  constructor(
    @Inject(AUTOFILL_NATIVE_HOST) private readonly native: AutoFillNativeHost,
    @Optional() contextSession: AutoFillContextSessionService | null = null,
  ) {
    contextSession?.onInvalidate(() => this.invalidateActiveActions());
  }

  prepare(
    context: LiveAutoFillContext,
    session: AutoFillAgentSession,
    candidate: ContextualCandidate,
  ): PreparedAutoFillAction {
    let projectedContext: LiveAutoFillContext;
    let projectedSession: AutoFillAgentSession;
    let projectedCandidate: ContextualCandidate;
    try {
      projectedContext = decodeLiveAutoFillContext(context);
      projectedSession = projectAutoFillAgentSession(session);
      projectedCandidate = projectContextualCandidate(candidate);
    } catch {
      return Object.freeze({ status: "unavailable", reason: "missing-required-field" });
    }
    const fields = Object.freeze(projectedContext.action.fields.filter((field) => (
      projectedCandidate.availableFields.includes(field) && projectedCandidate.authorizations.has(field)
    )));
    if (projectedContext.action.mode === "choose") {
      return Object.freeze({ status: "choose", fields });
    }
    if (fields.length !== projectedContext.action.fields.length) {
      return Object.freeze({ status: "unavailable", reason: "missing-required-field" });
    }
    const scopes = Object.freeze(fields.map((field) => {
      const authorization = projectedCandidate.authorizations.get(field);
      if (!authorization) throw new Error("missing field authorization");
      return Object.freeze({
        accountId: projectedSession.accountId,
        candidateId: projectedCandidate.cipherId,
        field,
        generation: projectedSession.generation,
        contextToken: authorization.contextToken,
      });
    }));
    const mismatchRequiredFields = Object.freeze(fields.filter((field) => (
      projectedCandidate.authorizations.get(field)?.requiresMismatchConfirmation === true
    )));
    const prepared = Object.freeze({
      status: "ready" as const,
      context: projectedContext,
      session: projectedSession,
      fields,
      scopes,
      mismatchRequiredFields,
      requiresMismatchConfirmation: mismatchRequiredFields.length > 0,
    });
    const state: ActionState = { prepared, phase: "idle", epoch: 0 };
    this.states.set(prepared, state);
    this.activeStates.add(state);
    return prepared;
  }

  async execute(prepared: ReadyAction, options: ExecuteAutoFillOptions): Promise<AutoFillActionOutcome> {
    const state = this.states.get(prepared);
    if (!state || state.phase === "consumed") return unavailable("action-consumed");
    if (state.phase === "validating" || state.phase === "beginning" || state.phase === "filling") {
      return unavailable("action-in-progress");
    }
    if (prepared.requiresMismatchConfirmation && !options.mismatchConfirmed) {
      return { status: "confirmation-required" };
    }

    if (state.phase === "awaiting-reprompt") {
      const epoch = state.epoch;
      state.phase = "validating";
      if (!await this.currentAfterAwait(state, epoch)) {
        await this.cancelStoredReceipt(state);
        return this.finishStale(state);
      }
      state.phase = "awaiting-reprompt";
      if (!options.repromptVerified) return unavailable("reprompt-already-started");
      return this.fill(state, options.mismatchConfirmed);
    }
    if (options.repromptVerified) return unavailable("reprompt-unavailable");

    state.phase = "validating";
    const epoch = state.epoch;
    if (!await this.currentAfterAwait(state, epoch)) return this.finishStale(state);

    if (!options.requiresReprompt) return this.fill(state, options.mismatchConfirmed);

    state.phase = "beginning";
    let outcome: Awaited<ReturnType<AutoFillNativeHost["beginRepromptBatch"]>>;
    try {
      outcome = await this.native.beginRepromptBatch(prepared.scopes);
    } catch {
      if (this.owns(state, epoch, "beginning")) this.consume(state);
      return unavailable("reprompt-unavailable");
    }
    if (!this.owns(state, epoch, "beginning")) {
      if (outcome.status === "pending") await this.cancelReceipt(prepared, outcome.receipt);
      return unavailable("action-consumed");
    }
    if (outcome.status !== "pending") {
      this.consume(state);
      return unavailable("reprompt-unavailable");
    }
    state.receipt = outcome.receipt;
    state.phase = "validating";
    if (!await this.currentAfterAwait(state, epoch)) {
      await this.cancelStoredReceipt(state);
      return this.finishStale(state);
    }
    state.phase = "awaiting-reprompt";
    return Object.freeze({
      status: "reprompt-required",
      receipt: outcome.receipt,
      scopes: prepared.scopes,
    });
  }

  async cancel(prepared: ReadyAction): Promise<void> {
    const state = this.states.get(prepared);
    if (!state || state.phase === "consumed") return;
    const receipt = state.receipt;
    this.consume(state);
    if (receipt) await this.cancelReceipt(prepared, receipt);
  }

  private async fill(state: ActionState, mismatchConfirmed: boolean): Promise<AutoFillActionOutcome> {
    const epoch = state.epoch;
    state.phase = "validating";
    if (!await this.currentAfterAwait(state, epoch)) {
      await this.cancelStoredReceipt(state);
      return this.finishStale(state);
    }
    state.phase = "filling";
    const receipt = state.receipt;
    try {
      const outcome = await this.native.fillDetected({
        fillContextToken: state.prepared.context.fillContextToken,
        authorizations: state.prepared.scopes.map((scope) => Object.freeze({
          scope,
          mismatchConfirmed: mismatchConfirmed
            && state.prepared.mismatchRequiredFields.includes(scope.field),
        })),
        ...(receipt === undefined ? {} : { repromptReceipt: receipt }),
      });
      if (!this.owns(state, epoch, "filling")) return unavailable("action-consumed");
      this.consume(state);
      return outcome;
    } catch {
      if (this.owns(state, epoch, "filling")) {
        await this.cancelStoredReceipt(state);
        this.consume(state);
      }
      return unavailable("fill-unavailable");
    }
  }

  private async currentAfterAwait(state: ActionState, epoch: number): Promise<boolean> {
    const current = await this.isCurrent(state.prepared);
    return current && this.owns(state, epoch, "validating");
  }

  private owns(state: ActionState, epoch: number, phase: ActionState["phase"]): boolean {
    return state.epoch === epoch && state.phase === phase;
  }

  private finishStale(state: ActionState): AutoFillActionOutcome {
    if (state.phase !== "consumed") this.consume(state);
    return unavailable("stale-context");
  }

  private consume(state: ActionState): void {
    state.epoch += 1;
    state.phase = "consumed";
    state.receipt = undefined;
    this.activeStates.delete(state);
  }

  private async cancelStoredReceipt(state: ActionState): Promise<void> {
    const receipt = state.receipt;
    state.receipt = undefined;
    if (receipt) await this.cancelReceipt(state.prepared, receipt);
  }

  private async cancelReceipt(prepared: ReadyAction, receipt: string): Promise<void> {
    await this.native.cancelRepromptBatch(prepared.scopes, receipt).catch(() => undefined);
  }

  private invalidateActiveActions(): void {
    for (const state of [...this.activeStates]) void this.cancel(state.prepared);
  }

  private async isCurrent(prepared: ReadyAction): Promise<boolean> {
    const [context, session] = await Promise.all([
      this.native.entryContext().catch(() => ({ status: "unavailable" as const })),
      this.native.agentSession().catch(() => ({ status: "error" as const, code: "unavailable" })),
    ]);
    if (context.status !== "available" || session.status !== "success") return false;
    try {
      const projectedContext = decodeLiveAutoFillContext(context.context);
      const projectedSession = projectAutoFillAgentSession({
        accountId: session.accountId,
        generation: session.generation,
        vaultRevision: session.vaultRevision,
      });
      return contextsEqual(projectedContext, prepared.context)
        && projectedSession.accountId === prepared.session.accountId
        && projectedSession.generation === prepared.session.generation
        && projectedSession.vaultRevision === prepared.session.vaultRevision;
    } catch {
      return false;
    }
  }
}

function unavailable(reason: Extract<AutoFillActionOutcome, { status: "unavailable" }>["reason"]): AutoFillActionOutcome {
  return Object.freeze({ status: "unavailable", reason });
}
