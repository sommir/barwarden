import { ChangeDetectorRef, Component, Inject, OnInit } from "@angular/core";
import { Router } from "@angular/router";

import type { LaunchAtLoginHost } from "../../host/launch-at-login";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { PopupHeaderActionsComponent } from "../popup-header-actions.component";
import { OfficialSettingsComponent } from "../upstream-overlays/settings/official-settings.component";
import { LAUNCH_AT_LOGIN_HOST } from "./launch-at-login.port";
import type { RetainedSettingsActions } from "./settings-actions.port";

@Component({
  selector: "bw-settings-page",
  host: { class: "macos-page macos-page--settings" },
  standalone: true,
  imports: [OfficialSettingsComponent, PopupHeaderActionsComponent],
  template: `
    <bw-official-settings
      [launchAtLoginEnabled]="launchAtLoginEnabled"
      [launchAtLoginBusy]="launchAtLoginBusy"
      [launchAtLoginError]="launchAtLoginError"
      (launchAtLoginEnabledChange)="setLaunchAtLogin($event)"
      (dismissLaunchAtLoginError)="dismissLaunchAtLoginError()"
      (navigate)="navigateTo($event)"
    >
      <bw-popup-header-actions slot="end" [showNew]="false" />
    </bw-official-settings>
  `,
})
export class SettingsPageComponent implements OnInit {
  launchAtLoginEnabled = false;
  launchAtLoginBusy = true;
  launchAtLoginError = "";

  constructor(
    private readonly router: Router,
    @Inject(LAUNCH_AT_LOGIN_HOST)
    private readonly launchAtLoginHost: LaunchAtLoginHost,
    private readonly changeDetector: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      this.launchAtLoginEnabled = await this.launchAtLoginHost.getLaunchAtLogin();
    } catch {
      this.launchAtLoginError = translateOfficialMessage(
        "i18nUnableToUpdateLaunchAtLogin",
      );
    } finally {
      this.launchAtLoginBusy = false;
      this.changeDetector.markForCheck();
    }
  }

  async setLaunchAtLogin(enabled: boolean): Promise<void> {
    if (this.launchAtLoginBusy || enabled === this.launchAtLoginEnabled) {
      return;
    }

    this.launchAtLoginBusy = true;
    this.launchAtLoginError = "";
    this.changeDetector.markForCheck();
    try {
      this.launchAtLoginEnabled =
        await this.launchAtLoginHost.setLaunchAtLogin(enabled);
    } catch {
      this.launchAtLoginError = translateOfficialMessage(
        "i18nUnableToUpdateLaunchAtLogin",
      );
    } finally {
      this.launchAtLoginBusy = false;
      this.changeDetector.markForCheck();
    }
  }

  dismissLaunchAtLoginError(): void {
    this.launchAtLoginError = "";
  }

  readonly navigateTo: RetainedSettingsActions["navigateTo"] = async (route) => {
    await this.router.navigateByUrl(route);
  };
}
