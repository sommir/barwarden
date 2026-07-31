import type { PopupStateStore } from "../popup-state";
import type { VaultMainEvidenceState } from "./vault-main-evidence-state";

export function applyVaultMainEvidenceState(
  _store: PopupStateStore,
  _state: VaultMainEvidenceState,
): void {}

export function vaultMainEvidenceRoute(_evidenceState: VaultMainEvidenceState): string {
  return "/tabs/vault";
}
