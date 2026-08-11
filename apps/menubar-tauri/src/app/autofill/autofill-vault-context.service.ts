import { Inject, Injectable } from "@angular/core";

import { PopupStateStore } from "../popup-state";
import { AutoFillContextSessionService } from "./autofill-context-session.service";
import {
  AutoFillContextChangedError,
  AutoFillContextualCandidatesService,
} from "./autofill-contextual-candidates.service";
import {
  contextsEqual,
  decodeLiveAutoFillContext,
  projectAutoFillAgentSession,
  type ContextualCandidate,
  type LiveAutoFillContext,
} from "./autofill-fill-context.model";
import {
  AUTOFILL_NATIVE_HOST,
  type AutoFillAgentSession,
  type AutoFillNativeHost,
} from "./autofill-native.host";
import { AutoFillSetupService } from "./autofill-setup.service";

export type AutoFillVaultContextState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly epoch: number }
  | {
    readonly status: "ready";
    readonly epoch: number;
    readonly context: LiveAutoFillContext;
    readonly session: AutoFillAgentSession;
    readonly candidates: readonly ContextualCandidate[];
  }
  | {
    readonly status: "unavailable";
    readonly reason: "setup" | "context" | "session" | "account";
  };

export interface SelectedAutoFillVaultCandidate {
  readonly context: LiveAutoFillContext;
  readonly session: AutoFillAgentSession;
  readonly candidate: ContextualCandidate;
}

const IDLE: AutoFillVaultContextState = Object.freeze({ status: "idle" });

@Injectable({ providedIn: "root" })
export class AutoFillVaultContextService {
  private state: AutoFillVaultContextState = IDLE;
  private epoch = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly setup: AutoFillSetupService,
    @Inject(AUTOFILL_NATIVE_HOST) private readonly native: AutoFillNativeHost,
    private readonly contextualCandidates: AutoFillContextualCandidatesService,
    private readonly store: PopupStateStore,
    private readonly contextSession: AutoFillContextSessionService,
  ) {}

  snapshot(): AutoFillVaultContextState {
    if (this.state.status === "ready" && !this.contextSession.snapshot()) {
      this.invalidate("target");
    }
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async beginFromEntry(): Promise<AutoFillVaultContextState> {
    const epoch = ++this.epoch;
    this.contextSession.clear();
    this.publish(Object.freeze({ status: "loading", epoch }));
    const setupState = await this.setup.enableFromEntry().catch(() => "unavailable" as const);
    if (!this.owns(epoch)) return this.state;
    if (setupState !== "ready") return this.fail(epoch, "setup");

    const initial = await this.readLiveBinding();
    if (!this.owns(epoch)) return this.state;
    if (!initial) return this.fail(epoch, "context");
    if (this.store.snapshot().vaultOwnerAccountId !== initial.session.accountId) {
      return this.fail(epoch, "account");
    }

    let candidates: readonly ContextualCandidate[];
    try {
      candidates = await this.contextualCandidates.queryAll(initial.context, initial.session, "");
    } catch (error) {
      return this.fail(epoch, error instanceof AutoFillContextChangedError ? "context" : "session");
    }
    if (!this.owns(epoch)) return this.state;

    const current = await this.readLiveBinding();
    if (!this.owns(epoch)) return this.state;
    if (!current || !contextsEqual(initial.context, current.context)) return this.fail(epoch, "context");
    if (!sessionsEqual(initial.session, current.session)) {
      return this.fail(epoch, initial.session.accountId === current.session.accountId ? "session" : "account");
    }
    if (this.store.snapshot().vaultOwnerAccountId !== current.session.accountId) {
      return this.fail(epoch, "account");
    }

    try {
      this.contextSession.begin(current.context, current.session, candidates);
      const snapshot = this.contextSession.snapshot();
      if (!snapshot) return this.fail(epoch, "context");
      const ready = Object.freeze({
        status: "ready" as const,
        epoch,
        context: snapshot.context,
        session: snapshot.session,
        candidates: snapshot.candidates,
      });
      this.publish(ready);
      return ready;
    } catch {
      return this.fail(epoch, "context");
    }
  }

  select(cipherId: string): ContextualCandidate | null {
    const state = this.snapshot();
    if (state.status !== "ready") return null;
    const candidate = state.candidates.find((value) => value.cipherId === cipherId) ?? null;
    if (!candidate || !this.contextSession.select(cipherId)) return null;
    return candidate;
  }

  selected(cipherId: string): SelectedAutoFillVaultCandidate | null {
    const state = this.snapshot();
    const session = this.contextSession.snapshot();
    if (state.status !== "ready" || !session || session.selectedCipherId !== cipherId) return null;
    const candidate = state.candidates.find((value) => value.cipherId === cipherId) ?? null;
    if (!candidate || !contextsEqual(state.context, session.context)
        || !sessionsEqual(state.session, session.session)) return null;
    return Object.freeze({ context: state.context, session: state.session, candidate });
  }

  invalidate(_reason: "navigation" | "target" | "lock" | "account" | "cancel" | "destroy" = "cancel"): void {
    this.epoch += 1;
    this.contextSession.clear();
    if (this.state.status !== "idle") this.publish(IDLE);
  }

  private async readLiveBinding(): Promise<{
    readonly context: LiveAutoFillContext;
    readonly session: AutoFillAgentSession;
  } | null> {
    const [entry, session] = await Promise.all([
      this.native.entryContext().catch(() => ({ status: "unavailable" as const })),
      this.native.agentSession().catch(() => ({ status: "error" as const, code: "unavailable" })),
    ]);
    if (entry.status !== "available" || session.status !== "success") return null;
    try {
      return Object.freeze({
        context: decodeLiveAutoFillContext(entry.context),
        session: projectAutoFillAgentSession({
          accountId: session.accountId,
          generation: session.generation,
          vaultRevision: session.vaultRevision,
        }),
      });
    } catch {
      return null;
    }
  }

  private fail(
    epoch: number,
    reason: Extract<AutoFillVaultContextState, { status: "unavailable" }>["reason"],
  ): AutoFillVaultContextState {
    if (!this.owns(epoch)) return this.state;
    this.contextSession.clear();
    const unavailable = Object.freeze({ status: "unavailable" as const, reason });
    this.publish(unavailable);
    return unavailable;
  }

  private owns(epoch: number): boolean {
    return epoch === this.epoch;
  }

  private publish(state: AutoFillVaultContextState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

function sessionsEqual(left: AutoFillAgentSession, right: AutoFillAgentSession): boolean {
  return left.accountId === right.accountId
    && left.generation === right.generation
    && left.vaultRevision === right.vaultRevision;
}
