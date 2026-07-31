import { Component, EventEmitter, Input, Output } from "@angular/core";
import { I18nPipe } from "@bitwarden/ui-common";

import { PopupHeaderComponent } from "../../layout/popup-header.component";
import { PopupPageComponent } from "../../layout/popup-page.component";
import {
  ItemComponent,
  ItemContentComponent,
  ItemGroupComponent,
} from "../../official-ui/official-components";
import { MacosAlertStripComponent } from "../../official-ui/macos-alert-strip.component";

export type RetainedVaultSettingsRoute = "/folders" | "/archive" | "/trash";

@Component({
  selector: "bw-official-vault-settings",
  standalone: true,
  imports: [
    ItemComponent,
    ItemContentComponent,
    ItemGroupComponent,
    I18nPipe,
    MacosAlertStripComponent,
    PopupHeaderComponent,
    PopupPageComponent,
  ],
  templateUrl: "./official-vault-settings.component.html",
})
export class OfficialVaultSettingsComponent {
  @Input({ required: true }) isSyncing = false;
  @Input({ required: true }) syncLabel = "";
  @Input() syncError = "";
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly navigate = new EventEmitter<RetainedVaultSettingsRoute>();
  @Output() readonly sync = new EventEmitter<void>();

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.back.emit();
}
