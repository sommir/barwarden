import type { PopupStateStore } from "../popup-state";
import type { AuthEvidenceState } from "./auth-evidence-state";

export function applyAuthEvidenceState(
  _store: PopupStateStore,
  _evidenceState: AuthEvidenceState,
): string {
  throw new Error("Authentication evidence preview is unavailable");
}
