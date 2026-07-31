import { InjectionToken } from "@angular/core";

export const settingsEvidenceStates = [
  "settings-main",
  "account-security",
  "vault-settings",
  "vault-settings-sync-failure",
  "one-field-settings",
  "appearance",
  "about",
  "about-dialog",
  "change-password-handoff",
] as const;

export type SettingsEvidenceState = (typeof settingsEvidenceStates)[number];

export const SETTINGS_EVIDENCE_STATE = new InjectionToken<SettingsEvidenceState | null>(
  "SETTINGS_EVIDENCE_STATE",
);
