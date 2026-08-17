import { Location } from "@angular/common";
import { Component, Optional } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import {
  BitFormFieldComponent,
  BitHintDirective,
  BitLabelComponent,
  CheckboxComponent,
  FormControlComponent,
  SectionComponent,
  SectionHeaderComponent,
  SelectComponent,
  TypographyDirective,
} from "../official-ui/official-components";
import { AutoFillAccessibilityService } from "../autofill/autofill-accessibility.service";
import { AutoFillSetupService } from "../autofill/autofill-setup.service";
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
  template: `
    <popup-page>
      <popup-header slot="header" [pageTitle]="'i18nAutofill' | i18n" [showBackButton]="true" [backAction]="backAction" />
      <bit-section>
        <bit-section-header><h2 bitTypography="h6">{{ "i18nAutofillBehavior" | i18n }}</h2></bit-section-header>
        <section class="settings-detail-group macos-continuous-group">
          <bit-form-field class="settings-detail-row macos-continuous-row">
            <bit-label>{{ "i18nClearClipboard" | i18n }}</bit-label>
            <bit-select class="macos-form-control" [attr.aria-label]="'i18nClearClipboard' | i18n" [items]="clipboardClearOptions" [ngModel]="settings.clipboardClearSeconds" (ngModelChange)="setClipboardClearSecondsValue($event)" />
            <bit-hint>{{ "i18nClearClipboardHint" | i18n }}</bit-hint>
          </bit-form-field>
          <bit-form-field class="settings-detail-row macos-continuous-row" disableMargin>
            <bit-label>{{ "i18nAutofill" | i18n }}</bit-label>
            <bit-select class="macos-form-control" [attr.aria-label]="'i18nAutofill' | i18n" [items]="fillModeOptions" [ngModel]="settings.fillMode" (ngModelChange)="setFillModeValue($event)" />
            <bit-hint>{{ "i18nAutofillModeHint" | i18n }}</bit-hint>
          </bit-form-field>
          <bit-form-control class="settings-detail-row macos-continuous-row" disableMargin>
            <input
              id="show-input-field-icon"
              bitCheckbox
              type="checkbox"
              [attr.aria-label]="'i18nShowInputFieldIcon' | i18n"
              [checked]="settings.showInputFieldIcon"
              (change)="setShowInputFieldIcon($event)"
            />
            <bit-label>{{ "i18nShowInputFieldIcon" | i18n }}</bit-label>
            <bit-hint>{{ "i18nShowInputFieldIconHint" | i18n }}</bit-hint>
          </bit-form-control>
        </section>
      </bit-section>
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
    @Optional() private readonly accessibility: AutoFillAccessibilityService | null = null,
    @Optional() private readonly setup: AutoFillSetupService | null = null,
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

  setShowInputFieldIcon(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const enabled = event.target.checked;
    this.settingsService.setShowInputFieldIcon(enabled);
    const update = this.setup?.setFloatingIconPreference(enabled)
      ?? this.accessibility?.setFloatingIconEnabled(enabled);
    void update?.catch(() => undefined);
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
