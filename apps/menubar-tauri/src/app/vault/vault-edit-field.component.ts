import { booleanAttribute, Component, EventEmitter, Input, Output } from "@angular/core";
import { I18nPipe } from "../official-ui/official-ui-common";

type VaultEditFieldType = "text" | "password" | "url" | "email" | "tel" | "number";

@Component({
  selector: "bw-vault-edit-field",
  standalone: true,
  imports: [I18nPipe],
  template: `
    <div class="cipher-form-field">
      <label [attr.for]="controlId">
        {{ label }}
        @if (required) {
          <span class="cipher-form-required" aria-hidden="true">*</span>
        }
      </label>
      <div class="cipher-form-control">
        @if (textarea) {
          <textarea
            [id]="controlId"
            [value]="value"
            [required]="required"
            [attr.aria-label]="label"
            [attr.aria-describedby]="hint ? hintId : null"
            (input)="onInput($event)"
          ></textarea>
        } @else {
          <input
            [id]="controlId"
            [type]="inputType"
            [value]="value"
            [required]="required"
            [attr.aria-label]="label"
            [attr.aria-describedby]="hint ? hintId : null"
            (input)="onInput($event)"
          />
        }
        @if (revealable && type === "password") {
          <button
            type="button"
            class="icon-action cipher-form-suffix"
            [attr.aria-label]="revealed ? ('i18nHideField' | i18n: label) : ('i18nShowField' | i18n: label)"
            (click)="revealed = !revealed"
          >
            <i class="bwi" [class.bwi-eye]="!revealed" [class.bwi-eye-slash]="revealed" aria-hidden="true"></i>
          </button>
        }
        <ng-content select="[slot=suffix]" />
      </div>
      @if (hint) {
        <small [id]="hintId">{{ hint }}</small>
      }
    </div>
  `,
})
export class VaultEditFieldComponent {
  @Input({ required: true }) label = "";
  @Input({ required: true }) controlId = "";
  @Input() value = "";
  @Input() type: VaultEditFieldType = "text";
  @Input({ transform: booleanAttribute }) textarea = false;
  @Input({ transform: booleanAttribute }) required = false;
  @Input() hint = "";
  @Input({ transform: booleanAttribute }) revealable = false;
  @Output() valueChange = new EventEmitter<string>();

  revealed = false;

  get hintId(): string {
    return `${this.controlId}-hint`;
  }

  get inputType(): VaultEditFieldType {
    return this.type === "password" && this.revealable && !this.revealed ? "password" : this.type === "password" ? "text" : this.type;
  }

  onInput(event: Event): void {
    this.valueChange.emit((event.target as HTMLInputElement | HTMLTextAreaElement).value);
  }
}
