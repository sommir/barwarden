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
  it("pastes the selected value without classifying the previously focused input", async () => {
    const native = host();
    vi.mocked(native.releaseSecret).mockResolvedValue({ status: "success", field: "password", value: "selected-password" });
    vi.mocked(native.pasteText).mockResolvedValue(undefined);
    const service = new AutoFillFieldActionService(native);

    await expect(service.execute(session, candidate, "password", {
      mismatchConfirmed: false, requiresReprompt: false,
    })).resolves.toEqual({ status: "filled", field: "password" });
    expect(native.releaseSecret).toHaveBeenCalledWith({
      scope: expect.objectContaining({ field: "password", contextToken: "password-token" }),
      mismatchConfirmed: false,
    });
    expect(native.pasteText).toHaveBeenCalledWith("selected-password");
    expect(native.fillDetected).not.toHaveBeenCalled();
    expect(native.entryContext).not.toHaveBeenCalled();
  });

  it("pastes the selected value when no detected field context is available", async () => {
    const native = host();
    vi.mocked(native.entryContext).mockResolvedValue({ status: "available", application, fillContext: null });
    vi.mocked(native.releaseSecret).mockResolvedValue({ status: "success", field: "username", value: "person@example.test" });
    vi.mocked(native.pasteText).mockResolvedValue(undefined);
    const service = new AutoFillFieldActionService(native);

    await expect(service.execute(session, candidate, "username", {
      mismatchConfirmed: false, requiresReprompt: false,
    })).resolves.toEqual({ status: "filled", field: "username" });
    expect(native.pasteText).toHaveBeenCalledWith("person@example.test");
    expect(native.fillDetected).not.toHaveBeenCalled();
  });

  it("pastes a generated TOTP through the generic field action without classifying the input", async () => {
    const native = host();
    const totpCandidate: ContextualCandidate = {
      ...candidate,
      availableFields: ["username", "password", "totp"],
      authorizations: immutableAuthorizationMap([
        ...candidate.authorizations.entries(),
        ["totp", { contextToken: "totp-token", requiresMismatchConfirmation: false }],
      ]),
    };
    vi.mocked(native.releaseSecret).mockResolvedValue({ status: "success", field: "totp", value: "123456" });
    vi.mocked(native.pasteText).mockResolvedValue(undefined);
    const service = new AutoFillFieldActionService(native);

    await expect(service.execute(session, totpCandidate, "totp", {
      mismatchConfirmed: false, requiresReprompt: false,
    })).resolves.toEqual({ status: "filled", field: "totp" });
    expect(native.releaseSecret).toHaveBeenCalledWith({
      scope: expect.objectContaining({ field: "totp", contextToken: "totp-token" }),
      mismatchConfirmed: false,
    });
    expect(native.pasteText).toHaveBeenCalledWith("123456");
    expect(native.fillDetected).not.toHaveBeenCalled();
    expect(native.entryContext).not.toHaveBeenCalled();
  });

  it("copies the released value when generic paste is unavailable", async () => {
    const native = host();
    vi.mocked(native.entryContext).mockResolvedValue({ status: "available", application, fillContext: null });
    vi.mocked(native.releaseSecret).mockResolvedValue({ status: "success", field: "username", value: "person@example.test" });
    vi.mocked(native.pasteText).mockRejectedValue(new Error("paste unavailable"));
    vi.mocked(native.copyText).mockResolvedValue(undefined);
    const service = new AutoFillFieldActionService(native);

    await expect(service.execute(session, candidate, "username", {
      mismatchConfirmed: false, requiresReprompt: false,
    })).resolves.toEqual({ status: "copied", field: "username" });
    expect(native.copyText).toHaveBeenCalledWith("person@example.test");
  });

  it("never releases a field absent from the candidate", async () => {
    const service = new AutoFillFieldActionService(host());
    await expect(service.execute(session, candidate, "totp", {
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
