import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, inject, input, output } from "@angular/core";
import { BitFormFieldComponent, BitHintDirective, BitInputDirective, BitLabelComponent, CheckboxComponent, FormControlComponent, SectionComponent, SectionHeaderComponent, TypographyDirective } from "../../official-ui/official-components";
import type { RetainedTextSendErrors, RetainedTextSendField, RetainedTextSendFormValue } from "../../send/retained-text-send-form.service";
import { I18nPipe } from "../../official-ui/official-ui-common";

@Component({ selector: "bw-official-send-options", standalone: true, imports: [BitFormFieldComponent, BitHintDirective, BitInputDirective, BitLabelComponent, CheckboxComponent, FormControlComponent, I18nPipe, SectionComponent, SectionHeaderComponent, TypographyDirective], templateUrl: "./official-send-options.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class OfficialSendOptionsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly editing = input.required<boolean>(); readonly hideEmailAllowed = input.required<boolean>(); readonly value = input.required<RetainedTextSendFormValue>(); readonly errors = input.required<RetainedTextSendErrors>(); readonly touched = input.required<ReadonlySet<RetainedTextSendField>>();
  readonly valueChange = output<Partial<RetainedTextSendFormValue>>(); readonly fieldBlur = output<RetainedTextSendField>();
  constructor() {
    afterRenderEffect(() => this.syncMaxAccessCountAccessibility());
  }
  inputValue(event: Event): string { return event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target.value : ""; }
  checked(event: Event): boolean { return event.target instanceof HTMLInputElement && event.target.checked; }
  anyOptionFieldVisible(): boolean { return true; }
  maxAccessCountVisible(): boolean { return true; }
  hideEmailVisible(): boolean { return this.hideEmailAllowed(); }
  privateNoteVisible(): boolean { return true; }

  private syncMaxAccessCountAccessibility(): void {
    const invalid = this.touched().has("maxAccessCount") && Boolean(this.errors().maxAccessCount);
    const control = this.host.nativeElement.querySelector<HTMLElement>("#send-maxAccessCount");
    if (!control) return;
    if (invalid) control.setAttribute("aria-invalid", "true");
    else control.removeAttribute("aria-invalid");

    const hintId = this.editing()
      ? control.closest("bit-form-field")?.querySelector<HTMLElement>("bit-hint")?.id
      : undefined;
    const describedBy = [hintId, invalid ? "send-error-maxAccessCount" : undefined]
      .filter((id): id is string => Boolean(id))
      .join(" ");
    if (describedBy) control.setAttribute("aria-describedby", describedBy);
    else control.removeAttribute("aria-describedby");
  }
}
