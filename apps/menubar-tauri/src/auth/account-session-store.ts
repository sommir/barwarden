import {
  isBitwardenClientId,
  type BitwardenEnvironment,
} from "../bitwarden-api/bitwarden-api";
import type { AccountLockIntentHost, HostApi } from "../host/host-api";
import {
  AccountSessionMutationCancelledError,
  AccountSessionReplacementConsistencyError,
  AccountSessionSaveConsistencyError,
} from "./account-session-errors";
import type { AuthSession as AuthSessionValue } from "./auth-session-store";

export type { AuthSession } from "./auth-session-store";

export const ACCOUNT_INDEX_KEY = "auth.accounts";
const ACCOUNT_SESSION_KEY_PREFIX = "auth.account.";

export type AccountAuthenticationStatus = "unlocked" | "locked";

export interface StoredAccount {
  readonly id: string;
  readonly email: string;
  readonly serverUrl: string;
  readonly status: AccountAuthenticationStatus;
  readonly isActive: boolean;
}

interface AccountIndex {
  readonly accounts: readonly StoredAccount[];
}

interface LegacySessionMigration {
  readonly key: string;
  readonly value: string;
}

export class AccountSessionStore {
  static readonly ACCOUNT_LIMIT = 5;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly host: HostApi,
    private readonly lockIntents: AccountLockIntentHost = host,
  ) {}

  async list(): Promise<readonly StoredAccount[]> {
    await this.waitForPendingMutations();
    const accounts = await this.readIndex();
    const lockedAccountIds = await this.readLockIntents(accounts);
    return sortActiveFirst(accounts.map((account) =>
      lockedAccountIds.has(account.id) ? { ...account, status: "locked" } : account,
    ));
  }

  async saveAccount(input: {
    email: string;
    serverUrl: string;
    session: AuthSessionValue;
  }, isCurrent: () => boolean = () => true): Promise<StoredAccount> {
    const email = normalizeEmail(input.email);
    const serverUrl = canonicalServerUrl(input.serverUrl);
    const session = storedSession(input.session);
    const subject = await jwtSubject(session.token.accessToken);
    const id = await scopedAccountId(subject ?? email, serverUrl);

    return this.enqueueMutation(async () => {
      const accounts = await this.readIndex();
      const existingIndex = accounts.findIndex((account) => account.id === id);
      const legacyCandidateIndex = subject
        ? accounts.findIndex((account) => account.id === subject)
        : -1;
      let legacySessionMigration: LegacySessionMigration | null = null;
      if (legacyCandidateIndex !== -1) {
        const legacyAccount = accounts[legacyCandidateIndex];
        const legacySessionKey = legacyAccount ? accountSessionKey(legacyAccount.id) : null;
        const previousLegacySession = legacySessionKey
          ? await this.host.secureGet(legacySessionKey)
          : null;
        if (
          !legacyAccount ||
          !legacySessionKey ||
          !previousLegacySession ||
          !subject ||
          !isMatchingLegacyAccount(legacyAccount, subject, serverUrl) ||
          !await sessionBelongsToAccount(previousLegacySession, subject, serverUrl)
        ) {
          throw new AccountSessionSaveConsistencyError();
        }
        legacySessionMigration = { key: legacySessionKey, value: previousLegacySession };
      }
      const legacyIndex = legacySessionMigration ? legacyCandidateIndex : -1;
      const replacementIndex = existingIndex !== -1 ? existingIndex : legacyIndex;
      const migratedLegacyId = legacySessionMigration
        ? accounts[legacyIndex]?.id ?? null
        : null;
      const previousLockIntents = await this.readLockIntents(accounts);
      const lockIntentIds = [...new Set([id, migratedLegacyId].filter((value): value is string => Boolean(value)))];
      const previousLockIntentStates = lockIntentIds.map((accountId) => ({
        accountId,
        locked: previousLockIntents.has(accountId),
      }));

      if (replacementIndex === -1 && accounts.length >= AccountSessionStore.ACCOUNT_LIMIT) {
        throw new Error("Account limit reached");
      }

      const account: StoredAccount = {
        id,
        email,
        serverUrl,
        status: "unlocked",
        isActive: true,
      };
      const updatedAccounts = accounts.flatMap((storedAccount, index) => {
        if (index === legacyIndex && legacyIndex !== replacementIndex) {
          return [];
        }
        return [index === replacementIndex
          ? account
          : { ...storedAccount, isActive: false }];
      });

      if (replacementIndex === -1) {
        updatedAccounts.push(account);
      }

      const sessionKey = accountSessionKey(id);
      const previousSession = await this.host.secureGet(sessionKey);
      this.assertCurrent(isCurrent);
      await this.host.secureSet(sessionKey, JSON.stringify(session));
      if (!isCurrent()) {
        try {
          await this.rollbackSavedAccount(sessionKey, previousSession, accounts, legacySessionMigration);
        } catch {
          await this.quarantineSaveAccount(lockIntentIds, accounts);
          throw new AccountSessionSaveConsistencyError();
        }
        throw new AccountSessionMutationCancelledError();
      }
      this.assertCurrent(isCurrent);
      try {
        await this.writeIndex(updatedAccounts);
      } catch (error) {
        await this.restorePreviousSession(sessionKey, previousSession);
        throw error;
      }
      if (!isCurrent()) {
        try {
          await this.rollbackSavedAccount(sessionKey, previousSession, accounts, legacySessionMigration);
        } catch {
          await this.quarantineSaveAccount(lockIntentIds, accounts);
          throw new AccountSessionSaveConsistencyError();
        }
        throw new AccountSessionMutationCancelledError();
      }

      if (legacySessionMigration) {
        try {
          await this.host.secureDelete(legacySessionMigration.key);
        } catch (error) {
          let legacySessionStillExists = true;
          try {
            legacySessionStillExists = (await this.host.secureGet(legacySessionMigration.key)) !== null;
          } catch {
            // Rollback below re-establishes a known state when deletion cannot be reconciled.
          }
          if (legacySessionStillExists) {
            try {
              await this.rollbackSavedAccount(
                sessionKey,
                previousSession,
                accounts,
                legacySessionMigration,
              );
            } catch {
              await this.quarantineSaveAccount(lockIntentIds, accounts);
              throw new AccountSessionSaveConsistencyError();
            }
            throw error;
          }
        }
      }

      try {
        await this.lockIntents.setAccountLockIntents(lockIntentIds, false);
      } catch (error) {
        try {
          await this.rollbackSavedAccount(sessionKey, previousSession, accounts, legacySessionMigration);
          await this.restoreLockIntents(previousLockIntentStates);
        } catch {
          await this.quarantineSaveAccount(lockIntentIds, accounts);
          throw new AccountSessionSaveConsistencyError();
        }
        throw error;
      }
      if (!isCurrent()) {
        try {
          await this.rollbackSavedAccount(sessionKey, previousSession, accounts, legacySessionMigration);
          await this.restoreLockIntents(previousLockIntentStates);
        } catch {
          await this.quarantineSaveAccount(lockIntentIds, accounts);
          throw new AccountSessionSaveConsistencyError();
        }
        throw new AccountSessionMutationCancelledError();
      }

      return account;
    });
  }

  setActive(id: string): Promise<StoredAccount> {
    return this.enqueueMutation(async () => {
      const accounts = await this.readIndex();
      const selected = accounts.find((account) => account.id === id);
      if (!selected) {
        throw new Error("Account not found");
      }

      const activeAccount = { ...selected, isActive: true };
      await this.writeIndex(
        accounts.map((account) => (account.id === id ? activeAccount : { ...account, isActive: false })),
      );

      const lockedAccountIds = await this.readLockIntents([activeAccount]);
      return lockedAccountIds.has(id)
        ? { ...activeAccount, status: "locked" }
        : activeAccount;
    });
  }

  setStatus(
    id: string,
    status: AccountAuthenticationStatus,
    isCurrent: () => boolean = () => true,
  ): Promise<void> {
    if (!isAccountStatus(status)) {
      return Promise.reject(new Error("Invalid account status"));
    }

    return this.enqueueMutation(async () => {
      const accounts = await this.readIndex();
      const accountExists = accounts.some((account) => account.id === id);
      if (!accountExists) {
        throw new Error("Account not found");
      }

      const hadLockIntent = (await this.readLockIntents(accounts)).has(id);
      this.assertCurrent(isCurrent);
      if (status === "locked") {
        await this.lockIntents.setAccountLockIntents([id], true);
        if (!isCurrent()) {
          await this.restoreLockIntent(id, hadLockIntent);
          throw new AccountSessionMutationCancelledError();
        }
      }
      const updatedAccounts = accounts.map((account) =>
        account.id === id ? { ...account, status } : account,
      );
      await this.writeIndex(updatedAccounts);
      if (!isCurrent()) {
        await this.writeIndex(accounts);
        await this.restoreLockIntent(id, hadLockIntent);
        throw new AccountSessionMutationCancelledError();
      }
      if (status === "locked") {
        await this.lockIntents.setAccountLockIntents([id], false);
        if (!isCurrent()) {
          await this.restoreLockIntent(id, hadLockIntent);
          await this.writeIndex(accounts);
          throw new AccountSessionMutationCancelledError();
        }
      }
    });
  }

  async readSession(id: string): Promise<AuthSessionValue | null> {
    await this.waitForPendingMutations();
    const accounts = await this.readIndex();
    if (!accounts.some((account) => account.id === id)) {
      return null;
    }

    const rawSession = await this.host.secureGet(accountSessionKey(id));
    if (!rawSession) {
      return null;
    }

    try {
      const session = JSON.parse(rawSession) as unknown;
      return isAuthSession(session) ? session : null;
    } catch {
      return null;
    }
  }

  replaceSession(
    id: string,
    session: AuthSessionValue,
    isCurrent: () => boolean = () => true,
  ): Promise<boolean> {
    const replacement = storedSession(session);

    return this.enqueueMutation(async () => {
      const accounts = await this.readIndex();
      if (!accounts.some((account) => account.id === id)) {
        throw new Error("Account not found");
      }
      if (!isCurrent()) {
        return false;
      }

      const sessionKey = accountSessionKey(id);
      const previousSession = await this.host.secureGet(sessionKey);
      await this.host.secureSet(sessionKey, JSON.stringify(replacement));
      if (!isCurrent()) {
        try {
          if (previousSession === null) {
            await this.host.secureDelete(sessionKey);
          } else {
            await this.host.secureSet(sessionKey, previousSession);
          }
        } catch {
          await this.quarantineAccount(id, accounts);
          throw new AccountSessionReplacementConsistencyError();
        }
        return false;
      }

      return true;
    });
  }

  private async quarantineAccount(id: string, accounts: readonly StoredAccount[]): Promise<void> {
    try {
      await this.writeIndex(accounts.filter((account) => account.id !== id));
    } catch {
      throw new AccountSessionReplacementConsistencyError();
    }

    try {
      await this.host.secureDelete(accountSessionKey(id));
    } catch {
      // The account is no longer indexed, so this orphaned secure value is not reachable.
    }
  }

  private async rollbackSavedAccount(
    sessionKey: string,
    previousSession: string | null,
    previousAccounts: readonly StoredAccount[],
    legacySessionMigration: LegacySessionMigration | null = null,
  ): Promise<void> {
    if (legacySessionMigration) {
      await this.host.secureSet(legacySessionMigration.key, legacySessionMigration.value);
    }
    await this.restorePreviousSession(sessionKey, previousSession);
    await this.writeIndex(previousAccounts);
  }

  private async restorePreviousSession(sessionKey: string, previousSession: string | null): Promise<void> {
    if (previousSession === null) {
      await this.host.secureDelete(sessionKey);
      return;
    }

    await this.host.secureSet(sessionKey, previousSession);
  }

  private async quarantineSaveAccount(
    ids: readonly string[],
    previousAccounts: readonly StoredAccount[],
  ): Promise<void> {
    const quarantinedIds = new Set(ids);
    try {
      await this.writeIndex(previousAccounts.filter((account) => !quarantinedIds.has(account.id)));
    } catch {
      throw new AccountSessionSaveConsistencyError();
    }

    for (const id of quarantinedIds) {
      try {
        await this.host.secureDelete(accountSessionKey(id));
      } catch {
        // Quarantined secure values are not reachable from the account index.
      }
    }
  }

  remove(id: string): Promise<StoredAccount | null> {
    return this.enqueueMutation(async () => {
      const accounts = await this.readIndex();
      const account = accounts.find((storedAccount) => storedAccount.id === id);
      if (!account) {
        return null;
      }

      const sessionKey = accountSessionKey(id);
      const remainingAccounts = accounts.filter((storedAccount) => storedAccount.id !== id);

      const updatedAccounts = account.isActive && remainingAccounts.length > 0
        ? remainingAccounts.map((storedAccount, index) => ({
            ...storedAccount,
            isActive: index === 0,
          }))
        : remainingAccounts;

      await this.writeIndex(updatedAccounts);
      try {
        await this.host.secureDelete(sessionKey);
      } catch (error) {
        let sessionStillExists = false;
        try {
          sessionStillExists = (await this.host.secureGet(sessionKey)) !== null;
        } catch {
          // An unknown secure-store state remains unindexed, which is fail closed.
        }
        if (sessionStillExists) {
          try {
            await this.writeIndex(accounts);
          } catch {
            // The session remains stored but unindexed, which is fail closed.
          }
        }
        throw error;
      }

      return account;
    });
  }

  lockAll(): Promise<void> {
    return this.enqueueMutation(async () => {
      const accounts = await this.readIndex();
      const accountIds = accounts.map((account) => account.id);
      await this.lockIntents.setAccountLockIntents(accountIds, true);
      await this.writeIndex(accounts.map((account) => ({ ...account, status: "locked" })));
      await this.lockIntents.setAccountLockIntents(accountIds, false);
    });
  }

  private async readLockIntents(accounts: readonly StoredAccount[]): Promise<ReadonlySet<string>> {
    try {
      return new Set(await this.lockIntents.getAccountLockIntents());
    } catch {
      return new Set(accounts.map((account) => account.id));
    }
  }

  private restoreLockIntent(id: string, wasLocked: boolean): Promise<void> {
    return this.lockIntents.setAccountLockIntents([id], wasLocked);
  }

  private async restoreLockIntents(
    states: readonly { readonly accountId: string; readonly locked: boolean }[],
  ): Promise<void> {
    const lockedIds = states.filter((state) => state.locked).map((state) => state.accountId);
    const unlockedIds = states.filter((state) => !state.locked).map((state) => state.accountId);
    if (lockedIds.length) {
      await this.lockIntents.setAccountLockIntents(lockedIds, true);
    }
    if (unlockedIds.length) {
      await this.lockIntents.setAccountLockIntents(unlockedIds, false);
    }
  }

  private async readIndex(): Promise<StoredAccount[]> {
    const rawIndex = await this.host.secureGet(ACCOUNT_INDEX_KEY);
    if (!rawIndex) {
      return [];
    }

    try {
      const index = JSON.parse(rawIndex) as unknown;
      return isAccountIndex(index) ? [...index.accounts] : [];
    } catch {
      return [];
    }
  }

  private writeIndex(accounts: readonly StoredAccount[]): Promise<void> {
    return this.host.secureSet(ACCOUNT_INDEX_KEY, JSON.stringify({ accounts } satisfies AccountIndex));
  }

  private enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(mutation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async waitForPendingMutations(): Promise<void> {
    await this.mutationQueue.catch(() => undefined);
  }

  private assertCurrent(isCurrent: () => boolean): void {
    if (!isCurrent()) {
      throw new AccountSessionMutationCancelledError();
    }
  }
}

function accountSessionKey(id: string): string {
  return `${ACCOUNT_SESSION_KEY_PREFIX}${id}`;
}

function sortActiveFirst(accounts: readonly StoredAccount[]): StoredAccount[] {
  return [...accounts].sort((left, right) => Number(right.isActive) - Number(left.isActive));
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email) {
    throw new Error("Account email is required");
  }

  return email;
}

function canonicalServerUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    if (url.username || url.password) {
      throw new Error("credentials are not supported");
    }

    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error("Invalid account server URL");
  }
}

async function scopedAccountId(identity: string, serverUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${identity}\n${serverUrl}`));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function isMatchingLegacyAccount(
  account: StoredAccount,
  subject: string,
  serverUrl: string,
): boolean {
  if (account.id !== subject) {
    return false;
  }
  try {
    return canonicalServerUrl(account.serverUrl) === serverUrl;
  } catch {
    return false;
  }
}

async function jwtSubject(accessToken: string): Promise<string | null> {
  const payload = accessToken.split(".")[1];
  if (!payload) {
    return null;
  }

  try {
    const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(`${base64}${padding}`), (character) => character.charCodeAt(0));
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return isRecord(decoded) && isNonEmptyString(decoded["sub"]) ? decoded["sub"] : null;
  } catch {
    return null;
  }
}

async function sessionBelongsToAccount(
  rawSession: string,
  subject: string,
  serverUrl: string,
): Promise<boolean> {
  try {
    const session = JSON.parse(rawSession) as unknown;
    return (
      isAuthSession(session) &&
      await jwtSubject(session.token.accessToken) === subject &&
      session.environment.webVaultUrl !== null &&
      canonicalServerUrl(session.environment.webVaultUrl) === serverUrl
    );
  } catch {
    return false;
  }
}

function storedSession(value: AuthSessionValue): AuthSessionValue {
  if (!isAuthSession(value)) {
    throw new Error("Invalid auth session");
  }

  return {
    environment: copyEnvironment(value.environment),
    token: {
      accessToken: value.token.accessToken,
      refreshToken: value.token.refreshToken,
      tokenType: value.token.tokenType,
      expiresIn: value.token.expiresIn,
      ...(value.token.clientId ? { clientId: value.token.clientId } : {}),
      ...(value.token.obtainedAtEpochMs != null ? { obtainedAtEpochMs: value.token.obtainedAtEpochMs } : {}),
    },
    ...(value.crypto ? { crypto: { userKeyB64: value.crypto.userKeyB64 } } : {}),
  };
}

function copyEnvironment(environment: BitwardenEnvironment): BitwardenEnvironment {
  return {
    apiUrl: environment.apiUrl,
    identityUrl: environment.identityUrl,
    iconsUrl: environment.iconsUrl,
    webVaultUrl: environment.webVaultUrl,
    sendUrl: environment.sendUrl,
  };
}

function isAccountIndex(value: unknown): value is AccountIndex {
  if (!isRecord(value) || !Array.isArray(value["accounts"]) || value["accounts"].length > AccountSessionStore.ACCOUNT_LIMIT) {
    return false;
  }

  const accounts = value["accounts"];
  return (
    accounts.every(isStoredAccount) &&
    new Set(accounts.map((account) => account.id)).size === accounts.length &&
    accounts.filter((account) => account.isActive).length <= 1
  );
}

function isStoredAccount(value: unknown): value is StoredAccount {
  return (
    isRecord(value) &&
    isNonEmptyString(value["id"]) &&
    isNormalizedEmail(value["email"]) &&
    isCanonicalServerUrl(value["serverUrl"]) &&
    isAccountStatus(value["status"]) &&
    typeof value["isActive"] === "boolean"
  );
}

function isNormalizedEmail(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    return normalizeEmail(value) === value;
  } catch {
    return false;
  }
}

function isCanonicalServerUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    return canonicalServerUrl(value) === value;
  } catch {
    return false;
  }
}

function isAuthSession(value: unknown): value is AuthSessionValue {
  if (!isRecord(value) || !isRecord(value["environment"]) || !isRecord(value["token"])) {
    return false;
  }

  const environment = value["environment"];
  const token = value["token"];

  return (
    isNonEmptyString(environment["apiUrl"]) &&
    isNonEmptyString(environment["identityUrl"]) &&
    isNullableString(environment["iconsUrl"]) &&
    isNullableString(environment["webVaultUrl"]) &&
    isNullableString(environment["sendUrl"]) &&
    isNonEmptyString(token["accessToken"]) &&
    isNonEmptyString(token["refreshToken"]) &&
    isNonEmptyString(token["tokenType"]) &&
    typeof token["expiresIn"] === "number" &&
    Number.isFinite(token["expiresIn"]) &&
    (token["clientId"] == null || isBitwardenClientId(token["clientId"])) &&
    (token["obtainedAtEpochMs"] == null ||
      (typeof token["obtainedAtEpochMs"] === "number" && Number.isFinite(token["obtainedAtEpochMs"]))) &&
    (value["crypto"] == null ||
      (isRecord(value["crypto"]) && isNonEmptyString(value["crypto"]["userKeyB64"])))
  );
}

function isAccountStatus(value: unknown): value is AccountAuthenticationStatus {
  return value === "unlocked" || value === "locked";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
