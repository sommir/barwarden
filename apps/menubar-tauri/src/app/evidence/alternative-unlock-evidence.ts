import { APP_INITIALIZER, type Provider } from "@angular/core";
import { Router } from "@angular/router";

import type {
  AccountAuthenticationStatus,
  StoredAccount,
} from "../../auth/account-session-store";
import {
  ACCOUNT_SESSION_PORT,
  type AccountSessionPort,
} from "../../auth/account-session-port";
import {
  BIOMETRIC_HOST_PORT,
  UnlockMethodsService,
} from "../auth/unlock-methods.service";
import { AuthFacade } from "../auth/auth.facade";
import { VAULT_SYNC_PORT, type VaultSyncPort } from "../auth/vault-sync.shared";
import type {
  BiometricHost,
  BiometricOperationStatus,
} from "../../host/biometric-host";
import { PopupStateStore } from "../popup-state";
import { VaultRepromptService } from "../vault/vault-reprompt.service";
import { ALTERNATIVE_UNLOCK_SESSION } from "./alternative-unlock-evidence-session";

export const ALTERNATIVE_UNLOCK_ACCOUNT_A = "a".repeat(64);
export const ALTERNATIVE_UNLOCK_ACCOUNT_B = "b".repeat(64);

const credentialKey = (accountId: string) =>
  `bw-alternative-unlock-evidence:credential:${accountId}`;
const biometricOutcomeKey = "bw-alternative-unlock-evidence:outcome";

type BiometricOutcome = "success" | "cancelled" | "invalidated";

class AlternativeUnlockAccountPort implements AccountSessionPort {
  readonly sessionReads = { value: 0 };
  private accounts: StoredAccount[] = [
    {
      id: ALTERNATIVE_UNLOCK_ACCOUNT_A,
      email: "account-a@example.test",
      serverUrl: "https://vault.example.test",
      status: "unlocked",
      isActive: true,
    },
    {
      id: ALTERNATIVE_UNLOCK_ACCOUNT_B,
      email: "account-b@example.test",
      serverUrl: "https://vault.example.test",
      status: "locked",
      isActive: false,
    },
  ];

  async list(): Promise<readonly StoredAccount[]> {
    return this.accounts.map((account) => ({ ...account }));
  }

  async saveAccount(): Promise<StoredAccount> {
    throw new Error("Alternative unlock evidence does not save accounts.");
  }

  async setActive(id: string): Promise<StoredAccount> {
    const selected = this.accounts.find((account) => account.id === id);
    if (!selected) {
      throw new Error("Alternative unlock evidence account is unavailable.");
    }
    this.accounts = this.accounts.map((account) => ({
      ...account,
      isActive: account.id === id,
    }));
    return { ...selected, isActive: true };
  }

  async setStatus(
    id: string,
    status: AccountAuthenticationStatus,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!isCurrent()) {
      return;
    }
    this.accounts = this.accounts.map((account) =>
      account.id === id ? { ...account, status } : account
    );
  }

  async readSession(id: string): Promise<AuthSession | null> {
    this.sessionReads.value += 1;
    return this.accounts.some((account) => account.id === id)
      ? ALTERNATIVE_UNLOCK_SESSION
      : null;
  }

  async replaceSession(
    id: string,
    _session: AuthSession,
    isCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    return isCurrent() && this.accounts.some((account) => account.id === id);
  }

  async remove(id: string): Promise<StoredAccount | null> {
    const removed = this.accounts.find((account) => account.id === id) ?? null;
    this.accounts = this.accounts.filter((account) => account.id !== id);
    return removed;
  }

  async lockAll(): Promise<void> {
    this.accounts = this.accounts.map((account) => ({
      ...account,
      status: "locked",
    }));
  }
}

class AlternativeUnlockBiometricHost implements BiometricHost {
  unlocks = 0;

  async biometricStatus(): Promise<"available"> {
    return "available";
  }

  async biometricEnable(accountId: string): Promise<BiometricOperationStatus> {
    localStorage.setItem(credentialKey(accountId), "enabled");
    return "enabled";
  }

  async biometricUnlock(accountId: string): Promise<BiometricOperationStatus> {
    this.unlocks += 1;
    if (localStorage.getItem(credentialKey(accountId)) !== "enabled") {
      return "invalidated";
    }
    const outcome = biometricOutcome();
    if (outcome === "invalidated") {
      localStorage.removeItem(credentialKey(accountId));
    }
    return outcome;
  }

  async biometricDisable(accountId: string): Promise<BiometricOperationStatus> {
    localStorage.removeItem(credentialKey(accountId));
    return "disabled";
  }
}

class AlternativeUnlockSyncPort implements VaultSyncPort {
  syncs = 0;

  async sync() {
    this.syncs += 1;
    return {
      items: [],
      archivedItems: [],
      deletedItems: [],
      folders: [],
      organizations: [],
      collections: [],
      sends: [],
      sendPolicy: { disabled: false, hideEmailAllowed: true },
      cipherCount: 0,
      encryptedCipherCount: 0,
      folderCount: 0,
      sendCount: 0,
    };
  }
}

export function createAlternativeUnlockEvidenceProviders(
  startupLocked: boolean,
): Provider[] {
  const accountPort = new AlternativeUnlockAccountPort();
  const biometricHost = new AlternativeUnlockBiometricHost();
  const syncPort = new AlternativeUnlockSyncPort();

  return [
    { provide: ACCOUNT_SESSION_PORT, useValue: accountPort },
    { provide: BIOMETRIC_HOST_PORT, useValue: biometricHost },
    { provide: VAULT_SYNC_PORT, useValue: syncPort },
    {
      provide: VaultRepromptService,
      deps: [PopupStateStore],
      useFactory: (store: PopupStateStore) => ({
        verify: async (masterPassword: string, operationEpoch: number) =>
          masterPassword.length > 0
          && store.isCurrentProtectedOperation(operationEpoch)
          && store.snapshot().isUnlocked,
      }),
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [AuthFacade, Router, PopupStateStore, UnlockMethodsService],
      useFactory: (
        auth: AuthFacade,
        router: Router,
        store: PopupStateStore,
        unlockMethods: UnlockMethodsService,
      ) => async () => {
        await auth.restoreStartup();
        if (!startupLocked) {
          await accountPort.setStatus(ALTERNATIVE_UNLOCK_ACCOUNT_A, "unlocked");
        }
        installEvidenceControl(
          auth,
          router,
          store,
          unlockMethods,
          accountPort,
          biometricHost,
          syncPort,
        );
      },
    },
  ];
}

function installEvidenceControl(
  auth: AuthFacade,
  router: Router,
  store: PopupStateStore,
  unlockMethods: UnlockMethodsService,
  accountPort: AlternativeUnlockAccountPort,
  biometricHost: AlternativeUnlockBiometricHost,
  syncPort: AlternativeUnlockSyncPort,
): void {
  globalThis.__bwAlternativeUnlockEvidence = {
    lock: async () => {
      auth.lock();
      await router.navigateByUrl("/lock");
    },
    switchToAccountB: async () => {
      await auth.switchAccount(ALTERNATIVE_UNLOCK_ACCOUNT_B);
      await router.navigateByUrl("/lock");
    },
    setBiometricOutcome: (outcome) => {
      sessionStorage.setItem(biometricOutcomeKey, outcome);
    },
    snapshot: async () => {
      const account = (await auth.accounts()).find(({ isActive }) => isActive);
      const availability = account
        ? await unlockMethods.availability(account.id)
        : {
            pinEnabled: false,
            biometricEnabled: false,
          };
      return {
        pinEnabled: availability.pinEnabled,
        biometricEnabled: availability.biometricEnabled,
        biometricUnlocks: biometricHost.unlocks,
        sessionReads: accountPort.sessionReads.value,
        syncs: syncPort.syncs,
        isUnlocked: store.snapshot().isUnlocked,
      };
    },
  };
}

function biometricOutcome(): BiometricOutcome {
  const outcome = sessionStorage.getItem(biometricOutcomeKey);
  return outcome === "cancelled" || outcome === "invalidated"
    ? outcome
    : "success";
}

declare global {
  var __bwAlternativeUnlockEvidence:
    | {
        lock(): Promise<void>;
        switchToAccountB(): Promise<void>;
        setBiometricOutcome(outcome: BiometricOutcome): void;
        snapshot(): Promise<{
          pinEnabled: boolean;
          biometricEnabled: boolean;
          biometricUnlocks: number;
          sessionReads: number;
          syncs: number;
          isUnlocked: boolean;
        }>;
      }
    | undefined;
}
