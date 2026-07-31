import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";
import { Subject, type Observable } from "rxjs";

import {
  AccountSessionStore,
  type AccountAuthenticationStatus,
  type StoredAccount,
} from "../../auth/account-session-store";
import {
  ACCOUNT_SESSION_PORT,
  AccountSessionMutationCancelledError,
  type AccountSessionPort,
} from "../../auth/account-session-port";
import {
  AuthSessionStore,
  isAuthSession,
  type AuthSession,
} from "../../auth/auth-session-store";
import { OfficialMasterPasswordCrypto } from "../../auth/master-password-crypto";
import {
  AUTH_TOKEN_REFRESH_PORT,
  type AuthTokenRefreshPort,
} from "../../auth/auth-token-refresh.service";
import { PasswordLoginService } from "../../auth/password-login.service";
import {
  BitwardenApiClient,
  BitwardenApiError,
  HttpTransportError,
} from "../../bitwarden-api/bitwarden-api";
import { createDefaultHostService } from "../../host/default-host.service";
import {
  ProcessSessionBrokerError,
  SecureStorageError,
  type ProcessSessionSnapshot,
} from "../../host/host-api";
import { BitwardenSdkCore } from "../../sdk/bitwarden-sdk-core.service";
import { PopupStateStore, type PopupState } from "../popup-state";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import {
  VaultSessionService,
  type VaultSyncOutcome,
} from "../vault/vault-session.service";
import { VaultTimeoutService } from "./vault-timeout.service";
import {
  environmentFromServerUrl,
  VAULT_SYNC_PORT,
  type VaultSyncPort,
} from "./vault-sync.shared";
import {
  SUPPORTED_TWO_FACTOR_PROVIDERS,
  unsupportedAuthenticationMessage,
} from "./supported-authentication";
import {
  ACCOUNT_LOGOUT_CLEANUP_PORT,
  type AccountLogoutCleanupPort,
} from "./account-logout-cleanup";
import {
  POPUP_ROUTER_CACHE_LIFECYCLE_PORT,
  type PopupRouterCacheLifecyclePort,
} from "../platform/popup-router-cache.lifecycle";
import { authChallengeOutcome, type AuthChallengeOutcome } from "./auth-challenge-route";
import {
  AlternativeUnlockError,
  UNLOCK_METHODS_PORT,
  type UnlockMethodsPort,
} from "./unlock-methods.port";
import {
  PROCESS_SESSION_BROKER,
  type ProcessSessionBrokerPort,
} from "./process-session-broker.service";
import {
  decodeProcessSharedPopupState,
  encodeProcessSharedPopupState,
  processSharedPopupStateRequiresLocalHydration,
} from "./process-shared-popup-state";

export interface LoginRequest {
  readonly email: string;
  readonly masterPassword: string;
  readonly serverUrl: string;
}

export type AuthStartupResult = "login" | "locked" | "unlocked";
export type AuthStartupMode = "cold" | "additional-window";
export type AuthStartupFailureCode =
  | "session-missing"
  | "secure-storage"
  | "transport"
  | "timeout"
  | "sync-failed"
  | "sync-invalid"
  | "local-data-corrupt"
  | "broker-unavailable"
  | "unexpected";
export type AuthUnlockResult = "unlocked" | "twoFactor" | "newDeviceVerification";
export type AuthUnlockFailureCode =
  | "invalid-credentials"
  | "storage-unavailable"
  | "connection-unavailable"
  | "no-account"
  | "unexpected";

export class AuthUnlockError extends Error {
  override readonly name = "AuthUnlockError";

  constructor(readonly code: AuthUnlockFailureCode) {
    super("Unable to unlock vault");
  }
}

export class AuthStartupError extends Error {
  override readonly name = "AuthStartupError";

  constructor(readonly code: AuthStartupFailureCode) {
    super(STARTUP_RESTORE_ERROR_MESSAGE);
  }
}

export interface PasswordLoginPort {
  login(request: {
    readonly email: string;
    readonly masterPassword: string;
    readonly twoFactor?: { readonly provider: number; readonly token: string; readonly remember?: boolean };
    readonly newDeviceOtp?: string;
  }): Promise<AuthSession>;
  sendTwoFactorEmail?(email: string): Promise<void>;
  resendNewDeviceOtp(email: string, masterPassword: string): Promise<void>;
}

type LoginChallengeResponse = {
  readonly twoFactor?: { readonly provider: number; readonly token: string; readonly remember?: boolean };
  readonly newDeviceOtp?: string;
};

export const PASSWORD_LOGIN_PORT = new InjectionToken<PasswordLoginPort | null>(
  "PASSWORD_LOGIN_PORT",
  {
    providedIn: "root",
    factory: () => null,
  },
);

const DEFAULT_LOGIN_TIMEOUT_MS = 30_000;
const DEFAULT_AUTH_CHALLENGE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_ACCOUNT_LIFECYCLE_TIMEOUT_MS = 60_000;
const DEFAULT_STARTUP_RESTORE_TIMEOUT_MS = 8_000;
const ACTIVE_ACCOUNT_HINT_KEY = "barwarden.active-account-hint.v1";
const loginTimeoutMessage = () => translateOfficialMessage("i18nLoginTimeout");
const STARTUP_RESTORE_ERROR_MESSAGE = "Unable to restore saved accounts.";
const noPendingTwoFactorLoginMessage = () =>
  translateOfficialMessage("i18nNoPendingTwoFactorLogin");
const noPendingNewDeviceLoginMessage = () =>
  translateOfficialMessage("i18nNoPendingNewDeviceLogin");
const noPendingEmailTwoFactorMessage = () =>
  translateOfficialMessage("i18nNoPendingEmailTwoFactor");
const noLockedAccountMessage = () => translateOfficialMessage("i18nNoLockedAccount");

export const AUTH_LOGIN_TIMEOUT_MS = new InjectionToken<number>(
  "AUTH_LOGIN_TIMEOUT_MS",
  {
    providedIn: "root",
    factory: () => DEFAULT_LOGIN_TIMEOUT_MS,
  },
);

export const ACCOUNT_LIFECYCLE_TIMEOUT_MS = new InjectionToken<number>(
  "ACCOUNT_LIFECYCLE_TIMEOUT_MS",
  {
    providedIn: "root",
    factory: () => DEFAULT_ACCOUNT_LIFECYCLE_TIMEOUT_MS,
  },
);

export const AUTH_CHALLENGE_TIMEOUT_MS = new InjectionToken<number>(
  "AUTH_CHALLENGE_TIMEOUT_MS",
  {
    providedIn: "root",
    factory: () => DEFAULT_AUTH_CHALLENGE_TIMEOUT_MS,
  },
);

export class AccountOperationCancelledError extends Error {
  override readonly name = "AccountOperationCancelledError";

  constructor() {
    super("Account operation cancelled");
  }
}

export class AccountLogoutRetainedError extends Error {
  override readonly name = "AccountLogoutRetainedError";

  constructor() {
    super("Unable to log out account");
  }
}

@Injectable({ providedIn: "root" })
export class AuthFacade {
  private readonly accountPersistedSubject = new Subject<void>();
  private pendingLoginRequest: LoginRequest | null = null;
  private pendingLoginState: PopupState | null = null;
  private pendingLoginChallenge: LoginChallengeResponse = {};
  private pendingEmailCodeSend: { epoch: number; promise: Promise<void> } | null = null;
  private pendingNewDeviceOtpResend: { epoch: number; promise: Promise<void> } | null = null;
  private pendingChallengeExpiresAt: number | null = null;
  private pendingChallengeTimeout: ReturnType<typeof setTimeout> | null = null;
  private operationEpoch = 0;
  private authBaseline: PopupState | null = null;
  private accountMutationBarrier: Promise<void> = Promise.resolve();
  private readonly loginTimeoutMs: number;
  private readonly lifecycleTimeoutMs: number;
  private runtimeAccountId: string | null = null;
  private inFlightSwitchEpoch: number | null = null;
  private timedOutOperationEpoch: number | null = null;
  private lastAuthenticationFailure: AuthUnlockFailureCode | null = null;

  readonly accountPersisted$: Observable<void> = this.accountPersistedSubject.asObservable();

  constructor(
    private readonly store: PopupStateStore,
    @Optional() @Inject(PASSWORD_LOGIN_PORT) private readonly passwordLoginPort: PasswordLoginPort | null = null,
    @Optional() @Inject(VAULT_SYNC_PORT) private readonly vaultSyncPort: VaultSyncPort | null = null,
    @Optional() private readonly vaultTimeout: VaultTimeoutService | null = null,
    @Optional() @Inject(AUTH_LOGIN_TIMEOUT_MS) loginTimeoutMs: number | null = DEFAULT_LOGIN_TIMEOUT_MS,
    @Optional() @Inject(ACCOUNT_SESSION_PORT) private readonly accountStore: AccountSessionPort | null = null,
    @Optional() @Inject(ACCOUNT_LIFECYCLE_TIMEOUT_MS)
    lifecycleTimeoutMs: number | null = DEFAULT_ACCOUNT_LIFECYCLE_TIMEOUT_MS,
    @Optional() @Inject(AUTH_TOKEN_REFRESH_PORT)
    private readonly tokenRefreshPort: AuthTokenRefreshPort | null = null,
    @Optional() @Inject(AUTH_CHALLENGE_TIMEOUT_MS)
    private readonly challengeTimeoutMs: number = DEFAULT_AUTH_CHALLENGE_TIMEOUT_MS,
    @Optional() @Inject(ACCOUNT_LOGOUT_CLEANUP_PORT)
    private readonly logoutCleanup: AccountLogoutCleanupPort | null = null,
    @Optional() @Inject(POPUP_ROUTER_CACHE_LIFECYCLE_PORT)
    private readonly routeCache: PopupRouterCacheLifecyclePort | null = null,
    @Optional() @Inject(UNLOCK_METHODS_PORT)
    private readonly unlockMethods: UnlockMethodsPort | null = null,
    @Optional() @Inject(PROCESS_SESSION_BROKER)
    private readonly processSessionBroker: ProcessSessionBrokerPort | null = null,
  ) {
    this.loginTimeoutMs = loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
    this.lifecycleTimeoutMs = lifecycleTimeoutMs ?? DEFAULT_ACCOUNT_LIFECYCLE_TIMEOUT_MS;
    this.vaultTimeout?.setTimeoutHandlers(
      () => this.lock(),
      () => { void this.logout(); },
    );
  }

  async login(request: LoginRequest): Promise<void> {
    const baseline = this.authBaseline ?? this.store.snapshot();
    const epoch = this.beginAuthOperation(baseline);
    this.lastAuthenticationFailure = null;
    this.store.setLoggingIn(true);
    this.store.setLoginError("");

    try {
      const session = await this.authenticateWithTimeout(request, {}, epoch, baseline);
      if (!this.isCurrentOperation(epoch)) {
        return;
      }
      const candidateState = this.store.snapshot();
      this.store.restore({ ...baseline, isLoggingIn: true, loginError: "" });
      await this.commitAuthenticatedAccount(request, session, epoch);
      if (!this.isCurrentOperation(epoch)) {
        return;
      }
      await this.activatePersistedPinAfterMasterPassword();
      this.store.restore(candidateState);
      this.finishAuthentication();
      await this.publishCurrentUnlockedState();
    } catch (error) {
      if (error instanceof AuthTimeoutHandledError || !this.isCurrentOperation(epoch)) {
        return;
      }

      const challenge = authChallengeFromError(error, request);
      if (challenge) {
        this.retainPendingChallenge(request, baseline, {}, challenge);
      } else {
        this.lastAuthenticationFailure = authUnlockFailureCode(error);
        this.store.restore(baseline);
        this.clearPendingChallenge();
        this.authBaseline = null;
        this.store.setLoginError(
          loginErrorMessage(error),
        );
      }
    } finally {
      if (this.isCurrentOperation(epoch)) {
        this.store.setLoggingIn(false);
      }
    }
  }

  async submitTwoFactor(twoFactor: { readonly provider: number; readonly token: string; readonly remember?: boolean }): Promise<AuthChallengeOutcome> {
    const request = this.pendingLoginRequest;
    const state = this.store.snapshot();
    if (!request || state.authChallenge?.type !== "twoFactor") {
      if (state.authChallenge) {
        this.store.setAuthChallengeError(state.authChallenge, noPendingTwoFactorLoginMessage());
      } else {
        this.store.setLoginError(noPendingTwoFactorLoginMessage());
      }
      return authChallengeOutcome(state, "twoFactor");
    }

    return this.submitChallenge(request, { ...this.pendingLoginChallenge, twoFactor });
  }

  authChallengeExpiresAt(): number | null {
    return this.store.snapshot().authChallenge ? this.pendingChallengeExpiresAt : null;
  }

  async submitNewDeviceOtp(newDeviceOtp: string): Promise<AuthChallengeOutcome> {
    const request = this.pendingLoginRequest;
    const state = this.store.snapshot();
    const challenge = state.authChallenge;
    if (!request || challenge?.type !== "newDevice") {
      if (challenge) {
        this.store.setAuthChallengeError(challenge, noPendingNewDeviceLoginMessage());
      } else {
        this.store.setLoginError(noPendingNewDeviceLoginMessage());
      }
      return authChallengeOutcome(state, "newDevice");
    }

    return this.submitChallenge(request, { ...this.pendingLoginChallenge, newDeviceOtp });
  }

  async resendNewDeviceOtp(): Promise<void> {
    const request = this.pendingLoginRequest;
    const challenge = this.store.snapshot().authChallenge;
    if (!request || challenge?.type !== "newDevice") {
      this.store.setLoginError(noPendingNewDeviceLoginMessage());
      return;
    }

    const epoch = this.operationEpoch;
    if (this.pendingNewDeviceOtpResend?.epoch === epoch) {
      await this.pendingNewDeviceOtpResend.promise;
      return;
    }

    const promise = (async () => {
      try {
        await this.loginService(request.serverUrl).resendNewDeviceOtp(
          request.email,
          request.masterPassword,
        );
        if (this.operationEpoch === epoch && this.store.snapshot().authChallenge?.type === "newDevice") {
          this.store.setLoginError("");
          this.store.setStatus(translateOfficialMessage("i18nCodeEmailSent"));
        }
      } catch {
        if (this.operationEpoch === epoch && this.store.snapshot().authChallenge?.type === "newDevice") {
          this.store.setAuthChallengeError(
            challenge,
            translateOfficialMessage("i18nCodeEmailFailed"),
          );
        }
      }
    })();
    this.pendingNewDeviceOtpResend = { epoch, promise };
    try {
      await promise;
    } finally {
      if (this.pendingNewDeviceOtpResend?.promise === promise) {
        this.pendingNewDeviceOtpResend = null;
      }
    }
  }

  async sendTwoFactorEmail(): Promise<void> {
    const request = this.pendingLoginRequest;
    const challenge = this.store.snapshot().authChallenge;
    if (
      !request ||
      challenge?.type !== "twoFactor" ||
      !challenge.providers?.includes("1")
    ) {
      this.store.setLoginError(noPendingEmailTwoFactorMessage());
      return;
    }

    const service = this.loginService(request.serverUrl);
    if (!service.sendTwoFactorEmail) {
      this.store.setAuthChallengeError(
        challenge,
        translateOfficialMessage("i18nCodeEmailFailed"),
      );
      return;
    }

    const epoch = this.operationEpoch;
    const email = request.email;
    if (this.pendingEmailCodeSend?.epoch === epoch) {
      await this.pendingEmailCodeSend.promise;
      return;
    }

    const promise = (async () => {
      try {
        await service.sendTwoFactorEmail(email);
        if (this.operationEpoch === epoch) {
          this.store.setLoginError("");
          this.store.setStatus(translateOfficialMessage("i18nCodeEmailSent"));
        }
      } catch {
        if (this.operationEpoch === epoch) {
          this.store.setAuthChallengeError(
            challenge,
            translateOfficialMessage("i18nCodeEmailFailed"),
          );
        }
      }
    })();
    this.pendingEmailCodeSend = { epoch, promise };
    try {
      await promise;
    } finally {
      if (this.pendingEmailCodeSend?.promise === promise) {
        this.pendingEmailCodeSend = null;
      }
    }
  }

  cancelAuthChallenge(): void {
    if (!this.pendingLoginState && !this.authBaseline && !this.store.snapshot().authChallenge) {
      return;
    }

    this.beginLifecycleOperation();
  }

  lock(): void {
    const epoch = this.beginLifecycleOperation();
    this.prepareRuntimeLock();
    this.routeCache?.clear();
    this.vaultTimeout?.stop();
    this.store.setLocked();
    void this.broadcastProcessMutation({ type: "locked" });
    void (async () => {
      try {
        await this.trackAccountMutation(() => this.persistCurrentAccountLock());
      } catch (error) {
        if (this.isCurrentOperation(epoch)) {
          this.surfaceLifecycleError("Unable to save account lock", error);
        }
      }
    })();
  }

  async accounts(): Promise<readonly StoredAccount[]> {
    return this.accountStore
      ? this.boundedRead(this.accountStore.list(), "List accounts")
      : [];
  }

  /**
   * Returns only the non-secret identity already shown on the lock screen.
   * It lets the screen remain coherent while macOS is temporarily slow to
   * answer the secure account-index read; it never supplies a session or
   * authorizes an unlock on its own.
   */
  lockedAccountIdentity(): StoredAccount | null {
    const snapshot = this.store.snapshot();
    const remembered = readActiveAccountHint();
    if (!snapshot.email || !snapshot.serverUrl) {
      return remembered;
    }
    return {
      id: this.runtimeAccountId ?? remembered?.id ?? "",
      email: snapshot.email,
      serverUrl: snapshot.serverUrl,
      status: "locked",
      isActive: true,
    };
  }

  async restoreStartup(mode: AuthStartupMode = "cold"): Promise<AuthStartupResult> {
    const epoch = this.beginLifecycleOperation();
    let accountStore: AccountSessionPort | null = null;
    let activeAccount: StoredAccount | null = null;
    let lockAttempted = false;

    try {
      accountStore = this.requireAccountStore();
      const accounts = await this.boundedStartupRead(accountStore.list(), "Restore accounts");
      this.assertCurrentOperation(epoch);

      activeAccount = accounts.find((account) => account.isActive) ?? null;
      if (!activeAccount) {
        this.vaultTimeout?.stop();
        this.store.setLoggedOut();
        this.setRuntimeAccountId(null);
        clearActiveAccountHint();
        return "login";
      }

      this.setRuntimeAccountId(activeAccount.id);
      persistActiveAccountHint(activeAccount);
      if (mode === "additional-window" && activeAccount.status === "unlocked") {
        lockAttempted = true;
        const session = await this.boundedStartupRead(
          accountStore.readSession(activeAccount.id),
          "Attach account session",
        );
        this.assertCurrentOperation(epoch);
        if (!session) {
          throw new AuthStartupError("session-missing");
        }

        this.store.setLockedAccount(activeAccount.email, activeAccount.serverUrl);
        this.store.setActiveSession(session);
        this.store.setUnlocked(activeAccount.email);
        await this.activatePersistedPinForAttachedProcess(activeAccount.id);
        const syncOutcome = await this.syncWithTimeout(epoch, activeAccount.id);
        this.assertCurrentOperation(epoch);
        if (syncOutcome.status === "failed") {
          throw new AuthStartupError(syncOutcome.code);
        }
        if (syncOutcome.status === "cancelled") {
          throw new AccountOperationCancelledError();
        }
        const attached = this.store.snapshot();
        if (attached.syncError || !attached.isUnlocked || !attached.activeSession) {
          throw new AuthStartupError("sync-failed");
        }
        this.vaultTimeout?.start();
        return "unlocked";
      }

      this.activateLockedAccount(activeAccount);
      this.unlockMethods?.beginLockEpoch(activeAccount.id);
      if (activeAccount.status === "locked") {
        return "locked";
      }

      lockAttempted = true;
      await this.boundedStartupRead(
        accountStore.setStatus(
          activeAccount.id,
          "locked",
          () => this.isCurrentOperation(epoch),
        ),
        "Lock startup account",
      );
      this.assertCurrentOperation(epoch);
      return "locked";
    } catch (error) {
      let failureCode = authStartupFailureCode(error);
      const timeoutStillOwnsRuntime =
        this.timedOutOperationEpoch === epoch && this.operationEpoch === epoch + 1;
      if (!this.isCurrentOperation(epoch) && !timeoutStillOwnsRuntime) {
        throw new AccountOperationCancelledError();
      }
      if (timeoutStillOwnsRuntime) {
        this.timedOutOperationEpoch = null;
      }

      // The account index is secure storage, but the identity needed to show
      // the lock screen is not a secret.  A transient keychain prompt or a
      // slow first access must not strand a known account on the default login
      // environment.  This hint never grants access: unlocking still performs
      // a full password authentication and rewrites the authoritative index.
      if (!activeAccount) {
        const cachedAccount = readActiveAccountHint();
        if (cachedAccount) {
          this.setRuntimeAccountId(cachedAccount.id);
          this.activateLockedAccount(cachedAccount);
          this.unlockMethods?.beginLockEpoch(cachedAccount.id);
          return "locked";
        }
      }

      if (activeAccount) {
        this.activateLockedAccount({ ...activeAccount, status: "locked" });
      }
      if (activeAccount && !lockAttempted) {
        try {
          await this.boundedStartupRead(
            accountStore!.setStatus(
              activeAccount.id,
              "locked",
              () =>
                this.isCurrentOperation(epoch) ||
                (this.timedOutOperationEpoch === epoch && this.operationEpoch === epoch + 1),
            ),
            "Lock restored account",
          );
        } catch (lockError) {
          failureCode = authStartupFailureCode(lockError);
        }
        const statusTimeoutStillOwnsRuntime =
          this.timedOutOperationEpoch === epoch && this.operationEpoch === epoch + 1;
        if (!this.isCurrentOperation(epoch) && !statusTimeoutStillOwnsRuntime) {
          throw new AccountOperationCancelledError();
        }
        if (statusTimeoutStillOwnsRuntime) {
          this.timedOutOperationEpoch = null;
        }
      }

      this.surfaceStartupRestoreError();
      throw new AuthStartupError(failureCode);
    }
  }

  async attachProcessSession(
    processSnapshot: ProcessSessionSnapshot,
  ): Promise<AuthStartupResult> {
    const epoch = this.beginLifecycleOperation();
    if (
      processSnapshot.authorization === "signed-out" ||
      !processSnapshot.activeAccountId
    ) {
      this.vaultTimeout?.stop();
      this.store.setLoggedOut();
      this.setRuntimeAccountId(null);
      return "login";
    }

    if (
      processSnapshot.authorization === "unlocked" &&
      processSnapshot.sharedSnapshot !== null &&
      this.processSessionBroker?.sessionHandoff
    ) {
      try {
        const handoff = await this.processSessionBroker.sessionHandoff();
        if (isAuthSession(handoff)) {
          const decoded = decodeProcessSharedPopupState(
            processSnapshot.sharedSnapshot,
            handoff,
            this.store.snapshot(),
          );
          this.store.restore(decoded);
          this.setRuntimeAccountId(processSnapshot.activeAccountId);
          await this.activatePersistedPinForAttachedProcess(processSnapshot.activeAccountId);
          this.vaultTimeout?.start();
          if (processSharedPopupStateRequiresLocalHydration(decoded)) {
            this.scheduleAttachedSync(epoch, processSnapshot.activeAccountId);
          }
          return "unlocked";
        }
      } catch {
        // Fall back to the durable account session below.
      }
    }

    let activeAccount: StoredAccount | null = null;
    try {
      const accountStore = this.requireAccountStore();
      const accounts = await this.boundedStartupRead(
        accountStore.list(),
        "Attach process account",
      );
      this.assertCurrentOperation(epoch);
      activeAccount =
        accounts.find((account) => account.id === processSnapshot.activeAccountId) ??
        null;
      if (!activeAccount) {
        return this.commitProcessRecovery(
          processSnapshot.activeAccountId,
          null,
          "session-missing",
        );
      }

      this.setRuntimeAccountId(activeAccount.id);
      if (
        processSnapshot.authorization === "locked" ||
        processSnapshot.authorization === "recovery-required"
      ) {
        this.activateLockedAccount({ ...activeAccount, status: "locked" });
        if (processSnapshot.authorization === "recovery-required") {
          this.store.setStatus(translateOfficialMessage("i18nSessionRestoreNeeded"));
        }
        return "locked";
      }

      const session = await this.boundedStartupRead(
        accountStore.readSession(activeAccount.id),
        "Attach secure process session",
      );
      this.assertCurrentOperation(epoch);
      if (!session) {
        return this.commitProcessRecovery(
          activeAccount.id,
          activeAccount,
          "session-missing",
        );
      }

      let restoredSharedSnapshot = false;
      let requiresLocalHydration = false;
      if (processSnapshot.sharedSnapshot !== null) {
        try {
          const decoded = decodeProcessSharedPopupState(
            processSnapshot.sharedSnapshot,
            session,
            this.store.snapshot(),
          );
          this.store.restore(decoded);
          restoredSharedSnapshot = true;
          requiresLocalHydration =
            processSharedPopupStateRequiresLocalHydration(decoded);
        } catch {
          this.store.setLockedAccount(
            activeAccount.email,
            activeAccount.serverUrl,
          );
          this.store.setActiveSession(session);
          this.store.setUnlocked(activeAccount.email);
        }
      } else {
        this.store.setLockedAccount(activeAccount.email, activeAccount.serverUrl);
        this.store.setActiveSession(session);
        this.store.setUnlocked(activeAccount.email);
      }
      await this.activatePersistedPinForAttachedProcess(activeAccount.id);
      this.vaultTimeout?.start();

      if (
        !restoredSharedSnapshot ||
        requiresLocalHydration ||
        processSnapshot.syncState === "stale" ||
        processSnapshot.syncState === "invalid"
      ) {
        this.scheduleAttachedSync(epoch, activeAccount.id);
      }
      return "unlocked";
    } catch (error) {
      if (!this.isCurrentOperation(epoch)) {
        throw new AccountOperationCancelledError();
      }
      const code = authStartupFailureCode(error);
      if (activeAccount) {
        return this.commitProcessRecovery(activeAccount.id, activeAccount, code);
      }
      throw error;
    }
  }

  async publishProcessStartupState(
    result: AuthStartupResult,
  ): Promise<ProcessSessionSnapshot | null> {
    const broker = this.processSessionBroker;
    if (!broker) {
      return null;
    }
    if (result === "login") {
      return broker.mutate({ type: "logged-out" });
    }
    const accountId =
      this.runtimeAccountId ??
      (await this.accounts()).find((account) => account.isActive)?.id ??
      null;
    if (!accountId) {
      return broker.mutate({ type: "logged-out" });
    }
    if (result === "locked") {
      return broker.mutate({
        type: "account-selected",
        activeAccountId: accountId,
      });
    }
    const snapshot = this.store.snapshot();
    if (!snapshot.isUnlocked || !snapshot.activeSession) {
      return broker.mutate({
        type: "recovery-required",
        activeAccountId: accountId,
        code: "session-missing",
      });
    }
    try {
      await broker.setSessionHandoff?.(snapshot.activeSession);
    } catch {}
    let sharedSnapshot: ReturnType<typeof encodeProcessSharedPopupState>;
    try {
      sharedSnapshot = encodeProcessSharedPopupState(snapshot);
    } catch {
      // A large local vault must not prevent this window from starting.
      return null;
    }
    try {
      return await broker.mutate({
        type: "unlocked",
        activeAccountId: accountId,
        sharedSnapshot,
      });
    } catch (error) {
      if (
        error instanceof ProcessSessionBrokerError
        && error.code === "invalid-payload"
      ) {
        return null;
      }
      throw error;
    }
  }

  async publishProcessStateProjection(): Promise<ProcessSessionSnapshot | null | undefined> {
    const broker = this.processSessionBroker;
    const snapshot = this.store.snapshot();
    if (!broker || !snapshot.isUnlocked || !snapshot.activeSession) {
      return null;
    }
    let sharedSnapshot: ReturnType<typeof encodeProcessSharedPopupState>;
    try {
      sharedSnapshot = encodeProcessSharedPopupState(snapshot);
    } catch {
      // Encoding failures are deterministic for the current local state.
      return undefined;
    }
    try {
      return await broker.mutate({
        type: "snapshot-updated",
        sharedSnapshot,
      });
    } catch (error) {
      if (
        error instanceof ProcessSessionBrokerError
        && error.code === "invalid-payload"
      ) {
        return undefined;
      }
      return null;
    }
  }

  async publishProcessActiveTab(
    activeTab: PopupState["activeTab"],
  ): Promise<ProcessSessionSnapshot | null> {
    const broker = this.processSessionBroker;
    const snapshot = this.store.snapshot();
    if (!broker || !snapshot.isUnlocked || !snapshot.activeSession) {
      return null;
    }
    try {
      return await broker.mutate({ type: "active-tab-updated", activeTab });
    } catch {
      return null;
    }
  }

  private async commitProcessRecovery(
    accountId: string,
    account: StoredAccount | null,
    code: AuthStartupFailureCode,
  ): Promise<AuthStartupResult> {
    if (account) {
      this.activateLockedAccount({ ...account, status: "locked" });
    } else {
      this.store.setLoggedOut();
      this.setRuntimeAccountId(null);
    }
    this.store.setStatus(translateOfficialMessage("i18nSessionRestoreNeeded"));
    try {
      await this.processSessionBroker?.mutate({
        type: "recovery-required",
        activeAccountId: accountId,
        code,
      });
    } catch {}
    return account ? "locked" : "login";
  }

  private scheduleAttachedSync(epoch: number, accountId: string): void {
    void Promise.resolve().then(async () => {
      if (!this.isCurrentOperation(epoch) || !this.processSessionBroker) {
        return;
      }
      try {
        await this.processSessionBroker.mutate({ type: "sync-started" });
      } catch {
        return;
      }
      if (!this.isCurrentOperation(epoch)) {
        return;
      }

      const syncOutcome = await this.sessionService().syncNowOutcome(
        () => this.isCurrentOperation(epoch),
        {
          accountId,
          beforeLock: (session) => this.prepareRuntimeLock(session),
        },
      );
      if (!this.isCurrentOperation(epoch)) {
        return;
      }
      const snapshot = this.store.snapshot();
      try {
        if (
          snapshot.isUnlocked &&
          snapshot.activeSession &&
          snapshot.vaultSyncStatus === "fresh"
        ) {
          await this.processSessionBroker.mutate({
            type: "sync-succeeded",
            sharedSnapshot: encodeProcessSharedPopupState(snapshot),
          });
        } else if (snapshot.isUnlocked && snapshot.activeSession) {
          await this.processSessionBroker.mutate({
            type: "sync-failed",
            code: syncOutcome.status === "failed"
              ? syncOutcome.code
              : "sync-failed",
          });
        }
      } catch {}
    });
  }

  async switchAccount(id: string): Promise<StoredAccount> {
    const epoch = this.beginLifecycleOperation();
    if (this.inFlightSwitchEpoch !== null) {
      this.vaultTimeout?.stop();
      this.store.setLocked();
    }
    const previousState = this.store.snapshot();
    this.inFlightSwitchEpoch = epoch;
    return this.performSwitchAccount(id, epoch, previousState);
  }

  async lockAccount(id: string): Promise<void> {
    this.routeCache?.clear();
    const knownActive = this.runtimeAccountId === id;
    if (knownActive) {
      this.beginLifecycleOperation();
      this.prepareRuntimeLock();
      this.vaultTimeout?.stop();
      this.store.setLocked();
      void this.broadcastProcessMutation({ type: "locked" });
    }

    try {
      const accountStore = this.requireAccountStore();
      await this.trackAccountMutation(async () => {
        const account = (await this.boundedRead(accountStore.list(), "List accounts"))
          .find((candidate) => candidate.id === id) ?? null;
        if (account?.isActive && !knownActive) {
          this.beginLifecycleOperation();
          const activeSession = this.store.snapshot().activeSession;
          this.setRuntimeAccountId(account.id);
          this.prepareRuntimeLock(activeSession);
          this.vaultTimeout?.stop();
          this.store.setLockedAccount(account.email, account.serverUrl);
          void this.broadcastProcessMutation({ type: "locked" });
        }
        const accountToLock = knownActive
          ? (await this.boundedRead(accountStore.list(), "List accounts"))
            .find((candidate) => candidate.isActive) ?? account
          : account;
        if (accountToLock) {
          await accountStore.setStatus(accountToLock.id, "locked");
        }
      });
    } catch (error) {
      this.surfaceLifecycleError("Unable to save account lock", error);
      throw new Error("Unable to save account lock");
    }
  }

  async lockAll(): Promise<void> {
    const epoch = this.beginLifecycleOperation();
    this.prepareRuntimeLock();
    this.routeCache?.clear();
    this.vaultTimeout?.stop();
    this.store.setLocked();
    void this.broadcastProcessMutation({ type: "locked" });

    try {
      if (this.accountStore) {
        await this.trackAccountMutation(async () => {
          await this.boundedRead(this.accountStore!.list(), "List accounts");
          await this.accountStore!.lockAll();
        });
      }
    } catch (error) {
      if (this.isCurrentOperation(epoch)) {
        this.surfaceLifecycleError("Unable to save account locks", error);
        throw new Error("Unable to save account locks");
      }
      throw new AccountOperationCancelledError();
    }
  }

  async logoutAccount(id: string): Promise<StoredAccount | null> {
    const epoch = this.beginLifecycleOperation();
    this.routeCache?.clear();
    if (this.runtimeAccountId === id) {
      this.prepareRuntimeLock();
      this.vaultTimeout?.stop();
      this.store.setLocked();
      void this.broadcastProcessMutation({ type: "locked" });
    }
    const nextAccount = await this.performLogoutAccount(id, epoch);
    if (!nextAccount && !this.store.snapshot().email) {
      await this.broadcastProcessMutation({ type: "logged-out" });
    }
    return nextAccount;
  }

  private async performSwitchAccount(
    id: string,
    epoch: number,
    previousState: PopupState,
  ): Promise<StoredAccount> {
    const accountStore = this.requireAccountStore();
    let selectedAccount: StoredAccount;
    try {
      selectedAccount = await this.trackAccountMutation(() => accountStore.setActive(id));
    } catch (error) {
      if (this.inFlightSwitchEpoch === epoch) {
        this.inFlightSwitchEpoch = null;
      }
      if (!this.isCurrentOperation(epoch)) {
        throw new AccountOperationCancelledError();
      }
      this.store.restore(previousState);
      this.surfaceLifecycleError("Unable to switch account", error);
      throw new Error(sanitizedErrorMessage(error));
    }

    if (!this.isCurrentOperation(epoch)) {
      throw new AccountOperationCancelledError();
    }

    try {
      await this.processSessionBroker?.mutate({
        type: "account-selected",
        activeAccountId: selectedAccount.id,
      });
    } catch {}

    this.prepareRuntimeLock(previousState.activeSession);
    this.setRuntimeAccountId(selectedAccount.id);
    this.vaultTimeout?.stop();
    this.activateLockedAccount(selectedAccount);

    try {
      selectedAccount = await this.activeAccount(id, epoch);
      if (selectedAccount.status === "locked") {
        this.unlockMethods?.beginLockEpoch(selectedAccount.id);
        return selectedAccount;
      }

      const session = await this.boundedRead(
        accountStore.readSession(selectedAccount.id),
        "Read account session",
      );
      const verifiedAccount = await this.activeAccount(id, epoch);
      if (verifiedAccount.status === "locked") {
        this.unlockMethods?.beginLockEpoch(verifiedAccount.id);
        return verifiedAccount;
      }
      if (!session) {
        await accountStore.setStatus(verifiedAccount.id, "locked");
        this.unlockMethods?.beginLockEpoch(verifiedAccount.id);
        return { ...verifiedAccount, status: "locked" as const };
      }

      this.assertCurrentOperation(epoch);
      this.store.setActiveSession(session);
      this.store.setUnlocked(verifiedAccount.email);
      await this.syncWithTimeout(epoch, verifiedAccount.id);

      const synchronizedAccount = await this.activeAccount(id, epoch);
      if (synchronizedAccount.status !== "unlocked") {
        this.clearSwitchedSession(session, synchronizedAccount);
        return synchronizedAccount;
      }

      const syncError = this.store.snapshot().syncError;
      if (syncError) {
        const lockedAccount = { ...synchronizedAccount, status: "locked" as const };
        this.prepareRuntimeLock();
        this.activateLockedAccount(lockedAccount);
        await accountStore.setStatus(lockedAccount.id, "locked");
        this.surfaceLifecycleError("Unable to synchronize account", syncError);
        return lockedAccount;
      }

      this.vaultTimeout?.start();
      await this.publishCurrentUnlockedState();
      return synchronizedAccount;
    } catch (error) {
      const timeoutStillOwnsRuntime = () =>
        this.timedOutOperationEpoch === epoch && this.operationEpoch === epoch + 1;
      if (!this.isCurrentOperation(epoch) && !timeoutStillOwnsRuntime()) {
        throw new AccountOperationCancelledError();
      }
      let lockError: unknown = null;
      try {
        await accountStore.setStatus(
          selectedAccount.id,
          "locked",
          () => this.isCurrentOperation(epoch) || timeoutStillOwnsRuntime(),
        );
      } catch (statusError) {
        lockError = statusError;
      }
      if (!this.isCurrentOperation(epoch) && !timeoutStillOwnsRuntime()) {
        throw new AccountOperationCancelledError();
      }
      if (timeoutStillOwnsRuntime()) {
        this.timedOutOperationEpoch = null;
      }
      const activeSession = this.store.snapshot().activeSession;
      if (activeSession) {
        this.prepareRuntimeLock(activeSession);
      } else {
        this.unlockMethods?.beginLockEpoch(selectedAccount.id);
      }
      this.activateLockedAccount({ ...selectedAccount, status: "locked" });
      const surfacedError = lockError ?? error;
      this.surfaceLifecycleError("Unable to switch account", surfacedError);
      throw new Error(sanitizedErrorMessage(surfacedError));
    } finally {
      if (this.inFlightSwitchEpoch === epoch) {
        this.inFlightSwitchEpoch = null;
      }
    }
  }

  private async performLogoutAccount(id: string, epoch: number): Promise<StoredAccount | null> {
    const accountStore = this.requireAccountStore();
    let targetAccount: StoredAccount | null;
    try {
      const accounts = await this.boundedRead(accountStore.list(), "List accounts");
      this.assertCurrentOperation(epoch);
      targetAccount = accounts.find((account) => account.id === id) ?? null;
      if (!targetAccount) {
        return accounts.find((account) => account.isActive) ?? null;
      }

      if (targetAccount.isActive && this.isCurrentOperation(epoch)) {
        this.vaultTimeout?.stop();
        this.store.setLockedAccount(targetAccount.email, targetAccount.serverUrl);
        this.setRuntimeAccountId(targetAccount.id);
      }

      this.assertCurrentOperation(epoch);
      let removed: StoredAccount | null;
      try {
        removed = await this.trackAccountMutation(async () => {
          if (targetAccount.isActive) {
            await this.clearLegacySession(epoch);
          }
          await this.logoutCleanup?.clearAccount(id);
          this.assertCurrentOperation(epoch);
          return accountStore.remove(id);
        });
      } catch (error) {
        this.assertCurrentOperation(epoch);
        if (targetAccount.isActive) {
          try {
            await accountStore.setStatus(targetAccount.id, "locked");
          } catch (statusError) {
            error = statusError;
          }
          this.store.setLockedAccount(targetAccount.email, targetAccount.serverUrl);
          this.setRuntimeAccountId(targetAccount.id);
        }
        this.surfaceLifecycleError("Unable to log out account", error);
        throw new AccountLogoutRetainedError();
      }
      this.assertCurrentOperation(epoch);
      let remainingAccounts: readonly StoredAccount[];
      try {
        remainingAccounts = await this.boundedRead(accountStore.list(), "List accounts");
      } catch (error) {
        this.assertCurrentOperation(epoch);
        if (targetAccount.isActive && this.isCurrentOperation(epoch)) {
          this.store.setLoggedOut();
          this.setRuntimeAccountId(null);
          this.surfaceLifecycleError("Unable to inspect remaining accounts", error);
        }
        return null;
      }
      this.assertCurrentOperation(epoch);
      if (!removed || !targetAccount.isActive) {
        return remainingAccounts.find((account) => account.isActive) ?? null;
      }

      if (!this.isCurrentOperation(epoch)) {
        throw new AccountOperationCancelledError();
      }

      const nextAccount = remainingAccounts.find((account) => account.isActive) ?? remainingAccounts[0] ?? null;
      if (!nextAccount) {
        this.store.setLoggedOut();
        this.setRuntimeAccountId(null);
        return null;
      }

      this.store.setLoggedOut();
      this.setRuntimeAccountId(null);
      try {
        this.inFlightSwitchEpoch = epoch;
        return await this.performSwitchAccount(nextAccount.id, epoch, this.store.snapshot());
      } catch (error) {
        if (error instanceof AccountOperationCancelledError) {
          throw error;
        }
        this.store.setLoggedOut();
        this.setRuntimeAccountId(null);
        this.surfaceLifecycleError("Unable to activate another account", error);
        return null;
      }
    } catch (error) {
      if (error instanceof AccountOperationCancelledError || error instanceof AccountLogoutRetainedError) {
        throw error;
      }
      this.surfaceLifecycleError("Unable to log out account", error);
      throw new AccountLogoutRetainedError();
    }
  }

  async unlock(masterPassword: string): Promise<AuthUnlockResult> {
    const snapshot = this.store.snapshot();
    if (!snapshot.email) {
      this.store.setLoginError(noLockedAccountMessage());
      throw new AuthUnlockError("no-account");
    }

    await this.login({
      email: snapshot.email,
      masterPassword,
      serverUrl: snapshot.serverUrl,
    });
    const result = this.store.snapshot();
    if (result.authChallenge?.type === "twoFactor") {
      return "twoFactor";
    }
    if (result.authChallenge?.type === "newDevice") {
      return "newDeviceVerification";
    }
    if (!result.isUnlocked) {
      throw new AuthUnlockError(this.lastAuthenticationFailure ?? "unexpected");
    }
    return "unlocked";
  }

  async unlockWithPin(pin: string): Promise<void> {
    try {
      await this.unlockWithAlternative((methods, accountId) =>
        methods.unlockWithPin(accountId, pin),
      );
    } finally {
      pin = "";
    }
  }

  async unlockWithBiometric(): Promise<void> {
    await this.unlockWithAlternative((methods, accountId) =>
      methods.unlockWithBiometric(accountId),
    );
  }

  async logout(): Promise<void> {
    const epoch = this.beginLifecycleOperation();
    this.prepareRuntimeLock();
    this.routeCache?.clear();
    this.vaultTimeout?.stop();
    this.store.setLocked();
    await this.accountMutationBarrier;
    this.assertCurrentOperation(epoch);
    const activeAccount = (await this.accounts()).find((account) => account.isActive) ?? null;
    this.assertCurrentOperation(epoch);
    if (!activeAccount) {
      await this.clearLegacySession(epoch);
    }
    const nextAccount = activeAccount
      ? await this.performLogoutAccount(activeAccount.id, epoch)
      : null;
    this.assertCurrentOperation(epoch);
    if (!nextAccount) {
      const remainingActive = (await this.accounts()).find((account) => account.isActive) ?? null;
      this.assertCurrentOperation(epoch);
      if (remainingActive) {
        return;
      }
      this.store.setLoggedOut();
      clearActiveAccountHint();
      this.store.setStatus(translateOfficialMessage("i18nLoggedOut"));
      await this.broadcastProcessMutation({ type: "logged-out" });
    }
  }

  private async publishCurrentUnlockedState(): Promise<void> {
    const broker = this.processSessionBroker;
    const accountId = this.runtimeAccountId;
    const snapshot = this.store.snapshot();
    if (!broker || !accountId || !snapshot.isUnlocked || !snapshot.activeSession) {
      return;
    }
    try {
      await broker.setSessionHandoff?.(snapshot.activeSession);
    } catch {
      // The public, sanitized snapshot is still useful even if the ephemeral
      // credential handoff cannot be published.
    }
    let sharedSnapshot: ReturnType<typeof encodeProcessSharedPopupState>;
    try {
      sharedSnapshot = encodeProcessSharedPopupState(snapshot);
    } catch {
      return;
    }
    try {
      await broker.mutate({
        type: "unlocked",
        activeAccountId: accountId,
        sharedSnapshot,
      });
    } catch {}
  }

  private broadcastProcessMutation(
    mutation: Parameters<ProcessSessionBrokerPort["mutate"]>[0],
  ): Promise<void> {
    const broker = this.processSessionBroker;
    if (!broker) {
      return Promise.resolve();
    }
    return broker.mutate(mutation).then(
      () => undefined,
      () => undefined,
    );
  }

  private async clearLegacySession(epoch: number): Promise<void> {
    await new AuthSessionStore(createDefaultHostService()).clear();
    this.assertCurrentOperation(epoch);
  }

  private loginService(serverUrl: string): PasswordLoginPort {
    if (this.passwordLoginPort) {
      return this.passwordLoginPort;
    }

    const host = createDefaultHostService();
    const environment = environmentFromServerUrl(serverUrl);
    return new PasswordLoginService(
      new BitwardenApiClient(environment, host),
      new AuthSessionStore(host),
      new OfficialMasterPasswordCrypto(new BitwardenSdkCore()),
    );
  }

  private sessionService(): VaultSessionService {
    return new VaultSessionService(
      this.store,
      this.vaultSyncPort,
      this.accountStore,
      this.tokenRefreshPort,
    );
  }

  private async unlockWithAlternative(
    restore: (methods: UnlockMethodsPort, accountId: string) => Promise<AuthSession>,
  ): Promise<void> {
    const methods = this.unlockMethods;
    const accountId = this.runtimeAccountId;
    if (!methods || !accountId) {
      throw new AlternativeUnlockError("session-unavailable");
    }

    const epoch = this.beginLifecycleOperation();
    const account = await this.activeAlternativeAccount(accountId, epoch);
    let session: AuthSession;
    try {
      session = await restore(methods, account.id);
    } catch (error) {
      this.assertCurrentOperation(epoch);
      if (error instanceof AlternativeUnlockError) {
        throw error;
      }
      throw new AlternativeUnlockError("session-unavailable");
    }
    this.assertCurrentOperation(epoch);
    const verifiedAccount = await this.activeAlternativeAccount(account.id, epoch);
    await this.restoreAlternativeSession(verifiedAccount, session, epoch);
  }

  private async activeAlternativeAccount(
    accountId: string,
    epoch: number,
  ): Promise<StoredAccount> {
    try {
      return await this.activeAccount(accountId, epoch);
    } catch (error) {
      if (error instanceof AccountOperationCancelledError || !this.isCurrentOperation(epoch)) {
        throw new AccountOperationCancelledError();
      }
      throw new AlternativeUnlockError("session-unavailable");
    }
  }

  private async restoreAlternativeSession(
    account: StoredAccount,
    session: AuthSession,
    epoch: number,
  ): Promise<void> {
    let candidateInstalled = false;
    try {
      this.assertCurrentOperation(epoch);
      this.store.setActiveSession(session);
      this.store.setUnlocked(account.email);
      candidateInstalled = true;
      await this.syncWithTimeout(epoch, account.id);
      this.assertCurrentOperation(epoch);

      const synchronized = this.store.snapshot();
      if (synchronized.syncError || !synchronized.isUnlocked || !synchronized.activeSession) {
        throw new AlternativeUnlockError("sync-failed");
      }

      await this.trackAccountMutation(() =>
        this.requireAccountStore().setStatus(
          account.id,
          "unlocked",
          () => this.isCurrentOperation(epoch) && this.store.snapshot().isUnlocked,
        ),
      );
      this.assertCurrentOperation(epoch);
      this.vaultTimeout?.start();
    } catch (error) {
      if (candidateInstalled && this.isCurrentOperation(epoch)) {
        this.prepareRuntimeLock(this.store.snapshot().activeSession);
        this.activateLockedAccount({ ...account, status: "locked" });
        try {
          await this.trackAccountMutation(() =>
            this.requireAccountStore().setStatus(
              account.id,
              "locked",
              () => this.isCurrentOperation(epoch),
            ),
          );
        } catch {}
      }
      if (!this.isCurrentOperation(epoch)) {
        throw new AccountOperationCancelledError();
      }
      if (error instanceof AlternativeUnlockError) {
        throw error;
      }
      throw new AlternativeUnlockError("sync-failed");
    }
  }

  private prepareRuntimeLock(
    activeSession: AuthSession | null = this.store.snapshot().activeSession,
  ): void {
    const accountId = this.runtimeAccountId;
    const methods = this.unlockMethods;
    if (!accountId || !methods) {
      return;
    }

    if (activeSession) {
      try {
        methods.prepareForLock(accountId, activeSession);
      } catch {}
    }
    methods.beginLockEpoch(accountId);
  }

  private async submitChallenge(
    request: LoginRequest,
    challenge: LoginChallengeResponse,
  ): Promise<AuthChallengeOutcome> {
    const activeChallenge = this.store.snapshot().authChallenge;
    const challengeExpiresAt = this.pendingChallengeExpiresAt;
    const baseline = this.pendingLoginState ?? this.authBaseline ?? this.store.snapshot();
    const epoch = this.beginChallengeOperation(baseline);
    this.store.setLoggingIn(true);
    this.store.setLoginError("");
    try {
      const session = await this.authenticateWithTimeout(request, challenge, epoch, baseline);
      if (this.challengeDeadlineExpired(challengeExpiresAt)) {
        this.handleExpiredChallengeAttempt(epoch, baseline);
        return "login";
      }
      if (!this.isCurrentOperation(epoch)) {
        return authChallengeOutcome(this.store.snapshot(), activeChallenge?.type ?? "twoFactor");
      }
      const candidateState = this.store.snapshot();
      this.store.restore({ ...baseline, isLoggingIn: true, loginError: "" });
      await this.commitAuthenticatedAccount(request, session, epoch);
      if (!this.isCurrentOperation(epoch)) {
        return authChallengeOutcome(this.store.snapshot(), activeChallenge?.type ?? "twoFactor");
      }
      await this.activatePersistedPinAfterMasterPassword();
      this.store.restore(candidateState);
      this.finishAuthentication();
      return "unlocked";
    } catch (error) {
      if (error instanceof AuthTimeoutHandledError || !this.isCurrentOperation(epoch)) {
        return authChallengeOutcome(this.store.snapshot(), activeChallenge?.type ?? "twoFactor");
      }
      if (this.challengeDeadlineExpired(challengeExpiresAt)) {
        this.handleExpiredChallengeAttempt(epoch, baseline);
        return "login";
      }

      const describedChallenge = authChallengeFromError(error, request);
      const nextChallenge = describedChallenge ?? (
        activeChallenge && isRecoverableChallengeFailure(error) ? activeChallenge : null
      );
      if (nextChallenge) {
        const retainedChallenge = nextChallenge.type !== activeChallenge?.type
          ? challenge
          : this.pendingLoginChallenge;
        this.store.restore(baseline);
        this.retainPendingChallenge(
          request,
          baseline,
          retainedChallenge,
          nextChallenge,
          loginErrorMessage(error),
          challengeExpiresAt,
        );
        return nextChallenge.type;
      } else {
        this.store.restore(baseline);
        this.clearPendingChallenge();
        this.authBaseline = null;
        this.store.setLoginError(loginErrorMessage(error));
        return "login";
      }
    } finally {
      if (this.isCurrentOperation(epoch)) {
        this.store.setLoggingIn(false);
      }
    }
  }

  private authenticateWithTimeout(
    request: LoginRequest,
    challenge: {
      readonly twoFactor?: { readonly provider: number; readonly token: string; readonly remember?: boolean };
      readonly newDeviceOtp?: string;
    },
    epoch: number,
    baseline: PopupState,
  ): Promise<AuthSession> {
    return withTimeoutHandler(
      this.authenticateAndSync(request, challenge, epoch),
      this.loginTimeoutMs,
      () => this.handleAuthTimeout(epoch, baseline),
    );
  }

  private async authenticateAndSync(
    request: LoginRequest,
    challenge: {
      readonly twoFactor?: { readonly provider: number; readonly token: string; readonly remember?: boolean };
      readonly newDeviceOtp?: string;
    },
    epoch: number,
  ): Promise<AuthSession> {
    const session = await this.loginService(request.serverUrl).login({
      email: request.email,
      masterPassword: request.masterPassword,
      ...challenge,
    });
    this.assertCurrentOperation(epoch);

    this.store.setLockedAccount(request.email, request.serverUrl);
    this.store.setActiveSession(session);
    this.store.setUnlocked(request.email);
    await this.sessionService().syncNow(
      () => this.isCurrentOperation(epoch),
      { persistRefreshedSession: false },
    );
    this.assertCurrentOperation(epoch);

    const latestSession = this.store.snapshot().activeSession ?? session;
    const syncError = this.store.snapshot().syncError;
    if (syncError) {
      throw new Error("Initial synchronization failed");
    }
    return latestSession;
  }

  private async commitAuthenticatedAccount(
    request: LoginRequest,
    session: AuthSession,
    epoch: number,
  ): Promise<void> {
    if (!this.accountStore) {
      return;
    }

    const commit = this.trackAccountMutation(() => this.accountStore!.saveAccount(
      {
        email: request.email,
        serverUrl: request.serverUrl,
        session,
      },
      () => this.isCurrentOperation(epoch),
    ));

    try {
      const savedAccount = await commit;
      if (this.isCurrentOperation(epoch)) {
        this.setRuntimeAccountId(savedAccount.id);
        persistActiveAccountHint(savedAccount);
        this.accountPersistedSubject.next();
      }
    } catch (error) {
      if (error instanceof AccountSessionMutationCancelledError) {
        throw new AccountOperationCancelledError();
      }
      throw new AccountRegistrationError();
    }
  }

  private handleAuthTimeout(epoch: number, baseline: PopupState): void {
    if (!this.isCurrentOperation(epoch)) {
      return;
    }
    this.operationEpoch += 1;
    this.store.restore(baseline);
    this.clearPendingChallenge();
    this.authBaseline = null;
    this.store.setLoginError(loginTimeoutMessage());
    this.store.setLoggingIn(false);
  }

  private finishAuthentication(): void {
    this.authBaseline = null;
    this.clearPendingChallenge();
    this.vaultTimeout?.start();
  }

  private setRuntimeAccountId(accountId: string | null): void {
    if (this.runtimeAccountId !== null && this.runtimeAccountId !== accountId) {
      this.routeCache?.clear();
    }
    this.runtimeAccountId = accountId;
    this.vaultTimeout?.useAccount(accountId);
  }

  /**
   * A stored PIN never makes a fresh process unlockable by itself. It becomes
   * available only after the current process has completed a master-password
   * authentication (including a completed challenge flow).
   */
  private async activatePersistedPinAfterMasterPassword(): Promise<void> {
    const accountId = this.runtimeAccountId;
    if (!accountId) return;
    try {
      await this.unlockMethods?.activatePersistedPin?.(accountId);
    } catch {
      // PIN is optional. A keychain failure must not turn a successful master
      // password login into a failed login; it simply leaves PIN unavailable.
    }
  }

  /** A pop-out may attach only to an already master-authenticated process. */
  private async activatePersistedPinForAttachedProcess(accountId: string): Promise<void> {
    try {
      await this.unlockMethods?.activatePersistedPin?.(accountId);
    } catch {
      // The primary process is already authenticated. Keep the attached
      // surface usable if optional PIN material cannot be read from Keychain.
    }
  }

  private activateLockedAccount(account: StoredAccount): void {
    this.vaultTimeout?.stop();
    this.store.setLockedAccount(account.email, account.serverUrl);
    if (account.isActive) {
      persistActiveAccountHint(account);
    }
  }

  private async persistCurrentAccountLock(): Promise<void> {
    if (!this.accountStore) {
      return;
    }

    const account = (await this.boundedRead(this.accountStore.list(), "List accounts"))
      .find((candidate) => candidate.isActive);
    if (account) {
      await this.accountStore.setStatus(account.id, "locked");
    }
  }

  private async activeAccount(id: string, epoch: number): Promise<StoredAccount> {
    this.assertCurrentOperation(epoch);
    const accounts = await this.boundedRead(this.requireAccountStore().list(), "List accounts");
    this.assertCurrentOperation(epoch);
    const account = accounts.find((candidate) => candidate.id === id && candidate.isActive) ?? null;
    if (!account) {
      throw new Error("Selected account is no longer active");
    }
    return account;
  }

  private clearSwitchedSession(session: AuthSession, account: StoredAccount): void {
    if (this.store.snapshot().activeSession === session) {
      this.prepareRuntimeLock(session);
      this.activateLockedAccount(account);
    }
  }

  private beginAuthOperation(baseline: PopupState): number {
    this.operationEpoch += 1;
    this.authBaseline = baseline;
    this.clearPendingChallenge();
    return this.operationEpoch;
  }

  private beginChallengeOperation(baseline: PopupState): number {
    this.operationEpoch += 1;
    this.authBaseline = baseline;
    return this.operationEpoch;
  }

  private beginLifecycleOperation(): number {
    this.operationEpoch += 1;
    if (this.authBaseline) {
      this.store.restore(this.authBaseline);
      this.authBaseline = null;
    }
    this.clearPendingChallenge();
    return this.operationEpoch;
  }

  private clearPendingChallenge(): void {
    if (this.pendingChallengeTimeout) {
      clearTimeout(this.pendingChallengeTimeout);
      this.pendingChallengeTimeout = null;
    }
    this.pendingLoginRequest = null;
    this.pendingLoginState = null;
    this.pendingLoginChallenge = {};
    this.pendingNewDeviceOtpResend = null;
    this.pendingChallengeExpiresAt = null;
    this.store.clearAuthChallenge();
  }

  private retainPendingChallenge(
    request: LoginRequest,
    baseline: PopupState,
    response: LoginChallengeResponse,
    challenge: NonNullable<PopupState["authChallenge"]>,
    error = "",
    expiresAt: number | null = null,
  ): void {
    if (this.pendingChallengeTimeout) {
      clearTimeout(this.pendingChallengeTimeout);
    }
    this.pendingLoginRequest = request;
    this.pendingLoginState = baseline;
    this.pendingLoginChallenge = response;
    this.authBaseline = baseline;
    this.pendingChallengeExpiresAt = expiresAt ?? Date.now() + this.challengeTimeoutMs;
    this.pendingChallengeTimeout = setTimeout(
      () => this.expirePendingChallenge(),
      Math.max(0, this.pendingChallengeExpiresAt - Date.now()),
    );
    if (error) {
      this.store.setAuthChallengeError(challenge, error);
    } else {
      this.store.setAuthChallenge(challenge);
    }
  }

  private expirePendingChallenge(): void {
    if (!this.pendingLoginRequest) {
      return;
    }

    const baseline = this.pendingLoginState ?? this.authBaseline;
    this.operationEpoch += 1;
    this.clearPendingChallenge();
    this.authBaseline = null;
    if (baseline) {
      this.store.restore(baseline);
    }
    this.store.setLoginError(translateOfficialMessage("i18nLoginExpired"));
  }

  private challengeDeadlineExpired(expiresAt: number | null): boolean {
    return expiresAt !== null && Date.now() >= expiresAt;
  }

  private handleExpiredChallengeAttempt(epoch: number, baseline: PopupState): void {
    if (!this.isCurrentOperation(epoch)) {
      return;
    }
    this.operationEpoch += 1;
    this.store.restore(baseline);
    this.clearPendingChallenge();
    this.authBaseline = null;
    this.store.setLoginError(translateOfficialMessage("i18nLoginExpired"));
  }

  private assertCurrentOperation(epoch: number): void {
    if (!this.isCurrentOperation(epoch)) {
      throw new AccountOperationCancelledError();
    }
  }

  private isCurrentOperation(epoch: number): boolean {
    return epoch === this.operationEpoch;
  }

  private trackAccountMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.accountMutationBarrier.then(mutation);
    this.accountMutationBarrier = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private boundedRead<T>(promise: Promise<T>, action: string): Promise<T> {
    return withTimeout(
      promise,
      this.lifecycleTimeoutMs,
      `${action} timed out`,
    );
  }

  private boundedStartupRead<T>(promise: Promise<T>, action: string): Promise<T> {
    return withTimeout(
      promise,
      Math.min(this.lifecycleTimeoutMs, DEFAULT_STARTUP_RESTORE_TIMEOUT_MS),
      new AuthStartupError("timeout"),
    );
  }

  private syncWithTimeout(epoch: number, accountId: string): Promise<VaultSyncOutcome> {
    return withTimeoutHandler(
      this.sessionService().syncNowOutcome(
        () => this.isCurrentOperation(epoch),
        {
          accountId,
          beforeLock: (session) => this.prepareRuntimeLock(session),
        },
      ),
      this.lifecycleTimeoutMs,
      () => {
        if (this.isCurrentOperation(epoch)) {
          this.prepareRuntimeLock();
          this.operationEpoch += 1;
          this.timedOutOperationEpoch = epoch;
          this.store.setLocked();
        }
      },
      new AuthStartupError("timeout"),
    );
  }

  private surfaceLifecycleError(action: string, _error: unknown): void {
    const message = `${action}.`;
    this.store.setSyncError(message);
    this.store.setStatus(message);
  }

  private surfaceStartupRestoreError(): void {
    this.store.setSyncError(STARTUP_RESTORE_ERROR_MESSAGE);
  }

  private requireAccountStore(): AccountSessionPort {
    if (!this.accountStore) {
      throw new Error("Account store unavailable");
    }

    return this.accountStore;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  failure: string | Error,
): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(
      () => reject(typeof failure === "string" ? new Error(failure) : failure),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  });
}

function persistActiveAccountHint(account: StoredAccount): void {
  try {
    globalThis.localStorage?.setItem(
      ACTIVE_ACCOUNT_HINT_KEY,
      JSON.stringify({
        id: account.id,
        email: account.email,
        serverUrl: account.serverUrl,
      }),
    );
  } catch {
    // The secure account index remains authoritative when local persistence is unavailable.
  }
}

function readActiveAccountHint(): StoredAccount | null {
  try {
    const raw = globalThis.localStorage?.getItem(ACTIVE_ACCOUNT_HINT_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate["id"] !== "string" ||
      typeof candidate["email"] !== "string" ||
      typeof candidate["serverUrl"] !== "string" ||
      !candidate["id"].trim() ||
      !candidate["email"].trim() ||
      !candidate["serverUrl"].startsWith("https://")
    ) {
      return null;
    }
    return {
      id: candidate["id"],
      email: candidate["email"],
      serverUrl: candidate["serverUrl"],
      status: "locked",
      isActive: true,
    };
  } catch {
    return null;
  }
}

function clearActiveAccountHint(): void {
  try {
    globalThis.localStorage?.removeItem(ACTIVE_ACCOUNT_HINT_KEY);
  } catch {
    // A stale non-secret hint is ignored if the authoritative account index is unavailable.
  }
}

function authStartupFailureCode(error: unknown): AuthStartupFailureCode {
  if (error instanceof AuthStartupError) {
    return error.code;
  }
  if (error instanceof SecureStorageError) {
    return error.code === "invalid-key"
      ? "local-data-corrupt"
      : "secure-storage";
  }
  if (error instanceof ProcessSessionBrokerError) {
    return error.code === "invalid-payload"
      ? "local-data-corrupt"
      : "broker-unavailable";
  }
  if (error instanceof HttpTransportError) {
    return "transport";
  }
  return "unexpected";
}

function withTimeoutHandler<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  timeoutError: Error = new AuthTimeoutHandledError(),
): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      onTimeout();
      reject(timeoutError);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  });
}

export function loginErrorMessage(error: unknown): string {
  const details = parseErrorDetails(error);
  if (hasUnsupportedOnlyTwoFactorProviders(details)) {
    return unsupportedAuthenticationMessage();
  }

  if (error instanceof AccountRegistrationError) {
    return translateOfficialMessage("i18nSaveAccountFailed");
  }

  if (error instanceof BitwardenApiError) {
    if (isInvalidCredentialResponse(error.responseJson)) {
      return translateOfficialMessage("i18nInvalidMasterPassword");
    }

    if (error.status === 429) {
      return translateOfficialMessage("i18nLoginRateLimited");
    }

    if (error.status >= 500) {
      return translateOfficialMessage("i18nLoginServerUnavailable");
    }

    if (error.status >= 400) {
      return translateOfficialMessage("i18nLoginRejected");
    }
  }

  const message = (error instanceof Error ? error.message : String(error)).toLocaleLowerCase();
  if (message.includes("invalid_grant")) {
    return translateOfficialMessage("i18nInvalidMasterPassword");
  }

  if (message === "initial synchronization failed") {
    return translateOfficialMessage("i18nLoginSyncFailed");
  }

  if (isTransportError(error, message)) {
    return translateOfficialMessage("i18nUnableToLoginServer");
  }

  return translateOfficialMessage("i18nUnableToLogin");
}

class AccountRegistrationError extends Error {}
class AuthTimeoutHandledError extends Error {}

function isRecoverableChallengeFailure(error: unknown): boolean {
  if (error instanceof AccountRegistrationError) {
    return false;
  }

  const details = parseErrorDetails(error);
  if (hasUnsupportedOnlyTwoFactorProviders(details)) {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error);
  return message !== "Initial synchronization failed";
}

function sanitizedErrorMessage(error: unknown): string {
  if (!(error instanceof Error) && typeof error !== "string") {
    return "Operation failed";
  }

  return String(error instanceof Error ? error.message : error)
    .replace(/https?:\/\/\S+/gi, "[server]")
    .replace(/\beyJ[A-Za-z0-9._-]*/g, "[redacted]")
    .replace(/\b(secret|password)\b/gi, "[redacted]")
    .slice(0, 200);
}

function authUnlockFailureCode(error: unknown): AuthUnlockFailureCode {
  if (error instanceof AccountRegistrationError) {
    return "storage-unavailable";
  }
  if (error instanceof BitwardenApiError) {
    if (isInvalidCredentialResponse(error.responseJson)) {
      return "invalid-credentials";
    }
    return error.status === 429 || error.status >= 500
      ? "connection-unavailable"
      : "unexpected";
  }
  const message = (error instanceof Error ? error.message : String(error)).toLocaleLowerCase();
  if (message.includes("invalid_grant")) {
    return "invalid-credentials";
  }
  return isTransportError(error, message) ? "connection-unavailable" : "unexpected";
}

function isTransportError(error: unknown, normalizedMessage?: string): boolean {
  const message = normalizedMessage ??
    (error instanceof Error ? error.message : String(error)).toLocaleLowerCase();
  return error instanceof TypeError ||
    /\b(network|fetch|dns|tls|certificate|timed?\s*out|timeout|offline|unreachable)\b/.test(message) ||
    message.includes("connection refused") ||
    message.includes("connection reset");
}

function authChallengeFromError(error: unknown, request: LoginRequest) {
  const details = parseErrorDetails(error);
  const providers = twoFactorProviders(details);
  if (providers.length > 0) {
    return {
      type: "twoFactor" as const,
      email: request.email,
      serverUrl: request.serverUrl,
      providers,
      message: "Two-factor authentication required",
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLocaleLowerCase();
  const modelMessage = String(details?.ErrorModel?.Message ?? "").toLocaleLowerCase();
  if (normalizedMessage.includes("new device verification required") || modelMessage === "new device verification required") {
    return {
      type: "newDevice" as const,
      email: request.email,
      serverUrl: request.serverUrl,
      message: "New device verification required",
    };
  }

  return null;
}

function isInvalidCredentialResponse(details: unknown): boolean {
  if (!details || typeof details !== "object") {
    return false;
  }

  const response = details as {
    readonly ErrorModel?: { readonly Message?: unknown };
    readonly error?: unknown;
    readonly error_description?: unknown;
    readonly message?: unknown;
  };
  const message = [
    response.ErrorModel?.Message,
    response.error,
    response.error_description,
    response.message,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();

  return message.includes("invalid_grant") ||
    message.includes("username or password is incorrect") ||
    message.includes("invalid username or password");
}

function parseErrorDetails(error: unknown): any {
  if (typeof error === "object" && error !== null && "responseJson" in error) {
    return (error as { responseJson?: unknown }).responseJson;
  }

  if (!(error instanceof Error)) {
    return null;
  }

  try {
    return JSON.parse(error.message);
  } catch {
    return null;
  }
}

function twoFactorProviders(details: any): string[] {
  return allTwoFactorProviders(details).filter((provider) =>
    SUPPORTED_TWO_FACTOR_PROVIDERS.includes(provider as typeof SUPPORTED_TWO_FACTOR_PROVIDERS[number]),
  );
}

function allTwoFactorProviders(details: any): string[] {
  const providers = details?.TwoFactorProviders2;
  return providers && typeof providers === "object" ? Object.keys(providers) : [];
}

function hasUnsupportedOnlyTwoFactorProviders(details: any): boolean {
  const providers = allTwoFactorProviders(details);
  return providers.length > 0 && twoFactorProviders(details).length === 0;
}
