import type { HostApi } from "../host/host-api";

const TWO_FACTOR_TRUST_STORE_KEY = "auth.two-factor-trust.v1";

export interface TwoFactorTrustStore {
  get(email: string, identityUrl: string): Promise<string | null>;
  save(email: string, identityUrl: string, token: string): Promise<void>;
  clear(email: string, identityUrl: string): Promise<void>;
}

/** Stores server-issued trusted-device tokens in the platform secure storage. */
export class SecureTwoFactorTrustStore implements TwoFactorTrustStore {
  constructor(private readonly host: Pick<HostApi, "secureGet" | "secureSet" | "secureDelete">) {}

  async get(email: string, identityUrl: string): Promise<string | null> {
    return (await this.read())[scope(email, identityUrl)] ?? null;
  }

  async save(email: string, identityUrl: string, token: string): Promise<void> {
    const tokens = await this.read();
    tokens[scope(email, identityUrl)] = token;
    await this.host.secureSet(TWO_FACTOR_TRUST_STORE_KEY, JSON.stringify(tokens));
  }

  async clear(email: string, identityUrl: string): Promise<void> {
    const tokens = await this.read();
    delete tokens[scope(email, identityUrl)];
    if (Object.keys(tokens).length === 0) {
      await this.host.secureDelete(TWO_FACTOR_TRUST_STORE_KEY);
      return;
    }
    await this.host.secureSet(TWO_FACTOR_TRUST_STORE_KEY, JSON.stringify(tokens));
  }

  private async read(): Promise<Record<string, string>> {
    const raw = await this.host.secureGet(TWO_FACTOR_TRUST_STORE_KEY);
    if (!raw) {
      return {};
    }
    try {
      const value = JSON.parse(raw) as unknown;
      if (!isTokenRecord(value)) {
        return {};
      }
      return value;
    } catch {
      return {};
    }
  }
}

function scope(email: string, identityUrl: string): string {
  return `${identityUrl.trim().replace(/\/+$/, "").toLowerCase()}\n${email.trim().toLowerCase()}`;
}

function isTokenRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((token) => typeof token === "string" && token.length > 0)
  );
}
