import { InjectionToken } from "@angular/core";

export const AUTH_EVIDENCE_STATES = [
  "environment",
  "email",
  "master-password",
  "hint",
  "authenticator",
  "email-two-factor",
  "new-device",
  "lock-error",
  "account-switcher",
  "loading",
  "offline",
  "error",
  "long-text",
  "light",
  "dark",
  "system-theme",
  "alternative-unlock",
  "alternative-unlock-startup",
] as const;

export type AuthEvidenceState =
  | (typeof AUTH_EVIDENCE_STATES)[number]
  | "two-factor"
  | "locked"
  | "restored-vault";

export const AUTH_EVIDENCE_STATE = new InjectionToken<AuthEvidenceState | null>(
  "AUTH_EVIDENCE_STATE",
  {
    providedIn: "root",
    factory: () => null,
  },
);

const AUTH_EVIDENCE_STATE_SET = new Set<string>(AUTH_EVIDENCE_STATES);

export function resolveAuthEvidenceState(
  evidenceEnabled: boolean,
  search: string,
): AuthEvidenceState | null {
  if (!evidenceEnabled) {
    return null;
  }

  const values = new URLSearchParams(search).getAll("authEvidence");
  if (values.length === 0) {
    return null;
  }
  if (values.length !== 1 || !AUTH_EVIDENCE_STATE_SET.has(values[0])) {
    throw new Error("Invalid auth evidence state");
  }

  return values[0] as AuthEvidenceState;
}
