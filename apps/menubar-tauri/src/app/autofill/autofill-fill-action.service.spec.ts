import { describe, expect, it, vi } from "vitest";

import { AutoFillFillActionService } from "./autofill-fill-action.service";
import { AutoFillContextSessionService } from "./autofill-context-session.service";
import type { ContextualCandidate, LiveAutoFillContext } from "./autofill-fill-context.model";
import type { AutoFillAgentSession, AutoFillNativeHost } from "./autofill-native.host";

const context: LiveAutoFillContext = {
  bundleId: "com.example.Terminal",
  appName: "Terminal",
  fillContextToken: "00000000-0000-4000-8000-000000000005",
  focusedField: { kind: "password", confidence: "high" },
  action: { mode: "form", fields: ["username", "password"] },
};
const session: AutoFillAgentSession = {
  accountId: "account-a",
  generation: "00000000-0000-4000-8000-000000000004",
  vaultRevision: 7,
};

describe("AutoFillFillActionService", () => {
  it("requires one candidate to authorize every native form field", () => {
    const service = new AutoFillFillActionService(host());
    expect(service.prepare(context, session, candidate(["username"]))).toEqual({
      status: "unavailable",
      reason: "missing-required-field",
    });
    expect(service.prepare(context, session, {
      ...candidate(["username", "password"]),
      availableFields: ["username"],
    })).toEqual({ status: "unavailable", reason: "missing-required-field" });
    expect(service.prepare({ ...context, action: { mode: "choose", fields: ["password"] } }, session, candidate(["password"])))
      .toEqual({ status: "choose", fields: ["password"] });
  });

  it("builds canonical per-field scopes without plaintext secret properties", () => {
    const prepared = new AutoFillFillActionService(host()).prepare(
      context,
      session,
      candidate(["username", "password"]),
    );
    expect(prepared).toMatchObject({
      status: "ready",
      fields: ["username", "password"],
      requiresMismatchConfirmation: true,
    });
    expect(JSON.stringify(prepared)).not.toMatch(/"value"|"secret"|"totp"/i);
  });

  it("begins one exact batch reprompt and fills only after its receipt is supplied", async () => {
    const native = host();
    vi.mocked(native.beginRepromptBatch).mockResolvedValue({ status: "pending", receipt: "receipt-a" });
    vi.mocked(native.fillDetected).mockResolvedValue({ status: "success", fields: ["username", "password"] });
    const service = new AutoFillFillActionService(native);
    const prepared = service.prepare(context, session, candidate(["username", "password"]));
    if (prepared.status !== "ready") throw new Error("expected ready action");

    await expect(service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: true }))
      .resolves.toEqual({ status: "reprompt-required", receipt: "receipt-a", scopes: prepared.scopes });
    await expect(service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: true }))
      .resolves.toEqual({ status: "unavailable", reason: "reprompt-already-started" });
    expect(native.fillDetected).not.toHaveBeenCalled();

    await expect(service.execute(prepared, {
      mismatchConfirmed: true,
      requiresReprompt: true,
      repromptVerified: true,
    })).resolves.toEqual({ status: "success", fields: ["username", "password"] });
    expect(native.fillDetected).toHaveBeenCalledWith({
      fillContextToken: context.fillContextToken,
      authorizations: prepared.scopes.map((scope) => ({
        scope,
        mismatchConfirmed: scope.field === "password",
      })),
      repromptReceipt: "receipt-a",
    });
  });

  it("cancels exactly the selected scopes and burns the prepared action", async () => {
    const native = host();
    vi.mocked(native.beginRepromptBatch).mockResolvedValue({ status: "pending", receipt: "receipt-a" });
    const service = new AutoFillFillActionService(native);
    const prepared = service.prepare(context, session, candidate(["username", "password"]));
    if (prepared.status !== "ready") throw new Error("expected ready action");
    await service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: true });
    await service.cancel(prepared);
    expect(native.cancelRepromptBatch).toHaveBeenCalledWith(prepared.scopes, "receipt-a");
    await expect(service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: false }))
      .resolves.toEqual({ status: "unavailable", reason: "action-consumed" });
  });

  it("cancels an active batch receipt when the live context changes", async () => {
    const native = host();
    vi.mocked(native.beginRepromptBatch).mockResolvedValue({ status: "pending", receipt: "receipt-a" });
    const service = new AutoFillFillActionService(native);
    const prepared = service.prepare(context, session, candidate(["username", "password"]));
    if (prepared.status !== "ready") throw new Error("expected ready action");
    await service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: true });
    vi.mocked(native.entryContext).mockResolvedValue({
      status: "available",
      context: { ...context, appName: "Other" },
    });

    await expect(service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: true }))
      .resolves.toEqual({ status: "unavailable", reason: "stale-context" });
    expect(native.cancelRepromptBatch).toHaveBeenCalledWith(prepared.scopes, "receipt-a");
  });

  it("linearizes concurrent execute calls so only one begin and one fill can run", async () => {
    const native = host();
    const begin = deferred<{ status: "pending"; receipt: string }>();
    vi.mocked(native.beginRepromptBatch).mockImplementation(() => begin.promise);
    const service = new AutoFillFillActionService(native);
    const prepared = ready(service);
    const first = service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: true });
    const second = service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: true });
    await vi.waitFor(() => expect(native.beginRepromptBatch).toHaveBeenCalledOnce());
    await expect(second).resolves.toEqual({ status: "unavailable", reason: "action-in-progress" });
    begin.resolve({ status: "pending", receipt: "receipt-a" });
    await expect(first).resolves.toMatchObject({ status: "reprompt-required", receipt: "receipt-a" });

    const fill = deferred<{ status: "success"; fields: readonly ["username", "password"] }>();
    vi.mocked(native.fillDetected).mockImplementation(() => fill.promise);
    const filling = service.execute(prepared, {
      mismatchConfirmed: true, requiresReprompt: true, repromptVerified: true,
    });
    await expect(service.execute(prepared, {
      mismatchConfirmed: true, requiresReprompt: true, repromptVerified: true,
    })).resolves.toEqual({ status: "unavailable", reason: "action-in-progress" });
    await vi.waitFor(() => expect(native.fillDetected).toHaveBeenCalledOnce());
    fill.resolve({ status: "success", fields: ["username", "password"] });
    await filling;
  });

  it("burns a late receipt when cancellation or staleness wins during begin", async () => {
    for (const invalidate of ["cancel", "stale"] as const) {
      const native = host();
      const begin = deferred<{ status: "pending"; receipt: string }>();
      vi.mocked(native.beginRepromptBatch).mockImplementation(() => begin.promise);
      const service = new AutoFillFillActionService(native);
      const prepared = ready(service);
      const execution = service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: true });
      await vi.waitFor(() => expect(native.beginRepromptBatch).toHaveBeenCalledOnce());
      if (invalidate === "cancel") await service.cancel(prepared);
      else vi.mocked(native.entryContext).mockResolvedValue({
        status: "available", context: { ...context, fillContextToken: "00000000-0000-4000-8000-000000000006" },
      });
      begin.resolve({ status: "pending", receipt: `receipt-${invalidate}` });
      await execution;
      expect(native.cancelRepromptBatch).toHaveBeenCalledWith(prepared.scopes, `receipt-${invalidate}`);
      expect(native.fillDetected).not.toHaveBeenCalled();
    }
  });

  it("retains and burns the exact stored receipt when native fill throws", async () => {
    const native = host();
    vi.mocked(native.beginRepromptBatch).mockResolvedValue({ status: "pending", receipt: "receipt-exact" });
    vi.mocked(native.fillDetected).mockRejectedValue(new Error("secret detail"));
    const service = new AutoFillFillActionService(native);
    const prepared = ready(service);
    await service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: true });
    await expect(service.execute(prepared, {
      mismatchConfirmed: true, requiresReprompt: true, repromptVerified: true,
    })).resolves.toEqual({ status: "unavailable", reason: "fill-unavailable" });
    expect(native.cancelRepromptBatch).toHaveBeenCalledWith(prepared.scopes, "receipt-exact");
  });

  it("linearizes cancellation against a pending fill and only cancels the stored receipt", async () => {
    const native = host();
    const fill = deferred<{ status: "success"; fields: readonly ["username", "password"] }>();
    vi.mocked(native.beginRepromptBatch).mockResolvedValue({ status: "pending", receipt: "receipt-stored" });
    vi.mocked(native.fillDetected).mockImplementation(() => fill.promise);
    const service = new AutoFillFillActionService(native);
    const prepared = ready(service);
    await service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: true });
    const execution = service.execute(prepared, {
      mismatchConfirmed: true,
      requiresReprompt: true,
      repromptVerified: true,
      repromptReceipt: "caller-supplied-must-be-ignored",
    } as ExecuteOptionsWithHostileReceipt);
    await vi.waitFor(() => expect(native.fillDetected).toHaveBeenCalledOnce());
    await service.cancel(prepared);
    fill.resolve({ status: "success", fields: ["username", "password"] });

    await expect(execution).resolves.toEqual({ status: "unavailable", reason: "action-consumed" });
    expect(native.cancelRepromptBatch).toHaveBeenCalledWith(prepared.scopes, "receipt-stored");
    expect(native.cancelRepromptBatch).not.toHaveBeenCalledWith(prepared.scopes, "caller-supplied-must-be-ignored");
  });

  it("burns active actions when their ephemeral session clears, expires, navigates, or selection changes", async () => {
    for (const invalidate of ["clear", "expiry", "navigation", "selection"] as const) {
      let now = 1_000;
      const contextSession = new AutoFillContextSessionService(() => now);
      contextSession.begin(context, session, [candidate(["username", "password"])]);
      const native = host();
      vi.mocked(native.beginRepromptBatch).mockResolvedValue({ status: "pending", receipt: `receipt-${invalidate}` });
      const service = new AutoFillFillActionService(native, contextSession);
      const prepared = ready(service);
      await service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: true });
      if (invalidate === "clear") contextSession.clear();
      if (invalidate === "expiry") { now += 30_000; contextSession.snapshot(); }
      if (invalidate === "navigation") contextSession.navigationChanged("/vault");
      if (invalidate === "selection") contextSession.select("cipher-a");
      await vi.waitFor(() => expect(native.cancelRepromptBatch).toHaveBeenCalledWith(
        prepared.scopes, `receipt-${invalidate}`,
      ));
      await expect(service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: false }))
        .resolves.toEqual({ status: "unavailable", reason: "action-consumed" });
    }
  });

  it("snapshots mutable prepare inputs and preserves mixed per-field mismatch authorization", async () => {
    const native = host();
    vi.mocked(native.fillDetected).mockResolvedValue({ status: "success", fields: ["username", "password"] });
    const mutableContext = {
      bundleId: context.bundleId,
      appName: context.appName,
      fillContextToken: context.fillContextToken,
      focusedField: { kind: context.focusedField.kind, confidence: context.focusedField.confidence },
      action: { mode: context.action.mode, fields: [...context.action.fields] },
    };
    const mutableSession = { ...session };
    const mutableCandidate = candidate(["username", "password"]);
    const service = new AutoFillFillActionService(native);
    const prepared = service.prepare(mutableContext, mutableSession, mutableCandidate);
    if (prepared.status !== "ready") throw new Error("expected ready action");
    mutableContext.appName = "Mutated";
    mutableSession.accountId = "account-b";
    (mutableCandidate.authorizations as Map<string, unknown>).set("password", {
      contextToken: "mutated-token", requiresMismatchConfirmation: false,
    });

    await expect(service.execute(prepared, { mismatchConfirmed: false, requiresReprompt: false }))
      .resolves.toEqual({ status: "confirmation-required" });
    await service.execute(prepared, { mismatchConfirmed: true, requiresReprompt: false });
    expect(native.fillDetected).toHaveBeenCalledWith({
      fillContextToken: context.fillContextToken,
      authorizations: [
        { scope: expect.objectContaining({ field: "username", contextToken: "username-token" }), mismatchConfirmed: false },
        { scope: expect.objectContaining({ field: "password", contextToken: "password-token" }), mismatchConfirmed: true },
      ],
    });
    expect(Object.isFrozen(prepared.context)).toBe(true);
    expect(Object.isFrozen(prepared.scopes)).toBe(true);
  });
});

type ExecuteOptionsWithHostileReceipt = Parameters<AutoFillFillActionService["execute"]>[1] & {
  readonly repromptReceipt: string;
};

function ready(service: AutoFillFillActionService) {
  const prepared = service.prepare(context, session, candidate(["username", "password"]));
  if (prepared.status !== "ready") throw new Error("expected ready action");
  return prepared;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function candidate(fields: readonly ("username" | "password" | "totp")[]): ContextualCandidate {
  return {
    cipherId: "cipher-a",
    displayName: "Example",
    username: "person@example.test",
    group: "exact",
    reason: "service_identifier",
    availableFields: fields,
    authorizations: new Map(fields.map((field) => [field, {
      contextToken: `${field}-token`,
      requiresMismatchConfirmation: field === "password",
    }])),
  };
}

function host(): AutoFillNativeHost {
  return {
    entryContext: vi.fn<AutoFillNativeHost["entryContext"]>(async () => ({ status: "available", context })),
    agentSession: vi.fn<AutoFillNativeHost["agentSession"]>(async () => ({ status: "success", ...session })),
    beginReprompt: vi.fn(),
    cancelReprompt: vi.fn(),
    beginRepromptBatch: vi.fn(),
    cancelRepromptBatch: vi.fn(async () => undefined),
    biometricReprompt: vi.fn(),
    fillDetected: vi.fn(),
    releaseSecret: vi.fn(),
    pasteText: vi.fn(),
    copyText: vi.fn(),
  };
}
