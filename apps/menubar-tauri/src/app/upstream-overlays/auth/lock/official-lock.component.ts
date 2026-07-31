import { AsyncPipe } from "@angular/common";
import {
  ChangeDetectorRef,
  Component,
  Inject,
  OnDestroy,
  OnInit,
} from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { LinkModule, TypographyModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { OfficialMasterPasswordUnlockAdapter } from "../../../auth/official-master-password-unlock.adapter";
import { AuthFacade, type AuthUnlockResult } from "../../../auth/auth.facade";
import {
  AlternativeUnlockError,
  UNLOCK_METHODS_PORT,
  type UnlockMethodAvailability,
  type UnlockMethodsPort,
} from "../../../auth/unlock-methods.port";
import {
  ButtonComponent,
  CalloutComponent,
  TypographyDirective,
} from "../../../official-ui/official-components";
import { translateOfficialMessage } from "../../../official-ui/official-i18n.service";
import { PopupHeaderComponent } from "../../../layout/popup-header.component";
import { PopupPageComponent } from "../../../layout/popup-page.component";
import { OfficialMasterPasswordLockComponent } from "./official-master-password-lock.component";
import { OfficialPinLockComponent } from "./official-pin-lock.component";

type ActiveUnlockMethod = "biometric" | "pin" | "masterPassword";

const NO_ALTERNATIVE_METHODS: UnlockMethodAvailability = {
  pinEnabled: false,
  biometricEnabled: false,
  biometricAvailability: "not-available",
};

/** Guarded transformation of the pinned LockComponent for local PIN, Touch ID, and password unlock. */
@Component({
  selector: "bw-official-lock",
  standalone: true,
  imports: [
    AsyncPipe,
    ButtonComponent,
    CalloutComponent,
    I18nPipe,
    LinkModule,
    OfficialMasterPasswordLockComponent,
    OfficialPinLockComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    RouterLink,
    TypographyDirective,
    TypographyModule,
  ],
  templateUrl: "./official-lock.component.html",
})
export class OfficialLockComponent implements OnDestroy, OnInit {
  readonly account$ = this.unlockPort.account$;
  protected navigationFailed = false;
  protected activeMethod: ActiveUnlockMethod = "masterPassword";
  protected availability = NO_ALTERNATIVE_METHODS;
  protected initialized = false;
  protected submitting = false;
  protected alternativeErrorMessage = "";
  protected credentialResetEpoch = 0;
  private accountId: string | null = null;
  private initializationTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    private readonly unlockPort: OfficialMasterPasswordUnlockAdapter,
    private readonly auth: AuthFacade,
    @Inject(UNLOCK_METHODS_PORT)
    private readonly unlockMethods: UnlockMethodsPort | null,
    private readonly router: Router,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.initializationTimer = setTimeout(() => {
      this.initializationTimer = null;
      if (!this.destroyed) {
        void this.initialize();
      }
    }, 0);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.initializationTimer !== null) {
      clearTimeout(this.initializationTimer);
      this.initializationTimer = null;
    }
  }

  private async initialize(): Promise<void> {
    await this.unlockPort.refresh();
    if (this.destroyed) {
      return;
    }
    const account = await firstValueFrom(this.account$);
    this.accountId = account?.id ?? null;
    if (!this.accountId || !this.unlockMethods) {
      this.availability = NO_ALTERNATIVE_METHODS;
      this.activeMethod = "masterPassword";
      this.alternativeErrorMessage = translateOfficialMessage("i18nUnableToLoadAccount");
      this.initialized = true;
      this.refreshView();
      return;
    }

    try {
      this.availability = await this.unlockMethods.availability(this.accountId);
    } catch {
      this.availability = NO_ALTERNATIVE_METHODS;
    }
    if (this.destroyed) {
      return;
    }
    this.activeMethod = this.defaultMethod();
    this.initialized = true;
    this.refreshView();

    if (this.activeMethod !== "biometric") {
      return;
    }
    const epoch = this.unlockMethods.currentLockEpoch(this.accountId)
      ?? this.unlockMethods.beginLockEpoch(this.accountId);
    if (this.unlockMethods.consumeAutomaticBiometricPrompt(this.accountId, epoch)) {
      await this.unlockWithBiometric();
    }
  }

  async unlockSucceeded(result: AuthUnlockResult): Promise<void> {
    const destination = result === "unlocked"
      ? "/tabs/vault"
      : result === "twoFactor"
        ? "/2fa"
        : "/new-device-verification";
    this.submitting = true;
    if (!(await this.navigate(destination))) {
      this.submitting = false;
      this.refreshView();
    }
  }

  async logoutSucceeded(): Promise<void> {
    await this.navigate("/login");
  }

  selectMethod(method: ActiveUnlockMethod): void {
    if (this.submitting || !this.methodAvailable(method)) {
      return;
    }
    this.alternativeErrorMessage = "";
    this.activeMethod = method;
  }

  async unlockWithPin(pin: string): Promise<void> {
    if (this.destroyed || this.submitting || this.activeMethod !== "pin") {
      return;
    }
    this.submitting = true;
    this.alternativeErrorMessage = "";
    let transitionAccepted = false;
    try {
      await this.auth.unlockWithPin(pin);
      if (!this.destroyed) {
        transitionAccepted = await this.navigate("/tabs/vault");
      }
    } catch (error) {
      this.handleAlternativeFailure(error);
      this.credentialResetEpoch += 1;
    } finally {
      pin = "";
      if (!transitionAccepted) {
        this.submitting = false;
        this.refreshView();
      }
    }
  }

  async unlockWithBiometric(): Promise<void> {
    if (this.destroyed || this.submitting || !this.methodAvailable("biometric")) {
      return;
    }
    this.submitting = true;
    this.alternativeErrorMessage = "";
    let transitionAccepted = false;
    try {
      await this.auth.unlockWithBiometric();
      if (!this.destroyed) {
        transitionAccepted = await this.navigate("/tabs/vault");
      }
    } catch (error) {
      this.handleAlternativeFailure(error);
    } finally {
      if (!transitionAccepted) {
        this.submitting = false;
        this.refreshView();
      }
    }
  }

  async logout(): Promise<void> {
    if (this.destroyed || this.submitting) {
      return;
    }
    this.submitting = true;
    try {
      await this.unlockPort.logout();
      if (!this.destroyed) {
        await this.navigate("/login");
      }
    } catch {
      // A retained account remains available for another unlock attempt.
    } finally {
      this.submitting = false;
      this.refreshView();
    }
  }

  protected biometricAvailable(): boolean {
    return this.availability.biometricEnabled
      && this.availability.biometricAvailability === "available";
  }

  private defaultMethod(): ActiveUnlockMethod {
    if (this.biometricAvailable()) {
      return "biometric";
    }
    if (this.availability.pinEnabled) {
      return "pin";
    }
    return "masterPassword";
  }

  private methodAvailable(method: ActiveUnlockMethod): boolean {
    switch (method) {
      case "biometric":
        return this.biometricAvailable();
      case "pin":
        return this.availability.pinEnabled;
      case "masterPassword":
        return true;
    }
  }

  private handleAlternativeFailure(error: unknown): void {
    if (!(error instanceof AlternativeUnlockError)) {
      this.alternativeErrorMessage = translateOfficialMessage(
        "i18nUnableToUnlockWithMasterPassword",
      );
      this.activeMethod = "masterPassword";
      return;
    }

    switch (error.code) {
      case "incorrect-pin": {
        const attempts = error.attemptsRemaining;
        this.alternativeErrorMessage =
          Number.isInteger(attempts) && attempts! > 0 && attempts! < 5
            ? translateOfficialMessage("i18nPinIncorrectAttempts", attempts!)
            : translateOfficialMessage("i18nPinIncorrect");
        return;
      }
      case "pin-exhausted":
        this.availability = { ...this.availability, pinEnabled: false };
        this.alternativeErrorMessage = translateOfficialMessage("i18nPinInvalidated");
        this.activeMethod = "masterPassword";
        return;
      case "pin-unavailable":
        this.availability = { ...this.availability, pinEnabled: false };
        this.alternativeErrorMessage = translateOfficialMessage("i18nPinUnavailable");
        this.activeMethod = "masterPassword";
        return;
      case "biometric-cancelled":
        this.alternativeErrorMessage = "";
        return;
      case "biometric-invalidated":
        this.disableLocalBiometric();
        this.alternativeErrorMessage = translateOfficialMessage("i18nTouchIdInvalidated");
        return;
      case "biometric-failed":
        this.alternativeErrorMessage = translateOfficialMessage("i18nTouchIdFailed");
        return;
      case "biometric-unavailable":
        this.disableLocalBiometric();
        this.alternativeErrorMessage = translateOfficialMessage("i18nTouchIdUnavailable");
        return;
      case "session-unavailable":
      case "sync-failed":
        this.alternativeErrorMessage = translateOfficialMessage("i18nUnlockSessionFailed");
        this.activeMethod = "masterPassword";
        return;
    }
  }

  private disableLocalBiometric(): void {
    this.availability = {
      ...this.availability,
      biometricEnabled: false,
    };
    this.activeMethod = this.defaultMethod();
  }

  private async navigate(destination: string): Promise<boolean> {
    this.navigationFailed = false;
    try {
      this.navigationFailed = !(await this.router.navigateByUrl(destination));
    } catch {
      this.navigationFailed = true;
    }
    if (this.navigationFailed) {
      this.credentialResetEpoch += 1;
    }
    return !this.navigationFailed;
  }

  private refreshView(): void {
    if (!this.destroyed) {
      this.changeDetectorRef.detectChanges();
    }
  }
}
