import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Inject, OnDestroy, OnInit } from "@angular/core";
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
          <h2>AutoFill needs attention</h2><p>Repair or refresh the native AutoFill data, then try again.</p>
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
          <div role="listbox" aria-labelledby="autofill-target-app">
            @for (group of groupOrder; track group) {
              @if (candidatesFor(group).length) {
                <section [attr.data-testid]="'autofill-group-' + group">
                  <h2>{{ groupLabel(group) }}</h2>
                  @for (candidate of candidatesFor(group); track candidate.cipherId) {
                    <button
                      type="button"
                      role="option"
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
              <button type="button" (click)="pendingMismatch = null">Cancel</button>
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
              <button type="button" (click)="pendingProtected = null">Cancel</button>
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
  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.router.navigateByUrl("/tabs/vault");
  mode: PickerMode = "loading";
  appName = "";
  query = "";
  candidates: readonly RankedAutoFillCandidate[] = [];
  selected: RankedAutoFillCandidate | null = null;
  highlightedIndex = 0;
  statusMessage = "";
  pendingMismatch: { action: SecretAction; field: AutoFillSecretField } | null = null;
  pendingProtected: PendingProtectedAction | null = null;
  masterPasswordMode = false;
  masterPassword = "";
  readonly groupOrder = GROUP_ORDER;
  private bundleId = "";
  private agentSession: Extract<AutoFillAgentSessionOutcome, { status: "success" }> | null = null;
  private operationEpoch = 0;
  private initializeTimer: number | undefined;

  constructor(
    private readonly store: PopupStateStore,
    private readonly candidatesService: AutoFillCandidateService,
    @Inject(AUTOFILL_NATIVE_HOST) private readonly native: AutoFillNativeHost,
    private readonly auth: AuthFacade,
    private readonly router: Router,
    private readonly reprompt: VaultRepromptService,
    private readonly changeDetector: ChangeDetectorRef,
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
    this.operationEpoch += 1;
    this.store.cancelProtectedOperations();
    this.masterPassword = "";
  }

  async initialize(): Promise<void> {
    const epoch = ++this.operationEpoch;
    this.clearPickerState();
    const state = this.store.snapshot();
    if (!state.isUnlocked) {
      this.mode = "locked";
      return;
    }
    this.mode = "loading";
    try {
      const context = await this.native.entryContext();
      if (epoch !== this.operationEpoch) return;
      if (context.status !== "available") {
        this.mode = "context-unavailable";
        return;
      }
      this.bundleId = context.bundleId;
      this.appName = context.appName;
      const session = await this.native.agentSession();
      if (epoch !== this.operationEpoch) return;
      if (session.status !== "success") {
        this.mode = "repair";
        return;
      }
      this.agentSession = session;
      const owner = this.store.snapshot().vaultOwnerAccountId;
      if (!owner) {
        this.mode = "repair";
        return;
      }
      if (owner !== session.accountId) {
        this.mode = "account-override";
        return;
      }
      await this.refreshCandidates(epoch);
    } catch {
      if (epoch === this.operationEpoch) this.mode = "repair";
    }
  }

  async search(value: string): Promise<void> {
    this.query = value;
    const epoch = ++this.operationEpoch;
    this.selected = null;
    this.mode = "loading";
    await this.refreshCandidates(epoch).catch(() => {
      if (epoch === this.operationEpoch) this.mode = "repair";
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
    this.selected = candidate;
    this.pendingMismatch = null;
    this.pendingProtected = null;
    this.statusMessage = "";
    this.changeDetector.markForCheck();
  }

  onListKeydown(event: KeyboardEvent): void {
    if (!this.candidates.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.highlightedIndex = (this.highlightedIndex + 1) % this.candidates.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.highlightedIndex = (this.highlightedIndex - 1 + this.candidates.length) % this.candidates.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.selectIndex(this.highlightedIndex);
    }
  }

  async perform(action: SecretAction, field: AutoFillSecretField, mismatchConfirmed = false): Promise<void> {
    const selected = this.selected;
    const session = this.agentSession;
    if (!selected || !session || this.mode === "repair") return;
    if (selected.requiresMismatchConfirmation && !mismatchConfirmed) {
      this.pendingMismatch = { action, field };
      return;
    }
    this.pendingMismatch = null;
    this.statusMessage = "";
    try {
      const response = await this.candidatesService.query(this.queryRequest(field));
      const current = response.candidates.find((candidate) => candidate.cipherId === selected.cipherId);
      if (!current) {
        this.statusMessage = "This field is not available for the selected login.";
        return;
      }
      const state = this.store.snapshot();
      const localLogin = state.vaultOwnerAccountId === session.accountId
        ? state.items.find((item) => item.type === "login" && item.id === current.cipherId)
        : undefined;
      if (!localLogin) {
        this.mode = "repair";
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
        if (receipt.status !== "pending") {
          this.mode = "repair";
          return;
        }
        this.pendingProtected = { action, scope, mismatchConfirmed, receipt: receipt.receipt };
        return;
      }
      await this.releaseAndDeliver(action, scope, mismatchConfirmed);
    } catch {
      this.statusMessage = "AutoFill could not complete this field action.";
    }
  }

  async confirmMismatch(): Promise<void> {
    const pending = this.pendingMismatch;
    if (!pending) return;
    this.pendingMismatch = null;
    await this.perform(pending.action, pending.field, true);
  }

  async verifyWithTouchId(): Promise<void> {
    const pending = this.pendingProtected;
    if (!pending) return;
    this.pendingProtected = null;
    const outcome = await this.native.biometricReprompt(pending.scope.accountId, pending.receipt)
      .catch(() => "failed" as const);
    if (outcome !== "success") {
      this.statusMessage = outcome === "cancelled"
        ? "Touch ID verification was cancelled."
        : "Touch ID verification failed.";
      return;
    }
    await this.releaseAndDeliver(
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
  }

  async verifyWithMasterPassword(event: Event): Promise<void> {
    event.preventDefault();
    const pending = this.pendingProtected;
    if (!pending || !this.masterPasswordMode || !this.masterPassword) return;
    const password = this.masterPassword;
    const epoch = this.store.beginProtectedOperation();
    let verified = false;
    try {
      verified = await this.reprompt.verify(password, epoch, pending.receipt);
    } catch {
      this.statusMessage = "Master password verification failed.";
    } finally {
      this.masterPassword = "";
    }
    if (!verified || !this.store.isCurrentProtectedOperation(epoch)) return;
    this.pendingProtected = null;
    this.masterPasswordMode = false;
    await this.releaseAndDeliver(
        pending.action,
        pending.scope,
        pending.mismatchConfirmed,
        pending.receipt,
    );
  }

  async useProjectedAccount(): Promise<void> {
    const session = this.agentSession;
    if (!session) return;
    this.mode = "loading";
    try {
      await this.auth.switchAccount(session.accountId);
      await this.initialize();
    } catch {
      this.mode = "account-override";
      this.statusMessage = "Unable to switch accounts.";
    }
  }

  unlock(): void {
    void this.router.navigateByUrl("/lock", { replaceUrl: true });
  }

  backToVault(): void {
    void this.router.navigateByUrl("/tabs/vault", { replaceUrl: true });
  }

  inputValue(event: Event): string {
    return event.target instanceof HTMLInputElement ? event.target.value : "";
  }

  private async refreshCandidates(epoch: number): Promise<void> {
    if (!this.agentSession) throw new Error("Agent unavailable");
    const results = await Promise.all(FIELD_ORDER.map((field) =>
      this.candidatesService.query(this.queryRequest(field)),
    ));
    if (epoch !== this.operationEpoch) return;
    const candidates = new Map<string, RankedAutoFillCandidate>();
    for (const result of results) {
      for (const candidate of result.candidates) {
        const existing = candidates.get(candidate.cipherId);
        if (!existing || GROUP_ORDER.indexOf(candidate.group) < GROUP_ORDER.indexOf(existing.group)) {
          candidates.set(candidate.cipherId, candidate);
        }
      }
    }
    this.candidates = [...candidates.values()].sort((left, right) =>
      GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group),
    );
    this.highlightedIndex = 0;
    this.mode = this.candidates.length ? "ready" : "empty";
    this.changeDetector.markForCheck();
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
    action: SecretAction,
    scope: AutoFillRepromptScope,
    mismatchConfirmed: boolean,
    repromptReceipt?: string,
  ): Promise<void> {
    let value = "";
    try {
      const released = await this.native.releaseSecret({
        scope,
        mismatchConfirmed,
        ...(repromptReceipt ? { repromptReceipt } : {}),
      });
      if (released.status !== "success" || released.field !== scope.field) {
        this.statusMessage = "AutoFill could not release this field.";
        return;
      }
      value = released.value;
      if (action === "copy") {
        await this.native.copyText(value, 30);
        this.statusMessage = "Copied.";
      } else {
        try {
          await this.native.pasteText(value, 30);
          this.statusMessage = "Filled.";
        } catch (error) {
          this.statusMessage = error instanceof PasteError && error.valueCopied
            ? "Copied. Paste into the target app manually."
            : "AutoFill could not paste this field.";
        }
      }
    } finally {
      value = "";
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
}
