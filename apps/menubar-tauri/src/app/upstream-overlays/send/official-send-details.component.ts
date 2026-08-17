import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, inject, input, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { BitFormFieldComponent, BitHintDirective, BitIconButtonComponent, BitInputDirective, BitLabelComponent, BitSuffixDirective, ButtonComponent, OptionComponent, SectionComponent, SectionHeaderComponent, SelectComponent, TypographyDirective } from "../../official-ui/official-components";
import type { RetainedTextSendErrors, RetainedTextSendField, RetainedTextSendFormValue } from "../../send/retained-text-send-form.service";
import { OfficialSendOptionsComponent } from "./official-send-options.component";
import { OfficialSendTextDetailsComponent } from "./official-send-text-details.component";
import { translateOfficialMessage } from "../../official-ui/official-i18n.service";
import { I18nPipe } from "../../official-ui/official-ui-common";

@Component({ selector: "bw-official-send-details", standalone: true, imports: [FormsModule, I18nPipe, BitFormFieldComponent, BitHintDirective, BitIconButtonComponent, BitInputDirective, BitLabelComponent, BitSuffixDirective, ButtonComponent, OptionComponent, SectionComponent, SectionHeaderComponent, SelectComponent, TypographyDirective, OfficialSendOptionsComponent, OfficialSendTextDetailsComponent], templateUrl: "./official-send-details.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class OfficialSendDetailsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly editing = input.required<boolean>(); readonly disabled = input.required<boolean>(); readonly originalHadPassword = input.required<boolean>(); readonly hideEmailAllowed = input.required<boolean>(); readonly value = input.required<RetainedTextSendFormValue>(); readonly errors = input.required<RetainedTextSendErrors>(); readonly touched = input.required<ReadonlySet<RetainedTextSendField>>();
  readonly valueChange = output<Partial<RetainedTextSendFormValue>>(); readonly fieldBlur = output<RetainedTextSendField>(); readonly removePassword = output<void>(); readonly generatePassword = output<void>(); readonly copyPassword = output<Event>();
  constructor() {
    afterRenderEffect(() => {
      const errors = this.errors();
      const touched = this.touched();
      setErrorAttributes(this.host.nativeElement, "name", touched.has("name") && Boolean(errors.name));
      setErrorAttributes(this.host.nativeElement, "password", touched.has("password") && Boolean(errors.password));
    });
  }
  get datePresetOptions() {
    return [1, 24, 48, 72, 168, 336, 720].map((value) => ({
      value,
      label: value < 24
        ? translateOfficialMessage("i18nHours", value)
        : translateOfficialMessage("i18nDays", value / 24),
    }));
  }
  get authorizationOptions() {
    return [
      { value: "none" as const, label: this.authOptions[0] },
      { value: "password" as const, label: this.authOptions[1] },
    ];
  }
  get authOptions() {
    return [
      translateOfficialMessage("i18nAnyoneWithLink"),
      translateOfficialMessage("i18nAnyoneWithPassword"),
    ] as const;
  }
  inputValue(event: Event): string { return event.target instanceof HTMLInputElement ? event.target.value : ""; }
  deletionPreset(value: unknown): RetainedTextSendFormValue["deletionPresetHours"] { return Number(typeof value === "number" || typeof value === "string" ? value : 168) as RetainedTextSendFormValue["deletionPresetHours"]; }
  authType(value: unknown): RetainedTextSendFormValue["authType"] { return value === "password" ? "password" : "none"; }
  deletionLabel(): string { return this.datePresetOptions.find(({ value }) => value === this.value().deletionPresetHours)?.label ?? translateOfficialMessage("i18nDays", 7); }
  authTypeLabel(): string { return this.authorizationOptions.find(({ value }) => value === this.value().authType)?.label ?? translateOfficialMessage("i18nAnyoneWithLink"); }
}

function setErrorAttributes(host: HTMLElement, field: RetainedTextSendField, invalid: boolean): void {
  const control = host.querySelector<HTMLElement>(`#send-${field}`);
  if (!control) return;
  if (invalid) {
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", `send-error-${field}`);
  } else {
    control.removeAttribute("aria-invalid");
    control.removeAttribute("aria-describedby");
  }
}
