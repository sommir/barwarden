import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, inject, input, output } from "@angular/core";

import { BitFormFieldComponent, BitInputDirective, BitLabelComponent, CheckboxComponent, FormControlComponent, SectionComponent } from "../../official-ui/official-components";
import type { RetainedTextSendErrors, RetainedTextSendField, RetainedTextSendFormValue } from "../../send/retained-text-send-form.service";
import { I18nPipe } from "../../official-ui/official-ui-common";

@Component({
  selector: "bw-official-send-text-details", standalone: true,
  imports: [BitFormFieldComponent, BitInputDirective, BitLabelComponent, CheckboxComponent, FormControlComponent, I18nPipe, SectionComponent],
  templateUrl: "./official-send-text-details.component.html", changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfficialSendTextDetailsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly editing = input.required<boolean>();
  readonly value = input.required<RetainedTextSendFormValue>();
  readonly errors = input.required<RetainedTextSendErrors>();
  readonly touched = input.required<ReadonlySet<RetainedTextSendField>>();
  readonly valueChange = output<Partial<RetainedTextSendFormValue>>();
  readonly fieldBlur = output<RetainedTextSendField>();
  constructor() {
    afterRenderEffect(() => {
      const invalid = this.touched().has("text") && Boolean(this.errors().text);
      const control = this.host.nativeElement.querySelector<HTMLElement>("#send-text");
      if (invalid) {
        control?.setAttribute("aria-invalid", "true");
        control?.setAttribute("aria-describedby", "send-error-text");
      } else {
        control?.removeAttribute("aria-invalid");
        control?.removeAttribute("aria-describedby");
      }
    });
  }
  inputValue(event: Event): string { return event.target instanceof HTMLTextAreaElement ? event.target.value : ""; }
  checked(event: Event): boolean { return event.target instanceof HTMLInputElement && event.target.checked; }
  showHiddenCheckbox(): boolean { return true; }
}
