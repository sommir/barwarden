import { Component, EventEmitter, Input, OnInit, Output } from "@angular/core";

import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { PasswordHistoryView } from "@bitwarden/common/vault/models/view/password-history.view";

import {
  BitIconButtonComponent,
  ItemActionComponent,
  ItemComponent,
} from "../../../official-ui/official-components";
import { OfficialColorPasswordComponent } from "../../cipher-detail/official-color-password.component";
import { translateOfficialMessage } from "../../../official-ui/official-i18n.service";
import { I18nPipe } from "../../../official-ui/official-ui-common";

export interface OfficialPasswordHistoryCopyRequest {
  readonly cipherId: string;
  readonly password: string;
  readonly lastUsedDate: Date;
}

@Component({
  selector: "bw-official-password-history-view",
  standalone: true,
  imports: [BitIconButtonComponent, I18nPipe, ItemActionComponent, ItemComponent, OfficialColorPasswordComponent],
  templateUrl: "./official-password-history-view.component.html",
})
export class OfficialPasswordHistoryViewComponent implements OnInit {
  @Input({ required: true }) cipher!: CipherView;
  @Output() readonly copyPassword = new EventEmitter<OfficialPasswordHistoryCopyRequest>();

  history: readonly PasswordHistoryView[] = [];

  ngOnInit(): void {
    this.history = this.cipher.passwordHistory ?? [];
  }

  emitCopy(entry: PasswordHistoryView): void {
    this.copyPassword.emit({
      cipherId: this.cipher.id,
      password: entry.password,
      lastUsedDate: entry.lastUsedDate,
    });
  }

  formatDate(value: Date): string {
    if (Number.isNaN(value?.getTime())) {
      return translateOfficialMessage("i18nDateUnavailable");
    }

    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(value);
  }
}
