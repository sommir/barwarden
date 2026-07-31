import { Component, input } from "@angular/core";

import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { TypographyDirective } from "@bitwarden/components/typography/typography.directive";
import { I18nPipe } from "../../official-ui/official-ui-common";

/** Guarded Login-only transform of pinned ItemDetailsV2Component. */
@Component({
  selector: "official-item-details",
  standalone: true,
  imports: [CardComponent, I18nPipe, TypographyDirective],
  templateUrl: "./official-item-details.component.html",
})
export class OfficialItemDetailsComponent {
  readonly cipher = input.required<CipherView>();
  readonly folder = input<FolderView | undefined>();
}
