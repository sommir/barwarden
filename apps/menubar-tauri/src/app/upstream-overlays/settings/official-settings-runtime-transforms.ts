export type OfficialSettingsRuntimeTransform = {
  readonly authority: string;
  readonly generated: string;
  readonly output: string;
  readonly patch: string;
};

const overlayRoot = "apps/menubar-tauri/src/app/upstream-overlays/settings";

export const officialSettingsRuntimeTransforms: readonly OfficialSettingsRuntimeTransform[] = [
  ["apps/browser/src/tools/popup/settings/settings-v2.component.ts", "official-settings.component.ts"],
  ["apps/browser/src/tools/popup/settings/settings-v2.component.html", "official-settings.component.html"],
  ["apps/browser/src/auth/popup/settings/account-security.component.ts", "official-account-security.component.ts"],
  ["apps/browser/src/auth/popup/settings/account-security.component.html", "official-account-security.component.html"],
  ["apps/browser/src/vault/popup/settings/vault-settings.component.ts", "official-vault-settings.component.ts"],
  ["apps/browser/src/vault/popup/settings/vault-settings.component.html", "official-vault-settings.component.html"],
  ["apps/browser/src/vault/popup/settings/appearance.component.ts", "official-appearance.component.ts"],
  ["apps/browser/src/vault/popup/settings/appearance.component.html", "official-appearance.component.html"],
  ["apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.ts", "official-about.component.ts"],
  ["apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.html", "official-about.component.html"],
  ["apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.ts", "official-about-dialog.component.ts"],
  ["apps/browser/src/tools/popup/settings/about-dialog/about-dialog.component.html", "official-about-dialog.component.html"],
].map(([authority, output]) => ({
  authority,
  generated: `${overlayRoot}/generated/${authority}`,
  output: `${overlayRoot}/${output}`,
  patch: `${overlayRoot}/runtime-patches/${authority.replaceAll("/", "__")}.patch`,
}));
