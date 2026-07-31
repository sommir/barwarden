import { Component, EventEmitter, Input, Optional, Output } from "@angular/core";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

@Component({
  selector: "bw-root-search",
  standalone: true,
  template: `
    <label class="vault-root-header__search">
      <i class="bwi bwi-search" aria-hidden="true"></i>
      <input
        type="search"
        [attr.aria-label]="searchAriaLabel"
        [placeholder]="placeholder"
        [value]="query"
        (input)="emitQuery($event)"
      />
    </label>
  `,
})
export class RootSearchComponent {
  @Input() searchAriaLabel: string;
  @Input() placeholder: string;
  @Input() query = "";
  @Output() readonly queryChange = new EventEmitter<string>();

  constructor(@Optional() i18n: I18nService | null = null) {
    const search = i18n?.t("search") ?? translateOfficialMessage("search");
    this.searchAriaLabel = search;
    this.placeholder = search;
  }

  emitQuery(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.queryChange.emit(event.target.value);
    }
  }
}
