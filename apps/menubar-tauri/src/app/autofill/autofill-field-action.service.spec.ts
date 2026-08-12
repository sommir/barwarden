import { describe, expect, it, vi } from "vitest";

import { AutoFillFieldActionService } from "./autofill-field-action.service";
import { immutableAuthorizationMap, type ContextualCandidate, type LiveAutoFillContext } from "./autofill-fill-context.model";
import type { AutoFillAgentSession, AutoFillNativeHost } from "./autofill-native.host";

const application = { bundleId: "com.example.Terminal", appName: "Terminal" };
const context: LiveAutoFillContext = {
  ...application,
  fillContextToken: "00000000-0000-4000-8000-000000000005",
  focusedField: { kind: "username", confidence: "high" },
  action: { mode: "field", fields: ["username"] },
};
const session: AutoFillAgentSession = {
  accountId: "account-a",
  generation: "00000000-0000-4000-8000-000000000004",
  vaultRevision: 7,
};
const candidate: ContextualCandidate = {
  cipherId: "cipher-a",
  displayName: "Terminal",
  username: "person@example.test",
  group: "exact",
  reason: "application_name",
  availableFields: ["username", "password"],
  authorizations: immutableAuthorizationMap([
    ["username", { contextToken: "username-token", requiresMismatchConfirmation: false }],
    ["password", { contextToken: "password-token", requiresMismatchConfirmation: false }],
  ]),
};

describe("AutoFillFieldActionService", () => {
  it("fills exactly the selected value into the live focused field", async () => {
    const native = host();
    vi.mocked(native.fillDetected).mockResolvedValue({ status: "success", fields: ["password"] });
    const service = new AutoFillFieldActionService(native);

    await expect(service.execute({ application, fillContext: context }, session, candidate, "password", {
      mismatchConfirmed: false, requiresReprompt: false,
    })).resolves.toEqual({ status: "filled", field: "password" });
    expect(native.fillDetected).toHaveBeenCalledWith({
      intent: "explicit",
      fillContextToken: context.fillContextToken,
      authorizations: [{
        scope: expect.objectContaining({ field: "password", contextToken: "password-token" }),
        mismatchConfirmed: false,
      }],
    });
    expect(native.releaseSecret).not.toHaveBeenCalled();
  });

  it("copies exactly the selected value when the application has no writable field", async () => {
    const native = host();
    vi.mocked(native.entryContext).mockResolvedValue({ status: "available", application, fillContext: null });
    vi.mocked(native.releaseSecret).mockResolvedValue({ status: "success", field: "username", value: "person@example.test" });
    vi.mocked(native.copyText).mockResolvedValue(undefined);
    const service = new AutoFillFieldActionService(native);

    await expect(service.execute({ application, fillContext: null }, session, candidate, "username", {
      mismatchConfirmed: false, requiresReprompt: false,
    })).resolves.toEqual({ status: "copied", field: "username" });
    expect(native.copyText).toHaveBeenCalledWith("person@example.test");
    expect(native.fillDetected).not.toHaveBeenCalled();
  });

  it("fails closed when copying the released value fails", async () => {
    const native = host();
    vi.mocked(native.entryContext).mockResolvedValue({ status: "available", application, fillContext: null });
    vi.mocked(native.releaseSecret).mockResolvedValue({ status: "success", field: "username", value: "person@example.test" });
    vi.mocked(native.copyText).mockRejectedValue(new Error("clipboard unavailable"));
    const service = new AutoFillFieldActionService(native);

    await expect(service.execute({ application, fillContext: null }, session, candidate, "username", {
      mismatchConfirmed: false, requiresReprompt: false,
    })).resolves.toEqual({ status: "unavailable" });
  });

  it("never releases a field absent from the candidate", async () => {
    const service = new AutoFillFieldActionService(host());
    await expect(service.execute({ application, fillContext: null }, session, candidate, "totp", {
      mismatchConfirmed: false, requiresReprompt: false,
    })).resolves.toEqual({ status: "unavailable" });
  });
});

function host(): AutoFillNativeHost {
  return {
    entryContext: vi.fn(async () => ({ status: "available", application, fillContext: context })),
    agentSession: vi.fn(async () => ({ status: "success", ...session })),
    beginReprompt: vi.fn(), cancelReprompt: vi.fn(), beginRepromptBatch: vi.fn(), cancelRepromptBatch: vi.fn(),
    biometricReprompt: vi.fn(), fillDetected: vi.fn(), releaseSecret: vi.fn(), pasteText: vi.fn(), copyText: vi.fn(),
  };
}
