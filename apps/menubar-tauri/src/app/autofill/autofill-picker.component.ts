import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Inject, OnDestroy, OnInit, Optional, ViewChild } from "@angular/core";
import { Router } from "@angular/router";

import { PasteError } from "../../host/host-api";
import {
  formatMacShortcut,
  type GlobalShortcutHost,
} from "../../host/global-shortcut";
import { TauriHostService } from "../../host/tauri-host.service";
import { AuthFacade } from "../auth/auth.facade";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { I18nPipe } from "../official-ui/official-ui-common";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import { GLOBAL_SHORTCUT_SETTINGS_HOST } from "../settings/global-shortcut-settings.service";
import { VaultRepromptService } from "../vault/vault-reprompt.service";
import {
  AutoFillCandidateService,
  type AutoFillCandidateGroup,
  type AutoFillSecretField,
  type RankedAutoFillCandidate,
} from "./autofill-candidate.service";
import { AutoFillBindingsService } from "./autofill-bindings.service";
import {
  AUTOFILL_NATIVE_HOST,
  type AutoFillAgentSessionOutcome,
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
type SecretAction = "fill" | "copy";

interface PendingProtectedAction {
  readonly action: SecretAction;
  readonly scope: AutoFillRepromptScope;
  readonly mismatchConfirmed: boolean;
  readonly receipt: string;
}

interface PickerOperation {
  readonly epoch: number;
  readonly candidateId: string;
  readonly accountId: string;
  readonly generation: string;
  readonly bundleId: string;
  readonly appName: string;
}

const FIELD_ORDER: readonly AutoFillSecretField[] = ["username", "password", "totp"];
const GROUP_ORDER: readonly AutoFillCandidateGroup[] = ["exact", "relevant", "other"];
const GROUP_LABELS: Record<AutoFillCandidateGroup, string> = {
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
              role="status"
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
            <p role="status">{{ statusMessage }}</p>
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
        <div class="autofill-picker__field-switcher" role="group" [attr.aria-label]="'i18nAutofillChooseField' | i18n">
          @for (field of fieldOrder; track field) {
            <button
              type="button"
              [attr.data-testid]="'autofill-field-' + field"
              [attr.aria-pressed]="selectedField === field"
              [class.autofill-picker__field--selected]="selectedField === field"
              (click)="selectField(field)"
            >
              <i class="bwi" [class.bwi-user]="field === 'username'" [class.bwi-lock]="field === 'password'" [class.bwi-clock]="field === 'totp'" aria-hidden="true"></i>
              <span>{{ fieldLabel(field) }}</span>
            </button>
          }
        </div>

        <label class="autofill-picker__search">
          <i class="bwi bwi-search" aria-hidden="true"></i>
          <span class="tw-sr-only">{{ "i18nAutofillSearchAccounts" | i18n }}</span>
          <input type="search" [placeholder]="'i18nAutofillSearchAccounts' | i18n" [value]="query" (input)="search(inputValue($event))" />
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
            aria-labelledby="autofill-target-app"
            [attr.aria-activedescendant]="highlightedCandidate ? optionId(highlightedCandidate) : null"
            (keydown)="onListKeydown($event)"
          >
            @for (group of groupOrder; track group) {
              @if (candidatesFor(group).length) {
                <section [attr.data-testid]="'autofill-group-' + group">
                  <h2>{{ groupLabel(group) }}</h2>
                  <div class="autofill-picker__group-list">
                  @for (candidate of candidatesFor(group); track candidate.cipherId) {
                    <button
                      class="autofill-picker__candidate"
                      type="button"
                      role="option"
                      tabindex="-1"
                      [id]="optionId(candidate)"
                      [attr.data-testid]="'autofill-fill-candidate-' + candidate.cipherId"
                      [class.autofill-picker__option--highlighted]="highlightedCandidate?.cipherId === candidate.cipherId"
                      [attr.aria-selected]="selected?.cipherId === candidate.cipherId"
                      [attr.aria-label]="fillCandidateLabel(candidate)"
                      (mouseenter)="highlightCandidate(candidate)"
                      (focus)="highlightCandidate(candidate)"
                      (click)="activateCandidate(candidate)"
                    >
                      <span class="autofill-picker__candidate-icon" aria-hidden="true"><i class="bwi bwi-globe"></i></span>
                      <span class="autofill-picker__candidate-copy">
                        <strong>{{ candidate.displayName }}</strong>
                        <small>{{ candidate.username }} · {{ reasonLabel(candidate.reason) }}</small>
                      </span>
                      <span class="autofill-picker__fill-label">{{ "i18nAutofillFill" | i18n }}</span>
                    </button>
                  }
                  </div>
                </section>
              }
            }
          </div>

          @if (highlightedCandidate) {
            <footer class="autofill-picker__copy-bar">
              <button data-testid="autofill-copy-only" type="button" (click)="copyHighlighted()">
                <i class="bwi bwi-clone" aria-hidden="true"></i>
                <strong>{{ "i18nAutofillCopyOnly" | i18n }}</strong>
              </button>
              <span>{{ copyDescription() }}</span>
            </footer>
          }
        }
      }

      @if (statusMessage && mode !== "repair") { <p role="status">{{ statusMessage }}</p> }
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
              <button data-autofill-dialog-primary type="button" (click)="verifyWithTouchId()">{{ "i18nUseTouchId" | i18n }}</button>
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
  mode: PickerMode = "loading";
  appName = "";
  query = "";
  candidates: readonly RankedAutoFillCandidate[] = [];
  selected: RankedAutoFillCandidate | null = null;
  highlightedIndex = 0;
  statusMessage = "";
  selectedField: AutoFillSecretField = "password";
  shortcutLabel = "";
  shortcutUnavailable = false;
  setupRequiresApproval = false;
  setupRequiresAccessibility = false;
  setupActionPending = false;
  pendingMismatch: { action: SecretAction; field: AutoFillSecretField } | null = null;
  pendingProtected: PendingProtectedAction | null = null;
  masterPasswordMode = false;
  masterPassword = "";
  readonly fieldOrder = FIELD_ORDER;
  readonly groupOrder = GROUP_ORDER;
  private bundleId = "";
  private candidatesByField = new Map<AutoFillSecretField, readonly RankedAutoFillCandidate[]>();
  private agentSession: Extract<AutoFillAgentSessionOutcome, { status: "success" }> | null = null;
  private operationEpoch = 0;
  private initializeTimer: number | undefined;
  private componentAlive = true;
  private activeReceipt: { readonly scope: AutoFillRepromptScope; readonly receipt: string } | null = null;
  private dialogReturnFocus: HTMLElement | null = null;
  private readonly shortcutHost: GlobalShortcutHost;

  constructor(
    private readonly store: PopupStateStore,
    private readonly candidatesService: AutoFillCandidateService,
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
    if (!this.store.snapshot().isUnlocked) {
      this.mode = "locked";
    }
  }

  ngOnInit(): void {
    this.initializeTimer = window.setTimeout(() => {
      this.initializeTimer = undefined;
      void this.initialize();
    }, 0);
  }

  ngOnDestroy(): void {
    if (this.initializeTimer !== undefined) {
      window.clearTimeout(this.initializeTimer);
      this.initializeTimer = undefined;
    }
    this.componentAlive = false;
    this.operationEpoch += 1;
    this.cancelActiveReceipt();
    this.store.cancelProtectedOperations();
    this.masterPassword = "";
  }

  async initialize(): Promise<void> {
    const epoch = this.startOperation();
    this.clearPickerState();
    const state = this.store.snapshot();
    if (!state.isUnlocked) {
      this.mode = "locked";
      this.markIfAlive();
      return;
    }
    const setupState = this.setup?.blockReason();
    if (
      setupState === "requiresApproval"
      || setupState === "requiresAccessibility"
      || setupState === "unavailable"
    ) {
      this.setupRequiresApproval = setupState === "requiresApproval";
      this.setupRequiresAccessibility = setupState === "requiresAccessibility";
      this.mode = "repair";
      this.markIfAlive();
      return;
    }
    this.mode = "loading";
    try {
      const context = await this.native.entryContext();
      if (!this.commit(epoch, () => {})) return;
      if (context.status !== "available") {
        this.commit(epoch, () => { this.mode = "context-unavailable"; });
        return;
      }
      if (!this.commit(epoch, () => {
        this.bundleId = context.bundleId;
        this.appName = context.appName;
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
      if (!this.commit(epoch, () => { this.agentSession = session; })) return;
      const owner = this.store.snapshot().vaultOwnerAccountId;
      if (!owner) {
        this.commit(epoch, () => { this.mode = "repair"; });
        return;
      }
      if (owner !== session.accountId) {
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
      if (!this.componentAlive) return;
      this.statusMessage = translateOfficialMessage("i18nAutofillIsOff");
    } catch {
      if (!this.componentAlive) return;
      this.statusMessage = translateOfficialMessage("i18nAutofillTurnOffFailed");
    } finally {
      this.setupActionPending = false;
      this.markIfAlive();
    }
  }

  async search(value: string): Promise<void> {
    const epoch = this.startOperation();
    this.query = value;
    this.selected = null;
    this.markIfAlive();
    await this.refreshCandidates(epoch).catch(() => {
      this.commit(epoch, () => { this.mode = "repair"; });
    });
  }

  candidatesFor(group: AutoFillCandidateGroup): readonly RankedAutoFillCandidate[] {
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

  selectField(field: AutoFillSecretField): void {
    if (field === this.selectedField) return;
    this.startOperation();
    this.selectedField = field;
    this.candidates = this.candidatesByField.get(field) ?? [];
    this.highlightedIndex = 0;
    this.selected = null;
    this.statusMessage = "";
    this.mode = this.candidates.length ? "ready" : "empty";
    this.markIfAlive();
  }

  highlightCandidate(candidate: RankedAutoFillCandidate): void {
    const index = this.candidates.findIndex((item) => item.cipherId === candidate.cipherId);
    if (index < 0 || index === this.highlightedIndex) return;
    this.highlightedIndex = index;
    this.markIfAlive();
  }

  activateCandidate(candidate: RankedAutoFillCandidate): void {
    this.selectCandidate(candidate);
    void this.perform("fill", this.selectedField);
  }

  copyHighlighted(): void {
    const candidate = this.highlightedCandidate;
    if (!candidate) return;
    this.selectCandidate(candidate);
    void this.perform("copy", this.selectedField);
  }

  fillCandidateLabel(candidate: RankedAutoFillCandidate): string {
    return translateOfficialMessage(
      "i18nAutofillFillCandidate",
      this.fieldLabel(this.selectedField),
      candidate.displayName,
    );
  }

  copyDescription(): string {
    const candidate = this.highlightedCandidate;
    return candidate
      ? translateOfficialMessage(
        "i18nAutofillCopyDescription",
        candidate.displayName,
        this.fieldLabel(this.selectedField),
      )
      : "";
  }

  selectIndex(index: number): void {
    if (!this.candidates.length) return;
    this.highlightedIndex = Math.max(0, Math.min(index, this.candidates.length - 1));
    this.selectCandidate(this.candidates[this.highlightedIndex]);
  }

  selectCandidate(candidate: RankedAutoFillCandidate): void {
    this.startOperation();
    this.selected = candidate;
    this.pendingMismatch = null;
    this.pendingProtected = null;
    this.statusMessage = "";
    this.markIfAlive();
  }

  get highlightedCandidate(): RankedAutoFillCandidate | null {
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

  optionId(candidate: RankedAutoFillCandidate): string {
    return `autofill-option-${candidate.cipherId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  }

  onListKeydown(event: KeyboardEvent): void {
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
      if (candidate) this.activateCandidate(candidate);
    }
  }

  private scrollHighlightedIntoView(): void {
    const optionId = this.highlightedCandidate ? this.optionId(this.highlightedCandidate) : null;
    if (!optionId) return;
    queueMicrotask(() => {
      document.getElementById(optionId)?.scrollIntoView?.({ block: "nearest" });
    });
  }

  async perform(action: SecretAction, field: AutoFillSecretField, mismatchConfirmed = false): Promise<void> {
    const selected = this.selected;
    const session = this.agentSession;
    if (!selected || !session || this.mode === "repair") return;
    const epoch = this.startOperation();
    const operation = this.operation(epoch, selected, session);
    if (selected.requiresMismatchConfirmation && !mismatchConfirmed) {
      this.captureDialogReturnFocus();
      this.pendingMismatch = { action, field };
      this.markIfAlive();
      return;
    }
    this.pendingMismatch = null;
    this.statusMessage = "";
    try {
      const response = await this.candidatesService.query(this.queryRequest(field));
      if (!await this.targetIsCurrent(operation)) return;
      const current = response.candidates.find((candidate) => candidate.cipherId === selected.cipherId);
      if (!current) {
        this.commitOperation(operation, () => {
          this.statusMessage = translateOfficialMessage("i18nAutofillFieldUnavailable");
        });
        return;
      }
      const state = this.store.snapshot();
      const localLogin = state.vaultOwnerAccountId === session.accountId
        ? state.items.find((item) => item.type === "login" && item.id === current.cipherId)
        : undefined;
      if (!localLogin) {
        this.commitOperation(operation, () => { this.mode = "repair"; });
        return;
      }
      const scope: AutoFillRepromptScope = {
        accountId: session.accountId,
        candidateId: current.cipherId,
        field,
        generation: session.generation,
        contextToken: response.contextToken,
      };
      if (localLogin.reprompt) {
        const receipt = await this.native.beginReprompt(scope);
        if (!await this.targetIsCurrent(operation)) {
          if (receipt.status === "pending") {
            void this.native.cancelReprompt(scope, receipt.receipt).catch(() => undefined);
          }
          return;
        }
        if (receipt.status !== "pending") {
          this.commitOperation(operation, () => { this.mode = "repair"; });
          return;
        }
        this.activeReceipt = { scope, receipt: receipt.receipt };
        this.captureDialogReturnFocus();
        this.commitOperation(operation, () => {
          this.pendingProtected = { action, scope, mismatchConfirmed, receipt: receipt.receipt };
        });
        return;
      }
      await this.releaseAndDeliver(operation, action, scope, mismatchConfirmed);
    } catch {
      this.commitOperation(operation, () => {
        this.statusMessage = translateOfficialMessage("i18nAutofillActionFailed");
      });
    }
  }

  async confirmMismatch(): Promise<void> {
    const pending = this.pendingMismatch;
    if (!pending) return;
    this.pendingMismatch = null;
    this.restoreDialogFocus();
    await this.perform(pending.action, pending.field, true);
  }

  cancelMismatch(): void {
    this.startOperation();
    this.pendingMismatch = null;
    this.restoreDialogFocus();
    this.markIfAlive();
  }

  cancelProtectedAction(): void {
    this.startOperation();
    this.pendingProtected = null;
    this.masterPasswordMode = false;
    this.masterPassword = "";
    this.restoreDialogFocus();
    this.markIfAlive();
  }

  async verifyWithTouchId(): Promise<void> {
    const pending = this.pendingProtected;
    if (!pending) return;
    const selected = this.selected;
    const session = this.agentSession;
    if (!selected || !session) return;
    const epoch = this.startOperation(false);
    const operation = this.operation(epoch, selected, session);
    this.pendingProtected = null;
    this.restoreDialogFocus();
    this.markIfAlive();
    const outcome = await this.native.biometricReprompt(pending.scope.accountId, pending.receipt)
      .catch(() => "failed" as const);
    if (!await this.targetIsCurrent(operation)) {
      this.abandonReceipt(pending.receipt);
      return;
    }
    if (outcome !== "success") {
      this.abandonReceipt(pending.receipt);
      this.commitOperation(operation, () => {
        this.statusMessage = translateOfficialMessage(outcome === "cancelled"
          ? "i18nAutofillTouchIdCancelled"
          : "i18nAutofillTouchIdFailed");
      });
      return;
    }
    await this.releaseAndDeliver(
      operation,
      pending.action,
      pending.scope,
      pending.mismatchConfirmed,
      pending.receipt,
    );
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
    const selected = this.selected;
    const session = this.agentSession;
    if (!pending || !selected || !session || !this.masterPasswordMode || !this.masterPassword) return;
    const pickerEpoch = this.startOperation(false);
    const operation = this.operation(pickerEpoch, selected, session);
    const password = this.masterPassword;
    this.masterPassword = "";
    this.markIfAlive();
    const epoch = this.store.beginProtectedOperation();
    let verified = false;
    let verificationFailed = false;
    try {
      verified = await this.reprompt.verify(password, epoch, pending.receipt);
    } catch {
      verificationFailed = true;
      this.commitOperation(operation, () => {
        this.statusMessage = translateOfficialMessage("i18nAutofillMasterPasswordFailed");
      });
    }
    if (verificationFailed) {
      this.abandonReceipt(pending.receipt);
      this.commitOperation(operation, () => {
        this.pendingProtected = null;
        this.masterPasswordMode = false;
      });
      this.restoreDialogFocus();
      return;
    }
    if (!verified || !this.store.isCurrentProtectedOperation(epoch)) {
      this.abandonReceipt(pending.receipt);
      this.commitOperation(operation, () => {
        this.pendingProtected = null;
        this.masterPasswordMode = false;
      });
      this.restoreDialogFocus();
      return;
    }
    if (!await this.targetIsCurrent(operation)) {
      this.abandonReceipt(pending.receipt);
      return;
    }
    if (!this.commitOperation(operation, () => {
      this.pendingProtected = null;
      this.masterPasswordMode = false;
    })) {
      this.abandonReceipt(pending.receipt);
      return;
    }
    this.restoreDialogFocus();
    await this.releaseAndDeliver(
        operation,
        pending.action,
        pending.scope,
        pending.mismatchConfirmed,
        pending.receipt,
    );
  }

  async useProjectedAccount(): Promise<void> {
    const session = this.agentSession;
    if (!session) return;
    const epoch = this.startOperation();
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

  private async refreshCandidates(epoch: number): Promise<void> {
    const session = this.agentSession;
    if (!session || !this.sessionIsCurrent(epoch, session)) throw new Error("Agent unavailable");
    const bundleId = this.bundleId;
    const appName = this.appName;
    const results = await Promise.all(FIELD_ORDER.map((field) =>
      this.candidatesService.query(this.queryRequest(field)),
    ));
    if (!this.sessionIsCurrent(epoch, session)) return;
    const context = await this.native.entryContext().catch(() => ({ status: "unavailable" as const }));
    if (!this.sessionIsCurrent(epoch, session)
      || context.status !== "available"
      || context.bundleId !== bundleId
      || context.appName !== appName) return;
    const byField = new Map<AutoFillSecretField, readonly RankedAutoFillCandidate[]>();
    for (const [index, result] of results.entries()) {
      const candidates = new Map<string, RankedAutoFillCandidate>();
      for (const candidate of result.candidates) {
        const existing = candidates.get(candidate.cipherId);
        if (!existing || GROUP_ORDER.indexOf(candidate.group) < GROUP_ORDER.indexOf(existing.group)) {
          candidates.set(candidate.cipherId, candidate);
        }
      }
      byField.set(FIELD_ORDER[index], [...candidates.values()].sort((left, right) =>
        GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group),
      ));
    }
    this.commit(epoch, () => {
      this.candidatesByField = byField;
      this.candidates = byField.get(this.selectedField) ?? [];
      this.highlightedIndex = 0;
      this.mode = this.candidates.length ? "ready" : "empty";
    });
  }

  private queryRequest(field: AutoFillSecretField) {
    const session = this.agentSession;
    if (!session) throw new Error("Agent unavailable");
    return {
      accountId: session.accountId,
      lockGeneration: session.generation,
      field,
      context: {
        bundleId: this.bundleId,
        appName: this.appName,
        serviceIdentifiers: [] as string[],
        query: this.query,
      },
    };
  }

  private async releaseAndDeliver(
    operation: PickerOperation,
    action: SecretAction,
    scope: AutoFillRepromptScope,
    mismatchConfirmed: boolean,
    repromptReceipt?: string,
  ): Promise<void> {
    let value = "";
    try {
      if (!await this.targetIsCurrent(operation)) return;
      const released = await this.native.releaseSecret({
        scope,
        mismatchConfirmed,
        ...(repromptReceipt ? { repromptReceipt } : {}),
      });
      if (!this.operationIsCurrent(operation)) return;
      if (released.status !== "success" || released.field !== scope.field) {
        this.commitOperation(operation, () => {
          this.statusMessage = translateOfficialMessage("i18nAutofillReleaseFailed");
        });
        return;
      }
      value = released.value;
      if (!await this.targetIsCurrent(operation)) return;
      if (action === "copy") {
        await this.native.copyText(value, 30);
        this.commitOperation(operation, () => {
          this.statusMessage = translateOfficialMessage("i18nAutofillCopied");
        });
      } else {
        try {
          await this.native.pasteText(value, 30);
          const delivered = this.commitOperation(operation, () => {
            this.statusMessage = translateOfficialMessage("i18nAutofillFilled");
          });
          if (delivered) {
            this.bindings.bind(operation.accountId, operation.bundleId, operation.candidateId);
            this.bindings.recordSuccessfulSelection({
              accountId: operation.accountId,
              bundleId: operation.bundleId,
              serviceIdentifiers: [],
              cipherId: operation.candidateId,
              selectedAt: new Date().toISOString(),
              explicitUserAction: true,
              succeeded: true,
            });
          }
        } catch (error) {
          this.commitOperation(operation, () => {
            this.statusMessage = translateOfficialMessage(error instanceof PasteError && error.valueCopied
              ? "i18nAutofillPasteFallback"
              : "i18nAutofillPasteFailed");
          });
        }
      }
    } finally {
      value = "";
      if (repromptReceipt && this.activeReceipt?.receipt === repromptReceipt) {
        this.cancelActiveReceipt();
      }
    }
  }

  private clearPickerState(): void {
    this.candidates = [];
    this.candidatesByField.clear();
    this.selected = null;
    this.pendingMismatch = null;
    this.pendingProtected = null;
    this.masterPasswordMode = false;
    this.masterPassword = "";
    this.statusMessage = "";
    this.selectedField = "password";
    this.appName = "";
    this.bundleId = "";
    this.shortcutLabel = "";
    this.shortcutUnavailable = false;
    this.agentSession = null;
  }

  private startOperation(cancelReceipt = true): number {
    const epoch = ++this.operationEpoch;
    if (cancelReceipt) {
      this.cancelActiveReceipt();
      this.pendingMismatch = null;
      this.pendingProtected = null;
      this.masterPasswordMode = false;
      this.masterPassword = "";
    }
    return epoch;
  }

  private operation(
    epoch: number,
    selected: RankedAutoFillCandidate,
    session: Extract<AutoFillAgentSessionOutcome, { status: "success" }>,
  ): PickerOperation {
    return {
      epoch,
      candidateId: selected.cipherId,
      accountId: session.accountId,
      generation: session.generation,
      bundleId: this.bundleId,
      appName: this.appName,
    };
  }

  private operationIsCurrent(operation: PickerOperation): boolean {
    const state = this.store.snapshot();
    return this.componentAlive
      && operation.epoch === this.operationEpoch
      && this.selected?.cipherId === operation.candidateId
      && this.agentSession?.accountId === operation.accountId
      && this.agentSession?.generation === operation.generation
      && state.isUnlocked
      && state.vaultOwnerAccountId === operation.accountId
      && this.bundleId === operation.bundleId
      && this.appName === operation.appName;
  }

  private sessionIsCurrent(
    epoch: number,
    session: Extract<AutoFillAgentSessionOutcome, { status: "success" }>,
  ): boolean {
    const state = this.store.snapshot();
    return this.componentAlive
      && epoch === this.operationEpoch
      && this.agentSession?.accountId === session.accountId
      && this.agentSession?.generation === session.generation
      && state.isUnlocked
      && state.vaultOwnerAccountId === session.accountId;
  }

  private async targetIsCurrent(operation: PickerOperation): Promise<boolean> {
    if (!this.operationIsCurrent(operation)) return false;
    const context = await this.native.entryContext().catch(() => ({ status: "unavailable" as const }));
    return this.operationIsCurrent(operation)
      && context.status === "available"
      && context.bundleId === operation.bundleId
      && context.appName === operation.appName;
  }

  private commit(epoch: number, update: () => void): boolean {
    if (!this.componentAlive || epoch !== this.operationEpoch) return false;
    update();
    this.markIfAlive();
    return true;
  }

  private commitOperation(operation: PickerOperation, update: () => void): boolean {
    if (!this.operationIsCurrent(operation)) return false;
    update();
    this.markIfAlive();
    return true;
  }

  private markIfAlive(): void {
    if (this.componentAlive) this.changeDetector.markForCheck();
  }

  private cancelActiveReceipt(): void {
    const active = this.activeReceipt;
    this.activeReceipt = null;
    if (active) void this.native.cancelReprompt(active.scope, active.receipt).catch(() => undefined);
  }

  private abandonReceipt(receipt: string): void {
    if (this.activeReceipt?.receipt === receipt) this.cancelActiveReceipt();
  }

  private captureDialogReturnFocus(): void {
    this.dialogReturnFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }

  private restoreDialogFocus(): void {
    const target = this.dialogReturnFocus;
    this.dialogReturnFocus = null;
    if (!target) return;
    queueMicrotask(() => {
      if (this.componentAlive && target.isConnected) target.focus();
    });
  }

  private cancelPicker(): void {
    this.startOperation();
    this.pendingMismatch = null;
    this.pendingProtected = null;
    this.masterPasswordMode = false;
    this.masterPassword = "";
    this.statusMessage = "";
    this.markIfAlive();
  }
}
