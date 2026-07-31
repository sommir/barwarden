import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildBitwardenEnvironment,
  buildSelfHostedEnvironmentFromServerUrl,
  type BitwardenEnvironment,
  type RefreshTokenRequest,
  type RefreshTokenResponseShape,
} from "../bitwarden-api/bitwarden-api";
import type { AuthSession } from "./auth-session-store";
import {
  AuthTokenRefreshService,
  RefreshRequiresLoginError,
  type AuthTokenRefreshApi,
} from "./auth-token-refresh.service";

describe("AuthTokenRefreshService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the client id that actually obtained the session instead of inferring it from environment", async () => {
    const cloudApi = new RecordingRefreshApi(buildBitwardenEnvironment());
    await new AuthTokenRefreshService(cloudApi).refresh(session({
      environment: buildBitwardenEnvironment(),
      clientId: "web",
    }));

    const selfHostedApi = new RecordingRefreshApi(
      buildSelfHostedEnvironmentFromServerUrl("https://vault.example.test"),
    );
    await new AuthTokenRefreshService(selfHostedApi).refresh(session({
      environment: buildSelfHostedEnvironmentFromServerUrl("https://vault.example.test"),
      clientId: "browser",
    }));

    expect(cloudApi.request).toEqual({
      clientId: "web",
      refreshToken: "stored-refresh-token",
    });
    expect(selfHostedApi.request).toEqual({
      clientId: "browser",
      refreshToken: "stored-refresh-token",
    });
  });

  it("migrates a legacy session from the access-token client_id claim", async () => {
    const api = new RecordingRefreshApi(buildBitwardenEnvironment());

    await new AuthTokenRefreshService(api).refresh(session({
      accessToken: jwt({ client_id: "browser" }),
      clientId: undefined,
    }));

    expect(api.request).toEqual({
      clientId: "browser",
      refreshToken: "stored-refresh-token",
    });
  });

  it("migrates a legacy official session from the desktop client_id claim", async () => {
    const api = new RecordingRefreshApi(buildBitwardenEnvironment());

    const refreshed = await new AuthTokenRefreshService(api).refresh(session({
      accessToken: jwt({ client_id: "desktop" }),
      clientId: undefined,
    }));

    expect(api.request).toEqual({
      clientId: "desktop",
      refreshToken: "stored-refresh-token",
    });
    expect(refreshed.token.clientId).toBe("desktop");
  });

  it("requires re-login when no stored or legacy issuer client id is known", async () => {
    const api = new RecordingRefreshApi(buildBitwardenEnvironment());

    await expect(
      new AuthTokenRefreshService(api).refresh(session({
        accessToken: jwt({ client_id: "unknown" }),
        clientId: undefined,
      })),
    ).rejects.toBeInstanceOf(RefreshRequiresLoginError);
    expect(api.request).toBeUndefined();
  });

  it("returns an immutable refreshed session while preserving the existing user key", async () => {
    const api = new RecordingRefreshApi(buildBitwardenEnvironment());
    const oldSession = session({
      clientId: "browser",
      userKeyB64: "stored-user-key",
    });

    const refreshed = await new AuthTokenRefreshService(api).refresh(oldSession);

    expect(refreshed).not.toBe(oldSession);
    expect(refreshed.environment).toBe(oldSession.environment);
    expect(refreshed.crypto).toEqual({ userKeyB64: "stored-user-key" });
    expect(refreshed.token).toEqual({
      accessToken: "fresh-access-token",
      refreshToken: "fresh-refresh-token",
      tokenType: "Bearer",
      expiresIn: 3600,
      clientId: "browser",
      obtainedAtEpochMs: expect.any(Number),
    });
  });

  it("retains the stored refresh token when the server omits rotation", async () => {
    const api = new RecordingRefreshApi(buildBitwardenEnvironment(), {
      access_token: "fresh-access-token",
      token_type: "Bearer",
      expires_in: 3600,
    } as RefreshTokenResponseShape);

    const refreshed = await new AuthTokenRefreshService(api).refresh(session({ clientId: "browser" }));

    expect(refreshed.token.refreshToken).toBe("stored-refresh-token");
  });

  it("sends refresh requests without login or challenge material", async () => {
    const api = new RecordingRefreshApi(buildBitwardenEnvironment());

    await new AuthTokenRefreshService(api).refresh(session({ clientId: "browser" }));

    expect(Object.keys(api.request ?? {}).sort()).toEqual(["clientId", "refreshToken"]);
  });

  it("derives expiry from the refreshed access token when expires_in is omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T00:00:00.000Z"));
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    const api = new RecordingRefreshApi(buildBitwardenEnvironment(), {
      access_token: jwt({ client_id: "browser", exp: expiresAt }),
      token_type: "Bearer",
      refresh_token: "fresh-refresh-token",
    } as RefreshTokenResponseShape);

    const refreshed = await new AuthTokenRefreshService(api).refresh(session({ clientId: "browser" }));

    expect(refreshed.token.expiresIn).toBe(3600);
    expect(refreshed.token.obtainedAtEpochMs).toBe(Date.now());
  });

  it.each([
    ["refresh_token", { refresh_token: 42 }],
    ["expires_in", { expires_in: "3600" }],
  ])("rejects a malformed present %s without exposing its value", async (_field, malformed) => {
    const api = new RecordingRefreshApi(buildBitwardenEnvironment(), {
      access_token: "fresh-access-token",
      token_type: "Bearer",
      ...malformed,
    } as unknown as RefreshTokenResponseShape);

    const refresh = new AuthTokenRefreshService(api).refresh(session({ clientId: "browser" }));

    await expect(refresh).rejects.toBeInstanceOf(RefreshRequiresLoginError);
    await expect(refresh).rejects.toThrow("Session refresh requires login");
  });
});

class RecordingRefreshApi implements AuthTokenRefreshApi {
  request?: RefreshTokenRequest;

  constructor(
    readonly environment: BitwardenEnvironment,
    private readonly response: RefreshTokenResponseShape = {
      access_token: "fresh-access-token",
      refresh_token: "fresh-refresh-token",
      token_type: "Bearer",
      expires_in: 3600,
    },
  ) {}

  async postRefreshToken(request: RefreshTokenRequest) {
    this.request = request;
    return this.response;
  }
}

function session(input: {
  environment?: BitwardenEnvironment;
  accessToken?: string;
  clientId?: "browser" | "web";
  userKeyB64?: string;
} = {}): AuthSession {
  return {
    environment: input.environment ?? buildBitwardenEnvironment(),
    token: {
      accessToken: input.accessToken ?? "stored-access-token",
      refreshToken: "stored-refresh-token",
      tokenType: "Bearer",
      expiresIn: 1,
      ...(input.clientId ? { clientId: input.clientId } : {}),
    },
    ...(input.userKeyB64 ? { crypto: { userKeyB64: input.userKeyB64 } } : {}),
  };
}

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: object): string =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}
