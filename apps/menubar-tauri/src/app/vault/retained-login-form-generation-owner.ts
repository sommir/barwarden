import { Injectable } from "@angular/core";
import { Router } from "@angular/router";

import { PopupStateStore } from "../popup-state";
import type { RetainedLoginFormGenerationOwner } from "./retained-login-form.adapter";

const generationOwnerBrand = Symbol("retainedLoginFormGenerationOwner");

@Injectable()
export class RetainedLoginFormRouteOwner implements RetainedLoginFormGenerationOwner {
  constructor(
    private readonly router: Router,
    private readonly store: PopupStateStore,
  ) {}

  capture(): object {
    const state = this.store.snapshot();
    return {
      [generationOwnerBrand]: true,
      routeUrl: this.router.url,
      session: state.activeSession,
      email: state.email,
      serverUrl: state.serverUrl,
    };
  }

  isCurrent(token: object): boolean {
    const candidate = token as {
      readonly [generationOwnerBrand]?: boolean;
      readonly routeUrl?: string;
      readonly session?: unknown;
      readonly email?: string;
      readonly serverUrl?: string;
    };
    const state = this.store.snapshot();
    return candidate[generationOwnerBrand] === true
      && candidate.routeUrl === this.router.url
      && candidate.session === state.activeSession
      && candidate.email === state.email
      && candidate.serverUrl === state.serverUrl
      && state.isUnlocked;
  }
}
