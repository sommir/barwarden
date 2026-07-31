import { InjectionToken } from "@angular/core";

export const vaultMainEvidenceStates = [
  "populated",
  "large-list",
  "search-results",
  "folder-filter",
  "type-filter",
  "filtered",
  "menu-open",
  "long-text",
  "loading",
  "empty",
  "no-results",
  "stale",
  "unavailable",
  "compact",
  "light",
  "dark",
  "login-detail",
  "login-detail-reprompt",
  "login-history",
  "login-history-empty",
  "login-history-protected",
  "login-add",
  "login-edit",
  "login-clone",
  "login-archive",
  "login-trash",
  "card-detail",
  "card-detail-reprompt",
  "card-form-add",
  "card-form-edit",
  "card-form-clone",
  "card-add",
  "card-edit",
  "card-clone",
  "card-archive",
  "card-trash",
  "identity-detail",
  "identity-detail-reprompt",
  "identity-form-add",
  "identity-form-edit",
  "identity-form-clone",
  "identity-add",
  "identity-edit",
  "identity-clone",
  "identity-archive",
  "identity-trash",
  "note-detail",
  "note-form-add",
  "note-form-edit",
  "note-form-clone",
  "note-add",
  "note-edit",
  "note-clone",
  "note-archive",
  "note-trash",
  "personal-form-validation",
  "personal-form-failure",
  "personal-form-duplicate",
  "personal-form-stale",
  "login-workflow-detail-default",
  "login-workflow-detail-revealed",
  "login-workflow-detail-reprompt",
  "login-workflow-detail-totp-rollover",
  "login-workflow-detail-multiple-uri",
  "login-workflow-detail-custom-field",
  "login-workflow-detail-archived",
  "login-workflow-detail-trashed",
  "login-workflow-detail-action-failure",
  "login-workflow-detail-long-text",
  "login-workflow-form-add",
  "login-workflow-form-edit",
  "login-workflow-form-clone",
  "login-workflow-form-validation",
  "login-workflow-form-save-failure",
  "login-workflow-form-duplicate",
  "login-workflow-form-stale",
  "login-workflow-form-compact",
  "login-workflow-form-light",
  "login-workflow-form-dark",
  "password-history-populated",
  "password-history-empty",
  "password-history-reprompt",
  "folders-list",
  "folders-empty",
  "folders-add-dialog",
  "folders-edit-dialog",
  "folders-delete-confirmation",
  "archive-list",
  "archive-menu",
  "archive-empty",
  "trash-list",
  "trash-menu",
  "trash-permanent-delete-confirmation",
  "trash-empty",
  "recovery-operation-error",
] as const;

export type VaultMainEvidenceState = (typeof vaultMainEvidenceStates)[number];

export const VAULT_MAIN_EVIDENCE_STATE = new InjectionToken<VaultMainEvidenceState | null>(
  "VAULT_MAIN_EVIDENCE_STATE",
);

export function parseVaultMainEvidenceState(value: string): VaultMainEvidenceState {
  if ((vaultMainEvidenceStates as readonly string[]).includes(value)) {
    return value as VaultMainEvidenceState;
  }
  throw new Error("Invalid Vault evidence state");
}

export function resolveVaultMainEvidenceState(
  enabled: boolean,
  search: string,
): VaultMainEvidenceState | null {
  if (!enabled) {
    return null;
  }

  const params = new URLSearchParams(search);
  const entries = [...params.entries()];
  if (entries.length === 0) {
    return "populated";
  }
  if (entries.length !== 1 || entries[0]?.[0] !== "vaultEvidence") {
    throw new Error("Invalid Vault evidence query");
  }
  return parseVaultMainEvidenceState(entries[0][1]);
}
