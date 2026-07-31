import { Component, EventEmitter, HostListener, Input, Output } from "@angular/core";

import type { VaultField } from "../../vault/vault-item.model";
import type { OfficialLoginDetailProjection } from "../../vault/login-cipher-view.adapter";
import { OfficialAdditionalOptionsComponent } from "./official-additional-options.component";
import { OfficialCustomFieldsComponent } from "./official-custom-fields.component";
import { OfficialItemDetailsComponent } from "./official-item-details.component";
import { OfficialItemHistoryComponent } from "./official-item-history.component";
import {
  OfficialLoginCredentialsComponent,
  type LoginRevealRequest,
} from "./official-login-credentials.component";
import { OfficialLoginUriOptionsComponent } from "./official-login-uri-options.component";

/** Retained Login-only composition of the pinned CipherViewComponent child order. */
@Component({
  selector: "bw-official-login-detail",
  standalone: true,
  imports: [
    OfficialAdditionalOptionsComponent,
    OfficialCustomFieldsComponent,
    OfficialItemDetailsComponent,
    OfficialItemHistoryComponent,
    OfficialLoginCredentialsComponent,
    OfficialLoginUriOptionsComponent,
  ],
  templateUrl: "./official-login-detail.component.html",
})
export class OfficialLoginDetailComponent {
  @Input({ required: true }) projection!: OfficialLoginDetailProjection;
  @Input() canFill = false;
  @Input() revealedFieldIds: ReadonlySet<string> = new Set();
  @Output() copyField = new EventEmitter<VaultField>();
  @Output() fillField = new EventEmitter<VaultField>();
  @Output() launchUri = new EventEmitter<string>();
  @Output() toggleReveal = new EventEmitter<string | LoginRevealRequest>();
  @Output() viewPasswordHistory = new EventEmitter<void>();

  @HostListener("copy", ["$event"])
  blockBrowserCopy(event: ClipboardEvent): void {
    event.preventDefault();
  }
}
