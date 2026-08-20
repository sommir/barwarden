import { Component } from "@angular/core";

import { OfficialAppearanceComponent } from "../upstream-overlays/settings/official-appearance.component";
import type { RetainedSettingsActions } from "./settings-actions.port";
import { SettingsService } from "./settings.service";
import type { OfficialLocale } from "../official-ui/official-i18n.service";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";

@Component({
  selector: "bw-appearance-page",
  host: { class: "macos-page macos-page--secondary macos-page--appearance" },
  standalone: true,
  imports: [OfficialAppearanceComponent],
  template: `
    <bw-official-appearance
      [settings]="settings"
      [language]="settings.language"
      (back)="back()"
      (themeChange)="setTheme($event)"
      (languageChange)="setLanguage($event)"
      (compactModeChange)="setCompactMode($event)"
      (animationsChange)="setAnimations($event)"
      (showFaviconsChange)="setShowFavicons($event)"
      (showQuickCopyActionsChange)="setShowQuickCopyActions($event)"
    />
  `,
})
export class AppearancePageComponent {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly routeCache: PopupRouterCacheService,
  ) {}

  get settings() {
    return this.settingsService.snapshot();
  }

  async back(): Promise<void> {
    await this.routeCache.back();
  }

  readonly setTheme: RetainedSettingsActions["setTheme"] = (value) =>
    this.settingsService.setTheme(value);
  readonly setLanguage = (value: OfficialLocale | null) => this.settingsService.setLanguage(value);
  readonly setCompactMode: RetainedSettingsActions["setCompactMode"] = (value) =>
    this.settingsService.setCompactMode(value);
  readonly setAnimations: RetainedSettingsActions["setAnimations"] = (value) =>
    this.settingsService.setAnimations(value);
  readonly setShowFavicons: RetainedSettingsActions["setShowFavicons"] = (value) =>
    this.settingsService.setShowFavicons(value);
  readonly setShowQuickCopyActions: RetainedSettingsActions["setShowQuickCopyActions"] = (value) =>
    this.settingsService.setShowQuickCopyActions(value);
}
