import { describe, expect, it } from "vitest";

import {
  AUTH_EVIDENCE_STATES,
  resolveAuthEvidenceState,
} from "./auth-evidence-state";

describe("auth evidence state", () => {
  it.each(AUTH_EVIDENCE_STATES)("resolves the compile-time-enabled %s state", (state) => {
    expect(resolveAuthEvidenceState(true, `?authEvidence=${state}`)).toBe(state);
  });

  it.each([
    [false, "?authEvidence=email"],
    [true, ""],
    [true, "?vaultEvidence=populated"],
  ] as const)("does not expose auth evidence when enabled=%s and search=%s", (enabled, search) => {
    expect(resolveAuthEvidenceState(enabled, search)).toBeNull();
  });

  it("rejects unknown and repeated evidence states without reflecting their values", () => {
    expect(() => resolveAuthEvidenceState(true, "?authEvidence=unknown-private-value"))
      .toThrow("Invalid auth evidence state");
    expect(() => resolveAuthEvidenceState(true, "?authEvidence=email&authEvidence=lock-error"))
      .toThrow("Invalid auth evidence state");
  });

  it("contains only fixed test-synthesized state identifiers", () => {
    expect(AUTH_EVIDENCE_STATES).toEqual([
      "environment",
      "email",
      "master-password",
      "hint",
      "authenticator",
      "email-two-factor",
      "new-device",
      "lock-error",
      "account-switcher",
      "loading",
      "offline",
      "error",
      "long-text",
      "light",
      "dark",
      "system-theme",
      "alternative-unlock",
      "alternative-unlock-startup",
    ]);
    expect(JSON.stringify(AUTH_EVIDENCE_STATES)).not.toMatch(
      /password=|token=|otp=|@(?:gmail|outlook|icloud)|https?:\/\/(?!example\.test)/i,
    );
  });
});
