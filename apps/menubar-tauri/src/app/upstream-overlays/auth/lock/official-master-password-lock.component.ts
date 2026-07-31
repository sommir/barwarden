import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from "@angular/core";
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from "@angular/forms";

import {
  AsyncActionsModule,
} from "@bitwarden/components";
import { JslibModule } from "@bitwarden/angular/jslib.module";
import { I18nPipe } from "@bitwarden/ui-common";

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
  TypographyDirective,
} from "../../../official-ui/official-components";

import {
  OfficialMasterPasswordUnlockAdapter,
  OfficialMasterPasswordUnlockError,
} from "../../../auth/official-master-password-unlock.adapter";
import type { AuthUnlockResult } from "../../../auth/auth.facade";
import { translateOfficialMessage } from "../../../official-ui/official-i18n.service";

/** Guarded transformation of the pinned MasterPasswordLockComponent. */
@Component({
  selector: "bw-official-master-password-lock",
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
    I18nPipe,
    JslibModule,
    ReactiveFormsModule,
    TypographyDirective,
  ],
  templateUrl: "./official-master-password-lock.component.html",
})
export class OfficialMasterPasswordLockComponent implements OnChanges, OnDestroy {
  @Output() readonly unlocked = new EventEmitter<AuthUnlockResult>();
  @Output() readonly loggedOut = new EventEmitter<void>();
  @Output() readonly methodSelected = new EventEmitter<"biometric" | "pin">();

  @Input() showBiometric = false;
  @Input() showPin = false;
  @Input() resetEpoch = 0;
  protected showPassword = false;
  protected submitting = false;
  protected unlockFailed = false;
  protected unlockErrorMessage = translateOfficialMessage("i18nUnableToUnlock");
  readonly formGroup = new FormGroup({
    masterPassword: new FormControl("", {
      validators: [Validators.required],
      updateOn: "submit",
    }),
  });

  constructor(private readonly unlockPort: OfficialMasterPasswordUnlockAdapter) {}

  protected get passwordVisibilityLabel(): string {
    return translateOfficialMessage(this.showPassword ? "hidePassword" : "showPassword");
  }

  protected togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  ngOnDestroy(): void {
    this.clearMasterPassword();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["resetEpoch"] && !changes["resetEpoch"].firstChange) {
      this.clearMasterPassword();
      this.submitting = false;
    }
  }

  submit = async (): Promise<void> => {
    if (this.submitting) {
      return;
    }

    this.formGroup.markAllAsTouched();
    let masterPassword = this.formGroup.controls.masterPassword.value ?? "";
    if (this.formGroup.invalid || !masterPassword) {
      this.clearMasterPassword();
      return;
    }

    this.submitting = true;
    this.unlockFailed = false;
    this.unlockErrorMessage = translateOfficialMessage("i18nUnableToUnlock");
    let transitionAccepted = false;
    try {
      const result = await this.unlockPort.unlock(masterPassword);
      transitionAccepted = true;
      this.unlocked.emit(result);
    } catch (error) {
      this.unlockFailed = true;
      if (error instanceof OfficialMasterPasswordUnlockError) {
        this.unlockErrorMessage = error.message;
      }
    } finally {
      masterPassword = "";
      if (!transitionAccepted) {
        this.clearMasterPassword();
        this.submitting = false;
      }
    }
  };

  async logout(): Promise<void> {
    if (this.submitting) {
      return;
    }

    this.submitting = true;
    try {
      this.unlockFailed = false;
      await this.unlockPort.logout();
      this.loggedOut.emit();
    } catch {
      // The retained locked account remains recoverable; success is deliberately not emitted.
    } finally {
      this.clearMasterPassword();
      this.submitting = false;
    }
  }

  dismissUnlockError(): void {
    this.unlockFailed = false;
    this.unlockErrorMessage = translateOfficialMessage("i18nUnableToUnlock");
  }

  selectMethod(method: "biometric" | "pin"): void {
    if (!this.submitting) {
      this.methodSelected.emit(method);
    }
  }

  private clearMasterPassword(): void {
    this.formGroup.controls.masterPassword.setValue("");
    this.showPassword = false;
  }
}
