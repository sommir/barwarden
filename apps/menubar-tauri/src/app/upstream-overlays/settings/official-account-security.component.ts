import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { PopupHeaderComponent } from "../../layout/popup-header.component";
import { PopupPageComponent } from "../../layout/popup-page.component";
import {
  BitFormFieldComponent,
  BitHintDirective,
  BitLabelComponent,
  CardComponent,
  CheckboxComponent,
  FormControlComponent,
  ItemComponent,
  ItemContentComponent,
  ItemGroupComponent,
  SectionComponent,
  SectionHeaderComponent,
  SelectComponent,
  TypographyDirective,
} from "../../official-ui/official-components";
import {
  isVaultTimeoutAction,
  isVaultTimeoutMinutes,
  vaultTimeoutActionValues,
  vaultTimeoutMinutesValues,
  type VaultTimeoutAction,
  type VaultTimeoutMinutes,
} from "../../settings/settings-options";
import type { SettingsSnapshot } from "../../settings/settings.service";
import { MacosAlertStripComponent } from "../../official-ui/macos-alert-strip.component";
import {
  activeOfficialLocale,
  translateOfficialMessage,
  type OfficialLocale,
} from "../../official-ui/official-i18n.service";
import { I18nPipe } from "../../official-ui/official-ui-common";

@Component({
  selector: "bw-official-account-security",
  standalone: true,
  imports: [
    BitFormFieldComponent,
    BitHintDirective,
    BitLabelComponent,
    CardComponent,
    CheckboxComponent,
    FormControlComponent,
    FormsModule,
    ItemComponent,
    ItemContentComponent,
    ItemGroupComponent,
    I18nPipe,
    MacosAlertStripComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    SectionComponent,
    SectionHeaderComponent,
    SelectComponent,
    TypographyDirective,
  ],
  templateUrl: "./official-account-security.component.html",
})
export class OfficialAccountSecurityComponent {
  @Input({ required: true }) settings!: Readonly<SettingsSnapshot>;
  @Input() handoffError = "";
  @Input() unlockMethodError = "";
  @Input() pinEnabled = false;
  @Input() biometricEnabled = false;
  @Input() biometricAvailable = false;
  @Input() biometricUnavailableReason = "";
  @Input() unlockMethodBusy = false;
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly vaultTimeoutMinutesChange = new EventEmitter<VaultTimeoutMinutes>();
  @Output() readonly vaultTimeoutActionChange = new EventEmitter<VaultTimeoutAction>();
  @Output() readonly openTwoStepLogin = new EventEmitter<void>();
  @Output() readonly openChangePassword = new EventEmitter<void>();
  @Output() readonly pinEnabledChange = new EventEmitter<boolean>();
  @Output() readonly biometricEnabledChange = new EventEmitter<boolean>();

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.back.emit();
  private optionsLocale: OfficialLocale | null = null;
  private cachedTimeoutOptions: ReturnType<typeof buildTimeoutOptions> = [];
  private cachedTimeoutActionOptions: ReturnType<typeof buildTimeoutActionOptions> = [];

  get timeoutOptions() {
    this.refreshLocalizedOptions();
    return this.cachedTimeoutOptions;
  }

  get timeoutActionOptions() {
    this.refreshLocalizedOptions();
    return this.cachedTimeoutActionOptions;
  }

  setVaultTimeoutMinutesValue(value: unknown): void {
    if (isVaultTimeoutMinutes(value)) {
      this.vaultTimeoutMinutesChange.emit(value);
    }
  }

  setVaultTimeoutActionValue(value: unknown): void {
    if (isVaultTimeoutAction(value)) {
      this.vaultTimeoutActionChange.emit(value);
    }
  }

  setPinEnabledValue(event: Event): void {
    const requested = checkedValue(event);
    restoreCheckedValue(event, this.pinEnabled);
    this.pinEnabledChange.emit(requested);
  }

  setBiometricEnabledValue(event: Event): void {
    const requested = checkedValue(event);
    restoreCheckedValue(event, this.biometricEnabled);
    this.biometricEnabledChange.emit(requested);
  }

  private refreshLocalizedOptions(): void {
    const locale = activeOfficialLocale();
    if (this.optionsLocale === locale) {
      return;
    }

    this.optionsLocale = locale;
    this.cachedTimeoutOptions = buildTimeoutOptions();
    this.cachedTimeoutActionOptions = buildTimeoutActionOptions();
  }
}

function checkedValue(event: Event): boolean {
  return event.target instanceof HTMLInputElement && event.target.checked;
}

function restoreCheckedValue(event: Event, checked: boolean): void {
  if (event.target instanceof HTMLInputElement) {
    event.target.checked = checked;
  }
}

function buildTimeoutOptions() {
  return vaultTimeoutMinutesValues.map((value) => ({
    value,
    label: vaultTimeoutLabel(value),
  }));
}

function buildTimeoutActionOptions() {
  return vaultTimeoutActionValues.map((value) => ({
    value,
    label: translateOfficialMessage(value === "lock" ? "i18nLockAction" : "i18nLogOutAction"),
  }));
}

function vaultTimeoutLabel(value: VaultTimeoutMinutes): string {
  if (value < 0) {
    return translateOfficialMessage("i18nNever");
  }
  if (value === 0) {
    return translateOfficialMessage("i18nImmediately");
  }
  if (value < 60) {
    return translateOfficialMessage("i18nMinutes", value);
  }
  return translateOfficialMessage("i18nHours", value / 60);
}
