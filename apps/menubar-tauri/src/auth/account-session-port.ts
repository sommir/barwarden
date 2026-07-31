import { InjectionToken } from "@angular/core";

import { createDefaultHostService } from "../host/default-host.service";
import { AccountSessionStore, type AccountAuthenticationStatus, type StoredAccount } from "./account-session-store";
import type { AuthSession } from "./auth-session-store";

export {
  AccountSessionMutationCancelledError,
  AccountSessionReplacementConsistencyError,
  AccountSessionSaveConsistencyError,
} from "./account-session-errors";

export interface AccountSessionPort {
  list(): Promise<readonly StoredAccount[]>;
  saveAccount(
    input: { readonly email: string; readonly serverUrl: string; readonly session: AuthSession },
    isCurrent?: () => boolean,
  ): Promise<StoredAccount>;
  setActive(id: string): Promise<StoredAccount>;
  setStatus(
    id: string,
    status: AccountAuthenticationStatus,
    isCurrent?: () => boolean,
  ): Promise<void>;
  readSession(id: string): Promise<AuthSession | null>;
  replaceSession(id: string, session: AuthSession, isCurrent?: () => boolean): Promise<boolean>;
  remove(id: string): Promise<StoredAccount | null>;
  lockAll(): Promise<void>;
}

export const ACCOUNT_SESSION_PORT = new InjectionToken<AccountSessionPort | null>(
  "ACCOUNT_SESSION_PORT",
  {
    providedIn: "root",
    factory: () => new AccountSessionStore(createDefaultHostService()),
  },
);
