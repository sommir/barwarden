import { Component } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import { PopOutComponent } from "@bitwarden/browser-popup/components/pop-out.component";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { EnvironmentHandoffService } from "./environment-handoff.service";
import { MacosAlertStripComponent } from "../official-ui/macos-alert-strip.component";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";

@Component({
  selector: "bw-settings-password-page",
  host: { class: "macos-page macos-page--secondary macos-page--settings-detail" },
  standalone: true,
  imports: [
    MacosAlertStripComponent,
    I18nPipe,
    PopOutComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    RouterLink,
  ],
  template: `
    <popup-page>
      <popup-header slot="header" [pageTitle]="'i18nChangeMasterPassword' | i18n" showBackButton [backAction]="backAction">
        <app-pop-out slot="end" />
      </popup-header>

      <section class="settings-password-handoff settings-detail-group macos-continuous-group">
        <p class="empty-inline">
          {{ "i18nPasswordHandoffDescription" | i18n }}
        </p>
        <button class="primary-action web-vault-action" type="button" (click)="openWebVaultChangePassword()">
          {{ "i18nOpenWebVaultChangePassword" | i18n }}
        </button>
      </section>

      @if (handoffError) {
        <bw-macos-alert-strip
          kind="danger"
          [title]="'i18nUnableToOpenWebVault' | i18n"
          [message]="handoffError"
        />
      }
    </popup-page>
  `,
  styles: `
    .settings-password-handoff {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .web-vault-action {
      width: calc(100% - 32px);
      margin: 0 16px;
    }
  `,
})
export class SettingsPasswordPageComponent {
  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.router.navigateByUrl("/account-security");
  handoffError = "";

  constructor(
    private readonly router: Router,
    private readonly handoff: EnvironmentHandoffService,
  ) {}

  async openWebVaultChangePassword(): Promise<void> {
    this.handoffError = "";
    try {
      await this.handoff.openWebVault("/#/settings/security/password");
    } catch {
      this.handoffError = translateOfficialMessage("i18nUnableToOpenLink");
    }
  }

}
