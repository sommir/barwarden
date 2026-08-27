import { Component, EventEmitter, Input, Output } from "@angular/core";

import { I18nPipe } from "../official-ui/official-ui-common";

@Component({
  selector: "bw-document-search",
  standalone: true,
  imports: [I18nPipe],
  template: `
    <div class="document-search" role="search">
      <label class="macos-field-owner">
        <span class="tw-sr-only">{{ "i18nSearch" | i18n }}</span>
        <input
          class="macos-control-visible"
          data-testid="document-search-input"
          type="search"
          [value]="query"
          (input)="queryChange.emit(asInput($event).value)"
        />
      </label>
      <output aria-live="polite">{{ matchCount === 0 ? "0" : (activeIndex + 1) + "/" + matchCount }}</output>
      <button
        class="macos-hit-target"
        data-testid="document-search-previous"
        type="button"
        [disabled]="navigationDisabled || matchCount === 0"
        (click)="previous.emit()"
        [attr.aria-label]="'i18nPreviousSearchResult' | i18n"
      >
        <i class="bwi bwi-angle-up" aria-hidden="true"></i>
      </button>
      <button
        class="macos-hit-target"
        data-testid="document-search-next"
        type="button"
        [disabled]="navigationDisabled || matchCount === 0"
        (click)="next.emit()"
        [attr.aria-label]="'i18nNextSearchResult' | i18n"
      >
        <i class="bwi bwi-angle-down" aria-hidden="true"></i>
      </button>
    </div>
  `,
})
export class DocumentSearchComponent {
  @Input() query = "";
  @Input() matchCount = 0;
  @Input() activeIndex = 0;
  @Input() navigationDisabled = false;
  @Output() readonly queryChange = new EventEmitter<string>();
  @Output() readonly previous = new EventEmitter<void>();
  @Output() readonly next = new EventEmitter<void>();

  asInput(event: Event): HTMLInputElement {
    if (!(event.target instanceof HTMLInputElement)) {
      throw new TypeError("Document search input target must be an HTMLInputElement");
    }
    return event.target;
  }
}
