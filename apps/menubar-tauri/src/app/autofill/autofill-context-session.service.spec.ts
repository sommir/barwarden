import { describe, expect, it, vi } from "vitest";

import type { AutoFillAgentSession } from "./autofill-native.host";
import { AutoFillContextSessionService } from "./autofill-context-session.service";
import type { ContextualCandidate, LiveAutoFillContext } from "./autofill-fill-context.model";

const context: LiveAutoFillContext = {
  bundleId: "com.example.Terminal",
  appName: "Terminal",
  fillContextToken: "00000000-0000-4000-8000-000000000005",
  focusedField: { kind: "password", confidence: "high" },
  action: { mode: "form", fields: ["username", "password"] },
};
const session: AutoFillAgentSession = {
  generation: "00000000-0000-4000-8000-000000000004",
  accountId: "account-a",
  vaultRevision: 7,
};
const candidate: ContextualCandidate = {
  cipherId: "cipher-a",
  displayName: "Example",
  username: "person@example.test",
  group: "exact",
  reason: "service_identifier",
  availableFields: ["username", "password"],
  authorizations: new Map([
    ["username", { contextToken: "username-token", requiresMismatchConfirmation: false }],
    ["password", { contextToken: "password-token", requiresMismatchConfirmation: false }],
  ]),
};

describe("AutoFillContextSessionService", () => {
  it("keeps one picker-to-detail matrix in memory and returns immutable snapshots", () => {
    const service = new AutoFillContextSessionService(() => 1_000);
    service.begin(context, session, [candidate]);
    expect(service.select("cipher-a")).toBe(true);

    const snapshot = service.snapshot();
    expect(snapshot).toMatchObject({ context, session, selectedCipherId: "cipher-a" });
    expect(snapshot?.candidates).not.toBe((service.snapshot() as { candidates: unknown }).candidates);
    expect(Object.isFrozen(snapshot?.candidates)).toBe(true);
  });

  it.each([
    ["lock", (service: AutoFillContextSessionService) => service.lock()],
    ["account switch", (service: AutoFillContextSessionService) => service.accountSwitched("account-b")],
    ["picker cancel", (service: AutoFillContextSessionService) => service.cancel()],
    ["target mismatch", (service: AutoFillContextSessionService) => service.targetMismatch()],
    ["navigation away", (service: AutoFillContextSessionService) => service.navigationChanged("/vault")],
  ])("clears ephemeral state on %s", (_name, invalidate) => {
    const service = new AutoFillContextSessionService(() => 1_000);
    service.begin(context, session, [candidate]);
    invalidate(service);
    expect(service.snapshot()).toBeNull();
  });

  it("retains state only across picker/detail navigation and clears after absolute expiry", () => {
    let now = 1_000;
    const service = new AutoFillContextSessionService(() => now);
    service.begin(context, session, [candidate]);
    service.navigationChanged("/autofill");
    service.navigationChanged("/view-cipher/cipher-a");
    expect(service.snapshot()).not.toBeNull();

    now += 30_000;
    expect(service.snapshot()).toBeNull();
  });

  it("clears when app, context token, account, generation, or revision changes", () => {
    const mutations: Array<[LiveAutoFillContext, AutoFillAgentSession]> = [
      [{ ...context, bundleId: "com.example.Other" }, session],
      [{ ...context, fillContextToken: "00000000-0000-4000-8000-000000000006" }, session],
      [context, { ...session, accountId: "account-b" }],
      [context, { ...session, generation: "00000000-0000-4000-8000-000000000006" }],
      [context, { ...session, vaultRevision: 8 }],
    ];
    for (const [nextContext, nextSession] of mutations) {
      const service = new AutoFillContextSessionService(() => 1_000);
      service.begin(context, session, [candidate]);
      expect(service.validate(nextContext, nextSession)).toBe(false);
      expect(service.snapshot()).toBeNull();
    }
  });

  it("strictly projects runtime values so undeclared secret, value, nonenumerable, and symbol keys cannot enter", () => {
    const service = new AutoFillContextSessionService(() => 1_000);
    const hostileContext = { ...context, secret: "must-not-enter" };
    Object.defineProperty(hostileContext, "value", { enumerable: false, value: "hidden" });
    Object.defineProperty(hostileContext, Symbol("secret"), { value: "hidden" });
    expect(() => service.begin(hostileContext, session, [candidate])).toThrow("invalid AutoFill context session");

    const hostileCandidate = { ...candidate, password: undefined };
    expect(() => service.begin(context, session, [hostileCandidate])).toThrow("invalid AutoFill context session");
    const hostileAuthorizations = new Map(candidate.authorizations);
    Object.defineProperty(hostileAuthorizations, Symbol("value"), { value: "hidden" });
    expect(() => service.begin(context, session, [{
      ...candidate,
      authorizations: hostileAuthorizations,
    }])).toThrow("invalid AutoFill context session");
    expect(service.snapshot()).toBeNull();
  });

  it("notifies active actions on selection, clear, navigation, and expiry", () => {
    let now = 1_000;
    const service = new AutoFillContextSessionService(() => now);
    const invalidated = vi.fn();
    service.onInvalidate(invalidated);
    service.begin(context, session, [candidate]);
    service.select("cipher-a");
    expect(invalidated).toHaveBeenCalledTimes(1);
    service.navigationChanged("/vault");
    expect(invalidated).toHaveBeenCalledTimes(2);
    service.begin(context, session, [candidate]);
    now += 30_000;
    service.snapshot();
    expect(invalidated).toHaveBeenCalledTimes(3);
  });

  it("never stores a stateful vault revision accessor's second value", () => {
    let reads = 0;
    const hostileSession = {
      accountId: session.accountId,
      generation: session.generation,
      get vaultRevision() {
        reads += 1;
        return reads === 1 ? session.vaultRevision : "secret-revision";
      },
    };
    const service = new AutoFillContextSessionService(() => 1_000);
    expect(() => service.begin(context, hostileSession as never, [candidate]))
      .toThrow("invalid AutoFill context session");
    expect(reads).toBeLessThanOrEqual(1);
    expect(service.snapshot()).toBeNull();
    expect(JSON.stringify(service.snapshot())).not.toContain("secret-revision");
  });
});
