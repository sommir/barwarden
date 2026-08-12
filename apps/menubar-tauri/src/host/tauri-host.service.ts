import { invoke as defaultInvoke } from "@tauri-apps/api/core";

import {
  BitwardenApiError,
  HttpTransportError,
  type HttpTransport,
} from "../bitwarden-api/bitwarden-api";
import type {
  AccountLockIntentHost,
  HostApi,
  NativePasteOutcome,
  PopupWindowMetrics,
  PasteFailureCode,
  ProcessSessionAttachment,
  ProcessSessionBrokerHost,
  ProcessSessionMutation,
  ProcessSessionSnapshot,
  SecureCompareAndSwapHost,
  SecureUuidHost,
  TauriInvoke,
} from "./host-api";
import {
  PasteError,
  ProcessSessionBrokerError,
  SecureStorageError,
} from "./host-api";
import {
  BiometricHostError,
  decodeBiometricAvailability,
  decodeBiometricOperation,
  type BiometricAvailability,
  type BiometricHost,
  type BiometricOperationStatus,
} from "./biometric-host";
import {
  decodeGlobalShortcutMutationOutcome,
  decodeGlobalShortcutSnapshot,
  GlobalShortcutHostError,
  type GlobalShortcutBinding,
  type GlobalShortcutMutationOutcome,
  type GlobalShortcutSnapshot,
} from "./global-shortcut";
import {
  LaunchAtLoginHostError,
  nativeAutostartApi,
  type LaunchAtLoginHost,
  type NativeAutostartApi,
} from "./launch-at-login";
import {
  decodeCapturedWebsiteContext,
  type CapturedWebsiteContext,
  type WebsiteContextHost,
  WebsiteContextHostError,
} from "./website-context";

type AutoFillSecretField = "username" | "password" | "totp";
interface LiveAutoFillContext {
  readonly bundleId: string;
  readonly appName: string;
  readonly fillContextToken: string;
  readonly focusedField: {
    readonly kind: "username" | "email" | "password" | "one-time-code" | "unknown";
    readonly confidence: "high" | "medium" | "low";
  };
  readonly action: {
    readonly mode: "field" | "form" | "choose";
    readonly fields: readonly AutoFillSecretField[];
  };
}
interface AutoFillApplicationContext {
  readonly bundleId: string;
  readonly appName: string;
}
interface DetectedFillAuthorizationContract {
  readonly scope: AutoFillRepromptScope;
  readonly mismatchConfirmed: boolean;
}
interface DetectedFillRequest {
  readonly intent: "auto" | "explicit";
  readonly fillContextToken: string;
  readonly authorizations: readonly DetectedFillAuthorizationContract[];
  readonly repromptReceipt?: string;
}
type DetectedFillOutcome =
  | { readonly status: "success"; readonly fields: readonly AutoFillSecretField[] }
  | {
    readonly status: "partial";
    readonly filled: readonly AutoFillSecretField[];
    readonly failed: AutoFillSecretField;
    readonly code: "stale-context" | "fill-failed";
  }
  | {
    readonly status: "error";
    readonly code: "unauthorized" | "invalid-request" | "stale-context" | "reprompt-failed" | "secret-release-failed";
  };
export type AutoFillAgentRegistrationStatus =
  | "notRegistered"
  | "enabled"
  | "requiresApproval"
  | "notFound";
type AccessibilityFallback = "system-autofill" | "unsupported";
interface AccessibilityStatus {
  readonly permission: "granted" | "denied";
  readonly observation: "stopped" | "hidden" | "visible";
  readonly diagnostic?: { readonly reason: string; readonly bundleId?: string };
}
const ACCESSIBILITY_DIAGNOSTIC_REASONS = new Set([
  "permission-denied",
  "system-autofill-preferred",
  "invalid-application",
  "owned-application",
  "application-terminated",
  "application-unavailable",
  "application-changed",
  "observer-unavailable",
  "stale-element",
  "stale-window",
  "stale-observation",
  "unsupported-role",
  "not-editable",
  "missing-frame",
  "unreliable-geometry",
  "offscreen",
]);

function decodeAccessibilityStatus(value: unknown): AccessibilityStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid accessibility status");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["permission", "observation", "diagnostic"].includes(key))
      || (record.permission !== "granted" && record.permission !== "denied")
      || (record.observation !== "stopped"
        && record.observation !== "hidden"
        && record.observation !== "visible")) {
    throw new Error("invalid accessibility status");
  }
  const status: AccessibilityStatus = {
    permission: record.permission,
    observation: record.observation,
  };
  if (record.diagnostic === undefined) return status;
  if (!record.diagnostic || typeof record.diagnostic !== "object"
      || Array.isArray(record.diagnostic)) {
    throw new Error("invalid accessibility status");
  }
  const diagnostic = record.diagnostic as Record<string, unknown>;
  if (Object.keys(diagnostic).some((key) => !["reason", "bundleId"].includes(key))
      || typeof diagnostic.reason !== "string"
      || !ACCESSIBILITY_DIAGNOSTIC_REASONS.has(diagnostic.reason)
      || (diagnostic.bundleId !== undefined
        && (typeof diagnostic.bundleId !== "string"
          || !validAccessibilityBundleId(diagnostic.bundleId)))) {
    throw new Error("invalid accessibility status");
  }
  return {
    ...status,
    diagnostic: {
      reason: diagnostic.reason,
      ...(diagnostic.bundleId === undefined ? {} : { bundleId: diagnostic.bundleId as string }),
    },
  };
}

function validAccessibilityBundleId(value: string): boolean {
  return value.length > 0
    && value.length <= 255
    && /^[\x00-\x7F]+$/.test(value)
    && value.split(".").length >= 2
    && value.split(".").every((segment) => (
      segment.length > 0
      && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(segment)
    ));
}
interface AutoFillCandidateQueryContract {
  readonly accountId: string;
  readonly lockGeneration: string;
  readonly field?: AutoFillSecretField;
  readonly context: { readonly bundleId: string; readonly appName: string; readonly serviceIdentifiers: readonly string[]; readonly query: string };
}
interface AutoFillRepromptScope {
  readonly accountId: string;
  readonly candidateId: string;
  readonly field: AutoFillSecretField;
  readonly generation: string;
  readonly contextToken: string;
}
interface AutoFillSecretCommandRequest {
  readonly scope: AutoFillRepromptScope;
  readonly mismatchConfirmed: boolean;
  readonly repromptReceipt?: string;
}

export class TauriHostService
  implements
    HostApi,
    SecureCompareAndSwapHost,
    SecureUuidHost,
    AccountLockIntentHost,
    ProcessSessionBrokerHost,
    BiometricHost,
    LaunchAtLoginHost,
    WebsiteContextHost,
    HttpTransport
{
  constructor(
    private readonly invoke: TauriInvoke = defaultInvoke,
    private readonly autostart: NativeAutostartApi = nativeAutostartApi,
  ) {}

  async getLaunchAtLogin(): Promise<boolean> {
    try {
      return await this.autostart.isEnabled();
    } catch {
      throw new LaunchAtLoginHostError();
    }
  }

  async setLaunchAtLogin(enabled: boolean): Promise<boolean> {
    try {
      const current = await this.autostart.isEnabled();
      if (current !== enabled) {
        await (enabled ? this.autostart.enable() : this.autostart.disable());
      }
      return await this.autostart.isEnabled();
    } catch {
      throw new LaunchAtLoginHostError();
    }
  }

  showPopup(): Promise<void> {
    return this.invoke("show_popup");
  }

  async status(): Promise<AccessibilityStatus> {
    return decodeAccessibilityStatus(await this.invoke<unknown>("autofill_accessibility_status"));
  }

  async setFallback(fallback: AccessibilityFallback): Promise<void> {
    await this.invoke("autofill_set_accessibility_fallback", { fallback });
  }

  async setFloatingIconEnabled(enabled: boolean): Promise<void> {
    await this.invoke("autofill_set_floating_icon_enabled", { enabled });
  }

  async requestPermission(): Promise<AccessibilityStatus> {
    return decodeAccessibilityStatus(
      await this.invoke<unknown>("autofill_request_accessibility_permission"),
    );
  }

  hidePopup(): Promise<void> {
    return this.invoke("hide_popup");
  }

  async capturedWebsiteContext(): Promise<CapturedWebsiteContext> {
    try {
      return decodeCapturedWebsiteContext(
        await this.invoke<unknown>("captured_website_context", undefined),
      );
    } catch (error) {
      if (error instanceof WebsiteContextHostError) {
        throw error;
      }
      throw new WebsiteContextHostError("unavailable");
    }
  }

  getPopupWindowMetrics(): Promise<PopupWindowMetrics> {
    return this.invoke("popup_window_metrics");
  }

  setPopupHeight(height: number): Promise<PopupWindowMetrics> {
    return this.invoke("set_popup_height", { height });
  }

  getGlobalShortcut(): Promise<GlobalShortcutSnapshot> {
    return this.decodeGlobalShortcut(
      this.invoke<unknown>("get_global_shortcut", undefined),
      decodeGlobalShortcutSnapshot,
    );
  }

  setGlobalShortcut(shortcut: GlobalShortcutBinding): Promise<GlobalShortcutMutationOutcome> {
    return this.decodeGlobalShortcut(
      this.invoke<unknown>("set_global_shortcut", { shortcut }),
      decodeGlobalShortcutMutationOutcome,
    );
  }

  clearGlobalShortcut(): Promise<GlobalShortcutMutationOutcome> {
    return this.decodeGlobalShortcut(
      this.invoke<unknown>("clear_global_shortcut", undefined),
      decodeGlobalShortcutMutationOutcome,
    );
  }

  popOut(route: string): Promise<void> {
    return this.invoke("pop_out", { route });
  }

  attachProcessSession(): Promise<ProcessSessionAttachment> {
    return this.decodeProcessSession(
      this.invoke<unknown>("session_broker_attach", undefined),
      decodeProcessSessionAttachment,
    );
  }

  processSessionSnapshot(): Promise<ProcessSessionSnapshot> {
    return this.decodeProcessSession(
      this.invoke<unknown>("session_broker_snapshot", undefined),
      decodeProcessSessionSnapshot,
    );
  }

  mutateProcessSession(mutation: ProcessSessionMutation): Promise<ProcessSessionSnapshot> {
    try {
      assertSafeProcessSessionMutation(mutation);
    } catch {
      return Promise.reject(new ProcessSessionBrokerError("invalid-payload"));
    }
    return this.decodeProcessSession(
      this.invoke<unknown>("session_broker_mutate", { mutation }),
      decodeProcessSessionSnapshot,
    );
  }

  setProcessSessionHandoff(session: unknown): Promise<void> {
    return this.invoke("session_broker_set_handoff", { session });
  }

  processSessionHandoff(): Promise<unknown | null> {
    return this.invoke("session_broker_handoff", undefined);
  }

  copyText(value: string, clearAfterSeconds?: number): Promise<void> {
    return this.invoke("copy_text", { value, clearAfterSeconds });
  }

  async pasteText(value: string, clearAfterSeconds?: number): Promise<void> {
    let outcome: unknown;
    try {
      outcome = await this.invoke<unknown>("paste_text", { value, clearAfterSeconds });
    } catch {
      throw new PasteError("keystroke-failed", false);
    }

    let decoded: NativePasteOutcome;
    try {
      decoded = decodeNativePasteOutcome(outcome);
    } catch {
      throw new PasteError("keystroke-failed", false);
    }

    if (decoded.status === "success") {
      return;
    }
    throw new PasteError(decoded.code, true);
  }

  async openUrl(url: string): Promise<void> {
    try {
      await this.invoke("open_url", { url });
    } catch (error) {
      throw new Error(error === "invalid-url" ? "invalid-url" : "launch-failed");
    }
  }

  secureGet(key: string): Promise<string | null> {
    return this.invokeSecure("secure_get", { key }, decodeSecureGet, true);
  }

  async secureSet(key: string, value: string): Promise<void> {
    await this.invokeSecure("secure_set", { key, value }, decodeNull);
  }

  async secureDelete(key: string): Promise<void> {
    await this.invokeSecure("secure_delete", { key }, decodeNull);
  }

  secureCompareAndSwap(
    key: string,
    expected: string | null,
    replacement: string | null,
  ): Promise<boolean> {
    return this.invokeSecure("secure_compare_and_swap", { key, expected, replacement }, decodeBoolean);
  }

  secureGetOrCreateUuid(key: string): Promise<string> {
    return this.invokeSecure("secure_get_or_create_uuid", { key }, decodeUuid);
  }

  getAccountLockIntents(): Promise<readonly string[]> {
    return this.invoke("get_account_lock_intents");
  }

  setAccountLockIntents(accountIds: readonly string[], locked: boolean): Promise<void> {
    return this.invoke("set_account_lock_intents", { accountIds, locked });
  }

  biometricStatus(accountId: string): Promise<BiometricAvailability> {
    return this.decodeBiometric(
      this.invoke<unknown>("biometric_status", { accountId }),
      decodeBiometricAvailability,
    );
  }

  biometricEnable(accountId: string): Promise<BiometricOperationStatus> {
    return this.decodeBiometric(
      this.invoke<unknown>("biometric_enable", { accountId, reason: "setup" }),
      decodeBiometricOperation,
    );
  }

  biometricUnlock(accountId: string): Promise<BiometricOperationStatus> {
    return this.decodeBiometric(
      this.invoke<unknown>("biometric_unlock", { accountId, reason: "unlock" }),
      decodeBiometricOperation,
    );
  }

  biometricDisable(accountId: string): Promise<BiometricOperationStatus> {
    return this.decodeBiometric(
      this.invoke<unknown>("biometric_disable", { accountId }),
      decodeBiometricOperation,
    );
  }

  autofillAgentProbe(): Promise<unknown> {
    return this.invoke<unknown>("autofill_agent_probe");
  }

  autofillAgentStatus(): Promise<unknown> {
    return this.invoke<unknown>("autofill_agent_status");
  }

  autofillAgentLock(): Promise<unknown> {
    return this.invoke<unknown>("autofill_agent_lock");
  }

  autofillAgentRegistrationStatus(): Promise<AutoFillAgentRegistrationStatus> {
    return this.invoke<AutoFillAgentRegistrationStatus>("autofill_agent_registration_status");
  }

  autofillAgentRegister(): Promise<AutoFillAgentRegistrationStatus> {
    return this.invoke<AutoFillAgentRegistrationStatus>("autofill_agent_register");
  }

  autofillAgentUnregister(): Promise<AutoFillAgentRegistrationStatus> {
    return this.invoke<AutoFillAgentRegistrationStatus>("autofill_agent_unregister");
  }

  autofillClearProjection(accountId: string): Promise<void> {
    return this.invoke<void>("autofill_clear_projection", { accountId });
  }

  async entryContext() {
    try {
      return decodeEntryContext(await this.invoke<unknown>("autofill_entry_context"));
    } catch {
      throw new Error("AutoFill unavailable");
    }
  }

  async agentSession() {
    try {
      return decodeAgentSession(await this.invoke<unknown>("autofill_agent_session"));
    } catch {
      throw new Error("AutoFill unavailable");
    }
  }

  async queryCandidates(request: AutoFillCandidateQueryContract): Promise<unknown> {
    try {
      return decodeCandidateOutcome(await this.invoke<unknown>("autofill_query_candidates", {
        request,
      }));
    } catch {
      throw new Error("AutoFill unavailable");
    }
  }

  async beginReprompt(scope: AutoFillRepromptScope) {
    return decodeBeginReprompt(await this.invoke<unknown>("autofill_begin_reprompt", { scope }));
  }

  async beginRepromptBatch(scopes: readonly AutoFillRepromptScope[]) {
    try {
      const validated = validateAutoFillRepromptScopes(scopes);
      return decodeBeginReprompt(await this.invoke<unknown>("autofill_begin_batch_reprompt", {
        request: { scopes: validated },
      }));
    } catch {
      throw new Error("AutoFill unavailable");
    }
  }

  async cancelRepromptBatch(
    scopes: readonly AutoFillRepromptScope[],
    receipt: string,
  ): Promise<void> {
    try {
      const validated = validateAutoFillRepromptScopes(scopes);
      if (!nonEmpty(receipt) || receipt.length > 512) throw new Error("invalid receipt");
      await this.invoke("autofill_cancel_batch_reprompt", {
        request: { scopes: validated, receipt },
      });
    } catch {
      throw new Error("AutoFill unavailable");
    }
  }

  async cancelReprompt(scope: AutoFillRepromptScope, receipt: string): Promise<void> {
    await this.invoke("autofill_cancel_reprompt", { scope, receipt });
  }

  biometricReprompt(accountId: string, receipt: string): Promise<BiometricOperationStatus> {
    return this.decodeBiometric(
      this.invoke<unknown>("autofill_biometric_reprompt", { accountId, receipt }),
      decodeBiometricOperation,
    );
  }

  async releaseSecret(request: AutoFillSecretCommandRequest) {
    return decodeSecretOutcome(await this.invoke<unknown>("autofill_release_secret", { request }));
  }

  async fillDetected(request: DetectedFillRequest): Promise<DetectedFillOutcome> {
    let validated: DetectedFillRequest;
    try {
      validated = validateDetectedFillRequest(request);
    } catch {
      throw new Error("AutoFill unavailable");
    }
    try {
      return decodeDetectedFillOutcome(await this.invoke<unknown>("autofill_fill_detected", {
        request: validated,
      }));
    } catch {
      throw new Error("AutoFill unavailable");
    }
  }

  async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const request = {
      url,
      method: init.method ?? "GET",
      headers: headersToRecord(init.headers),
      body: requestBodyToString(init.body),
    };
    let response: T | NativeHttpJsonEnvelope;
    try {
      response = await this.invoke<T | NativeHttpJsonEnvelope>("http_fetch_json", {
        request,
      });
    } catch {
      throw new HttpTransportError("unavailable");
    }
    return unwrapNativeHttpJson<T>(response);
  }

  private async invokeSecure<T>(
    command: string,
    args: Record<string, unknown>,
    decodeSuccess: (value: unknown) => T,
    allowMissing?: false,
  ): Promise<T>;
  private async invokeSecure<T>(
    command: string,
    args: Record<string, unknown>,
    decodeSuccess: (value: unknown) => T,
    allowMissing: true,
  ): Promise<T | null>;
  private async invokeSecure<T>(
    command: string,
    args: Record<string, unknown>,
    decodeSuccess: (value: unknown) => T,
    allowMissing = false,
  ): Promise<T | null> {
    let outcome: unknown;
    try {
      outcome = await this.invoke<unknown>(command, args);
    } catch {
      throw new SecureStorageError("unavailable");
    }
    try {
      return unwrapSecureStorageOutcome(outcome, allowMissing, decodeSuccess);
    } catch (error) {
      if (error instanceof SecureStorageError) {
        throw error;
      }
      throw new SecureStorageError("unavailable");
    }
  }

  private async decodeBiometric<T>(
    invocation: Promise<unknown>,
    decode: (value: unknown) => T,
  ): Promise<T> {
    try {
      return decode(await invocation);
    } catch {
      throw new BiometricHostError("unavailable");
    }
  }

  private async decodeGlobalShortcut<T>(
    invocation: Promise<unknown>,
    decode: (value: unknown) => T,
  ): Promise<T> {
    try {
      return decode(await invocation);
    } catch {
      throw new GlobalShortcutHostError();
    }
  }

  private async decodeProcessSession<T>(
    invocation: Promise<unknown>,
    decode: (value: unknown) => T,
  ): Promise<T> {
    try {
      return decode(await invocation);
    } catch {
      throw new ProcessSessionBrokerError("unavailable");
    }
  }

}

const PROCESS_SESSION_SNAPSHOT_KEYS = [
  "processGeneration",
  "version",
  "syncVersion",
  "authorization",
  "activeAccountId",
  "syncState",
  "failureCode",
  "sharedSnapshot",
  "originWindowLabel",
] as const;

function decodeProcessSessionAttachment(value: unknown): ProcessSessionAttachment {
  const record = exactPlainRecord(value, ["startupMode", "snapshot"]);
  const startupMode = record["startupMode"];
  if (startupMode !== "cold" && startupMode !== "attach") {
    throw new Error("malformed process-session attachment");
  }
  return {
    startupMode,
    snapshot: decodeProcessSessionSnapshot(record["snapshot"]),
  };
}

function decodeProcessSessionSnapshot(value: unknown): ProcessSessionSnapshot {
  const record = exactPlainRecord(value, PROCESS_SESSION_SNAPSHOT_KEYS);
  const processGeneration = record["processGeneration"];
  const version = record["version"];
  const syncVersion = record["syncVersion"];
  const authorization = record["authorization"];
  const activeAccountId = nullableBoundedString(record["activeAccountId"], 512);
  const syncState = record["syncState"];
  const failureCode = nullableFailureCode(record["failureCode"]);
  const sharedSnapshot = record["sharedSnapshot"];
  const originWindowLabel = nullableWindowLabel(record["originWindowLabel"]);

  if (
    typeof processGeneration !== "string" ||
    processGeneration.length === 0 ||
    processGeneration.length > 128 ||
    !isRevision(version) ||
    !isRevision(syncVersion) ||
    !isProcessAuthorization(authorization) ||
    !isProcessSyncState(syncState) ||
    (authorization === "unlocked" && !activeAccountId)
  ) {
    throw new Error("malformed process-session snapshot");
  }
  if (sharedSnapshot !== null) {
    assertSafeJsonValue(sharedSnapshot);
  }

  return {
    processGeneration,
    version,
    syncVersion,
    authorization,
    activeAccountId,
    syncState,
    failureCode,
    sharedSnapshot,
    originWindowLabel,
  };
}

function assertSafeProcessSessionMutation(value: ProcessSessionMutation): void {
  const mutation = exactPlainRecord(value, mutationKeys(value.type));
  if (mutation["type"] !== value.type) {
    throw new Error("malformed process-session mutation");
  }
  switch (value.type) {
    case "unlocked":
    case "account-selected":
    case "recovery-required":
      if (!boundedString(value.activeAccountId, 512)) {
        throw new Error("malformed process-session mutation");
      }
      break;
    case "active-tab-updated":
      if (!isPopupTab(value.activeTab)) {
        throw new Error("malformed process-session mutation");
      }
      break;
  }
  if ("code" in value && !isFailureCode(value.code)) {
    throw new Error("malformed process-session mutation");
  }
  if ("sharedSnapshot" in value && value.sharedSnapshot != null) {
    assertSafeJsonValue(value.sharedSnapshot);
  }
}

function mutationKeys(type: ProcessSessionMutation["type"]): readonly string[] {
  switch (type) {
    case "unlocked":
      return ["type", "activeAccountId", "sharedSnapshot"];
    case "account-selected":
      return ["type", "activeAccountId"];
    case "sync-succeeded":
      return ["type", "sharedSnapshot"];
    case "sync-failed":
      return ["type", "code"];
    case "snapshot-updated":
      return ["type", "sharedSnapshot"];
    case "active-tab-updated":
      return ["type", "activeTab"];
    case "recovery-required":
      return ["type", "activeAccountId", "code"];
    case "locked":
    case "logged-out":
    case "sync-started":
      return ["type"];
  }
}

function isPopupTab(value: unknown): value is "vault" | "otp" | "generator" | "send" | "settings" {
  return value === "vault" || value === "otp" || value === "generator" ||
    value === "send" || value === "settings";
}

function exactPlainRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new Error("malformed record");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (!hasExactOwnKeys(ownKeys, keys)) {
    throw new Error("malformed record");
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new Error("malformed record");
    }
  }
  return value;
}

function assertSafeJsonValue(
  value: unknown,
  depth = 0,
  budget = { nodes: 0 },
): void {
  budget.nodes += 1;
  if (budget.nodes > 100_000 || depth > 64) {
    throw new Error("oversized process-session snapshot");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertSafeJsonValue(entry, depth + 1, budget);
    }
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error("malformed process-session snapshot");
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || isSensitiveProcessSessionKey(key)) {
      throw new Error("sensitive process-session snapshot");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new Error("malformed process-session snapshot");
    }
    assertSafeJsonValue(descriptor.value, depth + 1, budget);
  }
}

function isSensitiveProcessSessionKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase();
  return [
    "masterpassword",
    "accesstoken",
    "refreshtoken",
    "activesession",
    "sessiontoken",
  ].includes(normalized);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function boundedString(value: unknown, maximumLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximumLength
  );
}

function nullableBoundedString(value: unknown, maximumLength: number): string | null {
  if (value === null) {
    return null;
  }
  if (!boundedString(value, maximumLength)) {
    throw new Error("malformed string");
  }
  return value;
}

function nullableFailureCode(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (!isFailureCode(value)) {
    throw new Error("malformed failure code");
  }
  return value;
}

function isFailureCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) &&
    value.length <= 64
  );
}

function nullableWindowLabel(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new Error("malformed window label");
  }
  return value;
}

function isProcessAuthorization(
  value: unknown,
): value is ProcessSessionSnapshot["authorization"] {
  return (
    value === "signed-out" ||
    value === "locked" ||
    value === "unlocked" ||
    value === "recovery-required"
  );
}

function isProcessSyncState(value: unknown): value is ProcessSessionSnapshot["syncState"] {
  return (
    value === "idle" ||
    value === "syncing" ||
    value === "fresh" ||
    value === "stale" ||
    value === "invalid"
  );
}

function decodeNativePasteOutcome(value: unknown): NativePasteOutcome {
  if (!isRecord(value)) {
    throw new Error("malformed paste outcome");
  }

  const keys = Reflect.ownKeys(value);
  const status = value["status"];
  if (
    status === "success" &&
    hasExactOwnKeys(keys, ["status", "valueCopied"]) &&
    value["valueCopied"] === true
  ) {
    return { status, valueCopied: true };
  }

  if (
    status === "paste-failed" &&
    hasExactOwnKeys(keys, ["status", "code", "valueCopied"]) &&
    value["valueCopied"] === true
  ) {
    const code = decodePasteFailureCode(value["code"]);
    if (code !== null) {
      return { status, code, valueCopied: true };
    }
  }

  throw new Error("malformed paste outcome");
}

function hasExactOwnKeys(keys: readonly PropertyKey[], expected: readonly string[]): boolean {
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === "string" && expected.includes(key))
  );
}

function decodePasteFailureCode(value: unknown): PasteFailureCode | null {
  if (typeof value !== "string") {
    return null;
  }

  switch (value) {
    case "no-target":
    case "target-not-active":
    case "accessibility-denied":
    case "activation-failed":
    case "keystroke-failed":
      return value;
    default:
      return null;
  }
}

function unwrapSecureStorageOutcome<T>(
  outcome: unknown,
  allowMissing: boolean,
  decodeSuccess: (value: unknown) => T,
): T | null {
  let status: string;
  let hasValue = false;
  let value: unknown;
  try {
    if (!isRecord(outcome)) {
      throw new Error("malformed secure-storage outcome");
    }
    const candidateStatus = outcome["status"];
    if (typeof candidateStatus !== "string") {
      throw new Error("malformed secure-storage outcome");
    }
    status = candidateStatus;
    if (status === "success") {
      hasValue = "value" in outcome;
      value = outcome["value"];
    }
  } catch {
    throw new SecureStorageError("unavailable");
  }

  switch (status) {
    case "success":
      if (!hasValue) {
        throw new SecureStorageError("unavailable");
      }
      return decodeSuccess(value);
    case "missing":
      if (allowMissing) {
        return null;
      }
      throw new SecureStorageError("unavailable");
    case "invalid-key":
      throw new SecureStorageError("invalid-key");
    case "unavailable":
    default:
      throw new SecureStorageError("unavailable");
  }
}

function decodeSecureGet(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  throw new SecureStorageError("unavailable");
}

function decodeNull(value: unknown): null {
  if (value === null) {
    return null;
  }
  throw new SecureStorageError("unavailable");
}

function decodeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  throw new SecureStorageError("unavailable");
}

function decodeUuid(value: unknown): string {
  if (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    return value;
  }
  throw new SecureStorageError("unavailable");
}

interface NativeHttpJsonEnvelope {
  readonly ok: boolean;
  readonly status: number;
  readonly responseJson: unknown;
}

function unwrapNativeHttpJson<T>(response: T | NativeHttpJsonEnvelope): T {
  if (!isNativeHttpJsonEnvelope(response)) {
    return response as T;
  }

  if (!response.ok) {
    throw new BitwardenApiError(response.status, response.responseJson);
  }

  return response.responseJson as T;
}

function isNativeHttpJsonEnvelope(value: unknown): value is NativeHttpJsonEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as { ok?: unknown }).ok === "boolean" &&
    typeof (value as { status?: unknown }).status === "number" &&
    "responseJson" in value
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    const values: Record<string, string> = {};
    headers.forEach((value, key) => {
      values[key] = value;
    });
    return values;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers;
}

function requestBodyToString(body: BodyInit | null | undefined): string | null {
  if (body == null) {
    return null;
  }

  if (typeof body === "string") {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  throw new Error("Unsupported native HTTP request body type");
}

const AUTOFILL_FIELD_ORDER: readonly AutoFillSecretField[] = ["username", "password", "totp"];
const AUTOFILL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeLiveAutoFillContext(value: unknown): LiveAutoFillContext {
  const context = snapshotExactAutoFillRecord(value, [
    "bundleId", "appName", "fillContextToken", "focusedField", "action",
  ]);
  const focusedField = snapshotExactAutoFillRecord(context["focusedField"], ["kind", "confidence"]);
  const action = snapshotExactAutoFillRecord(context["action"], ["mode", "fields"]);
  const kind = valueFromSet(focusedField["kind"], [
    "username", "email", "password", "one-time-code", "unknown",
  ] as const);
  const confidence = valueFromSet(focusedField["confidence"], ["high", "medium", "low"] as const);
  const mode = valueFromSet(action["mode"], ["field", "form", "choose"] as const);
  return Object.freeze({
    bundleId: boundedAutoFillString(context["bundleId"], 255),
    appName: boundedAutoFillString(context["appName"], 255),
    fillContextToken: autoFillUuid(context["fillContextToken"]),
    focusedField: Object.freeze({ kind, confidence }),
    action: Object.freeze({ mode, fields: canonicalAutoFillFields(action["fields"], false) }),
  });
}

function validateAutoFillRepromptScopes(value: unknown): readonly AutoFillRepromptScope[] {
  const rawScopes = snapshotDenseAutoFillArray(value, 1, 3);
  const scopes = rawScopes.map((entry) => {
    const scope = snapshotExactAutoFillRecord(entry, [
      "accountId", "candidateId", "field", "generation", "contextToken",
    ]);
    return Object.freeze({
      accountId: boundedAutoFillString(scope["accountId"], 512),
      candidateId: boundedAutoFillString(scope["candidateId"], 512),
      field: autoFillField(scope["field"]),
      generation: autoFillUuid(scope["generation"]),
      contextToken: boundedAutoFillString(scope["contextToken"], 512),
    });
  });
  canonicalAutoFillFields(scopes.map(({ field }) => field), false);
  const first = scopes[0];
  if (scopes.some((scope) => scope.accountId !== first.accountId
    || scope.candidateId !== first.candidateId || scope.generation !== first.generation)
    || new Set(scopes.map(({ contextToken }) => contextToken)).size !== scopes.length) {
    throw new Error("incompatible scopes");
  }
  return Object.freeze(scopes);
}

function validateDetectedFillRequest(value: unknown): DetectedFillRequest {
  const request = snapshotAutoFillRecord(value);
  if (!exactKeys(request, ["intent", "fillContextToken", "authorizations"])
      && !exactKeys(request, ["intent", "fillContextToken", "authorizations", "repromptReceipt"])) {
    throw new Error("invalid request");
  }
  const rawAuthorizations = request["authorizations"];
  const authorizations = snapshotDenseAutoFillArray(rawAuthorizations, 1, 3).map((entry) => {
    const authorization = snapshotExactAutoFillRecord(entry, ["scope", "mismatchConfirmed"]);
    if (typeof authorization["mismatchConfirmed"] !== "boolean") throw new Error("invalid authorization");
    const [scope] = validateAutoFillRepromptScopes([authorization["scope"]]);
    return Object.freeze({ scope, mismatchConfirmed: authorization["mismatchConfirmed"] });
  });
  validateAutoFillRepromptScopes(authorizations.map(({ scope }) => scope));
  const hasReceipt = Object.prototype.hasOwnProperty.call(request, "repromptReceipt");
  const repromptReceipt = hasReceipt
    ? boundedAutoFillString(request["repromptReceipt"], 512)
    : undefined;
  return Object.freeze({
    intent: valueFromSet(request["intent"], ["auto", "explicit"] as const),
    fillContextToken: autoFillUuid(request["fillContextToken"]),
    authorizations: Object.freeze(authorizations),
    ...(repromptReceipt === undefined ? {} : { repromptReceipt }),
  });
}

function decodeDetectedFillOutcome(value: unknown): DetectedFillOutcome {
  const outcome = snapshotAutoFillRecord(value);
  if (outcome["status"] === "success" && exactKeys(outcome, ["status", "fields"])) {
    return Object.freeze({ status: "success", fields: canonicalAutoFillFields(outcome["fields"], false) });
  }
  if (outcome["status"] === "partial" && exactKeys(outcome, ["status", "filled", "failed", "code"])) {
    const filled = canonicalAutoFillFields(outcome["filled"], true);
    const failed = autoFillField(outcome["failed"]);
    const code = valueFromSet(outcome["code"], ["stale-context", "fill-failed"] as const);
    const failedIndex = AUTOFILL_FIELD_ORDER.indexOf(failed);
    if (filled.includes(failed)
        || filled.some((field) => AUTOFILL_FIELD_ORDER.indexOf(field) >= failedIndex)) {
      throw new Error("invalid outcome");
    }
    return Object.freeze({ status: "partial", filled, failed, code });
  }
  if (outcome["status"] === "error" && exactKeys(outcome, ["status", "code"])) {
    return Object.freeze({
      status: "error",
      code: valueFromSet(outcome["code"], [
        "unauthorized", "invalid-request", "stale-context", "reprompt-failed", "secret-release-failed",
      ] as const),
    });
  }
  throw new Error("invalid outcome");
}

function canonicalAutoFillFields(value: unknown, allowEmpty: boolean): readonly AutoFillSecretField[] {
  const fields = snapshotDenseAutoFillArray(value, allowEmpty ? 0 : 1, 3).map(autoFillField);
  if (new Set(fields).size !== fields.length || fields.some((field, index) => (
    AUTOFILL_FIELD_ORDER.indexOf(field)
      <= (index === 0 ? -1 : AUTOFILL_FIELD_ORDER.indexOf(fields[index - 1]))
  ))) throw new Error("invalid fields");
  return Object.freeze(fields);
}

function autoFillField(value: unknown): AutoFillSecretField {
  return valueFromSet(value, AUTOFILL_FIELD_ORDER);
}

function autoFillUuid(value: unknown): string {
  const result = boundedAutoFillString(value, 36);
  if (!AUTOFILL_UUID.test(result)) throw new Error("invalid UUID");
  return result;
}

function boundedAutoFillString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum || value.trim().length === 0) {
    throw new Error("invalid string");
  }
  return value.normalize("NFC");
}

function boundedAutoFillOptionalString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) throw new Error("invalid string");
  return value.normalize("NFC");
}

function valueFromSet<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) throw new Error("invalid enum");
  return value as Values[number];
}

function decodeEntryContext(value: unknown) {
  const outcome = snapshotAutoFillRecord(value);
  if (outcome["status"] === "unavailable" && exactKeys(outcome, ["status"])) return { status: "unavailable" as const };
  if (outcome["status"] === "available" && (exactKeys(outcome, ["status", "application"])
      || exactKeys(outcome, ["status", "application", "fillContext"]))) {
    try {
      const applicationValue = snapshotAutoFillRecord(outcome["application"]);
      if (!exactKeys(applicationValue, ["bundleId", "appName"])) throw new Error("invalid application");
      const application: AutoFillApplicationContext = Object.freeze({
        bundleId: boundedAutoFillString(applicationValue["bundleId"], 255),
        appName: boundedAutoFillString(applicationValue["appName"], 255),
      });
      if (!Object.prototype.hasOwnProperty.call(outcome, "fillContext")) {
        return { status: "available" as const, application, fillContext: null };
      }
      const fill = snapshotAutoFillRecord(outcome["fillContext"]);
      if (!exactKeys(fill, ["fillContextToken", "focusedField", "action"])) {
        throw new Error("invalid fill context");
      }
      return { status: "available" as const, application, fillContext: decodeLiveAutoFillContext({
        bundleId: application.bundleId,
        appName: application.appName,
        fillContextToken: fill["fillContextToken"],
        focusedField: fill["focusedField"],
        action: fill["action"],
      }) };
    } catch {
      throw new Error("AutoFill unavailable");
    }
  }
  throw new Error("AutoFill unavailable");
}

function decodeAgentSession(value: unknown) {
  const outcome = snapshotAutoFillRecord(value);
  if (outcome["status"] === "error" && exactKeys(outcome, ["status", "code"]) && nonEmpty(outcome["code"])) {
    return { status: "error" as const, code: outcome["code"] };
  }
  if (outcome["status"] === "success" && exactKeys(outcome, ["status", "generation", "accountId", "vaultRevision"])
      && isNativeUuid(outcome["generation"]) && nonEmpty(outcome["accountId"])
      && Number.isSafeInteger(outcome["vaultRevision"]) && Number(outcome["vaultRevision"]) >= 0) {
    return { status: "success" as const, generation: outcome["generation"], accountId: outcome["accountId"], vaultRevision: outcome["vaultRevision"] as number };
  }
  throw new Error("AutoFill unavailable");
}

function decodeCandidateOutcome(value: unknown): unknown {
  const outcome = snapshotExactAutoFillRecord(value, ["status", "contextToken", "candidates"]);
  const contextToken = boundedAutoFillString(outcome["contextToken"], 512);
  const rawCandidates = outcome["candidates"];
  if (outcome["status"] !== "success") {
    throw new Error("AutoFill unavailable");
  }
  const candidateValues = snapshotDenseAutoFillArray(rawCandidates, 0, 500);
  const cipherIds = new Set<string>();
  const candidates = candidateValues.map((candidate) => {
    const projected = snapshotExactAutoFillRecord(candidate, [
      "cipherId", "displayName", "username", "group", "reason", "requiresMismatchConfirmation",
    ]);
    const cipherId = boundedAutoFillString(projected["cipherId"], 512);
    const displayName = boundedAutoFillOptionalString(projected["displayName"], 2_048);
    const username = boundedAutoFillOptionalString(projected["username"], 2_048);
    const group = projected["group"];
    const reason = boundedAutoFillOptionalString(projected["reason"], 512);
    const requiresMismatchConfirmation = projected["requiresMismatchConfirmation"];
    if (!["exact", "relevant", "other"].includes(String(group))
      || typeof requiresMismatchConfirmation !== "boolean") {
      throw new Error("AutoFill unavailable");
    }
    if (cipherIds.has(cipherId)) throw new Error("AutoFill unavailable");
    cipherIds.add(cipherId);
    return Object.freeze({
      cipherId,
      displayName,
      username,
      group,
      reason,
      requiresMismatchConfirmation,
    });
  });
  return Object.freeze({
    contextToken,
    candidates: Object.freeze(candidates),
  });
}

function decodeBeginReprompt(value: unknown) {
  const outcome = snapshotAutoFillRecord(value);
  if (outcome["status"] === "unavailable" && exactKeys(outcome, ["status"])) return { status: "unavailable" as const };
  if (outcome["status"] === "pending" && exactKeys(outcome, ["status", "receipt"])
      && nonEmpty(outcome["receipt"]) && outcome["receipt"].length <= 512) {
    return { status: "pending" as const, receipt: outcome["receipt"] };
  }
  throw new Error("AutoFill unavailable");
}

function decodeSecretOutcome(value: unknown) {
  if (!isExactRecord(value)) throw new Error("AutoFill unavailable");
  if (value["status"] === "error" && exactKeys(value, ["status", "code"]) && nonEmpty(value["code"])) {
    return { status: "error" as const, code: value["code"] };
  }
  if (value["status"] === "success" && exactKeys(value, ["status", "field", "value"])
      && ["username", "password", "totp"].includes(String(value["field"])) && typeof value["value"] === "string") {
    return { status: "success" as const, field: value["field"] as AutoFillSecretField, value: value["value"] };
  }
  throw new Error("AutoFill unavailable");
}

function snapshotExactAutoFillRecord(
  value: unknown,
  expected: readonly string[],
): Record<string, unknown> {
  const snapshot = snapshotAutoFillRecord(value);
  if (!exactKeys(snapshot, expected)) throw new Error("AutoFill unavailable");
  return snapshot;
}

function snapshotAutoFillRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("AutoFill unavailable");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("AutoFill unavailable");
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) throw new Error("AutoFill unavailable");
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new Error("AutoFill unavailable");
    snapshot[key as string] = descriptor.value;
  }
  return snapshot;
}

function snapshotDenseAutoFillArray(
  value: unknown,
  minimum: number,
  maximum: number,
): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error("AutoFill unavailable");
  }
  const keys = Reflect.ownKeys(value);
  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < minimum || lengthDescriptor.value > maximum) {
    throw new Error("AutoFill unavailable");
  }
  const length = lengthDescriptor.value as number;
  const expectedKeys = new Set<string>(["length", ...Array.from({ length }, (_, index) => String(index))]);
  if (keys.length !== expectedKeys.size
      || keys.some((key) => typeof key !== "string" || !expectedKeys.has(key))) {
    throw new Error("AutoFill unavailable");
  }
  const snapshot: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) throw new Error("AutoFill unavailable");
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function isExactRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length
    && actual.every((key) => typeof key === "string" && keys.includes(key));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 2_048;
}

function isNativeUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
