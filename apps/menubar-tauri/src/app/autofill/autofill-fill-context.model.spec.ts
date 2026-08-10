import { describe, expect, it } from "vitest";

import {
  decodeDetectedFillOutcome,
  decodeLiveAutoFillContext,
  validateDetectedFillRequest,
} from "./autofill-fill-context.model";

const token = "00000000-0000-4000-8000-000000000005";
const generation = "00000000-0000-4000-8000-000000000004";

describe("detected AutoFill contracts", () => {
  it("decodes only the bounded presentation contract without a focused secret mapping", () => {
    const input = {
      bundleId: "com.example.Terminal",
      appName: "Terminal",
      fillContextToken: token,
      focusedField: { kind: "password", confidence: "high" },
      action: { mode: "form", fields: ["username", "password", "totp"] },
    };

    expect(decodeLiveAutoFillContext(input)).toEqual(input);
    expect(() => decodeLiveAutoFillContext({
      ...input,
      focusedField: { ...input.focusedField, secretField: undefined },
    })).toThrow("invalid detected AutoFill context");
  });

  it.each([
    ["root", (value: Record<string, unknown>) => ({ ...value, password: undefined })],
    ["focused field", (value: Record<string, unknown>) => ({
      ...value,
      focusedField: { ...(value["focusedField"] as object), label: "Password" },
    })],
    ["action", (value: Record<string, unknown>) => ({
      ...value,
      action: { ...(value["action"] as object), geometry: [1, 2, 3, 4] },
    })],
  ])("rejects unknown or secret-shaped own keys at the %s", (_name, mutate) => {
    const valid = {
      bundleId: "com.example.Terminal",
      appName: "Terminal",
      fillContextToken: token,
      focusedField: { kind: "password", confidence: "high" },
      action: { mode: "field", fields: ["password"] },
    };
    expect(() => decodeLiveAutoFillContext(mutate(valid))).toThrow("invalid detected AutoFill context");
  });

  it.each([
    { focusedField: { kind: "secret", confidence: "high" } },
    { focusedField: { kind: "password", confidence: "certain" } },
    { action: { mode: "automatic", fields: ["password"] } },
    { action: { mode: "form", fields: [] } },
    { action: { mode: "form", fields: ["password", "username"] } },
    { action: { mode: "form", fields: ["password", "password"] } },
    { action: { mode: "form", fields: ["username", "password", "totp", "password"] } },
  ])("rejects invalid enums and non-canonical field sets: $focusedField.kind$action.mode", (override) => {
    const valid = {
      bundleId: "com.example.Terminal",
      appName: "Terminal",
      fillContextToken: token,
      focusedField: { kind: "password", confidence: "high" },
      action: { mode: "field", fields: ["password"] },
    };
    expect(() => decodeLiveAutoFillContext({ ...valid, ...override })).toThrow();
  });

  it("enforces UUID, token, and presentation string bounds", () => {
    const valid = {
      bundleId: "com.example.Terminal",
      appName: "Terminal",
      fillContextToken: token,
      focusedField: { kind: "password", confidence: "high" },
      action: { mode: "field", fields: ["password"] },
    };
    for (const invalid of [
      { ...valid, fillContextToken: "not-a-uuid" },
      { ...valid, bundleId: "x".repeat(256) },
      { ...valid, appName: "x".repeat(256) },
      { ...valid, appName: "" },
    ]) {
      expect(() => decodeLiveAutoFillContext(invalid)).toThrow();
    }
  });

  it("validates one-candidate, canonical field-scoped fill requests", () => {
    const request = {
      fillContextToken: token,
      authorizations: ["username", "password", "totp"].map((field, index) => ({
        scope: {
          accountId: "account-a",
          candidateId: "cipher-a",
          field,
          generation,
          contextToken: `field-token-${index}`,
        },
        mismatchConfirmed: false,
      })),
    };

    expect(validateDetectedFillRequest(request)).toEqual(request);
    expect(() => validateDetectedFillRequest({
      ...request,
      authorizations: request.authorizations.map((authorization, index) => index === 1
        ? { ...authorization, scope: { ...authorization.scope, candidateId: "cipher-b" } }
        : authorization),
    })).toThrow("invalid detected fill request");
    expect(() => validateDetectedFillRequest({
      ...request,
      authorizations: [request.authorizations[1], request.authorizations[0]],
    })).toThrow("invalid detected fill request");
    expect(() => validateDetectedFillRequest({ ...request, repromptReceipt: undefined }))
      .toThrow("invalid detected fill request");
    expect(() => validateDetectedFillRequest({ ...request, secret: undefined })).toThrow();
  });

  it("decodes only metadata outcomes with fixed codes", () => {
    expect(decodeDetectedFillOutcome({ status: "success", fields: ["username", "password"] }))
      .toEqual({ status: "success", fields: ["username", "password"] });
    expect(decodeDetectedFillOutcome({
      status: "partial",
      filled: ["username"],
      failed: "password",
      code: "fill-failed",
    })).toEqual({ status: "partial", filled: ["username"], failed: "password", code: "fill-failed" });
    expect(decodeDetectedFillOutcome({ status: "error", code: "stale-context" }))
      .toEqual({ status: "error", code: "stale-context" });
    for (const invalid of [
      { status: "success", fields: ["password"], value: "must-not-cross" },
      { status: "partial", filled: [], failed: "password", code: "private-detail" },
      { status: "error", code: "native-private-error", secret: undefined },
    ]) {
      expect(() => decodeDetectedFillOutcome(invalid)).toThrow("invalid detected fill outcome");
    }
  });
});
