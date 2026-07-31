import { Component, Input } from "@angular/core";

import { PopOutComponent } from "@bitwarden/browser-popup/components/pop-out.component";
import { CurrentAccountComponent } from "@bitwarden/official-auth-popup/account-switching/current-account.component";

/** Generator-specific retained header actions; the Vault-only New action is intentionally absent. */
@Component({
  selector: "bw-popup-header-actions",
  standalone: true,
  imports: [CurrentAccountComponent, PopOutComponent],
  template: `
    <div class="header-actions tw-flex tw-items-center tw-gap-2">
      <app-pop-out />
      <app-current-account />
    </div>
  `,
})
export class PopupHeaderActionsComponent {
  @Input() showNew = false;
}
