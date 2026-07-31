import { describe, expect, it } from "vitest";

import { buildBitwardenEnvironment } from "../../bitwarden-api/bitwarden-api";
import { environmentFromServerUrl } from "./vault-sync.shared";

describe("environmentFromServerUrl", () => {
  it.each([
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
  ])("resolves $name auth endpoints", ({ serverUrl, identityUrl, apiUrl }) => {
    expect(environmentFromServerUrl(serverUrl)).toMatchObject({ identityUrl, apiUrl });
  });

  it("maps the Bitwarden EU vault URL to the official EU cloud environment", () => {
    expect(environmentFromServerUrl("https://vault.bitwarden.eu/")).toEqual(
      buildBitwardenEnvironment({ region: "EU" }),
    );
  });
});
