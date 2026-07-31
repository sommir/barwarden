import { describe, expect, it } from "vitest";

import { BitwardenApiClient, type HttpTransport } from "../../bitwarden-api/bitwarden-api";
import { environmentFromServerUrl } from "./vault-sync.shared";

const standardServers = [
  {
    name: "US",
    serverUrl: "https://vault.bitwarden.com",
    identityUrl: "https://identity.bitwarden.com",
    apiUrl: "https://api.bitwarden.com",
  },
  {
    name: "EU",
    serverUrl: "https://vault.bitwarden.eu/",
    identityUrl: "https://identity.bitwarden.eu",
    apiUrl: "https://api.bitwarden.eu",
  },
  {
    name: "self-hosted",
    serverUrl: "https://vault.example.test:8443/",
    identityUrl: "https://vault.example.test:8443/identity",
    apiUrl: "https://vault.example.test:8443/api",
  },
] as const;

describe("standard auth server matrix", () => {
  it.each(standardServers)(
    "routes $name prelogin, password token, password hint, and sync calls to canonical hosts",
    async ({ serverUrl, identityUrl, apiUrl }) => {
      const transport = new RecordingTransport();
      const client = new BitwardenApiClient(environmentFromServerUrl(serverUrl), transport);

      await client.postPasswordPrelogin({ email: "person@example.test" });
      await client.postPasswordToken({
        clientId: "browser",
        email: "person@example.test",
        masterPasswordHash: "hashed-master-password",
      });
      await client.postPasswordHint({ email: "person@example.test" });
      await client.getSync("access-token");

      expect(transport.calls.map((call) => call.url)).toEqual([
        `${identityUrl}/accounts/prelogin/password`,
        `${identityUrl}/connect/token`,
        `${apiUrl}/accounts/password-hint`,
        `${apiUrl}/sync?excludeDomains=true`,
      ]);
    },
  );
});

class RecordingTransport implements HttpTransport {
  readonly calls: { url: string; init: RequestInit }[] = [];

  async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    this.calls.push({ url, init });
    return {} as T;
  }
}
