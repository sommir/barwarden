import { Component, EventEmitter, Input, Output } from "@angular/core";

import { PopupHeaderComponent } from "../../layout/popup-header.component";
import { PopupPageComponent } from "../../layout/popup-page.component";
import {
  ItemComponent,
  ItemContentComponent,
  ItemGroupComponent,
} from "../../official-ui/official-components";
import {
  OfficialAboutDialogComponent,
  type OfficialAboutDialogMetadata,
  type OfficialAboutRevisionCopyStatus,
  type OfficialAboutDialogView,
} from "./official-about-dialog.component";
import { MacosAlertStripComponent } from "../../official-ui/macos-alert-strip.component";
import { I18nPipe } from "../../official-ui/official-ui-common";
import type { AppUpdateView } from "../../updates/app-update.service";
import { AppUpdateCardComponent } from "../../updates/app-update-card.component";

@Component({
  selector: "bw-official-about",
  standalone: true,
  imports: [
    ItemComponent,
    ItemContentComponent,
    ItemGroupComponent,
    I18nPipe,
    AppUpdateCardComponent,
    MacosAlertStripComponent,
    OfficialAboutDialogComponent,
    PopupHeaderComponent,
    PopupPageComponent,
  ],
  templateUrl: "./official-about.component.html",
})
export class OfficialAboutComponent {
  @Input({ required: true }) metadata!: Readonly<OfficialAboutDialogMetadata>;
  @Input({ required: true }) metadataView: OfficialAboutDialogView | null = null;
  @Input() revisionCopyStatus: OfficialAboutRevisionCopyStatus = "idle";
  @Input() handoffError = "";
  @Input() updateView: AppUpdateView = {
    status: "idle",
    version: null,
    notes: null,
    progress: null,
    message: "",
    notificationVisible: false,
  };
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly metadataViewChange = new EventEmitter<OfficialAboutDialogView | null>();
  @Output() readonly openThirdPartyNotices = new EventEmitter<void>();
  @Output() readonly openHelp = new EventEmitter<void>();
  @Output() readonly openWebVault = new EventEmitter<void>();
  @Output() readonly openProjectSource = new EventEmitter<void>();
  @Output() readonly copyRevision = new EventEmitter<void>();
  @Output() readonly checkForUpdates = new EventEmitter<void>();
  @Output() readonly downloadAndRestart = new EventEmitter<void>();
  @Output() readonly dismissUpdate = new EventEmitter<void>();
  @Output() readonly retryUpdate = new EventEmitter<void>();

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.back.emit();

  activateMetadataFromKeyboard(
    event: KeyboardEvent,
  ): void {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    if (event.repeat) {
      return;
    }
    const button = event.currentTarget as HTMLButtonElement;
    globalThis.setTimeout(() => button.click(), 0);
  }
}
