import { Injectable, Optional } from "@angular/core";
import { Router } from "@angular/router";
import type { Account, AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import type { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import type { AvatarService } from "@bitwarden/common/auth/abstractions/avatar.service";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import type { UserId } from "@bitwarden/common/types/guid";
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  type Observable,
  firstValueFrom,
  map,
  of,
} from "rxjs";

import { AccountSessionStore, type StoredAccount } from "../../auth/account-session-store";
import {
  AccountOperationCancelledError,
  AuthFacade,
} from "./auth.facade";
import { PopupStateStore } from "../popup-state";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

const accountActionError = () =>
  translateOfficialMessage("i18nUnableToCompleteAccountAction");
const ACCOUNT_LIMIT_REACHED = Symbol("account-limit-reached");
const AVATAR_COLOR = "#175DDC";

export interface OfficialAccountSwitcherPort {
  readonly accounts$: Observable<readonly StoredAccount[]>;
  readonly activeAccount$: Observable<StoredAccount | null>;
  select(id: string): Promise<void>;
  add(): Promise<void>;
  lock(id: string): Promise<void>;
  lockAll(): Promise<void>;
  logout(id: string): Promise<void>;
}

export type ActiveAccountAuthorization =
  | "signed-out"
  | "locked"
  | "unlocked"
  | "recovery-required";

@Injectable({ providedIn: "root" })
export class OfficialAccountSwitcherAdapter implements OfficialAccountSwitcherPort {
  static readonly ACCOUNT_LIMIT = 5;
  readonly accountLimit = OfficialAccountSwitcherAdapter.ACCOUNT_LIMIT;

  private readonly accountsSubject = new BehaviorSubject<readonly StoredAccount[]>([]);
  private readonly loadingSubject = new BehaviorSubject(false);
  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  private readonly operations = new Map<string, Promise<void>>();
  private readonly popupState: PopupStateStore;
  private operationEpoch = 0;
  private refreshEpoch = 0;

  readonly accounts$: Observable<readonly StoredAccount[]> = this.accountsSubject.asObservable();
  readonly activeAccount$: Observable<StoredAccount | null> = this.accounts$.pipe(
    map((accounts) => accounts.find((account) => account.isActive) ?? null),
  );
  readonly activeAuthorization$: Observable<ActiveAccountAuthorization>;
  readonly loading$ = this.loadingSubject.asObservable();
  readonly error$ = this.errorSubject.asObservable();

  readonly accountService = new CurrentAccountService(this.accounts$);
  readonly avatarService = new CurrentAvatarService(this.activeAccount$);
  readonly authService: CurrentAuthService;

  constructor(
    private readonly auth: AuthFacade,
    private readonly router: Router,
    @Optional() store: PopupStateStore | null = null,
  ) {
    this.popupState = store ?? new PopupStateStore();
    this.activeAuthorization$ = combineLatest([
      this.activeAccount$,
      this.popupState.state$,
    ]).pipe(
      map(([account, state]) => {
        if (!account) {
          return "signed-out";
        }
        if (
          state.isUnlocked &&
          state.activeSession &&
          normalizeIdentity(state.email) === normalizeIdentity(account.email) &&
          normalizeServer(state.serverUrl) === normalizeServer(account.serverUrl)
        ) {
          return "unlocked";
        }
        return account.status === "unlocked"
          ? "recovery-required"
          : "locked";
      }),
      distinctUntilChanged(),
    );
    this.authService = new CurrentAuthService(
      this.accounts$,
      this.activeAccount$,
      this.activeAuthorization$,
    );
    this.auth.accountPersisted$?.subscribe(() => {
      void this.refresh().catch(() => undefined);
    });
    void this.refresh().catch(() => undefined);
  }

  async refresh(): Promise<void> {
    const operationEpoch = this.operationEpoch;
    const refreshEpoch = ++this.refreshEpoch;
    try {
      const accounts = await this.auth.accounts();
      if (
        operationEpoch === this.operationEpoch &&
        refreshEpoch === this.refreshEpoch
      ) {
        this.publish(accounts);
      }
    } catch {
      if (
        operationEpoch === this.operationEpoch &&
        refreshEpoch === this.refreshEpoch
      ) {
        this.accountsSubject.next([]);
        this.errorSubject.next(accountActionError());
      }
      throw new Error("Account list failed");
    }
  }

  select(id: string): Promise<void> {
    if (this.isCurrentUnlockedAccount(id)) {
      return this.run(`select:${id}`, async (epoch) => {
        await this.navigate("/tabs/vault", epoch);
      });
    }
    return this.run(`select:${id}`, async (epoch) => {
      const selected = await this.auth.switchAccount(id);
      this.assertCurrent(epoch);
      await this.refreshFor(epoch);
      await this.navigate(selected.status === "unlocked" ? "/tabs/vault" : "/lock", epoch);
    });
  }

  add(): Promise<void> {
    if (this.accountsSubject.value.length >= AccountSessionStore.ACCOUNT_LIMIT) {
      return Promise.reject(new Error("Account limit reached"));
    }

    return this.run("add", async (epoch) => {
      const accounts = await this.auth.accounts();
      this.assertCurrent(epoch);
      this.publish(accounts);
      if (accounts.length >= AccountSessionStore.ACCOUNT_LIMIT) {
        throw ACCOUNT_LIMIT_REACHED;
      }
      await this.navigate("/login", epoch);
    });
  }

  lock(id: string): Promise<void> {
    return this.run(`lock:${id}`, async (epoch) => {
      await this.auth.lockAccount(id);
      this.assertCurrent(epoch);
      await this.refreshFor(epoch);
      await this.navigate("/lock", epoch);
    });
  }

  lockAll(): Promise<void> {
    return this.run("lock-all", async (epoch) => {
      await this.auth.lockAll();
      this.assertCurrent(epoch);
      await this.refreshFor(epoch);
      await this.navigate("/lock", epoch);
    });
  }

  logout(id: string): Promise<void> {
    return this.run(`logout:${id}`, async (epoch) => {
      const nextAccount = await this.auth.logoutAccount(id);
      this.assertCurrent(epoch);
      await this.refreshFor(epoch);
      const destination = nextAccount === null
        ? "/login"
        : nextAccount.status === "unlocked"
          ? "/tabs/vault"
          : "/lock";
      await this.navigate(destination, epoch);
    });
  }

  private run(key: string, operation: (epoch: number) => Promise<void>): Promise<void> {
    const duplicate = this.operations.get(key);
    if (duplicate) {
      return duplicate;
    }

    const epoch = ++this.operationEpoch;
    this.loadingSubject.next(true);
    if (this.errorSubject.value !== null) {
      this.errorSubject.next(null);
    }

    const task = (async () => {
      try {
        await operation(epoch);
        this.assertCurrent(epoch);
      } catch (error) {
        if (!this.isCurrent(epoch) || error instanceof AccountOperationCancelledError) {
          throw new AccountOperationCancelledError();
        }
        if (error === ACCOUNT_LIMIT_REACHED) {
          throw new Error("Account limit reached");
        }
        this.errorSubject.next(accountActionError());
        throw new Error("Account action failed");
      } finally {
        if (this.operations.get(key) === task) {
          this.operations.delete(key);
        }
        if (this.isCurrent(epoch)) {
          this.loadingSubject.next(false);
        }
      }
    })();

    this.operations.set(key, task);
    return task;
  }

  private async refreshFor(epoch: number): Promise<void> {
    const accounts = await this.auth.accounts();
    this.assertCurrent(epoch);
    this.publish(accounts);
  }

  private publish(accounts: readonly StoredAccount[]): void {
    this.accountsSubject.next(
      [...accounts].sort((left, right) => Number(right.isActive) - Number(left.isActive)),
    );
  }

  private async navigate(destination: string, epoch: number): Promise<void> {
    this.assertCurrent(epoch);
    if (!(await this.router.navigateByUrl(destination))) {
      throw new Error("Navigation cancelled");
    }
    this.assertCurrent(epoch);
  }

  private assertCurrent(epoch: number): void {
    if (!this.isCurrent(epoch)) {
      throw new AccountOperationCancelledError();
    }
  }

  private isCurrent(epoch: number): boolean {
    return epoch === this.operationEpoch;
  }

  private isCurrentUnlockedAccount(id: string): boolean {
    const account = this.accountsSubject.value.find((candidate) => candidate.id === id);
    const state = this.popupState.snapshot();
    return account?.isActive === true &&
      state.isUnlocked &&
      normalizeIdentity(state.email) === normalizeIdentity(account.email) &&
      normalizeServer(state.serverUrl) === normalizeServer(account.serverUrl);
  }
}

class CurrentAccountService implements Pick<AccountService, "activeAccount$"> {
  readonly activeAccount$: Observable<Account | null>;

  constructor(accounts$: Observable<readonly StoredAccount[]>) {
    this.activeAccount$ = accounts$.pipe(
      map((accounts) => {
        const account = accounts.find((candidate) => candidate.isActive);
        return account ? officialAccount(account) : null;
      }),
    );
  }
}

class CurrentAvatarService implements Pick<AvatarService, "avatarColor$" | "getUserAvatarColor$"> {
  readonly avatarColor$: Observable<string>;

  constructor(activeAccount$: Observable<StoredAccount | null>) {
    this.avatarColor$ = activeAccount$.pipe(map(() => AVATAR_COLOR));
  }

  getUserAvatarColor$(_userId: UserId): Observable<string> {
    return of(AVATAR_COLOR);
  }
}

class CurrentAuthService implements Pick<
  AuthService,
  "activeAccountStatus$" | "authStatuses$" | "authStatusFor$" | "getAuthStatus" | "logOut"
> {
  readonly activeAccountStatus$: Observable<AuthenticationStatus>;
  readonly authStatuses$: Observable<Record<UserId, AuthenticationStatus>>;

  constructor(
    accounts$: Observable<readonly StoredAccount[]>,
    activeAccount$: Observable<StoredAccount | null>,
    activeAuthorization$: Observable<ActiveAccountAuthorization>,
  ) {
    this.activeAccountStatus$ = activeAuthorization$.pipe(
      map(authorizationStatus),
    );
    this.authStatuses$ = combineLatest([
      accounts$,
      activeAccount$,
      activeAuthorization$,
    ]).pipe(
      map(([accounts, activeAccount, activeAuthorization]) => Object.fromEntries(
        accounts.map((account) => [
          account.id,
          account.id === activeAccount?.id
            ? authorizationStatus(activeAuthorization)
            : authenticationStatus(account),
        ]),
      ) as Record<UserId, AuthenticationStatus>),
    );
  }

  authStatusFor$(userId: UserId): Observable<AuthenticationStatus> {
    return this.authStatuses$.pipe(
      map((statuses) => statuses[userId] ?? AuthenticationStatus.LoggedOut),
    );
  }

  getAuthStatus = async (userId?: string): Promise<AuthenticationStatus> => {
    if (userId) {
      return firstValueFrom(this.authStatusFor$(userId as UserId));
    }
    return firstValueFrom(this.activeAccountStatus$);
  };

  logOut = (callback: () => void): void => callback();
}

function officialAccount(account: StoredAccount): Account {
  return {
    id: account.id as UserId,
    email: account.email,
    name: account.email,
    emailVerified: true,
    creationDate: undefined,
  };
}

function authenticationStatus(account: StoredAccount | null): AuthenticationStatus {
  if (!account) {
    return AuthenticationStatus.LoggedOut;
  }
  return account.status === "unlocked"
    ? AuthenticationStatus.Unlocked
    : AuthenticationStatus.Locked;
}

function authorizationStatus(
  authorization: ActiveAccountAuthorization,
): AuthenticationStatus {
  return authorization === "unlocked"
    ? AuthenticationStatus.Unlocked
    : authorization === "signed-out"
      ? AuthenticationStatus.LoggedOut
      : AuthenticationStatus.Locked;
}

function normalizeIdentity(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeServer(value: string): string {
  return value.trim().replace(/\/+$/g, "").toLocaleLowerCase();
}
