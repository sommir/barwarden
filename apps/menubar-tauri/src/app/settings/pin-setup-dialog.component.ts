import {
  Component,
  ElementRef,
  EventEmitter,
  OnDestroy,
  Output,
  ViewChild,
} from "@angular/core";
import { DialogModule as CdkDialogModule } from "@angular/cdk/dialog";
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";

import {
  BitFormFieldComponent,
  BitInputDirective,
  BitLabelComponent,
  ButtonComponent,
  DialogComponent,
  DialogFooterDirective,
} from "../official-ui/official-components";
import { AppBottomSheetComponent } from "../official-ui/app-bottom-sheet.component";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";

const PIN_PATTERN = /^[0-9]{6,8}$/;

@Component({
  selector: "bw-pin-setup-dialog",
  standalone: true,
  imports: [
    AppBottomSheetComponent,
    BitFormFieldComponent,
    BitInputDirective,
    BitLabelComponent,
    ButtonComponent,
    CdkDialogModule,
    DialogComponent,
    DialogFooterDirective,
    I18nPipe,
    ReactiveFormsModule,
  ],
  template: `
    <bw-app-bottom-sheet
      #dialog
      labelledBy="pin-setup-title"
      describedBy="pin-setup-description"
      testId="pin-setup-dialog"
      (dismissed)="cancel()"
    >
      <form
        bit-dialog
        dialogSize="small"
        [formGroup]="formGroup"
        (submit)="onSubmit($event)"
      >
        <span bitDialogTitle id="pin-setup-title">{{ "i18nSetPin" | i18n }}</span>
        <ng-container bitDialogContent>
          <p id="pin-setup-description">
            {{ "i18nPinSetupDescription" | i18n }}
          </p>

          <div class="tw-flex tw-flex-col tw-gap-4 tw-mt-6">
            <bit-form-field>
              <bit-label>PIN</bit-label>
              <input
                #pinInput
                bitInput
                type="password"
                formControlName="pin"
                inputmode="numeric"
                autocomplete="new-password"
                maxlength="8"
                pattern="[0-9]{6,8}"
                required
                data-testid="pin-setup-input"
              />
            </bit-form-field>

            <bit-form-field disableMargin>
              <bit-label>{{ "i18nPinConfirm" | i18n }}</bit-label>
              <input
                bitInput
                type="password"
                formControlName="confirmPin"
                inputmode="numeric"
                autocomplete="new-password"
                maxlength="8"
                pattern="[0-9]{6,8}"
                required
                data-testid="pin-setup-confirmation"
              />
            </bit-form-field>
          </div>

          @if (errorMessage) {
            <p class="tw-text-danger tw-mt-3" role="alert">{{ errorMessage }}</p>
          }
        </ng-container>

        <ng-container bitDialogFooter>
          <button bitButton buttonType="primary" type="submit">{{ "save" | i18n }}</button>
          <button bitButton buttonType="secondary" type="button" (click)="cancel()">
            {{ "cancel" | i18n }}
          </button>
        </ng-container>
      </form>
    </bw-app-bottom-sheet>
  `,
})
export class PinSetupDialogComponent implements OnDestroy {
  @ViewChild("dialog") private dialog?: AppBottomSheetComponent;
  @ViewChild("pinInput") private pinInput?: ElementRef<HTMLInputElement>;
  @Output() readonly pinConfirmed = new EventEmitter<string>();

  errorMessage = "";
  readonly formGroup = new FormGroup({
    pin: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(PIN_PATTERN)],
      updateOn: "submit",
    }),
    confirmPin: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(PIN_PATTERN)],
      updateOn: "submit",
    }),
  });

  open(): void {
    this.clearSecrets();
    this.errorMessage = "";
    if (!this.dialog) {
      return;
    }
    this.dialog.open(undefined, this.pinInput?.nativeElement);
  }

  submit(): void {
    this.formGroup.markAllAsTouched();
    let pin = this.formGroup.controls.pin.value;
    const confirmation = this.formGroup.controls.confirmPin.value;
    if (this.formGroup.invalid) {
      this.clearSecrets();
      this.errorMessage = translateOfficialMessage("i18nPinRequirement");
      return;
    }
    if (pin !== confirmation) {
      this.clearSecrets();
      this.errorMessage = translateOfficialMessage("i18nPinMismatch");
      return;
    }

    this.clearSecrets();
    this.errorMessage = "";
    this.closeDialog();
    this.pinConfirmed.emit(pin);
    pin = "";
  }

  cancel(): void {
    this.clearSecrets();
    this.errorMessage = "";
    this.closeDialog();
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  ngOnDestroy(): void {
    this.cancel();
  }

  private clearSecrets(): void {
    this.formGroup.controls.pin.setValue("");
    this.formGroup.controls.confirmPin.setValue("");
  }

  private closeDialog(): void {
    this.dialog?.close();
  }
}
