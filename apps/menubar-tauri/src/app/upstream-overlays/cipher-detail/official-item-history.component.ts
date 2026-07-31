import { DatePipe, NgClass } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";

import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { I18nPipe } from "@bitwarden/ui-common";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { LinkComponent } from "@bitwarden/components/link/link.component";
import { SectionComponent } from "@bitwarden/components/section/section.component";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { TypographyDirective } from "@bitwarden/components/typography/typography.directive";

/** Guarded navigation transform of pinned ItemHistoryV2Component. */
@Component({
  selector: "app-item-history-v2",
  standalone: true,
  imports: [
    CardComponent,
    DatePipe,
    I18nPipe,
    LinkComponent,
    NgClass,
    SectionComponent,
    SectionHeaderComponent,
    TypographyDirective,
  ],
  templateUrl: "./official-item-history.component.html",
})
export class OfficialItemHistoryComponent {
  @Input({ required: true }) cipher!: CipherView;
  @Output() viewPasswordHistory = new EventEmitter<void>();
}
