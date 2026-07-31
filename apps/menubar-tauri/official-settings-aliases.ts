import { resolve } from "node:path";

export type RuntimeClosureExclusion = {
  readonly id: string;
  readonly pattern: string;
  readonly flags: string;
};

export const officialSettingsAuthorityPaths = [
  "apps/browser/src/tools/popup/settings/settings-v2.component.ts",
  "apps/browser/src/tools/popup/settings/settings-v2.component.html",
  "apps/browser/src/auth/popup/settings/account-security.component.ts",
  "apps/browser/src/auth/popup/settings/account-security.component.html",
  "apps/browser/src/vault/popup/settings/vault-settings.component.ts",
  "apps/browser/src/vault/popup/settings/vault-settings.component.html",
  "apps/browser/src/vault/popup/settings/appearance.component.ts",
  "apps/browser/src/vault/popup/settings/appearance.component.html",
  "apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.ts",
  "apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.html",
  "apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.ts",
  "apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.html",
] as const;

export const officialSettingsAliasSources = [
  ["@bitwarden/settings-overlay/settings-v2", "apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/settings-v2.component.ts"],
  ["@bitwarden/settings-overlay/account-security", "apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/auth/popup/settings/account-security.component.ts"],
  ["@bitwarden/settings-overlay/vault-settings", "apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/vault/popup/settings/vault-settings.component.ts"],
  ["@bitwarden/settings-overlay/appearance", "apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/vault/popup/settings/appearance.component.ts"],
  ["@bitwarden/settings-overlay/about-page", "apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.ts"],
  ["@bitwarden/settings-overlay/about-dialog", "apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.ts"],
] as const;

export const officialSettingsClosureExclusions: readonly RuntimeClosureExclusion[] = [
  { id: "browser-autofill", pattern: "autofill/popup/settings|blocked-domains|excluded-domains|clickItemsToAutofill|badgeCounter", flags: "i" },
  { id: "browser-runtime", pattern: "BrowserApi|nativeMessaging|background|webRequest|webNavigation|contentScript|chrome\\.tabs|browser\\.tabs", flags: "i" },
  { id: "admin", pattern: "admin-settings|device-management|domain.*management|reports", flags: "i" },
  { id: "premium-billing", pattern: "premium-v2|billing|PremiumBadge|hasPremiumFromAnySource", flags: "i" },
  { id: "import-export", pattern: "export-browser|import-browser|exportNoun|importNoun", flags: "i" },
  { id: "official-desktop", pattern: "await-desktop|desktopIntegration|sharedUnlock|biometrics", flags: "i" },
  { id: "sso", pattern: "singleSignOn|@bitwarden/auth/sso", flags: "i" },
  { id: "unsupported-navigation", pattern: "/notifications|/download-bitwarden|/more-from-bitwarden", flags: "i" },
  { id: "extension-rating", pattern: "rateExtension|RateUrls|\\brate\\s*\\(", flags: "i" },
  { id: "pin-unlock", pattern: "PinService|SetPin|pinLockWithMasterPassword|unlockWithPin", flags: "i" },
  { id: "phishing-detection", pattern: "phishingDetection|phishingBlocker", flags: "i" },
  { id: "extension-width", pattern: "extensionWidth|PopupWidthOption|PopupSizeService", flags: "i" },
];

export type OfficialSettingsAlias = {
  readonly find: RegExp;
  readonly replacement: string;
};

export function buildOfficialSettingsAliases(root: string): readonly OfficialSettingsAlias[] {
  return officialSettingsAliasSources.map(([specifier, source]) => ({
    find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: resolve(root, source),
  }));
}
