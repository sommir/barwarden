import type { GlobalShortcutHost } from "./global-shortcut";

export type SecureStorageFailureCode = "unavailable" | "invalid-key";

export type NativeSecureStorageOutcome<T> =
  | { readonly status: "success"; readonly value: T }
  | { readonly status: "missing" }
  | { readonly status: SecureStorageFailureCode };

export class SecureStorageError extends Error {
  override readonly name = "SecureStorageError";

  constructor(readonly code: SecureStorageFailureCode) {
    super(code);
  }
}

export type PasteFailureCode =
  | "no-target"
  | "target-not-active"
  | "accessibility-denied"
  | "activation-failed"
  | "keystroke-failed";

export type NativePasteOutcome =
  | { readonly status: "success"; readonly valueCopied: true }
  | {
      readonly status: "paste-failed";
      readonly code: PasteFailureCode;
      readonly valueCopied: true;
    };

export class PasteError extends Error {
  override readonly name = "PasteError";

  constructor(
    readonly code: PasteFailureCode,
    readonly valueCopied: boolean,
  ) {
    super("Paste unavailable.");
  }
}

export interface AccountLockIntentHost {
  getAccountLockIntents(): Promise<readonly string[]>;
  setAccountLockIntents(accountIds: readonly string[], locked: boolean): Promise<void>;
}

export interface PopupWindowMetrics {
  readonly currentHeight: number;
  readonly maximumHeight: number;
}

export interface PopupWindowSizeHost {
  getPopupWindowMetrics(): Promise<PopupWindowMetrics>;
  setPopupHeight(height: number): Promise<PopupWindowMetrics>;
}

export type ProcessSessionStartupMode = "cold" | "attach";
export type ProcessAuthorizationState =
  | "signed-out"
  | "locked"
  | "unlocked"
  | "recovery-required";
export type ProcessSessionSyncState = "idle" | "syncing" | "fresh" | "stale" | "invalid";

export interface ProcessSessionSnapshot {
  readonly processGeneration: string;
  readonly version: number;
  readonly syncVersion: number;
  readonly authorization: ProcessAuthorizationState;
  readonly activeAccountId: string | null;
  readonly syncState: ProcessSessionSyncState;
  readonly failureCode: string | null;
  readonly sharedSnapshot: unknown | null;
  readonly originWindowLabel: string | null;
}

export interface ProcessSessionAttachment {
  readonly startupMode: ProcessSessionStartupMode;
  readonly snapshot: ProcessSessionSnapshot;
}

export type ProcessSessionMutation =
  | {
      readonly type: "unlocked";
      readonly activeAccountId: string;
      readonly sharedSnapshot?: unknown | null;
    }
  | { readonly type: "locked" }
  | { readonly type: "logged-out" }
  | { readonly type: "account-selected"; readonly activeAccountId: string }
  | { readonly type: "sync-started" }
  | {
      readonly type: "sync-succeeded";
      readonly sharedSnapshot?: unknown | null;
    }
  | { readonly type: "sync-failed"; readonly code: string }
  | { readonly type: "snapshot-updated"; readonly sharedSnapshot: unknown }
  | {
      readonly type: "active-tab-updated";
      readonly activeTab: "vault" | "otp" | "generator" | "send" | "settings";
    }
  | {
      readonly type: "recovery-required";
      readonly activeAccountId: string;
      readonly code: string;
    };

export interface ProcessSessionBrokerHost {
  attachProcessSession(): Promise<ProcessSessionAttachment>;
  processSessionSnapshot(): Promise<ProcessSessionSnapshot>;
  mutateProcessSession(mutation: ProcessSessionMutation): Promise<ProcessSessionSnapshot>;
  setProcessSessionHandoff?(session: unknown): Promise<void>;
  processSessionHandoff?(): Promise<unknown | null>;
}

export class ProcessSessionBrokerError extends Error {
  override readonly name = "ProcessSessionBrokerError";

  constructor(readonly code: "invalid-payload" | "unavailable") {
    super("Process session unavailable.");
  }
}

export interface HostApi
  extends
    AccountLockIntentHost,
    GlobalShortcutHost,
    PopupWindowSizeHost,
    ProcessSessionBrokerHost
{
  showPopup(): Promise<void>;
  hidePopup(): Promise<void>;
  copyText(value: string, clearAfterSeconds?: number): Promise<void>;
  pasteText(value: string, clearAfterSeconds?: number): Promise<void>;
  openUrl(url: string): Promise<void>;
  secureGet(key: string): Promise<string | null>;
  secureSet(key: string, value: string): Promise<void>;
  secureDelete(key: string): Promise<void>;
}

export interface SecureUuidHost {
  secureGetOrCreateUuid(key: string): Promise<string>;
}

export interface SecureCompareAndSwapHost {
  secureCompareAndSwap(
    key: string,
    expected: string | null,
    replacement: string | null,
  ): Promise<boolean>;
}

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
