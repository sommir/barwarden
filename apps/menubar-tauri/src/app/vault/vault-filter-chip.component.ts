import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";

import {
  ChipFilterComponent,
  type ChipFilterOption,
} from "../official-ui/official-components";

export interface VaultFilterOption {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
}

@Component({
  selector: "bw-vault-filter-chip",
  standalone: true,
  imports: [ChipFilterComponent, FormsModule],
  template: `
    <bit-chip-filter
      fullWidth
      [attr.aria-label]="label"
      [placeholderText]="label"
      [placeholderIcon]="icon"
      [options]="officialOptions"
      [ngModel]="selectedId"
      (ngModelChange)="select($event)"
    />
  `,
})
export class VaultFilterChipComponent {
  @Input({ required: true }) label = "";
  @Input({ required: true }) icon = "";
  @Input() selectedId = "";
  @Input() options: readonly VaultFilterOption[] = [];
  @Output() selectionChange = new EventEmitter<string>();

  get officialOptions(): ChipFilterOption<string>[] {
    return this.options.map((option) => ({
      label: option.label,
      value: option.id,
      ...(option.icon ? { icon: option.icon } : {}),
    }));
  }

  select(value: string | null): void {
    this.selectionChange.emit(value ?? "");
  }
}
