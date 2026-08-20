import { Component } from "@angular/core";
import { RouterLink } from "@angular/router";

import { PopOutComponent } from "@bitwarden/browser-popup/components/pop-out.component";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { EnvironmentHandoffService } from "./environment-handoff.service";
import { MacosAlertStripComponent } from "../official-ui/macos-alert-strip.component";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";

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

      <section class="settings-password-handoff settings-detail-group macos-preference-group">
        <div class="macos-preference-row">
          <p class="empty-inline macos-preference-row__copy">
            {{ "i18nPasswordHandoffDescription" | i18n }}
          </p>
          <button class="primary-action web-vault-action macos-button-owner" type="button" (click)="openWebVaultChangePassword()">
            {{ "i18nOpenWebVaultChangePassword" | i18n }}
          </button>
        </div>
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
      display: grid;
      gap: 12px;
      padding: 12px;
    }

    .settings-password-handoff .empty-inline {
      margin: 0;
      font-size: 14px;
      line-height: 20px;
    }

    .web-vault-action {
      min-height: var(--mac-hit-size);
      margin: 0;
      justify-self: start;
    }

    .web-vault-action::before {
      inset-block: 2px;
    }
  `,
})
export class SettingsPasswordPageComponent {
  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.routeCache.back();
  handoffError = "";

  constructor(
    private readonly routeCache: PopupRouterCacheService,
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
