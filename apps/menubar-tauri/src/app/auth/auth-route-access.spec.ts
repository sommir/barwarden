import "@angular/compiler";

import { describe, expect, it } from "vitest";

import { resolveRouteAccess } from "./auth-route-access";

describe("resolveRouteAccess", () => {
  const loggedOut = { email: "", isUnlocked: false, authChallenge: null };
  const locked = { email: "user@example.test", isUnlocked: false, authChallenge: null };
  const unlocked = { email: "user@example.test", isUnlocked: true, authChallenge: null };
  const challenged = {
    email: "",
    isUnlocked: false,
    authChallenge: {
      type: "twoFactor" as const,
      email: "user@example.test",
      serverUrl: "https://vault.example.test",
    },
  };

  it("routes logged-out users away from unlocked surfaces", () => {
    expect(resolveRouteAccess(loggedOut, "unlocked")).toBe("/login");
  });

  it("routes locked users away from unlocked surfaces", () => {
    expect(resolveRouteAccess(locked, "unlocked")).toBe("/lock");
  });

  it("allows unlocked users onto unlocked surfaces", () => {
    expect(resolveRouteAccess(unlocked, "unlocked")).toBe(true);
  });

  it("allows locked accounts onto known-account surfaces", () => {
    expect(resolveRouteAccess(locked, "known-account")).toBe(true);
    expect(resolveRouteAccess(loggedOut, "known-account")).toBe("/login");
  });

  it("allows challenge routes only while a challenge is active", () => {
    expect(resolveRouteAccess(challenged, "challenge")).toBe(true);
    expect(resolveRouteAccess(loggedOut, "challenge")).toBe("/login");
  });
});
