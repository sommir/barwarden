import type { PopupState } from "../popup-state";

export type AuthChallengeOutcome = "stay" | "newDevice" | "twoFactor" | "unlocked" | "login";

export function authChallengeOutcome(
  state: Pick<PopupState, "isUnlocked" | "authChallenge">,
  owner: "newDevice" | "twoFactor",
): AuthChallengeOutcome {
  if (state.isUnlocked) {
    return "unlocked";
  }
  if (!state.authChallenge) {
    return "login";
  }
  return state.authChallenge.type === owner ? "stay" : state.authChallenge.type;
}

export function authChallengeRoute(outcome: AuthChallengeOutcome): string | null {
  switch (outcome) {
    case "unlocked":
      return "/tabs/vault";
    case "newDevice":
      return "/new-device-verification";
    case "twoFactor":
      return "/2fa";
    case "login":
      return "/login";
    case "stay":
      return null;
  }
}
