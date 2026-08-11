import { ChangeDetectionStrategy, Component } from "@angular/core";

import { VaultAutoFillSuggestionsComponent } from "./vault-autofill-suggestions.component";
import { VaultListPageComponent } from "./vault-list-page.component";

@Component({
  selector: "bw-vault-autofill-page",
  standalone: true,
  imports: [VaultAutoFillSuggestionsComponent, VaultListPageComponent],
  template: `
    <bw-vault-list-page>
      <bw-vault-autofill-suggestions />
    </bw-vault-list-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultAutoFillPageComponent {}
