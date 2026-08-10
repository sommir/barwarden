import { describe, expect, it, vi } from "vitest";

import { AutoFillFillActionService } from "./autofill-fill-action.service";
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
      repromptReceipt: "receipt-a",
    })).resolves.toEqual({ status: "success", fields: ["username", "password"] });
    expect(native.fillDetected).toHaveBeenCalledWith({
      fillContextToken: context.fillContextToken,
      authorizations: prepared.scopes.map((scope) => ({ scope, mismatchConfirmed: true })),
      repromptReceipt: "receipt-a",
    });
  });

  it("cancels exactly the selected scopes and burns the prepared action", async () => {
    const native = host();
    const service = new AutoFillFillActionService(native);
    const prepared = service.prepare(context, session, candidate(["username", "password"]));
    if (prepared.status !== "ready") throw new Error("expected ready action");
    await service.cancel(prepared, "receipt-a");
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
});

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
