declare const __BARWARDEN_VERSION__: string;

const BARWARDEN_CLIENT_VERSION =
  typeof __BARWARDEN_VERSION__ === "string" ? __BARWARDEN_VERSION__ : "0.1.0";

export type BitwardenRegion = "US" | "EU" | "SelfHosted";

export interface BitwardenEnvironment {
  readonly apiUrl: string;
  readonly identityUrl: string;
  readonly iconsUrl: string | null;
  readonly webVaultUrl: string | null;
  readonly sendUrl: string | null;
}

export interface BitwardenEnvironmentInput {
  readonly region?: BitwardenRegion;
  readonly urls?: Partial<BitwardenEnvironment>;
}

export interface BitwardenDevice {
  readonly type: string;
  readonly identifier: string;
  readonly name: string;
}

export interface BitwardenTwoFactor {
  readonly provider: number;
  readonly token: string;
  readonly remember?: boolean;
}

export interface PasswordTokenRequest {
  readonly clientId: BitwardenClientId;
  readonly email: string;
  readonly masterPasswordHash: string;
  readonly device?: BitwardenDevice;
  readonly twoFactor?: BitwardenTwoFactor;
  readonly newDeviceOtp?: string;
}

export type BitwardenClientId = "browser" | "web" | "desktop";

export function isBitwardenClientId(value: unknown): value is BitwardenClientId {
  return value === "browser" || value === "web" || value === "desktop";
}

export interface PasswordPreloginRequest {
  readonly email: string;
}

export interface PasswordHintRequest {
  readonly email: string;
}

export interface VerifyPasswordRequest {
  readonly masterPasswordHash: string;
}

export interface TwoFactorEmailRequest {
  readonly email: string;
  readonly deviceIdentifier: string;
  readonly masterPasswordHash?: string;
  readonly authRequestId?: string;
  readonly ssoEmail2FaSessionToken?: string;
  readonly authRequestAccessCode?: string;
}

export interface NewDeviceOtpRequest {
  readonly email: string;
  readonly masterPasswordHash: string;
}

export interface RefreshTokenRequest {
  readonly clientId: BitwardenClientId;
  readonly refreshToken: string;
}

export interface RefreshTokenResponseShape {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly token_type: string;
  readonly expires_in?: number;
}

export interface CipherPartialUpdateRequest {
  readonly favorite: boolean;
  readonly folderId?: string;
}

export interface FolderRequest {
  readonly name: string;
}

export interface LoginCipherCreateRequest {
  readonly type: 1;
  readonly folderId: string | null;
  readonly organizationId: string | null;
  readonly key?: string;
  readonly name: string;
  readonly notes: string | null;
  readonly favorite: boolean;
  readonly reprompt: 0 | 1;
  readonly lastKnownRevisionDate?: string;
  readonly login: {
    readonly username: string | null;
    readonly password: string | null;
    readonly passwordRevisionDate: string | null;
    readonly totp: string | null;
    readonly autofillOnPageLoad: boolean | null;
    readonly uris: readonly {
      readonly uri: string;
      readonly match: number | null;
      readonly uriChecksum?: string | null;
    }[];
  };
  readonly fields: readonly {
    readonly name: string;
    readonly value: string;
    readonly type: 0 | 1 | 2;
  }[];
  readonly passwordHistory: readonly {
    readonly password: string;
    readonly lastUsedDate: string;
  }[];
}

export interface SecureNoteCipherCreateRequest {
  readonly type: 2;
  readonly folderId: string | null;
  readonly organizationId: string | null;
  readonly name: string;
  readonly notes: string | null;
  readonly favorite: boolean;
  readonly reprompt: 0 | 1;
  readonly lastKnownRevisionDate?: string;
  readonly secureNote: {
    readonly type: 0;
  };
  readonly fields: readonly unknown[];
  readonly passwordHistory: readonly unknown[];
}

export interface CardCipherCreateRequest {
  readonly type: 3;
  readonly folderId: string | null;
  readonly organizationId: string | null;
  readonly name: string;
  readonly notes: string | null;
  readonly favorite: boolean;
  readonly reprompt: 0 | 1;
  readonly lastKnownRevisionDate?: string;
  readonly card: {
    readonly cardholderName: string | null;
    readonly brand: string | null;
    readonly number: string | null;
    readonly expMonth: string | null;
    readonly expYear: string | null;
    readonly code: string | null;
  };
  readonly fields: readonly unknown[];
  readonly passwordHistory: readonly unknown[];
}

export interface IdentityCipherCreateRequest {
  readonly type: 4;
  readonly folderId: string | null;
  readonly organizationId: string | null;
  readonly name: string;
  readonly notes: string | null;
  readonly favorite: boolean;
  readonly reprompt: 0 | 1;
  readonly lastKnownRevisionDate?: string;
  readonly identity: {
    readonly title: string | null;
    readonly firstName: string | null;
    readonly middleName: string | null;
    readonly lastName: string | null;
    readonly address1: string | null;
    readonly address2: string | null;
    readonly address3: string | null;
    readonly city: string | null;
    readonly state: string | null;
    readonly postalCode: string | null;
    readonly country: string | null;
    readonly company: string | null;
    readonly email: string | null;
    readonly phone: string | null;
    readonly ssn: string | null;
    readonly username: string | null;
    readonly passportNumber: string | null;
    readonly licenseNumber: string | null;
  };
  readonly fields: readonly unknown[];
  readonly passwordHistory: readonly unknown[];
}

export type CipherCreateRequest =
  | LoginCipherCreateRequest
  | SecureNoteCipherCreateRequest
  | CardCipherCreateRequest
  | IdentityCipherCreateRequest;

export interface TextSendCreateRequest {
  readonly type: 0;
  readonly fileLength?: number;
  readonly name: string;
  readonly notes: string | null;
  readonly key: string;
  readonly maxAccessCount?: number;
  readonly expirationDate: string | null;
  readonly deletionDate: string;
  readonly text: {
    readonly text: string;
    readonly hidden: boolean;
  };
  readonly file: null;
  readonly password: string | null;
  readonly emails: string | null;
  readonly disabled: boolean;
  readonly hideEmail: boolean;
  readonly authType: 1 | 2;
}

export interface HttpTransport {
  fetchJson<T>(url: string, init: RequestInit): Promise<T>;
}

export type HttpTransportFailureCode = "unavailable" | "timeout";

export class HttpTransportError extends Error {
  override readonly name = "HttpTransportError";

  constructor(readonly code: HttpTransportFailureCode) {
    super("HTTP transport unavailable.");
  }
}

class BitwardenPlatformHeaderTransport implements HttpTransport {
  constructor(private readonly transport: HttpTransport) {}

  fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    return this.transport.fetchJson<T>(url, {
      ...init,
      headers: {
        ...plainHeaders(init.headers),
        "Device-Type": "7",
        "Bitwarden-Client-Name": "desktop",
        "Bitwarden-Client-Version": BARWARDEN_CLIENT_VERSION,
      },
    });
  }
}

export class BitwardenApiError extends Error {
  constructor(
    readonly status: number,
    readonly responseJson: unknown,
  ) {
    super(`Bitwarden API request failed with status ${status}`);
    this.name = "BitwardenApiError";
  }
}

const CLOUD_ENVIRONMENTS: Record<Exclude<BitwardenRegion, "SelfHosted">, BitwardenEnvironment> = {
  US: {
    apiUrl: "https://api.bitwarden.com",
    identityUrl: "https://identity.bitwarden.com",
    iconsUrl: "https://icons.bitwarden.net",
    webVaultUrl: "https://vault.bitwarden.com",
    sendUrl: "https://send.bitwarden.com",
  },
  EU: {
    apiUrl: "https://api.bitwarden.eu",
    identityUrl: "https://identity.bitwarden.eu",
    iconsUrl: "https://icons.bitwarden.eu",
    webVaultUrl: "https://vault.bitwarden.eu",
    sendUrl: "https://vault.bitwarden.eu",
  },
};

export function buildBitwardenEnvironment(
  input: BitwardenEnvironmentInput = {},
): BitwardenEnvironment {
  const region = input.region ?? "US";
  if (region !== "SelfHosted") {
    return CLOUD_ENVIRONMENTS[region];
  }

  const urls = input.urls ?? {};
  return {
    apiUrl: normalizeRequiredUrl(urls.apiUrl, "apiUrl"),
    identityUrl: normalizeRequiredUrl(urls.identityUrl, "identityUrl"),
    iconsUrl: normalizeOptionalUrl(urls.iconsUrl),
    webVaultUrl: normalizeOptionalUrl(urls.webVaultUrl),
    sendUrl: normalizeOptionalUrl(urls.sendUrl),
  };
}

export function buildSelfHostedEnvironmentFromServerUrl(serverUrl: string): BitwardenEnvironment {
  const baseUrl = normalizeRequiredUrl(serverUrl, "serverUrl");

  return buildBitwardenEnvironment({
    region: "SelfHosted",
    urls: {
      apiUrl: `${baseUrl}/api`,
      identityUrl: `${baseUrl}/identity`,
      iconsUrl: `${baseUrl}/icons`,
      webVaultUrl: baseUrl,
      sendUrl: baseUrl,
    },
  });
}

export function buildPasswordTokenBody(request: PasswordTokenRequest): URLSearchParams {
  const body = new URLSearchParams({
    scope: "api offline_access",
    client_id: request.clientId,
    grant_type: "password",
    username: request.email,
    password: request.masterPasswordHash,
  });

  if (request.device) {
    body.set("deviceType", request.device.type);
    body.set("deviceIdentifier", request.device.identifier);
    body.set("deviceName", request.device.name);
  }

  if (request.twoFactor?.token && request.twoFactor.provider != null) {
    body.set("twoFactorToken", request.twoFactor.token);
    body.set("twoFactorProvider", String(request.twoFactor.provider));
    body.set("twoFactorRemember", request.twoFactor.remember ? "1" : "0");
  }

  if (request.newDeviceOtp) {
    body.set("newDeviceOtp", request.newDeviceOtp);
  }

  return body;
}

export function buildRefreshTokenBody(request: RefreshTokenRequest): URLSearchParams {
  return new URLSearchParams({
    grant_type: "refresh_token",
    client_id: request.clientId,
    refresh_token: request.refreshToken,
  });
}

export class FetchHttpTransport implements HttpTransport {
  constructor(private readonly timeoutMs = 10000) {}

  async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: abortController.signal,
      });
      const json = await response.json().catch((): null => null);
      if (!response.ok) {
        throw new BitwardenApiError(response.status, json);
      }

      return json as T;
    } catch (error) {
      if (abortController.signal.aborted) {
        throw new HttpTransportError("timeout");
      }
      if (error instanceof BitwardenApiError || error instanceof HttpTransportError) {
        throw error;
      }

      throw new HttpTransportError("unavailable");
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export class BitwardenApiClient {
  private readonly transport: HttpTransport;

  constructor(
    private readonly environment: BitwardenEnvironment,
    transport: HttpTransport = new FetchHttpTransport(),
  ) {
    this.transport = new BitwardenPlatformHeaderTransport(transport);
  }

  postPasswordPrelogin<TResponse = unknown>(request: PasswordPreloginRequest): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(
      `${this.environment.identityUrl}/accounts/prelogin/password`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: request.email }),
      },
    );
  }

  postPasswordHint<TResponse = unknown>(request: PasswordHintRequest): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(
      `${this.environment.apiUrl}/accounts/password-hint`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: request.email }),
      },
    );
  }

  postVerifyPassword(
    request: VerifyPasswordRequest,
    accessToken: string,
    repromptReceipt?: string,
  ): Promise<void> {
    return this.transport.fetchJson<void>(`${this.environment.apiUrl}/accounts/verify-password`, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(repromptReceipt
          ? { "x-barwarden-autofill-reprompt": repromptReceipt }
          : {}),
      },
      body: JSON.stringify(request),
    });
  }

  postPasswordToken<TResponse = unknown>(request: PasswordTokenRequest): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.identityUrl}/connect/token`, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: buildPasswordTokenBody(request),
    });
  }

  postTwoFactorEmail<TResponse = unknown>(request: TwoFactorEmailRequest): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(
      `${this.environment.apiUrl}/two-factor/send-email-login`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
    );
  }

  postResendNewDeviceOtp<TResponse = unknown>(request: NewDeviceOtpRequest): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(
      `${this.environment.apiUrl}/accounts/resend-new-device-otp`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
    );
  }

  postRefreshToken<TResponse = RefreshTokenResponseShape>(request: RefreshTokenRequest): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.identityUrl}/connect/token`, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: buildRefreshTokenBody(request),
    });
  }

  getSync<TResponse = unknown>(accessToken: string): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(
      `${this.environment.apiUrl}/sync?excludeDomains=true`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );
  }

  putDeleteCipher<TResponse = unknown>(cipherId: string, accessToken: string): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(
      `${this.environment.apiUrl}/ciphers/${cipherId}/delete`,
      {
        method: "PUT",
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: null,
      },
    );
  }

  putArchiveCiphers<TResponse = unknown>(
    cipherIds: readonly string[],
    accessToken: string,
  ): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.apiUrl}/ciphers/archive`, {
      method: "PUT",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ ids: cipherIds }),
    });
  }

  putPartialCipher<TResponse = unknown>(
    cipherId: string,
    accessToken: string,
    request: CipherPartialUpdateRequest,
  ): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(
      `${this.environment.apiUrl}/ciphers/${cipherId}/partial`,
      {
        method: "PUT",
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          favorite: request.favorite,
          ...(request.folderId ? { folderId: request.folderId } : {}),
        }),
      },
    );
  }

  postCipher<TResponse = unknown>(
    request: CipherCreateRequest,
    accessToken: string,
  ): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.apiUrl}/ciphers`, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(request),
    });
  }

  putCipher<TResponse = unknown>(
    cipherId: string,
    request: CipherCreateRequest,
    accessToken: string,
  ): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.apiUrl}/ciphers/${cipherId}`, {
      method: "PUT",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(request),
    });
  }

  postFolder<TResponse = unknown>(
    request: FolderRequest,
    accessToken: string,
  ): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.apiUrl}/folders`, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(request),
    });
  }

  putFolder<TResponse = unknown>(
    folderId: string,
    request: FolderRequest,
    accessToken: string,
  ): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.apiUrl}/folders/${folderId}`, {
      method: "PUT",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(request),
    });
  }

  deleteFolder<TResponse = unknown>(
    folderId: string,
    accessToken: string,
  ): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.apiUrl}/folders/${folderId}`, {
      method: "DELETE",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: null,
    });
  }

  putUnarchiveCiphers<TResponse = unknown>(
    cipherIds: readonly string[],
    accessToken: string,
  ): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.apiUrl}/ciphers/unarchive`, {
      method: "PUT",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ ids: cipherIds }),
    });
  }

  putRestoreCipher<TResponse = unknown>(
    cipherId: string,
    accessToken: string,
  ): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(
      `${this.environment.apiUrl}/ciphers/${cipherId}/restore`,
      {
        method: "PUT",
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: null,
      },
    );
  }

  deleteCipher<TResponse = unknown>(cipherId: string, accessToken: string): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.apiUrl}/ciphers/${cipherId}`, {
      method: "DELETE",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: null,
    });
  }

  deleteSend<TResponse = unknown>(sendId: string, accessToken: string): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.apiUrl}/sends/${sendId}`, {
      method: "DELETE",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: null,
    });
  }

  putSendRemovePassword<TResponse = unknown>(
    sendId: string,
    accessToken: string,
  ): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(
      `${this.environment.apiUrl}/sends/${sendId}/remove-password`,
      {
        method: "PUT",
        cache: "no-store",
        credentials: "include",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: null,
      },
    );
  }

  postSend<TResponse = unknown>(
    request: TextSendCreateRequest,
    accessToken: string,
  ): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.apiUrl}/sends`, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(request),
    });
  }

  putSend<TResponse = unknown>(
    sendId: string,
    request: TextSendCreateRequest,
    accessToken: string,
  ): Promise<TResponse> {
    return this.transport.fetchJson<TResponse>(`${this.environment.apiUrl}/sends/${sendId}`, {
      method: "PUT",
      cache: "no-store",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(request),
    });
  }
}

function plainHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (
    typeof headers === "object" &&
    !Array.isArray(headers) &&
    !(headers instanceof Headers)
  ) {
    return { ...(headers as Record<string, string>) };
  }

  const result: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

function normalizeRequiredUrl(value: string | null | undefined, name: string): string {
  const normalized = normalizeOptionalUrl(value);
  if (!normalized) {
    throw new Error(`${name} is required for self-hosted Bitwarden environments`);
  }

  return normalized;
}

function normalizeOptionalUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim().replace(/\/+$/g, "");
  const candidate = !trimmed.startsWith("http://") && !trimmed.startsWith("https://")
    ? `https://${trimmed}`
    : trimmed;
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error();
    }
  } catch {
    throw new Error("Invalid Bitwarden server URL");
  }
  return candidate;
}
