import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormControl, ReactiveFormsModule } from "@angular/forms";

import { LinkModule } from "@bitwarden/components";
import { JslibModule } from "@bitwarden/angular/jslib.module";

import { OfficialChallengeAdapter } from "../../../auth/official-challenge.adapter";
import {
  AutofocusDirective,
  BitFormFieldComponent,
  BitInputDirective,
  BitLabelComponent,
  TypographyDirective,
} from "../../../official-ui/official-components";

/** Retained Email child with the official email service replaced by the bounded challenge port. */
@Component({
  selector: "bw-official-two-factor-email",
  standalone: true,
  imports: [
    AutofocusDirective,
    BitFormFieldComponent,
    BitInputDirective,
    BitLabelComponent,
    JslibModule,
    LinkModule,
    ReactiveFormsModule,
    TypographyDirective,
  ],
  templateUrl: "./official-two-factor-email.component.html",
})
export class OfficialTwoFactorEmailComponent {
  @Input({ required: true }) tokenFormControl: FormControl<string | null> | undefined;
  @Output() readonly tokenChange = new EventEmitter<{ token: string }>();
  @Output() readonly submitOnPaste = new EventEmitter<void>();

  constructor(private readonly challenge: OfficialChallengeAdapter) {}

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

  async sendEmail(_doToast: boolean): Promise<void> {
    await this.challenge.sendEmail();
  }
}
