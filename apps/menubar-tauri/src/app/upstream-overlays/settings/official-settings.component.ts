import { Component, EventEmitter, Input, Output } from "@angular/core";
import { I18nPipe } from "@bitwarden/ui-common";

import { PopupHeaderComponent } from "../../layout/popup-header.component";
import { PopupPageComponent } from "../../layout/popup-page.component";
import {
  CheckboxComponent,
  ItemComponent,
  ItemContentComponent,
  ItemGroupComponent,
  TypographyDirective,
} from "../../official-ui/official-components";
import { MacosAlertStripComponent } from "../../official-ui/macos-alert-strip.component";
import type { RetainedSettingsRoute } from "../../settings/settings-actions.port";
import { translateOfficialMessage } from "../../official-ui/official-i18n.service";

@Component({
  selector: "bw-official-settings",
  standalone: true,
  imports: [
    CheckboxComponent,
    ItemComponent,
    ItemContentComponent,
    ItemGroupComponent,
    I18nPipe,
    MacosAlertStripComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    TypographyDirective,
  ],
  templateUrl: "./official-settings.component.html",
})
export class OfficialSettingsComponent {
  @Input() launchAtLoginEnabled = false;
  @Input() launchAtLoginBusy = true;
  @Input() launchAtLoginError = "";
  @Output() readonly launchAtLoginEnabledChange = new EventEmitter<boolean>();
  @Output() readonly dismissLaunchAtLoginError = new EventEmitter<void>();
  @Output() readonly navigate = new EventEmitter<RetainedSettingsRoute>();

  readonly items = [
    { label: translateOfficialMessage("i18nAccountSecurity"), route: "/account-security", icon: "bwi-lock" },
    { label: translateOfficialMessage("i18nAutofill"), route: "/autofill", icon: "bwi-globe" },
    { label: translateOfficialMessage("i18nKeyboardShortcuts"), route: "/keyboard-shortcut", icon: "bwi-key" },
    { label: translateOfficialMessage("i18nVaultOptions"), route: "/vault-settings", icon: "bwi-vault" },
    { label: translateOfficialMessage("i18nAppearance"), route: "/appearance", icon: "bwi-brush" },
    { label: translateOfficialMessage("i18nAbout"), route: "/about", icon: "bwi-info-circle" },
  ] as const satisfies readonly {
    readonly label: string;
    readonly route: RetainedSettingsRoute;
    readonly icon: string;
  }[];

  requestLaunchAtLoginChange(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }
    const requested = event.target.checked;
    event.target.checked = this.launchAtLoginEnabled;
    this.launchAtLoginEnabledChange.emit(requested);
  }
}
