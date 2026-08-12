import { DialogModule as CdkDialogModule } from "@angular/cdk/dialog";
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Injector,
  OnDestroy,
  Optional,
  ViewChild,
} from "@angular/core";
import { Router } from "@angular/router";

import type { AutoFillSecretField } from "../autofill/autofill-candidate.service";
import { AutoFillBindingsService } from "../autofill/autofill-bindings.service";
import {
  AutoFillFillActionService,
  type AutoFillActionOutcome,
  type PreparedAutoFillAction,
} from "../autofill/autofill-fill-action.service";
import { AutoFillFieldActionService } from "../autofill/autofill-field-action.service";
import type { ContextualCandidate } from "../autofill/autofill-fill-context.model";
import {
  AutoFillVaultContextService,
  type AutoFillVaultContextState,
} from "../autofill/autofill-vault-context.service";
import { AppBottomSheetComponent } from "../official-ui/app-bottom-sheet.component";
import {
  ButtonComponent,
  DialogComponent,
  DialogFooterDirective,
  ItemActionComponent,
  ItemComponent,
  ItemContentComponent,
  ItemGroupComponent,
} from "../official-ui/official-components";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import type { VaultItem } from "../vault-demo";
import { VaultItemIconComponent } from "./vault-item-icon.component";
import { VaultDisclosureGroupComponent } from "./vault-disclosure-group.component";
import { VaultRepromptDialogComponent } from "./vault-reprompt-dialog.component";

type ReadyAction = Extract<PreparedAutoFillAction, { readonly status: "ready" }>;
type PendingMismatch =
  | { readonly kind: "fill"; readonly candidate: ContextualCandidate; readonly item: VaultItem; readonly action: ReadyAction }
  | { readonly kind: "field"; readonly candidate: ContextualCandidate; readonly item: VaultItem; readonly field: AutoFillSecretField; readonly trigger?: HTMLElement };

const FIELD_ORDER: readonly AutoFillSecretField[] = ["username", "password", "totp"];
const CONTEXTUAL_OTHER_REASONS = new Set([
  "application_name",
  "application_name_similar",
  "fuzzy_name",
]);
@Component({
  selector: "bw-vault-autofill-suggestions",
  standalone: true,
  imports: [
    AppBottomSheetComponent,
    ButtonComponent,
    CdkDialogModule,
    DialogComponent,
    DialogFooterDirective,
    ItemActionComponent,
    ItemComponent,
    ItemContentComponent,
    ItemGroupComponent,
    VaultDisclosureGroupComponent,
    VaultItemIconComponent,
    VaultRepromptDialogComponent,
  ],
  template: `
    @if (visibleCandidates.length) {
      <bw-vault-disclosure-group
        class="vault-autofill-suggestions"
        groupId="autofill-suggestions"
        [title]="suggestionTitle"
        [count]="visibleCandidates.length"
        [open]="suggestionsOpen"
        [rendered]="suggestionsRendered"
        testId="vault-autofill-suggestions"
        (openChange)="setSuggestionsOpen($event)"
      >
        <div class="vault-hierarchy__items">
          <span class="tw-sr-only" role="status" aria-live="polite">
            {{ suggestionCountLabel }}
          </span>
          <bit-item-group data-testid="vault-autofill-suggestion-group">
          @for (candidate of visibleCandidates; track candidate.cipherId) {
            @if (itemForCandidate(candidate); as item) {
              <bit-item
                class="vault-list-row tw-group/vault-autofill-item"
                data-testid="vault-autofill-candidate"
                [attr.data-cipher-id]="candidate.cipherId"
              >
                <button
                  bit-item-content
                  class="tw-h-[52px] tw-min-w-0"
                  data-testid="vault-autofill-open-details"
                  type="button"
                  [attr.aria-label]="viewDetailsLabel(candidate)"
                  (click)="openDetails(candidate)"
                >
                  <span slot="start" class="tw-justify-start tw-w-7 tw-flex item-icon">
                    <bw-vault-item-icon [item]="item" />
                  </span>
                  <span
                    class="tw-block tw-min-w-0 tw-truncate"
                    data-testid="vault-autofill-candidate-name"
                  >
                    {{ candidate.displayName }}
                  </span>
                  @if (candidate.username) {
                    <span
                      slot="secondary"
                      class="tw-block tw-min-w-0 tw-truncate"
                      data-testid="vault-autofill-candidate-subtitle"
                    >
                      {{ candidate.username }}
                    </span>
                  }
                </button>

                <ng-container slot="end">
                  <bit-item-action>
                    <span class="vault-autofill-suggestions__capabilities tw-inline-flex tw-items-center tw-gap-1">
                      @for (field of capabilityFields(candidate); track field) {
                        <button
                          class="vault-autofill-suggestions__field-action"
                          data-testid="vault-autofill-field-action"
                          type="button"
                          [attr.data-field]="field"
                          [attr.aria-label]="fieldActionLabel(candidate, field)"
                          [disabled]="busyCipherId === candidate.cipherId"
                          (click)="requestFieldAction(candidate, field, $event)"
                        >
                          <i
                            class="bwi"
                            [class.bwi-user]="field === 'username'"
                            [class.bwi-key]="field === 'password'"
                            [class.bwi-clock]="field === 'totp'"
                          ></i>
                        </button>
                      }
                    </span>
                    <span
                      class="tw-sr-only"
                      data-testid="vault-autofill-capability-summary"
                    >
                      {{ capabilitySummary(candidate) }}
                    </span>
                  </bit-item-action>
                  @if (hasPrimaryFill) {
                    <bit-item-action>
                      <button
                        bitButton
                        buttonType="primaryOutline"
                        size="small"
                        class="vault-autofill-suggestions__fill"
                        data-testid="vault-autofill-fill"
                        type="button"
                        [disabled]="busyCipherId === candidate.cipherId"
                        [attr.aria-label]="fillLabel(candidate)"
                        (click)="requestFill(candidate, $event)"
                      >
                        {{ fillText }}
                      </button>
                    </bit-item-action>
                  }
                </ng-container>
              </bit-item>
            }
          }
          </bit-item-group>
        </div>
      </bw-vault-disclosure-group>
    }

    @if (visibleCandidates.length) {
      <bw-app-bottom-sheet
        #mismatchDialog
        testId="vault-autofill-mismatch"
        labelledBy="vault-autofill-mismatch-title"
        describedBy="vault-autofill-mismatch-description"
        (dismissed)="cancelMismatch()"
      >
        <form bit-dialog dialogSize="small" (submit)="confirmMismatch($event)">
          <span bitDialogTitle id="vault-autofill-mismatch-title">{{ mismatchTitle }}</span>
          <ng-container bitDialogContent>
            <p id="vault-autofill-mismatch-description">{{ mismatchDescription }}</p>
          </ng-container>
          <ng-container bitDialogFooter>
            <button bitButton buttonType="primary" data-testid="vault-autofill-confirm-mismatch" type="submit">
              {{ fillAnywayText }}
            </button>
            <button bitButton buttonType="secondary" type="button" (click)="cancelMismatch()">
              {{ cancelText }}
            </button>
          </ng-container>
        </form>
      </bw-app-bottom-sheet>
      <bw-vault-reprompt-dialog />
    }
  `,
  styleUrl: "./vault-autofill-suggestions.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultAutoFillSuggestionsComponent implements OnDestroy {
  @ViewChild("mismatchDialog") private mismatchDialog?: AppBottomSheetComponent;
  @ViewChild(VaultRepromptDialogComponent) private repromptDialog?: VaultRepromptDialogComponent;

  readonly suggestionTitle = translateOfficialMessage("i18nAutofillSuggestions");
  readonly fillText = translateOfficialMessage("i18nAutofillFill");
  readonly mismatchTitle = translateOfficialMessage("i18nAutofillConfirmMatch");
  readonly mismatchDescription = translateOfficialMessage("i18nAutofillMismatchDescription");
  readonly fillAnywayText = translateOfficialMessage("i18nAutofillFillAnyway");
  readonly cancelText = translateOfficialMessage("cancel");
  busyCipherId = "";
  suggestionsOpen = true;
  suggestionsRendered = true;

  private readonly unsubscribe: () => void;
  private readonly fillActions: AutoFillFillActionService | null;
  private readonly fieldActions: AutoFillFieldActionService | null;
  private activeAction: ReadyAction | null = null;
  private pendingMismatch: PendingMismatch | null = null;
  private operationEpoch = 0;

  constructor(
    @Optional() private readonly context: AutoFillVaultContextService | null,
    injector: Injector,
    private readonly store: PopupStateStore,
    private readonly router: Router,
    private readonly bindings: AutoFillBindingsService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {
    this.fillActions = this.context
      ? injector.get(AutoFillFillActionService, null)
      : null;
    this.fieldActions = this.context
      ? injector.get(AutoFillFieldActionService, null)
      : null;
    this.unsubscribe = this.context?.subscribe(() => {
      this.operationEpoch += 1;
      this.cancelActiveAction();
      this.pendingMismatch = null;
      this.busyCipherId = "";
      this.changeDetectorRef.markForCheck();
    }) ?? (() => undefined);
  }

  get visibleCandidates(): readonly ContextualCandidate[] {
    const state = this.context?.snapshot();
    if (!state) return Object.freeze([]);
    if (state.status !== "ready") return Object.freeze([]);
    return Object.freeze(state.candidates
      .filter((candidate) => this.isEligible(candidate, state))
      .slice(0, 5));
  }

  get suggestionCountLabel(): string {
    return translateOfficialMessage("i18nAutofillSuggestionCount", String(this.visibleCandidates.length));
  }

  get hasPrimaryFill(): boolean {
    return this.context?.snapshot().status === "ready"
      && this.context.snapshot().context !== null;
  }

  capabilityFields(candidate: ContextualCandidate): readonly AutoFillSecretField[] {
    return FIELD_ORDER.filter((field) => candidate.availableFields.includes(field));
  }

  capabilitySummary(candidate: ContextualCandidate): string {
    return this.capabilityFields(candidate).map(fieldLabel).join("、");
  }

  itemForCandidate(candidate: ContextualCandidate): VaultItem | null {
    const state = this.context?.snapshot();
    return state?.status === "ready"
      ? this.localLogin(candidate.cipherId, state.session.accountId)
      : null;
  }

  setSuggestionsOpen(open: boolean): void {
    this.suggestionsOpen = open;
    if (open) this.suggestionsRendered = true;
  }

  fillLabel(candidate: ContextualCandidate): string {
    return translateOfficialMessage("i18nAutofillSuggestionFill", candidate.displayName);
  }

  fieldActionLabel(candidate: ContextualCandidate, field: AutoFillSecretField): string {
    return translateOfficialMessage("i18nAutofillFillCandidate", fieldLabel(field), candidate.displayName);
  }

  viewDetailsLabel(candidate: ContextualCandidate): string {
    return translateOfficialMessage("i18nAutofillViewDetails", candidate.displayName);
  }

  openDetails(candidate: ContextualCandidate): void {
    if (!this.context?.select(candidate.cipherId)) return;
    void this.router.navigateByUrl(`/view-cipher/${encodeURIComponent(candidate.cipherId)}`);
  }

  requestFill(candidate: ContextualCandidate, event: Event): void {
    event.stopPropagation();
    void this.fill(candidate, event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined);
  }

  requestFieldAction(candidate: ContextualCandidate, field: AutoFillSecretField, event: Event): void {
    event.stopPropagation();
    const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    void this.executeFieldAction(candidate, field, false, false, undefined, trigger, ++this.operationEpoch);
  }

  confirmMismatch(event: Event): void {
    event.preventDefault();
    const pending = this.pendingMismatch;
    this.pendingMismatch = null;
    this.mismatchDialog?.close();
    if (pending?.kind === "fill") {
      void this.execute(pending.candidate, pending.item, pending.action, true);
    } else if (pending?.kind === "field") {
      void this.executeFieldAction(
        pending.candidate,
        pending.field,
        true,
        false,
        undefined,
        pending.trigger,
        ++this.operationEpoch,
      );
    }
  }

  cancelMismatch(): void {
    const pending = this.pendingMismatch;
    this.pendingMismatch = null;
    this.mismatchDialog?.close();
    if (pending?.kind === "fill") void this.fillActions?.cancel(pending.action);
    if (pending?.kind === "fill" && this.activeAction === pending.action) this.activeAction = null;
    this.busyCipherId = "";
    this.changeDetectorRef.markForCheck();
  }

  ngOnDestroy(): void {
    this.operationEpoch += 1;
    this.unsubscribe();
    this.cancelActiveAction();
  }

  private async fill(candidate: ContextualCandidate, trigger?: HTMLElement): Promise<void> {
    const state = this.context?.snapshot();
    const selected = this.context?.select(candidate.cipherId);
    if (!state || state.status !== "ready" || state.context === null || !selected || !this.fillActions) return;
    const item = this.localLogin(candidate.cipherId, state.session.accountId);
    if (!item) return;
    const action = this.fillActions.prepare(state.context, state.session, candidate);
    if (action.status !== "ready") {
      this.store.setStatus(translateOfficialMessage(action.status === "choose"
        ? "i18nAutofillNoConfidentField"
        : "i18nAutofillActionUnavailable"));
      return;
    }
    this.cancelActiveAction();
    this.activeAction = action;
    this.busyCipherId = candidate.cipherId;
    const epoch = ++this.operationEpoch;
    this.changeDetectorRef.markForCheck();
    await this.execute(candidate, item, action, false, trigger, false, epoch);
  }

  private async executeFieldAction(
    candidate: ContextualCandidate,
    field: AutoFillSecretField,
    mismatchConfirmed: boolean,
    repromptVerified: boolean,
    repromptReceipt?: string,
    trigger?: HTMLElement,
    epoch = this.operationEpoch,
  ): Promise<void> {
    const state = this.context?.snapshot();
    if (!state || state.status !== "ready" || !this.fieldActions || !this.context?.select(candidate.cipherId)) return;
    const item = this.localLogin(candidate.cipherId, state.session.accountId);
    if (!item || !secretExists(item, field)) return;
    this.busyCipherId = candidate.cipherId;
    const outcome = await this.fieldActions.execute(
      { application: state.application, fillContext: state.context },
      state.session,
      candidate,
      field,
      {
        mismatchConfirmed,
        requiresReprompt: Boolean(item.reprompt),
        ...(repromptVerified ? { repromptVerified: true } : {}),
        ...(repromptReceipt ? { repromptReceipt } : {}),
      },
    );
    if (epoch !== this.operationEpoch) {
      if (outcome.status === "reprompt-required") {
        await this.fieldActions.cancel(outcome.scope, outcome.receipt);
      }
      return;
    }
    this.busyCipherId = "";
    if (outcome.status === "filled") {
      this.store.setStatus(translateOfficialMessage("i18nAutofillFilled"));
      this.context.invalidate("cancel");
    } else if (outcome.status === "copied") {
      this.store.setStatus(translateOfficialMessage("i18nAutofillCopied"));
    } else if (outcome.status === "confirmation-required") {
      this.pendingMismatch = { kind: "field", candidate, item, field, ...(trigger ? { trigger } : {}) };
      this.mismatchDialog?.open(trigger);
    } else if (outcome.status === "reprompt-required") {
      this.repromptDialog?.openFor(
        item.id,
        () => this.executeFieldAction(
          candidate,
          field,
          mismatchConfirmed,
          true,
          outcome.receipt,
          trigger,
          epoch,
        ),
        trigger,
        outcome.receipt,
        () => this.fieldActions?.cancel(outcome.scope, outcome.receipt),
      );
    } else {
      this.store.setStatus(translateOfficialMessage("i18nAutofillActionUnavailable"));
    }
    this.changeDetectorRef.markForCheck();
  }

  private async execute(
    candidate: ContextualCandidate,
    item: VaultItem,
    action: ReadyAction,
    mismatchConfirmed: boolean,
    trigger?: HTMLElement,
    repromptVerified = false,
    epoch = this.operationEpoch,
  ): Promise<void> {
    if (!this.fillActions) return;
    const outcome = await this.fillActions.execute(action, {
      mismatchConfirmed,
      requiresReprompt: Boolean(item.reprompt),
      ...(repromptVerified ? { repromptVerified: true } : {}),
    });
    if (epoch !== this.operationEpoch || this.activeAction !== action) return;
    if (outcome.status === "confirmation-required") {
      this.pendingMismatch = { kind: "fill", candidate, item, action };
      this.busyCipherId = "";
      this.mismatchDialog?.open(trigger);
      this.changeDetectorRef.markForCheck();
      return;
    }
    if (outcome.status === "reprompt-required") {
      this.busyCipherId = "";
      this.repromptDialog?.openFor(
        item.id,
        () => this.execute(candidate, item, action, mismatchConfirmed, trigger, true, epoch),
        trigger,
        outcome.receipt,
        () => this.cancelAction(action),
      );
      this.changeDetectorRef.markForCheck();
      return;
    }
    this.finish(candidate, action, outcome);
  }

  private finish(candidate: ContextualCandidate, action: ReadyAction, outcome: AutoFillActionOutcome): void {
    if (this.activeAction !== action) return;
    this.activeAction = null;
    this.busyCipherId = "";
    if (outcome.status === "success") {
      this.store.setStatus(translateOfficialMessage("i18nAutofillFilled"));
      this.bindings.bind(action.session.accountId, action.context.bundleId, candidate.cipherId);
      this.bindings.recordSuccessfulSelection({
        accountId: action.session.accountId,
        bundleId: action.context.bundleId,
        serviceIdentifiers: [],
        cipherId: candidate.cipherId,
        selectedAt: new Date().toISOString(),
        explicitUserAction: true,
        succeeded: true,
      });
      this.context?.invalidate("cancel");
    } else if (outcome.status === "partial") {
      this.store.setStatus(translateOfficialMessage(
        "i18nAutofillPartial",
        outcome.filled.map(fieldLabel).join("、") || translateOfficialMessage("i18nAutofillNoFields"),
        fieldLabel(outcome.failed),
      ));
    } else if (outcome.status !== "unavailable" || outcome.reason !== "action-in-progress") {
      this.store.setStatus(translateOfficialMessage("i18nAutofillActionUnavailable"));
    }
    this.changeDetectorRef.markForCheck();
  }

  private cancelAction(action: ReadyAction): void {
    if (this.activeAction === action) this.activeAction = null;
    this.busyCipherId = "";
    void this.fillActions?.cancel(action);
    this.changeDetectorRef.markForCheck();
  }

  private cancelActiveAction(): void {
    const action = this.activeAction;
    this.activeAction = null;
    if (action) void this.fillActions?.cancel(action);
  }

  private isEligible(candidate: ContextualCandidate, state: Extract<AutoFillVaultContextState, { status: "ready" }>): boolean {
    if (candidate.group === "other" && !CONTEXTUAL_OTHER_REASONS.has(candidate.reason)) return false;
    const item = this.localLogin(candidate.cipherId, state.session.accountId);
    if (!item) return false;
    const fields = candidate.availableFields.filter((field) => secretExists(item, field));
    return fields.length > 0;
  }

  private localLogin(cipherId: string, accountId: string): VaultItem | null {
    const state = this.store.snapshot();
    if (state.vaultOwnerAccountId !== accountId) return null;
    return state.items.find((item) => item.id === cipherId && item.type === "login") ?? null;
  }
}

function secretExists(item: VaultItem, field: AutoFillSecretField): boolean {
  const fieldId = field === "totp" ? "otp" : field;
  return item.fields.some((value) => value.id === fieldId && value.value.length > 0);
}

function fieldLabel(field: AutoFillSecretField): string {
  return translateOfficialMessage({
    username: "i18nAutofillFieldUsername",
    password: "i18nAutofillFieldPassword",
    totp: "i18nAutofillFieldTotp",
  }[field]);
}
