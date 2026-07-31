import { Injectable } from "@angular/core";
import { BehaviorSubject, type Observable } from "rxjs";

import { PopupStateStore } from "../popup-state";
import { AuthFacade, type LoginRequest } from "./auth.facade";
import { LoginEmailStore } from "./login-email-store";

export type RetainedLoginResult = "vault" | "twoFactor" | "newDeviceVerification" | "login";

export interface OfficialPasswordAuthPort {
  readonly rememberedEmail$: Observable<string>;
  login(request: LoginRequest): Promise<RetainedLoginResult>;
  cancel(): void;
}

@Injectable({ providedIn: "root" })
export class OfficialPasswordAuthAdapter implements OfficialPasswordAuthPort {
  private readonly emailStore = new LoginEmailStore();
  private readonly rememberedEmail = new BehaviorSubject(this.emailStore.load());
  private transientPassword = "";
  private ephemeralNavigationEmail = "";

  readonly rememberedEmail$ = this.rememberedEmail.asObservable();

  constructor(
    private readonly auth: AuthFacade,
    private readonly store: PopupStateStore,
  ) {}

  async login(request: LoginRequest): Promise<RetainedLoginResult> {
    this.transientPassword = request.masterPassword;
    try {
      await this.auth.login({
        email: request.email,
        masterPassword: this.transientPassword,
        serverUrl: request.serverUrl,
      });
      const state = this.store.snapshot();
      if (state.authChallenge?.type === "twoFactor") {
        return "twoFactor";
      }
      if (state.authChallenge?.type === "newDevice") {
        return "newDeviceVerification";
      }
      return state.isUnlocked ? "vault" : "login";
    } finally {
      this.transientPassword = "";
    }
  }

  rememberEmail(email: string, remembered: boolean): void {
    if (!remembered) {
      this.emailStore.clear();
      this.rememberedEmail.next("");
      return;
    }

    const normalizedEmail = email.trim();
    this.emailStore.save(normalizedEmail);
    this.rememberedEmail.next(normalizedEmail);
  }

  takeNavigationEmail(): string {
    const email = this.ephemeralNavigationEmail;
    this.ephemeralNavigationEmail = "";
    return email;
  }

  setNavigationEmail(email: string): void {
    this.ephemeralNavigationEmail = email.trim();
  }

  cancel(): void {
    this.auth.cancelAuthChallenge?.();
  }

  hasTransientPassword(): boolean {
    return this.transientPassword.length > 0;
  }
}
