import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";

import {
  ACCOUNT_SESSION_PORT,
  type AccountSessionPort,
} from "../../auth/account-session-port";
import type { AuthSession } from "../../auth/auth-session-store";
import { isBitwardenClientId } from "../../bitwarden-api/bitwarden-api";
import type {
  BiometricHost,
  BiometricOperationStatus,
} from "../../host/biometric-host";
import { TauriHostService } from "../../host/tauri-host.service";
import {
  RuntimePinVault,
  type RuntimePinVaultPort,
} from "./runtime-pin-vault";
import {
  AlternativeUnlockError,
  BIOMETRIC_PREFERENCE_PORT,
  type BiometricPreferencePort,
  type UnlockMethodAvailability,
  type UnlockMethodsPort,
} from "./unlock-methods.port";

export const RUNTIME_PIN_VAULT_PORT = new InjectionToken<RuntimePinVaultPort>(
  "RUNTIME_PIN_VAULT_PORT",
  {
    providedIn: "root",
    factory: () => new RuntimePinVault(),
  },
);

export const BIOMETRIC_HOST_PORT = new InjectionToken<BiometricHost>(
  "BIOMETRIC_HOST_PORT",
  {
    providedIn: "root",
    factory: () => new TauriHostService(),
  },
);

interface LockEpoch {
  value: number;
  automaticPromptConsumed: boolean;
}

@Injectable({ providedIn: "root" })
export class UnlockMethodsService implements UnlockMethodsPort {
  #lockEpochs = new Map<string, LockEpoch>();
  #invalidatedBiometricAccounts = new Set<string>();

  constructor(
    @Inject(RUNTIME_PIN_VAULT_PORT) private readonly pinVault: RuntimePinVaultPort,
    @Inject(BIOMETRIC_HOST_PORT) private readonly biometricHost: BiometricHost,
    @Optional() @Inject(ACCOUNT_SESSION_PORT)
    private readonly accountStore: AccountSessionPort | null,
    @Optional() @Inject(BIOMETRIC_PREFERENCE_PORT)
    private readonly preferences: BiometricPreferencePort | null,
  ) {}

  async availability(accountId: string): Promise<UnlockMethodAvailability> {
    const biometricAvailability = await this.biometricHost
      .biometricStatus(accountId)
      .catch(() => "not-available" as const);
    return {
      pinEnabled: this.pinVault.isEnabled(accountId),
      biometricEnabled: !this.#invalidatedBiometricAccounts.has(accountId)
        && (this.preferences?.isBiometricEnabled(accountId) ?? false),
      biometricAvailability,
    };
  }

  async enablePin(accountId: string, pin: string, session: AuthSession): Promise<void> {
    await this.requireAccount(accountId);
    await this.pinVault.enable(accountId, pin, session);
  }

  disablePin(accountId: string): Promise<void> {
    return this.pinVault.disable(accountId);
  }

  async activatePersistedPin(accountId: string): Promise<void> {
    await this.requireAccount(accountId);
    await this.pinVault.activatePersistedPin(accountId);
  }

  async enableBiometric(accountId: string): Promise<void> {
    await this.requireAccount(accountId);
    const preferences = this.requirePreferences();
    const status = await this.biometricOperation(() =>
      this.biometricHost.biometricEnable(accountId),
    );
    if (status !== "enabled") {
      throw biometricError(status);
    }
    if (!preferences.writeBiometricEnabled(accountId, true)) {
      await this.biometricHost.biometricDisable(accountId).catch(() => "failed" as const);
      throw new AlternativeUnlockError("biometric-failed");
    }
    this.#invalidatedBiometricAccounts.delete(accountId);
  }

  async disableBiometric(accountId: string): Promise<void> {
    const preferences = this.requirePreferences();
    const status = await this.biometricOperation(() =>
      this.biometricHost.biometricDisable(accountId),
    );
    if (status !== "disabled") {
      throw biometricError(status);
    }
    this.#invalidatedBiometricAccounts.add(accountId);
    if (!preferences.writeBiometricEnabled(accountId, false)) {
      throw new AlternativeUnlockError("biometric-failed");
    }
  }

  async unlockWithPin(accountId: string, pin: string): Promise<AuthSession> {
    await this.requireAccount(accountId);
    const result = await this.pinVault.unlock(accountId, pin);
    switch (result.status) {
      case "success":
        if (!isAuthSession(result.session)) {
          await this.pinVault.clearAccount(accountId);
          throw new AlternativeUnlockError("session-unavailable");
        }
        return result.session;
      case "incorrect":
        throw new AlternativeUnlockError("incorrect-pin", result.attemptsRemaining);
      case "exhausted":
        throw new AlternativeUnlockError("pin-exhausted");
      case "unavailable":
        throw new AlternativeUnlockError("pin-unavailable");
    }
  }

  async unlockWithBiometric(accountId: string): Promise<AuthSession> {
    await this.requireAccount(accountId);
    if (!this.preferences?.isBiometricEnabled(accountId)) {
      throw new AlternativeUnlockError("biometric-unavailable");
    }
    const status = await this.biometricOperation(() =>
      this.biometricHost.biometricUnlock(accountId),
    );
    if (status === "invalidated") {
      this.#invalidatedBiometricAccounts.add(accountId);
      try {
        this.preferences?.writeBiometricEnabled(accountId, false);
      } catch {}
      throw new AlternativeUnlockError("biometric-invalidated");
    }
    if (status !== "success") {
      throw biometricError(status);
    }

    let session: AuthSession | null | undefined;
    try {
      session = await this.accountStore?.readSession(accountId);
    } catch {
      throw new AlternativeUnlockError("session-unavailable");
    }
    if (!isAuthSession(session)) {
      throw new AlternativeUnlockError("session-unavailable");
    }
    return session;
  }

  prepareForLock(accountId: string, session: AuthSession): void {
    this.pinVault.prepareForLock(accountId, session);
  }

  beginLockEpoch(accountId: string): number {
    const next = (this.#lockEpochs.get(accountId)?.value ?? 0) + 1;
    this.#lockEpochs.set(accountId, {
      value: next,
      automaticPromptConsumed: false,
    });
    return next;
  }

  currentLockEpoch(accountId: string): number | null {
    return this.#lockEpochs.get(accountId)?.value ?? null;
  }

  consumeAutomaticBiometricPrompt(accountId: string, epoch: number): boolean {
    const current = this.#lockEpochs.get(accountId);
    if (!current || current.value !== epoch || current.automaticPromptConsumed) {
      return false;
    }
    current.automaticPromptConsumed = true;
    return true;
  }

  async clearAccount(accountId: string): Promise<void> {
    await this.pinVault.clearAccount(accountId);
    this.#lockEpochs.delete(accountId);
    const biometricEnabled = this.preferences?.isBiometricEnabled(accountId) ?? false;
    if (biometricEnabled) {
      const status = await this.biometricOperation(() =>
        this.biometricHost.biometricDisable(accountId),
      );
      if (status !== "disabled" && status !== "invalidated") {
        throw biometricError(status);
      }
    }
    this.preferences?.clearAccount(accountId);
    this.#invalidatedBiometricAccounts.delete(accountId);
  }

  private async requireAccount(accountId: string): Promise<void> {
    let accounts;
    try {
      accounts = await this.accountStore?.list();
    } catch {
      throw new AlternativeUnlockError("session-unavailable");
    }
    if (!accounts?.some((account) => account.id === accountId)) {
      throw new AlternativeUnlockError("session-unavailable");
    }
  }

  private requirePreferences(): BiometricPreferencePort {
    if (!this.preferences) {
      throw new AlternativeUnlockError("biometric-unavailable");
    }
    return this.preferences;
  }

  private async biometricOperation(
    operation: () => Promise<BiometricOperationStatus>,
  ): Promise<BiometricOperationStatus> {
    try {
      return await operation();
    } catch {
      throw new AlternativeUnlockError("biometric-unavailable");
    }
  }
}

function biometricError(status: BiometricOperationStatus): AlternativeUnlockError {
  switch (status) {
    case "cancelled":
      return new AlternativeUnlockError("biometric-cancelled");
    case "invalidated":
      return new AlternativeUnlockError("biometric-invalidated");
    case "failed":
      return new AlternativeUnlockError("biometric-failed");
    default:
      return new AlternativeUnlockError("biometric-unavailable");
  }
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!isRecord(value) || !isRecord(value["environment"]) || !isRecord(value["token"])) {
    return false;
  }
  const environment = value["environment"];
  const token = value["token"];
  const cryptoState = value["crypto"];
  return (
    isNonEmptyString(environment["apiUrl"]) &&
    isNonEmptyString(environment["identityUrl"]) &&
    isNullableString(environment["iconsUrl"]) &&
    isNullableString(environment["webVaultUrl"]) &&
    isNullableString(environment["sendUrl"]) &&
    isNonEmptyString(token["accessToken"]) &&
    isNonEmptyString(token["refreshToken"]) &&
    isNonEmptyString(token["tokenType"]) &&
    typeof token["expiresIn"] === "number" &&
    Number.isFinite(token["expiresIn"]) &&
    (token["clientId"] == null || isBitwardenClientId(token["clientId"])) &&
    (token["obtainedAtEpochMs"] == null ||
      (typeof token["obtainedAtEpochMs"] === "number" &&
        Number.isFinite(token["obtainedAtEpochMs"]))) &&
    (cryptoState == null ||
      (isRecord(cryptoState) && isNonEmptyString(cryptoState["userKeyB64"])))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
