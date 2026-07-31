import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { BitFormFieldComponent, BitHintDirective, BitInputDirective, BitLabelComponent, CheckboxComponent, FormControlComponent, CardComponent, SectionComponent, SectionHeaderComponent, TypographyDirective } from "../../official-ui/official-components";
import type { RetainedTextSendFormValue } from "../../send/retained-text-send-form.service";
import { I18nPipe } from "../../official-ui/official-ui-common";

@Component({ selector: "bw-official-send-options", standalone: true, imports: [BitFormFieldComponent, BitHintDirective, BitInputDirective, BitLabelComponent, CheckboxComponent, FormControlComponent, CardComponent, I18nPipe, SectionComponent, SectionHeaderComponent, TypographyDirective], templateUrl: "./official-send-options.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class OfficialSendOptionsComponent {
  readonly editing = input.required<boolean>(); readonly hideEmailAllowed = input.required<boolean>(); readonly value = input.required<RetainedTextSendFormValue>();
  readonly valueChange = output<Partial<RetainedTextSendFormValue>>();
  inputValue(event: Event): string { return event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target.value : ""; }
  checked(event: Event): boolean { return event.target instanceof HTMLInputElement && event.target.checked; }
  anyOptionFieldVisible(): boolean { return true; }
  maxAccessCountVisible(): boolean { return true; }
  hideEmailVisible(): boolean { return this.hideEmailAllowed(); }
  privateNoteVisible(): boolean { return true; }
}
