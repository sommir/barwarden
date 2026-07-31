import { Component, DestroyRef, inject, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { map } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";
import { AsyncActionsModule } from "@bitwarden/components/async-actions/async-actions.module";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { IconButtonModule } from "@bitwarden/components/icon-button/icon-button.module";
import { LinkModule } from "@bitwarden/components/link/link.module";
import { PopoverModule } from "@bitwarden/components/popover/popover.module";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { TypographyModule } from "@bitwarden/components/typography/typography.module";

import { CipherFormGenerationService } from "../../../../../../vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form-generation.service";
import { GENERATOR_OPERATION_RECEIPT } from "../../generator/generator-runtime.port";
import type { RetainedCipherFormGenerationService } from "../../vault/retained-login-form.adapter";
import { OfficialAutofillOptionsComponent } from "./official-autofill-options.component";
import { OfficialLoginFormContainer } from "./official-login-form-container";

@Component({
  selector: "vault-login-details-section",
  templateUrl: "./official-login-details.component.html",
  imports: [
    ReactiveFormsModule,
    SectionHeaderComponent,
    TypographyModule,
    JslibModule,
    CardComponent,
    FormFieldModule,
    IconButtonModule,
    AsyncActionsModule,
    PopoverModule,
    OfficialAutofillOptionsComponent,
    LinkModule,
  ],
})
export class OfficialLoginDetailsComponent implements OnInit {
  loginDetailsForm = this.formBuilder.group({
    username: [""],
    password: [""],
    totp: [""],
  });

  newPasswordGenerated: boolean;

  private destroyRef = inject(DestroyRef);
  private operationReceipt = inject(GENERATOR_OPERATION_RECEIPT);

  get viewHiddenFields() {
    return this.cipherFormContainer.canViewSecrets;
  }

  get initialValues() {
    return this.cipherFormContainer.config.initialValues;
  }

  constructor(
    private cipherFormContainer: OfficialLoginFormContainer,
    private formBuilder: FormBuilder,
    private generationService: CipherFormGenerationService,
  ) {
    this.cipherFormContainer.registerChildForm(
      "loginDetails",
      this.loginDetailsForm,
    );

    this.loginDetailsForm.valueChanges
      .pipe(
        takeUntilDestroyed(),
        map(() => this.loginDetailsForm.getRawValue()),
      )
      .subscribe((value) => {
        this.cipherFormContainer.patchCipher((cipher) => {
          Object.assign(cipher.login, {
            username: value.username,
            password: value.password,
            totp: value.totp?.trim(),
          } as LoginView);

          return cipher;
        });
      });
  }

  ngOnInit() {
    const prefillCipher = this.cipherFormContainer.getInitialCipherView();

    if (prefillCipher) {
      this.initFromExistingCipher(prefillCipher.login);
    } else {
      this.initNewCipher();
    }

    if (this.cipherFormContainer.config.mode === "partial-edit") {
      this.loginDetailsForm.disable();
    }

    this.cipherFormContainer.formStatusChange$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => {
        if (status === "enabled") {
          if (!this.viewHiddenFields) {
            this.loginDetailsForm.controls.password.disable();
            this.loginDetailsForm.controls.totp.disable();
          }
        }
      });
  }

  private initFromExistingCipher(existingLogin: LoginView) {
    this.loginDetailsForm.patchValue({
      username: this.initialValues?.username ?? existingLogin.username,
      password: this.viewHiddenFields
        ? (this.initialValues?.password ?? existingLogin.password)
        : "",
      totp: this.viewHiddenFields ? existingLogin.totp : "",
    });

    if (!this.viewHiddenFields) {
      this.loginDetailsForm.controls.password.disable();
      this.loginDetailsForm.controls.totp.disable();
    }
  }

  private initNewCipher() {
    this.loginDetailsForm.patchValue({
      username: this.initialValues?.username || "",
      password: this.viewHiddenFields ? this.initialValues?.password || "" : "",
    });

    if (!this.viewHiddenFields) {
      this.loginDetailsForm.controls.password.disable();
      this.loginDetailsForm.controls.totp.disable();
    }
  }

  generatePassword = async () => {
    const completeReceipt = this.operationReceipt?.begin();
    try {
      await (this.generationService as RetainedCipherFormGenerationService)
        .generatePassword((newPassword) => {
          if (newPassword) {
            this.loginDetailsForm.controls.password.patchValue(newPassword);
            this.newPasswordGenerated = true;
          }
        });
    } finally {
      completeReceipt?.();
    }
  };

  generateUsername = async () => {
    const completeReceipt = this.operationReceipt?.begin();
    try {
      await (this.generationService as RetainedCipherFormGenerationService)
        .generateUsername(this.cipherFormContainer.website, (newUsername) => {
          if (newUsername) {
            this.loginDetailsForm.controls.username.patchValue(newUsername);
          }
        });
    } finally {
      completeReceipt?.();
    }
  };
}
