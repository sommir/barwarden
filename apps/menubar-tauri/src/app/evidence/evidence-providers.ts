import type { Provider } from "@angular/core";
import { of } from "rxjs";

import { ACCOUNT_SESSION_PORT } from "../../auth/account-session-port";
import { PASSWORD_LOGIN_PORT } from "../auth/auth.facade";
import { BitwardenApiError } from "../../bitwarden-api/bitwarden-api";
import {
  AUTH_EVIDENCE_STATE,
  type AuthEvidenceState,
  resolveAuthEvidenceState,
} from "../auth/auth-evidence-state";
import { OfficialChallengeAdapter } from "../auth/official-challenge.adapter";
import {
  createG3EvidenceAccountPort,
  createG3EvidenceGeneratorEngine,
  createG3EvidenceVaultActionHost,
  createG3EvidenceVaultCipherActionPort,
  createG3EvidenceVaultSessionService,
} from "../g3-evidence-account";
import { OFFICIAL_GENERATOR_ENGINE } from "../generator/generator.service";
import { GENERATOR_HISTORY_STORE } from "../generator/generator.service";
import { GENERATOR_HISTORY_CLIPBOARD_HOST } from "../generator/official-generator-history-view.adapter";
import {
  GENERATOR_CLIPBOARD_HOST,
  GENERATOR_OPERATION_RECEIPT,
} from "../generator/generator-runtime.port";
import { GENERATOR_INITIAL_ALGORITHM } from "../generator/official-credential-generator-service.adapter";
import { Algorithm, type CredentialAlgorithm } from "@bitwarden/generator-core";
import {
  SEND_EVIDENCE_STATE,
  resolveSendEvidenceState,
} from "../send/send-evidence-state";
import { SEND_ACTION_PORT } from "../send/send-actions.service";
import { SEND_CREATED_HOST } from "../send/send-created-page.component";
import {
  createSendEvidenceActionPort,
  createSendEvidenceHost,
} from "../send/send-evidence-preview";
import {
  VAULT_MAIN_EVIDENCE_STATE,
  resolveVaultMainEvidenceState,
} from "../vault/vault-main-evidence-state";
import { VAULT_ACTION_HOST, VAULT_CIPHER_ACTION_PORT } from "../vault/vault-actions.service";
import { VaultSessionService } from "../vault/vault-session.service";
import { PopupStateStore } from "../popup-state";
import { VAULT_CIPHER_WRITE_PORT } from "../vault/vault-cipher-write.service";
import {
  createLoginWorkflowEvidenceHost,
  createLoginWorkflowEvidenceWritePort,
  isLoginWorkflowEvidenceState,
} from "./login-workflow-evidence";
import {
  createPersonalCipherWorkflowEvidenceHost,
  createPersonalCipherWorkflowEvidenceWritePort,
  isPersonalCipherEvidenceState,
} from "./personal-cipher-workflow-evidence";
import {
  createRecoveryWorkflowEvidenceProviders,
  isRecoveryEvidenceState,
} from "./recovery-workflow-evidence";
import {
  createGeneratorWorkflowEvidenceAccountPort,
  createGeneratorWorkflowEvidenceEngine,
  createGeneratorWorkflowEvidenceHistoryStore,
  createGeneratorWorkflowEvidenceOperationReceipt,
  resolveGeneratorWorkflowEvidenceScenario,
} from "./generator-workflow-evidence";
import { createAlternativeUnlockEvidenceProviders } from "./alternative-unlock-evidence";

export function createEvidenceProviders(
  search: string,
  evidenceEnabled = import.meta.env.VITE_BW_VAULT_EVIDENCE === "true",
): Provider[] {
  if (!evidenceEnabled) {
    return [];
  }

  const authState = resolveAuthEvidenceState(true, search);
  if (authState) {
    if (
      authState === "alternative-unlock"
      || authState === "alternative-unlock-startup"
    ) {
      return [
        { provide: AUTH_EVIDENCE_STATE, useValue: authState },
        ...createAlternativeUnlockEvidenceProviders(
          authState === "alternative-unlock-startup",
        ),
      ];
    }
    const providers: Provider[] = [
      { provide: ACCOUNT_SESSION_PORT, useFactory: createG3EvidenceAccountPort },
      { provide: AUTH_EVIDENCE_STATE, useValue: authState },
    ];
    if (authState === "lock-error") {
      providers.push({
        provide: PASSWORD_LOGIN_PORT,
        useValue: {
          login: async () => {
            throw new BitwardenApiError(400, {
              ErrorModel: { Message: "username or password is incorrect" },
            });
          },
        },
      });
    }
    if (isTwoFactorEvidence(authState)) {
      providers.push({
        provide: OfficialChallengeAdapter,
        useValue: createAuthEvidenceChallengeAdapter(authState),
      });
    }
    return providers;
  }

  const hasSendEvidence = new URLSearchParams(search).has("sendEvidence");
  if (hasSendEvidence) {
    const state = resolveSendEvidenceState(true, search);
    return state ? [
      { provide: SEND_EVIDENCE_STATE, useValue: state },
      { provide: SEND_ACTION_PORT, useFactory: () => createSendEvidenceActionPort(state) },
      { provide: SEND_CREATED_HOST, useFactory: createSendEvidenceHost },
    ] : [];
  }

  const generatorInitialAlgorithm = resolveGeneratorInitialAlgorithm(search);
  const generatorWorkflowScenario = resolveGeneratorWorkflowEvidenceScenario(search);
  const normalizedSearch = normalizeVaultEvidenceSearch(stripGeneratorEvidence(search));
  const recoveryStartup = resolveRecoveryStartup(normalizedSearch);
  const state = recoveryStartup?.state ?? resolveVaultMainEvidenceState(true, normalizedSearch);
  if (!state) {
    return [];
  }

  const workflowProviders: Provider[] = isLoginWorkflowEvidenceState(state)
    ? [
        {
          provide: VAULT_CIPHER_WRITE_PORT,
          deps: [PopupStateStore],
          useFactory: (store: PopupStateStore) => createLoginWorkflowEvidenceWritePort(state, store),
        },
      ]
    : isPersonalCipherEvidenceState(state)
      ? [
          {
            provide: VAULT_CIPHER_WRITE_PORT,
            deps: [PopupStateStore],
            useFactory: (store: PopupStateStore) =>
              createPersonalCipherWorkflowEvidenceWritePort(state, store),
          },
        ]
      : [];

  const recoveryProviders = isRecoveryEvidenceState(state)
    ? createRecoveryWorkflowEvidenceProviders(state)
    : [];

  return [
    {
      provide: ACCOUNT_SESSION_PORT,
      deps: [PopupStateStore],
      useFactory: (store: PopupStateStore) => generatorWorkflowScenario?.startsWith("generation-")
        || generatorWorkflowScenario === "history-same-id-stale"
        ? createGeneratorWorkflowEvidenceAccountPort(generatorWorkflowScenario, store)
        : createG3EvidenceAccountPort(),
    },
    {
      provide: OFFICIAL_GENERATOR_ENGINE,
      useFactory: () => generatorWorkflowScenario?.startsWith("generation-")
        || generatorWorkflowScenario === "form-generation-failure"
        ? createGeneratorWorkflowEvidenceEngine(generatorWorkflowScenario)
        : createG3EvidenceGeneratorEngine(),
    },
    ...(generatorWorkflowScenario?.startsWith("generation-")
      || generatorWorkflowScenario === "form-generation-failure" ? [{
        provide: GENERATOR_OPERATION_RECEIPT,
        useFactory: createGeneratorWorkflowEvidenceOperationReceipt,
      }] : []),
    ...(generatorInitialAlgorithm === null ? [] : [{
      provide: GENERATOR_INITIAL_ALGORITHM,
      useValue: generatorInitialAlgorithm,
    }]),
    { provide: GENERATOR_CLIPBOARD_HOST, useFactory: createG3EvidenceVaultActionHost },
    { provide: GENERATOR_HISTORY_CLIPBOARD_HOST, useFactory: createG3EvidenceVaultActionHost },
    ...(generatorWorkflowScenario === null ? [] : [{
      provide: GENERATOR_HISTORY_STORE,
      useFactory: () => createGeneratorWorkflowEvidenceHistoryStore(generatorWorkflowScenario),
    }]),
    ...(!isRecoveryEvidenceState(state) ? [{
      provide: VaultSessionService,
      useFactory: () => createG3EvidenceVaultSessionService(state === "populated"),
    }] : []),
    {
      provide: VAULT_ACTION_HOST,
      useFactory: () => isLoginWorkflowEvidenceState(state)
        ? createLoginWorkflowEvidenceHost(state)
        : isPersonalCipherEvidenceState(state)
          ? createPersonalCipherWorkflowEvidenceHost(state)
          : createG3EvidenceVaultActionHost(),
    },
    ...(!isRecoveryEvidenceState(state) ? [{
      provide: VAULT_CIPHER_ACTION_PORT,
      useFactory: createG3EvidenceVaultCipherActionPort,
    }] : []),
    { provide: VAULT_MAIN_EVIDENCE_STATE, useValue: recoveryStartup ? null : state },
    ...workflowProviders,
    ...recoveryProviders,
  ];
}

function stripGeneratorEvidence(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("generatorMode");
  params.delete("generatorEvidence");
  const value = params.toString();
  return value.length === 0 ? "" : `?${value}`;
}

function normalizeVaultEvidenceSearch(search: string): string {
  const params = new URLSearchParams(search);
  const uiLocation = params.getAll("uilocation");
  if (uiLocation.length === 1 && uiLocation[0] === "popout") {
    params.delete("uilocation");
  }
  const value = params.toString();
  return value.length === 0 ? "" : `?${value}`;
}

function resolveGeneratorInitialAlgorithm(search: string): CredentialAlgorithm | null {
  const values = new URLSearchParams(search).getAll("generatorMode");
  if (values.length === 0) return null;
  if (values.length !== 1) throw new Error("Invalid generator evidence mode");
  switch (values[0]) {
    case "username": return Algorithm.username;
    case "plus-address": return Algorithm.plusAddress;
    case "catchall": return Algorithm.catchall;
    default: throw new Error("Invalid generator evidence mode");
  }
}

function resolveRecoveryStartup(search: string): { readonly state: VaultMainEvidenceState } | null {
  const params = new URLSearchParams(search);
  if (
    params.size !== 2 ||
    params.getAll("recoveryStartup").length !== 1 ||
    params.get("recoveryStartup") !== "1" ||
    params.getAll("vaultEvidence").length !== 1
  ) {
    return null;
  }

  const value = params.get("vaultEvidence");
  const state = value
    ? resolveVaultMainEvidenceState(true, `?vaultEvidence=${encodeURIComponent(value)}`)
    : null;
  return state && isRecoveryEvidenceState(state) ? { state } : null;
}

function isTwoFactorEvidence(state: AuthEvidenceState): boolean {
  return ["authenticator", "email-two-factor", "offline", "error"].includes(state);
}

function createAuthEvidenceChallengeAdapter(state: AuthEvidenceState) {
  const providers = state === "email-two-factor" ? [1, 0] as const : [0, 1] as const;
  return {
    providers$: of(providers),
    expiresAt$: of(null),
    refresh: () => undefined,
    submit: async () => {
      throw new Error("Synthetic challenge submission rejected");
    },
    sendEmail: async () => undefined,
    cancel: () => undefined,
  };
}
