import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BitwardenApiClient,
  FetchHttpTransport,
  BitwardenApiError,
  buildBitwardenEnvironment,
  buildRefreshTokenBody,
  buildSelfHostedEnvironmentFromServerUrl,
  buildPasswordTokenBody,
  type BitwardenEnvironmentInput,
  type HttpTransport,
} from "./bitwarden-api";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("buildBitwardenEnvironment", () => {
  it("uses the official Bitwarden US cloud endpoints by default", () => {
    expect(buildBitwardenEnvironment()).toEqual({
      apiUrl: "https://api.bitwarden.com",
      identityUrl: "https://identity.bitwarden.com",
      iconsUrl: "https://icons.bitwarden.net",
      webVaultUrl: "https://vault.bitwarden.com",
      sendUrl: "https://send.bitwarden.com",
    });
  });

  it("uses the official Bitwarden EU cloud endpoints", () => {
    expect(buildBitwardenEnvironment({ region: "EU" })).toEqual({
      apiUrl: "https://api.bitwarden.eu",
      identityUrl: "https://identity.bitwarden.eu",
      iconsUrl: "https://icons.bitwarden.eu",
      webVaultUrl: "https://vault.bitwarden.eu",
      sendUrl: "https://vault.bitwarden.eu",
    });
  });

  it("normalizes explicitly configured self-hosted endpoints", () => {
    const input: BitwardenEnvironmentInput = {
      region: "SelfHosted",
      urls: {
        apiUrl: "vault.example.test/api/",
        identityUrl: "https://vault.example.test/identity/",
        iconsUrl: "http://vault.example.test/icons//",
        webVaultUrl: "vault.example.test/",
        sendUrl: "https://vault.example.test",
      },
    };

    expect(buildBitwardenEnvironment(input)).toEqual({
      apiUrl: "https://vault.example.test/api",
      identityUrl: "https://vault.example.test/identity",
      iconsUrl: "http://vault.example.test/icons",
      webVaultUrl: "https://vault.example.test",
      sendUrl: "https://vault.example.test",
    });
  });

  it("derives self-hosted API endpoints from a web vault server URL", () => {
    expect(buildSelfHostedEnvironmentFromServerUrl("https://bitwarden.example.com/")).toEqual({
      apiUrl: "https://bitwarden.example.com/api",
      identityUrl: "https://bitwarden.example.com/identity",
      iconsUrl: "https://bitwarden.example.com/icons",
      webVaultUrl: "https://bitwarden.example.com",
      sendUrl: "https://bitwarden.example.com",
    });
  });

  it("derives self-hosted API endpoints from a web vault URL with an explicit port", () => {
    expect(buildSelfHostedEnvironmentFromServerUrl("https://vault.example.test:8443/")).toEqual({
      apiUrl: "https://vault.example.test:8443/api",
      identityUrl: "https://vault.example.test:8443/identity",
      iconsUrl: "https://vault.example.test:8443/icons",
      webVaultUrl: "https://vault.example.test:8443",
      sendUrl: "https://vault.example.test:8443",
    });
  });

  it("rejects malformed self-hosted URLs with a fixed error", () => {
    expect(() => buildSelfHostedEnvironmentFromServerUrl("https://[private-host"))
      .toThrow("Invalid Bitwarden server URL");
  });
});

describe("buildPasswordTokenBody", () => {
  it("matches the official password grant form shape", () => {
    const body = buildPasswordTokenBody({
      clientId: "browser",
      email: "user@example.com",
      masterPasswordHash: "hashed-master-password",
      device: {
        type: "17",
        identifier: "device-id",
        name: "MacBook Pro",
      },
      twoFactor: {
        provider: 0,
        token: "123456",
        remember: true,
      },
    });

    expect(Object.fromEntries(body)).toEqual({
      scope: "api offline_access",
      client_id: "browser",
      grant_type: "password",
      username: "user@example.com",
      password: "hashed-master-password",
      deviceType: "17",
      deviceIdentifier: "device-id",
      deviceName: "MacBook Pro",
      twoFactorToken: "123456",
      twoFactorProvider: "0",
      twoFactorRemember: "1",
    });
  });
});

describe("buildRefreshTokenBody", () => {
  it("matches the official refresh-token grant form shape", () => {
    const body = buildRefreshTokenBody({
      clientId: "web",
      refreshToken: "stored-refresh-token",
    });

    expect(Object.fromEntries(body)).toEqual({
      grant_type: "refresh_token",
      client_id: "web",
      refresh_token: "stored-refresh-token",
    });
  });
});

describe("BitwardenApiClient", () => {
  it("posts password prelogin to the Identity API prelogin endpoint", async () => {
    const transport = new RecordingTransport({ Kdf: 0, KdfIterations: 600000 });
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.postPasswordPrelogin({ email: "USER@example.com" });

    expect(transport.lastRequest?.url).toBe(
      "https://identity.bitwarden.com/accounts/prelogin/password",
    );
    expect(transport.lastRequest?.init.method).toBe("POST");
    expect(transport.lastRequest?.jsonBody).toEqual({ email: "USER@example.com" });
  });

  it("posts password login to the Identity API /connect/token endpoint", async () => {
    const transport = new RecordingTransport({ access_token: "token", token_type: "Bearer" });
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.postPasswordToken({
      clientId: "browser",
      email: "user@example.com",
      masterPasswordHash: "hashed",
    });

    expect(transport.lastRequest?.url).toBe("https://identity.bitwarden.com/connect/token");
    expect(transport.lastRequest?.init.method).toBe("POST");
    const headers = new Headers(transport.lastRequest?.init.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe(
      "application/x-www-form-urlencoded; charset=utf-8",
    );
    expect(headers.get("Device-Type")).toBe("7");
    expect(headers.get("Bitwarden-Client-Name")).toBe("desktop");
    expect(headers.get("Bitwarden-Client-Version")).toBe("0.1.2");
    expect(transport.lastRequest?.body.get("grant_type")).toBe("password");
  });

  it("posts email two-factor delivery to the unauthenticated Web API login endpoint", async () => {
    const transport = new RecordingTransport({});
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.postTwoFactorEmail({
      email: "user@example.com",
      deviceIdentifier: "11111111-1111-4111-8111-111111111111",
    });

    expect(transport.lastRequest?.url).toBe(
      "https://api.bitwarden.com/two-factor/send-email-login",
    );
    expect(transport.lastRequest?.init).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
    expect(transport.lastRequest?.jsonBody).toEqual({
      email: "user@example.com",
      deviceIdentifier: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("posts new-device OTP resend to the selected Web API without a device identifier", async () => {
    const transport = new RecordingTransport({});
    const client = new BitwardenApiClient(buildBitwardenEnvironment({ region: "EU" }), transport);

    await client.postResendNewDeviceOtp({
      email: "user@example.com",
      masterPasswordHash: "derived-hash",
    });

    expect(transport.lastRequest?.url).toBe(
      "https://api.bitwarden.eu/accounts/resend-new-device-otp",
    );
    expect(transport.lastRequest?.init).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
    expect(transport.lastRequest?.jsonBody).toEqual({
      email: "user@example.com",
      masterPasswordHash: "derived-hash",
    });
    expect(transport.lastRequest?.jsonBody).not.toHaveProperty("deviceIdentifier");
  });

  it("posts refresh-token requests to the same Identity token endpoint", async () => {
    const transport = new RecordingTransport({
      access_token: "fresh-access-token",
      refresh_token: "fresh-refresh-token",
      token_type: "Bearer",
      expires_in: 3600,
    });
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.postRefreshToken({
      clientId: "browser",
      refreshToken: "stored-refresh-token",
    });

    expect(transport.lastRequest?.url).toBe("https://identity.bitwarden.com/connect/token");
    expect(transport.lastRequest?.init.method).toBe("POST");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
    });
    expect(transport.lastRequest?.body.get("grant_type")).toBe("refresh_token");
    expect(transport.lastRequest?.body.get("client_id")).toBe("browser");
    expect(transport.lastRequest?.body.get("refresh_token")).toBe("stored-refresh-token");
    for (const excluded of [
      "username", "password", "deviceType", "deviceIdentifier", "deviceName",
      "twoFactorToken", "twoFactorProvider", "newDeviceOtp",
    ]) {
      expect(transport.lastRequest?.body.has(excluded)).toBe(false);
    }
  });

  it("requests sync with a bearer token and excludes domains for non-browser autofill", async () => {
    const transport = new RecordingTransport({ ciphers: [] });
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.getSync("access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/sync?excludeDomains=true");
    expect(transport.lastRequest?.init.method).toBe("GET");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer access-token",
    });
  });


  it("soft deletes ciphers through the official trash endpoint", async () => {
    const transport = new RecordingTransport(null);
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.putDeleteCipher("cipher-id", "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/ciphers/cipher-id/delete");
    expect(transport.lastRequest?.init.method).toBe("PUT");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.init.body).toBeNull();
  });

  it("archives ciphers through the official bulk archive endpoint", async () => {
    const transport = new RecordingTransport({ Data: [] });
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.putArchiveCiphers(["cipher-id"], "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/ciphers/archive");
    expect(transport.lastRequest?.init.method).toBe("PUT");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.jsonBody).toEqual({ ids: ["cipher-id"] });
  });

  it("partially updates cipher favorite and folder through the official partial endpoint", async () => {
    const transport = new RecordingTransport({});
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.putPartialCipher("cipher-id", "access-token", {
      favorite: true,
      folderId: "folder-id",
    });

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/ciphers/cipher-id/partial");
    expect(transport.lastRequest?.init.method).toBe("PUT");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.jsonBody).toEqual({
      favorite: true,
      folderId: "folder-id",
    });
  });


  it("creates personal ciphers through the official cipher create endpoint", async () => {
    const transport = new RecordingTransport({ Id: "cipher-id" });
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);
    const request = {
      type: 1,
      folderId: null,
      organizationId: null,
      name: "2.name|cipher|mac",
      notes: null,
      favorite: false,
      reprompt: 0,
      login: {
        username: "2.username|cipher|mac",
        password: "2.password|cipher|mac",
        totp: null,
        passwordRevisionDate: null,
        autofillOnPageLoad: null,
        uris: [],
      },
      fields: [],
      passwordHistory: [],
    };

    await (client as { postCipher?: (body: typeof request, token: string) => Promise<unknown> })
      .postCipher!(request, "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/ciphers");
    expect(transport.lastRequest?.init.method).toBe("POST");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.jsonBody).toEqual(request);
  });

  it("updates personal ciphers through the official cipher update endpoint", async () => {
    const transport = new RecordingTransport({ Id: "cipher-id" });
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);
    const request = {
      type: 1,
      folderId: "work",
      organizationId: null,
      name: "2.name|cipher|mac",
      notes: null,
      favorite: true,
      reprompt: 0,
      lastKnownRevisionDate: "2026-07-04T09:00:00.000Z",
      login: {
        username: "2.username|cipher|mac",
        password: "2.password|cipher|mac",
        totp: null,
        passwordRevisionDate: null,
        autofillOnPageLoad: null,
        uris: [],
      },
      fields: [],
      passwordHistory: [],
    };

    await (client as { putCipher?: (id: string, body: typeof request, token: string) => Promise<unknown> })
      .putCipher!("cipher-id", request, "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/ciphers/cipher-id");
    expect(transport.lastRequest?.init.method).toBe("PUT");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.jsonBody).toEqual(request);
  });


  it("creates encrypted folders through the official folder endpoint", async () => {
    const transport = new RecordingTransport({ Id: "folder-1" });
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport) as BitwardenApiClient & {
      postFolder(request: { name: string }, accessToken: string): Promise<unknown>;
    };

    await client.postFolder({ name: "2.encrypted-folder-name" }, "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/folders");
    expect(transport.lastRequest?.init).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer access-token",
      },
    });
    expect(transport.lastRequest?.jsonBody).toEqual({ name: "2.encrypted-folder-name" });
  });

  it("updates encrypted folders through the official folder endpoint", async () => {
    const transport = new RecordingTransport({ Id: "folder-1" });
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport) as BitwardenApiClient & {
      putFolder(folderId: string, request: { name: string }, accessToken: string): Promise<unknown>;
    };

    await client.putFolder("folder-1", { name: "2.updated-folder-name" }, "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/folders/folder-1");
    expect(transport.lastRequest?.init.method).toBe("PUT");
    expect(transport.lastRequest?.jsonBody).toEqual({ name: "2.updated-folder-name" });
  });

  it("deletes folders through the official folder endpoint", async () => {
    const transport = new RecordingTransport(null);
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport) as BitwardenApiClient & {
      deleteFolder(folderId: string, accessToken: string): Promise<unknown>;
    };

    await client.deleteFolder("folder-1", "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/folders/folder-1");
    expect(transport.lastRequest?.init).toMatchObject({
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: "Bearer access-token",
      },
    });
    expect(transport.lastRequest?.init.body).toBeNull();
  });

  it("unarchives ciphers through the official bulk unarchive endpoint", async () => {
    const transport = new RecordingTransport({ Data: [] });
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.putUnarchiveCiphers(["cipher-id"], "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/ciphers/unarchive");
    expect(transport.lastRequest?.init.method).toBe("PUT");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.jsonBody).toEqual({ ids: ["cipher-id"] });
  });

  it("restores trashed ciphers through the official restore endpoint", async () => {
    const transport = new RecordingTransport({});
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.putRestoreCipher("cipher-id", "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/ciphers/cipher-id/restore");
    expect(transport.lastRequest?.init.method).toBe("PUT");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.init.body).toBeNull();
  });

  it("permanently deletes ciphers through the official delete endpoint", async () => {
    const transport = new RecordingTransport(null);
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.deleteCipher("cipher-id", "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/ciphers/cipher-id");
    expect(transport.lastRequest?.init.method).toBe("DELETE");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.init.body).toBeNull();
  });

  it("deletes Sends through the official Send delete endpoint", async () => {
    const transport = new RecordingTransport(null);
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.deleteSend("send-id", "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/sends/send-id");
    expect(transport.lastRequest?.init.method).toBe("DELETE");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.init.body).toBeNull();
  });

  it("removes Send passwords through the official remove-password endpoint", async () => {
    const transport = new RecordingTransport({});
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.putSendRemovePassword("send-id", "access-token");

    expect(transport.lastRequest?.url).toBe(
      "https://api.bitwarden.com/sends/send-id/remove-password",
    );
    expect(transport.lastRequest?.init.method).toBe("PUT");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.init.body).toBeNull();
  });

  it("creates text Sends through the official Send create endpoint", async () => {
    const transport = new RecordingTransport({ Id: "send-id" });
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);
    const request = {
      type: 0,
      name: "2.name|cipher|mac",
      notes: "2.notes|cipher|mac",
      key: "2.key|cipher|mac",
      deletionDate: "2026-07-17T00:00:00.000Z",
      expirationDate: null,
      maxAccessCount: 3,
      disabled: false,
      hideEmail: false,
      authType: 2,
      password: null,
      emails: null,
      text: {
        text: "2.text|cipher|mac",
        hidden: false,
      },
      file: null,
    };

    await (client as { postSend?: (body: typeof request, token: string) => Promise<unknown> })
      .postSend!(request, "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/sends");
    expect(transport.lastRequest?.init.method).toBe("POST");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.jsonBody).toEqual(request);
  });


  it("updates text Sends through the official Send update endpoint", async () => {
    const transport = new RecordingTransport({ Id: "send-id" });
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);
    const request = {
      type: 0,
      name: "2.name|cipher|mac",
      notes: null,
      key: "2.key|cipher|mac",
      deletionDate: "2026-07-18T00:00:00.000Z",
      expirationDate: null,
      disabled: false,
      hideEmail: false,
      authType: 2,
      password: null,
      emails: null,
      text: {
        text: "2.text|cipher|mac",
        hidden: false,
      },
      file: null,
    };

    await (client as { putSend?: (id: string, body: typeof request, token: string) => Promise<unknown> })
      .putSend!("send-id", request, "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/sends/send-id");
    expect(transport.lastRequest?.init.method).toBe("PUT");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.jsonBody).toEqual(request);
  });

  it("posts password hint requests to the official Accounts endpoint", async () => {
    const transport = new RecordingTransport({});
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.postPasswordHint({ email: "user@example.com" });

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/accounts/password-hint");
    expect(transport.lastRequest?.init.method).toBe("POST");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
    });
    expect(transport.lastRequest?.jsonBody).toEqual({ email: "user@example.com" });
  });

  it("posts password verification to the authenticated Accounts endpoint", async () => {
    const transport = new RecordingTransport({});
    const client = new BitwardenApiClient(buildBitwardenEnvironment(), transport);

    await client.postVerifyPassword({ masterPasswordHash: "derived-hash" }, "access-token");

    expect(transport.lastRequest?.url).toBe("https://api.bitwarden.com/accounts/verify-password");
    expect(transport.lastRequest?.init.method).toBe("POST");
    expect(transport.lastRequest?.init.headers).toMatchObject({
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer access-token",
    });
    expect(transport.lastRequest?.jsonBody).toEqual({ masterPasswordHash: "derived-hash" });
  });
});

describe("FetchHttpTransport", () => {
  it("aborts requests that exceed the configured timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }),
    );
    const transport = new FetchHttpTransport(250);

    const request = transport.fetchJson("https://identity.example.com", {}).then(
      () => null,
      (caught: unknown) => caught,
    );
    await vi.advanceTimersByTimeAsync(250);

    await expect(request).resolves.toMatchObject({
      name: "HttpTransportError",
      code: "timeout",
      message: "HTTP transport unavailable.",
    });
  });

  it("types a rejected fetch as transport-unavailable without exposing dependency text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("private DNS failure for https://secret.example.test");
      }),
    );
    const transport = new FetchHttpTransport(250);

    const error = await transport.fetchJson("https://identity.example.com", {}).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      name: "HttpTransportError",
      code: "unavailable",
      message: "HTTP transport unavailable.",
    });
    expect((error as Error).message).not.toContain("secret.example.test");
  });

  it("preserves Identity API error JSON for auth challenge routing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ TwoFactorProviders2: { 0: null } }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })),
    );
    const transport = new FetchHttpTransport(250);

    await expect(transport.fetchJson("https://identity.example.com/connect/token", {}))
      .rejects.toMatchObject({
        status: 400,
        responseJson: { TwoFactorProviders2: { 0: null } },
      });
  });

  it("does not embed non-success response bodies in typed error messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ErrorModel: { Message: "private server detail" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })),
    );
    const transport = new FetchHttpTransport(250);

    const error = await transport.fetchJson("https://api.example.test/sync", {}).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(BitwardenApiError);
    expect(error).toMatchObject({ status: 401 });
    expect((error as Error).message).not.toContain("private server detail");
  });
});

class RecordingTransport implements HttpTransport {
  lastRequest?: {
    url: string;
    init: RequestInit;
    body: URLSearchParams;
    jsonBody: unknown;
  };

  constructor(private readonly responseBody: unknown) {}

  async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const body = init.body instanceof URLSearchParams ? init.body : new URLSearchParams();
    const jsonBody = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    this.lastRequest = { url, init, body, jsonBody };

    return this.responseBody as T;
  }
}
