import { CommonModule } from "@angular/common";
import { afterNextRender, Component, ElementRef, Injector, OnDestroy, OnInit, ViewChild } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { Subject, takeUntil } from "rxjs";

import { AsyncActionsModule, LinkModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import {
  OfficialPasswordAuthAdapter,
  type OfficialPasswordAuthPort,
  type RetainedLoginResult,
} from "../../../auth/official-password-auth.adapter";
import {
  AutofocusDirective,
  BitFormFieldComponent,
  BitIconButtonComponent,
  BitInputDirective,
  BitLabelComponent,
  BitPasswordInputToggleDirective,
  BitSuffixDirective,
  ButtonComponent,
  CalloutComponent,
  CheckboxComponent,
  FormControlComponent,
  TypographyDirective,
} from "../../../official-ui/official-components";
import { translateOfficialMessage } from "../../../official-ui/official-i18n.service";
import { PopupStateStore } from "../../../popup-state";
import { OfficialEnvironmentSelectorComponent } from "../environment/official-environment-selector.component";

const LoginUiState = {
  EMAIL_ENTRY: "email",
  MASTER_PASSWORD_ENTRY: "masterPassword",
} as const;

/**
 * Guarded transformation of the pinned Login runtime. See official-password-auth.transform-manifest.json.
 */
@Component({
  selector: "bw-official-password-login",
  standalone: true,
  imports: [
    AsyncActionsModule,
    AutofocusDirective,
    BitFormFieldComponent,
    BitIconButtonComponent,
    BitInputDirective,
    BitLabelComponent,
    BitPasswordInputToggleDirective,
    BitSuffixDirective,
    ButtonComponent,
    CalloutComponent,
    CheckboxComponent,
    CommonModule,
    FormControlComponent,
    I18nPipe,
    LinkModule,
    OfficialEnvironmentSelectorComponent,
    ReactiveFormsModule,
    RouterLink,
    TypographyDirective,
  ],
  templateUrl: "./official-password-login.component.html",
})
export class OfficialPasswordLoginComponent implements OnInit, OnDestroy {
  readonly LoginUiState = LoginUiState;
  readonly formGroup = this.formBuilder.group({
    email: ["", [Validators.required, Validators.email]],
    masterPassword: ["", [Validators.required, Validators.minLength(8)]],
    rememberEmail: [false],
  });

  loginUiState: (typeof LoginUiState)[keyof typeof LoginUiState] = LoginUiState.EMAIL_ENTRY;
  environmentIsValid = true;
  protected showPassword = false;
  private serverUrl = this.store.snapshot().serverUrl;
  private alive = true;
  private navigationEpoch = 0;
  protected submitting = false;
  private authPending = false;
  private navigationEmail = "";
  private emailValidationSnapshot: { touched: boolean; dirty: boolean } | null = null;
  private readonly destroy$ = new Subject<void>();

  @ViewChild("masterPasswordInputRef")
  private masterPasswordInput?: ElementRef<HTMLInputElement>;
  @ViewChild("emailInputRef")
  private emailInput?: ElementRef<HTMLInputElement>;
  private passwordSelection: readonly [number | null, number | null] = [null, null];

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly auth: OfficialPasswordAuthAdapter,
    private readonly store: PopupStateStore,
    private readonly router: Router,
    private readonly injector: Injector,
  ) {
    this.auth.rememberedEmail$
      .pipe(takeUntil(this.destroy$))
      .subscribe((email) => {
        if (this.loginUiState === LoginUiState.EMAIL_ENTRY) {
          this.formGroup.controls.email.setValue(email);
          this.formGroup.controls.rememberEmail.setValue(Boolean(email));
        }
      });

  }

  async ngOnInit(): Promise<void> {
    this.navigationEmail = this.auth.takeNavigationEmail();
    await this.defaultOnInit();
  }

  private async defaultOnInit(): Promise<void> {
    if (this.navigationEmail) {
      this.formGroup.controls.email.setValue(this.navigationEmail);
      this.formGroup.controls.rememberEmail.setValue(false);
    }
  }

  get loginError(): string {
    return this.store.snapshot().loginError;
  }

  onEmailInput(_event: Event): void {
    this.store.setLoginError("");
  }
  onMasterPasswordInput(): void {
    this.dismissLoginError();
  }

  dismissLoginError(): void {
    this.store.setLoginError("");
  }
  onRememberEmailInput(_event: Event): void {}

  preservePasswordFocus(event: Event): void {
    const input = this.masterPasswordInput?.nativeElement;
    if (!input) {
      return;
    }
    this.passwordSelection = [input.selectionStart, input.selectionEnd];
    event.preventDefault();
  }

  passwordVisibilityChanged(visible: boolean): void {
    this.showPassword = visible;
    queueMicrotask(() => {
      const input = this.masterPasswordInput?.nativeElement;
      if (!input) {
        return;
      }
      input.focus({ preventScroll: true });
      const [start, end] = this.passwordSelection;
      if (start !== null && end !== null) {
        input.setSelectionRange(start, end);
      }
    });
  }

  protected get passwordVisibilityLabel(): string {
    return translateOfficialMessage(this.showPassword ? "hidePassword" : "showPassword");
  }

  captureEmailValidationState(): void {
    const control = this.formGroup.controls.email;
    this.emailValidationSnapshot = {
      touched: control.touched,
      dirty: control.dirty,
    };
  }

  restoreEmailValidationState(): void {
    const snapshot = this.emailValidationSnapshot;
    if (!snapshot) {
      return;
    }
    const control = this.formGroup.controls.email;
    const restore = () => {
      if (snapshot.touched) {
        control.markAsTouched({ onlySelf: true });
      } else {
        control.markAsUntouched({ onlySelf: true });
      }
      if (snapshot.dirty) {
        control.markAsDirty({ onlySelf: true });
      } else {
        control.markAsPristine({ onlySelf: true });
      }
    };
    queueMicrotask(restore);
    window.setTimeout(() => {
      restore();
      this.emailValidationSnapshot = null;
    });
  }

  async continuePressed(): Promise<void> {
    const mpEntryLayoutOverride = undefined;
    await this.continue(mpEntryLayoutOverride);
  }

  private async continue(_mpEntryLayoutOverride: undefined): Promise<void> {
    this.clearMasterPassword();
    const email = this.formGroup.controls.email.value?.trim() ?? "";
    this.formGroup.controls.email.setValue(email);
    this.formGroup.controls.email.markAsTouched();
    if (this.formGroup.controls.email.invalid) {
      this.focusEmail();
      return;
    }
    if (!this.environmentIsValid || !isValidHttpsServerUrl(this.serverUrl)) {
      this.formGroup.controls.email.setErrors({ environment: true });
      this.clearMasterPassword();
      this.focusEmail();
      return;
    }

    this.store.setLoginError("");
    this.loginUiState = LoginUiState.MASTER_PASSWORD_ENTRY;
    this.auth.rememberEmail(email, this.formGroup.controls.rememberEmail.value === true);
    afterNextRender(
      { write: () => this.masterPasswordInput?.nativeElement.focus() },
      { injector: this.injector },
    );
  }

  submit = async (): Promise<void> => {
    if (this.loginUiState !== LoginUiState.MASTER_PASSWORD_ENTRY) {
      await this.continuePressed();
      return;
    }
    const { email, masterPassword } = this.formGroup.value;
    this.formGroup.markAllAsTouched();
    if (this.submitting) {
      return;
    }

    this.submitting = true;
    const operation = ++this.navigationEpoch;
    const normalizedEmail = email?.trim() ?? "";
    let submittedMasterPassword = masterPassword ?? "",
      transitionAccepted = false;

    try {
      if (
        this.formGroup.invalid ||
        !normalizedEmail ||
        !submittedMasterPassword ||
        !this.environmentIsValid ||
        !isValidHttpsServerUrl(this.serverUrl)
      ) {
        this.focusMasterPassword();
        return;
      }

      this.store.setLoginError("");
      this.authPending = true;
      let result: RetainedLoginResult;
      try {
        result = await this.auth.login({
          email: normalizedEmail,
          masterPassword: submittedMasterPassword,
          serverUrl: this.serverUrl,
        });
      } catch {
        if (this.isCurrent(operation) && !this.store.snapshot().loginError) {
          this.store.setLoginError(translateOfficialMessage("i18nUnableToLoginServer"));
        }
        return;
      } finally {
        this.authPending = false;
      }
      const state = this.store.snapshot();
      if (!this.canNavigate(operation, result, normalizedEmail, state)) {
        return;
      }

      try {
        const navigated = await this.router.navigateByUrl(
          result === "vault"
            ? "/tabs/vault"
            : result === "twoFactor"
              ? "/2fa"
              : "/new-device-verification",
        );
        if (!navigated && this.isCurrent(operation)) {
          this.store.setStatus(translateOfficialMessage("i18nUnableToNavigate"));
        } else if (navigated) {
          transitionAccepted = true;
        }
      } catch {
        if (this.isCurrent(operation)) {
          this.store.setStatus(translateOfficialMessage("i18nUnableToNavigate"));
        }
      }
    } finally {
      submittedMasterPassword = "";
      if (!transitionAccepted) {
        this.clearMasterPassword();
      }
      if (!transitionAccepted && this.navigationEpoch === operation) {
        this.submitting = false;
      }
    }
  };

  backButtonClicked(): void {
    this.invalidateNavigation();
    this.auth.cancel();
    this.clearMasterPassword();
    this.loginUiState = LoginUiState.EMAIL_ENTRY;
  }

  goToHint(): void {
    this.invalidateNavigation();
    this.auth.cancel();
    this.authPending = false;
    this.auth.setNavigationEmail(this.formGroup.controls.email.value ?? "");
  }

  shouldShowBackButton(): boolean {
    return true;
  }

  selectEnvironment(serverUrl: string): void {
    this.invalidateNavigation();
    this.auth.cancel();
    this.serverUrl = serverUrl;
    this.clearMasterPassword();
  }

  ngOnDestroy(): void {
    this.alive = false;
    this.invalidateNavigation();
    this.destroy$.next();
    this.destroy$.complete();
    if (this.authPending) {
      this.auth.cancel();
    }
    this.clearMasterPassword();
  }

  private canNavigate(
    operation: number,
    authResult: RetainedLoginResult,
    email: string,
    state: ReturnType<PopupStateStore["snapshot"]>,
  ): boolean {
    if (!this.isCurrent(operation)) {
      return false;
    }
    if (authResult === "vault") {
      return state.isUnlocked && state.email === email;
    }
    return state.authChallenge?.email === email &&
      state.authChallenge.serverUrl === this.serverUrl &&
      ((authResult === "twoFactor" && state.authChallenge.type === "twoFactor") ||
        (authResult === "newDeviceVerification" && state.authChallenge.type === "newDevice"));
  }

  private isCurrent(operation: number): boolean {
    return this.alive && operation === this.navigationEpoch;
  }

  private invalidateNavigation(): void {
    this.navigationEpoch += 1;
    this.submitting = false;
  }

  private clearMasterPassword(): void {
    this.formGroup.controls.masterPassword.setValue("");
    this.formGroup.controls.masterPassword.markAsPristine();
    this.showPassword = false;
  }

  private focusEmail(): void {
    queueMicrotask(() => this.emailInput?.nativeElement.focus({ preventScroll: true }));
  }

  private focusMasterPassword(): void {
    queueMicrotask(() => this.masterPasswordInput?.nativeElement.focus({ preventScroll: true }));
  }
}

function isValidHttpsServerUrl(serverUrl: string): boolean {
  try {
    const url = new URL(serverUrl.trim());
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export type { OfficialPasswordAuthPort };
