import { Injectable } from "@angular/core";
import { BehaviorSubject, type Observable } from "rxjs";

import { PopupStateStore } from "../popup-state";
import { AuthFacade } from "./auth.facade";
import { authChallengeOutcome, type AuthChallengeOutcome } from "./auth-challenge-route";

export interface OfficialNewDevicePort {
  readonly expiresAt$: Observable<number | null>;
  submitOtp(otp: string): Promise<AuthChallengeOutcome>;
  resendOtp(): Promise<void>;
  cancel(): void;
}

@Injectable({ providedIn: "root" })
export class OfficialNewDeviceAdapter implements OfficialNewDevicePort {
  private readonly expiresAt = new BehaviorSubject<number | null>(null);

  readonly expiresAt$ = this.expiresAt.asObservable();

  constructor(
    private readonly auth: AuthFacade,
    private readonly store: PopupStateStore,
  ) {
    this.refresh();
  }

  refresh(): void {
    this.expiresAt.next(
      this.store.snapshot().authChallenge?.type === "newDevice"
        ? this.auth.authChallengeExpiresAt()
        : null,
    );
  }

  async submitOtp(otp: string): Promise<AuthChallengeOutcome> {
    const outcome = await this.auth.submitNewDeviceOtp(otp.trim());
    this.refresh();
    return outcome ?? authChallengeOutcome(this.store.snapshot(), "newDevice");
  }

  async resendOtp(): Promise<void> {
    await this.auth.resendNewDeviceOtp();
    this.refresh();
  }

  cancel(): void {
    this.auth.cancelAuthChallenge();
    this.refresh();
  }
}
