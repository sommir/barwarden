import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormControl, ReactiveFormsModule } from "@angular/forms";

import { JslibModule } from "@bitwarden/angular/jslib.module";

import {
  AutofocusDirective,
  BitFormFieldComponent,
  BitInputDirective,
  BitLabelComponent,
} from "../../../official-ui/official-components";

/** Retained Authenticator child from the pinned official two-factor runtime. */
@Component({
  selector: "bw-official-two-factor-authenticator",
  standalone: true,
  imports: [
    AutofocusDirective,
    BitFormFieldComponent,
    BitInputDirective,
    BitLabelComponent,
    JslibModule,
    ReactiveFormsModule,
  ],
  templateUrl: "./official-two-factor-authenticator.component.html",
})
export class OfficialTwoFactorAuthenticatorComponent {
  @Input({ required: true }) tokenFormControl: FormControl<string | null> | undefined;
  @Output() readonly tokenChange = new EventEmitter<{ token: string }>();
  @Output() readonly submitOnPaste = new EventEmitter<void>();

  onTokenChange(event: Event): void {
    this.tokenChange.emit({ token: (event.target as HTMLInputElement).value || "" });
  }

  onPaste(event: ClipboardEvent): void {
    const pastedText = event.clipboardData?.getData("text")?.trim() ?? "";
    if (!pastedText) {
      return;
    }
    event.preventDefault();
    this.tokenFormControl?.setValue(pastedText);
    this.submitOnPaste.emit();
  }
}
