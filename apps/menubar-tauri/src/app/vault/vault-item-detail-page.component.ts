import {
  ChangeDetectorRef,
  Component,
  Inject,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Optional,
  SimpleChanges,
  ViewChild,
} from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import type { Subscription } from "rxjs";

import { TauriHostService } from "../../host/tauri-host.service";
import { resolveWindowLayoutMode } from "../../window-layout-mode";
import type { AutoFillSecretField } from "../autofill/autofill-candidate.service";
import { AutoFillContextSessionService } from "../autofill/autofill-context-session.service";
import {
  AutoFillFillActionService,
  type AutoFillActionOutcome,
  type PreparedAutoFillAction,
} from "../autofill/autofill-fill-action.service";
import {
  contextsEqual,
  decodeLiveAutoFillContext,
  projectAutoFillAgentSession,
  type ContextualCandidate,
} from "../autofill/autofill-fill-context.model";
import {
  AUTOFILL_NATIVE_HOST,
  type AutoFillAgentSession,
  type AutoFillNativeHost,
} from "../autofill/autofill-native.host";
import { PopupFooterComponent } from "../layout/popup-footer.component";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { AppBottomSheetComponent } from "../official-ui/app-bottom-sheet.component";
import { AppFeedbackService } from "../official-ui/app-feedback.service";
import {
  claimCapturedLocalCopyFeedback,
  completeLocalCopyFeedback,
} from "../official-ui/local-copy-feedback-event";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";
import { PopupStateStore } from "../popup-state";
import { POP_OUT_HOST, type PopOutHost } from "../popup-header-actions.component";
import type { VaultField, VaultItem } from "../vault-demo";
import { OfficialLoginDetailComponent } from "../upstream-overlays/cipher-detail/official-login-detail.component";
import type {
  LoginContextualFillPresentation,
  LoginRevealRequest,
} from "../upstream-overlays/cipher-detail/official-login-credentials.component";
import { OfficialPersonalCipherDetailComponent } from "../upstream-overlays/cipher-detail/official-personal-cipher-detail.component";
import {
  BitFormFieldComponent,
  BitIconButtonComponent,
  BitInputDirective,
  BitLabelComponent,
  BitSuffixDirective,
  ButtonComponent,
  CardComponent,
  ChipActionComponent,
  DialogComponent,
  DialogFooterDirective,
  SectionComponent,
  SectionHeaderComponent,
  TypographyDirective,
} from "../official-ui/official-components";
import { VaultActionsService } from "./vault-actions.service";
import { VaultDetailActionsAdapter, type DetailAction } from "./vault-detail-actions.adapter";
import {
  projectLoginDetail,
  type OfficialLoginDetailProjection,
} from "./login-cipher-view.adapter";
import {
  projectPersonalCipherDetail,
  type OfficialPersonalCipherProjection,
} from "./personal-cipher-view.adapter";
import { VaultDetailFieldComponent } from "./vault-detail-field.component";
import { VaultDetailSectionComponent } from "./vault-detail-section.component";
import { VaultFacade, type VaultItemLocation } from "./vault.facade";
import { VaultItemIconComponent } from "./vault-item-icon.component";
import { vaultItemTypeLabel } from "./vault-item.model";
import { VaultRepromptDialogComponent } from "./vault-reprompt-dialog.component";

@Component({
  selector: "bw-vault-item-detail-page",
  host: { class: "macos-page macos-page--secondary macos-page--vault-detail" },
  standalone: true,
  imports: [
    BitFormFieldComponent,
    BitIconButtonComponent,
    BitInputDirective,
    BitLabelComponent,
    BitSuffixDirective,
    ButtonComponent,
    CardComponent,
    ChipActionComponent,
    DialogComponent,
    DialogFooterDirective,
    I18nPipe,
    RouterLink,
    PopupFooterComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    SectionComponent,
    SectionHeaderComponent,
    TypographyDirective,
    OfficialLoginDetailComponent,
    OfficialPersonalCipherDetailComponent,
    VaultDetailFieldComponent,
    VaultDetailSectionComponent,
    VaultItemIconComponent,
    VaultRepromptDialogComponent,
    AppBottomSheetComponent,
  ],
  template: `
    <popup-page class="macos-page macos-page--vault-detail">
      <popup-header
        slot="header"
        [pageTitle]="'i18nViewItemType' | i18n: typeLabel"
        showBackButton
        [backAction]="backAction"
      >
        @if (isArchived) {
          <button bit-chip-action type="button" [label]="'i18nArchived' | i18n"></button>
        }
        <button slot="end" bitIconButton="bwi-popout" type="button" [label]="'i18nPopOut' | i18n" (click)="popOut()"></button>
      </popup-header>

      @if (item) {
        <div class="cipher-view">
          @if (item.type === 'login' && loginProjection; as projection) {
            <bw-official-login-detail
              [projection]="projection"
              [canFill]="canFillCurrentItem"
              [contextualFillAction]="contextualFillAction"
              [contextualFillFields]="contextualFillAction?.fields"
              [contextualFillBusy]="contextualFillBusy"
              [revealedFieldIds]="revealedFields"
              (copyField)="copy($event)"
              (fillField)="fill($event)"
              (contextualFill)="requestContextualFill($event)"
              (launchUri)="launchUri($event)"
              (toggleReveal)="toggleReveal($event)"
              (viewPasswordHistory)="openPasswordHistory()"
            />
          } @else if (personalProjection; as projection) {
            <bw-official-personal-cipher-detail
              [projection]="projection"
              [canFill]="canFillCurrentItem"
              [revealedFieldIds]="revealedFields"
              (copyField)="copy($event)"
              (fillField)="fill($event)"
              (toggleReveal)="toggleReveal($event)"
              (viewPasswordHistory)="openPasswordHistory()"
            />
          }
        </div>
      } @else {
        <p class="empty-inline">{{ "i18nItemNotFound" | i18n }}</p>
      }

      <popup-footer slot="footer">
        @if (item) {
          @if (!isDeleted) {
            <a bitButton buttonType="primary" routerLink="/edit-cipher" [queryParams]="cipherQueryParams">{{ "i18nEdit" | i18n }}</a>
          } @else {
            <button bitButton buttonType="primary" type="button" [attr.aria-label]="'i18nRestore' | i18n" (click)="restore()">{{ "i18nRestore" | i18n }}</button>
          }
          <span slot="end" class="official-popup-footer-end">
            @if (isArchived) {
              <button bitIconButton="bwi-unarchive" type="button" [label]="'i18nUnarchive' | i18n" (click)="unarchive()"></button>
            } @else if (!isDeleted) {
              <button bitIconButton="bwi-archive" type="button" [label]="'archive' | i18n" (click)="requestArchive($event)"></button>
            }
            <button
              bitIconButton="bwi-trash"
              buttonType="dangerGhost"
              type="button"
              [label]="isDeleted ? ('i18nPermanentDelete' | i18n) : ('i18nDelete' | i18n)"
              (click)="requestDelete($event)"
            ></button>
          </span>
        }
      </popup-footer>
      <bw-app-bottom-sheet
        #confirmationDialog
        testId="vault-detail-confirmation"
        labelledBy="vault-detail-confirmation-title"
        (dismissed)="dismissPendingAction()"
      >
        <form bit-dialog dialogSize="small" (submit)="confirmPendingAction($event)">
          <span bitDialogTitle id="vault-detail-confirmation-title">{{ confirmationActionLabel }}</span>
          <ng-container bitDialogContent>
            <p>{{ confirmationText }}</p>
          </ng-container>
          <ng-container bitDialogFooter>
            <button
              bitButton
              [buttonType]="isDestructivePendingAction ? 'danger' : 'primary'"
              type="submit"
              [class.danger-action]="isDestructivePendingAction"
              [attr.aria-label]="confirmationActionLabel"
            >
              {{ confirmationActionButtonText }}
            </button>
            <button bitButton buttonType="secondary" type="button" (click)="cancelPendingAction()">{{ "cancel" | i18n }}</button>
          </ng-container>
        </form>
      </bw-app-bottom-sheet>
      <bw-vault-reprompt-dialog />
    </popup-page>
  `,
})
export class VaultItemDetailPageComponent implements OnChanges, OnDestroy {
  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () => this.backToVault();
  @ViewChild(VaultRepromptDialogComponent) private repromptDialog?: VaultRepromptDialogComponent;
  @ViewChild("confirmationDialog") private confirmationDialog?: AppBottomSheetComponent;
  @Input("id") itemId = "";
  pendingAction: "archive" | "delete" | "permanent-delete" | "autofill-mismatch" | "" = "";
  private originLocation?: VaultItemLocation;
  private readonly revealedFieldIds = new Set<string>();
  private loginProjectionItem: VaultItem | undefined;
  private loginProjectionValue: OfficialLoginDetailProjection | undefined;
  private personalProjectionItem: VaultItem | undefined;
  private personalProjectionValue: OfficialPersonalCipherProjection | undefined;
  private readonly detailActions: VaultDetailActionsAdapter;
  private readonly stateSubscription: Subscription;
  private detailItemReference: VaultItem | undefined;
  private contextualPresentation?: LoginContextualFillPresentation;
  private preparedContextualAction?: ReadyContextualAction;
  private contextualEpoch = 0;
  private readonly removeContextInvalidationListener: () => void;
  private readonly contextExpiryTimer: number;
  contextualFillBusy = false;

  constructor(
    private readonly store: PopupStateStore,
    private readonly router: Router,
    private readonly vault: VaultFacade,
    private readonly actions: VaultActionsService,
    private readonly changeDetectorRef: ChangeDetectorRef,
    private readonly ngZone: NgZone,
    private readonly feedback: AppFeedbackService,
    private readonly contextSession: AutoFillContextSessionService,
    private readonly fillActions: AutoFillFillActionService,
    @Inject(AUTOFILL_NATIVE_HOST) private readonly autoFillNative: AutoFillNativeHost,
    @Optional() @Inject(POP_OUT_HOST) popOutHost: PopOutHost | null = null,
  ) {
    this.popOutHost = popOutHost ?? new TauriHostService();
    this.detailActions = new VaultDetailActionsAdapter(
      this.store,
      this.router,
      this.actions,
      (itemId, continuation) => this.requestDetailReprompt(itemId, continuation),
      (operation) => this.ngZone.run(operation),
      this.feedback,
    );
    this.removeContextInvalidationListener = this.contextSession.onInvalidate(() => {
      this.contextualEpoch += 1;
      this.contextualPresentation = undefined;
      this.preparedContextualAction = undefined;
      this.contextualFillBusy = false;
      this.changeDetectorRef.markForCheck();
    });
    this.contextExpiryTimer = window.setInterval(() => {
      if (!this.contextSession.snapshot() && this.contextualPresentation) {
        this.contextualPresentation = undefined;
        this.preparedContextualAction = undefined;
        this.contextualFillBusy = false;
        this.changeDetectorRef.markForCheck();
      }
    }, 250);
    this.stateSubscription = this.store.state$.subscribe(() => {
      const nextItem = this.item;
      if (this.detailItemReference && this.detailItemReference !== nextItem) {
        this.revealedFieldIds.clear();
        this.contextSession.targetMismatch();
        this.changeDetectorRef.markForCheck();
      }
      this.detailItemReference = nextItem;
    });
  }

  private readonly popOutHost: PopOutHost;

  get item(): VaultItem | undefined {
    const item = this.vault.itemById(this.itemId);
    return item?.type === "ssh-key" ? undefined : item;
  }

  ngOnChanges(changes: SimpleChanges): void {
    const itemIdChange = changes["itemId"];
    if (itemIdChange) {
      if (!itemIdChange.firstChange && itemIdChange.previousValue !== itemIdChange.currentValue) {
        this.invalidateContextualJourney();
        this.detailActions.invalidate();
        this.repromptDialog?.cancel();
      }
      this.discardPendingAction();
      this.revealedFieldIds.clear();
      this.loginProjectionItem = undefined;
      this.loginProjectionValue = undefined;
      this.personalProjectionItem = undefined;
      this.personalProjectionValue = undefined;
      this.originLocation = this.vault.itemLocation(this.itemId);
      this.detailItemReference = this.item;
      void this.refreshContextualFillAction();
    }
  }

  ngOnDestroy(): void {
    this.stateSubscription.unsubscribe();
    this.removeContextInvalidationListener();
    window.clearInterval(this.contextExpiryTimer);
    this.contextSession.navigationChanged("/");
    this.detailActions.invalidate();
    this.discardPendingAction();
    this.repromptDialog?.cancel();
  }

  async popOut(): Promise<void> {
    this.contextSession.navigationChanged("/");
    await this.popOutHost.popOut(this.router.url);
  }

  async backToVault(): Promise<void> {
    this.contextSession.navigationChanged("/");
    await this.router.navigateByUrl(routeForLocation(this.originLocation ?? this.itemLocation));
  }

  get contextualFillAction(): LoginContextualFillPresentation | undefined {
    return this.contextualPresentation;
  }

  get itemLocation(): VaultItemLocation | undefined {
    return this.vault.itemLocation(this.itemId);
  }

  get isArchived(): boolean {
    return this.itemLocation === "archived";
  }

  get isDeleted(): boolean {
    return this.itemLocation === "deleted";
  }

  get canFillCurrentItem(): boolean {
    return this.itemLocation === "active" && Boolean(this.item?.canFill);
  }

  get loginProjection(): OfficialLoginDetailProjection | undefined {
    const item = this.item;
    if (!item || item.type !== "login") {
      return undefined;
    }
    if (this.loginProjectionItem !== item) {
      this.loginProjectionItem = item;
      this.loginProjectionValue = projectLoginDetail(item);
    }
    return this.loginProjectionValue;
  }

  get personalProjection(): OfficialPersonalCipherProjection | undefined {
    const item = this.item;
    if (!item || !isRetainedPersonalType(item.type)) {
      return undefined;
    }
    if (this.personalProjectionItem !== item) {
      this.personalProjectionItem = item;
      this.personalProjectionValue = projectPersonalCipherDetail(item);
    }
    return this.personalProjectionValue;
  }

  get revealedFields(): ReadonlySet<string> {
    return this.revealedFieldIds;
  }

  get typeLabel(): string {
    return this.item
      ? vaultItemTypeLabel(this.item.type)
      : translateOfficialMessage("i18nItem");
  }

  get fieldsById(): Record<string, VaultField> {
    return Object.fromEntries((this.item?.fields ?? []).map((field) => [field.id, field]));
  }

  get usernameField(): VaultField | undefined {
    return this.fieldsById.username;
  }

  get passwordField(): VaultField | undefined {
    return this.fieldsById.password;
  }

  get otpField(): VaultField | undefined {
    return this.fieldsById.otp;
  }

  get itemIconClass(): string {
    return `bwi ${this.item ? CIPHER_ICON_CLASSES[this.item.type] : "bwi-vault"}`;
  }

  get folderLabel(): string {
    return this.item?.folderName || translateOfficialMessage("i18nNoFolder");
  }

  get hasPasswordHistory(): boolean {
    return (this.item?.passwordHistory?.length ?? 0) > 0;
  }

  get cardVisibleFields(): readonly VaultField[] {
    return ["cardholder-name", "brand", "issuer"]
      .map((fieldId) => this.fieldById(fieldId))
      .filter(isVaultField);
  }

  get cardholderNameField(): VaultField | undefined {
    const value = this.item?.card?.cardholderName ?? this.fieldById("cardholder-name")?.value ?? "";
    return value
      ? { id: "cardholder-name", label: translateOfficialMessage("cardholderName"), value }
      : undefined;
  }

  get cardNumberField(): VaultField | undefined {
    const value = this.item?.card?.number ?? this.fieldById("number")?.value ?? "";
    return value
      ? { id: "number", label: translateOfficialMessage("i18nCardNumber"), value, concealed: true, type: "hidden" }
      : undefined;
  }

  get cardCodeField(): VaultField | undefined {
    const value = this.item?.card?.code ?? this.fieldById("code")?.value ?? "";
    return value
      ? { id: "code", label: translateOfficialMessage("securityCode"), value, concealed: true, type: "hidden" }
      : undefined;
  }

  get cardExpiryField(): VaultField | undefined {
    const expMonth = this.item?.card?.expMonth ?? this.fieldById("exp-month")?.value ?? "";
    const expYear = this.item?.card?.expYear ?? this.fieldById("exp-year")?.value ?? "";
    const fallback = this.fieldById("expires")?.value ?? "";
    const value = [expMonth, expYear].filter(Boolean).join("/") || fallback;
    return value ? { id: "card-expiry", label: translateOfficialMessage("expiration"), value } : undefined;
  }

  get identityNameField(): VaultField | undefined {
    const identity = this.item?.identity;
    const value = [
      identity?.title ?? this.fieldById("title")?.value,
      identity?.firstName ?? this.fieldById("first-name")?.value,
      identity?.middleName ?? this.fieldById("middle-name")?.value,
      identity?.lastName ?? this.fieldById("last-name")?.value,
    ]
      .filter(Boolean)
      .join(" ");
    return value ? { id: "identity-name", label: translateOfficialMessage("name"), value } : undefined;
  }

  get identityUsernameField(): VaultField | undefined {
    return this.identityField("username", translateOfficialMessage("username"), this.item?.identity?.username);
  }

  get identityCompanyField(): VaultField | undefined {
    return this.identityField("company", translateOfficialMessage("company"), this.item?.identity?.company);
  }

  get identitySsnField(): VaultField | undefined {
    return this.identityField("ssn", translateOfficialMessage("ssn"), this.item?.identity?.ssn, true);
  }

  get identityPassportField(): VaultField | undefined {
    return this.identityField(
      "passport-number",
      translateOfficialMessage("passportNumber"),
      this.item?.identity?.passportNumber,
      true,
    );
  }

  get identityLicenseField(): VaultField | undefined {
    return this.identityField(
      "license-number",
      translateOfficialMessage("licenseNumber"),
      this.item?.identity?.licenseNumber,
    );
  }

  get identityEmailField(): VaultField | undefined {
    return this.identityField("email", translateOfficialMessage("email"), this.item?.identity?.email);
  }

  get identityPhoneField(): VaultField | undefined {
    return this.identityField("phone", translateOfficialMessage("phone"), this.item?.identity?.phone);
  }

  get identityAddressField(): VaultField | undefined {
    const identity = this.item?.identity;
    if (!identity) {
      return this.fieldById("address");
    }

    const locality = [identity.city, identity.state].filter(Boolean).join(", ");
    const localityAndPostalCode = [locality, identity.postalCode].filter(Boolean).join(" ");
    const value = [
      identity.address1,
      identity.address2,
      identity.address3,
      localityAndPostalCode,
      identity.country,
    ].filter(Boolean).join("\n");
    return value ? { id: "identity-address", label: translateOfficialMessage("address"), value } : undefined;
  }

  get noteField(): VaultField | undefined {
    const value = this.item?.notes || this.fieldById("notes")?.value || "";
    return value ? { id: "notes", label: translateOfficialMessage("notes"), value } : undefined;
  }

  get notesField(): VaultField | undefined {
    if (this.item?.type === "secure-note") {
      return undefined;
    }

    const value = this.item?.notes ?? "";
    return value ? { id: "notes", label: translateOfficialMessage("notes"), value } : undefined;
  }

  get customFields(): readonly VaultField[] {
    return (this.item?.fields ?? []).filter((field) => !this.typedFieldIds.has(field.id));
  }

  get typedFieldIds(): Set<string> {
    return new Set([
      "username",
      "password",
      "otp",
      "cardholder-name",
      "brand",
      "issuer",
      "number",
      "exp-month",
      "exp-year",
      "expires",
      "code",
      "title",
      "first-name",
      "middle-name",
      "last-name",
      "email",
      "phone",
      "address",
      "address-1",
      "address-2",
      "address-3",
      "city",
      "state",
      "postal-code",
      "country",
      "company",
      "ssn",
      "passport-number",
      "license-number",
      "notes",
      "private-key",
      "public-key",
      "fingerprint",
    ]);
  }

  get cipherQueryParams(): { cipherId: string; type: string } {
    return {
      cipherId: this.item?.id ?? "",
      type: this.item ? CIPHER_QUERY_TYPES[this.item.type] : "1",
    };
  }

  get passwordHistoryHref(): string {
    return `/cipher-password-history?cipherId=${encodeURIComponent(this.item?.id ?? "")}`;
  }

  get confirmationText(): string {
    if (this.pendingAction === "autofill-mismatch") {
      return translateOfficialMessage("i18nAutofillMismatchDescription");
    }
    const itemName = this.item?.name ?? translateOfficialMessage("i18nItem");
    if (this.pendingAction === "archive") {
      return translateOfficialMessage("i18nArchiveItemQuestion", itemName);
    }
    return this.pendingAction === "permanent-delete"
      ? translateOfficialMessage("i18nPermanentDeleteItemQuestion", itemName)
      : translateOfficialMessage("i18nDeleteItemQuestion", itemName);
  }

  get isDestructivePendingAction(): boolean {
    return this.pendingAction === "delete" || this.pendingAction === "permanent-delete";
  }

  get confirmationActionLabel(): string {
    if (this.pendingAction === "autofill-mismatch") {
      return translateOfficialMessage("i18nAutofillFillAnyway");
    }
    if (this.pendingAction === "archive") {
      return translateOfficialMessage("i18nConfirmArchive");
    }
    return translateOfficialMessage(
      this.pendingAction === "permanent-delete"
        ? "i18nConfirmPermanentDelete"
        : "i18nConfirmDelete",
    );
  }

  get confirmationActionButtonText(): string {
    if (this.pendingAction === "autofill-mismatch") {
      return translateOfficialMessage("i18nAutofillFillAnyway");
    }
    if (this.pendingAction === "archive") {
      return translateOfficialMessage("archive");
    }
    return translateOfficialMessage(
      this.pendingAction === "permanent-delete" ? "i18nPermanentDelete" : "i18nDelete",
    );
  }

  requestArchive(event?: Event): void {
    this.pendingAction = "archive";
    this.confirmationDialog?.open(eventTrigger(event));
  }

  requestDelete(event?: Event): void {
    this.pendingAction = this.isDeleted ? "permanent-delete" : "delete";
    this.confirmationDialog?.open(eventTrigger(event));
  }

  async unarchive(): Promise<void> {
    const item = this.item;
    if (!item || this.itemLocation !== "archived") {
      return;
    }
    await this.detailActions.run(item, { kind: "unarchive" });
  }

  async restore(): Promise<void> {
    const item = this.item;
    if (!item || this.itemLocation !== "deleted") {
      return;
    }
    await this.detailActions.run(item, { kind: "restore" });
  }

  dismissPendingAction(): void {
    if (this.pendingAction === "autofill-mismatch") {
      this.cancelContextualFill();
      return;
    }
    this.pendingAction = "";
  }

  cancelPendingAction(): void {
    if (this.pendingAction === "autofill-mismatch") {
      this.confirmationDialog?.close(false);
      this.cancelContextualFill();
      return;
    }
    this.pendingAction = "";
    this.confirmationDialog?.close();
  }

  private discardPendingAction(): void {
    if (this.pendingAction === "autofill-mismatch") {
      this.cancelContextualFill();
    }
    this.pendingAction = "";
    this.confirmationDialog?.close(false);
  }

  async confirmPendingAction(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.pendingAction === "autofill-mismatch") {
      const prepared = this.preparedContextualAction;
      this.pendingAction = "";
      this.confirmationDialog?.close(false);
      if (prepared) await this.executeContextualFill(prepared, true);
      return;
    }
    const item = this.item;
    const action = this.pendingAction;
    if (!item || !action) {
      return;
    }

    this.confirmationDialog?.close(false);
    await this.performPendingAction(item, action);
  }

  private async performPendingAction(
    item: VaultItem,
    action: "archive" | "delete" | "permanent-delete",
  ): Promise<void> {
    if (this.item !== item || this.pendingAction !== action) {
      return;
    }

    const detailAction: DetailAction = action === "archive"
      ? { kind: "archive" }
      : action === "delete"
        ? { kind: "trash" }
        : { kind: "delete-forever" };
    const receipt = await this.detailActions.run(item, detailAction);
    if (receipt.status === "Verification required.") {
      return;
    }
    this.pendingAction = "";
  }

  fieldById(fieldId: string): VaultField | undefined {
    return this.fieldsById[fieldId];
  }

  private identityField(
    id: string,
    label: string,
    typedValue: string | undefined,
    concealed = false,
  ): VaultField | undefined {
    const fallback = this.fieldById(id);
    const value = typedValue ?? fallback?.value ?? "";
    return value
      ? { id, label, value, ...(concealed ? { concealed: true, type: "hidden" as const } : {}) }
      : undefined;
  }

  uriField(id: string, value: string): VaultField {
    return { id: `uri:${id}`, label: translateOfficialMessage("i18nWebsite"), value };
  }

  isRevealed(fieldId: string): boolean {
    return this.revealedFieldIds.has(fieldId);
  }

  toggleReveal(request: string | LoginRevealRequest): void {
    const fieldId = typeof request === "string" ? request : request.fieldId;
    const trigger = typeof request === "string" ? undefined : request.trigger;
    if (this.revealedFieldIds.has(fieldId)) {
      this.revealedFieldIds.delete(fieldId);
      return;
    }

    if (this.openReprompt(() => this.revealField(fieldId), trigger)) {
      return;
    }

    this.revealField(fieldId);
  }

  fieldDisplayValue(field: VaultField): string {
    return field.type === "boolean"
      ? translateOfficialMessage(field.value === "true" ? "yes" : "no")
      : field.value;
  }

  async copy(field: VaultField): Promise<void> {
    const receipt = claimCapturedLocalCopyFeedback();
    const item = this.item;
    if (item && (item.type === "login" || isRetainedPersonalType(item.type))) {
      await this.detailActions.run(item, {
        kind: "copy",
        field,
        onComplete: (outcome) => completeLocalCopyFeedback(receipt, !outcome.committed),
      });
      return;
    }
    if (this.isProtectedField(field) && this.openReprompt(() => this.copyNow(field))) {
      return;
    }

    try {
      await this.copyNow(field);
      completeLocalCopyFeedback(receipt, false);
    } catch {
      completeLocalCopyFeedback(receipt, true);
    }
  }

  async fill(field: VaultField): Promise<void> {
    if (!this.canFillCurrentItem) {
      return;
    }
    const item = this.item;
    const contextualField = contextualSecretField(field);
    if (item?.type === "login" && contextualField && this.contextualFillAction) {
      if (!this.actionFieldBelongsToItem(field)) return;
      const snapshot = this.contextSession.snapshot();
      const candidate = snapshot?.candidates.find(({ cipherId }) => cipherId === item.id);
      if (!snapshot || snapshot.selectedCipherId !== item.id || !candidate
          || !this.contextualFillAction.fields.includes(contextualField)) return;
      const prepared = this.fillActions.prepare(
        snapshot.context,
        snapshot.session,
        candidate,
        [contextualField],
      );
      if (prepared.status !== "ready") return;
      this.preparedContextualAction = prepared;
      if (prepared.requiresMismatchConfirmation) {
        this.pendingAction = "autofill-mismatch";
        this.confirmationDialog?.open();
      } else {
        await this.executeContextualFill(prepared, false);
      }
      return;
    }
    if (item && (item.type === "login" || isRetainedPersonalType(item.type))) {
      await this.detailActions.run(item, { kind: "fill", field });
      return;
    }
    if (this.isProtectedField(field) && this.openReprompt(() => this.fillNow(field))) {
      return;
    }

    await this.fillNow(field);
  }

  requestContextualFill(event: Event): void {
    const prepared = this.preparedContextualAction;
    if (!prepared || this.contextualFillBusy || !this.contextualFillAction) return;
    if (prepared.requiresMismatchConfirmation) {
      this.pendingAction = "autofill-mismatch";
      this.confirmationDialog?.open(eventTrigger(event));
      return;
    }
    void this.executeContextualFill(prepared, false, eventTrigger(event));
  }

  async launchUri(uri: string): Promise<void> {
    const item = this.item;
    if (item?.type === "login") {
      await this.detailActions.run(item, { kind: "launch", uri });
    }
  }

  openPasswordHistory(event?: Event): void {
    event?.preventDefault();
    const item = this.item;
    if (!item || !this.hasPasswordHistory) {
      return;
    }

    const navigate = async () => {
      if (this.item?.id === item.id) {
        await this.router.navigate(["/cipher-password-history"], {
          queryParams: { cipherId: item.id },
        });
      }
    };
    if (!this.openReprompt(navigate)) {
      void navigate();
    }
  }

  private revealField(fieldId: string): void {
    if (this.item && this.fieldStillExists(fieldId)) {
      this.revealedFieldIds.add(fieldId);
    }
  }

  private fieldStillExists(fieldId: string): boolean {
    return fieldId === "password" || this.fieldBelongsToItem(fieldId);
  }

  private isProtectedField(field: VaultField): boolean {
    return field.id === "password" || field.id === "otp" || field.type === "hidden" || field.concealed === true;
  }

  private openReprompt(
    continuation: () => void | Promise<void>,
    trigger?: HTMLElement,
  ): boolean {
    const item = this.item;
    if (!item?.reprompt) {
      return false;
    }

    if (!this.repromptDialog) {
      this.store.setStatus(translateOfficialMessage("i18nUnableToVerifyMasterPassword"));
      return true;
    }

    const guard = this.detailActions.captureGuard(item);
    this.repromptDialog.openFor(item.id, async () => {
      if (guard()) {
        await continuation();
      }
    }, trigger);
    return true;
  }

  private async copyNow(field: VaultField): Promise<void> {
    if (this.item && (field.id === "otp" || this.actionFieldBelongsToItem(field))) {
      this.store.setStatus(await this.actions.copyField(field));
    }
  }

  private async fillNow(field: VaultField): Promise<void> {
    if (this.canFillCurrentItem && (field.id === "otp" || this.actionFieldBelongsToItem(field))) {
      this.store.setStatus(await this.actions.fillField(field));
    }
  }

  private actionFieldBelongsToItem(field: VaultField): boolean {
    const item = this.item;
    if (!item) {
      return false;
    }
    if (item.fields.includes(field)) {
      return true;
    }
    if (item.type === "login" && field.id === "notes") {
      return field.value === item.notes;
    }
    if (item.type === "login" && field.id.startsWith("uri:")) {
      const index = Number(field.id.slice(4));
      return Number.isInteger(index) && index >= 0 && item.uris[index]?.uri === field.value;
    }
    return item.type === "identity" && IDENTITY_ACTION_FIELD_IDS.has(field.id);
  }

  private fieldBelongsToItem(fieldId: string): boolean {
    if (this.item?.fields.some((field) => field.id === fieldId)) {
      return true;
    }

    return this.item?.type === "identity" && IDENTITY_ACTION_FIELD_IDS.has(fieldId);
  }

  private requestDetailReprompt(itemId: string, continuation: () => Promise<void>): boolean {
    const item = this.item;
    if (!item?.reprompt || item.id !== itemId || !this.repromptDialog) {
      this.store.setStatus(translateOfficialMessage("i18nUnableToVerifyMasterPassword"));
      return false;
    }
    const guard = this.detailActions.captureGuard(item);
    this.repromptDialog.openFor(itemId, async () => {
      if (guard()) {
        await continuation();
      }
    });
    return true;
  }

  private async refreshContextualFillAction(): Promise<void> {
    const priorPrepared = this.preparedContextualAction;
    const epoch = ++this.contextualEpoch;
    this.contextualPresentation = undefined;
    this.preparedContextualAction = undefined;
    this.contextualFillBusy = false;
    if (priorPrepared) void this.fillActions.cancel(priorPrepared);
    const item = this.item;
    const route = this.router.url.split(/[?#]/, 1)[0];
    const snapshot = this.contextSession.snapshot();
    if (!item || item.type !== "login" || this.itemLocation !== "active"
        || resolveWindowLayoutMode(globalThis.location?.search ?? "") !== "popup"
        || route !== `/view-cipher/${encodeURIComponent(item.id)}`
        || snapshot?.selectedCipherId !== item.id) {
      if (snapshot) this.invalidateContextualJourney(priorPrepared);
      return;
    }
    const candidate = snapshot.candidates.find(({ cipherId }) => cipherId === item.id);
    if (!candidate || !requestedSecretsExist(item, snapshot.context.action.fields)) {
      this.invalidateContextualJourney(priorPrepared);
      return;
    }

    const [entry, nativeSession] = await Promise.all([
      this.autoFillNative.entryContext().catch(() => ({ status: "unavailable" as const })),
      this.autoFillNative.agentSession().catch(() => ({ status: "error" as const, code: "unavailable" })),
    ]);
    if (epoch !== this.contextualEpoch || this.item !== item) {
      this.invalidateContextualJourney(priorPrepared);
      return;
    }
    const liveRoute = this.router.url.split(/[?#]/, 1)[0];
    if (this.itemLocation !== "active"
        || resolveWindowLayoutMode(globalThis.location?.search ?? "") !== "popup"
        || liveRoute !== `/view-cipher/${encodeURIComponent(item.id)}`) {
      this.contextSession.targetMismatch();
      return;
    }
    if (entry.status !== "available" || nativeSession.status !== "success") {
      this.contextSession.targetMismatch();
      return;
    }
    let context;
    let session: AutoFillAgentSession;
    try {
      context = decodeLiveAutoFillContext(entry.context);
      session = projectAutoFillAgentSession({
        accountId: nativeSession.accountId,
        generation: nativeSession.generation,
        vaultRevision: nativeSession.vaultRevision,
      });
    } catch {
      this.contextSession.targetMismatch();
      return;
    }
    if (!contextsEqual(context, snapshot.context)
        || !sameAgentSession(session, snapshot.session)
        || !this.contextSession.validate(context, session)) {
      this.contextSession.targetMismatch();
      return;
    }
    const liveSnapshot = this.contextSession.snapshot();
    const liveCandidate = liveSnapshot?.candidates.find(({ cipherId }) => cipherId === item.id);
    if (epoch !== this.contextualEpoch || liveSnapshot?.selectedCipherId !== item.id
        || !liveCandidate || !sameCandidateAuthorization(candidate, liveCandidate)) {
      this.contextSession.targetMismatch();
      return;
    }
    const prepared = this.fillActions.prepare(context, session, liveCandidate);
    if (prepared.status !== "ready") {
      this.invalidateContextualJourney();
      return;
    }
    this.preparedContextualAction = prepared;
    this.contextualPresentation = Object.freeze({
      appName: context.appName,
      contextLabel: context.action.mode === "form"
        ? translateOfficialMessage("i18nAutofillLoginForm")
        : fieldLabel(prepared.fields[0]),
      actionLabel: context.action.mode === "form"
        ? translateOfficialMessage("i18nAutofillFillForm")
        : translateOfficialMessage("i18nAutofillFillField", fieldLabel(prepared.fields[0])),
      fields: prepared.fields,
      mode: context.action.mode === "form" ? "form" : "field",
    });
    this.changeDetectorRef.markForCheck();
  }

  private async executeContextualFill(
    prepared: ReadyContextualAction,
    mismatchConfirmed: boolean,
    trigger?: HTMLElement,
    repromptVerified = false,
  ): Promise<void> {
    if (this.preparedContextualAction !== prepared || this.contextualFillBusy) return;
    const item = this.item;
    if (!item || item.type !== "login" || item.id !== prepared.scopes[0]?.candidateId) {
      this.finishContextualFill({ status: "unavailable", reason: "stale-context" });
      return;
    }
    this.contextualFillBusy = true;
    this.changeDetectorRef.markForCheck();
    const outcome = await this.fillActions.execute(prepared, {
      mismatchConfirmed,
      requiresReprompt: Boolean(item.reprompt),
      ...(repromptVerified ? { repromptVerified: true } : {}),
    });
    const liveRoute = this.router.url.split(/[?#]/, 1)[0];
    const liveSnapshot = this.contextSession.snapshot();
    if (this.preparedContextualAction !== prepared
        || this.item !== item
        || liveRoute !== `/view-cipher/${encodeURIComponent(item.id)}`
        || liveSnapshot?.selectedCipherId !== item.id) {
      this.invalidateContextualJourney(prepared);
      return;
    }
    if (outcome.status === "reprompt-required") {
      this.contextualFillBusy = false;
      this.repromptDialog?.openFor(
        item.id,
        () => this.executeContextualFill(prepared, mismatchConfirmed, trigger, true),
        trigger,
        outcome.receipt,
        () => this.cancelContextualFill(),
      );
      this.changeDetectorRef.markForCheck();
      return;
    }
    this.finishContextualFill(outcome);
  }

  private finishContextualFill(outcome: AutoFillActionOutcome): void {
    if (outcome.status === "success") {
      this.store.setStatus(translateOfficialMessage("i18nAutofillFilled"));
    } else if (outcome.status === "partial") {
      this.store.setStatus(translateOfficialMessage(
        "i18nAutofillPartial",
        outcome.filled.map(fieldLabel).join("、") || translateOfficialMessage("i18nAutofillNoFields"),
        fieldLabel(outcome.failed),
      ));
    } else if ((outcome.status === "error" && outcome.code === "stale-context")
        || (outcome.status === "unavailable" && outcome.reason === "stale-context")) {
      this.store.setStatus(translateOfficialMessage("i18nAutofillTargetChanged"));
    } else {
      this.store.setStatus(translateOfficialMessage("i18nAutofillActionUnavailable"));
    }
    this.contextSession.clear();
    this.contextualPresentation = undefined;
    this.preparedContextualAction = undefined;
    this.contextualFillBusy = false;
    this.changeDetectorRef.markForCheck();
  }

  private cancelContextualFill(): void {
    const prepared = this.preparedContextualAction;
    this.pendingAction = "";
    if (prepared) void this.fillActions.cancel(prepared);
    this.contextSession.cancel();
    this.contextualPresentation = undefined;
    this.preparedContextualAction = undefined;
    this.contextualFillBusy = false;
    this.changeDetectorRef.markForCheck();
  }

  private invalidateContextualJourney(
    prepared: ReadyContextualAction | undefined = this.preparedContextualAction,
  ): void {
    this.contextualEpoch += 1;
    this.contextualPresentation = undefined;
    this.preparedContextualAction = undefined;
    this.contextualFillBusy = false;
    this.pendingAction = "";
    this.contextSession.targetMismatch();
    if (prepared) void this.fillActions.cancel(prepared);
    this.changeDetectorRef.markForCheck();
  }
}

type ReadyContextualAction = Extract<PreparedAutoFillAction, { readonly status: "ready" }>;

function sameAgentSession(left: AutoFillAgentSession, right: AutoFillAgentSession): boolean {
  return left.accountId === right.accountId
    && left.generation === right.generation
    && left.vaultRevision === right.vaultRevision;
}

function sameCandidateAuthorization(left: ContextualCandidate, right: ContextualCandidate): boolean {
  if (left.cipherId !== right.cipherId || left.availableFields.length !== right.availableFields.length) return false;
  return left.availableFields.every((field, index) => {
    if (right.availableFields[index] !== field) return false;
    const leftAuthorization = left.authorizations.get(field);
    const rightAuthorization = right.authorizations.get(field);
    return leftAuthorization?.contextToken === rightAuthorization?.contextToken
      && leftAuthorization?.requiresMismatchConfirmation
        === rightAuthorization?.requiresMismatchConfirmation;
  });
}

function requestedSecretsExist(item: VaultItem, fields: readonly AutoFillSecretField[]): boolean {
  return fields.length > 0 && fields.every((field) => {
    const fieldId = field === "totp" ? "otp" : field;
    return item.fields.some((candidate) => candidate.id === fieldId && candidate.value.length > 0);
  });
}

function fieldLabel(field: AutoFillSecretField | undefined): string {
  return translateOfficialMessage({
    username: "i18nAutofillFieldUsername",
    password: "i18nAutofillFieldPassword",
    totp: "i18nAutofillFieldTotp",
  }[field ?? "password"]);
}

function contextualSecretField(field: VaultField): AutoFillSecretField | undefined {
  if (field.id === "username" || field.id === "password") return field.id;
  return field.id === "otp" ? "totp" : undefined;
}

function routeForLocation(location: VaultItemLocation | undefined): string {
  if (location === "archived") {
    return "/archive";
  }
  if (location === "deleted") {
    return "/trash";
  }
  return "/tabs/vault";
}

function eventTrigger(event: Event | undefined): HTMLElement | undefined {
  return event?.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
}

const CIPHER_QUERY_TYPES: Record<VaultItem["type"], string> = {
  login: "1",
  "secure-note": "2",
  card: "3",
  identity: "4",
  "ssh-key": "5",
};

const CIPHER_ICON_CLASSES: Record<VaultItem["type"], string> = {
  login: "bwi-globe",
  card: "bwi-credit-card",
  identity: "bwi-id-card",
  "secure-note": "bwi-sticky-note",
  "ssh-key": "bwi-key",
};

function isVaultField(field: VaultField | undefined): field is VaultField {
  return field != null;
}

function isRetainedPersonalType(type: VaultItem["type"]): type is "card" | "identity" | "secure-note" {
  return type === "card" || type === "identity" || type === "secure-note";
}

const IDENTITY_ACTION_FIELD_IDS = new Set([
  "identity-name",
  "username",
  "company",
  "ssn",
  "passport-number",
  "license-number",
  "email",
  "phone",
  "identity-address",
]);
