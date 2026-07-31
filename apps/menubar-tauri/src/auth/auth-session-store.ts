import {
  isBitwardenClientId,
  type BitwardenClientId,
  type BitwardenEnvironment,
} from "../bitwarden-api/bitwarden-api";
import type { HostApi } from "../host/host-api";

export const AUTH_SESSION_KEY = "auth.session";

export interface AuthTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  readonly expiresIn: number;
  readonly clientId?: BitwardenClientId;
  readonly obtainedAtEpochMs?: number;
}

export interface AuthCryptoState {
  readonly userKeyB64: string;
}

export interface AuthSession {
  readonly environment: BitwardenEnvironment;
  readonly token: AuthTokenSet;
  readonly crypto?: AuthCryptoState;
}

export class AuthSessionStore {
  constructor(private readonly host: HostApi) {}

  save(session: AuthSession): Promise<void> {
    return this.host.secureSet(AUTH_SESSION_KEY, JSON.stringify(session));
  }

  async read(): Promise<AuthSession | null> {
    const rawSession = await this.host.secureGet(AUTH_SESSION_KEY);
    if (!rawSession) {
      return null;
    }

    try {
      const session = JSON.parse(rawSession) as unknown;
      return isAuthSession(session) ? session : null;
    } catch {
      return null;
    }
  }

  clear(): Promise<void> {
    return this.host.secureDelete(AUTH_SESSION_KEY);
  }
}

export function isAuthSession(value: unknown): value is AuthSession {
  if (!isRecord(value) || !isRecord(value["environment"]) || !isRecord(value["token"])) {
    return false;
  }

  const environment = value["environment"];
  const token = value["token"];

  return (
    isString(environment["apiUrl"]) &&
    isString(environment["identityUrl"]) &&
    isString(token["accessToken"]) &&
    isString(token["refreshToken"]) &&
    isString(token["tokenType"]) &&
    typeof token["expiresIn"] === "number" &&
    (token["clientId"] == null || isBitwardenClientId(token["clientId"])) &&
    (token["obtainedAtEpochMs"] == null ||
      (typeof token["obtainedAtEpochMs"] === "number" && Number.isFinite(token["obtainedAtEpochMs"]))) &&
    (value["crypto"] == null ||
      (isRecord(value["crypto"]) && isString(value["crypto"]["userKeyB64"])))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
