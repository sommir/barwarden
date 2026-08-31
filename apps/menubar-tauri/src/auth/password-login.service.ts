import type {
  BitwardenClientId,
  BitwardenEnvironment,
  NewDeviceOtpRequest,
  PasswordTokenRequest,
  TwoFactorEmailRequest,
} from "../bitwarden-api/bitwarden-api";
import { BARWARDEN_BRAND } from "../app/brand";
import { createDefaultHostService } from "../host/default-host.service";
import { AuthSessionStore, type AuthSession } from "./auth-session-store";
import { bytesToBase64, isSerializedEncString } from "./bitwarden-crypto";
import {
  InstallationIdService,
  type InstallationIdPort,
} from "./installation-id.service";
import {
  OfficialMasterPasswordCrypto,
  kdfConfigFromPrelogin,
  type MasterPasswordCrypto,
  type PasswordPreloginResponseShape,
} from "./master-password-crypto";
import { SecureTwoFactorTrustStore, type TwoFactorTrustStore } from "./two-factor-trust-store";

export interface PasswordLoginRequest {
  readonly email: string;
  readonly masterPassword: string;
  readonly twoFactor?: PasswordTokenRequest["twoFactor"];
  readonly newDeviceOtp?: string;
}

export interface PasswordTokenResponseShape {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly Key?: string;
  readonly key?: string;
  readonly TwoFactorToken?: string;
  readonly twoFactorToken?: string;
}

export interface PasswordLoginApi {
  readonly environment: BitwardenEnvironment;
  postPasswordPrelogin(request: { email: string }): Promise<unknown>;
  postPasswordToken(request: PasswordTokenRequest): Promise<PasswordTokenResponseShape>;
  postTwoFactorEmail(request: TwoFactorEmailRequest): Promise<unknown>;
  postResendNewDeviceOtp(request: NewDeviceOtpRequest): Promise<unknown>;
}

export class PasswordLoginService {
  constructor(
    private readonly api: PasswordLoginApi,
    _sessionStore: AuthSessionStore,
    private readonly masterPasswordCrypto: MasterPasswordCrypto =
      new OfficialMasterPasswordCrypto(),
    _sessionSaveTimeoutMs = 3000,
    private readonly installationId: InstallationIdPort = defaultInstallationIdService(),
    private readonly twoFactorTrustStore: TwoFactorTrustStore = defaultTwoFactorTrustStore(),
  ) {}

  async login(request: PasswordLoginRequest): Promise<AuthSession> {
    assertSupportedTwoFactor(request.twoFactor);
    const email = request.email.trim();
    const trustedDeviceToken = request.twoFactor
      ? null
      : await this.twoFactorTrustStore.get(email, this.api.environment.identityUrl);
    const deviceIdentifier = await this.installationId.getInstallationId();
    const preloginResponse = (await this.api.postPasswordPrelogin({
      email,
    })) as PasswordPreloginResponseShape;
    const kdfConfig = kdfConfigFromPrelogin(preloginResponse);
    let masterKey: Uint8Array | undefined;
    let decryptedUserKey: Uint8Array | undefined;

    try {
      const derivation = await this.masterPasswordCrypto.derive({
        masterPassword: request.masterPassword,
        email,
        kdf: kdfConfig,
      });
      masterKey = derivation.masterKey;
      let tokenResponse: PasswordTokenResponseShape;
      let clientId: BitwardenClientId;
      try {
        ({ clientId, response: tokenResponse } = await this.postPasswordTokenWithCompatibleIdentity(
          email,
          derivation.authenticationHashB64,
          deviceIdentifier,
          {
            twoFactor: request.twoFactor ?? trustedTwoFactorRequest(trustedDeviceToken),
            newDeviceOtp: request.newDeviceOtp,
          },
        ));
      } catch (error) {
        if (trustedDeviceToken && errorRequiresTwoFactor(error)) {
          await this.twoFactorTrustStore.clear(email, this.api.environment.identityUrl);
        }
        throw error;
      }
      await this.persistTrustedDeviceToken(email, request.twoFactor, tokenResponse);
      const encryptedUserKey = tokenResponse.Key ?? tokenResponse.key;
      let userKeyB64: string | undefined;
      if (isSerializedEncString(encryptedUserKey)) {
        decryptedUserKey = await this.masterPasswordCrypto.decryptUserKeyWithMasterKey(
          encryptedUserKey,
          masterKey,
        );
        userKeyB64 = bytesToBase64(decryptedUserKey);
      }

      const session: AuthSession = {
        environment: this.api.environment,
        token: {
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          tokenType: tokenResponse.token_type,
          expiresIn: tokenResponse.expires_in,
          clientId,
          obtainedAtEpochMs: Date.now(),
        },
        ...(userKeyB64 ? { crypto: { userKeyB64 } } : {}),
      };

      return session;
    } finally {
      masterKey?.fill(0);
      decryptedUserKey?.fill(0);
    }
  }

  async sendTwoFactorEmail(email: string): Promise<void> {
    await this.api.postTwoFactorEmail({
      email: email.trim(),
      deviceIdentifier: await this.installationId.getInstallationId(),
    });
  }

  async resendNewDeviceOtp(email: string, masterPassword: string): Promise<void> {
    const normalizedEmail = email.trim();
    const preloginResponse = (await this.api.postPasswordPrelogin({
      email: normalizedEmail,
    })) as PasswordPreloginResponseShape;
    const derivation = await this.masterPasswordCrypto.derive({
      masterPassword,
      email: normalizedEmail,
      kdf: kdfConfigFromPrelogin(preloginResponse),
    });

    try {
      await this.api.postResendNewDeviceOtp({
        email: normalizedEmail,
        masterPasswordHash: derivation.authenticationHashB64,
      });
    } finally {
      derivation.masterKey.fill(0);
    }
  }

  private async postPasswordTokenWithCompatibleIdentity(
    email: string,
    masterPasswordHash: string,
    deviceIdentifier: string,
    challenge: Pick<PasswordTokenRequest, "twoFactor" | "newDeviceOtp"> = {},
  ): Promise<{ readonly clientId: BitwardenClientId; readonly response: PasswordTokenResponseShape }> {
    if (isSelfHostedEnvironment(this.api.environment)) {
      return {
        clientId: "web",
        response: await this.api.postPasswordToken(
          passwordTokenRequest(email, masterPasswordHash, "web", "14", deviceIdentifier, challenge),
        ),
      };
    }

    try {
      return {
        clientId: "desktop",
        response: await this.api.postPasswordToken(
          passwordTokenRequest(email, masterPasswordHash, "desktop", "7", deviceIdentifier, challenge),
        ),
      };
    } catch (error) {
      if (!this.shouldRetryWithWebVaultIdentity()) {
        throw error;
      }

      return {
        clientId: "web",
        response: await this.api.postPasswordToken(
          passwordTokenRequest(email, masterPasswordHash, "web", "14", deviceIdentifier, challenge),
        ),
      };
    }
  }

  private shouldRetryWithWebVaultIdentity(): boolean {
    return isSelfHostedEnvironment(this.api.environment);
  }

  private async persistTrustedDeviceToken(
    email: string,
    submittedTwoFactor: PasswordLoginRequest["twoFactor"],
    response: PasswordTokenResponseShape,
  ): Promise<void> {
    if (submittedTwoFactor && !submittedTwoFactor.remember) {
      await this.twoFactorTrustStore.clear(email, this.api.environment.identityUrl);
      return;
    }
    const token = response.TwoFactorToken ?? response.twoFactorToken;
    if (token) {
      await this.twoFactorTrustStore.save(email, this.api.environment.identityUrl, token);
    }
  }
}

function assertSupportedTwoFactor(twoFactor: PasswordLoginRequest["twoFactor"]): void {
  if (twoFactor && twoFactor.provider !== 0 && twoFactor.provider !== 1) {
    throw new Error("Unsupported two-factor provider");
  }
}

function passwordTokenRequest(
  email: string,
  masterPasswordHash: string,
  clientId: BitwardenClientId,
  deviceType: string,
  deviceIdentifier: string,
  challenge: Pick<PasswordTokenRequest, "twoFactor" | "newDeviceOtp"> = {},
): PasswordTokenRequest {
  return {
    clientId,
    email,
    masterPasswordHash,
    device: {
      type: deviceType,
      identifier: deviceIdentifier,
      name: BARWARDEN_BRAND.deviceName,
    },
    ...challenge,
  };
}

function trustedTwoFactorRequest(token: string | null): PasswordTokenRequest["twoFactor"] {
  return token ? { provider: 5, token, remember: false } : undefined;
}

function errorRequiresTwoFactor(error: unknown): boolean {
  const details = errorDetails(error);
  const providers = details && typeof details === "object"
    ? (details as { readonly TwoFactorProviders2?: unknown }).TwoFactorProviders2
    : null;
  return typeof providers === "object"
    && providers !== null
    && Object.keys(providers).length > 0;
}

function errorDetails(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "responseJson" in error) {
    return (error as { readonly responseJson?: unknown }).responseJson;
  }
  if (!(error instanceof Error)) {
    return null;
  }
  try {
    return JSON.parse(error.message) as unknown;
  } catch {
    return null;
  }
}

let defaultInstallationId: InstallationIdService | undefined;
let defaultTwoFactorTrust: SecureTwoFactorTrustStore | undefined;

function defaultInstallationIdService(): InstallationIdService {
  return defaultInstallationId ??= new InstallationIdService(createDefaultHostService());
}

function defaultTwoFactorTrustStore(): SecureTwoFactorTrustStore {
  return defaultTwoFactorTrust ??= new SecureTwoFactorTrustStore(createDefaultHostService());
}

function isSelfHostedEnvironment(environment: PasswordLoginApi["environment"]): boolean {
  return ![
    "https://identity.bitwarden.com",
    "https://identity.bitwarden.eu",
  ].includes(environment.identityUrl);
}
