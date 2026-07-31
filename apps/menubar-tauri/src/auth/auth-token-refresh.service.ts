import { Injectable, InjectionToken } from "@angular/core";

import {
  BitwardenApiClient,
  isBitwardenClientId,
  type BitwardenClientId,
  type BitwardenEnvironment,
  type RefreshTokenRequest,
  type RefreshTokenResponseShape,
} from "../bitwarden-api/bitwarden-api";
import { createDefaultHostService } from "../host/default-host.service";
import type { AuthSession } from "./auth-session-store";

export interface AuthTokenRefreshApi {
  readonly environment: BitwardenEnvironment;
  postRefreshToken(request: RefreshTokenRequest): Promise<RefreshTokenResponseShape>;
}

export interface AuthTokenRefreshPort {
  refresh(session: AuthSession): Promise<AuthSession>;
}

export const AUTH_TOKEN_REFRESH_PORT = new InjectionToken<AuthTokenRefreshPort | null>(
  "AUTH_TOKEN_REFRESH_PORT",
  {
    providedIn: "root",
    factory: () => null,
  },
);

export class RefreshRequiresLoginError extends Error {
  override readonly name = "RefreshRequiresLoginError";

  constructor() {
    super("Session refresh requires login");
  }
}

@Injectable({ providedIn: "root" })
export class AuthTokenRefreshService implements AuthTokenRefreshPort {
  constructor(private readonly api: AuthTokenRefreshApi) {}

  async refresh(session: AuthSession): Promise<AuthSession> {
    const clientId = session.token.clientId ?? clientIdFromAccessToken(session.token.accessToken);
    if (!clientId) {
      throw new RefreshRequiresLoginError();
    }

    const response = await this.api.postRefreshToken({
      clientId,
      refreshToken: session.token.refreshToken,
    });

    if (!isRefreshTokenResponse(response)) {
      throw new RefreshRequiresLoginError();
    }

    const obtainedAtEpochMs = Date.now();
    const expiresIn = response.expires_in
      ?? expiresInFromAccessToken(response.access_token, obtainedAtEpochMs)
      ?? remainingSessionExpiresIn(session, obtainedAtEpochMs);

    return {
      environment: session.environment,
      token: {
        accessToken: response.access_token,
        refreshToken: response.refresh_token ?? session.token.refreshToken,
        tokenType: response.token_type,
        expiresIn,
        clientId,
        obtainedAtEpochMs,
      },
      ...(session.crypto ? { crypto: { userKeyB64: session.crypto.userKeyB64 } } : {}),
    };
  }
}

export function createDefaultAuthTokenRefreshService(session: AuthSession): AuthTokenRefreshService {
  return new AuthTokenRefreshService(
    new BitwardenApiClient(session.environment, createDefaultHostService()),
  );
}

function clientIdFromAccessToken(accessToken: string): BitwardenClientId | null {
  const payload = accessTokenPayload(accessToken);
  return payload && isBitwardenClientId(payload["client_id"]) ? payload["client_id"] : null;
}

function isRefreshTokenResponse(value: unknown): value is RefreshTokenResponseShape {
  return (
    isRecord(value) &&
    isNonEmptyString(value["access_token"]) &&
    isNonEmptyString(value["token_type"]) &&
    isOptionalNonEmptyString(value["refresh_token"]) &&
    isOptionalFiniteNumber(value["expires_in"])
  );
}

function expiresInFromAccessToken(accessToken: string, obtainedAtEpochMs: number): number | null {
  const expiration = accessTokenPayload(accessToken)?.["exp"];
  if (typeof expiration !== "number" || !Number.isFinite(expiration)) {
    return null;
  }
  return Math.max(0, expiration - Math.floor(obtainedAtEpochMs / 1000));
}

function remainingSessionExpiresIn(session: AuthSession, obtainedAtEpochMs: number): number {
  if (session.token.obtainedAtEpochMs == null) {
    return session.token.expiresIn;
  }
  const remainingMs = session.token.obtainedAtEpochMs + session.token.expiresIn * 1000 - obtainedAtEpochMs;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

function accessTokenPayload(accessToken: string): Record<string, unknown> | null {
  const payload = accessToken.split(".")[1];
  if (!payload) {
    return null;
  }

  try {
    const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(`${base64}${padding}`), (character) => character.charCodeAt(0));
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return isRecord(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalNonEmptyString(value: unknown): value is string | null | undefined {
  return value == null || isNonEmptyString(value);
}

function isOptionalFiniteNumber(value: unknown): value is number | null | undefined {
  return value == null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}
