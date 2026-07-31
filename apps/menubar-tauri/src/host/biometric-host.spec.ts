import { describe, expect, it } from "vitest";

import {
  BiometricHostError,
  decodeBiometricAvailability,
  decodeBiometricOperation,
} from "./biometric-host";

describe("biometric host contract", () => {
  it.each([
    ["available", "available"],
    ["not-enrolled", "not-enrolled"],
    ["not-available", "not-available"],
    ["locked-out", "locked-out"],
    ["invalid-account", "invalid-account"],
  ] as const)("decodes the fixed availability status %s", (status, expected) => {
    expect(decodeBiometricAvailability({ status })).toBe(expected);
  });

  it.each([
    "enabled",
    "disabled",
    "success",
    "cancelled",
    "failed",
    "not-enrolled",
    "not-available",
    "locked-out",
    "invalidated",
    "storage-unavailable",
    "invalid-account",
  ] as const)("decodes the fixed operation status %s", (status) => {
    expect(decodeBiometricOperation({ status })).toBe(status);
  });

  it.each([
    null,
    {},
    { status: "success", secret: "native detail" },
    { status: "unknown" },
    { status: 1 },
  ])("rejects malformed native biometric payload %#", (payload) => {
    expect(() => decodeBiometricOperation(payload)).toThrow(BiometricHostError);
  });

  it("rejects hidden and symbol native details", () => {
    const hidden = Object.defineProperty(
      { status: "success" },
      "detail",
      { enumerable: false, value: "private native detail" },
    );
    const symbol = {
      status: "success",
      [Symbol("detail")]: "private native detail",
    };

    expect(() => decodeBiometricOperation(hidden)).toThrow(BiometricHostError);
    expect(() => decodeBiometricOperation(symbol)).toThrow(BiometricHostError);
  });
});
