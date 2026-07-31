import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from "@angular/core";
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";

import { AsyncActionsModule } from "@bitwarden/components";
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
} from "../../../official-ui/official-components";
import { translateOfficialMessage } from "../../../official-ui/official-i18n.service";

const PIN_PATTERN = /^[0-9]{6,8}$/;

@Component({
  selector: "bw-official-pin-lock",
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
    I18nPipe,
    ReactiveFormsModule,
  ],
  templateUrl: "./official-pin-lock.component.html",
})
export class OfficialPinLockComponent implements OnChanges, OnDestroy {
  @Input() submitting = false;
  @Input() showBiometric = false;
  @Input() resetEpoch = 0;
  @Output() readonly pinSubmitted = new EventEmitter<string>();
  @Output() readonly loggedOut = new EventEmitter<void>();
  @Output() readonly methodSelected =
    new EventEmitter<"biometric" | "masterPassword">();

  protected showPin = false;
  readonly formGroup = new FormGroup({
    pin: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(PIN_PATTERN)],
      updateOn: "submit",
    }),
  });

  protected get pinVisibilityLabel(): string {
    return translateOfficialMessage(this.showPin ? "hidePassword" : "showPassword");
  }

  protected togglePinVisibility(): void {
    this.showPin = !this.showPin;
  }

  ngOnDestroy(): void {
    this.clearPin();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["resetEpoch"] && !changes["resetEpoch"].firstChange) {
      this.clearPin(true);
    }
  }

  submit = (): void => {
    this.formGroup.markAllAsTouched();
    const pin = this.formGroup.controls.pin.value;
    if (this.submitting || this.formGroup.invalid) {
      return;
    }
    this.pinSubmitted.emit(pin);
  };

  selectMethod(method: "biometric" | "masterPassword"): void {
    if (!this.submitting) {
      this.methodSelected.emit(method);
    }
  }

  logout(): void {
    if (!this.submitting) {
      this.loggedOut.emit();
    }
  }

  private clearPin(resetValidation = false): void {
    if (resetValidation) {
      this.formGroup.reset({ pin: "" });
    } else {
      this.formGroup.controls.pin.setValue("");
    }
    this.showPin = false;
  }
}
