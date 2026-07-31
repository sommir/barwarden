import type { Provider } from "@angular/core";

import type { VaultMainEvidenceState } from "../vault/vault-main-evidence-state";

export function createRecoveryWorkflowEvidenceProviders(): Provider[] {
  return [];
}

export function isRecoveryEvidenceState(_state: VaultMainEvidenceState): boolean {
  return false;
}
