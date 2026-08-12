import type { HelpOrSourceUrl, WebVaultPath } from "./environment-handoff.service";
import type {
  ClipboardClearSeconds,
  FillMode,
  ThemeMode,
  VaultTimeoutAction,
  VaultTimeoutMinutes,
} from "./settings-options";
import type { SettingsSnapshot } from "./settings.service";

export type RetainedSettingsRoute =
  | "/about"
  | "/account-security"
  | "/appearance"
  | "/autofill"
  | "/keyboard-shortcut"
  | "/vault-settings";

export interface RetainedSettingsActions {
  snapshot(): SettingsSnapshot;
  setAnimations(animations: boolean): void;
  setClipboardClearSeconds(clipboardClearSeconds: ClipboardClearSeconds): void;
  setCompactMode(compactMode: boolean): void;
  setFillMode(fillMode: FillMode): void;
  setShowFavicons(showFavicons: boolean): void;
  setShowInputFieldIcon(showInputFieldIcon: boolean): void;
  setShowQuickCopyActions(showQuickCopyActions: boolean): void;
  setTheme(theme: ThemeMode): void;
  setVaultTimeoutMinutes(vaultTimeoutMinutes: VaultTimeoutMinutes): void;
  setVaultTimeoutAction(vaultTimeoutAction: VaultTimeoutAction): void;
  syncNow(): Promise<void>;
  openWebVault(path: WebVaultPath): Promise<void>;
  openExternal(url: HelpOrSourceUrl): Promise<void>;
  navigateTo(route: RetainedSettingsRoute): Promise<void>;
}
