import { Inject, Injectable } from "@angular/core";

import { PopupStateStore } from "../popup-state";
import { AutoFillContextSessionService } from "./autofill-context-session.service";
import {
  AutoFillContextChangedError,
  AutoFillContextualCandidatesService,
} from "./autofill-contextual-candidates.service";
import {
  contextsEqual,
  decodeAutoFillApplicationContext,
  decodeLiveAutoFillContext,
  projectAutoFillAgentSession,
  type ContextualCandidate,
  type AutoFillApplicationContext,
  type LiveAutoFillContext,
} from "./autofill-fill-context.model";
import {
  AUTOFILL_NATIVE_HOST,
  type AutoFillAgentSession,
  type AutoFillNativeHost,
} from "./autofill-native.host";
import { AutoFillSetupService } from "./autofill-setup.service";
import { CurrentWebsiteContextService } from "../vault/current-website-context.service";

export type AutoFillVaultContextState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly epoch: number }
  | {
    readonly status: "ready";
    readonly epoch: number;
    readonly application: AutoFillApplicationContext;
    readonly serviceIdentifiers: readonly string[];
    readonly context: LiveAutoFillContext | null;
    readonly session: AutoFillAgentSession;
    readonly candidates: readonly ContextualCandidate[];
  }
  | {
    readonly status: "unavailable";
    readonly reason: "setup" | "context" | "session" | "account";
  };

type ReadyAutoFillVaultContextState = Extract<AutoFillVaultContextState, { status: "ready" }>;

export interface SelectedAutoFillVaultCandidate {
  readonly application: AutoFillApplicationContext;
  readonly context: LiveAutoFillContext | null;
  readonly session: AutoFillAgentSession;
  readonly candidate: ContextualCandidate;
}

const IDLE: AutoFillVaultContextState = Object.freeze({ status: "idle" });

@Injectable()
export class AutoFillVaultContextService {
  private state: AutoFillVaultContextState = IDLE;
  private epoch = 0;
  private passiveRefreshEpoch: number | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly setup: AutoFillSetupService,
    @Inject(AUTOFILL_NATIVE_HOST) private readonly native: AutoFillNativeHost,
    private readonly contextualCandidates: AutoFillContextualCandidatesService,
    private readonly store: PopupStateStore,
    private readonly contextSession: AutoFillContextSessionService,
    private readonly websiteContext: CurrentWebsiteContextService,
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
    return this.begin(async () => this.setup.enableFromEntry().catch(() => "unavailable" as const));
  }

  async beginFromVaultOpen(): Promise<AutoFillVaultContextState> {
    if (this.setup.blockReason() !== "ready") {
      this.invalidate("target");
      return this.state;
    }
    const current = this.snapshot();
    return this.begin(
      async () => "ready" as const,
      current.status === "ready" ? current : null,
    );
  }

  private async begin(
    resolveSetup: () => Promise<"disabled" | "ready" | "requiresApproval" | "requiresAccessibility" | "unavailable">,
    passiveBaseline: ReadyAutoFillVaultContextState | null = null,
  ): Promise<AutoFillVaultContextState> {
    const epoch = ++this.epoch;
    this.passiveRefreshEpoch = passiveBaseline ? epoch : null;
    if (!passiveBaseline) {
      this.contextSession.clear();
      this.publish(Object.freeze({ status: "loading", epoch }));
    }
    const setupState = await resolveSetup();
    if (!this.owns(epoch)) return this.finishSuperseded(epoch);
    if (setupState !== "ready") return this.fail(epoch, "setup");

    const [initial] = await Promise.all([
      this.readLiveBinding(),
      this.websiteContext.refresh(),
    ]);
    if (!this.owns(epoch)) return this.finishSuperseded(epoch);
    if (!initial) return this.fail(epoch, "context");
    const initialServiceIdentifiers = websiteServiceIdentifiers(this.websiteContext.url());
    if (this.store.snapshot().vaultOwnerAccountId !== initial.session.accountId) {
      return this.fail(epoch, "account");
    }

    let candidates: readonly ContextualCandidate[];
    try {
      candidates = await this.contextualCandidates.queryAll(
        initial.application,
        initial.session,
        "",
        initialServiceIdentifiers,
      );
    } catch (error) {
      return this.fail(epoch, error instanceof AutoFillContextChangedError ? "context" : "session");
    }
    if (!this.owns(epoch)) return this.finishSuperseded(epoch);

    const [current] = await Promise.all([
      this.readLiveBinding(),
      this.websiteContext.refresh(),
    ]);
    if (!this.owns(epoch)) return this.finishSuperseded(epoch);
    if (!current || !applicationsEqual(initial.application, current.application)) return this.fail(epoch, "context");
    const currentServiceIdentifiers = websiteServiceIdentifiers(this.websiteContext.url());
    if (!stringArraysEqual(initialServiceIdentifiers, currentServiceIdentifiers)) {
      return this.fail(epoch, "context");
    }
    if (!sessionsEqual(initial.session, current.session)) {
      return this.fail(epoch, initial.session.accountId === current.session.accountId ? "session" : "account");
    }
    if (this.store.snapshot().vaultOwnerAccountId !== current.session.accountId) {
      return this.fail(epoch, "account");
    }

    try {
      this.contextSession.begin(current.application, current.context, current.session, candidates);
      const snapshot = this.contextSession.snapshot();
      if (!snapshot) return this.fail(epoch, "context");
      const ready = Object.freeze({
        status: "ready" as const,
        epoch,
        application: snapshot.application,
        serviceIdentifiers: initialServiceIdentifiers,
        context: snapshot.context,
        session: snapshot.session,
        candidates: snapshot.candidates,
      });
      this.finishPassiveRefresh(epoch);
      if (passiveBaseline && readyPresentationsEqual(passiveBaseline, ready)) {
        this.state = ready;
      } else {
        this.publish(ready);
      }
      return ready;
    } catch {
      return this.fail(epoch, "context");
    }
  }

  select(cipherId: string): ContextualCandidate | null {
    if (this.passiveRefreshInFlight()) return null;
    const state = this.snapshot();
    if (state.status !== "ready") return null;
    const candidate = state.candidates.find((value) => value.cipherId === cipherId) ?? null;
    if (!candidate || !this.contextSession.select(cipherId)) return null;
    return candidate;
  }

  selected(cipherId: string): SelectedAutoFillVaultCandidate | null {
    if (this.passiveRefreshInFlight()) return null;
    const state = this.snapshot();
    const session = this.contextSession.snapshot();
    if (state.status !== "ready" || !session || session.selectedCipherId !== cipherId) return null;
    const candidate = state.candidates.find((value) => value.cipherId === cipherId) ?? null;
    if (!candidate || !applicationsEqual(state.application, session.application)
        || !optionalContextsEqual(state.context, session.context)
        || !sessionsEqual(state.session, session.session)) return null;
    return Object.freeze({ application: state.application, context: state.context, session: state.session, candidate });
  }

  navigationChanged(url: string): void {
    const path = url.split(/[?#]/, 1)[0];
    if (path === "/tabs/vault") return;
    const selectedCipherId = this.contextSession.snapshot()?.selectedCipherId;
    if (selectedCipherId && path === `/view-cipher/${encodeURIComponent(selectedCipherId)}`) return;
    this.invalidate("navigation");
  }

  invalidate(_reason: "navigation" | "target" | "lock" | "account" | "cancel" | "destroy" = "cancel"): void {
    this.epoch += 1;
    this.passiveRefreshEpoch = null;
    this.contextSession.clear();
    if (this.state.status !== "idle") this.publish(IDLE);
  }

  private async readLiveBinding(): Promise<{
    readonly application: AutoFillApplicationContext;
    readonly context: LiveAutoFillContext | null;
    readonly session: AutoFillAgentSession;
  } | null> {
    const [entry, session] = await Promise.all([
      this.native.entryContext().catch(() => ({ status: "unavailable" as const })),
      this.native.agentSession().catch(() => ({ status: "error" as const, code: "unavailable" })),
    ]);
    if (entry.status !== "available" || session.status !== "success") return null;
    try {
      return Object.freeze({
        application: decodeAutoFillApplicationContext(entry.application),
        context: entry.fillContext === null ? null : decodeLiveAutoFillContext(entry.fillContext),
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
    this.finishPassiveRefresh(epoch);
    this.contextSession.clear();
    const unavailable = Object.freeze({ status: "unavailable" as const, reason });
    this.publish(unavailable);
    return unavailable;
  }

  private owns(epoch: number): boolean {
    return epoch === this.epoch;
  }

  private passiveRefreshInFlight(): boolean {
    return this.passiveRefreshEpoch === this.epoch;
  }

  private finishPassiveRefresh(epoch: number): void {
    if (this.passiveRefreshEpoch === epoch) this.passiveRefreshEpoch = null;
  }

  private finishSuperseded(epoch: number): AutoFillVaultContextState {
    this.finishPassiveRefresh(epoch);
    return this.state;
  }

  private publish(state: AutoFillVaultContextState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

function applicationsEqual(left: AutoFillApplicationContext, right: AutoFillApplicationContext): boolean {
  return left.bundleId === right.bundleId && left.appName === right.appName;
}

function optionalContextsEqual(left: LiveAutoFillContext | null, right: LiveAutoFillContext | null): boolean {
  return left === null || right === null ? left === right : contextsEqual(left, right);
}

function sessionsEqual(left: AutoFillAgentSession, right: AutoFillAgentSession): boolean {
  return left.accountId === right.accountId
    && left.generation === right.generation
    && left.vaultRevision === right.vaultRevision;
}

function websiteServiceIdentifiers(url: string | null): readonly string[] {
  return Object.freeze(url === null ? [] : [url]);
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readyPresentationsEqual(
  left: ReadyAutoFillVaultContextState,
  right: ReadyAutoFillVaultContextState,
): boolean {
  if ((left.context === null) !== (right.context === null)) return false;
  if (left.candidates.length !== right.candidates.length) return false;
  return left.candidates.every((candidate, index) => {
    const other = right.candidates[index];
    return other !== undefined
      && candidate.cipherId === other.cipherId
      && candidate.displayName === other.displayName
      && candidate.username === other.username
      && candidate.group === other.group
      && candidate.reason === other.reason
      && stringArraysEqual(candidate.availableFields, other.availableFields);
  });
}
