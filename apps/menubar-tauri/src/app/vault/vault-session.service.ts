import { Inject, Injectable, Optional } from "@angular/core";

import {
  AccountSessionReplacementConsistencyError,
  ACCOUNT_SESSION_PORT,
  type AccountSessionPort,
} from "../../auth/account-session-port";
import type { AuthSession } from "../../auth/auth-session-store";
import {
  AUTH_TOKEN_REFRESH_PORT,
  createDefaultAuthTokenRefreshService,
  type AuthTokenRefreshPort,
} from "../../auth/auth-token-refresh.service";
import {
  BitwardenApiClient,
  BitwardenApiError,
  HttpTransportError,
} from "../../bitwarden-api/bitwarden-api";
import { createDefaultHostService } from "../../host/default-host.service";
import { VaultSyncService } from "../../vault/vault-sync.service";
import { PopupStateStore } from "../popup-state";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { VAULT_SYNC_PORT, type VaultSyncPort } from "../auth/vault-sync.shared";

export type VaultSyncFailureCode =
  | "session-missing"
  | "transport"
  | "sync-failed";

export type VaultSyncOutcome =
  | { readonly status: "succeeded" }
  | { readonly status: "cancelled" }
  | {
      readonly status: "failed";
      readonly code: VaultSyncFailureCode;
    };

@Injectable({ providedIn: "root" })
export class VaultSessionService {
  constructor(
    private readonly store: PopupStateStore,
    @Optional() @Inject(VAULT_SYNC_PORT) private readonly vaultSyncPort: VaultSyncPort | null = null,
    @Optional() @Inject(ACCOUNT_SESSION_PORT) private readonly accountStore: AccountSessionPort | null = null,
    @Optional() @Inject(AUTH_TOKEN_REFRESH_PORT) private readonly tokenRefreshPort: AuthTokenRefreshPort | null = null,
  ) {}

  async syncNow(
    isCurrent: () => boolean = () => true,
    options: VaultSyncSessionOptions = {},
  ): Promise<void> {
    await this.syncNowOutcome(isCurrent, options);
  }

  async syncNowOutcome(
    isCurrent: () => boolean = () => true,
    options: VaultSyncSessionOptions = {},
  ): Promise<VaultSyncOutcome> {
    if (!isCurrent()) {
      return { status: "cancelled" };
    }
    const snapshot = this.store.snapshot();
    const session = snapshot.activeSession;
    if (!snapshot.isUnlocked) {
      this.store.setSyncError(translateOfficialMessage("i18nSessionLocked"));
      this.store.setStatus(translateOfficialMessage("i18nSessionLocked"));
      return { status: "failed", code: "session-missing" };
    }

    if (!session) {
      this.store.setSyncError(translateOfficialMessage("i18nSessionExpiredTitle"));
      this.store.setStatus(translateOfficialMessage("i18nSessionExpiredTitle"));
      return { status: "failed", code: "session-missing" };
    }

    const syncEpoch = this.store.beginVaultSync();
    const operationCurrent = () => this.store.isCurrentVaultSync(syncEpoch) && isCurrent();
    try {
      const currentSession = isTokenExpiring(session)
        ? await this.refreshAndPersist(session, operationCurrent, options)
        : session;
      if (!currentSession) {
        return incompleteSyncOutcome(operationCurrent(), this.store.snapshot());
      }

      const synced = await this.syncWithRefreshRetry(currentSession, operationCurrent, options);
      if (!synced) {
        return incompleteSyncOutcome(operationCurrent(), this.store.snapshot());
      }
      const { result, session: syncedSession } = synced;
      if (!operationCurrent()) {
        return { status: "cancelled" };
      }
      const latest = this.store.snapshot();
      if (!latest.isUnlocked || latest.activeSession !== syncedSession) {
        this.store.setSyncError(translateOfficialMessage("i18nSessionLocked"));
        this.store.setStatus(translateOfficialMessage("i18nSessionLocked"));
        return { status: "failed", code: "session-missing" };
      }

      const syncedAt = new Date();
      this.store.setItems(
        result.items,
        result.folders,
        syncedAt,
        options.accountId ?? this.store.snapshot().vaultOwnerAccountId,
      );
      this.store.setArchivedItems(result.archivedItems);
      this.store.setDeletedItems(result.deletedItems);
      this.store.setOrganizationData(result.organizations, result.collections);
      this.store.setSends(result.sends, result.sendPolicy);
      this.store.commitVaultSync(syncedAt, syncEpoch);
      this.store.setStatus(
        translateOfficialMessage("i18nSyncedVaultData", result.items.length, result.sends.length),
      );
      return { status: "succeeded" };
    } catch (error) {
      if (!operationCurrent()) {
        return { status: "cancelled" };
      }
      this.store.failVaultSync(hasRetainedVaultData(this.store.snapshot()), syncEpoch);
      this.store.setStatus(translateOfficialMessage("i18nSyncVaultFailed"));
      return {
        status: "failed",
        code: error instanceof HttpTransportError
          ? "transport"
          : "sync-failed",
      };
    } finally {
      if (operationCurrent()) {
        this.store.setSyncing(false);
      }
    }
  }

  private async syncWithRefreshRetry(
    session: AuthSession,
    isCurrent: () => boolean,
    options: VaultSyncSessionOptions,
  ) {
    try {
      return {
        result: await this.syncService(session).sync(session),
        session,
      };
    } catch (error) {
      if (!(error instanceof BitwardenApiError) || error.status !== 401 || !isCurrent()) {
        throw error;
      }

      const refreshedSession = await this.refreshAndPersist(session, isCurrent, options);
      if (!refreshedSession || !isCurrent()) {
        return null;
      }

      return {
        result: await this.syncService(refreshedSession).sync(refreshedSession),
        session: refreshedSession,
      };
    }
  }

  private async refreshAndPersist(
    session: AuthSession,
    isCurrent: () => boolean,
    options: VaultSyncSessionOptions,
  ): Promise<AuthSession | null> {
    try {
      const refreshedSession = await this.tokenRefresh(session).refresh(session);
      if (!isCurrent() || !this.isStillActive(session)) {
        return null;
      }

      if (options.persistRefreshedSession !== false) {
        const accountId = await this.activeAccountIdForPersistence(options);
        if (accountId) {
          const committed = await this.accountStore?.replaceSession(
            accountId,
            refreshedSession,
            () => isCurrent() && this.isStillActive(session),
          );
          if (committed === false) {
            return null;
          }
        }
      }
      if (!isCurrent() || !this.isStillActive(session)) {
        return null;
      }

      this.store.setActiveSession(refreshedSession);
      return refreshedSession;
    } catch (error) {
      if (error instanceof AccountSessionReplacementConsistencyError) {
        return this.handleReplacementConsistencyError(session, isCurrent, options);
      }
      if (!isCurrent() || !this.isStillActive(session)) {
        return null;
      }
      const locked = await this.lockExpiredSession(
        options,
        isCurrent,
        translateOfficialMessage("i18nSessionExpiredTitle"),
      );
      if (!locked) {
        return null;
      }
      return null;
    }
  }

  private isStillActive(session: AuthSession): boolean {
    const snapshot = this.store.snapshot();
    return snapshot.isUnlocked && snapshot.activeSession === session;
  }

  private async activeAccountIdForPersistence(options: VaultSyncSessionOptions): Promise<string | null> {
    if (options.accountId) {
      return options.accountId;
    }

    const accounts = await this.accountStore?.list();
    return accounts?.find((account) => account.isActive)?.id ?? null;
  }

  private async lockExpiredSession(
    options: VaultSyncSessionOptions,
    isCurrent: () => boolean,
    message: string,
  ): Promise<boolean> {
    if (!isCurrent()) {
      return false;
    }
    if (options.persistRefreshedSession === false) {
      this.commitExpiredSessionLock(message, options);
      return true;
    }

    const accountId = await this.activeAccountIdForPersistence(options);
    if (!isCurrent()) {
      return false;
    }
    if (accountId) {
      await this.accountStore?.setStatus(accountId, "locked", isCurrent);
    }
    if (!isCurrent()) {
      return false;
    }
    this.commitExpiredSessionLock(message, options);
    return true;
  }

  private commitExpiredSessionLock(
    message: string,
    options: VaultSyncSessionOptions,
  ): void {
    const session = this.store.snapshot().activeSession;
    if (session) {
      try {
        options.beforeLock?.(session);
      } catch {}
    }
    this.store.setLocked();
    this.store.setSyncError(message);
    this.store.setStatus(message);
  }

  private async handleReplacementConsistencyError(
    session: AuthSession,
    isCurrent: () => boolean,
    options: VaultSyncSessionOptions,
  ): Promise<null> {
    if (!isCurrent() || !this.isStillActive(session)) {
      return null;
    }

    const locked = await this.lockExpiredSession(
      options,
      isCurrent,
      "Unable to safely save session.",
    );
    if (!locked) {
      return null;
    }
    return null;
  }

  private tokenRefresh(session: AuthSession): AuthTokenRefreshPort {
    return this.tokenRefreshPort ?? createDefaultAuthTokenRefreshService(session);
  }

  private syncService(session: AuthSession): VaultSyncPort {
    if (this.vaultSyncPort) {
      return this.vaultSyncPort;
    }

    return new VaultSyncService(
      new BitwardenApiClient(
        session.environment,
        createDefaultHostService(),
      ),
    );
  }
}

export interface VaultSyncSessionOptions {
  readonly accountId?: string | null;
  readonly persistRefreshedSession?: boolean;
  readonly beforeLock?: (session: AuthSession) => void;
}

function hasRetainedVaultData(snapshot: ReturnType<PopupStateStore["snapshot"]>): boolean {
  const retainedCiphers = [
    ...(snapshot.items ?? []),
    ...(snapshot.archivedItems ?? []),
    ...(snapshot.deletedItems ?? []),
  ];
  return (
    retainedCiphers.some((item) => item.type !== "ssh-key") ||
    (snapshot.folders?.length ?? 0) > 0 ||
    (snapshot.sends ?? []).some((send) => send.type === "text")
  );
}

function incompleteSyncOutcome(
  isCurrent: boolean,
  snapshot: ReturnType<PopupStateStore["snapshot"]>,
): VaultSyncOutcome {
  if (!isCurrent) {
    return { status: "cancelled" };
  }
  if (!snapshot.isUnlocked || !snapshot.activeSession) {
    return { status: "failed", code: "session-missing" };
  }
  return { status: "failed", code: "sync-failed" };
}

function isTokenExpiring(session: AuthSession): boolean {
  const obtainedAtEpochMs = session.token.obtainedAtEpochMs;
  if (obtainedAtEpochMs == null) {
    return false;
  }

  return Date.now() >= obtainedAtEpochMs + session.token.expiresIn * 1000 - 60_000;
}
