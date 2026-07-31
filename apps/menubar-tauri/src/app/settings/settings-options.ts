export const clipboardClearSecondsValues = Object.freeze([0, 10, 20, 30, 60, 120, 300] as const);
export const vaultTimeoutMinutesValues = Object.freeze([0, 1, 5, 15, 30, 60, 240, -1] as const);
export const fillModeValues = Object.freeze(["clipboard-copy", "clipboard-paste"] as const);
export const themeValues = Object.freeze(["system", "light", "dark"] as const);
export const vaultTimeoutActionValues = Object.freeze(["lock", "logout"] as const);

export type ClipboardClearSeconds = (typeof clipboardClearSecondsValues)[number];
export type VaultTimeoutMinutes = (typeof vaultTimeoutMinutesValues)[number];
export type FillMode = (typeof fillModeValues)[number];
export type ThemeMode = (typeof themeValues)[number];
export type VaultTimeoutAction = (typeof vaultTimeoutActionValues)[number];

export function isClipboardClearSeconds(value: unknown): value is ClipboardClearSeconds {
  return clipboardClearSecondsValues.includes(value as ClipboardClearSeconds);
}

export function isVaultTimeoutMinutes(value: unknown): value is VaultTimeoutMinutes {
  return vaultTimeoutMinutesValues.includes(value as VaultTimeoutMinutes);
}

export function isFillMode(value: unknown): value is FillMode {
  return fillModeValues.includes(value as FillMode);
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return themeValues.includes(value as ThemeMode);
}

export function isVaultTimeoutAction(value: unknown): value is VaultTimeoutAction {
  return vaultTimeoutActionValues.includes(value as VaultTimeoutAction);
}
