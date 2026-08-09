import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, OnDestroy, OnInit, Optional } from "@angular/core";
import { Router } from "@angular/router";

import { PasteError } from "../../host/host-api";
import { AuthFacade } from "../auth/auth.facade";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { PopupStateStore } from "../popup-state";
import { VaultRepromptService } from "../vault/vault-reprompt.service";
import {
  AutoFillCandidateService,
  type AutoFillCandidateGroup,
  type AutoFillSecretField,
  type RankedAutoFillCandidate,
} from "./autofill-candidate.service";
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
  exact: "Exact matches",
  relevant: "Relevant matches",
  other: "Other logins",
};
const REASON_LABELS: Readonly<Record<string, string>> = {
  user_binding: "Chosen for this app",
  service_identifier: "Matches this service",
  app_preset: "Matches this app",
  vault_uri_rule: "Matches a saved URI rule",
  host_or_domain: "Matches a related domain",
  fuzzy_name: "Similar app or login name",
  selection_history: "Used here before",
  favorite: "Favorite login",
  recent: "Recently used",
  other: "Other login",
};

@Component({
  selector: "bw-autofill-picker",
  standalone: true,
  imports: [CommonModule, PopupHeaderComponent, PopupPageComponent],
  host: { class: "macos-page macos-page--secondary macos-page--autofill-picker" },
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    [role="option"].autofill-picker__option--highlighted {
      background-color: rgba(0, 122, 255, 0.12);
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  `],
  template: `
    <popup-page>
      <popup-header slot="header" [pageTitle]="'AutoFill'" showBackButton [backAction]="backAction" />
      <main class="autofill-picker" (keydown)="onListKeydown($event)">
      @if (appName) { <p id="autofill-target-app">{{ appName }}</p> }

      @if (mode === "locked") {
        <section data-testid="autofill-locked">
          <h2>Vault locked</h2><p>Unlock Barwarden to view login matches.</p>
          <button type="button" (click)="unlock()">Unlock</button>
        </section>
      } @else if (mode === "repair") {
        <section data-testid="autofill-repair">
          <h2>AutoFill needs attention</h2>
          @if (setupRequiresApproval) {
            <p>Open System Settings &gt; General &gt; Login Items and allow Barwarden AutoFill Agent, then try again.</p>
          } @else {
            <p>Repair or refresh the native AutoFill data, then try again.</p>
          }
          <button type="button" (click)="initialize()">Retry</button>
        </section>
      } @else if (mode === "context-unavailable") {
        <section data-testid="autofill-context-unavailable">
          <h2>Target app unavailable</h2><p>Return to the app you want to fill, then reopen AutoFill.</p>
        </section>
      } @else if (mode === "account-override") {
        <section data-testid="autofill-account-override">
          <h2>Choose the projected account</h2><p>Matches are never combined across accounts.</p>
          <button type="button" (click)="useProjectedAccount()">Use this account</button>
        </section>
      } @else if (mode === "loading") {
        <section data-testid="autofill-loading">Finding logins…</section>
      } @else {
        <label class="autofill-picker__search">
          <span>Search all logins</span>
          <input type="search" [value]="query" (input)="search(inputValue($event))" />
        </label>

        @if (mode === "empty") {
          <section data-testid="autofill-empty"><h2>No matching logins</h2><p>Try another search.</p></section>
        } @else {
          <div
            role="listbox"
            tabindex="0"
            aria-labelledby="autofill-target-app"
            [attr.aria-activedescendant]="highlightedCandidate ? optionId(highlightedCandidate) : null"
          >
            @for (group of groupOrder; track group) {
              @if (candidatesFor(group).length) {
                <section [attr.data-testid]="'autofill-group-' + group">
                  <h2>{{ groupLabel(group) }}</h2>
                  @for (candidate of candidatesFor(group); track candidate.cipherId) {
                    <button
                      type="button"
                      role="option"
                      [id]="optionId(candidate)"
                      [class.autofill-picker__option--highlighted]="highlightedCandidate?.cipherId === candidate.cipherId"
                      [attr.aria-selected]="selected?.cipherId === candidate.cipherId"
                      (click)="selectCandidate(candidate)"
                    >
                      <strong>{{ candidate.displayName }}</strong>
                      <span>{{ candidate.username }}</span>
                      <small>{{ reasonLabel(candidate.reason) }}</small>
                    </button>
                  }
                </section>
              }
            }
          </div>

          @if (selected) {
            <section class="autofill-picker__actions" aria-labelledby="autofill-actions-title">
              <h2 id="autofill-actions-title">{{ selected.displayName }}</h2>
              <button data-testid="fill-username" type="button" (click)="perform('fill', 'username')">Fill username</button>
              <button data-testid="fill-password" type="button" (click)="perform('fill', 'password')">Fill password</button>
              <button data-testid="fill-totp" type="button" (click)="perform('fill', 'totp')">Fill TOTP</button>
              <button data-testid="copy-username" type="button" (click)="perform('copy', 'username')">Copy username</button>
              <button data-testid="copy-password" type="button" (click)="perform('copy', 'password')">Copy password</button>
              <button data-testid="copy-totp" type="button" (click)="perform('copy', 'totp')">Copy TOTP</button>
            </section>
          }

          @if (pendingMismatch) {
            <section role="alertdialog" aria-labelledby="autofill-mismatch-title">
              <p id="autofill-mismatch-title">This login does not match the target app. Fill it anyway?</p>
              <button type="button" (click)="confirmMismatch()">Fill anyway</button>
              <button type="button" (click)="cancelMismatch()">Cancel</button>
            </section>
          }

          @if (pendingProtected) {
            <section aria-labelledby="autofill-verify-title">
              <p id="autofill-verify-title">Verify before releasing this protected field.</p>
              <button type="button" (click)="verifyWithTouchId()">Use Touch ID</button>
              <button type="button" (click)="showMasterPasswordReprompt()">Use master password</button>
              @if (masterPasswordMode) {
                <form (submit)="verifyWithMasterPassword($event)">
                  <label>Master password <input type="password" autocomplete="current-password" [value]="masterPassword" (input)="masterPassword = inputValue($event)" /></label>
                  <button type="submit">Verify</button>
                </form>
              }
              <button type="button" (click)="cancelProtectedAction()">Cancel</button>
            </section>
          }
        }
      }

      @if (statusMessage) { <p role="status">{{ statusMessage }}</p> }
      </main>
    </popup-page>
  `,
})
export class AutoFillPickerComponent implements OnInit, OnDestroy {
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
  setupRequiresApproval = false;
  pendingMismatch: { action: SecretAction; field: AutoFillSecretField } | null = null;
  pendingProtected: PendingProtectedAction | null = null;
  masterPasswordMode = false;
  masterPassword = "";
  readonly groupOrder = GROUP_ORDER;
  private bundleId = "";
  private agentSession: Extract<AutoFillAgentSessionOutcome, { status: "success" }> | null = null;
  private operationEpoch = 0;
  private initializeTimer: number | undefined;
  private componentAlive = true;
  private activeReceipt: { readonly scope: AutoFillRepromptScope; readonly receipt: string } | null = null;

  constructor(
    private readonly store: PopupStateStore,
    private readonly candidatesService: AutoFillCandidateService,
    @Inject(AUTOFILL_NATIVE_HOST) private readonly native: AutoFillNativeHost,
    private readonly auth: AuthFacade,
    private readonly router: Router,
    private readonly reprompt: VaultRepromptService,
    private readonly changeDetector: ChangeDetectorRef,
    @Optional() private readonly setup: AutoFillSetupService | null = null,
  ) {
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
    if (setupState === "requiresApproval" || setupState === "unavailable") {
      this.setupRequiresApproval = setupState === "requiresApproval";
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

  async search(value: string): Promise<void> {
    const epoch = this.startOperation();
    this.query = value;
    this.selected = null;
    this.mode = "loading";
    this.markIfAlive();
    await this.refreshCandidates(epoch).catch(() => {
      this.commit(epoch, () => { this.mode = "repair"; });
    });
  }

  candidatesFor(group: AutoFillCandidateGroup): readonly RankedAutoFillCandidate[] {
    return this.candidates.filter((candidate) => candidate.group === group);
  }

  groupLabel(group: AutoFillCandidateGroup): string {
    return GROUP_LABELS[group];
  }

  reasonLabel(reason: string): string {
    return REASON_LABELS[reason] ?? REASON_LABELS["other"];
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

  optionId(candidate: RankedAutoFillCandidate): string {
    return `autofill-option-${candidate.cipherId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  }

  onListKeydown(event: KeyboardEvent): void {
    if (!this.candidates.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.highlightedIndex = (this.highlightedIndex + 1) % this.candidates.length;
      this.markIfAlive();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.highlightedIndex = (this.highlightedIndex - 1 + this.candidates.length) % this.candidates.length;
      this.markIfAlive();
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.selectIndex(this.highlightedIndex);
    }
  }

  async perform(action: SecretAction, field: AutoFillSecretField, mismatchConfirmed = false): Promise<void> {
    const selected = this.selected;
    const session = this.agentSession;
    if (!selected || !session || this.mode === "repair") return;
    const epoch = this.startOperation();
    const operation = this.operation(epoch, selected, session);
    if (selected.requiresMismatchConfirmation && !mismatchConfirmed) {
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
          this.statusMessage = "This field is not available for the selected login.";
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
        this.commitOperation(operation, () => {
          this.pendingProtected = { action, scope, mismatchConfirmed, receipt: receipt.receipt };
        });
        return;
      }
      await this.releaseAndDeliver(operation, action, scope, mismatchConfirmed);
    } catch {
      this.commitOperation(operation, () => {
        this.statusMessage = "AutoFill could not complete this field action.";
      });
    }
  }

  async confirmMismatch(): Promise<void> {
    const pending = this.pendingMismatch;
    if (!pending) return;
    this.pendingMismatch = null;
    await this.perform(pending.action, pending.field, true);
  }

  cancelMismatch(): void {
    this.startOperation();
    this.pendingMismatch = null;
    this.markIfAlive();
  }

  cancelProtectedAction(): void {
    this.startOperation();
    this.pendingProtected = null;
    this.masterPasswordMode = false;
    this.masterPassword = "";
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
        this.statusMessage = outcome === "cancelled"
          ? "Touch ID verification was cancelled."
          : "Touch ID verification failed.";
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
    try {
      verified = await this.reprompt.verify(password, epoch, pending.receipt);
    } catch {
      this.commitOperation(operation, () => {
        this.statusMessage = "Master password verification failed.";
      });
    }
    if (!verified || !this.store.isCurrentProtectedOperation(epoch)) {
      this.abandonReceipt(pending.receipt);
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
        this.statusMessage = "Unable to switch accounts.";
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
    const candidates = new Map<string, RankedAutoFillCandidate>();
    for (const result of results) {
      for (const candidate of result.candidates) {
        const existing = candidates.get(candidate.cipherId);
        if (!existing || GROUP_ORDER.indexOf(candidate.group) < GROUP_ORDER.indexOf(existing.group)) {
          candidates.set(candidate.cipherId, candidate);
        }
      }
    }
    this.commit(epoch, () => {
      this.candidates = [...candidates.values()].sort((left, right) =>
        GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group),
      );
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
          this.statusMessage = "AutoFill could not release this field.";
        });
        return;
      }
      value = released.value;
      if (!await this.targetIsCurrent(operation)) return;
      if (action === "copy") {
        await this.native.copyText(value, 30);
        this.commitOperation(operation, () => { this.statusMessage = "Copied."; });
      } else {
        try {
          await this.native.pasteText(value, 30);
          this.commitOperation(operation, () => { this.statusMessage = "Filled."; });
        } catch (error) {
          this.commitOperation(operation, () => {
            this.statusMessage = error instanceof PasteError && error.valueCopied
              ? "Copied. Paste into the target app manually."
              : "AutoFill could not paste this field.";
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
    this.selected = null;
    this.pendingMismatch = null;
    this.pendingProtected = null;
    this.masterPasswordMode = false;
    this.masterPassword = "";
    this.statusMessage = "";
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
