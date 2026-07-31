import { CommonModule } from "@angular/common";
import { Component, OnDestroy, OnInit } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

import { AsyncActionsModule } from "@bitwarden/components";
import { I18nPipe } from "@bitwarden/ui-common";

import { OfficialPasswordAuthAdapter } from "../../../auth/official-password-auth.adapter";
import {
  AutofocusDirective,
  BitFormFieldComponent,
  BitInputDirective,
  BitLabelComponent,
  ButtonComponent,
} from "../../../official-ui/official-components";
import {
  OfficialPasswordHintApiAdapter,
  type OfficialPasswordHintPort,
} from "../../../auth/official-password-hint-api.adapter";
import { PopupStateStore } from "../../../popup-state";
import { translateOfficialMessage } from "../../../official-ui/official-i18n.service";

/** Guarded transformation of the pinned Password Hint runtime. See official-password-auth.transform-manifest.json. */
@Component({
  selector: "bw-official-password-hint",
  standalone: true,
  imports: [
    AsyncActionsModule,
    AutofocusDirective,
    BitFormFieldComponent,
    BitInputDirective,
    BitLabelComponent,
    ButtonComponent,
    CommonModule,
    I18nPipe,
    ReactiveFormsModule,
  ],
  templateUrl: "./official-password-hint.component.html",
})
export class OfficialPasswordHintComponent implements OnInit, OnDestroy {
  readonly formGroup = this.formBuilder.group({
    email: ["", [Validators.required, Validators.email]],
  });

  private alive = true;
  private navigationEpoch = 0;
  private submitting = false;

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly hint: OfficialPasswordHintApiAdapter,
    private readonly auth: OfficialPasswordAuthAdapter,
    private readonly store: PopupStateStore,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    const email = await this.initialEmail();
    this.formGroup.controls.email.setValue(email);
  }

  submit = async (): Promise<void> => {
    const isEmailValid = this.prepareSubmission();
    if (!isEmailValid) {
      return;
    }
    const operation = ++this.navigationEpoch;
    const serverUrl = this.store.snapshot().serverUrl;
    const email = this.formGroup.controls.email.value?.trim() ?? "";

    try {
      await this.hint.request(serverUrl, email);
    } catch {
      if (this.isCurrent(operation)) {
        this.store.setStatus(translateOfficialMessage("i18nRequestPasswordHintFailed"));
      }
      return;
    } finally {
      if (this.navigationEpoch === operation) {
        this.submitting = false;
      }
    }

    if (!this.isCurrent(operation) || this.store.snapshot().serverUrl !== serverUrl) {
      return;
    }
    this.store.setStatus(translateOfficialMessage("i18nMasterPasswordHintSent"));
    this.auth.setNavigationEmail(email);
    try {
      await this.router.navigateByUrl("/login");
    } catch {
      // A rejected route must not leak an unhandled promise or alter request feedback.
    }
  };

  async cancel(): Promise<void> {
    await this.loginEmailService.setLoginEmail(this.email);
    const operation = ++this.navigationEpoch;
    this.submitting = false;
    this.auth.cancel();
    if (!this.isCurrent(operation)) {
      return;
    }
    try {
      await this.router.navigateByUrl("/login");
    } catch {
      // A rejected route must not leak an unhandled promise or stale completion.
    }
  }

  ngOnDestroy(): void {
    this.alive = false;
    this.navigationEpoch += 1;
    this.auth.cancel();
  }

  private isCurrent(operation: number): boolean {
    return this.alive && operation === this.navigationEpoch;
  }

  private async initialEmail(): Promise<string> {
    const operation = this.navigationEpoch;
    const email = this.auth.takeNavigationEmail() || await firstValueFrom(this.auth.rememberedEmail$);
    return this.isCurrent(operation) ? email : (this.formGroup.controls.email.value ?? "");
  }

  private prepareSubmission(): boolean {
    if (this.submitting) {
      return false;
    }
    const email = this.formGroup.controls.email.value?.trim() ?? "";
    this.formGroup.controls.email.setValue(email);
    this.formGroup.markAllAsTouched();
    if (this.formGroup.invalid) {
      return false;
    }
    this.submitting = true;
    return true;
  }

  private get email(): string {
    return this.formGroup.controls.email.value ?? "";
  }

  private readonly loginEmailService = {
    setLoginEmail: async (email: string): Promise<void> => {
      this.auth.setNavigationEmail(email);
    },
  };
}

export type { OfficialPasswordHintPort };
