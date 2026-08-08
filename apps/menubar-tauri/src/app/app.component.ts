import {
  Component,
  HostListener,
  Inject,
  InjectionToken,
  Optional,
  type AfterViewInit,
  type OnInit,
  OnDestroy,
  signal,
} from "@angular/core";
import { Router, RouterOutlet } from "@angular/router";
import { Subscription } from "rxjs";

import { PopupFocusWrapDirective } from "@bitwarden/browser-popup/components/popup-focus-wrap.directive";
import { I18nPipe } from "@bitwarden/ui-common";

import {
  AuthFacade,
  AuthStartupError,
  type AuthStartupFailureCode,
  type AuthStartupResult,
} from "./auth/auth.facade";
import {
  AUTH_EVIDENCE_STATE,
  type AuthEvidenceState,
} from "./auth/auth-evidence-state";
import { VaultTimeoutService } from "./auth/vault-timeout.service";
import { PopupStateStore, type PopupState } from "./popup-state";
import { PopupRouterCacheService } from "./platform/popup-router-cache.service";
import { SEND_EVIDENCE_STATE, type SendEvidenceState } from "./send/send-evidence-state";
import {
  SETTINGS_EVIDENCE_STATE,
  type SettingsEvidenceState,
} from "./settings/settings-evidence-state";
import { SettingsService } from "./settings/settings.service";
import { createDefaultHostService } from "../host/default-host.service";
import { AppBottomSheetDialogHostComponent } from "./official-ui/app-bottom-sheet-dialog.service";
import { AppFeedbackComponent } from "./official-ui/app-feedback.component";
import { AccessibilityPermissionDialogComponent } from "./official-ui/accessibility-permission-dialog.component";
import {
  VAULT_MAIN_EVIDENCE_STATE,
  type VaultMainEvidenceState,
} from "./vault/vault-main-evidence-state";
import { resolveWindowLayoutMode } from "../window-layout-mode";
import { normalizeRetainedPopoutRoute } from "./upstream-overlays/pop-out/retained-popout-route";
import {
  PROCESS_SESSION_BROKER,
  type ProcessSessionBrokerPort,
} from "./auth/process-session-broker.service";
import {
  ProcessSessionBrokerError,
  SecureStorageError,
  type ProcessSessionSnapshot,
} from "../host/host-api";
import { HttpTransportError } from "../bitwarden-api/bitwarden-api";
import { AppOverlayStackService } from "./official-ui/app-overlay-stack.service";
import { AppStatusFeedbackBridgeService } from "./official-ui/app-status-feedback-bridge.service";
import { encodeProcessSharedPopupState } from "./auth/process-shared-popup-state";
import { MacosAlertStripComponent } from "./official-ui/macos-alert-strip.component";
import { LocalCopyFeedbackService } from "./official-ui/local-copy-feedback.service";
import { PopupWindowSizeService } from "./window-size/popup-window-size.service";
import { translateOfficialMessage } from "./official-ui/official-i18n.service";
import { LocaleRouteRefreshService } from "./platform/locale-route-refresh.service";
import { VaultFacade } from "./vault/vault.facade";

const startupNavigationErrorMessage = () =>
  translateOfficialMessage("i18nStartupNavigationFailed");

const STARTUP_DESTINATION: Record<AuthStartupResult, string> = {
  login: "/login",
  locked: "/lock",
  unlocked: "/tabs/vault",
};

interface PopupLifecycleHost {
  hidePopup(): Promise<void>;
}

type StartupRecoveryAction = "retry" | "unlock" | "login";

export interface StartupFailurePresentation {
  readonly code: AuthStartupFailureCode;
  readonly title: string;
  readonly message: string;
  readonly actionLabel: string;
  readonly action: StartupRecoveryAction;
}

export const POPUP_LIFECYCLE_HOST = new InjectionToken<PopupLifecycleHost>(
  "POPUP_LIFECYCLE_HOST",
  {
    providedIn: "root",
    factory: createDefaultHostService,
  },
);

@Component({
  selector: "barwarden-root",
  standalone: true,
  imports: [
    AppBottomSheetDialogHostComponent,
    AppFeedbackComponent,
    AccessibilityPermissionDialogComponent,
    MacosAlertStripComponent,
    I18nPipe,
    RouterOutlet,
    PopupFocusWrapDirective,
  ],
  hostDirectives: [PopupFocusWrapDirective],
  template: `
    <div
      #popupSizeSource
      class="popup-window-size-source"
      [class.popup-window-size-source--render-recovery]="popupRenderRecoveryActive()"
    >
      <router-outlet />
      @if (startupPending()) {
        <div
          class="app-bootstrap-loading app-bootstrap-loading--runtime"
          role="status"
          aria-live="polite"
        >
          <div>
            <strong>Barwarden</strong>
            <span>{{ "i18nStarting" | i18n }}</span>
            <progress [attr.aria-label]="'i18nRecoveringSession' | i18n"></progress>
          </div>
        </div>
      }
    </div>
    @if (startupFailure(); as failure) {
      <bw-macos-alert-strip
        class="app-startup-alert"
        kind="danger"
        presentation="toast"
        [title]="failure.title"
        [message]="failure.message"
        [actionLabel]="failure.actionLabel"
        actionTestId="startup-recovery-action"
        testId="startup-failure-alert"
        (action)="recoverStartupFailure(failure.action)"
      />
    }
    <bw-app-bottom-sheet-dialog-host />
    <bw-accessibility-permission-dialog />
    <bw-app-feedback [hasMainSwitcher]="hasMainSwitcher" />
  `,
})
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  private startupRestored = false;
  private evidenceMode = false;
  private readonly evidenceState: AuthEvidenceState | null;
  private readonly vaultMainEvidenceState: VaultMainEvidenceState | null;
  private readonly sendEvidenceState: SendEvidenceState | null;
  private readonly settingsPreviewState: SettingsEvidenceState | null;
  private readonly routeSubscription: Subscription;
  private readonly startupFailureSubscription: Subscription;
  private readonly lockRouteSubscription: Subscription;
  private processSubscription = Subscription.EMPTY;
  private projectionSubscription = Subscription.EMPTY;
  private processGeneration: string | null = null;
  private processVersion = -1;
  private processReconciliation = Promise.resolve();
  private projectionPublication = Promise.resolve();
  private projectionPublishScheduled = false;
  private projectionRetryTimer: number | undefined;
  private applyingProcessSnapshot = false;
  private lastProcessProjection: string | null = null;
  private lastProcessProjectionState: PopupState | null = null;
  protected readonly startupPending = signal(true);
  protected readonly startupFailure = signal<StartupFailurePresentation | null>(null);
  protected readonly popupRenderRecoveryActive = signal(false);
  hasMainSwitcher = false;
  private popupRenderRecoveryFrame: number | undefined;

  constructor(
    private readonly auth: AuthFacade,
    private readonly router: Router,
    private readonly vaultTimeout: VaultTimeoutService,
    private readonly store: PopupStateStore,
    @Inject(AUTH_EVIDENCE_STATE) evidenceState: AuthEvidenceState | null = null,
    @Optional()
    @Inject(VAULT_MAIN_EVIDENCE_STATE)
    vaultMainEvidenceState: VaultMainEvidenceState | null = null,
    @Optional()
    @Inject(SEND_EVIDENCE_STATE)
    sendEvidenceState: SendEvidenceState | null = null,
    @Optional()
    @Inject(SETTINGS_EVIDENCE_STATE)
    settingsPreviewState: SettingsEvidenceState | null = null,
    @Optional() private readonly settings: SettingsService | null = null,
    @Optional() private readonly routeCache: PopupRouterCacheService | null = null,
    @Inject(POPUP_LIFECYCLE_HOST)
    private readonly popupLifecycleHost: PopupLifecycleHost = createDefaultHostService(),
    @Optional()
    @Inject(PROCESS_SESSION_BROKER)
    private readonly processSessionBroker: ProcessSessionBrokerPort | null = null,
    @Optional()
    private readonly overlayStack: AppOverlayStackService = new AppOverlayStackService(),
    @Optional()
    private readonly statusFeedbackBridge: AppStatusFeedbackBridgeService | null = null,
    @Optional()
    private readonly localCopyFeedback: LocalCopyFeedbackService | null = null,
    @Optional()
    private readonly popupWindowSize: PopupWindowSizeService | null = null,
    @Optional()
    private readonly localeRouteRefresh: LocaleRouteRefreshService | null = null,
    @Optional()
    private readonly vault: VaultFacade | null = null,
  ) {
    // The root owns the singleton so every live route is refreshed when the
    // user changes language, including secondary Settings routes.
    void this.localeRouteRefresh;
    this.evidenceState = evidenceState;
    this.vaultMainEvidenceState = vaultMainEvidenceState;
    this.sendEvidenceState = sendEvidenceState;
    this.settingsPreviewState = settingsPreviewState;
    this.hasMainSwitcher = routeHasMainSwitcher(this.router.url);
    this.routeSubscription = this.router.events?.subscribe(() => {
      this.hasMainSwitcher = routeHasMainSwitcher(this.router.url);
      const activeTab = mainTabFromUrl(this.router.url);
      if (activeTab) {
        this.store.setActiveTab(activeTab);
      }
    }) ?? Subscription.EMPTY;
    this.startupFailureSubscription = this.store.state$.subscribe((state) => {
      if (
        this.startupFailure()
        && (
          state.isUnlocked
          || state.isLoggingIn
          || isLoggedOutStatus(state.statusMessage)
        )
      ) {
        this.startupFailure.set(null);
      }
    });
    let wasUnlocked = this.store.snapshot().isUnlocked;
    this.lockRouteSubscription = this.store.state$.subscribe((state) => {
      const shouldNavigateToUnlock =
        wasUnlocked &&
        !state.isUnlocked &&
        !state.isLoggingIn &&
        !this.evidenceMode &&
        this.router.url !== "/lock";
      wasUnlocked = state.isUnlocked;
      if (shouldNavigateToUnlock) {
        void this.router.navigateByUrl("/lock", { replaceUrl: true });
      }
    });
  }

  ngOnDestroy(): void {
    if (this.popupRenderRecoveryFrame !== undefined) {
      globalThis.cancelAnimationFrame?.(this.popupRenderRecoveryFrame);
    }
    this.routeSubscription.unsubscribe();
    this.startupFailureSubscription.unsubscribe();
    this.lockRouteSubscription.unsubscribe();
    this.processSubscription.unsubscribe();
    this.projectionSubscription.unsubscribe();
    if (this.projectionRetryTimer !== undefined) {
      window.clearTimeout(this.projectionRetryTimer);
      this.projectionRetryTimer = undefined;
    }
    this.processSessionBroker?.destroy();
    this.statusFeedbackBridge?.destroy();
    this.localCopyFeedback?.destroy();
    this.popupWindowSize?.destroy();
  }

  ngAfterViewInit(): void {
    if (resolveWindowLayoutMode(globalThis.location?.search ?? "") === "popout") return;
    void this.popupWindowSize?.start();
  }

  async ngOnInit(): Promise<void> {
    this.statusFeedbackBridge?.start();
    this.localCopyFeedback?.start();
    try {
      if (this.evidenceState) {
        this.evidenceMode = true;
        const { applyAuthEvidenceState } = await import("./auth/auth-evidence-preview");
        const evidenceRoute = applyAuthEvidenceState(this.store, this.evidenceState);
        await this.router.navigateByUrl(evidenceRoute, { replaceUrl: true });
        return;
      }

      if (
        import.meta.env.VITE_BW_VAULT_EVIDENCE === "true" &&
        this.vaultMainEvidenceState
      ) {
        this.evidenceMode = true;
        const { applyVaultMainEvidenceState, vaultMainEvidenceRoute } = await import(
          "./vault/vault-main-evidence-preview"
        );
        applyVaultMainEvidenceState(this.store, this.vaultMainEvidenceState);
        await this.router.navigateByUrl(vaultMainEvidenceRoute(this.vaultMainEvidenceState), {
          replaceUrl: true,
        });
        return;
      }

      if (this.sendEvidenceState) {
        this.evidenceMode = true;
        const { applySendEvidenceState, sendEvidenceRoute } = await import("./send/send-evidence-preview");
        applySendEvidenceState(this.store, this.sendEvidenceState);
        await this.router.navigateByUrl(sendEvidenceRoute(this.sendEvidenceState), { replaceUrl: true });
        return;
      }

      if (this.settingsPreviewState && this.settings) {
        this.evidenceMode = true;
        const { applySettingsEvidenceState } = await import(
          "./settings/settings-evidence-preview"
        );
        const route = applySettingsEvidenceState(
          this.store,
          this.settings,
          this.settingsPreviewState,
        );
        if (!route) throw new Error("Settings evidence provider is unavailable");
        await this.router.navigateByUrl(route, { replaceUrl: true });
        return;
      }

      try {
        let result: AuthStartupResult;
        const windowLayout =
          resolveWindowLayoutMode(globalThis.location?.search ?? "");
        let attachedProcessSnapshot: ProcessSessionSnapshot | null = null;
        try {
          if (this.processSessionBroker) {
            const attachment = await this.processSessionBroker.attach();
            attachedProcessSnapshot = attachment.snapshot;
            if (attachment.startupMode === "cold") {
              result = await this.auth.restoreStartup("cold");
              const published = await this.auth.publishProcessStartupState(result);
              attachedProcessSnapshot = published ?? attachedProcessSnapshot;
            } else {
              result = await this.auth.attachProcessSession(attachment.snapshot);
              if (
                windowLayout === "popout" &&
                result === "login" &&
                attachment.snapshot.authorization === "signed-out"
              ) {
                result = await this.auth.restoreStartup("additional-window");
                const published = await this.auth.publishProcessStartupState(result);
                attachedProcessSnapshot = published ?? attachedProcessSnapshot;
              }
            }
          } else {
            const legacyStartupMode =
              windowLayout === "popout" ? "additional-window" : "cold";
            result = await this.auth.restoreStartup(legacyStartupMode);
          }
        } catch (error) {
          await this.handleStartupRestoreFailure(error);
          return;
        }
        if (attachedProcessSnapshot) {
          this.startProcessReconciliation(attachedProcessSnapshot);
        }

        try {
          if (result === "unlocked") {
            if (windowLayout === "popout") {
              await this.router.navigateByUrl(
                normalizeRetainedPopoutRoute(globalThis.location?.hash.replace(/^#/, "") ?? ""),
                { replaceUrl: true },
              );
              return;
            }
            if (await this.routeCache?.restore()) {
              return;
            }
          }
          await this.router.navigateByUrl(STARTUP_DESTINATION[result], { replaceUrl: true });
        } catch {
          this.store.setLoginError(startupNavigationErrorMessage());
          await this.navigateToLogin();
        }
      } finally {
        this.startupRestored = true;
      }
    } finally {
      this.startupPending.set(false);
    }
  }

  private startProcessReconciliation(initial: ProcessSessionSnapshot): void {
    if (!this.processSessionBroker) {
      return;
    }
    this.processGeneration = initial.processGeneration;
    this.processVersion = initial.version;
    this.lastProcessProjection = serializedProjection(initial.sharedSnapshot);
    this.lastProcessProjectionState = this.store.snapshot();
    this.processSubscription.unsubscribe();
    this.processSubscription = this.processSessionBroker.changes$.subscribe(
      (snapshot) => {
        if (
          snapshot.processGeneration === this.processGeneration &&
          snapshot.version <= this.processVersion
        ) {
          return;
        }
        this.processGeneration = snapshot.processGeneration;
        this.processVersion = snapshot.version;
        this.processReconciliation = this.processReconciliation
          .then(() => this.reconcileProcessSnapshot(snapshot))
          .catch(() => undefined);
      },
    );
    this.projectionSubscription.unsubscribe();
    this.projectionSubscription = this.store.state$.subscribe(() => {
      this.scheduleProcessProjectionPublish();
    });
  }

  private async reconcileProcessSnapshot(
    snapshot: ProcessSessionSnapshot,
  ): Promise<void> {
    this.applyingProcessSnapshot = true;
    try {
      const previousActiveTab = this.store.snapshot().activeTab;
      const result = await this.auth.attachProcessSession(snapshot);
      this.lastProcessProjection = serializedProjection(snapshot.sharedSnapshot);
      this.lastProcessProjectionState = this.store.snapshot();
      if (result === "locked") {
        await this.router.navigateByUrl("/lock", { replaceUrl: true });
        return;
      }
      if (result === "login") {
        await this.router.navigateByUrl("/login", { replaceUrl: true });
        return;
      }
      const activeTab = this.store.snapshot().activeTab;
      const hasPeerTabNavigationIntent = activeTab !== previousActiveTab;
      if (/^\/tabs\//.test(this.router.url)) {
        const destination = `/tabs/${activeTab}`;
        if (mainTabFromUrl(this.router.url) !== activeTab) {
          await this.router.navigateByUrl(destination, { replaceUrl: true });
        }
      } else if (hasPeerTabNavigationIntent) {
        await this.router.navigateByUrl(`/tabs/${activeTab}`, { replaceUrl: true });
      }
    } finally {
      this.applyingProcessSnapshot = false;
    }
  }

  private scheduleProcessProjectionPublish(): void {
    if (this.projectionPublishScheduled) {
      return;
    }
    this.projectionPublishScheduled = true;
    queueMicrotask(() => {
      this.projectionPublishScheduled = false;
      if (this.applyingProcessSnapshot) {
        return;
      }
      const state = this.store.snapshot();
      if (!state.isUnlocked || !state.activeSession) {
        return;
      }
      if (
        this.lastProcessProjectionState &&
        processProjectionChangedOnlyByActiveTab(
          this.lastProcessProjectionState,
          state,
        )
      ) {
        this.lastProcessProjectionState = state;
        const activeTab = state.activeTab;
        this.projectionPublication = this.projectionPublication
          .then(async () => {
            const published = await this.auth.publishProcessActiveTab(activeTab);
            if (!published) {
              this.lastProcessProjectionState = null;
              this.scheduleProjectionRetry();
              return;
            }
            if (
              published.processGeneration !== this.processGeneration ||
              published.version > this.processVersion
            ) {
              this.processGeneration = published.processGeneration;
              this.processVersion = published.version;
            }
          })
          .catch(() => {
            this.lastProcessProjectionState = null;
            this.scheduleProjectionRetry();
          });
        return;
      }
      let projection: string;
      try {
        projection = JSON.stringify(encodeProcessSharedPopupState(state));
      } catch {
        return;
      }
      if (projection === this.lastProcessProjection) {
        this.lastProcessProjectionState = state;
        return;
      }
      this.lastProcessProjection = projection;
      this.lastProcessProjectionState = state;
      this.projectionPublication = this.projectionPublication
        .then(async () => {
          const published = await this.auth.publishProcessStateProjection();
          if (published === undefined) {
            // Deterministic invalid/oversized projections cannot heal by
            // polling. Keep the local window usable and wait for a new state.
            return;
          }
          if (!published) {
            if (this.lastProcessProjection === projection) {
              this.lastProcessProjection = null;
            }
            this.scheduleProjectionRetry();
            return;
          }
          if (this.projectionRetryTimer !== undefined) {
            window.clearTimeout(this.projectionRetryTimer);
            this.projectionRetryTimer = undefined;
          }
          if (
            (published.processGeneration !== this.processGeneration ||
              published.version > this.processVersion)
          ) {
            this.processGeneration = published.processGeneration;
            this.processVersion = published.version;
            this.lastProcessProjection = serializedProjection(
              published.sharedSnapshot,
            ) ?? projection;
          }
        })
        .catch(() => {
          if (this.lastProcessProjection === projection) {
            this.lastProcessProjection = null;
          }
          this.scheduleProjectionRetry();
        });
    });
  }

  private scheduleProjectionRetry(): void {
    if (this.projectionRetryTimer !== undefined) {
      return;
    }
    this.projectionRetryTimer = window.setTimeout(() => {
      this.projectionRetryTimer = undefined;
      this.scheduleProcessProjectionPublish();
    }, 100);
  }

  @HostListener("document:keydown")
  @HostListener("document:pointerdown")
  recordActivity(): void {
    if (!this.evidenceMode && this.startupRestored) {
      this.vaultTimeout.recordActivity();
    }
  }

  @HostListener("document:keydown.escape", ["$event"])
  hideOnEscape(event: KeyboardEvent): void {
    if (this.overlayStack.consumeEscape(event)) {
      return;
    }
    if (resolveWindowLayoutMode(globalThis.location?.search ?? "") === "popout") {
      return;
    }
    event.preventDefault();
    void this.popupLifecycleHost.hidePopup().catch(() => undefined);
  }

  /**
   * macOS suspends WebKit's layer tree while the menu-bar popup is hidden.
   * Recreating one composited frame after it is shown prevents the live
   * Angular view from being left behind a blank canvas after an autofill.
   */
  @HostListener("window:barwarden:popup-shown", ["$event"])
  restorePopupComposition(event: Event): void {
    if (this.popupRenderRecoveryFrame !== undefined) {
      globalThis.cancelAnimationFrame?.(this.popupRenderRecoveryFrame);
    }
    this.popupRenderRecoveryActive.set(true);
    this.popupRenderRecoveryFrame = globalThis.requestAnimationFrame(() => {
      this.popupRenderRecoveryFrame = globalThis.requestAnimationFrame(() => {
        this.popupRenderRecoveryActive.set(false);
        this.popupRenderRecoveryFrame = undefined;
      });
    });
    if ((event as CustomEvent<{ reset?: boolean }>).detail?.reset === true) {
      void this.resetPopupToInitialState();
    }
  }

  private async resetPopupToInitialState(): Promise<void> {
    if (
      this.evidenceMode
      || !this.store.snapshot().isUnlocked
      || resolveWindowLayoutMode(globalThis.location?.search ?? "") === "popout"
    ) {
      return;
    }
    this.routeCache?.clear();
    this.store.setActiveTab("vault");
    this.store.resetFilters();
    this.vault?.resetSearch();
    try {
      await this.router.navigateByUrl("/tabs/vault", { replaceUrl: true });
    } catch {
      return;
    }
    globalThis.requestAnimationFrame(() => {
      globalThis.document
        ?.querySelector<HTMLInputElement>('bw-root-search input[type="search"]')
        ?.focus();
    });
  }

  private async navigateToLogin(): Promise<void> {
    try {
      await this.router.navigateByUrl("/login", { replaceUrl: true });
    } catch {
      // Ignore rejected startup fallback navigation so bootstrap does not leak an unhandled promise.
    }
  }

  async recoverStartupFailure(action: StartupRecoveryAction): Promise<void> {
    this.startupFailure.set(null);
    this.store.setLoginError("");
    if (action === "login") {
      await this.navigateToLogin();
      return;
    }
    if (action === "unlock") {
      try {
        await this.router.navigateByUrl("/lock", { replaceUrl: true });
      } catch {
        this.store.setLoginError(startupNavigationErrorMessage());
      }
      return;
    }
    this.startupRestored = false;
    this.startupPending.set(true);
    await this.ngOnInit();
  }

  private async handleStartupRestoreFailure(error: unknown): Promise<void> {
    const accountKnown = Boolean(this.store.snapshot().email);
    const failure = startupFailurePresentation(error, accountKnown);
    this.startupFailure.set(failure);
    // The root Alert is the single startup failure live region. Routed auth
    // pages must not echo the same failure through their validation callout.
    this.statusFeedbackBridge?.suppress();
    this.store.setLoginError("");
    if (!accountKnown) {
      await this.navigateToLogin();
      return;
    }

    try {
      await this.router.navigateByUrl("/lock", { replaceUrl: true });
    } catch {
      // Keep the recovered account state intact even if the router cannot render the lock screen.
    }
  }
}

export function routeHasMainSwitcher(url: string): boolean {
  return /^\/tabs\/(vault|otp|generator|send|settings)(?:[?#]|$)/.test(url);
}

export function startupFailurePresentation(
  error: unknown,
  accountKnown: boolean,
): StartupFailurePresentation {
  const code = startupFailureCode(error);
  switch (code) {
    case "secure-storage":
      return {
        code,
        title: translateOfficialMessage("i18nKeychainUnavailableTitle"),
        message: translateOfficialMessage("i18nAllowKeychainAndRetry"),
        actionLabel: translateOfficialMessage("i18nRetry"),
        action: "retry",
      };
    case "session-missing":
      return {
        code,
        title: translateOfficialMessage("i18nSessionExpiredTitle"),
        message: translateOfficialMessage("i18nSessionExpiredMessage"),
        actionLabel: translateOfficialMessage(accountKnown ? "i18nReunlock" : "i18nRelogin"),
        action: accountKnown ? "unlock" : "login",
      };
    case "transport":
      return {
        code,
        title: translateOfficialMessage("i18nTransportTitle"),
        message: translateOfficialMessage("i18nTransportMessage"),
        actionLabel: translateOfficialMessage("i18nRetry"),
        action: "retry",
      };
    case "sync-failed":
    case "sync-invalid":
      return {
        code,
        title: translateOfficialMessage("i18nSyncIncompleteTitle"),
        message: translateOfficialMessage("i18nSyncIncompleteMessage"),
        actionLabel: translateOfficialMessage("i18nRetry"),
        action: "retry",
      };
    case "local-data-corrupt":
      return {
        code,
        title: translateOfficialMessage("i18nLocalAccountUnavailableTitle"),
        message: translateOfficialMessage("i18nLocalAccountUnavailableMessage"),
        actionLabel: translateOfficialMessage("i18nRelogin"),
        action: "login",
      };
    case "broker-unavailable":
      return {
        code,
        title: translateOfficialMessage("i18nBrokerUnavailableTitle"),
        message: translateOfficialMessage("i18nBrokerUnavailableMessage"),
        actionLabel: translateOfficialMessage("i18nRetry"),
        action: "retry",
      };
    case "timeout":
      return {
        code,
        title: translateOfficialMessage("i18nStartupTimeoutTitle"),
        message: translateOfficialMessage("i18nStartupTimeoutMessage"),
        actionLabel: translateOfficialMessage("i18nRetry"),
        action: "retry",
      };
    default:
      return {
        code,
        title: translateOfficialMessage("i18nBarwardenRestoreFailed"),
        message: accountKnown
          ? translateOfficialMessage("i18nAccountInfoRetained")
          : translateOfficialMessage("i18nRetryOrRelogin"),
        actionLabel: translateOfficialMessage(accountKnown ? "i18nReunlock" : "i18nRetry"),
        action: accountKnown ? "unlock" : "retry",
      };
  }
}

function startupFailureCode(error: unknown): AuthStartupFailureCode {
  if (error instanceof AuthStartupError) {
    return error.code;
  }
  if (error instanceof SecureStorageError) {
    return error.code === "invalid-key" ? "local-data-corrupt" : "secure-storage";
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

function mainTabFromUrl(url: string): ReturnType<PopupStateStore["snapshot"]>["activeTab"] | null {
  const match = /^\/tabs\/(vault|otp|generator|send|settings)(?:[?#]|$)/.exec(url);
  return (match?.[1] as ReturnType<PopupStateStore["snapshot"]>["activeTab"] | undefined) ?? null;
}

function serializedProjection(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function processProjectionChangedOnlyByActiveTab(
  previous: PopupState,
  next: PopupState,
): boolean {
  return (
    previous.activeTab !== next.activeTab &&
    previous.isUnlocked === next.isUnlocked &&
    previous.isSyncing === next.isSyncing &&
    previous.email === next.email &&
    previous.serverUrl === next.serverUrl &&
    previous.items === next.items &&
    previous.archivedItems === next.archivedItems &&
    previous.deletedItems === next.deletedItems &&
    previous.folders === next.folders &&
    previous.organizations === next.organizations &&
    previous.collections === next.collections &&
    previous.sends === next.sends &&
    previous.isSendDisabled === next.isSendDisabled &&
    previous.sendPolicy === next.sendPolicy &&
    previous.statusMessage === next.statusMessage &&
    previous.loginError === next.loginError &&
    previous.syncError === next.syncError &&
    previous.lastSyncDate === next.lastSyncDate &&
    previous.lastSuccessfulSyncDate === next.lastSuccessfulSyncDate &&
    previous.vaultSyncStatus === next.vaultSyncStatus &&
    previous.vaultSyncMessage === next.vaultSyncMessage &&
    previous.activeSession === next.activeSession &&
    previous.filterFolderId === next.filterFolderId &&
    previous.filterType === next.filterType &&
    previous.isFilterVisible === next.isFilterVisible &&
    previous.collapsedVaultSectionIds === next.collapsedVaultSectionIds &&
    previous.sendTypeFilter === next.sendTypeFilter &&
    previous.isSendFilterVisible === next.isSendFilterVisible
  );
}

function isLoggedOutStatus(statusMessage: string): boolean {
  // Process-shared popup state from an already-running window may still carry
  // the old invariant English message when the user changes locale locally.
  return (
    statusMessage === "Logged out" ||
    statusMessage === translateOfficialMessage("i18nLoggedOut")
  );
}
