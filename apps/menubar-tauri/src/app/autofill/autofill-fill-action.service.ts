import { Inject, Injectable } from "@angular/core";

import type { AutoFillSecretField } from "./autofill-candidate.service";
import {
  contextsEqual,
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

export type PreparedAutoFillAction =
  | { readonly status: "choose"; readonly fields: readonly AutoFillSecretField[] }
  | { readonly status: "unavailable"; readonly reason: "missing-required-field" }
  | {
    readonly status: "ready";
    readonly context: LiveAutoFillContext;
    readonly session: AutoFillAgentSession;
    readonly fields: readonly AutoFillSecretField[];
    readonly scopes: readonly AutoFillRepromptScope[];
    readonly requiresMismatchConfirmation: boolean;
  };

export interface ExecuteAutoFillOptions {
  readonly mismatchConfirmed: boolean;
  readonly requiresReprompt: boolean;
  readonly repromptReceipt?: string;
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
    readonly reason: "reprompt-unavailable" | "reprompt-already-started" | "action-consumed" | "stale-context";
  };

@Injectable({ providedIn: "root" })
export class AutoFillFillActionService {
  private readonly repromptStarted = new WeakSet<object>();
  private readonly activeReceipts = new WeakMap<object, string>();
  private readonly consumed = new WeakSet<object>();

  constructor(@Inject(AUTOFILL_NATIVE_HOST) private readonly native: AutoFillNativeHost) {}

  prepare(
    context: LiveAutoFillContext,
    session: AutoFillAgentSession,
    candidate: ContextualCandidate,
  ): PreparedAutoFillAction {
    const fields = Object.freeze(context.action.fields.filter((field) => (
      candidate.availableFields.includes(field) && candidate.authorizations.has(field)
    )));
    if (context.action.mode === "choose") {
      return Object.freeze({ status: "choose", fields });
    }
    if (fields.length !== context.action.fields.length) {
      return Object.freeze({ status: "unavailable", reason: "missing-required-field" });
    }
    const scopes = Object.freeze(fields.map((field) => {
      const authorization = candidate.authorizations.get(field);
      if (!authorization) throw new Error("missing field authorization");
      return Object.freeze({
        accountId: session.accountId,
        candidateId: candidate.cipherId,
        field,
        generation: session.generation,
        contextToken: authorization.contextToken,
      });
    }));
    return Object.freeze({
      status: "ready",
      context,
      session,
      fields,
      scopes,
      requiresMismatchConfirmation: fields.some((field) => (
        candidate.authorizations.get(field)?.requiresMismatchConfirmation === true
      )),
    });
  }

  async execute(
    prepared: Extract<PreparedAutoFillAction, { readonly status: "ready" }>,
    options: ExecuteAutoFillOptions,
  ): Promise<AutoFillActionOutcome> {
    if (this.consumed.has(prepared)) return { status: "unavailable", reason: "action-consumed" };
    if (prepared.requiresMismatchConfirmation && !options.mismatchConfirmed) {
      return { status: "confirmation-required" };
    }
    if (!await this.isCurrent(prepared)) {
      const receipt = options.repromptReceipt ?? this.activeReceipts.get(prepared);
      if (receipt) {
        await this.native.cancelRepromptBatch(prepared.scopes, receipt).catch(() => undefined);
      }
      this.activeReceipts.delete(prepared);
      this.consumed.add(prepared);
      return { status: "unavailable", reason: "stale-context" };
    }
    if (this.repromptStarted.has(prepared) && !options.repromptReceipt) {
      return { status: "unavailable", reason: "reprompt-already-started" };
    }
    if (options.requiresReprompt && !options.repromptReceipt) {
      this.repromptStarted.add(prepared);
      const outcome = await this.native.beginRepromptBatch(prepared.scopes);
      if (outcome.status !== "pending") {
        this.consumed.add(prepared);
        return { status: "unavailable", reason: "reprompt-unavailable" };
      }
      this.activeReceipts.set(prepared, outcome.receipt);
      return { status: "reprompt-required", receipt: outcome.receipt, scopes: prepared.scopes };
    }
    this.consumed.add(prepared);
    this.activeReceipts.delete(prepared);
    return this.native.fillDetected({
      fillContextToken: prepared.context.fillContextToken,
      authorizations: prepared.scopes.map((scope) => ({
        scope,
        mismatchConfirmed: options.mismatchConfirmed,
      })),
      ...(options.repromptReceipt === undefined ? {} : { repromptReceipt: options.repromptReceipt }),
    });
  }

  async cancel(
    prepared: Extract<PreparedAutoFillAction, { readonly status: "ready" }>,
    receipt: string,
  ): Promise<void> {
    if (this.consumed.has(prepared)) return;
    this.consumed.add(prepared);
    this.activeReceipts.delete(prepared);
    await this.native.cancelRepromptBatch(prepared.scopes, receipt);
  }

  private async isCurrent(
    prepared: Extract<PreparedAutoFillAction, { readonly status: "ready" }>,
  ): Promise<boolean> {
    const [context, session] = await Promise.all([
      this.native.entryContext().catch(() => ({ status: "unavailable" as const })),
      this.native.agentSession().catch(() => ({ status: "error" as const, code: "unavailable" })),
    ]);
    return context.status === "available" && session.status === "success"
      && contextsEqual(context.context, prepared.context)
      && session.accountId === prepared.session.accountId
      && session.generation === prepared.session.generation
      && session.vaultRevision === prepared.session.vaultRevision;
  }
}
