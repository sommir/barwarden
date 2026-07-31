import { Injectable } from "@angular/core";
import { BehaviorSubject, type Observable } from "rxjs";

import { PopupStateStore } from "../popup-state";
import { AuthFacade } from "./auth.facade";
import { authChallengeOutcome, type AuthChallengeOutcome } from "./auth-challenge-route";

export type RetainedTwoFactorProvider = 0 | 1;

export interface OfficialChallengePort {
  readonly providers$: Observable<readonly RetainedTwoFactorProvider[]>;
  readonly expiresAt$: Observable<number | null>;
  submit(provider: RetainedTwoFactorProvider, token: string, remember: boolean): Promise<AuthChallengeOutcome>;
  sendEmail(): Promise<void>;
  cancel(): void;
}

@Injectable({ providedIn: "root" })
export class OfficialChallengeAdapter implements OfficialChallengePort {
  private readonly providers = new BehaviorSubject<readonly RetainedTwoFactorProvider[]>([]);
  private readonly expiresAt = new BehaviorSubject<number | null>(null);

  readonly providers$ = this.providers.asObservable();
  readonly expiresAt$ = this.expiresAt.asObservable();

  constructor(
    private readonly auth: AuthFacade,
    private readonly store: PopupStateStore,
  ) {
    this.refresh();
  }

  refresh(): void {
    const challenge = this.store.snapshot().authChallenge;
    if (challenge?.type !== "twoFactor") {
      this.providers.next([]);
      this.expiresAt.next(null);
      return;
    }

    this.providers.next(
      (challenge.providers ?? []).flatMap((provider) =>
        provider === "0" ? [0 as const] : provider === "1" ? [1 as const] : [],
      ),
    );
    this.expiresAt.next(this.auth.authChallengeExpiresAt());
  }

  async submit(
    provider: RetainedTwoFactorProvider,
    token: string,
    remember: boolean,
  ): Promise<AuthChallengeOutcome> {
    if (provider !== 0 && provider !== 1) {
      throw new Error("Unsupported two-factor provider");
    }
    const outcome = await this.auth.submitTwoFactor({ provider, token: token.trim(), remember });
    this.refresh();
    return outcome ?? authChallengeOutcome(this.store.snapshot(), "twoFactor");
  }

  async sendEmail(): Promise<void> {
    await this.auth.sendTwoFactorEmail();
    this.refresh();
  }

  cancel(): void {
    this.auth.cancelAuthChallenge();
    this.refresh();
  }
}
