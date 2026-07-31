import type { StoredAccount } from "../../auth/account-session-store";
import type { AccountSessionPort } from "../../auth/account-session-port";
import type { PopupStateStore } from "../popup-state";
import type {
  GeneratedCredential,
  GeneratorHistoryStore,
  PendingGeneratorHistoryClear,
  PendingGeneratorHistoryTrack,
} from "../generator/generator-history.store";
import type { GeneratorOperationReceiptPort } from "../generator/generator-runtime.port";

export const generatorWorkflowEvidenceScenarios = [
  "history-loading",
  "history-load-retry",
  "history-copy-retry",
  "history-clear-retry",
  "history-same-id-stale",
  "generation-account-switch",
  "generation-lock",
  "generation-same-id",
  "generation-route-teardown",
  "generation-duplicate",
  "form-generation-failure",
] as const;

export type GeneratorWorkflowEvidenceScenario = (typeof generatorWorkflowEvidenceScenarios)[number];

const initialHistory: readonly GeneratedCredential[] = [
  {
    credential: "orbit-lantern-copper-signal",
    category: "password",
    generationDate: new Date("2026-07-19T02:00:00.000Z"),
    algorithm: "passphrase",
  },
  {
    credential: "Mango-River-47!",
    category: "password",
    generationDate: new Date("2026-07-19T02:00:00.000Z"),
    algorithm: "password",
  },
];

export function resolveGeneratorWorkflowEvidenceScenario(search: string): GeneratorWorkflowEvidenceScenario | null {
  const values = new URLSearchParams(search).getAll("generatorEvidence");
  if (values.length === 0) return null;
  if (values.length !== 1 || !(generatorWorkflowEvidenceScenarios as readonly string[]).includes(values[0]!)) {
    throw new Error("Invalid generator workflow evidence scenario");
  }
  return values[0] as GeneratorWorkflowEvidenceScenario;
}

export function createGeneratorWorkflowEvidenceHistoryStore(
  scenario: GeneratorWorkflowEvidenceScenario,
): GeneratorHistoryStore {
  return new GeneratorWorkflowEvidenceHistoryStore(scenario) as unknown as GeneratorHistoryStore;
}

export function createGeneratorWorkflowEvidenceAccountPort(
  scenario: GeneratorWorkflowEvidenceScenario,
  state?: Pick<PopupStateStore, "snapshot" | "setActiveSession">,
): AccountSessionPort {
  let active: StoredAccount = evidenceAccount("evidence-account", "unlocked", true);
  let secondary: StoredAccount = evidenceAccount("evidence-account-next", "unlocked", false);
  const onTransition = (event: Event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
    if (scenario === "generation-account-switch" && event.detail === "account-switch") {
      active = { ...active, isActive: false };
      secondary = { ...secondary, isActive: true };
    }
    if (scenario === "generation-lock" && event.detail === "lock") {
      active = { ...active, status: "locked" };
    }
    if (event.detail === "same-id-session") {
      const session = state?.snapshot().activeSession;
      if (session) state?.setActiveSession({ ...session, token: { ...session.token } });
    }
  };
  globalThis.document?.addEventListener("bw-generator-lifecycle-account", onTransition);
  return {
    list: async () => [active, secondary],
    saveAccount: async () => active,
    setActive: async () => active,
    setStatus: async () => undefined,
    readSession: async () => null,
    replaceSession: async () => false,
    remove: async () => null,
    lockAll: async () => undefined,
  };
}

export function createGeneratorWorkflowEvidenceEngine(
  scenario: GeneratorWorkflowEvidenceScenario,
) {
  let attempts = 0;
  const pending: Array<{ readonly attempt: number; readonly resolve: (value: string) => void }> = [];
  globalThis.document?.addEventListener("bw-generator-lifecycle-release", (event) => {
    if (!(event instanceof CustomEvent)) return;
    const index = event.detail === "newest" ? pending.length - 1 : 0;
    const [released] = pending.splice(index, 1);
    if (!released) return;
    released.resolve(generationValue(scenario, released.attempt));
  });

  const generate = async (): Promise<string> => {
    attempts += 1;
    if (globalThis.document) {
      globalThis.document.documentElement.dataset.bwEvidenceGeneratorEngineAttempts = String(attempts);
    }
    if (scenario === "form-generation-failure") {
      if (attempts === 1) throw new Error("Synthetic generator form failure");
      return "evidence-lifecycle-form-retry";
    }
    if (shouldDeferGeneration(scenario, attempts)) {
      return new Promise<string>((resolve) => {
        pending.push({ attempt: attempts, resolve });
      });
    }
    return generationValue(scenario, attempts);
  };

  return {
    generatePassword: generate,
    generatePassphrase: generate,
    generateUsername: generate,
  };
}

export function createGeneratorWorkflowEvidenceOperationReceipt(): GeneratorOperationReceiptPort {
  let pending = 0;
  const update = () => {
    const root = globalThis.document?.documentElement;
    if (!root) return;
    if (pending === 0) delete root.dataset.bwEvidenceGeneratorPending;
    else root.dataset.bwEvidenceGeneratorPending = String(pending);
  };
  return {
    begin: () => {
      pending += 1;
      update();
      let completed = false;
      return () => {
        if (completed) return;
        completed = true;
        pending -= 1;
        update();
      };
    },
  };
}

class GeneratorWorkflowEvidenceHistoryStore {
  private credentialsValue = [...initialHistory];
  private loadAttempts = 0;
  private clearAttempts = 0;

  constructor(private readonly scenario: GeneratorWorkflowEvidenceScenario) {}

  async credentials(_accountId: string): Promise<readonly GeneratedCredential[]> {
    if (this.scenario === "history-loading") {
      await new Promise<void>((resolve) => globalThis.addEventListener(
        "bw-generator-evidence-release",
        () => resolve(),
        { once: true },
      ));
    }
    if (this.scenario === "history-load-retry" && this.loadAttempts++ === 0) {
      throw new Error("Synthetic generator evidence load failure");
    }
    return this.credentialsValue;
  }

  async prepareTrack(
    _accountId: string,
    credential: GeneratedCredential,
    isCurrent: () => Promise<boolean>,
  ): Promise<PendingGeneratorHistoryTrack> {
    if (!await isCurrent()) throw new Error("Synthetic generator evidence owner is stale");
    const duplicate = this.credentialsValue.some((entry) => entry.credential === credential.credential);
    return {
      commit: () => {
        if (!duplicate) {
          this.credentialsValue = [credential, ...this.credentialsValue];
          incrementReceipt("bwEvidenceGeneratorHistoryTracks");
        }
      },
      rollback: async () => undefined,
    };
  }

  async prepareClear(
    _accountId: string,
    _isCurrent: () => Promise<boolean>,
  ): Promise<PendingGeneratorHistoryClear> {
    if (this.scenario === "history-clear-retry" && this.clearAttempts++ === 0) {
      throw new Error("Synthetic generator evidence clear failure");
    }
    if (this.scenario === "history-same-id-stale") {
      const root = globalThis.document?.documentElement;
      if (root) root.dataset.bwEvidenceGeneratorClearPending = "true";
      await new Promise<void>((resolve) => globalThis.document?.addEventListener(
        "bw-generator-lifecycle-clear-release",
        () => resolve(),
        { once: true },
      ));
      if (root) delete root.dataset.bwEvidenceGeneratorClearPending;
    }
    const previous = this.credentialsValue;
    return {
      commit: () => { this.credentialsValue = []; },
      rollback: async () => { this.credentialsValue = previous; },
    };
  }
}

function evidenceAccount(
  id: string,
  status: "unlocked" | "locked",
  isActive: boolean,
): StoredAccount {
  return {
    id,
    email: `${id}@example.test`,
    serverUrl: "https://vault.example.test",
    status,
    isActive,
  };
}

function shouldDeferGeneration(
  scenario: GeneratorWorkflowEvidenceScenario,
  attempt: number,
): boolean {
  const formRoute = globalThis.location?.hash.startsWith("#/add-cipher")
    || globalThis.location?.hash.startsWith("#/edit-cipher")
    || globalThis.location?.hash.startsWith("#/clone-cipher");
  if (formRoute && scenario.startsWith("generation-")) return attempt === 1;
  if (scenario === "generation-duplicate") return attempt === 2 || attempt === 3;
  return (
    scenario === "generation-account-switch"
    || scenario === "generation-lock"
    || scenario === "generation-same-id"
    || scenario === "generation-route-teardown"
  ) && attempt === 2;
}

function generationValue(
  scenario: GeneratorWorkflowEvidenceScenario,
  attempt: number,
): string {
  if (scenario === "generation-duplicate") {
    if (attempt === 2) return "evidence-lifecycle-stale";
    if (attempt === 3) return "evidence-lifecycle-latest";
  }
  if (scenario === "generation-route-teardown" && attempt >= 3) {
    return "evidence-lifecycle-current-route";
  }
  return "evidence-lifecycle-initial";
}

function incrementReceipt(key: string): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.dataset[key] = String(Number(root.dataset[key] ?? "0") + 1);
}
