import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";

import type { AutoFillAgentSession } from "./autofill-native.host";
import {
  contextsEqual,
  immutableAuthorizationMap,
  type ContextualCandidate,
  type LiveAutoFillContext,
} from "./autofill-fill-context.model";

const CONTEXT_LIFETIME_MS = 30_000;

export const AUTOFILL_CONTEXT_CLOCK = new InjectionToken<() => number>("AUTOFILL_CONTEXT_CLOCK", {
  providedIn: "root",
  factory: () => Date.now,
});

export interface AutoFillContextSessionSnapshot {
  readonly context: LiveAutoFillContext;
  readonly session: AutoFillAgentSession;
  readonly candidates: readonly ContextualCandidate[];
  readonly selectedCipherId: string | null;
}

interface StoredContextSession extends AutoFillContextSessionSnapshot {
  readonly expiresAt: number;
}

@Injectable({ providedIn: "root" })
export class AutoFillContextSessionService {
  private state: StoredContextSession | null = null;

  constructor(
    @Optional() @Inject(AUTOFILL_CONTEXT_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  begin(
    context: LiveAutoFillContext,
    session: AutoFillAgentSession,
    candidates: readonly ContextualCandidate[],
  ): void {
    this.state = {
      context: cloneContext(context),
      session: Object.freeze({ ...session }),
      candidates: cloneCandidates(candidates),
      selectedCipherId: null,
      expiresAt: this.clock() + CONTEXT_LIFETIME_MS,
    };
  }

  snapshot(): AutoFillContextSessionSnapshot | null {
    const state = this.liveState();
    if (!state) return null;
    return Object.freeze({
      context: state.context,
      session: state.session,
      candidates: cloneCandidates(state.candidates),
      selectedCipherId: state.selectedCipherId,
    });
  }

  select(cipherId: string): boolean {
    const state = this.liveState();
    if (!state || !state.candidates.some((candidate) => candidate.cipherId === cipherId)) return false;
    this.state = { ...state, selectedCipherId: cipherId };
    return true;
  }

  validate(context: LiveAutoFillContext, session: AutoFillAgentSession): boolean {
    const state = this.liveState();
    if (state && contextsEqual(state.context, context) && sessionsEqual(state.session, session)) return true;
    this.clear();
    return false;
  }

  lock(): void { this.clear(); }
  cancel(): void { this.clear(); }
  targetMismatch(): void { this.clear(); }

  accountSwitched(accountId: string): void {
    if (this.state?.session.accountId !== accountId) this.clear();
  }

  navigationChanged(url: string): void {
    const path = url.split(/[?#]/, 1)[0];
    if (path !== "/autofill" && !path.startsWith("/view-cipher/")) this.clear();
  }

  clear(): void {
    this.state = null;
  }

  private liveState(): StoredContextSession | null {
    if (this.state && this.clock() >= this.state.expiresAt) this.clear();
    return this.state;
  }
}

function sessionsEqual(left: AutoFillAgentSession, right: AutoFillAgentSession): boolean {
  return left.accountId === right.accountId
    && left.generation === right.generation
    && left.vaultRevision === right.vaultRevision;
}

function cloneContext(context: LiveAutoFillContext): LiveAutoFillContext {
  return Object.freeze({
    ...context,
    focusedField: Object.freeze({ ...context.focusedField }),
    action: Object.freeze({ ...context.action, fields: Object.freeze([...context.action.fields]) }),
  });
}

function cloneCandidates(candidates: readonly ContextualCandidate[]): readonly ContextualCandidate[] {
  return Object.freeze(candidates.map((candidate) => Object.freeze({
    ...candidate,
    availableFields: Object.freeze([...candidate.availableFields]),
    authorizations: immutableAuthorizationMap(candidate.authorizations),
  })));
}
