import { Inject, Injectable, InjectionToken } from "@angular/core";

import type { AuthSession } from "../../auth/auth-session-store";
import {
  BitwardenApiClient,
  BitwardenApiError,
  type PasswordPreloginRequest,
  type VerifyPasswordRequest,
} from "../../bitwarden-api/bitwarden-api";
import { TauriHostService } from "../../host/tauri-host.service";
import {
  OfficialMasterPasswordCrypto,
  kdfConfigFromPrelogin,
  type MasterPasswordCrypto,
  type PasswordPreloginResponseShape,
} from "../../auth/master-password-crypto";
import { PopupStateStore } from "../popup-state";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

export interface VaultRepromptApi {
  postPasswordPrelogin(request: PasswordPreloginRequest): Promise<unknown>;
  postVerifyPassword(
    request: VerifyPasswordRequest,
    accessToken: string,
    repromptReceipt?: string,
  ): Promise<void>;
}

export type VaultRepromptApiFactory = (session: AuthSession) => VaultRepromptApi;

export const VAULT_REPROMPT_API_FACTORY = new InjectionToken<VaultRepromptApiFactory>(
  "VAULT_REPROMPT_API_FACTORY",
  {
    providedIn: "root",
    factory: () => (session) => new BitwardenApiClient(session.environment, new TauriHostService()),
  },
);

export const VAULT_REPROMPT_CRYPTO = new InjectionToken<MasterPasswordCrypto>(
  "VAULT_REPROMPT_CRYPTO",
  { providedIn: "root", factory: () => new OfficialMasterPasswordCrypto() },
);

export class VaultRepromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultRepromptError";
  }
}

@Injectable({ providedIn: "root" })
export class VaultRepromptService {
  constructor(
    private readonly store: PopupStateStore,
    @Inject(VAULT_REPROMPT_API_FACTORY) private readonly apiFactory: VaultRepromptApiFactory,
    @Inject(VAULT_REPROMPT_CRYPTO) private readonly crypto: MasterPasswordCrypto,
  ) {}

  async verify(
    masterPassword: string,
    operationEpoch: number,
    repromptReceipt?: string,
  ): Promise<boolean> {
    if (!masterPassword) {
      throw new VaultRepromptError(translateOfficialMessage("i18nEnterMasterPassword"));
    }

    const snapshot = this.store.snapshot();
    const session = snapshot.activeSession;
    const email = snapshot.email.trim();
    if (
      !session ||
      !snapshot.isUnlocked ||
      !email ||
      !this.store.isCurrentProtectedOperation(operationEpoch)
    ) {
      return false;
    }

    const api = this.apiFactory(session);
    let masterKey: Uint8Array | undefined;
    let authenticationHash: string | undefined;
    try {
      const prelogin = await api.postPasswordPrelogin({ email });
      if (!this.isCurrent(operationEpoch, session, email)) {
        return false;
      }

      const derivation = await this.crypto.derive({
        masterPassword,
        email,
        kdf: kdfConfigFromPrelogin(prelogin as PasswordPreloginResponseShape),
      });
      masterKey = derivation.masterKey;
      authenticationHash = derivation.authenticationHashB64;
      if (!this.isCurrent(operationEpoch, session, email)) {
        return false;
      }

      const verifyRequest = { masterPasswordHash: authenticationHash };
      if (repromptReceipt) {
        await api.postVerifyPassword(verifyRequest, session.token.accessToken, repromptReceipt);
      } else {
        await api.postVerifyPassword(verifyRequest, session.token.accessToken);
      }
      return this.isCurrent(operationEpoch, session, email);
    } catch (error) {
      if (!this.isCurrent(operationEpoch, session, email)) {
        return false;
      }
      if (error instanceof BitwardenApiError && error.status === 400) {
        throw new VaultRepromptError(translateOfficialMessage("i18nIncorrectMasterPassword"));
      }
      if (error instanceof VaultRepromptError) {
        throw error;
      }
      throw new VaultRepromptError(
        translateOfficialMessage("i18nUnableToVerifyMasterPassword"),
      );
    } finally {
      masterKey?.fill(0);
      masterPassword = "";
      authenticationHash = undefined;
    }
  }

  private isCurrent(operationEpoch: number, session: AuthSession, email: string): boolean {
    const snapshot = this.store.snapshot();
    return (
      this.store.isCurrentProtectedOperation(operationEpoch) &&
      snapshot.isUnlocked &&
      snapshot.activeSession === session &&
      snapshot.email.trim() === email
    );
  }
}
