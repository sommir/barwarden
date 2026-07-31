import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BitwardenApiClient,
  BitwardenApiError,
  buildBitwardenEnvironment,
  type HttpTransport,
} from "../../src/bitwarden-api/bitwarden-api";
import { AuthSessionStore } from "../../src/auth/auth-session-store";
import { AuthTokenRefreshService } from "../../src/auth/auth-token-refresh.service";
import {
  OfficialMasterPasswordCrypto,
  kdfConfigFromPrelogin,
} from "../../src/auth/master-password-crypto";
import {
  AUTH_CONTRACT_ROWS,
  LiveIdentityChallengeError,
  classifyLiveAuthenticationFailure,
  loginLiveServiceWithChallenge,
  liveIdentityChallengeKind,
  officialNodeCryptoAdapter,
  runLiveAuthenticationRow,
  selfHostedLiveEnvironment,
} from "./live-standard-password-login";

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

export const EXPECTED_AUTH_CONTRACT_ROWS = [
  "cloud-us-endpoints", "cloud-eu-endpoints", "self-hosted-path-endpoints",
  "pbkdf2-prelogin", "argon2id-prelogin", "password-grant", "refresh-token-rotated",
  "refresh-token-retained", "invalid-credentials", "network-unreachable", "tls-rejected",
  "rate-limited", "server-error", "email-two-factor", "authenticator-two-factor",
  "new-device-otp",
] as const;

describe("M14 live authentication contract", () => {
  it("declares every credential-free authentication matrix row exactly once", () => {
    expect(AUTH_CONTRACT_ROWS).toEqual(EXPECTED_AUTH_CONTRACT_ROWS);
  });

  it("pins cloud and path-preserving self-hosted authentication endpoints", () => {
    expect(buildBitwardenEnvironment()).toMatchObject({
      apiUrl: "https://api.bitwarden.com",
      identityUrl: "https://identity.bitwarden.com",
    });
    expect(buildBitwardenEnvironment({ region: "EU" })).toMatchObject({
      apiUrl: "https://api.bitwarden.eu",
      identityUrl: "https://identity.bitwarden.eu",
    });
    expect(selfHostedLiveEnvironment("https://vault.example.test/base/")).toMatchObject({
      apiUrl: "https://vault.example.test/base/api",
      identityUrl: "https://vault.example.test/base/identity",
    });
  });

  it("records the official authentication requests without retaining private input", async () => {
    const transport = new RecordingTransport();
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.postPasswordPrelogin({ email: "operator@example.test" });
    await client.postPasswordToken({
      clientId: "browser",
      email: "operator@example.test",
      masterPasswordHash: "derived-authentication-hash",
      twoFactor: { provider: 1, token: "123456" },
    });
    await client.postRefreshToken({ clientId: "browser", refreshToken: "stored-refresh-token" });
    await client.getSync("access-token");
    await client.postTwoFactorEmail({
      email: "operator@example.test",
      deviceIdentifier: "00000000-0000-4000-8000-000000000000",
    });
    await client.postResendNewDeviceOtp({
      email: "operator@example.test",
      masterPasswordHash: "derived-authentication-hash",
    });

    expect(transport.requests.map((request) => request.url)).toEqual([
      "https://identity.bitwarden.com/accounts/prelogin/password",
      "https://identity.bitwarden.com/connect/token",
      "https://identity.bitwarden.com/connect/token",
      "https://api.bitwarden.com/sync?excludeDomains=true",
      "https://api.bitwarden.com/two-factor/send-email-login",
      "https://api.bitwarden.com/accounts/resend-new-device-otp",
    ]);
    const passwordGrant = formBody(transport.requests[1]!.init.body);
    expect(passwordGrant).toMatchObject({
      scope: "api offline_access",
      client_id: "browser",
      grant_type: "password",
      twoFactorProvider: "1",
    });
    const refreshGrant = formBody(transport.requests[2]!.init.body);
    expect(refreshGrant).toEqual({
      grant_type: "refresh_token",
      client_id: "browser",
      refresh_token: "stored-refresh-token",
    });
    for (const prohibited of [
      "username", "password", "deviceType", "deviceIdentifier", "deviceName",
      "twoFactorToken", "twoFactorProvider", "twoFactorRemember", "newDeviceOtp",
    ]) {
      expect(refreshGrant).not.toHaveProperty(prohibited);
    }
  });

  it("derives PBKDF2 and Argon2id material with the official crypto adapter", async () => {
    const captured: Uint8Array[] = [];
    const adapter = officialNodeCryptoAdapter(() => undefined);
    const crypto = new OfficialMasterPasswordCrypto({
      async deriveKdfMaterial(password, salt, kdf) {
        captured.push(password, salt);
        return adapter.deriveKdfMaterial(password, salt, kdf);
      },
      decryptUserKeyWithMasterKey: adapter.decryptUserKeyWithMasterKey,
    });

    for (const prelogin of [
      { Kdf: 0, KdfIterations: 5_000 },
      { Kdf: 1, KdfIterations: 2, KdfMemory: 16, KdfParallelism: 1 },
    ] as const) {
      const derivation = await crypto.derive({
        email: "operator@example.test",
        masterPassword: "synthetic-master-password",
        kdf: kdfConfigFromPrelogin(prelogin),
      });
      expect(derivation.masterKey).toHaveLength(32);
      expect(derivation.authenticationHashB64).not.toBe("");
      derivation.masterKey.fill(0);
    }
    expect(captured).toHaveLength(4);
    expect(captured.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
    expect(() => kdfConfigFromPrelogin({ Kdf: 2, KdfIterations: 5_000 })).toThrow(
      "Unsupported password KDF",
    );
  });

  it("keeps refresh responses bounded to rotated or retained refresh state", async () => {
    const api = {
      environment: buildBitwardenEnvironment(),
      postRefreshToken: async () => ({
        access_token: "fresh-access-token",
        token_type: "Bearer",
        expires_in: 60,
      }),
    };
    const session = {
      environment: api.environment,
      token: {
        accessToken: "stored-access-token",
        refreshToken: "stored-refresh-token",
        tokenType: "Bearer",
        expiresIn: 60,
        clientId: "browser" as const,
      },
    };
    const refreshed = await new AuthTokenRefreshService(api).refresh(session);

    expect(refreshed.token.refreshToken).toBe("stored-refresh-token");
    expect(refreshed.token).not.toHaveProperty("email");
    expect(refreshed.token).not.toHaveProperty("masterPassword");
  });

  it("recognizes only retained live challenge providers without exposing Identity details", () => {
    expect(liveIdentityChallengeKind({ responseJson: { TwoFactorProviders2: { 1: null } } }))
      .toBe("email-two-factor");
    expect(liveIdentityChallengeKind({ responseJson: { TwoFactorProviders2: { 0: null } } }))
      .toBe("authenticator-two-factor");
    expect(liveIdentityChallengeKind({ responseJson: { TwoFactorProviders2: { 2: null } } }))
      .toBeNull();
    expect(liveIdentityChallengeKind({
      responseJson: { ErrorModel: { Message: "new device verification required" } },
    })).toBe("new-device-otp");
  });

  it("declares absent live inputs as external skips without reading them", async () => {
    const outcome = await runLiveAuthenticationRow("cloud-us", {});

    expect(outcome).toEqual({
      login: {
        service: "cloud-us",
        mode: "read-only",
        stage: "token",
        status: "skipped_external",
        reasonCode: "credentials_absent",
      },
      refresh: {
        service: "cloud-us",
        mode: "read-only",
        stage: "refresh",
        status: "skipped_external",
        reasonCode: "credentials_absent",
      },
      sync: {
        service: "cloud-us",
        mode: "read-only",
        stage: "sync",
        status: "skipped_external",
        reasonCode: "credentials_absent",
      },
    });
  });

  it("forwards the runtime environment from the Playwright matrix instead of forcing absent inputs", () => {
    const source = readFileSync(
      join(process.cwd(), "apps/menubar-tauri/e2e/live/live-auth-matrix.spec.ts"),
      "utf8",
    );

    expect(source).toContain("runLiveAuthenticationRow(service, process.env)");
    expect(source).not.toContain("return {};");
  });

  it("routes vault and Text Send scenario logins through the shared challenge-aware login", () => {
    for (const file of ["live-vault-matrix.spec.ts", "live-text-send-matrix.spec.ts"]) {
      const source = readFileSync(join(process.cwd(), "apps/menubar-tauri/e2e/live", file), "utf8");
      expect(source).toContain("loginLiveServiceWithChallenge(");
    }
  });

  it.each([
    ["email-two-factor", "BARWARDEN_LIVE_TWO_FACTOR_TOKEN", 1],
    ["authenticator-two-factor", "BARWARDEN_LIVE_TWO_FACTOR_TOKEN", 0],
    ["new-device-otp", "BARWARDEN_LIVE_NEW_DEVICE_OTP", null],
  ] as const)(
    "returns exact challenge_input_absent truth for an absent %s input",
    async (kind) => {
      const loginAndSync = vi.fn(async () => {
        throw new LiveIdentityChallengeError(kind);
      });

      const result = await loginLiveServiceWithChallenge(
        buildBitwardenEnvironment(),
        "operator@example.test",
        "synthetic-master-password",
        {},
        loginAndSync,
      );

      expect(result).toEqual({
        status: "blocked_external",
        reasonCode: "challenge_input_absent",
        challenge: kind,
      });
      expect(loginAndSync).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["email-two-factor", "BARWARDEN_LIVE_TWO_FACTOR_TOKEN", 1],
    ["authenticator-two-factor", "BARWARDEN_LIVE_TWO_FACTOR_TOKEN", 0],
    ["new-device-otp", "BARWARDEN_LIVE_NEW_DEVICE_OTP", null],
  ] as const)(
    "reuses supplied %s input in a subsequent scenario login without reporting its value",
    async (kind, inputName, provider) => {
      const challengeInput = "synthetic-private-challenge";
      const loginAndSync = vi.fn()
        .mockRejectedValueOnce(new LiveIdentityChallengeError(kind))
        .mockResolvedValueOnce(syntheticLiveLogin(buildBitwardenEnvironment()));

      const result = await loginLiveServiceWithChallenge(
        buildBitwardenEnvironment(),
        "operator@example.test",
        "synthetic-master-password",
        { [inputName]: challengeInput },
        loginAndSync,
      );

      expect(result.status).toBe("ready");
      expect(loginAndSync).toHaveBeenCalledTimes(2);
      const retryOptions = loginAndSync.mock.calls[1]![3];
      if (provider === null) {
        expect(retryOptions).toEqual({ syncAfterLogin: false, newDeviceOtp: challengeInput });
      } else {
        expect(retryOptions).toEqual({
          syncAfterLogin: false,
          twoFactor: { provider, token: challengeInput },
        });
      }
      expect(JSON.stringify({ status: result.status, challenge: result.challenge })).not.toContain(challengeInput);
    },
  );

  it.each([
    ["cloud-us", "US", "https://identity.bitwarden.com"],
    ["cloud-eu", "EU", "https://identity.bitwarden.eu"],
  ] as const)(
    "lets a complete %s input map reach only its selected region",
    async (service, region, expectedIdentityUrl) => {
      vi.stubGlobal("fetch", vi.fn(() => {
        throw new Error("Unexpected real transport");
      }));
      const loginAndSync = vi.fn(async (environment) => syntheticLiveLogin(environment));

      const outcome = await runLiveAuthenticationRow(
        service,
        completeCloudInputs(region),
        { loginAndSync },
      );

      expect(loginAndSync).toHaveBeenCalledOnce();
      expect(loginAndSync.mock.calls[0]![0].identityUrl).toBe(expectedIdentityUrl);
      expect(outcome.login).toMatchObject({ status: "passed" });
      expect(outcome.refresh).toMatchObject({ status: "passed" });
      expect(outcome.sync).toMatchObject({ status: "passed" });
    },
  );

  it.each([
    ["cloud-us", "EU"],
    ["cloud-eu", "US"],
  ] as const)(
    "skips %s before transport when the complete map selects %s",
    async (service, region) => {
      vi.stubGlobal("fetch", vi.fn(() => {
        throw new Error("Unexpected real transport");
      }));
      const loginAndSync = vi.fn(async (environment) => syntheticLiveLogin(environment));

      const outcome = await runLiveAuthenticationRow(
        service,
        completeCloudInputs(region),
        { loginAndSync },
      );

      expect(loginAndSync).not.toHaveBeenCalled();
      expect(outcome.login).toEqual({
        service,
        mode: "read-only",
        stage: "token",
        status: "skipped_external",
        reasonCode: "service_not_selected",
      });
      expect(JSON.stringify(outcome)).not.toContain(region);
    },
  );

  it("blocks partial injected maps before transport", async () => {
    const loginAndSync = vi.fn(async (environment) => syntheticLiveLogin(environment));

    const outcome = await runLiveAuthenticationRow(
      "cloud-us",
      { BARWARDEN_LIVE_CLOUD_REGION: "US" },
      { loginAndSync },
    );

    expect(loginAndSync).not.toHaveBeenCalled();
    expect(outcome.login).toMatchObject({
      status: "blocked_external",
      reasonCode: "credentials_partial",
    });
  });

  it("does not enumerate unrelated environment values while running a complete map", async () => {
    const inputs = new Proxy(completeCloudInputs("US"), {
      ownKeys() {
        throw new Error("Live runner must not enumerate environment values");
      },
    });
    const loginAndSync = vi.fn(async (environment) => syntheticLiveLogin(environment));

    const outcome = await runLiveAuthenticationRow("cloud-us", inputs, { loginAndSync });

    expect(outcome.login).toMatchObject({ status: "passed" });
    expect(outcome.refresh).toMatchObject({ status: "passed" });
    expect(outcome.sync).toMatchObject({ status: "passed" });
  });

  it.each([
    [new BitwardenApiError(400, { error: "invalid_grant" }), "invalid_credentials"],
    [new BitwardenApiError(401, {
      ErrorModel: { Message: "Username or password is incorrect. Try again." },
    }), "invalid_credentials"],
    [new BitwardenApiError(400, { error: "version_header_missing" }), "stage_failed"],
    [new BitwardenApiError(400, { private: "ignored" }), "stage_failed"],
    [new BitwardenApiError(429, { private: "ignored" }), "rate_limited"],
    [new BitwardenApiError(500, { private: "ignored" }), "server_error"],
    [new BitwardenApiError(503, { private: "ignored" }), "server_error"],
    [new TypeError("fetch failed"), "network_unreachable"],
    [Object.assign(new Error("request failed"), { cause: { code: "ENOTFOUND" } }), "network_unreachable"],
    [Object.assign(new TypeError("fetch failed"), { cause: { code: "CERT_HAS_EXPIRED" } }), "tls_rejected"],
    [Object.assign(new Error("request failed"), { cause: { code: "ERR_TLS_CERT_ALTNAME_INVALID" } }), "tls_rejected"],
    [new Error("unknown https://private.example.test operator@example.test token-value"), "stage_failed"],
  ] as const)("classifies a synthetic live failure as %s", (error, expectedReason) => {
    const reason = classifyLiveAuthenticationFailure(error);

    expect(reason).toBe(expectedReason);
    expect(JSON.stringify({ reason })).not.toContain("private.example.test");
    expect(JSON.stringify({ reason })).not.toContain("operator@example.test");
    expect(JSON.stringify({ reason })).not.toContain("token-value");
  });

  it("uses the fixed classifier for runner failures without reflecting private error data", async () => {
    vi.stubGlobal("fetch", vi.fn(() => {
      throw new Error("Unexpected real transport");
    }));
    const loginAndSync = vi.fn(async () => {
      throw new BitwardenApiError(429, {
        url: "https://private.example.test",
        email: "operator@example.test",
        token: "private-token-value",
      });
    });

    const outcome = await runLiveAuthenticationRow(
      "cloud-us",
      completeCloudInputs("US"),
      { loginAndSync },
    );

    expect(outcome.login).toMatchObject({ status: "failed", reasonCode: "rate_limited" });
    expect(JSON.stringify(outcome)).not.toContain("private.example.test");
    expect(JSON.stringify(outcome)).not.toContain("operator@example.test");
    expect(JSON.stringify(outcome)).not.toContain("private-token-value");
  });

  it.each(["login", "refresh", "sync"] as const)(
    "maps the fixed transport timeout at the %s stage without exposing its message",
    async (failureStage) => {
      const loginAndSync = vi.fn(async (environment) => {
        if (failureStage === "login") {
          throw transportTimeout();
        }
        const result = syntheticLiveLogin(environment);
        return {
          ...result,
          api: {
            ...result.api,
            ...(failureStage === "refresh"
              ? { postRefreshToken: async () => { throw transportTimeout(); } }
              : {}),
            ...(failureStage === "sync"
              ? { getSync: async () => { throw transportTimeout(); } }
              : {}),
          },
        };
      });

      const outcome = await runLiveAuthenticationRow(
        "cloud-us",
        completeCloudInputs("US"),
        { loginAndSync },
      );

      expect(outcome).toEqual(expectedTimeoutOutcome(failureStage));
      expect(JSON.stringify(outcome)).not.toContain("Bitwarden API request timed out");
    },
  );
});

class RecordingTransport implements HttpTransport {
  readonly requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];

  async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    this.requests.push({ url, init });
    return {} as T;
  }
}

function formBody(body: BodyInit | null | undefined): Record<string, string> {
  if (!(body instanceof URLSearchParams)) {
    throw new Error("Expected form request body");
  }
  return Object.fromEntries(body);
}

function completeCloudInputs(region: "US" | "EU"): Record<string, string> {
  return {
    BARWARDEN_LIVE_CLOUD_REGION: region,
    BARWARDEN_LIVE_CLOUD_EMAIL: "operator@example.test",
    BARWARDEN_LIVE_CLOUD_PASSWORD: "synthetic-master-password",
  };
}

function syntheticLiveLogin(environment: ReturnType<typeof buildBitwardenEnvironment>) {
  return {
    api: {
      postRefreshToken: async () => ({
        access_token: "fresh-access-token",
        refresh_token: "fresh-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
      }),
      getSync: async () => ({ Ciphers: [], Folders: [] }),
    },
    session: {
      environment,
      token: {
        accessToken: "stored-access-token",
        refreshToken: "stored-refresh-token",
        tokenType: "Bearer",
        expiresIn: 3600,
        clientId: "browser" as const,
      },
    },
  };
}

function transportTimeout(): Error {
  return new Error("Bitwarden API request timed out");
}

function expectedTimeoutOutcome(failureStage: "login" | "refresh" | "sync") {
  const passed = (stage: "token" | "refresh") => ({
    service: "cloud-us" as const,
    mode: "read-only" as const,
    stage,
    status: "passed" as const,
  });
  const failed = (stage: "token" | "refresh" | "sync") => ({
    service: "cloud-us" as const,
    mode: "read-only" as const,
    stage,
    status: "failed" as const,
    reasonCode: "network_unreachable" as const,
  });
  const blocked = (stage: "refresh" | "sync") => ({
    service: "cloud-us" as const,
    mode: "read-only" as const,
    stage,
    status: "blocked_external" as const,
    reasonCode: "network_unreachable" as const,
  });

  if (failureStage === "login") {
    return { login: failed("token"), refresh: blocked("refresh"), sync: blocked("sync") };
  }
  if (failureStage === "refresh") {
    return { login: passed("token"), refresh: failed("refresh"), sync: blocked("sync") };
  }
  return { login: passed("token"), refresh: passed("refresh"), sync: failed("sync") };
}
