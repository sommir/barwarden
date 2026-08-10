import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";

import type { AutoFillAgentSession } from "./autofill-native.host";
import {
  contextsEqual,
  decodeLiveAutoFillContext,
  projectAutoFillAgentSession,
  projectContextualCandidate,
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
  private readonly invalidationListeners = new Set<() => void>();

  constructor(
    @Optional() @Inject(AUTOFILL_CONTEXT_CLOCK) private readonly clock: () => number = Date.now,
  ) {}

  begin(
    context: LiveAutoFillContext,
    session: AutoFillAgentSession,
    candidates: readonly ContextualCandidate[],
  ): void {
    try {
      const candidateValues = snapshotDenseArray(candidates, 0, 500);
      const projectedContext = decodeLiveAutoFillContext(context);
      const projectedSession = projectAutoFillAgentSession(session);
      const projectedCandidates = projectCandidates(candidateValues as readonly ContextualCandidate[]);
      if (this.state) this.invalidate();
      this.state = Object.freeze({
        context: projectedContext,
        session: projectedSession,
        candidates: projectedCandidates,
        selectedCipherId: null,
        expiresAt: this.clock() + CONTEXT_LIFETIME_MS,
      });
    } catch {
      this.clear();
      throw new Error("invalid AutoFill context session");
    }
  }

  snapshot(): AutoFillContextSessionSnapshot | null {
    const state = this.liveState();
    if (!state) return null;
    return Object.freeze({
      context: state.context,
      session: state.session,
      candidates: projectCandidates(state.candidates),
      selectedCipherId: state.selectedCipherId,
    });
  }

  select(cipherId: string): boolean {
    const state = this.liveState();
    if (!state || !state.candidates.some((candidate) => candidate.cipherId === cipherId)) return false;
    if (state.selectedCipherId !== cipherId) this.invalidate();
    this.state = Object.freeze({
      context: state.context,
      session: state.session,
      candidates: state.candidates,
      selectedCipherId: cipherId,
      expiresAt: state.expiresAt,
    });
    return true;
  }

  onInvalidate(listener: () => void): () => void {
    this.invalidationListeners.add(listener);
    return () => this.invalidationListeners.delete(listener);
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
    if (this.state) this.invalidate();
    this.state = null;
  }

  private liveState(): StoredContextSession | null {
    if (this.state && this.clock() >= this.state.expiresAt) this.clear();
    return this.state;
  }

  private invalidate(): void {
    for (const listener of [...this.invalidationListeners]) listener();
  }
}

function sessionsEqual(left: AutoFillAgentSession, right: AutoFillAgentSession): boolean {
  return left.accountId === right.accountId
    && left.generation === right.generation
    && left.vaultRevision === right.vaultRevision;
}

function projectCandidates(candidates: readonly ContextualCandidate[]): readonly ContextualCandidate[] {
  const projected = candidates.map((candidate) => projectContextualCandidate(candidate));
  if (new Set(projected.map(({ cipherId }) => cipherId)).size !== projected.length) {
    throw new Error("duplicate contextual candidate");
  }
  return Object.freeze(projected);
}

function snapshotDenseArray(input: unknown, minimum: number, maximum: number): readonly unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) {
    throw new Error("invalid array");
  }
  const keys = Reflect.ownKeys(input);
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(input, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < minimum || lengthDescriptor.value > maximum) {
    throw new Error("invalid array length");
  }
  const length = lengthDescriptor.value as number;
  const expectedKeys = new Set<string>(["length", ...Array.from({ length }, (_, index) => String(index))]);
  if (keys.length !== expectedKeys.size
      || keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))) {
    throw new Error("invalid array keys");
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor)) throw new Error("invalid array descriptor");
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}
