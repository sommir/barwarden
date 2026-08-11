import { CommonModule } from "@angular/common";
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Inject,
  OnDestroy,
  OnInit,
  Optional,
  ViewChild,
} from "@angular/core";
import { Router } from "@angular/router";

import { PasteError } from "../../host/host-api";
import { formatMacShortcut, type GlobalShortcutHost } from "../../host/global-shortcut";
import { TauriHostService } from "../../host/tauri-host.service";
import { AuthFacade } from "../auth/auth.facade";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { I18nPipe } from "../official-ui/official-ui-common";
import { activeOfficialLocale, translateOfficialMessage } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { GLOBAL_SHORTCUT_SETTINGS_HOST } from "../settings/global-shortcut-settings.service";
import { VaultRepromptService } from "../vault/vault-reprompt.service";
import { AutoFillBindingsService } from "./autofill-bindings.service";
import {
  AutoFillCandidateService,
  type AutoFillCandidateGroup,
  type AutoFillSecretField,
  type RankedAutoFillCandidate,
} from "./autofill-candidate.service";
import { AutoFillContextSessionService } from "./autofill-context-session.service";
import {
  AutoFillContextChangedError,
  AutoFillContextualCandidatesService,
} from "./autofill-contextual-candidates.service";
import {
  AutoFillFillActionService,
  type AutoFillActionOutcome,
  type PreparedAutoFillAction,
} from "./autofill-fill-action.service";
import {
  decodeLiveAutoFillContext,
  type ContextualCandidate,
  type LiveAutoFillContext,
} from "./autofill-fill-context.model";
import {
  AUTOFILL_NATIVE_HOST,
  type AutoFillAgentSession,
  type AutoFillNativeHost,
  type AutoFillRepromptScope,
} from "./autofill-native.host";
import { AutoFillSetupService } from "./autofill-setup.service";

type PickerMode =
  | "loading"
  | "ready"
  | "locked"
  | "repair"
  | "empty"
  | "context-unavailable"
  | "account-override";
type PickerCandidate = ContextualCandidate | RankedAutoFillCandidate;
type ReadyDetectedAction = Extract<PreparedAutoFillAction, { readonly status: "ready" }>;

interface PendingDetectedAction {
  readonly kind: "detected";
  readonly candidate: ContextualCandidate;
  readonly prepared: ReadyDetectedAction;
  readonly requiresReprompt: boolean;
  readonly mismatchConfirmed: boolean;
}

interface PendingLegacyAction {
  readonly kind: "legacy";
  readonly candidate: RankedAutoFillCandidate;
  readonly scope: AutoFillRepromptScope;
  readonly mismatchConfirmed: boolean;
  readonly receipt?: string;
}

type PendingMismatch = PendingDetectedAction | Omit<PendingLegacyAction, "receipt">;
type PendingProtected = (PendingDetectedAction & { readonly receipt: string })
  | (PendingLegacyAction & { readonly receipt: string });

interface LegacyPickerOperation {
  readonly epoch: number;
  readonly candidateId: string;
  readonly accountId: string;
  readonly generation: string;
  readonly bundleId: string;
  readonly appName: string;
}

const GROUP_ORDER: readonly AutoFillCandidateGroup[] = ["exact", "relevant", "other"];
const FIELD_ORDER: readonly AutoFillSecretField[] = ["username", "password", "totp"];
const GROUP_LABELS: Readonly<Record<AutoFillCandidateGroup, string>> = {
  exact: "i18nAutofillExactMatches",
  relevant: "i18nAutofillRelevantAccounts",
  other: "i18nAutofillOtherAccounts",
};
const REASON_LABELS: Readonly<Record<string, string>> = {
  user_binding: "i18nAutofillReasonBinding",
  service_identifier: "i18nAutofillReasonService",
  app_preset: "i18nAutofillReasonPreset",
  vault_uri_rule: "i18nAutofillReasonUriRule",
  host_or_domain: "i18nAutofillReasonDomain",
  application_name: "i18nAutofillReasonApplicationName",
  application_name_similar: "i18nAutofillReasonApplicationNameSimilar",
  fuzzy_name: "i18nAutofillReasonSimilar",
  selection_history: "i18nAutofillReasonHistory",
  favorite: "i18nAutofillReasonFavorite",
  recent: "i18nAutofillReasonRecent",
  other: "i18nAutofillReasonOther",
};

@Component({
  selector: "bw-autofill-picker",
  standalone: true,
  imports: [CommonModule, I18nPipe, PopupHeaderComponent, PopupPageComponent],
  host: { class: "macos-page macos-page--secondary macos-page--autofill-picker" },
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./autofill-picker.component.css",
  template: `
    <popup-page class="macos-page macos-page--autofill-picker">
      <popup-header slot="header" [pageTitle]="'i18nAutofillPickerTitle' | i18n" showBackButton [backAction]="backAction" />
      <main class="autofill-picker">
        <div
          class="autofill-picker__content"
          [attr.inert]="dialogOpen ? '' : null"
          [attr.aria-hidden]="dialogOpen ? 'true' : null"
        >
          @if (appName) {
            <div class="autofill-picker__target" id="autofill-target-app">
              <span class="autofill-picker__target-icon" aria-hidden="true"><i class="bwi bwi-desktop"></i></span>
              <span class="autofill-picker__target-copy">
                <strong>{{ appName }}</strong>
                <small>{{ "i18nAutofillCurrentApp" | i18n }}</small>
              </span>
              @if (shortcutLabel) {
                <kbd data-testid="autofill-shortcut">{{ shortcutLabel }}</kbd>
              }
              @if (shortcutUnavailable) {
                <span
                  class="autofill-picker__shortcut-warning"
                  data-testid="autofill-shortcut-unavailable"
                  role="img"
                  [attr.aria-label]="'i18nAutofillShortcutUnavailable' | i18n"
                  [title]="'i18nAutofillShortcutUnavailable' | i18n"
                ><i class="bwi bwi-exclamation-triangle" aria-hidden="true"></i></span>
              }
              <button
                class="autofill-picker__turn-off"
                data-testid="autofill-close"
                type="button"
                [attr.aria-label]="'close' | i18n"
                [title]="'close' | i18n"
                (click)="backToVault()"
              ><i class="bwi bwi-close" aria-hidden="true"></i></button>
            </div>
          }

          <p
            class="tw-sr-only"
            data-testid="autofill-live-region"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >{{ liveRegionMessage }}</p>

          @if (mode === "locked") {
            <section class="autofill-picker__state" data-testid="autofill-locked">
              <span class="autofill-picker__state-icon" aria-hidden="true"><i class="bwi bwi-lock"></i></span>
              <h2>{{ "i18nAutofillVaultLocked" | i18n }}</h2>
              <p>{{ "i18nAutofillUnlockDescription" | i18n }}</p>
              <button class="autofill-picker__primary" type="button" (click)="unlock()">{{ "unlock" | i18n }}</button>
            </section>
          } @else if (mode === "repair") {
            <section class="autofill-picker__state" data-testid="autofill-repair">
              <span class="autofill-picker__state-icon" aria-hidden="true"><i class="bwi bwi-exclamation-triangle"></i></span>
              <h2>{{ "i18nAutofillNeedsAttention" | i18n }}</h2>
              @if (statusMessage) {
                <p>{{ statusMessage }}</p>
              } @else if (setupRequiresApproval) {
                <p>{{ "i18nAutofillApprovalDescription" | i18n }}</p>
              } @else if (setupRequiresAccessibility) {
                <p>{{ "i18nAutofillAccessibilityDescription" | i18n }}</p>
              } @else {
                <p>{{ "i18nAutofillRepairDescription" | i18n }}</p>
              }
              <div class="autofill-picker__state-actions">
                <button class="autofill-picker__primary" data-testid="autofill-retry" type="button" [disabled]="setupActionPending" (click)="retrySetup()">{{ "i18nRetry" | i18n }}</button>
                <button class="autofill-picker__secondary" data-testid="autofill-turn-off" type="button" [disabled]="setupActionPending" (click)="turnOffAutoFill()">{{ "i18nAutofillTurnOff" | i18n }}</button>
              </div>
            </section>
          } @else if (mode === "context-unavailable") {
            <section class="autofill-picker__state" data-testid="autofill-context-unavailable">
              <span class="autofill-picker__state-icon" aria-hidden="true"><i class="bwi bwi-desktop"></i></span>
              <h2>{{ "i18nAutofillTargetUnavailable" | i18n }}</h2>
              <p>{{ "i18nAutofillTargetUnavailableDescription" | i18n }}</p>
              <button class="autofill-picker__primary" data-testid="autofill-back-vault" type="button" (click)="backToVault()">{{ "i18nBackToVault" | i18n }}</button>
            </section>
          } @else if (mode === "account-override") {
            <section class="autofill-picker__state" data-testid="autofill-account-override">
              <span class="autofill-picker__state-icon" aria-hidden="true"><i class="bwi bwi-users"></i></span>
              <h2>{{ "i18nAutofillChooseAccount" | i18n }}</h2>
              <p>{{ "i18nAutofillAccountDescription" | i18n }}</p>
              <button class="autofill-picker__primary" type="button" (click)="useProjectedAccount()">{{ "i18nAutofillUseAccount" | i18n }}</button>
            </section>
          } @else if (mode === "loading") {
            <section class="autofill-picker__state autofill-picker__state--loading" data-testid="autofill-loading">
              <span class="autofill-picker__spinner" aria-hidden="true"></span>
              <p>{{ "i18nAutofillFindingAccounts" | i18n }}</p>
            </section>
          } @else {
            <label class="autofill-picker__search">
              <i class="bwi bwi-search" aria-hidden="true"></i>
              <span class="tw-sr-only">{{ "i18nAutofillSearchAccounts" | i18n }}</span>
              <input
                type="search"
                [placeholder]="'i18nAutofillSearchAccounts' | i18n"
                [value]="query"
                (input)="search(inputValue($event))"
                (keydown.enter)="$event.preventDefault()"
              />
            </label>

            @if (mode === "empty") {
              <section class="autofill-picker__state" data-testid="autofill-empty">
                <span class="autofill-picker__state-icon" aria-hidden="true"><i class="bwi bwi-search"></i></span>
                <h2>{{ "i18nAutofillNoMatches" | i18n }}</h2>
                <p>{{ "i18nAutofillNoMatchesDescription" | i18n }}</p>
              </section>
            } @else {
              <div
                class="autofill-picker__groups"
                role="listbox"
                tabindex="0"
                [attr.aria-label]="'i18nAutofillAccountsForApp' | i18n: appName"
                [attr.aria-activedescendant]="highlightedCandidate ? optionId(highlightedCandidate) : null"
                (keydown)="onListKeydown($event)"
              >
                @for (group of groupOrder; track group) {
                  @if (candidatesFor(group).length) {
                    <section [attr.data-testid]="'autofill-group-' + group">
                      <h2>{{ groupLabel(group) }}</h2>
                      <div class="autofill-picker__group-list">
                        @for (candidate of candidatesFor(group); track candidate.cipherId) {
                          <div
                            class="autofill-picker__candidate-row"
                            [class.autofill-picker__candidate-row--highlighted]="highlightedCandidate?.cipherId === candidate.cipherId"
                            [class.autofill-picker__candidate-row--selected]="selected?.cipherId === candidate.cipherId"
                            (mouseenter)="highlightCandidate(candidate)"
                            (focusin)="highlightCandidate(candidate)"
                          >
                            <button
                              class="autofill-picker__candidate"
                              type="button"
                              role="option"
                              tabindex="-1"
                              [id]="optionId(candidate)"
                              [attr.data-testid]="'autofill-candidate-body-' + candidate.cipherId"
                              [attr.aria-selected]="selected?.cipherId === candidate.cipherId"
                              [attr.aria-label]="detailLabel(candidate)"
                              (click)="openCandidateDetails(candidate)"
                            >
                              <span class="autofill-picker__candidate-icon" aria-hidden="true"><i class="bwi bwi-globe"></i></span>
                              <span class="autofill-picker__candidate-copy">
                                <strong>{{ candidate.displayName }}</strong>
                                <small>{{ candidate.username }} · {{ reasonLabel(candidate.reason) }}</small>
                              </span>
                            </button>
                            <div class="autofill-picker__candidate-actions">
                              <span
                                class="autofill-picker__capabilities"
                                role="img"
                                [attr.data-testid]="'autofill-capabilities-' + candidate.cipherId"
                                [attr.aria-label]="capabilityLabel(candidate)"
                              >
                                @for (field of candidateCapabilityFields(candidate); track field) {
                                  <i
                                    class="bwi"
                                    [class.bwi-user]="field === 'username'"
                                    [class.bwi-lock]="field === 'password'"
                                    [class.bwi-clock]="field === 'totp'"
                                    [attr.data-autofill-capability]="field"
                                    aria-hidden="true"
                                  ></i>
                                }
                              </span>
                              @if (showsPrimaryAction(candidate)) {
                                <button
                                  class="autofill-picker__primary-action"
                                  type="button"
                                  [attr.data-testid]="'autofill-primary-action-' + candidate.cipherId"
                                  [attr.aria-label]="primaryActionLabel"
                                  [title]="primaryActionLabel"
                                  (click)="performPrimaryAction(candidate)"
                                >
                                  <span>{{ primaryActionLabel }}</span>
                                </button>
                              }
                              @if (showsFieldActions(candidate)) {
                                @for (field of actionableFields(candidate); track field) {
                                  <button
                                    class="autofill-picker__field-action"
                                    type="button"
                                    [attr.data-testid]="'autofill-field-action-' + candidate.cipherId + '-' + field"
                                    [attr.aria-label]="fieldActionLabel(field)"
                                    [title]="fieldActionLabel(field)"
                                    (click)="performFieldAction(candidate, field)"
                                  ><i class="bwi" [class.bwi-user]="field === 'username'" [class.bwi-lock]="field === 'password'" [class.bwi-clock]="field === 'totp'" aria-hidden="true"></i></button>
                                }
                              }
                            </div>
                          </div>
                        }
                      </div>
                    </section>
                  }
                }
              </div>
            }
          }

          @if (statusMessage && mode !== "repair") {
            <p class="autofill-picker__status">{{ statusMessage }}</p>
          }
        </div>

        @if (pendingMismatch) {
          <div class="autofill-picker__modal-backdrop">
            <section
              #activeDialog
              class="autofill-picker__modal"
              data-testid="autofill-mismatch-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="autofill-mismatch-title"
              tabindex="-1"
              (keydown)="onDialogKeydown($event)"
            >
              <p id="autofill-mismatch-title">{{ "i18nAutofillMismatchDescription" | i18n }}</p>
              <div class="autofill-picker__modal-actions">
                <button data-autofill-dialog-primary type="button" (click)="confirmMismatch()">{{ "i18nAutofillFillAnyway" | i18n }}</button>
                <button data-autofill-dialog-cancel type="button" (click)="cancelMismatch()">{{ "cancel" | i18n }}</button>
              </div>
            </section>
          </div>
        }

        @if (pendingProtected) {
          <div class="autofill-picker__modal-backdrop">
            <section
              #activeDialog
              class="autofill-picker__modal"
              data-testid="autofill-verify-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="autofill-verify-title"
              tabindex="-1"
              (keydown)="onDialogKeydown($event)"
            >
              <p id="autofill-verify-title">{{ "i18nAutofillVerifyDescription" | i18n }}</p>
              <button data-autofill-dialog-primary data-testid="autofill-use-touch-id" type="button" (click)="verifyWithTouchId()">{{ "i18nUseTouchId" | i18n }}</button>
              <button type="button" (click)="showMasterPasswordReprompt()">{{ "i18nUseMasterPassword" | i18n }}</button>
              @if (masterPasswordMode) {
                <form (submit)="verifyWithMasterPassword($event)">
                  <label>{{ "masterPass" | i18n }} <input type="password" autocomplete="current-password" [value]="masterPassword" (input)="masterPassword = inputValue($event)" /></label>
                  <button type="submit">{{ "i18nVerify" | i18n }}</button>
                </form>
              }
              <button data-autofill-dialog-cancel type="button" (click)="cancelProtectedAction()">{{ "cancel" | i18n }}</button>
            </section>
          </div>
        }
      </main>
    </popup-page>
  `,
})
export class AutoFillPickerComponent implements OnInit, OnDestroy {
  @ViewChild("activeDialog")
  set activeDialog(element: ElementRef<HTMLElement> | undefined) {
    if (!element) return;
    queueMicrotask(() => {
      if (!this.componentAlive || !this.dialogOpen || !element.nativeElement.isConnected) return;
      element.nativeElement.querySelector<HTMLElement>("[data-autofill-dialog-primary]")?.focus();
    });
  }

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () => {
    this.cancelPicker();
    return this.router.navigateByUrl("/tabs/vault");
  };
  readonly groupOrder = GROUP_ORDER;
  mode: PickerMode = "loading";
  appName = "";
  query = "";
  candidates: readonly PickerCandidate[] = [];
  selected: PickerCandidate | null = null;
  highlightedIndex = 0;
  statusMessage = "";
  shortcutLabel = "";
  shortcutUnavailable = false;
  setupRequiresApproval = false;
  setupRequiresAccessibility = false;
  setupActionPending = false;
  pendingMismatch: PendingMismatch | null = null;
  pendingProtected: PendingProtected | null = null;
  masterPasswordMode = false;
  masterPassword = "";

  private bundleId = "";
  private detectedContext: LiveAutoFillContext | null = null;
  private agentSession: AutoFillAgentSession | null = null;
  private legacyContextToken = "";
  private activeDetectedAction: ReadyDetectedAction | null = null;
  private operationEpoch = 0;
  private initializeTimer: number | undefined;
  private componentAlive = true;
  private activeLegacyReceipt: { readonly scope: AutoFillRepromptScope; readonly receipt: string } | null = null;
  private dialogReturnFocus: HTMLElement | null = null;
  private readonly shortcutHost: GlobalShortcutHost;

  constructor(
    private readonly store: PopupStateStore,
    private readonly candidatesService: AutoFillCandidateService,
    private readonly contextualCandidates: AutoFillContextualCandidatesService,
    private readonly fillActions: AutoFillFillActionService,
    private readonly contextSession: AutoFillContextSessionService,
    private readonly bindings: AutoFillBindingsService,
    @Inject(AUTOFILL_NATIVE_HOST) private readonly native: AutoFillNativeHost,
    private readonly auth: AuthFacade,
    private readonly router: Router,
    private readonly reprompt: VaultRepromptService,
    private readonly changeDetector: ChangeDetectorRef,
    @Optional() private readonly setup: AutoFillSetupService | null = null,
    @Optional() @Inject(GLOBAL_SHORTCUT_SETTINGS_HOST) shortcutHost: GlobalShortcutHost | null = null,
  ) {
    this.shortcutHost = shortcutHost ?? new TauriHostService();
    if (!this.store.snapshot().isUnlocked) this.mode = "locked";
  }

  ngOnInit(): void {
    this.initializeTimer = window.setTimeout(() => {
      this.initializeTimer = undefined;
      void this.initialize();
    }, 0);
  }

  ngOnDestroy(): void {
    if (this.initializeTimer !== undefined) window.clearTimeout(this.initializeTimer);
    this.initializeTimer = undefined;
    this.componentAlive = false;
    this.operationEpoch += 1;
    this.cancelActiveDetectedAction();
    this.cancelActiveLegacyReceipt();
    this.contextSession.cancel();
    this.store.cancelProtectedOperations();
    this.masterPassword = "";
  }

  async initialize(): Promise<void> {
    const epoch = this.startOperation();
    this.clearPickerState();
    const state = this.store.snapshot();
    if (!state.isUnlocked) {
      this.contextSession.lock();
      this.mode = "locked";
      this.markIfAlive();
      return;
    }
    const setupState = this.setup?.blockReason();
    if (setupState === "requiresApproval" || setupState === "requiresAccessibility" || setupState === "unavailable") {
      this.setupRequiresApproval = setupState === "requiresApproval";
      this.setupRequiresAccessibility = setupState === "requiresAccessibility";
      this.mode = "repair";
      this.markIfAlive();
      return;
    }
    this.mode = "loading";
    try {
      const entry = await this.native.entryContext();
      if (!this.commit(epoch, () => {})) return;
      if (entry.status !== "available") {
        this.contextSession.targetMismatch();
        this.commit(epoch, () => { this.mode = "context-unavailable"; });
        return;
      }
      const entryRecord = entry.context as unknown as Record<string, unknown>;
      const bundleId = typeof entryRecord?.["bundleId"] === "string" ? entryRecord["bundleId"] : "";
      const appName = typeof entryRecord?.["appName"] === "string" ? entryRecord["appName"] : "";
      if (!bundleId || !appName) throw new Error("invalid target");
      let detectedContext: LiveAutoFillContext | null = null;
      try { detectedContext = decodeLiveAutoFillContext(entry.context); } catch {}
      if (!this.commit(epoch, () => {
        this.bundleId = bundleId;
        this.appName = appName;
        this.detectedContext = detectedContext;
      })) return;
      const shortcut = await this.shortcutHost.getGlobalShortcut().catch(() => null);
      if (!this.commit(epoch, () => {
        this.shortcutLabel = shortcut?.shortcut ? formatMacShortcut(shortcut.shortcut) : "";
        this.shortcutUnavailable = shortcut?.availability === "unavailable";
      })) return;
      const session = await this.native.agentSession();
      if (!this.commit(epoch, () => {})) return;
      if (session.status !== "success") {
        this.commit(epoch, () => { this.mode = "repair"; });
        return;
      }
      if (!this.commit(epoch, () => {
        this.agentSession = Object.freeze({
          accountId: session.accountId,
          generation: session.generation,
          vaultRevision: session.vaultRevision,
        });
      })) return;
      const owner = this.store.snapshot().vaultOwnerAccountId;
      if (!owner) {
        this.commit(epoch, () => { this.mode = "repair"; });
        return;
      }
      if (owner !== session.accountId) {
        this.contextSession.accountSwitched(session.accountId);
        this.commit(epoch, () => { this.mode = "account-override"; });
        return;
      }
      await this.refreshCandidates(epoch);
    } catch {
      this.commit(epoch, () => { this.mode = "repair"; });
    }
  }

  async retrySetup(): Promise<void> {
    if (!this.setup || this.setupActionPending) return;
    this.setupActionPending = true;
    this.statusMessage = translateOfficialMessage("i18nAutofillChecking");
    this.markIfAlive();
    try {
      const setupState = await this.setup.enableFromEntry();
      if (!this.componentAlive) return;
      if (setupState !== "ready") {
        this.setupRequiresApproval = setupState === "requiresApproval";
        this.setupRequiresAccessibility = setupState === "requiresAccessibility";
        this.mode = "repair";
        this.statusMessage = translateOfficialMessage("i18nAutofillStillNeedsAttention");
        return;
      }
      this.setupRequiresApproval = false;
      this.setupRequiresAccessibility = false;
      this.setupActionPending = false;
      await this.initialize();
    } catch {
      if (!this.componentAlive) return;
      this.setupRequiresApproval = false;
      this.setupRequiresAccessibility = false;
      this.mode = "repair";
      this.statusMessage = translateOfficialMessage("i18nAutofillRecoveryFailed");
    } finally {
      this.setupActionPending = false;
      this.markIfAlive();
    }
  }

  async turnOffAutoFill(): Promise<void> {
    if (!this.setup || this.setupActionPending) return;
    this.startOperation();
    this.contextSession.cancel();
    this.store.cancelProtectedOperations();
    this.clearPickerState();
    this.setupActionPending = true;
    this.mode = "repair";
    this.setupRequiresApproval = false;
    this.setupRequiresAccessibility = false;
    this.statusMessage = translateOfficialMessage("i18nAutofillTurningOff");
    this.markIfAlive();
    try {
      await this.setup.disable();
      if (this.componentAlive) this.statusMessage = translateOfficialMessage("i18nAutofillIsOff");
    } catch {
      if (this.componentAlive) this.statusMessage = translateOfficialMessage("i18nAutofillTurnOffFailed");
    } finally {
      this.setupActionPending = false;
      this.markIfAlive();
    }
  }

  async search(value: string): Promise<void> {
    const epoch = this.startOperation();
    this.contextSession.clear();
    this.query = value;
    this.selected = null;
    this.statusMessage = "";
    this.markIfAlive();
    await this.refreshCandidates(epoch).catch((error) => {
      if (error instanceof AutoFillContextChangedError) {
        this.contextSession.targetMismatch();
        this.commit(epoch, () => {
          this.statusMessage = translateOfficialMessage("i18nAutofillTargetChanged");
        });
      } else {
        this.commit(epoch, () => { this.mode = "repair"; });
      }
    });
  }

  candidatesFor(group: AutoFillCandidateGroup): readonly PickerCandidate[] {
    return this.candidates.filter((candidate) => candidate.group === group);
  }

  groupLabel(group: AutoFillCandidateGroup): string {
    return translateOfficialMessage(GROUP_LABELS[group]);
  }

  reasonLabel(reason: string): string {
    return translateOfficialMessage(REASON_LABELS[reason] ?? REASON_LABELS["other"]);
  }

  fieldLabel(field: AutoFillSecretField): string {
    return translateOfficialMessage({
      username: "i18nAutofillFieldUsername",
      password: "i18nAutofillFieldPassword",
      totp: "i18nAutofillFieldTotp",
    }[field]);
  }

  fieldActionLabel(field: AutoFillSecretField): string {
    return translateOfficialMessage("i18nAutofillFillField", this.fieldLabel(field));
  }

  get contextLabel(): string {
    const context = this.detectedContext;
    if (!context) return this.fieldLabel("password");
    if (context.action.mode === "choose") return translateOfficialMessage("i18nAutofillChooseDetectedField");
    return context.action.fields.map((field) => this.fieldLabel(field)).join(" + ");
  }

  get primaryActionLabel(): string {
    return translateOfficialMessage("i18nAutofillFill");
  }

  get liveRegionMessage(): string {
    if (this.statusMessage) return this.statusMessage;
    if ((this.mode === "ready" || this.mode === "empty") && this.detectedContext) {
      return translateOfficialMessage("i18nAutofillDetectedContext", this.contextLabel);
    }
    return "";
  }

  isDetectedCandidate(candidate: PickerCandidate): candidate is ContextualCandidate {
    return "authorizations" in candidate && "availableFields" in candidate;
  }

  candidateCapabilityFields(candidate: PickerCandidate): readonly AutoFillSecretField[] {
    if (!this.isDetectedCandidate(candidate)) return ["password"];
    return Object.freeze(FIELD_ORDER.filter((field) => (
      candidate.availableFields.includes(field) && candidate.authorizations.has(field)
    )));
  }

  actionableFields(candidate: PickerCandidate): readonly AutoFillSecretField[] {
    const contextFields = this.detectedContext?.action.fields ?? [];
    const capabilityFields = this.candidateCapabilityFields(candidate);
    return Object.freeze(contextFields.filter((field) => (
      capabilityFields.includes(field)
    )));
  }

  capabilityLabel(candidate: PickerCandidate): string {
    const separator = activeOfficialLocale() === "zh-CN" ? "、" : ", ";
    return translateOfficialMessage(
      "i18nAutofillAvailableFields",
      this.candidateCapabilityFields(candidate).map((field) => this.fieldLabel(field)).join(separator),
    );
  }

  showsPrimaryAction(candidate: PickerCandidate): boolean {
    if (!this.detectedContext) return true;
    if (!this.isDetectedCandidate(candidate) || this.detectedContext.action.mode === "choose") return false;
    const actionableFields = this.actionableFields(candidate);
    return this.detectedContext.action.fields.every((field) => actionableFields.includes(field));
  }

  showsFieldActions(candidate: PickerCandidate): boolean {
    if (!this.detectedContext || !this.isDetectedCandidate(candidate)) return false;
    return this.detectedContext.action.mode === "choose";
  }

  detailLabel(candidate: PickerCandidate): string {
    return translateOfficialMessage("i18nAutofillViewDetails", candidate.displayName);
  }

  highlightCandidate(candidate: PickerCandidate): void {
    const index = this.candidates.findIndex((item) => item.cipherId === candidate.cipherId);
    if (index < 0 || index === this.highlightedIndex) return;
    this.highlightedIndex = index;
    this.markIfAlive();
  }

  selectIndex(index: number): void {
    if (!this.candidates.length) return;
    this.highlightedIndex = Math.max(0, Math.min(index, this.candidates.length - 1));
    this.selectCandidate(this.candidates[this.highlightedIndex]);
  }

  selectCandidate(candidate: PickerCandidate): void {
    this.startOperation();
    if (this.isDetectedCandidate(candidate)) this.contextSession.select(candidate.cipherId);
    this.selected = candidate;
    this.statusMessage = "";
    this.markIfAlive();
  }

  openCandidateDetails(candidate: PickerCandidate): void {
    this.selectCandidate(candidate);
    if (this.isDetectedCandidate(candidate) && !this.contextSession.select(candidate.cipherId)) {
      this.statusMessage = translateOfficialMessage("i18nAutofillActionUnavailable");
      this.markIfAlive();
      return;
    }
    this.contextSession.navigationChanged(`/view-cipher/${candidate.cipherId}`);
    void this.router.navigateByUrl(`/view-cipher/${encodeURIComponent(candidate.cipherId)}`);
  }

  performPrimaryAction(candidate: PickerCandidate): void {
    if (this.isDetectedCandidate(candidate) && this.detectedContext) {
      void this.performDetectedAction(candidate);
    } else {
      void this.performLegacyAction(candidate as RankedAutoFillCandidate);
    }
  }

  performFieldAction(candidate: PickerCandidate, field: AutoFillSecretField): void {
    if (!this.isDetectedCandidate(candidate) || !this.detectedContext
        || !this.actionableFields(candidate).includes(field)) return;
    void this.performDetectedAction(candidate, field);
  }

  get highlightedCandidate(): PickerCandidate | null {
    return this.candidates[this.highlightedIndex] ?? null;
  }

  get dialogOpen(): boolean {
    return Boolean(this.pendingMismatch || this.pendingProtected);
  }

  onDialogKeydown(event: KeyboardEvent): void {
    const dialog = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (!dialog) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (this.pendingMismatch) this.cancelMismatch();
      else this.cancelProtectedAction();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hasAttribute("hidden"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  optionId(candidate: PickerCandidate): string {
    return `autofill-option-${candidate.cipherId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  }

  onListKeydown(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (!this.candidates.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.highlightedIndex = (this.highlightedIndex + 1) % this.candidates.length;
      this.markIfAlive();
      this.scrollHighlightedIntoView();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.highlightedIndex = (this.highlightedIndex - 1 + this.candidates.length) % this.candidates.length;
      this.markIfAlive();
      this.scrollHighlightedIntoView();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const candidate = this.highlightedCandidate;
      if (candidate) this.selectCandidate(candidate);
    }
  }

  async confirmMismatch(): Promise<void> {
    const pending = this.pendingMismatch;
    if (!pending) return;
    this.pendingMismatch = null;
    this.markIfAlive();
    if (pending.kind === "detected") {
      await this.continueDetectedAction({ ...pending, mismatchConfirmed: true });
    } else {
      await this.continueLegacyAction(pending.candidate, pending.scope, true);
    }
  }

  cancelMismatch(): void {
    const pending = this.pendingMismatch;
    this.pendingMismatch = null;
    if (pending?.kind === "detected") {
      void this.fillActions.cancel(pending.prepared);
      if (this.activeDetectedAction === pending.prepared) this.activeDetectedAction = null;
    }
    this.operationEpoch += 1;
    this.restoreDialogFocus();
    this.markIfAlive();
  }

  cancelProtectedAction(): void {
    const pending = this.pendingProtected;
    this.pendingProtected = null;
    if (pending?.kind === "detected") {
      void this.fillActions.cancel(pending.prepared);
      if (this.activeDetectedAction === pending.prepared) this.activeDetectedAction = null;
    } else if (pending) {
      this.abandonLegacyReceipt(pending.receipt);
    }
    this.operationEpoch += 1;
    this.masterPasswordMode = false;
    this.masterPassword = "";
    this.store.cancelProtectedOperations();
    this.restoreDialogFocus();
    this.markIfAlive();
  }

  async verifyWithTouchId(): Promise<void> {
    const pending = this.pendingProtected;
    if (!pending) return;
    const actionEpoch = this.operationEpoch;
    this.pendingProtected = null;
    this.markIfAlive();
    const accountId = pending.kind === "detected"
      ? pending.prepared.session.accountId
      : pending.scope.accountId;
    const outcome = await this.native.biometricReprompt(accountId, pending.receipt)
      .catch(() => "failed" as const);
    if (!this.actionUiIsCurrent(actionEpoch)) {
      await this.cancelPendingAction(pending);
      return;
    }
    if (outcome !== "success") {
      await this.cancelPendingAction(pending);
      this.statusMessage = translateOfficialMessage(outcome === "cancelled"
        ? "i18nAutofillTouchIdCancelled"
        : "i18nAutofillTouchIdFailed");
      this.restoreDialogFocus();
      this.markIfAlive();
      return;
    }
    if (pending.kind === "detected") {
      await this.continueDetectedAction(pending, true);
    } else {
      await this.releaseAndDeliverLegacy(
        this.legacyOperation(actionEpoch, pending.candidate),
        pending.scope,
        pending.mismatchConfirmed,
        pending.receipt,
      );
    }
  }

  showMasterPasswordReprompt(): void {
    if (!this.pendingProtected) return;
    this.masterPassword = "";
    this.masterPasswordMode = true;
    this.markIfAlive();
  }

  async verifyWithMasterPassword(event: Event): Promise<void> {
    event.preventDefault();
    const pending = this.pendingProtected;
    if (!pending || !this.masterPasswordMode || !this.masterPassword) return;
    const actionEpoch = this.operationEpoch;
    const password = this.masterPassword;
    this.masterPassword = "";
    this.markIfAlive();
    const protectedEpoch = this.store.beginProtectedOperation();
    let verified = false;
    try {
      verified = await this.reprompt.verify(password, protectedEpoch, pending.receipt);
    } catch {
      this.statusMessage = translateOfficialMessage("i18nAutofillMasterPasswordFailed");
    }
    if (!verified || !this.store.isCurrentProtectedOperation(protectedEpoch) || !this.actionUiIsCurrent(actionEpoch)) {
      await this.cancelPendingAction(pending);
      this.pendingProtected = null;
      this.masterPasswordMode = false;
      this.restoreDialogFocus();
      this.markIfAlive();
      return;
    }
    this.pendingProtected = null;
    this.masterPasswordMode = false;
    this.markIfAlive();
    if (pending.kind === "detected") {
      await this.continueDetectedAction(pending, true);
    } else {
      await this.releaseAndDeliverLegacy(
        this.legacyOperation(actionEpoch, pending.candidate),
        pending.scope,
        pending.mismatchConfirmed,
        pending.receipt,
      );
    }
  }

  async useProjectedAccount(): Promise<void> {
    const session = this.agentSession;
    if (!session) return;
    const epoch = this.startOperation();
    this.contextSession.accountSwitched(session.accountId);
    this.mode = "loading";
    this.markIfAlive();
    try {
      await this.auth.switchAccount(session.accountId);
      if (!this.commit(epoch, () => {})) return;
      await this.initialize();
    } catch {
      this.commit(epoch, () => {
        this.mode = "account-override";
        this.statusMessage = translateOfficialMessage("i18nAutofillSwitchAccountFailed");
      });
    }
  }

  unlock(): void {
    void this.router.navigateByUrl("/lock", { replaceUrl: true });
  }

  backToVault(): void {
    this.cancelPicker();
    void this.router.navigateByUrl("/tabs/vault", { replaceUrl: true });
  }

  inputValue(event: Event): string {
    return event.target instanceof HTMLInputElement ? event.target.value : "";
  }

  private async performDetectedAction(candidate: ContextualCandidate, field?: AutoFillSecretField): Promise<void> {
    const context = this.detectedContext;
    const session = this.agentSession;
    if (!context || !session || this.mode === "repair") return;
    const epoch = this.startOperation();
    if (!this.contextSession.select(candidate.cipherId)) {
      this.commit(epoch, () => { this.statusMessage = translateOfficialMessage("i18nAutofillActionUnavailable"); });
      return;
    }
    this.selected = candidate;
    this.statusMessage = "";
    this.captureDialogReturnFocus();
    const localLogin = this.localLogin(candidate.cipherId, session.accountId);
    if (!localLogin) {
      this.commit(epoch, () => { this.statusMessage = translateOfficialMessage("i18nAutofillActionUnavailable"); });
      this.restoreDialogFocus();
      return;
    }
    const prepared = this.fillActions.prepare(context, session, candidate, field ? [field] : undefined);
    if (prepared.status !== "ready") {
      this.commit(epoch, () => { this.statusMessage = translateOfficialMessage("i18nAutofillFieldUnavailable"); });
      this.restoreDialogFocus();
      return;
    }
    this.activeDetectedAction = prepared;
    await this.continueDetectedAction({
      kind: "detected",
      candidate,
      prepared,
      requiresReprompt: localLogin.reprompt,
      mismatchConfirmed: false,
    });
  }

  private async continueDetectedAction(
    action: PendingDetectedAction,
    repromptVerified = false,
  ): Promise<void> {
    const epoch = this.operationEpoch;
    const outcome = await this.fillActions.execute(action.prepared, {
      mismatchConfirmed: action.mismatchConfirmed,
      requiresReprompt: action.requiresReprompt,
      ...(repromptVerified ? { repromptVerified: true } : {}),
    });
    if (!this.actionUiIsCurrent(epoch) || this.activeDetectedAction !== action.prepared) return;
    if (outcome.status === "confirmation-required") {
      this.pendingMismatch = action;
      this.markIfAlive();
      return;
    }
    if (outcome.status === "reprompt-required") {
      this.pendingProtected = { ...action, receipt: outcome.receipt };
      this.markIfAlive();
      return;
    }
    this.activeDetectedAction = null;
    this.pendingMismatch = null;
    this.pendingProtected = null;
    this.masterPasswordMode = false;
    this.applyDetectedOutcome(action.candidate, action.prepared.session, outcome);
    this.restoreDialogFocus();
    this.markIfAlive();
  }

  private applyDetectedOutcome(
    candidate: ContextualCandidate,
    session: AutoFillAgentSession,
    outcome: AutoFillActionOutcome,
  ): void {
    if (outcome.status === "success") {
      this.statusMessage = translateOfficialMessage("i18nAutofillFilled");
      this.bindSuccessfulSelection(candidate.cipherId, session.accountId);
      return;
    }
    if (outcome.status === "partial") {
      const filled = outcome.filled.map((field) => this.fieldLabel(field)).join("、");
      this.statusMessage = translateOfficialMessage(
        "i18nAutofillPartial",
        filled || translateOfficialMessage("i18nAutofillNoFields"),
        this.fieldLabel(outcome.failed),
      );
      return;
    }
    if ((outcome.status === "error" && outcome.code === "stale-context")
        || (outcome.status === "unavailable" && outcome.reason === "stale-context")) {
      this.contextSession.targetMismatch();
      this.statusMessage = translateOfficialMessage("i18nAutofillTargetChanged");
      return;
    }
    if (outcome.status === "unavailable" && outcome.reason === "action-in-progress") return;
    this.statusMessage = translateOfficialMessage("i18nAutofillActionUnavailable");
  }

  private async performLegacyAction(candidate: RankedAutoFillCandidate, mismatchConfirmed = false): Promise<void> {
    const session = this.agentSession;
    if (!session || this.detectedContext || this.mode === "repair" || !this.legacyContextToken) return;
    const epoch = this.startOperation();
    this.selected = candidate;
    this.statusMessage = "";
    const scope: AutoFillRepromptScope = {
      accountId: session.accountId,
      candidateId: candidate.cipherId,
      field: "password",
      generation: session.generation,
      contextToken: this.legacyContextToken,
    };
    const pending: Omit<PendingLegacyAction, "receipt"> = {
      kind: "legacy", candidate, scope, mismatchConfirmed,
    };
    if (candidate.requiresMismatchConfirmation && !mismatchConfirmed) {
      this.captureDialogReturnFocus();
      this.pendingMismatch = pending;
      this.markIfAlive();
      return;
    }
    await this.continueLegacyAction(candidate, scope, mismatchConfirmed, epoch);
  }

  private async continueLegacyAction(
    candidate: RankedAutoFillCandidate,
    scope: AutoFillRepromptScope,
    mismatchConfirmed: boolean,
    epoch = this.operationEpoch,
  ): Promise<void> {
    const operation = this.legacyOperation(epoch, candidate);
    if (!await this.legacyTargetIsCurrent(operation)) return;
    const localLogin = this.localLogin(candidate.cipherId, scope.accountId);
    if (!localLogin) {
      this.commitLegacy(operation, () => { this.statusMessage = translateOfficialMessage("i18nAutofillActionUnavailable"); });
      return;
    }
    if (localLogin.reprompt) {
      const receipt = await this.native.beginReprompt(scope).catch(() => ({ status: "unavailable" as const }));
      if (!this.legacyOperationIsCurrent(operation)) {
        if (receipt.status === "pending") void this.native.cancelReprompt(scope, receipt.receipt).catch(() => undefined);
        return;
      }
      if (receipt.status !== "pending") {
        this.commitLegacy(operation, () => { this.statusMessage = translateOfficialMessage("i18nAutofillActionUnavailable"); });
        return;
      }
      this.activeLegacyReceipt = { scope, receipt: receipt.receipt };
      this.captureDialogReturnFocus();
      this.pendingProtected = { kind: "legacy", candidate, scope, mismatchConfirmed, receipt: receipt.receipt };
      this.markIfAlive();
      return;
    }
    await this.releaseAndDeliverLegacy(operation, scope, mismatchConfirmed);
  }

  private async refreshCandidates(epoch: number): Promise<void> {
    const session = this.agentSession;
    if (!session || !this.sessionIsCurrent(epoch, session)) throw new Error("Agent unavailable");
    if (this.detectedContext) {
      const context = this.detectedContext;
      const candidates = await this.contextualCandidates.queryAll(context, session, this.query);
      if (!this.sessionIsCurrent(epoch, session)) return;
      this.commit(epoch, () => {
        this.contextSession.begin(context, session, candidates);
        this.candidates = candidates;
        this.highlightedIndex = 0;
        this.mode = candidates.length ? "ready" : "empty";
      });
      return;
    }
    const response = await this.candidatesService.query({
      accountId: session.accountId,
      lockGeneration: session.generation,
      field: "password",
      context: {
        bundleId: this.bundleId,
        appName: this.appName,
        serviceIdentifiers: [],
        query: this.query,
      },
    });
    if (!this.sessionIsCurrent(epoch, session)) return;
    const entry = await this.native.entryContext().catch(() => ({ status: "unavailable" as const }));
    if (!this.sessionIsCurrent(epoch, session) || entry.status !== "available"
        || entry.context.bundleId !== this.bundleId || entry.context.appName !== this.appName) return;
    this.commit(epoch, () => {
      this.legacyContextToken = response.contextToken;
      this.candidates = response.candidates;
      this.highlightedIndex = 0;
      this.mode = response.candidates.length ? "ready" : "empty";
    });
  }

  private async releaseAndDeliverLegacy(
    operation: LegacyPickerOperation,
    scope: AutoFillRepromptScope,
    mismatchConfirmed: boolean,
    repromptReceipt?: string,
  ): Promise<void> {
    let value = "";
    try {
      if (!await this.legacyTargetIsCurrent(operation)) return;
      const released = await this.native.releaseSecret({
        scope,
        mismatchConfirmed,
        ...(repromptReceipt ? { repromptReceipt } : {}),
      });
      if (!this.legacyOperationIsCurrent(operation)) return;
      if (released.status !== "success" || released.field !== scope.field) {
        this.commitLegacy(operation, () => { this.statusMessage = translateOfficialMessage("i18nAutofillReleaseFailed"); });
        return;
      }
      value = released.value;
      if (!await this.legacyTargetIsCurrent(operation)) return;
      try {
        await this.native.pasteText(value, 30);
        const delivered = this.commitLegacy(operation, () => {
          this.statusMessage = translateOfficialMessage("i18nAutofillFilled");
        });
        if (delivered) this.bindSuccessfulSelection(operation.candidateId, operation.accountId);
      } catch (error) {
        this.commitLegacy(operation, () => {
          this.statusMessage = translateOfficialMessage(error instanceof PasteError && error.valueCopied
            ? "i18nAutofillPasteFallback"
            : "i18nAutofillPasteFailed");
        });
      }
    } finally {
      value = "";
      if (repromptReceipt && this.activeLegacyReceipt?.receipt === repromptReceipt) this.cancelActiveLegacyReceipt();
      this.restoreDialogFocus();
    }
  }

  private bindSuccessfulSelection(cipherId: string, accountId: string): void {
    this.bindings.bind(accountId, this.bundleId, cipherId);
    this.bindings.recordSuccessfulSelection({
      accountId,
      bundleId: this.bundleId,
      serviceIdentifiers: [],
      cipherId,
      selectedAt: new Date().toISOString(),
      explicitUserAction: true,
      succeeded: true,
    });
  }

  private localLogin(cipherId: string, accountId: string) {
    const state = this.store.snapshot();
    return state.vaultOwnerAccountId === accountId
      ? state.items.find((item) => item.type === "login" && item.id === cipherId)
      : undefined;
  }

  private scrollHighlightedIntoView(): void {
    const id = this.highlightedCandidate ? this.optionId(this.highlightedCandidate) : null;
    if (!id) return;
    queueMicrotask(() => document.getElementById(id)?.scrollIntoView?.({ block: "nearest" }));
  }

  private clearPickerState(): void {
    this.contextSession.clear();
    this.candidates = [];
    this.selected = null;
    this.pendingMismatch = null;
    this.pendingProtected = null;
    this.masterPasswordMode = false;
    this.masterPassword = "";
    this.statusMessage = "";
    this.appName = "";
    this.bundleId = "";
    this.detectedContext = null;
    this.legacyContextToken = "";
    this.shortcutLabel = "";
    this.shortcutUnavailable = false;
    this.agentSession = null;
  }

  private startOperation(cancelAction = true): number {
    const epoch = ++this.operationEpoch;
    if (cancelAction) {
      this.cancelActiveDetectedAction();
      this.cancelActiveLegacyReceipt();
      this.pendingMismatch = null;
      this.pendingProtected = null;
      this.masterPasswordMode = false;
      this.masterPassword = "";
    }
    return epoch;
  }

  private cancelActiveDetectedAction(): void {
    const action = this.activeDetectedAction;
    this.activeDetectedAction = null;
    if (action) void this.fillActions.cancel(action);
  }

  private cancelActiveLegacyReceipt(): void {
    const active = this.activeLegacyReceipt;
    this.activeLegacyReceipt = null;
    if (active) void this.native.cancelReprompt(active.scope, active.receipt).catch(() => undefined);
  }

  private abandonLegacyReceipt(receipt: string): void {
    if (this.activeLegacyReceipt?.receipt === receipt) this.cancelActiveLegacyReceipt();
  }

  private async cancelPendingAction(pending: PendingProtected): Promise<void> {
    if (pending.kind === "detected") {
      await this.fillActions.cancel(pending.prepared);
      if (this.activeDetectedAction === pending.prepared) this.activeDetectedAction = null;
    } else {
      this.abandonLegacyReceipt(pending.receipt);
    }
  }

  private actionUiIsCurrent(epoch: number): boolean {
    return this.componentAlive && epoch === this.operationEpoch;
  }

  private legacyOperation(epoch: number, candidate: RankedAutoFillCandidate): LegacyPickerOperation {
    const session = this.agentSession;
    if (!session) throw new Error("Agent unavailable");
    return {
      epoch,
      candidateId: candidate.cipherId,
      accountId: session.accountId,
      generation: session.generation,
      bundleId: this.bundleId,
      appName: this.appName,
    };
  }

  private legacyOperationIsCurrent(operation: LegacyPickerOperation): boolean {
    const state = this.store.snapshot();
    return this.componentAlive
      && !this.detectedContext
      && operation.epoch === this.operationEpoch
      && this.selected?.cipherId === operation.candidateId
      && this.agentSession?.accountId === operation.accountId
      && this.agentSession.generation === operation.generation
      && state.isUnlocked
      && state.vaultOwnerAccountId === operation.accountId
      && this.bundleId === operation.bundleId
      && this.appName === operation.appName;
  }

  private async legacyTargetIsCurrent(operation: LegacyPickerOperation): Promise<boolean> {
    if (!this.legacyOperationIsCurrent(operation)) return false;
    const entry = await this.native.entryContext().catch(() => ({ status: "unavailable" as const }));
    return this.legacyOperationIsCurrent(operation)
      && entry.status === "available"
      && entry.context.bundleId === operation.bundleId
      && entry.context.appName === operation.appName
      && !("fillContextToken" in entry.context);
  }

  private sessionIsCurrent(
    epoch: number,
    session: AutoFillAgentSession,
  ): boolean {
    const state = this.store.snapshot();
    return this.componentAlive
      && epoch === this.operationEpoch
      && this.agentSession?.accountId === session.accountId
      && this.agentSession.generation === session.generation
      && this.agentSession.vaultRevision === session.vaultRevision
      && state.isUnlocked
      && state.vaultOwnerAccountId === session.accountId;
  }

  private commit(epoch: number, update: () => void): boolean {
    if (!this.componentAlive || epoch !== this.operationEpoch) return false;
    update();
    this.markIfAlive();
    return true;
  }

  private commitLegacy(operation: LegacyPickerOperation, update: () => void): boolean {
    if (!this.legacyOperationIsCurrent(operation)) return false;
    update();
    this.markIfAlive();
    return true;
  }

  private captureDialogReturnFocus(): void {
    if (this.dialogReturnFocus?.isConnected) return;
    this.dialogReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  private restoreDialogFocus(): void {
    const target = this.dialogReturnFocus;
    this.dialogReturnFocus = null;
    if (!target) return;
    queueMicrotask(() => {
      if (this.componentAlive && target.isConnected) target.focus();
    });
  }

  private markIfAlive(): void {
    if (this.componentAlive) this.changeDetector.markForCheck();
  }

  private cancelPicker(): void {
    this.startOperation();
    this.contextSession.cancel();
    this.store.cancelProtectedOperations();
    this.statusMessage = "";
    this.markIfAlive();
  }
}
