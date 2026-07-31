import { CommonModule } from "@angular/common";
import { Component, DestroyRef, OnDestroy, OnInit, ViewChild } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { Subscription } from "rxjs";

import { AsyncActionsModule } from "@bitwarden/components";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { I18nPipe } from "@bitwarden/ui-common";

import {
  OfficialChallengeAdapter,
  type RetainedTwoFactorProvider,
} from "../../../auth/official-challenge.adapter";
import {
  authChallengeRoute,
  type AuthChallengeOutcome,
} from "../../../auth/auth-challenge-route";
import {
  ButtonComponent,
  CalloutComponent,
  CheckboxComponent,
  FormControlComponent,
  IconComponent,
  BitLabelComponent,
  TypographyDirective,
} from "../../../official-ui/official-components";
import {
  OfficialI18nService,
  translateOfficialMessage,
} from "../../../official-ui/official-i18n.service";
import { PopupStateStore } from "../../../popup-state";
import { OfficialTwoFactorAuthenticatorComponent } from "./official-two-factor-authenticator.component";
import { OfficialTwoFactorEmailComponent } from "./official-two-factor-email.component";
import { OfficialTwoFactorOptionsComponent } from "./official-two-factor-options.component";

const ProviderType = {
  Authenticator: 0,
  Email: 1,
} as const;

/** Guarded parent transformation retaining only official Authenticator and Email flows. */
@Component({
  selector: "bw-official-two-factor",
  standalone: true,
  imports: [
    AsyncActionsModule,
    ButtonComponent,
    CalloutComponent,
    CheckboxComponent,
    CommonModule,
    FormControlComponent,
    I18nPipe,
    IconComponent,
    BitLabelComponent,
    OfficialTwoFactorAuthenticatorComponent,
    OfficialTwoFactorEmailComponent,
    OfficialTwoFactorOptionsComponent,
    ReactiveFormsModule,
    TypographyDirective,
  ],
  providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
  templateUrl: "./official-two-factor.component.html",
})
export class OfficialTwoFactorComponent implements OnInit, OnDestroy {
  @ViewChild(OfficialTwoFactorOptionsComponent)
  private options?: OfficialTwoFactorOptionsComponent;

  readonly providerType = ProviderType;
  readonly form = this.formBuilder.group({
    token: ["", [Validators.required]],
    remember: [false],
  });

  loading = true;
  providers: readonly RetainedTwoFactorProvider[] = [];
  selectedProviderType: RetainedTwoFactorProvider = ProviderType.Authenticator;

  private alive = true;
  private ownsChallenge = true;
  private operationEpoch = 0;
  protected submitting = false;
  private submitPending = false;
  private initialEmailSent = false;
  private providersInitialized = false;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private expirySubscription: Subscription | null = null;

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly challenge: OfficialChallengeAdapter,
    readonly store: PopupStateStore,
    private readonly router: Router,
    private readonly destroyRef: DestroyRef,
  ) {}

  ngOnInit(): void {
    this.challenge.refresh();
    this.expirySubscription = this.challenge.expiresAt$.subscribe((expiresAt) => {
      this.scheduleExpiry(expiresAt);
    });
    this.challenge.providers$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((providers) => {
      if (!this.alive) {
        return;
      }
      this.providers = providers;
      if (!this.providersInitialized) {
        this.providersInitialized = true;
        this.selectedProviderType = providers[0] ?? ProviderType.Authenticator;
      } else if (!providers.includes(this.selectedProviderType)) {
        this.selectedProviderType = providers[0] ?? ProviderType.Authenticator;
      }
    });
    this.loading = false;
    if (this.selectedProviderType === ProviderType.Email) {
      void this.sendInitialEmail();
    }
  }

  get tokenFormControl() {
    return this.form.controls.token;
  }

  get rememberFormControl() {
    return this.form.controls.remember;
  }

  get loginError(): string {
    return this.store.snapshot().loginError;
  }

  get deliveryStatus(): string {
    return this.store.snapshot().statusMessage === translateOfficialMessage("i18nCodeEmailSent")
      ? this.store.snapshot().statusMessage
      : "";
  }

  saveFormDataWithPartialData(data: { token?: string; remember?: boolean }): void {
    if (data.token !== undefined) {
      this.form.controls.token.setValue(data.token);
    }
    if (data.remember !== undefined) {
      this.form.controls.remember.setValue(data.remember);
    }
  }

  onRememberChange(): void {
    this.saveFormDataWithPartialData({ remember: this.form.controls.remember.value === true });
  }

  selectOtherTwoFactorMethod(event: Event): void {
    const trigger = event.currentTarget;
    if (trigger instanceof HTMLElement) {
      this.options?.open(trigger, this.providers);
    }
  }

  selectProvider(provider: RetainedTwoFactorProvider): void {
    if (!this.providers.includes(provider)) {
      return;
    }
    this.selectedProviderType = provider;
    this.form.controls.token.setValue("");
    if (provider === ProviderType.Email) {
      void this.sendInitialEmail();
    }
  }

  submit = async (): Promise<void> => {
    if (this.submitting) {
      return;
    }
    this.form.controls.token.setValue(this.form.controls.token.value?.trim() ?? "");
    this.form.markAllAsTouched();
    if (this.form.invalid || !this.providers.includes(this.selectedProviderType)) {
      return;
    }

    this.submitting = true;
    this.submitPending = true;
    const operation = ++this.operationEpoch;
    const token = this.form.controls.token.value ?? "";
    let transitionAccepted = false;
    try {
      try {
        const outcome = await this.challenge.submit(
          this.selectedProviderType,
          token,
          this.form.controls.remember.value === true,
        );
        if (this.isCurrent(operation)) {
          transitionAccepted = await this.transferRoute(outcome);
        }
      } catch {
        if (this.isCurrent(operation) && !this.store.snapshot().loginError) {
          const currentChallenge = this.store.snapshot().authChallenge;
          if (currentChallenge?.type === "twoFactor") {
            this.store.setAuthChallengeError(
              currentChallenge,
              translateOfficialMessage("i18nTwoFactorVerificationFailed"),
            );
          }
        }
        return;
      } finally {
        this.submitPending = false;
      }

    } finally {
      if (!transitionAccepted) {
        this.form.controls.token.setValue("");
      }
      if (!transitionAccepted && this.operationEpoch === operation) {
        this.submitting = false;
      }
    }
  };

  async back(): Promise<void> {
    this.invalidate();
    this.ownsChallenge = false;
    this.clearExpiryTimer();
    this.challenge.cancel();
    this.form.controls.token.setValue("");
    await this.navigateToLogin();
  }

  showContinueButton(): boolean {
    return true;
  }

  hideRememberMe(): boolean {
    return false;
  }

  handleEnterKeyPress(): void {
    void this.submit();
  }

  ngOnDestroy(): void {
    this.alive = false;
    this.invalidate();
    this.clearExpiryTimer();
    this.expirySubscription?.unsubscribe();
    if (this.ownsChallenge) {
      this.challenge.cancel();
    }
    this.form.controls.token.setValue("");
  }

  private async sendInitialEmail(): Promise<void> {
    if (this.initialEmailSent) {
      return;
    }
    this.initialEmailSent = true;
    await this.challenge.sendEmail();
  }

  private invalidate(): void {
    this.operationEpoch += 1;
    this.submitting = false;
  }

  private isCurrent(operation: number): boolean {
    return this.alive && operation === this.operationEpoch;
  }

  private scheduleExpiry(expiresAt: number | null): void {
    this.clearExpiryTimer();
    if (expiresAt === null) {
      return;
    }
    this.expiryTimer = setTimeout(() => {
      if (!this.alive || !this.ownsChallenge) {
        return;
      }
      this.challenge.cancel();
      this.ownsChallenge = false;
      void this.navigate("/login");
    }, Math.max(0, expiresAt - Date.now()));
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  private async transferRoute(outcome: AuthChallengeOutcome): Promise<boolean> {
    const destination = authChallengeRoute(outcome);
    if (!destination) {
      return false;
    }
    this.ownsChallenge = false;
    this.clearExpiryTimer();
    const transferred = await this.navigate(destination);
    if (
      !transferred &&
      this.alive &&
      (outcome === "newDevice" || outcome === "twoFactor")
    ) {
      this.challenge.cancel();
      this.store.setStatus(translateOfficialMessage("i18nUnableToNavigate"));
      return this.navigate("/login");
    }
    return transferred;
  }

  private async navigate(destination: string): Promise<boolean> {
    try {
      const navigated = await this.router.navigateByUrl(destination);
      if (!navigated && this.alive) {
        this.store.setStatus(translateOfficialMessage("i18nUnableToNavigate"));
      }
      return navigated;
    } catch {
      if (this.alive) {
        this.store.setStatus(translateOfficialMessage("i18nUnableToNavigate"));
      }
      return false;
    }
  }

  private async navigateToLogin(): Promise<void> {
    try {
      const navigated = await this.router.navigateByUrl("/login");
      if (!navigated) {
        window.location.hash = "#/login";
      }
    } catch {
      window.location.hash = "#/login";
    }
  }
}
