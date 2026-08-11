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
  SectionComponent,
  SectionHeaderComponent,
  TypographyDirective,
} from "../official-ui/official-components";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { PopupStateStore } from "../popup-state";
import type { VaultItem } from "../vault-demo";
import { VaultItemIconComponent } from "./vault-item-icon.component";
import { VaultRepromptDialogComponent } from "./vault-reprompt-dialog.component";

type ReadyAction = Extract<PreparedAutoFillAction, { readonly status: "ready" }>;

const FIELD_ORDER: readonly AutoFillSecretField[] = ["username", "password", "totp"];
const CONTEXTUAL_OTHER_REASONS = new Set([
  "application_name",
  "application_name_similar",
  "fuzzy_name",
]);
const REASON_LABELS: Readonly<Record<string, string>> = {
  user_binding: "i18nAutofillReasonBinding",
  service_identifier: "i18nAutofillReasonService",
  app_preset: "i18nAutofillReasonPreset",
  vault_uri_rule: "i18nAutofillReasonUriRule",
  host_or_domain: "i18nAutofillReasonDomain",
  application_name: "i18nAutofillReasonApplicationName",
  application_name_similar: "i18nAutofillReasonApplicationNameSimilar",
  fuzzy_name: "i18nAutofillReasonSimilar",
};

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
    SectionComponent,
    SectionHeaderComponent,
    TypographyDirective,
    VaultItemIconComponent,
    VaultRepromptDialogComponent,
  ],
  template: `
    @if (visibleCandidates.length) {
      <bit-section
        class="vault-autofill-suggestions tw-block tw-bg-background-alt tw-px-3 tw-pt-2 tw-pb-3"
        data-testid="vault-autofill-suggestions"
        aria-labelledby="vault-autofill-suggestions-title"
      >
        <div class="tw-pl-1 tw-mb-0.5">
          <bit-section-header class="tw-p-0.5 -tw-mx-0.5">
            <h2 id="vault-autofill-suggestions-title" bitTypography="h6">
              {{ suggestionTitle }}
            </h2>
            <span slot="end" bitTypography="body2" aria-hidden="true">
              {{ visibleCandidates.length }}
            </span>
          </bit-section-header>
          <span class="tw-sr-only" role="status" aria-live="polite">
            {{ suggestionCountLabel }}
          </span>
        </div>

        <bit-item-group data-testid="vault-autofill-suggestion-group">
          @for (candidate of visibleCandidates; track candidate.cipherId) {
            @if (itemForCandidate(candidate); as item) {
              <bit-item
                class="tw-group/vault-autofill-item"
                data-testid="vault-autofill-candidate"
                [attr.data-cipher-id]="candidate.cipherId"
              >
                <button
                  bit-item-content
                  class="tw-h-[59px] tw-min-w-0"
                  data-testid="vault-autofill-open-details"
                  type="button"
                  [attr.aria-label]="viewDetailsLabel(candidate)"
                  (click)="openDetails(candidate)"
                >
                  <span slot="start" class="tw-justify-start tw-w-7 tw-flex item-icon">
                    <bw-vault-item-icon [item]="item" />
                  </span>
                  <span
                    class="tw-block tw-min-w-0 tw-truncate tw-font-semibold"
                    data-testid="vault-autofill-candidate-name"
                  >
                    {{ candidate.displayName }}
                  </span>
                  <span
                    slot="secondary"
                    class="tw-block tw-min-w-0 tw-truncate"
                    data-testid="vault-autofill-candidate-subtitle"
                  >
                    {{ candidate.username }} · {{ reasonLabel(candidate.reason) }}
                  </span>
                </button>

                <ng-container slot="end">
                  <bit-item-action>
                    <span
                      class="vault-autofill-suggestions__capabilities tw-inline-flex tw-items-center tw-gap-2 tw-text-muted"
                      aria-hidden="true"
                    >
                      @for (field of capabilityFields(candidate); track field) {
                        <i
                          class="bwi"
                          [class.bwi-user]="field === 'username'"
                          [class.bwi-key]="field === 'password'"
                          [class.bwi-clock]="field === 'totp'"
                        ></i>
                      }
                    </span>
                    <span
                      class="tw-sr-only"
                      data-testid="vault-autofill-capability-summary"
                    >
                      {{ capabilitySummary(candidate) }}
                    </span>
                  </bit-item-action>
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
                </ng-container>
              </bit-item>
            }
          }
        </bit-item-group>
      </bit-section>
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

  private readonly unsubscribe: () => void;
  private readonly fillActions: AutoFillFillActionService | null;
  private activeAction: ReadyAction | null = null;
  private pendingMismatch: { readonly candidate: ContextualCandidate; readonly item: VaultItem; readonly action: ReadyAction } | null = null;
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

  reasonLabel(reason: string): string {
    return translateOfficialMessage(REASON_LABELS[reason] ?? "i18nAutofillReasonOther");
  }

  fillLabel(candidate: ContextualCandidate): string {
    return translateOfficialMessage("i18nAutofillSuggestionFill", candidate.displayName);
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

  confirmMismatch(event: Event): void {
    event.preventDefault();
    const pending = this.pendingMismatch;
    this.pendingMismatch = null;
    this.mismatchDialog?.close();
    if (pending) void this.execute(pending.candidate, pending.item, pending.action, true);
  }

  cancelMismatch(): void {
    const pending = this.pendingMismatch;
    this.pendingMismatch = null;
    this.mismatchDialog?.close();
    if (pending) void this.fillActions?.cancel(pending.action);
    if (this.activeAction === pending?.action) this.activeAction = null;
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
    if (!state || state.status !== "ready" || !selected || !this.fillActions) return;
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
      this.pendingMismatch = { candidate, item, action };
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
    const fields = state.context.action.mode === "choose"
      ? candidate.availableFields
      : state.context.action.fields;
    return fields.length > 0 && fields.every((field) => (
      candidate.availableFields.includes(field) && secretExists(item, field)
    ));
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
