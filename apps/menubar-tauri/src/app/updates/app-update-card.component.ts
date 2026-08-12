import { Component, EventEmitter, Input, Output } from "@angular/core";

import { ButtonComponent } from "../official-ui/official-components";
import { I18nPipe } from "../official-ui/official-ui-common";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import type { AppUpdateView } from "./app-update.service";

@Component({
  selector: "bw-app-update-card",
  standalone: true,
  imports: [ButtonComponent, I18nPipe],
  templateUrl: "./app-update-card.component.html",
})
export class AppUpdateCardComponent {
  @Input({ required: true }) currentVersion = "";
  @Input({ required: true }) view!: AppUpdateView;
  @Output() readonly checkForUpdates = new EventEmitter<void>();
  @Output() readonly downloadAndRestart = new EventEmitter<void>();
  @Output() readonly deferUpdate = new EventEmitter<void>();
  @Output() readonly retry = new EventEmitter<void>();

  get progressLabel(): string {
    return this.view.progress === null
      ? translateOfficialMessage("i18nDownloadingUpdate")
      : translateOfficialMessage(
          "i18nDownloadingUpdateProgress",
          Math.round(this.view.progress * 100),
        );
  }
}
