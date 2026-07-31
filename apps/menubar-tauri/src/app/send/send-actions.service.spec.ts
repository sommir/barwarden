import { webcrypto } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../auth/auth-session-store";
import { buildBitwardenEnvironment, type HttpTransport } from "../../bitwarden-api/bitwarden-api";
import { BitwardenSendActions } from "./send-actions.service";
import type { SendItem } from "./send-item.model";

describe("BitwardenSendActions", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects File Send update before transport", async () => {
    const transport = { fetchJson: vi.fn() };
    const actions = new BitwardenSendActions(session(), transport as unknown as HttpTransport);

    await expect(actions.updateTextSend(session(), send({ type: "file" }), draft())).rejects.toThrow(
      "File Send mutations are excluded",
    );
    expect(transport.fetchJson).not.toHaveBeenCalled();
  });

  it.each(["deleteSend", "removePassword"] as const)(
    "rejects File Send %s before transport",
    async (method) => {
      const transport = { fetchJson: vi.fn() };
      const actions = new BitwardenSendActions(session(), transport as unknown as HttpTransport);

      await expect(actions[method](session(), send({ type: "file" }))).rejects.toThrow(
        "File Send mutations are excluded",
      );
      expect(transport.fetchJson).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["id", { AccessId: "server-access" }],
    ["access id", { Id: "server-id" }],
  ])("fails closed when the create response lacks an %s", async (_field, response) => {
    const transport = new RecordingTransport(response);
    const actions = new BitwardenSendActions(session(), transport);

    await expect(actions.createTextSend(session(), draft())).rejects.toThrow(
      "Bitwarden Send create response did not include an id and access id",
    );
    expect(transport.calls).toHaveLength(1);
  });

  it("reconciles authoritative create response fields without exposing plaintext", async () => {
    const transport = new RecordingTransport(serverResponse({ Id: "created-id", AccessId: "created-access" }));
    const actions = new BitwardenSendActions(session(), transport);

    await expect(actions.createTextSend(session(), draft())).resolves.toMatchObject({
      id: "created-id",
      accessId: "created-access",
      revisionDate: "2026-07-19T12:01:00.000Z",
      deletionDate: "2026-08-02T12:00:00.000Z",
      disabled: true,
      accessCount: 9,
    });
    expect(JSON.stringify(transport.calls[0]?.init.body)).not.toContain("Secret");
    expect(JSON.stringify(transport.calls[0]?.init.body)).not.toContain("value");
  });

  it("sends only the Text Send request shape when creating a Send", async () => {
    const transport = new RecordingTransport(serverResponse());
    const actions = new BitwardenSendActions(session(), transport);

    await actions.createTextSend(session(), draft());

    expect(JSON.parse(String(transport.calls[0]?.init.body))).toMatchObject({ type: 0, file: null });
  });

  it("reconciles authoritative update response fields over the local Send", async () => {
    const transport = new RecordingTransport(serverResponse({ Id: "updated-id", AccessId: "updated-access" }));
    const actions = new BitwardenSendActions(session(), transport);

    await expect(actions.updateTextSend(session(), send({
      id: "local-id",
      accessId: "local-access",
      urlB64Key: "AQIDBAUGBwgJCgsMDQ4PEA==",
      revisionDate: "2026-07-01T00:00:00.000Z",
      deletionDate: "2026-07-20T12:00:00.000Z",
      disabled: false,
      accessCount: 0,
    }), draft())).resolves.toMatchObject({
      id: "updated-id",
      accessId: "updated-access",
      revisionDate: "2026-07-19T12:01:00.000Z",
      deletionDate: "2026-08-02T12:00:00.000Z",
      disabled: true,
      accessCount: 9,
    });
    expect(JSON.stringify(transport.calls[0]?.init.body)).not.toContain("Secret");
    expect(JSON.stringify(transport.calls[0]?.init.body)).not.toContain("value");
  });

  it("sends explicit no-auth when a protected Send is changed to none", async () => {
    const transport = new RecordingTransport(serverResponse());
    const actions = new BitwardenSendActions(session(), transport);

    const updated = await actions.updateTextSend(
      session(),
      send({ hasPassword: true, urlB64Key: "AQIDBAUGBwgJCgsMDQ4PEA==" }),
      { ...draft(), authType: "none" } as Parameters<BitwardenSendActions["updateTextSend"]>[2],
    );

    expect(JSON.parse(String(transport.calls[0]?.init.body))).toMatchObject({ authType: 2, password: null });
    expect(updated).not.toHaveProperty("hasPassword");
  });

  it("refreshes the exact server Send after the void remove-password endpoint", async () => {
    const transport = new SequenceTransport([
      undefined,
      {
        Sends: [{
          Id: "send",
          AccessId: "server-access",
          Type: 0,
          Name: "Server exact",
          Notes: "server note",
          Text: { Text: "server text", Hidden: true },
          AuthType: 2,
          HideEmail: true,
          MaxAccessCount: 5,
          AccessCount: 3,
          RevisionDate: "2026-07-19T12:03:04.567Z",
          DeletionDate: "2026-08-03T12:00:00.000Z",
          Disabled: true,
        }],
      },
    ]);
    const actions = new BitwardenSendActions(session(), transport);
    const source = send({ hasPassword: true, password: "local-only" });

    await actions.removePassword(session(), source);
    const refreshed = await actions.refreshTextSend(session(), source.id);

    expect(transport.calls.map(({ url }) => url)).toEqual([
      "https://api.bitwarden.com/sends/send/remove-password",
      "https://api.bitwarden.com/sync?excludeDomains=true",
    ]);
    expect(refreshed).toEqual({
      id: "send",
      accessId: "server-access",
      type: "text",
      name: "Server exact",
      text: "server text",
      notes: "server note",
      hidden: true,
      hideEmail: true,
      maxAccessCount: 5,
      accessCount: 3,
      revisionDate: "2026-07-19T12:03:04.567Z",
      deletionDate: "2026-08-03T12:00:00.000Z",
      disabled: true,
    });
  });
});

function session(): AuthSession {
  return {
    environment: buildBitwardenEnvironment(),
    token: { accessToken: "access", refreshToken: "refresh", tokenType: "Bearer", expiresIn: 3600 },
    crypto: { userKeyB64: "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4/QA==" },
  };
}

function draft() {
  return {
    name: "Secret",
    text: "value",
    notes: "",
    deletionDate: "2026-07-20T12:00:00.000Z",
  };
}

function serverResponse(overrides: Record<string, unknown> = {}) {
  return {
    Id: "server-id",
    AccessId: "server-access",
    RevisionDate: "2026-07-19T12:01:00.000Z",
    DeletionDate: "2026-08-02T12:00:00.000Z",
    Disabled: true,
    AccessCount: 9,
    ...overrides,
  };
}

class RecordingTransport {
  readonly calls: { url: string; init: RequestInit }[] = [];

  constructor(private readonly response: unknown) {}

  async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    this.calls.push({ url, init });
    return this.response as T;
  }
}

class SequenceTransport {
  readonly calls: { url: string; init: RequestInit }[] = [];

  constructor(private readonly responses: unknown[]) {}

  async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    this.calls.push({ url, init });
    return this.responses.shift() as T;
  }
}

function send(overrides: Partial<SendItem>): SendItem {
  return {
    id: "send", accessId: "access", type: "text", name: "Secret", notes: "",
    revisionDate: "2030-07-01T00:00:00.000Z", deletionDate: "2030-08-01T00:00:00.000Z", disabled: false, accessCount: 0,
    ...overrides,
  };
}
