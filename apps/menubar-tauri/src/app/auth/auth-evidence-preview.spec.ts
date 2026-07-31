import { afterEach, describe, expect, it } from "vitest";

import { PopupStateStore } from "../popup-state";
import { AUTH_EVIDENCE_STATES, type AuthEvidenceState } from "./auth-evidence-state";
import { applyAuthEvidenceState } from "./auth-evidence-preview";

const EXPECTED_ROUTES: Record<AuthEvidenceState, string> = {
  environment: "/login",
  email: "/login",
  "master-password": "/login",
  hint: "/hint",
  authenticator: "/2fa",
  "email-two-factor": "/2fa",
  "new-device": "/new-device-verification",
  "lock-error": "/lock",
  "account-switcher": "/account-switcher",
  loading: "/new-device-verification",
  offline: "/2fa",
  error: "/2fa",
  "long-text": "/account-switcher",
  light: "/login",
  dark: "/login",
  "system-theme": "/login",
  "alternative-unlock": "/account-security",
  "alternative-unlock-startup": "/lock",
};

afterEach(() => {
  delete document.documentElement.dataset.bwTheme;
  document.documentElement.classList.remove("theme_dark");
});

describe("auth evidence preview", () => {
  it.each(AUTH_EVIDENCE_STATES)("routes the sanitized %s state", (state) => {
    const store = new PopupStateStore();

    expect(applyAuthEvidenceState(store, state)).toBe(EXPECTED_ROUTES[state]);
    expect(store.snapshot().activeSession === null).toBe(
      state !== "alternative-unlock",
    );
  });

  it("orders provider 0 first for authenticator evidence", () => {
    const store = new PopupStateStore();

    applyAuthEvidenceState(store, "authenticator");

    expect(store.snapshot().authChallenge).toEqual({
      type: "twoFactor",
      email: "auth-evidence@example.test",
      serverUrl: "https://vault.example.test",
      providers: ["0", "1"],
    });
  });

  it("orders provider 1 first for email two-factor evidence", () => {
    const store = new PopupStateStore();

    applyAuthEvidenceState(store, "email-two-factor");

    expect(store.snapshot().authChallenge?.providers).toEqual(["1", "0"]);
  });

  it("creates a non-secret new-device challenge and a deterministic pending state", () => {
    const store = new PopupStateStore();

    applyAuthEvidenceState(store, "loading");

    expect(store.snapshot()).toMatchObject({
      isLoggingIn: true,
      authChallenge: {
        type: "newDevice",
        email: "auth-evidence@example.test",
        serverUrl: "https://vault.example.test",
      },
    });
  });

  it.each([
    ["offline", "无法连接到服务器。请检查网络后重试。"],
    ["error", "无法验证代码。请重试。"],
  ] as const)("announces the fixed %s evidence error", (state, message) => {
    const store = new PopupStateStore();

    applyAuthEvidenceState(store, state);

    expect(store.snapshot().loginError).toBe(message);
    expect(store.snapshot().authChallenge?.type).toBe("twoFactor");
  });

  it.each(["light", "dark", "system-theme"] as const)(
    "sets the %s theme without browser storage",
    (state) => {
      const store = new PopupStateStore();

      applyAuthEvidenceState(store, state);

      expect(document.documentElement.dataset.bwTheme).toBe(
        state === "system-theme" ? "system" : state,
      );
      expect(document.documentElement.classList.contains("theme_dark")).toBe(
        state === "dark",
      );
      expect(localStorage.getItem("barwarden.settings")).toBeNull();
    },
  );

  it.each(AUTH_EVIDENCE_STATES)("keeps %s free of credentials and private identifiers", (state) => {
    const store = new PopupStateStore();

    applyAuthEvidenceState(store, state);

    const evidence = JSON.stringify(store.snapshot());
    expect(evidence).not.toMatch(
      state === "alternative-unlock"
        ? /masterPassword|otp|keychain/i
        : /masterPassword|otp|token|keychain|accessToken|refreshToken/i,
    );
    expect(evidence).not.toMatch(
      state === "alternative-unlock"
        ? /@(gmail|outlook|icloud)\.|https?:\/\/(?![a-z-]+\.example\.test)/i
        : /@(gmail|outlook|icloud)\.|https?:\/\/(?!vault\.example\.test)/i,
    );
  });
});
