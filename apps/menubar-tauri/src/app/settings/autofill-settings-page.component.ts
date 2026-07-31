import { Location } from "@angular/common";
import { Component } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import {
  BitFormFieldComponent,
  BitHintDirective,
  BitLabelComponent,
  CardComponent,
  SectionComponent,
  SectionHeaderComponent,
  SelectComponent,
  TypographyDirective,
} from "../official-ui/official-components";
import {
  activeOfficialLocale,
  translateOfficialMessage,
  type OfficialLocale,
} from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";
import {
  clipboardClearSecondsValues,
  fillModeValues,
  isClipboardClearSeconds,
  isFillMode,
} from "./settings-options";
import { SettingsService } from "./settings.service";

@Component({
  selector: "bw-autofill-settings-page",
  host: { class: "macos-page macos-page--secondary macos-page--settings-detail" },
  standalone: true,
  imports: [
    BitFormFieldComponent,
    BitHintDirective,
    BitLabelComponent,
    CardComponent,
    FormsModule,
    I18nPipe,
    PopupHeaderComponent,
    PopupPageComponent,
    SectionComponent,
    SectionHeaderComponent,
    SelectComponent,
    TypographyDirective,
  ],
  template: `
    <popup-page>
      <popup-header slot="header" [pageTitle]="'i18nAutofill' | i18n" [showBackButton]="true" [backAction]="backAction" />
      <div class="tw-p-4">
        <bit-section>
          <bit-section-header><h2 bitTypography="h6">{{ "i18nAutofillBehavior" | i18n }}</h2></bit-section-header>
          <bit-card>
            <bit-form-field>
              <bit-label>{{ "i18nClearClipboard" | i18n }}</bit-label>
              <bit-select [attr.aria-label]="'i18nClearClipboard' | i18n" [items]="clipboardClearOptions" [ngModel]="settings.clipboardClearSeconds" (ngModelChange)="setClipboardClearSecondsValue($event)" />
              <bit-hint>{{ "i18nClearClipboardHint" | i18n }}</bit-hint>
            </bit-form-field>
            <bit-form-field disableMargin>
              <bit-label>{{ "i18nAutofill" | i18n }}</bit-label>
              <bit-select [attr.aria-label]="'i18nAutofill' | i18n" [items]="fillModeOptions" [ngModel]="settings.fillMode" (ngModelChange)="setFillModeValue($event)" />
              <bit-hint>{{ "i18nAutofillModeHint" | i18n }}</bit-hint>
            </bit-form-field>
          </bit-card>
        </bit-section>
      </div>
    </popup-page>
  `,
})
export class AutofillSettingsPageComponent {
  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () => this.back();
  private optionsLocale: OfficialLocale | null = null;
  private cachedClipboardClearOptions: ReturnType<typeof buildClipboardClearOptions> = [];
  private cachedFillModeOptions: ReturnType<typeof buildFillModeOptions> = [];

  get clipboardClearOptions() {
    this.refreshLocalizedOptions();
    return this.cachedClipboardClearOptions;
  }

  get fillModeOptions() {
    this.refreshLocalizedOptions();
    return this.cachedFillModeOptions;
  }

  constructor(
    private readonly settingsService: SettingsService,
    private readonly location: Location,
  ) {}

  get settings() {
    return this.settingsService.snapshot();
  }

  back(): void {
    this.location.back();
  }

  setClipboardClearSecondsValue(value: unknown): void {
    if (isClipboardClearSeconds(value)) {
      this.settingsService.setClipboardClearSeconds(value);
    }
  }

  setFillModeValue(value: unknown): void {
    if (isFillMode(value)) {
      this.settingsService.setFillMode(value);
    }
  }

  private refreshLocalizedOptions(): void {
    const locale = activeOfficialLocale();
    if (this.optionsLocale === locale) {
      return;
    }

    this.optionsLocale = locale;
    this.cachedClipboardClearOptions = buildClipboardClearOptions();
    this.cachedFillModeOptions = buildFillModeOptions();
  }
}

function buildClipboardClearOptions() {
  return clipboardClearSecondsValues.map((value) => ({
    value,
    label: clipboardClearSecondsLabel(value),
  }));
}

function buildFillModeOptions() {
  return fillModeValues.map((value) => ({
    value,
    label: translateOfficialMessage(
      value === "clipboard-copy" ? "i18nClipboardCopyOnly" : "i18nCopyAndPaste",
    ),
  }));
}

function clipboardClearSecondsLabel(value: (typeof clipboardClearSecondsValues)[number]): string {
  if (value === 0) {
    return translateOfficialMessage("never");
  }
  if (value < 60) {
    return translateOfficialMessage("i18nSeconds", value);
  }
  return translateOfficialMessage("i18nMinutes", value / 60);
}
