import { inject } from "@angular/core";
import { Router, type CanMatchFn } from "@angular/router";

import type { AuthChallenge } from "../popup-state";
import { PopupStateStore } from "../popup-state";

export type RouteAccess = "unlocked" | "known-account" | "challenge";

type RouteAccessState = {
  readonly email: string;
  readonly isUnlocked: boolean;
  readonly authChallenge: AuthChallenge | null;
};

export function resolveRouteAccess(
  state: RouteAccessState,
  access: RouteAccess,
  challengeType?: AuthChallenge["type"],
): true | "/login" | "/lock" {
  if (access === "challenge") {
    return state.authChallenge && (!challengeType || state.authChallenge.type === challengeType)
      ? true
      : "/login";
  }

  if (!state.email) {
    return "/login";
  }

  return access === "known-account" || state.isUnlocked ? true : "/lock";
}

function guard(access: RouteAccess, challengeType?: AuthChallenge["type"]): CanMatchFn {
  return () => {
    const destination = resolveRouteAccess(inject(PopupStateStore).snapshot(), access, challengeType);
    return destination === true ? true : inject(Router).createUrlTree([destination]);
  };
}

export const unlockedOnlyGuard: CanMatchFn = guard("unlocked");
export const knownAccountGuard: CanMatchFn = guard("known-account");
export const activeChallengeGuard: CanMatchFn = guard("challenge");
export const twoFactorChallengeGuard: CanMatchFn = guard("challenge", "twoFactor");
export const newDeviceChallengeGuard: CanMatchFn = guard("challenge", "newDevice");
