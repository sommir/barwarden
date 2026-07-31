import { CommonModule, Location } from "@angular/common";
import { Component, OnDestroy, OnInit, signal, viewChild } from "@angular/core";
import {
  FormBuilder,
  FormGroupDirective,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { Router } from "@angular/router";
import { Subject, Subscription, takeUntil } from "rxjs";

import { AsyncActionsModule, LinkModule } from "@bitwarden/components";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { I18nPipe } from "@bitwarden/ui-common";

import { OfficialNewDeviceAdapter } from "../../../auth/official-new-device.adapter";
import {
  authChallengeRoute,
  type AuthChallengeOutcome,
} from "../../../auth/auth-challenge-route";
import {
  BitFormFieldComponent,
  BitInputDirective,
  BitLabelComponent,
  ButtonComponent,
  CalloutComponent,
  TypographyDirective,
} from "../../../official-ui/official-components";
import { OfficialI18nService } from "../../../official-ui/official-i18n.service";
import { PopupStateStore } from "../../../popup-state";
import { translateOfficialMessage } from "../../../official-ui/official-i18n.service";

/** Guarded transformation of the pinned NewDeviceVerificationComponent. */
@Component({
  selector: "bw-official-new-device-verification",
  standalone: true,
  imports: [
    AsyncActionsModule,
    BitFormFieldComponent,
    BitInputDirective,
    BitLabelComponent,
    ButtonComponent,
    CalloutComponent,
    CommonModule,
    I18nPipe,
    LinkModule,
    ReactiveFormsModule,
    TypographyDirective,
  ],
  providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
  templateUrl: "./official-new-device-verification.component.html",
})
export class OfficialNewDeviceVerificationComponent implements OnInit, OnDestroy {
  formGroup = this.formBuilder.group({
    code: ["", { validators: [Validators.required], updateOn: "change" }],
  });

  private readonly formGroupDirective = viewChild(FormGroupDirective);

  private alive = true;
  private ownsChallenge = true;
  private operationEpoch = 0;
  private readonly activeAction = signal<"submit" | "resend" | null>(null);
  private readonly destroy$ = new Subject<void>();
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private expirySubscription: Subscription | null = null;
  showBackButton = false;
  private readonly disableRequestOTPSignal = signal(false);

  constructor(
    private readonly router: Router,
    private readonly location: Location,
    private readonly formBuilder: FormBuilder,
    private readonly challenge: OfficialNewDeviceAdapter,
    readonly store: PopupStateStore,
  ) {}

  async ngOnInit() {
    this.showBackButton = this.newDeviceVerificationComponentService.showBackButton();
    this.challenge.refresh();
    this.expirySubscription = this.challenge.expiresAt$.pipe(takeUntil(this.destroy$)).subscribe((expiresAt) => {
      this.scheduleExpiry(expiresAt);
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.alive = false;
    this.operationEpoch += 1;
    this.activeAction.set(null);
    this.disableRequestOTP = true;
    this.clearExpiryTimer();
    this.expirySubscription?.unsubscribe();
    if (this.ownsChallenge) {
      this.challenge.cancel();
    }
    this.formGroup.controls.code.setValue("");
  }

  get loginError(): string {
    return this.store.snapshot().loginError;
  }

  get disableRequestOTP(): boolean {
    return this.disableRequestOTPSignal();
  }

  set disableRequestOTP(disabled: boolean) {
    this.disableRequestOTPSignal.set(disabled);
  }

  async resendOTP(): Promise<void> {
    this.disableRequestOTP = true;
    if (!this.ownsChallenge || this.activeAction() !== null) {
      return;
    }

    this.activeAction.set("resend");
    const operation = this.operationEpoch;
    try {
      await this.challenge.resendOtp();
    } finally {
      if (this.isCurrent(operation) && this.activeAction() === "resend") {
        this.activeAction.set(null);
        this.disableRequestOTP = false;
      }
    }
  }

  submit = async (): Promise<void> => {
    const codeControl = this.formGroup.get("code");
    if (!codeControl || !codeControl.value) {
      return;
    }
    if (this.disableRequestOTP || !this.ownsChallenge) {
      return;
    }
    const code = codeControl.value?.trim() ?? "";
    codeControl.setValue(code);
    if (!code) {
      codeControl.markAsTouched();
      return;
    }

    this.activeAction.set("submit");
    this.disableRequestOTP = true;
    let operation = this.operationEpoch,
      transitionAccepted = false;
    try {
      const outcome = await this.challenge.submitOtp(code);
      if (this.isCurrent(operation)) {
        transitionAccepted = await this.transferRoute(outcome);
      }
    } finally {
      if (!transitionAccepted) {
        codeControl.setValue("");
      }
      if (
        !transitionAccepted &&
        this.isCurrent(operation) &&
        this.activeAction() === "submit"
      ) {
        this.activeAction.set(null);
        this.disableRequestOTP = !this.ownsChallenge;
      }
    }
  };

  onPaste(event: ClipboardEvent): void {
    const pastedText = event.clipboardData?.getData("text")?.trim() ?? "";
    if (!pastedText) {
      return;
    }
    event.preventDefault();
    this.formGroup.controls.code.setValue(pastedText);
    this.formGroupDirective()?.onSubmit(new Event("submit"));
  }

  async goBack(): Promise<void> {
    this.location.back();
    this.operationEpoch += 1;
    this.activeAction.set(null);
    this.disableRequestOTP = true;
    this.ownsChallenge = false;
    this.clearExpiryTimer();
    this.challenge.cancel();
    this.formGroup.controls.code.setValue("");
    try {
      const navigated = await this.router.navigateByUrl("/login");
      if (!navigated) {
        window.location.hash = "#/login";
      }
    } catch {
      window.location.hash = "#/login";
    }
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
      this.disableRequestOTP = true;
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
    this.disableRequestOTP = true;
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
      if (!navigated && this.isCurrent(this.operationEpoch)) {
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

  private readonly newDeviceVerificationComponentService = {
    showBackButton: (): boolean => true,
  };
}
