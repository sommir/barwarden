import { Injectable, Optional, type OnDestroy } from "@angular/core";

import {
  isClipboardClearSeconds,
  isFillMode,
  isThemeMode,
  isVaultTimeoutAction,
  isVaultTimeoutMinutes,
  type ClipboardClearSeconds,
  type FillMode,
  type ThemeMode,
  type VaultTimeoutAction,
  type VaultTimeoutMinutes,
} from "./settings-options";
import type { BiometricPreferencePort } from "../auth/unlock-methods.port";
import {
  OfficialI18nService,
  resolveOfficialLocale,
  type OfficialLocale,
} from "../official-ui/official-i18n.service";

export type {
  ClipboardClearSeconds,
  FillMode,
  ThemeMode,
  VaultTimeoutAction,
  VaultTimeoutMinutes,
} from "./settings-options";

export interface SettingsSnapshot {
  readonly animations: boolean;
  readonly clipboardClearSeconds: ClipboardClearSeconds;
  readonly compactMode: boolean;
  readonly fillMode: FillMode;
  readonly language: OfficialLocale | null;
  readonly showFavicons: boolean;
  readonly showInputFieldIcon: boolean;
  readonly showQuickCopyActions: boolean;
  readonly theme: ThemeMode;
  readonly vaultTimeoutMinutes: VaultTimeoutMinutes;
  readonly vaultTimeoutAction: VaultTimeoutAction;
  readonly biometricEnabled: boolean;
}

const SETTINGS_STORAGE_KEY = "barwarden.settings";
const ACCOUNT_SETTINGS_STORAGE_KEY_PREFIX = "barwarden.account-settings.";

type GlobalSettings = Omit<
  SettingsSnapshot,
  "vaultTimeoutMinutes" | "vaultTimeoutAction" | "biometricEnabled"
>;
type AccountSecuritySettings = Pick<
  SettingsSnapshot,
  "vaultTimeoutMinutes" | "vaultTimeoutAction" | "biometricEnabled"
>;
type Writable<T> = { -readonly [K in keyof T]: T[K] };

const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = Object.freeze({
  animations: true,
  clipboardClearSeconds: 30,
  compactMode: false,
  fillMode: "clipboard-paste",
  language: null,
  showFavicons: true,
  showInputFieldIcon: true,
  showQuickCopyActions: true,
  theme: "system",
});

const DEFAULT_ACCOUNT_SECURITY_SETTINGS: AccountSecuritySettings = Object.freeze({
  vaultTimeoutMinutes: 5,
  vaultTimeoutAction: "lock",
  biometricEnabled: false,
});

@Injectable({ providedIn: "root" })
export class SettingsService implements OnDestroy, BiometricPreferencePort {
  private globalSettings: GlobalSettings = this.restore();
  private settings: SettingsSnapshot = {
    ...this.globalSettings,
    ...DEFAULT_ACCOUNT_SECURITY_SETTINGS,
  };
  private activeAccountId: string | null = null;
  private systemThemeQuery?: MediaQueryList;
  private readonly systemThemeChanged = () => this.applyAppearanceSettings();

  constructor(@Optional() private readonly i18n: OfficialI18nService | null = null) {
    this.applyAppearanceSettings();
    void this.i18n?.setLocale(this.globalSettings.language ?? resolveOfficialLocale(globalThis.navigator?.language));
  }

  snapshot(): SettingsSnapshot {
    return this.settings;
  }

  useAccount(accountId: string | null): void {
    this.activeAccountId = accountId;
    if (!accountId) {
      this.globalSettings = this.restore();
      this.settings = { ...this.globalSettings, ...DEFAULT_ACCOUNT_SECURITY_SETTINGS };
      return;
    }

    const accountSettings = readAccountSecuritySettings(
      accountId,
      DEFAULT_ACCOUNT_SECURITY_SETTINGS,
    );
    this.settings = { ...this.globalSettings, ...accountSettings };
  }

  setClipboardClearSeconds(clipboardClearSeconds: ClipboardClearSeconds): void {
    if (isClipboardClearSeconds(clipboardClearSeconds)) {
      this.update({ clipboardClearSeconds });
    }
  }

  setFillMode(fillMode: FillMode): void {
    if (isFillMode(fillMode)) {
      this.update({ fillMode });
    }
  }

  setLanguage(language: OfficialLocale | null): void {
    this.update({ language });
    void this.i18n?.setLocale(language ?? resolveOfficialLocale(globalThis.navigator?.language));
  }

  setTheme(theme: ThemeMode): void {
    if (isThemeMode(theme)) {
      this.update({ theme });
    }
  }

  setCompactMode(compactMode: boolean): void {
    this.update({ compactMode });
  }

  setAnimations(animations: boolean): void {
    this.update({ animations });
  }

  setShowFavicons(showFavicons: boolean): void {
    this.update({ showFavicons });
  }

  setShowInputFieldIcon(showInputFieldIcon: boolean): void {
    this.update({ showInputFieldIcon });
  }

  setShowQuickCopyActions(showQuickCopyActions: boolean): void {
    this.update({ showQuickCopyActions });
  }

  setVaultTimeoutMinutes(vaultTimeoutMinutes: VaultTimeoutMinutes): boolean {
    return isVaultTimeoutMinutes(vaultTimeoutMinutes)
      && this.updateAccountSettings({ vaultTimeoutMinutes });
  }

  setVaultTimeoutAction(vaultTimeoutAction: VaultTimeoutAction): boolean {
    return isVaultTimeoutAction(vaultTimeoutAction)
      && this.updateAccountSettings({ vaultTimeoutAction });
  }

  setBiometricEnabled(biometricEnabled: boolean): boolean {
    return this.activeAccountId !== null
      && this.writeBiometricEnabled(this.activeAccountId, biometricEnabled);
  }

  isBiometricEnabled(accountId: string): boolean {
    if (!isCanonicalAccountId(accountId)) {
      return false;
    }
    if (this.activeAccountId === accountId) {
      return this.settings.biometricEnabled;
    }
    return readAccountSecuritySettings(
      accountId,
      DEFAULT_ACCOUNT_SECURITY_SETTINGS,
    ).biometricEnabled;
  }

  writeBiometricEnabled(accountId: string, enabled: boolean): boolean {
    if (!isCanonicalAccountId(accountId)) {
      return false;
    }
    const current = this.activeAccountId === accountId
      ? pickAccountSecuritySettings(this.settings)
      : readAccountSecuritySettings(accountId, DEFAULT_ACCOUNT_SECURITY_SETTINGS);
    const next = { ...current, biometricEnabled: enabled };
    if (!persistAccountSecuritySettings(accountId, next)) {
      return false;
    }
    if (this.activeAccountId === accountId) {
      this.settings = { ...this.settings, biometricEnabled: enabled };
    }
    return true;
  }

  clearAccount(accountId: string): void {
    if (!isCanonicalAccountId(accountId)) {
      return;
    }
    try {
      const storage = globalThis.localStorage;
      if (!storage) {
        throw new Error("unavailable");
      }
      storage.removeItem(accountSettingsStorageKey(accountId));
    } catch {
      throw new Error("account-settings-unavailable");
    }
    if (this.activeAccountId === accountId) {
      this.useAccount(null);
    }
  }

  ngOnDestroy(): void {
    this.detachSystemThemeListener();
  }

  private update(partial: Partial<GlobalSettings>): void {
    this.settings = { ...this.settings, ...partial };
    this.globalSettings = { ...this.globalSettings, ...partial };
    this.persist();
    this.applyAppearanceSettings();
  }

  private updateAccountSettings(
    partial: Partial<AccountSecuritySettings>,
  ): boolean {
    const nextSettings = { ...this.settings, ...partial };
    if (!this.activeAccountId) {
      this.settings = nextSettings;
      return true;
    }

    if (
      !persistAccountSecuritySettings(
        this.activeAccountId,
        pickAccountSecuritySettings(nextSettings),
      )
    ) {
      return false;
    }

    this.settings = nextSettings;
    return true;
  }

  private restore(): GlobalSettings {
    const stored = readStoredSettings();
    return stored ? { ...DEFAULT_GLOBAL_SETTINGS, ...stored } : { ...DEFAULT_GLOBAL_SETTINGS };
  }

  private persist(): void {
    try {
      globalThis.localStorage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.globalSettings));
    } catch {
      // Local storage can be unavailable in restricted WebViews; settings still work in memory.
    }
  }

  private applyAppearanceSettings(): void {
    const root = globalThis.document?.documentElement;
    if (!root) {
      return;
    }

    root.dataset["bwTheme"] = this.settings.theme;
    root.dataset["bwCompactMode"] = String(this.settings.compactMode);
    root.dataset["bwAnimations"] = String(this.settings.animations);
    root.classList.toggle("theme_dark", this.resolvedTheme() === "dark");
    globalThis.document?.body.classList.toggle("tw-bit-compact", this.settings.compactMode);
  }

  private resolvedTheme(): "light" | "dark" {
    if (this.settings.theme !== "system") {
      this.detachSystemThemeListener();
      return this.settings.theme;
    }

    const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    if (query && query !== this.systemThemeQuery) {
      this.detachSystemThemeListener();
      query.addEventListener("change", this.systemThemeChanged);
      this.systemThemeQuery = query;
    }

    return query?.matches ? "dark" : "light";
  }

  private detachSystemThemeListener(): void {
    this.systemThemeQuery?.removeEventListener("change", this.systemThemeChanged);
    this.systemThemeQuery = undefined;
  }
}

function readStoredSettings(): Partial<GlobalSettings> | null {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<GlobalSettings>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return sanitizeSettings(parsed);
  } catch {
    return null;
  }
}

function sanitizeSettings(candidate: Partial<GlobalSettings>): Partial<GlobalSettings> {
  const sanitized: Partial<Writable<GlobalSettings>> = {};

  if (typeof candidate.animations === "boolean") {
    sanitized.animations = candidate.animations;
  }
  if (isClipboardClearSeconds(candidate.clipboardClearSeconds)) {
    sanitized.clipboardClearSeconds = candidate.clipboardClearSeconds;
  }
  if (typeof candidate.compactMode === "boolean") {
    sanitized.compactMode = candidate.compactMode;
  }
  if (isFillMode(candidate.fillMode)) {
    sanitized.fillMode = candidate.fillMode;
  }
  if (candidate.language === "zh-CN" || candidate.language === "en-US" || candidate.language === null) {
    sanitized.language = candidate.language;
  }
  if (typeof candidate.showFavicons === "boolean") {
    sanitized.showFavicons = candidate.showFavicons;
  }
  if (typeof candidate.showInputFieldIcon === "boolean") {
    sanitized.showInputFieldIcon = candidate.showInputFieldIcon;
  }
  if (typeof candidate.showQuickCopyActions === "boolean") {
    sanitized.showQuickCopyActions = candidate.showQuickCopyActions;
  }
  if (isThemeMode(candidate.theme)) {
    sanitized.theme = candidate.theme;
  }

  return sanitized;
}

function readAccountSecuritySettings(
  accountId: string,
  fallback: AccountSecuritySettings,
): AccountSecuritySettings {
  try {
    const raw = globalThis.localStorage?.getItem(accountSettingsStorageKey(accountId));
    if (raw) {
      const candidate = sanitizeAccountSecuritySettings(
        JSON.parse(raw) as Partial<AccountSecuritySettings>,
      );
      return {
        vaultTimeoutMinutes: candidate.vaultTimeoutMinutes ?? fallback.vaultTimeoutMinutes,
        vaultTimeoutAction: candidate.vaultTimeoutAction ?? fallback.vaultTimeoutAction,
        biometricEnabled: candidate.biometricEnabled ?? fallback.biometricEnabled,
      };
    }
  } catch {
    // Invalid or unavailable settings fall back to secure defaults.
  }

  return {
    vaultTimeoutMinutes: fallback.vaultTimeoutMinutes,
    vaultTimeoutAction: fallback.vaultTimeoutAction,
    biometricEnabled: fallback.biometricEnabled,
  };
}

function sanitizeAccountSecuritySettings(
  candidate: Partial<AccountSecuritySettings>,
): Partial<AccountSecuritySettings> {
  const sanitized: Partial<Writable<AccountSecuritySettings>> = {};
  if (isVaultTimeoutMinutes(candidate.vaultTimeoutMinutes)) {
    sanitized.vaultTimeoutMinutes = candidate.vaultTimeoutMinutes;
  }
  if (isVaultTimeoutAction(candidate.vaultTimeoutAction)) {
    sanitized.vaultTimeoutAction = candidate.vaultTimeoutAction;
  }
  if (typeof candidate.biometricEnabled === "boolean") {
    sanitized.biometricEnabled = candidate.biometricEnabled;
  }
  return sanitized;
}

function pickAccountSecuritySettings(
  settings: SettingsSnapshot,
): AccountSecuritySettings {
  return {
    vaultTimeoutMinutes: settings.vaultTimeoutMinutes,
    vaultTimeoutAction: settings.vaultTimeoutAction,
    biometricEnabled: settings.biometricEnabled,
  };
}

function persistAccountSecuritySettings(
  accountId: string,
  settings: AccountSecuritySettings,
): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      return false;
    }
    storage.setItem(accountSettingsStorageKey(accountId), JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

function isCanonicalAccountId(accountId: string): boolean {
  return /^[0-9a-f]{64}$/.test(accountId);
}

export function accountSettingsStorageKey(accountId: string): string {
  return `${ACCOUNT_SETTINGS_STORAGE_KEY_PREFIX}${encodeURIComponent(accountId)}`;
}
