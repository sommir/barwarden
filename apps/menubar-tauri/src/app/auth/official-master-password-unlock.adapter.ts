import { Injectable } from "@angular/core";
import { BehaviorSubject, type Observable } from "rxjs";

import {
  AuthFacade,
  AuthUnlockError,
  type AuthUnlockResult,
} from "./auth.facade";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

export type OfficialLockAccount = {
  readonly id: string;
  readonly email: string;
  readonly server: string;
};

export interface OfficialMasterPasswordUnlockPort {
  readonly account$: Observable<OfficialLockAccount | null>;
  unlock(masterPassword: string): Promise<AuthUnlockResult>;
  logout(): Promise<void>;
}

/** Bounded lock-screen bridge. Password input exists only for the active unlock call. */
@Injectable({ providedIn: "root" })
export class OfficialMasterPasswordUnlockAdapter implements OfficialMasterPasswordUnlockPort {
  private readonly account = new BehaviorSubject<OfficialLockAccount | null>(null);

  readonly account$ = this.account.asObservable();

  constructor(private readonly auth: AuthFacade) {}

  async refresh(): Promise<void> {
    let active: Awaited<ReturnType<AuthFacade["accounts"]>>[number] | null = null;
    try {
      active = (await this.auth.accounts()).find((account) => account.isActive) ?? null;
    } catch {
      // The native index can be momentarily unavailable after launch while
      // the identity required for master-password unlock is already present
      // in the non-secret lock state. Preserve that identity rather than
      // presenting a broken, anonymous unlock form.
      active = this.auth.lockedAccountIdentity?.() ?? null;
    }
    this.account.next(
      active
        ? { id: active.id, email: active.email, server: active.serverUrl }
        : null,
    );
  }

  async unlock(masterPassword: string): Promise<AuthUnlockResult> {
    try {
      return await this.auth.unlock(masterPassword);
    } catch (error) {
      throw new OfficialMasterPasswordUnlockError(unlockFailureMessage(error));
    }
  }

  async logout(): Promise<void> {
    try {
      await this.auth.logout();
    } finally {
      await this.refresh();
    }
  }

}

export type OfficialUnlockFailureMessage = string;

export class OfficialMasterPasswordUnlockError extends Error {
  override readonly name = "OfficialMasterPasswordUnlockError";

  constructor(message: OfficialUnlockFailureMessage) {
    super(message);
  }
}

function unlockFailureMessage(error: unknown): OfficialUnlockFailureMessage {
  if (!(error instanceof AuthUnlockError)) {
    return translateOfficialMessage("i18nUnableToUnlock");
  }

  switch (error.code) {
    case "invalid-credentials":
      return translateOfficialMessage("i18nInvalidMasterPasswordRetry");
    case "storage-unavailable":
      return translateOfficialMessage("i18nKeychainAfterVerification");
    case "connection-unavailable":
      return translateOfficialMessage("i18nUnableToConnectServer");
    case "no-account":
      return translateOfficialMessage("i18nNoUnlockableAccount");
    case "unexpected":
      return translateOfficialMessage("i18nUnableToUnlock");
  }
}
