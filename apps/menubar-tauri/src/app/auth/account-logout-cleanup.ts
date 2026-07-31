import { InjectionToken } from "@angular/core";

export interface AccountLogoutCleanupPort {
  clearAccount(accountId: string): Promise<void>;
}

export const ACCOUNT_LOGOUT_CLEANUP_PORT = new InjectionToken<AccountLogoutCleanupPort | null>(
  "ACCOUNT_LOGOUT_CLEANUP_PORT",
  {
    providedIn: "root",
    factory: () => null,
  },
);
