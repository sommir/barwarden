import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";

import type { AutoFillAgentRegistrationStatus } from "../../host/tauri-host.service";
import { PopupStateStore } from "../popup-state";
import { AutoFillAccessibilityService } from "./autofill-accessibility.service";
import { AutoFillProjectionService } from "./autofill-projection.service";

export type AutoFillSetupState =
  | "disabled"
  | "ready"
  | "requiresApproval"
  | "requiresAccessibility"
  | "unavailable";

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
  readCleanupTarget(): AutoFillCleanupTarget | null;
  writeCleanupTarget(target: AutoFillCleanupTarget | null): void;
}

export interface AutoFillCleanupTarget {
  readonly accountId: string | null;
}

const AUTOFILL_ENABLED_KEY = "barwarden.autofill.enabled.v1";
const AUTOFILL_CLEANUP_PENDING_KEY = "barwarden.autofill.cleanup-pending.v1";

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
      readCleanupTarget: () => readCleanupTarget(
        globalThis.localStorage?.getItem(AUTOFILL_CLEANUP_PENDING_KEY) ?? null,
      ),
      writeCleanupTarget: (target) => {
        if (target) {
          globalThis.localStorage?.setItem(AUTOFILL_CLEANUP_PENDING_KEY, JSON.stringify(target));
        }
        else globalThis.localStorage?.removeItem(AUTOFILL_CLEANUP_PENDING_KEY);
      },
    }),
  },
);

@Injectable()
export class AutoFillSetupService {
  private state: AutoFillSetupState = "disabled";
  private operationTail: Promise<void> = Promise.resolve();
  private disabling = false;
  private pendingEnabledCleanupTarget: AutoFillCleanupTarget | null = null;

  constructor(
    @Inject(AUTOFILL_SETUP_HOST) private readonly host: AutoFillSetupHost,
    @Inject(AUTOFILL_SETUP_STORAGE) private readonly storage: AutoFillSetupStorage,
    private readonly store: PopupStateStore,
    private readonly projection: AutoFillProjectionService,
    @Optional() private readonly accessibility: AutoFillAccessibilityService | null = null,
  ) {}

  blockReason(): AutoFillSetupState {
    return this.state;
  }

  async enableFromEntry(): Promise<AutoFillSetupState> {
    this.storage.writeEnabled(true);
    return this.enqueueOperation(async () => {
      const cleanupTarget = this.storage.readCleanupTarget();
      if (cleanupTarget && !await this.finishPendingCleanup(cleanupTarget)) {
        return this.setState("unavailable");
      }
      const state = await this.performReconcile();
      if (state !== "ready") return state;
      try {
        await this.projection.reprojectCurrent();
        if (!this.finalizeEnabledCleanupAfterProjection()) {
          return this.setState("unavailable");
        }
        await this.activateFocusedFieldDetection(true);
        return this.setState("ready");
      } catch {
        return this.setState("unavailable");
      }
    });
  }

  async recoverAtStartup(): Promise<AutoFillSetupState> {
    return this.enqueueOperation(async () => {
      const cleanupTarget = this.storage.readCleanupTarget();
      if (cleanupTarget && !await this.finishPendingCleanup(cleanupTarget)) {
        return this.setState("unavailable");
      }
      if (!this.storage.readEnabled()) {
        this.state = "disabled";
        return this.state;
      }
      const state = await this.performReconcile();
      if (state !== "ready") return state;
      if (this.pendingEnabledCleanupTarget && this.store.snapshot().isUnlocked) {
        try {
          await this.projection.reprojectCurrent();
          this.finalizeEnabledCleanupAfterProjection();
        } catch {
          // Focused-field detection remains useful while the broker finishes
          // publishing unlocked authority. The explicit picker entry retries.
        }
      }
      await this.activateFocusedFieldDetection(false);
      return this.setState("ready");
    });
  }

  async disable(): Promise<void> {
    this.storage.writeEnabled(false);
    this.disabling = true;
    this.state = "disabled";
    const cleanupTarget: AutoFillCleanupTarget = {
      accountId: this.store.snapshot().vaultOwnerAccountId,
    };
    try {
      this.storage.writeCleanupTarget(cleanupTarget);
    } catch {
      this.disabling = false;
      throw new Error("AUTOFILL_CLEANUP_PENDING");
    }
    try {
      await this.enqueueOperation(async () => {
        const complete = await this.performCleanup(cleanupTarget);
        if (!complete) throw new Error("AUTOFILL_CLEANUP_PENDING");
        try {
          this.storage.writeCleanupTarget(null);
        } catch {
          throw new Error("AUTOFILL_CLEANUP_PENDING");
        }
      });
    } finally {
      this.disabling = false;
      this.state = "disabled";
    }
  }

  private async finishPendingCleanup(target: AutoFillCleanupTarget): Promise<boolean> {
    if (this.storage.readEnabled()) {
      if (target.accountId === null) return false;
      const cleanupAgentReady = await this.restoreAgentForPendingCleanup();
      if (!cleanupAgentReady || !await this.performEnabledCleanup(target)) return false;
      this.pendingEnabledCleanupTarget = target;
      return true;
    }
    let complete = await this.performCleanup(target);
    if (!complete) {
      if (target.accountId === null) return false;
      const cleanupAgentReady = await this.restoreAgentForPendingCleanup();
      if (!cleanupAgentReady) return false;
      complete = await this.performCleanup(target);
    }
    if (!complete) return false;
    try {
      this.storage.writeCleanupTarget(null);
      return true;
    } catch {
      return false;
    }
  }

  private async performCleanup(target: AutoFillCleanupTarget): Promise<boolean> {
    return this.performCleanupOperations(target, true);
  }

  private async performEnabledCleanup(target: AutoFillCleanupTarget): Promise<boolean> {
    if (!target.accountId) return false;
    try {
      await this.projection.resetForReprojection();
    } catch {
      return false;
    }
    if (this.accessibility) {
      try {
        await this.accessibility.stopForSystemAutoFill();
      } catch {
        // The explicit picker and system Credential Provider do not depend on
        // the optional focused-field floating action. Keep core AutoFill
        // available while its permission/status UI remains independently
        // repairable.
      }
    }
    return true;
  }

  private finalizeEnabledCleanupAfterProjection(): boolean {
    if (!this.pendingEnabledCleanupTarget) return true;
    try {
      this.storage.writeCleanupTarget(null);
      this.pendingEnabledCleanupTarget = null;
      return true;
    } catch {
      return false;
    }
  }

  private async performCleanupOperations(
    target: AutoFillCleanupTarget,
    unregister: boolean,
  ): Promise<boolean> {
    const accountId = target.accountId;
    const operations: Array<() => Promise<unknown>> = [
      ...(
        this.accessibility
          ? [() => this.accessibility!.stopForSystemAutoFill()]
          : []
      ),
      () => this.host.autofillAgentLock(),
      ...(accountId ? [() => this.host.autofillClearProjection(accountId)] : []),
      ...(unregister ? [() => this.host.autofillAgentUnregister()] : []),
    ];
    let failed = accountId === null;
    for (const operation of operations) {
      try {
        await operation();
      } catch {
        failed = true;
      }
    }
    return !failed;
  }

  private async restoreAgentForPendingCleanup(): Promise<boolean> {
    let registration: AutoFillAgentRegistrationStatus | null = null;
    try {
      registration = await this.host.autofillAgentRegistrationStatus();
    } catch {
      // A live authenticated probe below is authoritative when Service
      // Management is briefly unavailable after an interrupted update.
    }
    if (registration === "requiresApproval") return false;
    if (registration !== "enabled") {
      try {
        registration = await this.host.autofillAgentRegister();
      } catch {
        registration = null;
      }
    }
    if (registration === "requiresApproval") return false;
    try {
      return isSuccessfulProbe(await this.host.autofillAgentProbe());
    } catch {
      return false;
    }
  }

  private enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operationTail.then(operation);
    this.operationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async activateFocusedFieldDetection(promptFromUserAction: boolean): Promise<boolean> {
    if (!this.accessibility) return true;
    try {
      let status = await this.accessibility.status();
      if (status.permission !== "granted" && promptFromUserAction) {
        status = await this.accessibility.requestPermissionFromUserAction();
      }
      if (
        status.permission !== "granted"
        || this.disabling
        || !this.storage.readEnabled()
      ) {
        return false;
      }
      await this.accessibility.startUnsupportedFallback();
      return true;
    } catch {
      return false;
    }
  }

  private async performReconcile(): Promise<AutoFillSetupState> {
    if (this.disabling || !this.storage.readEnabled()) return this.setState("disabled");
    let registration: AutoFillAgentRegistrationStatus | null = null;
    try {
      registration = await this.host.autofillAgentRegistrationStatus();
    } catch {
      // An authenticated live Agent probe below remains authoritative when
      // Service Management is briefly unavailable during update/relaunch.
    }
    if (registration === "requiresApproval") {
      return this.setState("requiresApproval");
    }
    if (registration !== "enabled") {
      try {
        registration = await this.host.autofillAgentRegister();
      } catch {
        registration = null;
      }
    }
    if (registration === "requiresApproval") {
      return this.setState("requiresApproval");
    }
    if (await this.probeAgent()) return this.setState("ready");
    if (registration === "enabled" && await this.replaceStaleAgentRegistration()) {
      return this.setState("ready");
    }
    return this.setState("unavailable");
  }

  private async probeAgent(): Promise<boolean> {
    try {
      return isSuccessfulProbe(await this.host.autofillAgentProbe());
    } catch {
      return false;
    }
  }

  private async replaceStaleAgentRegistration(): Promise<boolean> {
    try {
      const unregistered = await this.host.autofillAgentUnregister();
      if (unregistered === "requiresApproval") return false;
      const registered = await this.host.autofillAgentRegister();
      if (registered === "requiresApproval") return false;
      return this.probeAgent();
    } catch {
      return false;
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

function readCleanupTarget(raw: string | null): AutoFillCleanupTarget | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { accountId?: unknown };
    const accountId = value && typeof value.accountId === "string"
      && value.accountId.length > 0 && value.accountId.length <= 256
      && !/[\u0000-\u001f\u007f]/u.test(value.accountId)
      ? value.accountId
      : null;
    return { accountId };
  } catch {
    return { accountId: null };
  }
}
