import { Inject, Injectable } from "@angular/core";
import { Router } from "@angular/router";

import {
  GENERATOR_HISTORY_STATE,
  type GeneratorHistoryStatePort,
} from "./generator-history-runtime.port";

const historyOwnerBrand = Symbol("generatorHistoryRouteOwner");

export interface GeneratorHistoryOwnerToken {
  readonly accountId: string;
  readonly routeUrl: string;
  readonly session: object | null;
  readonly email: string;
  readonly serverUrl: string;
  readonly routeInstance: object;
  readonly [historyOwnerBrand]: true;
}

@Injectable()
export class GeneratorHistoryRouteOwner {
  private readonly routeInstance = {};
  private active = true;

  constructor(
    private readonly router: Router,
    @Inject(GENERATOR_HISTORY_STATE) private readonly store: GeneratorHistoryStatePort,
  ) {}

  capture(accountId: string): GeneratorHistoryOwnerToken {
    const state = this.store.snapshot();
    if (!state.isUnlocked) {
      throw new Error("Generator history is unavailable");
    }
    return {
      [historyOwnerBrand]: true,
      accountId,
      routeUrl: this.router.url,
      session: state.activeSession,
      email: state.email,
      serverUrl: state.serverUrl,
      routeInstance: this.routeInstance,
    };
  }

  isCurrent(token: GeneratorHistoryOwnerToken): boolean {
    const state = this.store.snapshot();
    return this.active
      && token[historyOwnerBrand] === true
      && token.routeInstance === this.routeInstance
      && token.routeUrl === this.router.url
      && token.session === state.activeSession
      && token.email === state.email
      && token.serverUrl === state.serverUrl
      && state.isUnlocked;
  }

  destroy(): void {
    this.active = false;
  }
}
