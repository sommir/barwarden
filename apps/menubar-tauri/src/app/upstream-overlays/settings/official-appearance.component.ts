import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { PopupHeaderComponent } from "../../layout/popup-header.component";
import { PopupPageComponent } from "../../layout/popup-page.component";
import {
  BitFormFieldComponent,
  BitLabelComponent,
  CardComponent,
  CheckboxComponent,
  FormControlComponent,
  SectionComponent,
  SectionHeaderComponent,
  SelectComponent,
  TypographyDirective,
} from "../../official-ui/official-components";
import {
  isThemeMode,
  themeValues,
  type ThemeMode,
} from "../../settings/settings-options";
import type { SettingsSnapshot } from "../../settings/settings.service";
import type { OfficialLocale } from "../../official-ui/official-i18n.service";
import { I18nPipe } from "../../official-ui/official-ui-common";

@Component({
  selector: "bw-official-appearance",
  standalone: true,
  imports: [
    BitFormFieldComponent,
    BitLabelComponent,
    CardComponent,
    CheckboxComponent,
    FormControlComponent,
    FormsModule,
    I18nPipe,
    PopupHeaderComponent,
    PopupPageComponent,
    SectionComponent,
    SectionHeaderComponent,
    SelectComponent,
    TypographyDirective,
  ],
  templateUrl: "./official-appearance.component.html",
})
export class OfficialAppearanceComponent {
  @Input({ required: true }) settings!: Readonly<SettingsSnapshot>;
  @Input() language: OfficialLocale | null = null;
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly themeChange = new EventEmitter<ThemeMode>();
  @Output() readonly languageChange = new EventEmitter<OfficialLocale | null>();
  @Output() readonly compactModeChange = new EventEmitter<boolean>();
  @Output() readonly animationsChange = new EventEmitter<boolean>();
  @Output() readonly showFaviconsChange = new EventEmitter<boolean>();
  @Output() readonly showQuickCopyActionsChange = new EventEmitter<boolean>();

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.back.emit();
  private optionsLocale: string | null = null;
  private cachedThemeOptions: ReturnType<OfficialAppearanceComponent["buildThemeOptions"]> = [];
  private cachedLanguageOptions: ReturnType<OfficialAppearanceComponent["buildLanguageOptions"]> = [];

  constructor(private readonly i18n: I18nService) {}

  get themeOptions() {
    this.refreshLocalizedOptions();
    return this.cachedThemeOptions;
  }

  get languageOptions(): { value: "" | OfficialLocale; label: string }[] {
    this.refreshLocalizedOptions();
    return this.cachedLanguageOptions;
  }

  private refreshLocalizedOptions(): void {
    if (this.optionsLocale === this.i18n.translationLocale) {
      return;
    }

    this.optionsLocale = this.i18n.translationLocale;
    this.cachedThemeOptions = this.buildThemeOptions();
    this.cachedLanguageOptions = this.buildLanguageOptions();
  }

  private buildThemeOptions() {
    return themeValues.map((value) => ({
      value,
      label: this.i18n.t(
        value === "system" ? "i18nFollowSystem" : value === "light" ? "i18nThemeLight" : "i18nThemeDark",
      ),
    }));
  }

  private buildLanguageOptions(): { value: "" | OfficialLocale; label: string }[] {
    return [
      { value: "", label: this.i18n.t("i18nFollowSystem") },
      { value: "zh-CN", label: this.i18n.t("i18nSimplifiedChinese") },
      { value: "en-US", label: this.i18n.t("i18nEnglish") },
    ];
  }

  setThemeValue(value: unknown): void {
    if (isThemeMode(value)) {
      this.themeChange.emit(value);
    }
  }

  setLanguageValue(value: unknown): void {
    if (value === "" || value === "zh-CN" || value === "en-US") {
      this.languageChange.emit(value || null);
    }
  }

  emitChecked(event: Event, output: EventEmitter<boolean>): void {
    if (event.target instanceof HTMLInputElement) {
      output.emit(event.target.checked);
    }
  }
}
