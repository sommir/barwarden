import { InjectionToken } from "@angular/core";

export const sendEvidenceStates = [
  "list-populated",
  "list-loading",
  "list-empty",
  "list-no-results",
  "list-disabled",
  "view",
  "form-add",
  "form-edit",
  "created",
  "mutation-error",
  "row-actions",
] as const;

export type SendEvidenceState = (typeof sendEvidenceStates)[number];

export const SEND_EVIDENCE_STATE = new InjectionToken<SendEvidenceState | null>(
  "SEND_EVIDENCE_STATE",
);

export function parseSendEvidenceState(value: string): SendEvidenceState {
  if ((sendEvidenceStates as readonly string[]).includes(value)) {
    return value as SendEvidenceState;
  }
  throw new Error("Invalid Send evidence state");
}

export function resolveSendEvidenceState(enabled: boolean, search: string): SendEvidenceState | null {
  if (!enabled) {
    return null;
  }
  const entries = [...new URLSearchParams(search).entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "sendEvidence") {
    throw new Error("Invalid Send evidence query");
  }
  return parseSendEvidenceState(entries[0][1]);
}
