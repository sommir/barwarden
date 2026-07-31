export type OfficialSettingsTransformContract = {
  readonly authority: string;
  readonly runtime: string;
  readonly patch: string;
};

const overlayRoot = "apps/menubar-tauri/src/app/upstream-overlays/settings";

export const officialSettingsTransformContracts: readonly OfficialSettingsTransformContract[] = [
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
].map((authority) => ({
  authority,
  runtime: `${overlayRoot}/generated/${authority}`,
  patch: `${overlayRoot}/source-patches/${authority.replaceAll("/", "__")}.patch`,
}));

export const settingsExcludedTemplateContract = {
  authority: "apps/browser/src/tools/popup/settings/settings-v2.component.html",
  marker: 'routerLink="/autofill"',
} as const;

export const officialAccountSecurityLocalAdaptations = [
  {
    id: "runtime-pin",
    sourceFeature: "unlockWithPin",
    runtimeMembers: ["pinEnabled", "pinEnabledChange"],
    securityBoundary: "account-session-envelope-in-memory",
  },
  {
    id: "macos-touch-id",
    sourceFeature: "biometrics",
    runtimeMembers: [
      "biometricEnabled",
      "biometricAvailable",
      "biometricUnavailableReason",
      "biometricEnabledChange",
    ],
    securityBoundary: "tauri-local-authentication-keychain",
  },
] as const;
