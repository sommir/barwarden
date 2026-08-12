import { describe, expect, it, vi } from "vitest";

import { PopupStateStore } from "../popup-state";
import { AutoFillContextSessionService } from "./autofill-context-session.service";
import type { AutoFillContextualCandidatesService } from "./autofill-contextual-candidates.service";
import {
  immutableAuthorizationMap,
  type ContextualCandidate,
  type AutoFillApplicationContext,
  type LiveAutoFillContext,
} from "./autofill-fill-context.model";
import type { AutoFillAgentSession, AutoFillNativeHost } from "./autofill-native.host";
import type { AutoFillSetupService } from "./autofill-setup.service";
import { AutoFillVaultContextService } from "./autofill-vault-context.service";

const CONTEXT: LiveAutoFillContext = Object.freeze({
  bundleId: "com.example.Terminal",
  appName: "Terminal",
  fillContextToken: "00000000-0000-4000-8000-000000000005",
  focusedField: Object.freeze({ kind: "password", confidence: "high" }),
  action: Object.freeze({ mode: "form", fields: Object.freeze(["username", "password"]) }),
});
const APPLICATION: AutoFillApplicationContext = Object.freeze({
  bundleId: CONTEXT.bundleId,
  appName: CONTEXT.appName,
});

const SESSION: AutoFillAgentSession = Object.freeze({
  accountId: "account-a",
  generation: "00000000-0000-4000-8000-000000000004",
  vaultRevision: 7,
});

const CANDIDATE: ContextualCandidate = Object.freeze({
  cipherId: "login-a",
  displayName: "Terminal",
  username: "demo@example.test",
  group: "exact",
  reason: "service_identifier",
  availableFields: Object.freeze(["username", "password"]),
  authorizations: immutableAuthorizationMap([
    ["username", { contextToken: "username-token", requiresMismatchConfirmation: false }],
    ["password", { contextToken: "password-token", requiresMismatchConfirmation: false }],
  ]),
});

describe("AutoFillVaultContextService", () => {
  it("stays idle without touching native AutoFill during an ordinary vault open", () => {
    const harness = createHarness();

    expect(harness.service.snapshot()).toEqual({ status: "idle" });
    expect(harness.native.entryContext).not.toHaveBeenCalled();
    expect(harness.native.agentSession).not.toHaveBeenCalled();
    expect(harness.contextual.queryAll).not.toHaveBeenCalled();
  });

  it("discovers the captured frontmost app during an ordinary enabled vault open without enabling setup", async () => {
    const harness = createHarness();

    const state = await harness.service.beginFromVaultOpen();

    expect(state).toMatchObject({
      status: "ready",
      application: APPLICATION,
      context: CONTEXT,
      session: SESSION,
      candidates: [CANDIDATE],
    });
    expect(harness.setup.blockReason).toHaveBeenCalledOnce();
    expect(harness.setup.enableFromEntry).not.toHaveBeenCalled();
    expect(harness.native.entryContext).toHaveBeenCalled();
  });

  it("keeps an ordinary vault open idle when AutoFill setup is not already ready", async () => {
    const harness = createHarness({ setupState: "disabled" });

    await expect(harness.service.beginFromVaultOpen()).resolves.toEqual({ status: "idle" });

    expect(harness.native.entryContext).not.toHaveBeenCalled();
    expect(harness.contextual.queryAll).not.toHaveBeenCalled();
    expect(harness.setup.enableFromEntry).not.toHaveBeenCalled();
  });

  it("publishes one immutable ready snapshot only after setup, context, session, owner, and candidates agree", async () => {
    const harness = createHarness();
    const states: string[] = [];
    harness.service.subscribe(() => states.push(harness.service.snapshot().status));

    const state = await harness.service.beginFromEntry();

    expect(states).toEqual(["loading", "ready"]);
    expect(state).toMatchObject({
      status: "ready",
      application: APPLICATION,
      context: CONTEXT,
      session: SESSION,
      candidates: [CANDIDATE],
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.status === "ready" ? state.candidates : [])).toBe(true);
    expect(harness.contextSession.snapshot()).toMatchObject({
      application: APPLICATION,
      context: CONTEXT,
      session: SESSION,
      candidates: [CANDIDATE],
    });
  });

  it("drops a late result when the target changes while candidates are in flight", async () => {
    const pending = deferred<readonly ContextualCandidate[]>();
    const harness = createHarness({ queryAll: () => pending.promise });
    const begin = harness.service.beginFromEntry();
    await vi.waitFor(() => expect(harness.contextual.queryAll).toHaveBeenCalledOnce());
    vi.mocked(harness.native.entryContext).mockResolvedValue({
      status: "available",
      application: { ...APPLICATION, appName: "Other" },
      fillContext: { ...CONTEXT, appName: "Other" },
    });

    pending.resolve([CANDIDATE]);

    await expect(begin).resolves.toEqual({ status: "unavailable", reason: "context" });
    expect(harness.contextSession.snapshot()).toBeNull();
  });

  it.each([
    [{ accountId: "account-b" }, "account"],
    [{ generation: "00000000-0000-4000-8000-000000000099" }, "session"],
    [{ vaultRevision: 8 }, "session"],
  ] as const)("drops a late result when Agent session changes: %o", async (change, reason) => {
    const pending = deferred<readonly ContextualCandidate[]>();
    const harness = createHarness({ queryAll: () => pending.promise });
    const begin = harness.service.beginFromEntry();
    await vi.waitFor(() => expect(harness.contextual.queryAll).toHaveBeenCalledOnce());
    vi.mocked(harness.native.agentSession).mockResolvedValue({ status: "success", ...SESSION, ...change });

    pending.resolve([CANDIDATE]);

    await expect(begin).resolves.toEqual({ status: "unavailable", reason });
    expect(harness.contextSession.snapshot()).toBeNull();
  });

  it("returns only the exact selected live binding and burns it on invalidation", async () => {
    const harness = createHarness();
    await harness.service.beginFromEntry();

    expect(harness.service.select("missing")).toBeNull();
    expect(harness.service.select("login-a")).toEqual(CANDIDATE);
    expect(harness.service.selected("login-a")).toEqual({
      application: APPLICATION,
      context: CONTEXT,
      session: SESSION,
      candidate: CANDIDATE,
    });

    harness.service.invalidate("target");

    expect(harness.service.snapshot()).toEqual({ status: "idle" });
    expect(harness.service.selected("login-a")).toBeNull();
    expect(harness.contextSession.snapshot()).toBeNull();
  });

  it("retains the journey only across the vault and its exact selected detail", async () => {
    const harness = createHarness();
    await harness.service.beginFromEntry();
    expect(harness.service.select("login-a")).toEqual(CANDIDATE);

    harness.service.navigationChanged("/view-cipher/login-a?from=vault");
    expect(harness.service.selected("login-a")).not.toBeNull();
    harness.service.navigationChanged("/tabs/vault");
    expect(harness.service.snapshot().status).toBe("ready");

    harness.service.navigationChanged("/tabs/settings");
    expect(harness.service.snapshot()).toEqual({ status: "idle" });
    expect(harness.contextSession.snapshot()).toBeNull();
  });

  it("burns the journey when detail navigation targets another cipher", async () => {
    const harness = createHarness();
    await harness.service.beginFromEntry();
    expect(harness.service.select("login-a")).toEqual(CANDIDATE);

    harness.service.navigationChanged("/view-cipher/other");

    expect(harness.service.snapshot()).toEqual({ status: "idle" });
    expect(harness.contextSession.snapshot()).toBeNull();
  });

  it("fails closed when the projected vault owner does not match the Agent account", async () => {
    const harness = createHarness({ owner: "account-b" });

    await expect(harness.service.beginFromEntry()).resolves.toEqual({
      status: "unavailable",
      reason: "account",
    });
    expect(harness.contextual.queryAll).not.toHaveBeenCalled();
  });

  it("publishes application-ranked suggestions when no writable field is detected", async () => {
    const harness = createHarness({ fillContext: null });

    await expect(harness.service.beginFromEntry()).resolves.toMatchObject({
      status: "ready",
      application: APPLICATION,
      context: null,
      candidates: [CANDIDATE],
    });
    expect(harness.contextual.queryAll).toHaveBeenCalledWith(APPLICATION, SESSION, "");
  });
});

function createHarness(options: {
  owner?: string;
  queryAll?: () => Promise<readonly ContextualCandidate[]>;
  setupState?: "disabled" | "ready" | "requiresApproval" | "requiresAccessibility" | "unavailable";
  fillContext?: LiveAutoFillContext | null;
} = {}) {
  const native: AutoFillNativeHost = {
    entryContext: vi.fn(async () => ({
      status: "available",
      application: APPLICATION,
      fillContext: options.fillContext === undefined ? CONTEXT : options.fillContext,
    })),
    agentSession: vi.fn(async () => ({ status: "success", ...SESSION })),
    beginReprompt: vi.fn(),
    cancelReprompt: vi.fn(),
    beginRepromptBatch: vi.fn(),
    cancelRepromptBatch: vi.fn(),
    biometricReprompt: vi.fn(),
    fillDetected: vi.fn(),
    releaseSecret: vi.fn(),
    pasteText: vi.fn(),
    copyText: vi.fn(),
  };
  const contextual = {
    queryAll: vi.fn(options.queryAll ?? (async () => [CANDIDATE])),
  };
  const setup = {
    blockReason: vi.fn(() => options.setupState ?? "ready"),
    enableFromEntry: vi.fn(async () => "ready" as const),
  };
  const store = new PopupStateStore();
  store.setItems([], [], new Date("2026-08-11T00:00:00Z"), options.owner ?? "account-a");
  const contextSession = new AutoFillContextSessionService(() => Date.now());
  const service = new AutoFillVaultContextService(
    setup as AutoFillSetupService,
    native,
    contextual as unknown as AutoFillContextualCandidatesService,
    store,
    contextSession,
  );
  return { service, native, contextual, setup, store, contextSession };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
