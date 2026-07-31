import { describe, expect, it } from "vitest";

import { type HttpTransport } from "../../bitwarden-api/bitwarden-api";
import {
  OfficialPasswordHintApiAdapter,
  OfficialPasswordHintRequestError,
} from "./official-password-hint-api.adapter";

describe("OfficialPasswordHintApiAdapter", () => {
  it.each([
    ["https://vault.bitwarden.com", "https://api.bitwarden.com/accounts/password-hint"],
    ["https://vault.bitwarden.eu", "https://api.bitwarden.eu/accounts/password-hint"],
    ["https://vault.example.test/", "https://vault.example.test/api/accounts/password-hint"],
  ])("maps the selected %s base to its official API endpoint", async (serverUrl, expectedUrl) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const adapter = new OfficialPasswordHintApiAdapter({
      fetchJson: async (url, init) => { calls.push({ url, init }); return {}; },
    } satisfies HttpTransport);
    await adapter.request(serverUrl, " person@example.com ");
    expect(calls).toEqual([{
      url: expectedUrl,
      init: expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "person@example.com" }) }),
    }]);
  });

  it.each([
    "http://vault.example.test",
    "not a url",
    "https://user:secret@vault.example.test",
    "https://vault.example.test?token=secret",
    "https://vault.example.test#fragment",
    "https://vault.bitwarden.com/untrusted",
  ])("rejects unsafe server bases without forwarding email: %s", async (serverUrl) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const adapter = new OfficialPasswordHintApiAdapter({
      fetchJson: async (url, init) => { calls.push({ url, init }); return {}; },
    } satisfies HttpTransport);
    await expect(adapter.request(serverUrl, "person@example.com")).rejects.toEqual(new OfficialPasswordHintRequestError());
    expect(calls).toEqual([]);
  });

  it("normalizes recoverable transport failures without exposing response details", async () => {
    const adapter = new OfficialPasswordHintApiAdapter({
      fetchJson: async () => { throw new Error("private server response"); },
    } satisfies HttpTransport);
    await expect(adapter.request("https://vault.example.test", "person@example.com"))
      .rejects.toEqual(new OfficialPasswordHintRequestError());
  });
});
