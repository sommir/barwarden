import { PopupStateStore, type AuthChallenge } from "../popup-state";
import { ALTERNATIVE_UNLOCK_SESSION } from "../evidence/alternative-unlock-evidence-session";
import type { AuthEvidenceState } from "./auth-evidence-state";

export {
  AUTH_EVIDENCE_STATE,
  AUTH_EVIDENCE_STATES,
  resolveAuthEvidenceState,
  type AuthEvidenceState,
} from "./auth-evidence-state";

const EVIDENCE_EMAIL = "auth-evidence@example.test";
const EVIDENCE_SERVER_URL = "https://vault.example.test";

const TWO_FACTOR_CHALLENGE: AuthChallenge = {
  type: "twoFactor",
  email: EVIDENCE_EMAIL,
  serverUrl: EVIDENCE_SERVER_URL,
  providers: ["0", "1"],
};

const NEW_DEVICE_CHALLENGE: AuthChallenge = {
  type: "newDevice",
  email: EVIDENCE_EMAIL,
  serverUrl: EVIDENCE_SERVER_URL,
};

export function applyAuthEvidenceState(
  store: PopupStateStore,
  evidenceState: AuthEvidenceState,
): string {
  store.setServerUrl(EVIDENCE_SERVER_URL);

  switch (evidenceState) {
    case "environment":
    case "email":
    case "master-password":
      return "/login";
    case "hint":
      return "/hint";
    case "authenticator":
    case "two-factor":
      store.setAuthChallenge(TWO_FACTOR_CHALLENGE);
      return "/2fa";
    case "email-two-factor":
      store.setAuthChallenge({ ...TWO_FACTOR_CHALLENGE, providers: ["1", "0"] });
      return "/2fa";
    case "new-device":
      store.setAuthChallenge(NEW_DEVICE_CHALLENGE);
      return "/new-device-verification";
    case "lock-error":
    case "locked":
      store.setLockedAccount(EVIDENCE_EMAIL, EVIDENCE_SERVER_URL);
      return "/lock";
    case "account-switcher":
    case "long-text":
      store.setUnlocked(EVIDENCE_EMAIL);
      return "/account-switcher";
    case "restored-vault":
      store.setUnlocked(EVIDENCE_EMAIL);
      return "/tabs/vault";
    case "alternative-unlock":
      store.setActiveSession(ALTERNATIVE_UNLOCK_SESSION);
      store.setUnlocked("account-a@example.test");
      return "/account-security";
    case "alternative-unlock-startup":
      return "/lock";
    case "loading":
      store.setAuthChallenge(NEW_DEVICE_CHALLENGE);
      store.setLoggingIn(true);
      return "/new-device-verification";
    case "offline":
      store.setAuthChallengeError(
        TWO_FACTOR_CHALLENGE,
        "无法连接到服务器。请检查网络后重试。",
      );
      return "/2fa";
    case "error":
      store.setAuthChallengeError(TWO_FACTOR_CHALLENGE, "无法验证代码。请重试。");
      return "/2fa";
    case "light":
    case "dark":
    case "system-theme":
      globalThis.document?.documentElement.setAttribute(
        "data-bw-theme",
        evidenceState === "system-theme" ? "system" : evidenceState,
      );
      if (evidenceState !== "system-theme") {
        globalThis.document?.documentElement.classList.toggle(
          "theme_dark",
          evidenceState === "dark",
        );
      }
      return "/login";
  }
}
