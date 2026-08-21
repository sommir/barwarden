import {
  booleanAttribute,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from "@angular/core";

import type { VaultField } from "../vault-demo";
import { I18nPipe } from "../official-ui/official-ui-common";

@Component({
  selector: "bw-vault-detail-field",
  standalone: true,
  imports: [I18nPipe],
  template: `
    <div class="official-read-only-field macos-detail-field">
      <label [attr.for]="controlId">{{ fieldLabel }}</label>
      <div class="official-read-only-control macos-field-owner">
        <input
          class="macos-control-visible"
          [id]="controlId"
          readonly
          aria-readonly="true"
          [type]="conceal && !revealed ? 'password' : 'text'"
          [value]="displayValue"
        />
        @if (conceal && displayValue) {
          <button
            type="button"
            class="icon-action macos-hit-target"
            [attr.aria-label]="revealed ? ('i18nHideField' | i18n: fieldLabel) : ('i18nShowField' | i18n: fieldLabel)"
            (click)="revealed = !revealed"
          >
            <i
              class="bwi macos-icon-plate"
              [class.bwi-eye]="!revealed"
              [class.bwi-eye-slash]="revealed"
              aria-hidden="true"
            ></i>
          </button>
        }
        @if (launchable && displayValue) {
          <button
            type="button"
            class="icon-action macos-hit-target"
            [attr.aria-label]="'i18nOpenField' | i18n: fieldLabel"
            (click)="launch.emit(displayValue)"
          >
            <i class="bwi bwi-external-link macos-icon-plate" aria-hidden="true"></i>
          </button>
        }
        @if (displayValue) {
          <button
            type="button"
            class="icon-action macos-hit-target"
            [attr.aria-label]="'i18nCopyField' | i18n: fieldLabel"
            (click)="copy.emit(field)"
          >
            <i class="bwi bwi-clone macos-icon-plate" aria-hidden="true"></i>
          </button>
        }
        @if (canFill && displayValue) {
          <button
            type="button"
            class="field-action macos-hit-target"
            [attr.aria-label]="'i18nFillField' | i18n: fieldLabel"
            (click)="fill.emit(field)"
          >
            {{ "i18nFill" | i18n }}
          </button>
        }
      </div>
    </div>
  `,
})
export class VaultDetailFieldComponent implements OnChanges {
  @Input({ required: true }) field!: VaultField;
  @Input() label = "";
  @Input() value = "";
  @Input({ transform: booleanAttribute }) conceal = false;
  @Input({ transform: booleanAttribute }) canFill = false;
  @Input({ transform: booleanAttribute }) launchable = false;
  @Output() copy = new EventEmitter<VaultField>();
  @Output() fill = new EventEmitter<VaultField>();
  @Output() launch = new EventEmitter<string>();

  revealed = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["field"] || changes["value"]) {
      this.revealed = false;
    }
  }

  get controlId(): string {
    return `detail-field-${this.field.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  }

  get fieldLabel(): string {
    return this.label || this.field.label;
  }

  get displayValue(): string {
    return this.value || this.field.value;
  }
}
