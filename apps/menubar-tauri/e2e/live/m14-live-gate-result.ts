import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

import type { LiveServiceClass, LiveStageResult } from "./live-test-protocol";

export type LiveGateFailureId =
  | "chromium_live_matrix_failed"
  | `live_auth_${LiveFailureService}_${LiveAuthFailureStage}_failed`
  | `live_vault_${LiveFailureService}_${LiveVaultFailureStage}_failed`
  | `live_text_send_${LiveFailureService}_${LiveTextSendFailureStage}_failed`;

type LiveFailureService = "cloud_us" | "cloud_eu" | "self_hosted";
type LiveAuthFailureStage = "token" | "refresh" | "sync";
type LiveVaultFailureStage = "read_only" | "folder" | "login" | "card" | "identity" | "secure_note";
type LiveTextSendFailureStage = "text_send" | "file_send_non_interference";

const resultEnvironmentName = "BARWARDEN_LIVE_RESULT_PATH";
const failureServices = ["cloud_us", "cloud_eu", "self_hosted"] as const;
const allowedFailures = new Set<LiveGateFailureId>([
  "chromium_live_matrix_failed",
  ...failureServices.flatMap((service) =>
    (["token", "refresh", "sync"] as const).map((stage) => `live_auth_${service}_${stage}_failed` as const),
  ),
  ...failureServices.flatMap((service) =>
    (["read_only", "folder", "login", "card", "identity", "secure_note"] as const)
      .map((stage) => `live_vault_${service}_${stage}_failed` as const),
  ),
  ...failureServices.flatMap((service) =>
    (["text_send", "file_send_non_interference"] as const)
      .map((stage) => `live_text_send_${service}_${stage}_failed` as const),
  ),
]);
const allowedServices = new Set(["self-hosted", "cloud-us", "cloud-eu"]);
const allowedModes = new Set(["read-only", "mutation"]);
const allowedStages = new Set([
  "token", "refresh", "sync", "folder", "login", "card", "identity", "secure-note",
  "text-send", "file-send-non-interference",
]);
const allowedStatuses = new Set(["passed", "skipped_external", "blocked_external", "failed"]);
const allowedReasons = new Set([
  "credentials_absent", "credentials_partial", "mutation_disabled", "service_not_selected",
  "challenge_not_triggered", "challenge_input_absent", "network_unreachable", "tls_rejected",
  "invalid_credentials", "rate_limited", "server_error", "stage_failed", "cleanup_failed",
]);
const serviceOrder = ["cloud-us", "cloud-eu", "self-hosted"];
const mutationStageOrder = [
  "folder", "login", "card", "identity", "secure-note", "text-send", "file-send-non-interference",
];

interface LiveGateResult {
  readonly schema: "m14-live-gate-result-v1";
  readonly rows: LiveStageResult[];
  readonly failure: LiveGateFailureId | null;
}

export function recordLiveGateRows(
  rows: readonly LiveStageResult[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const path = environment[resultEnvironmentName];
  if (!path) return;
  for (const row of rows) assertLiveGateRow(row);
  const current = readCurrentResult(path);
  writeResult(path, { ...current, rows: orderRows([...current.rows, ...rows]) });
}

export function recordLiveGateFailure(
  failure: LiveGateFailureId,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const path = environment[resultEnvironmentName];
  if (!path) return;
  const safeFailure = allowedFailures.has(failure) ? failure : "chromium_live_matrix_failed";
  writeResult(path, { ...readCurrentResult(path), failure: safeFailure });
}

export function liveAuthenticationFailureId(
  service: LiveServiceClass,
  stage: LiveAuthFailureStage,
): LiveGateFailureId {
  return `live_auth_${failureService(service)}_${stage}_failed`;
}

export function liveVaultFailureId(
  service: LiveServiceClass,
  stage: "read-only" | Extract<LiveStageResult["stage"], "folder" | "login" | "card" | "identity" | "secure-note">,
): LiveGateFailureId {
  return `live_vault_${failureService(service)}_${stage.replaceAll("-", "_") as LiveVaultFailureStage}_failed`;
}

export function liveTextSendFailureId(
  service: LiveServiceClass,
  stage: Extract<LiveStageResult["stage"], "text-send" | "file-send-non-interference">,
): LiveGateFailureId {
  return `live_text_send_${failureService(service)}_${stage.replaceAll("-", "_") as LiveTextSendFailureStage}_failed`;
}

function failureService(service: LiveServiceClass): LiveFailureService {
  return service.replaceAll("-", "_") as LiveFailureService;
}

function readCurrentResult(path: string): LiveGateResult {
  if (!existsSync(path)) {
    return { schema: "m14-live-gate-result-v1", rows: [], failure: null };
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Live gate result is invalid");
  }
  if (!isRecord(value) || value.schema !== "m14-live-gate-result-v1" || !Array.isArray(value.rows)) {
    throw new Error("Live gate result is invalid");
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["failure", "rows", "schema"])) {
    throw new Error("Live gate result is invalid");
  }
  if (value.failure !== null && !allowedFailures.has(value.failure as LiveGateFailureId)) {
    throw new Error("Live gate result is invalid");
  }
  for (const row of value.rows) assertLiveGateRow(row);
  return value as unknown as LiveGateResult;
}

function writeResult(path: string, result: LiveGateResult): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(result)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function orderRows(rows: LiveStageResult[]): LiveStageResult[] {
  return serviceOrder.flatMap((service) => {
    const serviceRows = rows.filter((row) => row.service === service);
    const tokens = serviceRows.filter((row) => row.mode === "read-only" && row.stage === "token");
    const refresh = serviceRows.filter((row) => row.mode === "read-only" && row.stage === "refresh");
    const sync = serviceRows.filter((row) => row.mode === "read-only" && row.stage === "sync");
    return [
      ...tokens.slice(0, 1),
      ...refresh,
      ...sync,
      ...tokens.slice(1),
      ...mutationStageOrder.flatMap((stage) =>
        serviceRows.filter((row) => row.mode === "mutation" && row.stage === stage),
      ),
    ];
  });
}

function assertLiveGateRow(row: unknown): asserts row is LiveStageResult {
  if (!isRecord(row)) throw new Error("Live gate result row is invalid");
  const expectedKeys = row.status === "passed"
    ? ["mode", "service", "stage", "status"]
    : ["mode", "reasonCode", "service", "stage", "status"];
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(expectedKeys)) {
    throw new Error("Live gate result row is invalid");
  }
  if (
    !allowedServices.has(String(row.service)) ||
    !allowedModes.has(String(row.mode)) ||
    !allowedStages.has(String(row.stage)) ||
    !allowedStatuses.has(String(row.status)) ||
    (row.status !== "passed" && !allowedReasons.has(String(row.reasonCode)))
  ) {
    throw new Error("Live gate result row is invalid");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
