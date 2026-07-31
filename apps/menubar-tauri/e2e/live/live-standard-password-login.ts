import { createRequire } from "node:module";

import type { Kdf } from "@bitwarden/sdk-internal";

import { environmentFromServerUrl } from "../../src/app/auth/vault-sync.shared";
import {
  BitwardenApiClient,
  BitwardenApiError,
  FetchHttpTransport,
  buildBitwardenEnvironment,
  type BitwardenEnvironment,
  type RefreshTokenRequest,
  type RefreshTokenResponseShape,
} from "../../src/bitwarden-api/bitwarden-api";
import type { HostApi } from "../../src/host/host-api";
import { AuthSessionStore, type AuthSession } from "../../src/auth/auth-session-store";
import { AuthTokenRefreshService } from "../../src/auth/auth-token-refresh.service";
import { OfficialMasterPasswordCrypto } from "../../src/auth/master-password-crypto";
import { PasswordLoginService } from "../../src/auth/password-login.service";
import {
  assertNoLiveSecrets,
  liveInputState,
  requireLiveInputSet,
  resolveLiveDisposition,
  type LiveReasonCode,
  type LiveRowStatus,
  type LiveServiceClass,
  type LiveStage as LiveProtocolStage,
  type LiveStageResult,
  type LiveInputState,
} from "./live-test-protocol";

export { liveInputState, requireLiveInputSet, type LiveInputState } from "./live-test-protocol";

const require = createRequire(import.meta.url);

export const selfHostedInputNames = [
  "BARWARDEN_LIVE_SERVER_URL",
  "BARWARDEN_LIVE_EMAIL",
  "BARWARDEN_LIVE_PASSWORD",
] as const;

export const cloudInputNames = [
  "BARWARDEN_LIVE_CLOUD_REGION",
  "BARWARDEN_LIVE_CLOUD_EMAIL",
  "BARWARDEN_LIVE_CLOUD_PASSWORD",
] as const;

export const AUTH_CONTRACT_ROWS = [
  "cloud-us-endpoints", "cloud-eu-endpoints", "self-hosted-path-endpoints",
  "pbkdf2-prelogin", "argon2id-prelogin", "password-grant", "refresh-token-rotated",
  "refresh-token-retained", "invalid-credentials", "network-unreachable", "tls-rejected",
  "rate-limited", "server-error", "email-two-factor", "authenticator-two-factor",
  "new-device-otp",
] as const;

export interface LiveAuthenticationOutcome {
  readonly login: LiveStageResult;
  readonly refresh: LiveStageResult;
  readonly sync: LiveStageResult;
  readonly challenge?: LiveStageResult;
}

type LiveLoginStage = "prelogin" | "sdk-kdf" | "authentication-hash" | "token" | "unwrap" | "sync";

export interface LiveLoginOptions {
  readonly syncAfterLogin?: boolean;
  readonly twoFactor?: { readonly provider: 0 | 1; readonly token: string };
  readonly newDeviceOtp?: string;
}

interface LiveAuthenticationApi extends Pick<BitwardenApiClient,
  "getSync" | "putPartialCipher" | "putArchiveCiphers" | "putUnarchiveCiphers" |
  "putDeleteCipher" | "putRestoreCipher" | "deleteCipher"
> {
  postRefreshToken(request: RefreshTokenRequest): Promise<RefreshTokenResponseShape>;
}

export interface LivePasswordLoginResult {
  readonly api: LiveAuthenticationApi;
  readonly session: AuthSession;
}

export interface LiveAuthenticationRunnerDependencies {
  readonly loginAndSync?: (
    environment: BitwardenEnvironment,
    email: string,
    masterPassword: string,
    options?: LiveLoginOptions,
  ) => Promise<LivePasswordLoginResult>;
}

export type LiveIdentityChallengeKind =
  | "email-two-factor"
  | "authenticator-two-factor"
  | "new-device-otp";

export class LiveIdentityChallengeError extends Error {
  constructor(readonly kind: LiveIdentityChallengeKind) {
    super("Live identity requires a supported challenge");
  }
}

export type LiveChallengeLoginDisposition =
  | {
      readonly status: "ready";
      readonly login: LivePasswordLoginResult;
      readonly challenge?: LiveIdentityChallengeKind;
    }
  | {
      readonly status: "blocked_external";
      readonly reasonCode: "challenge_input_absent";
      readonly challenge: LiveIdentityChallengeKind;
    };

class LiveAuthenticationFailureError extends Error {
  constructor(readonly reasonCode: LiveReasonCode) {
    super("Live authentication did not complete");
  }
}

export async function livePasswordLoginAndSync(
  environment: BitwardenEnvironment,
  email: string,
  masterPassword: string,
  options: LiveLoginOptions = {},
): Promise<LivePasswordLoginResult> {
  let stage: LiveLoginStage = "prelogin";
  const api = new BitwardenApiClient(environment, new FetchHttpTransport());
  const loginApi = {
    environment,
    async postPasswordPrelogin(request: { readonly email: string }) {
      stage = "prelogin";
      return api.postPasswordPrelogin(request);
    },
    async postPasswordToken(request: Parameters<BitwardenApiClient["postPasswordToken"]>[0]) {
      stage = "token";
      return api.postPasswordToken(request);
    },
    async postTwoFactorEmail(request: Parameters<BitwardenApiClient["postTwoFactorEmail"]>[0]) {
      return api.postTwoFactorEmail(request);
    },
    async postResendNewDeviceOtp(request: Parameters<BitwardenApiClient["postResendNewDeviceOtp"]>[0]) {
      return api.postResendNewDeviceOtp(request);
    },
  };
  const login = new PasswordLoginService(
    loginApi,
    new AuthSessionStore(new LiveIsolationHost()),
    new OfficialMasterPasswordCrypto(officialNodeCryptoAdapter((nextStage) => {
      stage = nextStage;
    })),
  );

  let session;
  try {
    session = await login.login({
      email,
      masterPassword,
      ...(options.twoFactor ? { twoFactor: options.twoFactor } : {}),
      ...(options.newDeviceOtp ? { newDeviceOtp: options.newDeviceOtp } : {}),
    });
  } catch (error) {
    const challenge = stage === "token" ? liveIdentityChallengeKind(error) : null;
    if (challenge) {
      throw new LiveIdentityChallengeError(challenge);
    }
    throw new LiveAuthenticationFailureError(classifyLiveAuthenticationFailure(error));
  }

  if (options.syncAfterLogin === false) {
    return { api, session };
  }
  stage = "sync";
  const sync = await fixedLiveStageAsync("Live sync did not complete", () =>
    api.getSync(session.token.accessToken),
  );
  assertSyncStructure(sync);
  return { api, session };
}

export function liveLoginOptionsFromEnvironment(
  challenge: LiveIdentityChallengeKind,
  inputs: Readonly<Record<string, string | undefined>> = process.env,
  baseOptions: LiveLoginOptions = { syncAfterLogin: false },
):
  | { readonly status: "ready"; readonly options: LiveLoginOptions }
  | { readonly status: "blocked_external"; readonly reasonCode: "challenge_input_absent" } {
  const input = challenge === "new-device-otp"
    ? inputs.BARWARDEN_LIVE_NEW_DEVICE_OTP
    : inputs.BARWARDEN_LIVE_TWO_FACTOR_TOKEN;
  if (!input?.trim()) {
    return { status: "blocked_external", reasonCode: "challenge_input_absent" };
  }
  return {
    status: "ready",
    options: {
      ...baseOptions,
      ...(challenge === "new-device-otp"
        ? { newDeviceOtp: input }
        : {
            twoFactor: {
              provider: challenge === "email-two-factor" ? 1 : 0,
              token: input,
            },
          }),
    },
  };
}

export async function loginLiveServiceWithChallenge(
  environment: BitwardenEnvironment,
  email: string,
  masterPassword: string,
  inputs: Readonly<Record<string, string | undefined>> = process.env,
  loginAndSync: NonNullable<LiveAuthenticationRunnerDependencies["loginAndSync"]> = livePasswordLoginAndSync,
): Promise<LiveChallengeLoginDisposition> {
  const baseOptions: LiveLoginOptions = { syncAfterLogin: false };
  try {
    return {
      status: "ready",
      login: await loginAndSync(environment, email, masterPassword, baseOptions),
    };
  } catch (error) {
    if (!(error instanceof LiveIdentityChallengeError)) throw error;
    const disposition = liveLoginOptionsFromEnvironment(error.kind, inputs, baseOptions);
    if (disposition.status !== "ready") {
      return { ...disposition, challenge: error.kind };
    }
    return {
      status: "ready",
      login: await loginAndSync(environment, email, masterPassword, disposition.options),
      challenge: error.kind,
    };
  }
}

export async function runLiveAuthenticationRow(
  service: LiveServiceClass,
  inputs: Readonly<Record<string, string | undefined>>,
  dependencies: LiveAuthenticationRunnerDependencies = {},
): Promise<LiveAuthenticationOutcome> {
  const inputNames = service === "self-hosted" ? selfHostedInputNames : cloudInputNames;
  const disposition = resolveLiveDisposition(inputNames, "read-only", inputs);
  if (disposition.status !== "ready") {
    return externalAuthenticationOutcome(service, disposition.status, disposition.reasonCode);
  }

  let environment: BitwardenEnvironment;
  let email: string;
  let masterPassword: string;
  if (service === "self-hosted") {
    const completeInputs = requireLiveInputSet(selfHostedInputNames, inputs);
    environment = selfHostedLiveEnvironment(completeInputs.BARWARDEN_LIVE_SERVER_URL);
    email = completeInputs.BARWARDEN_LIVE_EMAIL;
    masterPassword = completeInputs.BARWARDEN_LIVE_PASSWORD;
  } else {
    const completeInputs = requireLiveInputSet(cloudInputNames, inputs);
    const selectedService = cloudServiceFromRegion(completeInputs.BARWARDEN_LIVE_CLOUD_REGION);
    if (selectedService !== service) {
      return selectedService
        ? externalAuthenticationOutcome(service, "skipped_external", "service_not_selected")
        : externalAuthenticationOutcome(service, "blocked_external", "stage_failed");
    }
    environment = officialCloudEnvironment(completeInputs.BARWARDEN_LIVE_CLOUD_REGION);
    email = completeInputs.BARWARDEN_LIVE_CLOUD_EMAIL;
    masterPassword = completeInputs.BARWARDEN_LIVE_CLOUD_PASSWORD;
  }

  const privateInputs = [email, masterPassword];

  try {
    const disposition = await loginLiveServiceWithChallenge(
      environment,
      email,
      masterPassword,
      inputs,
      dependencies.loginAndSync ?? livePasswordLoginAndSync,
    );
    if (disposition.status !== "ready") {
      return challengeInputAbsentOutcome(service);
    }
    return await refreshAndSyncLiveSession(
      service,
      disposition.login.api,
      disposition.login.session,
      privateInputs,
      disposition.challenge,
    );
  } catch (error) {
    return failedAuthenticationOutcome(service, classifyLiveAuthenticationFailure(error));
  }
}

export function officialCloudEnvironment(region: string): BitwardenEnvironment {
  switch (region.trim().toUpperCase()) {
    case "US":
      return buildBitwardenEnvironment();
    case "EU":
      return buildBitwardenEnvironment({ region: "EU" });
    default:
      throw new Error("Live cloud region must be US or EU");
  }
}

export function selfHostedLiveEnvironment(serverUrl: string): BitwardenEnvironment {
  return fixedLiveStage("Live self-hosted environment is invalid", () =>
    environmentFromServerUrl(normalizeSelfHostedLiveUrl(serverUrl)),
  );
}

async function refreshAndSyncLiveSession(
  service: LiveServiceClass,
  api: LiveAuthenticationApi,
  session: AuthSession,
  privateInputs: readonly string[],
  challenge?: LiveIdentityChallengeKind,
): Promise<LiveAuthenticationOutcome> {
  let stage: "refresh" | "sync" = "refresh";
  try {
    const refreshed = await new AuthTokenRefreshService({
      environment: session.environment,
      postRefreshToken: (request) => api.postRefreshToken(request),
    }).refresh(session);
    stage = "sync";
    const sync = await api.getSync(refreshed.token.accessToken);
    assertSyncStructure(sync);
    const outcome: LiveAuthenticationOutcome = {
      login: liveStageResult(service, "token", "passed"),
      refresh: liveStageResult(service, "refresh", "passed"),
      sync: liveStageResult(service, "sync", "passed"),
      challenge: challenge
        ? liveStageResult(service, "token", "passed")
        : liveStageResult(service, "token", "blocked_external", "challenge_not_triggered"),
    };
    assertNoLiveSecrets(JSON.stringify(outcome), privateInputs);
    return outcome;
  } catch (error) {
    const reasonCode = classifyLiveAuthenticationFailure(error);
    return stage === "refresh"
      ? failedRefreshOutcome(service, reasonCode)
      : failedSyncOutcome(service, reasonCode);
  }
}

function externalAuthenticationOutcome(
  service: LiveServiceClass,
  status: Exclude<LiveRowStatus, "passed" | "failed">,
  reasonCode: LiveStageResult["reasonCode"],
): LiveAuthenticationOutcome {
  return {
    login: liveStageResult(service, "token", status, reasonCode),
    refresh: liveStageResult(service, "refresh", status, reasonCode),
    sync: liveStageResult(service, "sync", status, reasonCode),
  };
}

function challengeInputAbsentOutcome(service: LiveServiceClass): LiveAuthenticationOutcome {
  return {
    login: liveStageResult(service, "token", "blocked_external", "challenge_input_absent"),
    refresh: liveStageResult(service, "refresh", "blocked_external", "challenge_input_absent"),
    sync: liveStageResult(service, "sync", "blocked_external", "challenge_input_absent"),
    challenge: liveStageResult(service, "token", "blocked_external", "challenge_input_absent"),
  };
}

function failedAuthenticationOutcome(
  service: LiveServiceClass,
  reasonCode: LiveReasonCode,
): LiveAuthenticationOutcome {
  return {
    login: liveStageResult(service, "token", "failed", reasonCode),
    refresh: liveStageResult(service, "refresh", "blocked_external", reasonCode),
    sync: liveStageResult(service, "sync", "blocked_external", reasonCode),
  };
}

function failedRefreshOutcome(
  service: LiveServiceClass,
  reasonCode: LiveReasonCode,
): LiveAuthenticationOutcome {
  return {
    login: liveStageResult(service, "token", "passed"),
    refresh: liveStageResult(service, "refresh", "failed", reasonCode),
    sync: liveStageResult(service, "sync", "blocked_external", reasonCode),
  };
}

function failedSyncOutcome(
  service: LiveServiceClass,
  reasonCode: LiveReasonCode,
): LiveAuthenticationOutcome {
  return {
    login: liveStageResult(service, "token", "passed"),
    refresh: liveStageResult(service, "refresh", "passed"),
    sync: liveStageResult(service, "sync", "failed", reasonCode),
  };
}

function liveStageResult(
  service: LiveServiceClass,
  stage: Extract<LiveProtocolStage, "token" | "refresh" | "sync">,
  status: LiveRowStatus,
  reasonCode?: LiveStageResult["reasonCode"],
): LiveStageResult {
  return {
    service,
    mode: "read-only",
    stage,
    status,
    ...(reasonCode ? { reasonCode } : {}),
  };
}

export function liveIdentityChallengeKind(
  error: unknown,
): LiveIdentityChallengeKind | null {
  if (!isRecord(error) || !isRecord(error["responseJson"])) {
    return null;
  }
  const details = error["responseJson"];
  const providers = details["TwoFactorProviders2"] ?? details["twoFactorProviders2"];
  const providerIds = Array.isArray(providers)
    ? providers.map(String)
    : isRecord(providers) ? Object.keys(providers) : [];
  if (providerIds.includes("1")) {
    return "email-two-factor";
  }
  if (providerIds.includes("0")) {
    return "authenticator-two-factor";
  }
  const model = details["ErrorModel"];
  const signals = [details["error"], isRecord(model) ? model["Message"] : undefined];
  return signals.some((value) =>
    typeof value === "string" && value.toLowerCase().replaceAll(/[^a-z]/g, "").includes("newdevice"),
  ) ? "new-device-otp" : null;
}

export function classifyLiveAuthenticationFailure(error: unknown): LiveReasonCode {
  if (error instanceof LiveAuthenticationFailureError) {
    return error.reasonCode;
  }
  if (error instanceof BitwardenApiError) {
    if (
      (error.status === 400 || error.status === 401) &&
      isInvalidCredentialResponse(error.responseJson)
    ) {
      return "invalid_credentials";
    }
    if (error.status === 429) {
      return "rate_limited";
    }
    if (error.status === 500 || error.status === 503) {
      return "server_error";
    }
    return "stage_failed";
  }

  const errors = errorChain(error);
  if (errors.some(isTlsFailure)) {
    return "tls_rejected";
  }
  if (errors.some(isNetworkFailure)) {
    return "network_unreachable";
  }
  return "stage_failed";
}

function isInvalidCredentialResponse(response: unknown): boolean {
  if (!isRecord(response)) {
    return false;
  }
  if (response["error"] === "invalid_grant") {
    return true;
  }

  const model = response["ErrorModel"];
  const message = isRecord(model) ? model["Message"] : undefined;
  return (
    typeof message === "string" &&
    message.toLowerCase().includes("username or password is incorrect")
  );
}

function cloudServiceFromRegion(
  region: string,
): Extract<LiveServiceClass, "cloud-us" | "cloud-eu"> | null {
  switch (region.trim().toUpperCase()) {
    case "US":
      return "cloud-us";
    case "EU":
      return "cloud-eu";
    default:
      return null;
  }
}

function errorChain(error: unknown): unknown[] {
  const errors: unknown[] = [];
  let current = error;
  for (let depth = 0; depth < 4 && current != null; depth += 1) {
    errors.push(current);
    current = isRecord(current) ? current["cause"] : undefined;
  }
  return errors;
}

function isTlsFailure(error: unknown): boolean {
  const code = errorCode(error);
  if ([
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  ].includes(code)) {
    return true;
  }
  return /\b(?:certificate|tls|ssl|self[- ]signed|unable to verify)\b/i.test(errorMessage(error));
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof Error && error.message === "Bitwarden API request timed out") {
    return true;
  }
  if (error instanceof TypeError) {
    return true;
  }
  const code = errorCode(error);
  if ([
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ENOTFOUND",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
  ].includes(code)) {
    return true;
  }
  return /\b(?:dns|fetch failed|network unreachable|getaddrinfo|connection refused)\b/i.test(
    errorMessage(error),
  );
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error["code"] === "string" ? error["code"] : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function normalizeSelfHostedLiveUrl(value: string): string {
  const trimmed = value.trim();
  const parsed = new URL(trimmed);
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    throw new Error("Live self-hosted environment is invalid");
  }
  return trimmed.replace(/\/+$/g, "");
}

export function officialNodeCryptoAdapter(
  setStage: (stage: Extract<LiveLoginStage, "sdk-kdf" | "authentication-hash" | "unwrap">) => void,
): {
  deriveKdfMaterial(password: Uint8Array, salt: Uint8Array, kdf: Kdf): Promise<Uint8Array>;
  decryptUserKeyWithMasterKey(encryptedUserKey: string, masterKey: Uint8Array): Promise<Uint8Array>;
} {
  interface NodePureCrypto {
    derive_kdf_material(password: Uint8Array, salt: Uint8Array, kdf: Kdf): Uint8Array;
    decrypt_user_key_with_master_key(encryptedUserKey: string, masterKey: Uint8Array): Uint8Array;
  }
  const { PureCrypto } = require("@bitwarden/sdk-internal") as {
    readonly PureCrypto: NodePureCrypto;
  };

  return {
    async deriveKdfMaterial(password, salt, kdf) {
      setStage("sdk-kdf");
      const result = PureCrypto.derive_kdf_material(password, salt, kdf);
      if (result.byteLength !== 32) {
        throw new Error("Official KDF output must be 32 bytes");
      }
      setStage("authentication-hash");
      return result;
    },
    async decryptUserKeyWithMasterKey(encryptedUserKey, masterKey) {
      setStage("unwrap");
      if (!encryptedUserKey.trim() || masterKey.byteLength !== 32) {
        throw new Error("Official user-key unwrap input is invalid");
      }
      return PureCrypto.decrypt_user_key_with_master_key(encryptedUserKey, masterKey);
    },
  };
}

function assertSyncStructure(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error("Live sync response must be structured");
  }
  const ciphers = value["Ciphers"] ?? value["ciphers"];
  const folders = value["Folders"] ?? value["folders"];
  if (!Array.isArray(ciphers)) {
    throw new Error("Live sync response must include ciphers structure");
  }
  if (!Array.isArray(folders)) {
    throw new Error("Live sync response must include folders structure");
  }
}

export function fixedLiveStage<T>(message: string, operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new Error(message);
  }
}

export async function fixedLiveStageAsync<T>(
  message: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class LiveIsolationHost implements HostApi {
  showPopup(): Promise<void> { return Promise.resolve(); }
  hidePopup(): Promise<void> { return Promise.resolve(); }
  copyText(): Promise<void> { return Promise.resolve(); }
  pasteText(): Promise<void> { return Promise.resolve(); }
  openUrl(): Promise<void> { return Promise.resolve(); }
  secureGet(): Promise<string | null> { return Promise.resolve(null); }
  secureSet(): Promise<void> {
    return Promise.reject(new Error("Live session persistence is disabled"));
  }
  secureDelete(): Promise<void> {
    return Promise.reject(new Error("Live session persistence is disabled"));
  }
}
