import { Component, Input } from "@angular/core";

import { PopOutComponent } from "@bitwarden/browser-popup/components/pop-out.component";
import { CurrentAccountComponent } from "@bitwarden/official-auth-popup/account-switching/current-account.component";
import {
  BitIconButtonComponent,
} from "./official-ui/official-components";
import { PopupStateStore } from "./popup-state";
import { RetainedNewItemDropdownComponent } from "./vault/retained-new-item-dropdown.component";
import type { NewItemInitialValues } from "@bitwarden/official-vault-popup/new-item-dropdown.component";
export { POP_OUT_HOST, type PopOutHost } from "./pop-out-host.port";

@Component({
  selector: "bw-popup-header-actions",
  standalone: true,
  imports: [
    BitIconButtonComponent,
    CurrentAccountComponent,
    PopOutComponent,
    RetainedNewItemDropdownComponent,
  ],
  template: `
    <div class="header-actions tw-flex tw-items-center tw-gap-2">
      @if (showNew) {
        <bw-retained-new-item-dropdown [initialValues]="resolvedNewItemInitialValues" />
      }
      <app-pop-out />
      <app-current-account data-popup-focus-key="account-switcher" />
    </div>
  `,
})
export class PopupHeaderActionsComponent {
  @Input() showNew = true;
  /**
   * Pass null when a title-bar action is global rather than scoped to the
   * currently disclosed folder. Undefined keeps the retained default.
   */
  @Input() newItemInitialValues: NewItemInitialValues | null | undefined = undefined;
  constructor(private readonly store: PopupStateStore) {}

  get resolvedNewItemInitialValues(): NewItemInitialValues | undefined {
    if (this.newItemInitialValues !== undefined) {
      return this.newItemInitialValues ?? undefined;
    }
    const folderId = this.store.snapshot().filterFolderId;
    return folderId && folderId !== "__none" ? { folderId } : undefined;
  }
}
