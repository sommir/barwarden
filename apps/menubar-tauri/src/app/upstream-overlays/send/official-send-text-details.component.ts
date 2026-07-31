import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import { BitFormFieldComponent, BitInputDirective, BitLabelComponent, CheckboxComponent, FormControlComponent, SectionComponent } from "../../official-ui/official-components";
import type { RetainedTextSendFormValue } from "../../send/retained-text-send-form.service";
import { I18nPipe } from "../../official-ui/official-ui-common";

@Component({
  selector: "bw-official-send-text-details", standalone: true,
  imports: [BitFormFieldComponent, BitInputDirective, BitLabelComponent, CheckboxComponent, FormControlComponent, I18nPipe, SectionComponent],
  templateUrl: "./official-send-text-details.component.html", changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfficialSendTextDetailsComponent {
  readonly editing = input.required<boolean>();
  readonly value = input.required<RetainedTextSendFormValue>();
  readonly valueChange = output<Partial<RetainedTextSendFormValue>>();
  inputValue(event: Event): string { return event.target instanceof HTMLTextAreaElement ? event.target.value : ""; }
  checked(event: Event): boolean { return event.target instanceof HTMLInputElement && event.target.checked; }
  showHiddenCheckbox(): boolean { return true; }
}
