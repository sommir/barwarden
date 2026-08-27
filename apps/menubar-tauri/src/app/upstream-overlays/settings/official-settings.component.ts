import { Component, EventEmitter, Input, Output } from "@angular/core";
import { I18nPipe } from "@bitwarden/ui-common";

import { PopupHeaderComponent } from "../../layout/popup-header.component";
import { PopupPageComponent } from "../../layout/popup-page.component";
import {
  ItemComponent,
  ItemContentComponent,
  ItemGroupComponent,
  TypographyDirective,
} from "../../official-ui/official-components";
import { MacosAlertStripComponent } from "../../official-ui/macos-alert-strip.component";
import type { RetainedSettingsRoute } from "../../settings/settings-actions.port";
import { translateOfficialMessage } from "../../official-ui/official-i18n.service";

export type SettingsGroupId = "general" | "security" | "application" | "information";
export interface SettingsNavigationItem {
  readonly label: string;
  readonly route: RetainedSettingsRoute;
  readonly icon: string;
}
export interface SettingsGroup {
  readonly id: SettingsGroupId;
  readonly label: string;
  readonly items: readonly SettingsNavigationItem[];
}

@Component({
  selector: "bw-official-settings",
  standalone: true,
  imports: [
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

  readonly groups: readonly SettingsGroup[] = [
    {
      id: "general",
      label: translateOfficialMessage("i18nGeneral"),
      items: [
        { label: translateOfficialMessage("i18nAppearance"), route: "/appearance", icon: "bwi-brush" },
      ],
    },
    {
      id: "security",
      label: translateOfficialMessage("i18nAccountSecurity"),
      items: [
        { label: translateOfficialMessage("i18nAccountSecurity"), route: "/account-security", icon: "bwi-lock" },
      ],
    },
    {
      id: "application",
      label: translateOfficialMessage("app"),
      items: [
        { label: translateOfficialMessage("i18nAutofill"), route: "/autofill", icon: "bwi-globe" },
        { label: translateOfficialMessage("i18nKeyboardShortcuts"), route: "/keyboard-shortcut", icon: "bwi-key" },
        { label: translateOfficialMessage("i18nVaultOptions"), route: "/vault-settings", icon: "bwi-vault" },
      ],
    },
    {
      id: "information",
      label: translateOfficialMessage("i18nAbout"),
      items: [
        { label: translateOfficialMessage("i18nAbout"), route: "/about", icon: "bwi-info-circle" },
      ],
    },
  ];

  requestLaunchAtLoginChange(requested: boolean): void {
    this.launchAtLoginEnabledChange.emit(requested);
  }
}
