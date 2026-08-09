import { Inject, Injectable, InjectionToken } from "@angular/core";

import type { AutoFillAgentRegistrationStatus } from "../../host/tauri-host.service";
import { PopupStateStore } from "../popup-state";

export type AutoFillSetupState = "disabled" | "ready" | "requiresApproval" | "unavailable";

export interface AutoFillSetupHost {
  autofillAgentRegistrationStatus(): Promise<AutoFillAgentRegistrationStatus>;
  autofillAgentRegister(): Promise<AutoFillAgentRegistrationStatus>;
  autofillAgentUnregister(): Promise<AutoFillAgentRegistrationStatus>;
  autofillAgentProbe(): Promise<unknown>;
  autofillAgentLock(): Promise<unknown>;
  autofillClearProjection(accountId: string): Promise<void>;
}

export interface AutoFillSetupStorage {
  readEnabled(): boolean;
  writeEnabled(enabled: boolean): void;
}

const AUTOFILL_ENABLED_KEY = "barwarden.autofill.enabled.v1";

export const AUTOFILL_SETUP_HOST = new InjectionToken<AutoFillSetupHost>("AUTOFILL_SETUP_HOST");
export const AUTOFILL_SETUP_STORAGE = new InjectionToken<AutoFillSetupStorage>(
  "AUTOFILL_SETUP_STORAGE",
  {
    providedIn: "root",
    factory: () => ({
      readEnabled: () => globalThis.localStorage?.getItem(AUTOFILL_ENABLED_KEY) === "true",
      writeEnabled: (enabled) => {
        if (enabled) globalThis.localStorage?.setItem(AUTOFILL_ENABLED_KEY, "true");
        else globalThis.localStorage?.removeItem(AUTOFILL_ENABLED_KEY);
      },
    }),
  },
);

@Injectable()
export class AutoFillSetupService {
  private state: AutoFillSetupState = "disabled";
  private operation: Promise<AutoFillSetupState> | null = null;
  private disabling = false;

  constructor(
    @Inject(AUTOFILL_SETUP_HOST) private readonly host: AutoFillSetupHost,
    @Inject(AUTOFILL_SETUP_STORAGE) private readonly storage: AutoFillSetupStorage,
    private readonly store: PopupStateStore,
  ) {}

  blockReason(): AutoFillSetupState {
    return this.state;
  }

  enableFromEntry(): Promise<AutoFillSetupState> {
    this.storage.writeEnabled(true);
    return this.reconcile();
  }

  recoverAtStartup(): Promise<AutoFillSetupState> {
    if (!this.storage.readEnabled()) {
      this.state = "disabled";
      return Promise.resolve(this.state);
    }
    return this.reconcile();
  }

  async disable(): Promise<void> {
    this.storage.writeEnabled(false);
    this.disabling = true;
    this.state = "disabled";
    if (this.operation) await this.operation.catch(() => undefined);
    const accountId = this.store.snapshot().vaultOwnerAccountId;
    const operations: Array<() => Promise<unknown>> = [
      () => this.host.autofillAgentLock(),
      ...(accountId ? [() => this.host.autofillClearProjection(accountId)] : []),
      () => this.host.autofillAgentUnregister(),
    ];
    let firstFailure: unknown;
    for (const operation of operations) {
      try {
        await operation();
      } catch (error) {
        firstFailure ??= error;
      }
    }
    this.disabling = false;
    this.state = "disabled";
    if (firstFailure) throw firstFailure;
  }

  private reconcile(): Promise<AutoFillSetupState> {
    if (this.operation) return this.operation;
    this.operation = this.performReconcile().finally(() => { this.operation = null; });
    return this.operation;
  }

  private async performReconcile(): Promise<AutoFillSetupState> {
    try {
      let registration = await this.host.autofillAgentRegistrationStatus();
      if (registration === "requiresApproval") {
        return this.setState("requiresApproval");
      }
      if (registration !== "enabled") {
        registration = await this.host.autofillAgentRegister();
      }
      if (registration === "requiresApproval") {
        return this.setState("requiresApproval");
      }
      if (registration !== "enabled") {
        return this.setState("unavailable");
      }
      const probe = await this.host.autofillAgentProbe();
      if (!isSuccessfulProbe(probe)) return this.setState("unavailable");
      return this.setState("ready");
    } catch {
      return this.setState("unavailable");
    }
  }

  private setState(state: AutoFillSetupState): AutoFillSetupState {
    this.state = this.disabling ? "disabled" : state;
    return this.state;
  }
}

function isSuccessfulProbe(value: unknown): boolean {
  return typeof value === "object" && value !== null && "status" in value
    && (value as { status?: unknown }).status === "success";
}
