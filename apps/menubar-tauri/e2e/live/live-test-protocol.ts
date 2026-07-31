import type { VaultSyncResult } from "../../src/vault/vault-sync.service";

export type LiveServiceClass = "self-hosted" | "cloud-us" | "cloud-eu";
export type LiveMode = "read-only" | "mutation";
export type LiveStage =
  | "configuration" | "prelogin" | "kdf" | "token" | "unwrap" | "refresh" | "sync"
  | "folder" | "login" | "card" | "identity" | "secure-note" | "text-send"
  | "file-send-non-interference" | "cleanup";
export type LiveRowStatus = "passed" | "skipped_external" | "blocked_external" | "failed";
export type LiveReasonCode =
  | "credentials_absent" | "credentials_partial" | "mutation_disabled"
  | "service_not_selected"
  | "challenge_not_triggered" | "challenge_input_absent" | "network_unreachable"
  | "tls_rejected" | "invalid_credentials" | "rate_limited" | "server_error"
  | "stage_failed" | "cleanup_failed";
export interface LiveStageResult {
  readonly service: LiveServiceClass;
  readonly mode: LiveMode;
  readonly stage: LiveStage;
  readonly status: LiveRowStatus;
  readonly reasonCode?: LiveReasonCode;
}
export type LiveDisposition =
  | { readonly status: "ready" }
  | { readonly status: "skipped_external" | "blocked_external"; readonly reasonCode: LiveReasonCode };

export type LiveInputState = "absent" | "complete" | "partial";

export function resolveLiveDisposition(
  names: readonly string[],
  mode: LiveMode,
  inputs: Readonly<Record<string, string | undefined>> = process.env,
  controls: Readonly<Record<string, string | undefined>> = process.env,
): LiveDisposition {
  const inputState = liveInputState(names, inputs);
  if (inputState === "absent") {
    return { status: "skipped_external", reasonCode: "credentials_absent" };
  }
  if (inputState === "partial") {
    return { status: "blocked_external", reasonCode: "credentials_partial" };
  }
  if (mode === "mutation" && controls["BARWARDEN_LIVE_MUTATION"] !== "true") {
    return { status: "skipped_external", reasonCode: "mutation_disabled" };
  }
  return { status: "ready" };
}

export function resolveLiveServiceDisposition(
  service: LiveServiceClass,
  names: readonly string[],
  mode: LiveMode,
  inputs: Readonly<Record<string, string | undefined>> = process.env,
  controls: Readonly<Record<string, string | undefined>> = process.env,
): LiveDisposition {
  const disposition = resolveLiveDisposition(names, mode, inputs, controls);
  if (disposition.status !== "ready" || service === "self-hosted") return disposition;
  const region = inputs["BARWARDEN_LIVE_CLOUD_REGION"]?.trim().toUpperCase();
  if (region !== "US" && region !== "EU") {
    return { status: "blocked_external", reasonCode: "stage_failed" };
  }
  const selected = region === "EU" ? "cloud-eu" : "cloud-us";
  return selected === service
    ? disposition
    : { status: "skipped_external", reasonCode: "service_not_selected" };
}

export function liveInputState(
  names: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): LiveInputState {
  const presentCount = names.filter((name) => Boolean(environment[name]?.trim())).length;
  if (presentCount === 0) {
    return "absent";
  }
  return presentCount === names.length ? "complete" : "partial";
}

export function requireLiveInputSet<const TNames extends readonly string[]>(
  names: TNames,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Record<TNames[number], string> {
  if (liveInputState(names, environment) !== "complete") {
    throw new Error("Live test input configuration is incomplete");
  }
  return Object.fromEntries(names.map((name) => [name, environment[name]!])) as Record<
    TNames[number],
    string
  >;
}

export interface LiveRunContext {
  readonly service: LiveServiceClass;
  readonly mode: LiveMode;
  readonly prefix: string;
  readonly cleanup: LiveCleanupLedger;
  track(kind: "folder" | "cipher" | "send", id: string, decryptedName: string): void;
  trackedIds(): ReadonlySet<string>;
  trackedNames(): ReadonlySet<string>;
}

export function createLiveRunContext(
  service: LiveServiceClass,
  mode: LiveMode,
  randomBytes: (length: number) => Uint8Array = secureRandomBytes,
): LiveRunContext {
  const bytes = randomBytes(16);
  if (bytes.byteLength !== 16) {
    throw new Error("Live run identity must use 16 random bytes");
  }
  const prefix = `barwarden-m14-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const ids = new Set<string>();
  const names = new Set<string>();

  return {
    service,
    mode,
    prefix,
    cleanup: new LiveCleanupLedger(),
    track(kind, id, decryptedName) {
      if (!kind || !id.trim() || !decryptedName.startsWith(prefix) || ids.has(id)) {
        throw new Error("Live run resource tracking is invalid");
      }
      ids.add(id);
      names.add(decryptedName);
    },
    trackedIds: () => new Set(ids),
    trackedNames: () => new Set(names),
  };
}

export class LiveCleanupLedger {
  private readonly entries: Array<{ readonly cleanup: () => Promise<void> }> = [];

  register(_kind: "folder" | "cipher" | "send", cleanup: () => Promise<void>): void {
    this.entries.push({ cleanup });
  }

  async drain(): Promise<void> {
    const entries = this.entries.splice(0).reverse();
    let failed = false;
    for (const entry of entries) {
      try {
        await entry.cleanup();
      } catch {
        failed = true;
      }
    }
    if (failed) {
      throw new Error("Live cleanup did not complete");
    }
  }
}

export async function runLiveMutation(
  context: LiveRunContext,
  stage: LiveStage,
  privateInputs: readonly string[],
  body: () => Promise<void>,
  verifyCleanup: () => Promise<void>,
): Promise<LiveStageResult> {
  let bodyFailed = false;
  try {
    await body();
  } catch {
    bodyFailed = true;
  } finally {
    let cleanupFailed = false;
    try {
      await context.cleanup.drain();
    } catch {
      cleanupFailed = true;
    }
    try {
      await verifyCleanup();
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) {
      throw new Error("Live cleanup did not complete");
    }
  }
  if (bodyFailed) {
    throw new Error("Live mutation did not complete");
  }

  const result: LiveStageResult = {
    service: context.service,
    mode: context.mode,
    stage,
    status: "passed",
  };
  assertNoLiveSecrets(JSON.stringify(result), privateInputs);
  return result;
}

export function assertLiveCleanup(
  sync: unknown,
  decrypted: Pick<VaultSyncResult, "items" | "folders" | "sends">,
  context: LiveRunContext,
): void {
  if (!isRecord(sync)) {
    throw new Error("Live cleanup did not complete");
  }
  const trackedIds = context.trackedIds();
  const rawCollections = [
    ...requiredLiveCollections(sync, "Ciphers", "ciphers"),
    ...requiredLiveCollections(sync, "Folders", "folders"),
    ...requiredLiveCollections(sync, "Sends", "sends"),
  ];
  const rawIdRemains = rawCollections.some((collection) => collection.some((entry) => {
    if (!isRecord(entry)) {
      return false;
    }
    const id = entry["Id"] ?? entry["id"];
    return typeof id === "string" && trackedIds.has(id);
  }));
  const decryptedNameRemains = [decrypted.items, decrypted.folders, decrypted.sends]
    .flat()
    .some((entry) => isRecord(entry) && typeof entry["name"] === "string" && entry["name"].startsWith(context.prefix));

  if (rawIdRemains || decryptedNameRemains) {
    throw new Error("Live cleanup did not complete");
  }
}

export function assertNoLiveSecrets(text: string, privateInputs: readonly string[]): void {
  const hasPrivateInput = privateInputs.some((input) => input.trim() !== "" && text.includes(input));
  const hasCredentialShape = [
    /\bauthorization\s*:\s*bearer\b/i,
    /"(?:[a-z0-9_]*token[a-z0-9_]*|[a-z0-9_]*password[a-z0-9_]*)"\s*:/i,
    /\b[a-z][a-z0-9+.-]*:\/\/[^/\s@]+@/i,
    /\bhttps?:\/\/[^\s"']+/i,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  ].some((pattern) => pattern.test(text));
  if (hasPrivateInput || hasCredentialShape) {
    throw new Error("Live output contains private input");
  }
}

function requiredLiveCollections(
  sync: Record<string, unknown>,
  pascalCase: string,
  camelCase: string,
): unknown[][] {
  const keys = [pascalCase, camelCase].filter((key) => Object.hasOwn(sync, key));
  if (keys.length === 0 || keys.some((key) => !Array.isArray(sync[key]))) {
    throw new Error("Live cleanup did not complete");
  }
  return keys.map((key) => sync[key] as unknown[]);
}

function secureRandomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
