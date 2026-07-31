import { InjectionToken } from "@angular/core";

import type { AuthSession } from "../../auth/auth-session-store";
import type { BiometricAvailability } from "../../host/biometric-host";

export interface BiometricPreferencePort {
  isBiometricEnabled(accountId: string): boolean;
  writeBiometricEnabled(accountId: string, enabled: boolean): boolean;
  clearAccount(accountId: string): void;
}

export interface UnlockMethodAvailability {
  readonly pinEnabled: boolean;
  readonly biometricEnabled: boolean;
  readonly biometricAvailability: BiometricAvailability;
}

export type AlternativeUnlockFailure =
  | "incorrect-pin"
  | "pin-exhausted"
  | "pin-unavailable"
  | "biometric-cancelled"
  | "biometric-failed"
  | "biometric-invalidated"
  | "biometric-unavailable"
  | "session-unavailable"
  | "sync-failed";

export class AlternativeUnlockError extends Error {
  override readonly name = "AlternativeUnlockError";

  constructor(
    readonly code: AlternativeUnlockFailure,
    readonly attemptsRemaining?: number,
  ) {
    super("Unable to unlock vault.");
  }
}

export interface UnlockMethodsPort {
  availability(accountId: string): Promise<UnlockMethodAvailability>;
  enablePin(accountId: string, pin: string, session: AuthSession): Promise<void>;
  disablePin(accountId: string): Promise<void>;
  /** Marks persisted PIN material usable after a master-password unlock in this process. */
  activatePersistedPin?(accountId: string): Promise<void>;
  enableBiometric(accountId: string): Promise<void>;
  disableBiometric(accountId: string): Promise<void>;
  unlockWithPin(accountId: string, pin: string): Promise<AuthSession>;
  unlockWithBiometric(accountId: string): Promise<AuthSession>;
  prepareForLock(accountId: string, session: AuthSession): void;
  beginLockEpoch(accountId: string): number;
  currentLockEpoch(accountId: string): number | null;
  consumeAutomaticBiometricPrompt(accountId: string, epoch: number): boolean;
  clearAccount(accountId: string): Promise<void>;
}

export const BIOMETRIC_PREFERENCE_PORT =
  new InjectionToken<BiometricPreferencePort | null>("BIOMETRIC_PREFERENCE_PORT", {
    providedIn: "root",
    factory: () => null,
  });

export const UNLOCK_METHODS_PORT = new InjectionToken<UnlockMethodsPort | null>(
  "UNLOCK_METHODS_PORT",
  {
    providedIn: "root",
    factory: () => null,
  },
);
