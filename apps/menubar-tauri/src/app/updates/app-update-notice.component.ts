import { Component } from "@angular/core";
import { Router } from "@angular/router";

import { MacosAlertStripComponent } from "../official-ui/macos-alert-strip.component";
import { I18nPipe } from "../official-ui/official-ui-common";
import { AppUpdateService } from "./app-update.service";

@Component({
  selector: "bw-app-update-notice",
  standalone: true,
  imports: [I18nPipe, MacosAlertStripComponent],
  template: `
    @if (view().status === "available" && view().notificationVisible) {
      <bw-macos-alert-strip
        class="app-update-notice"
        kind="info"
        presentation="toast"
        [dismissible]="true"
        [title]="'i18nNewVersionAvailable' | i18n: (view().version || '')"
        [message]="'i18nUpdateAvailableMessage' | i18n: (view().version || '')"
        [actionLabel]="'i18nViewUpdate' | i18n"
        actionTestId="view-update"
        testId="available-update-notice"
        (action)="openUpdate()"
        (dismiss)="dismiss()"
      />
    }
  `,
})
export class AppUpdateNoticeComponent {
  readonly view = this.updates.view;

  constructor(
    private readonly updates: AppUpdateService,
    private readonly router: Router,
  ) {}

  async openUpdate(): Promise<void> {
    await this.router.navigateByUrl("/about");
  }

  dismiss(): void {
    this.updates.dismissNotification();
  }
}
