import { Component, HostListener, Inject, type OnDestroy, Optional, ViewChild } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

import { NoResults, VaultOpen } from "@bitwarden/assets/svg";

import { PopupPageComponent } from "../layout/popup-page.component";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { RootSearchComponent } from "../layout/root-search.component";
import {
  ButtonComponent,
  NoItemsComponent,
  TypographyDirective,
} from "../official-ui/official-components";
import { AppFeedbackService } from "../official-ui/app-feedback.service";
import { MacosAlertStripComponent } from "../official-ui/macos-alert-strip.component";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";
import {
  claimLocalCopyFeedback,
  completeLocalCopyFeedback,
} from "../official-ui/local-copy-feedback-event";
import { PopupStateStore } from "../popup-state";
import { PopupHeaderActionsComponent } from "../popup-header-actions.component";
import { SettingsService } from "../settings/settings.service";
import { RetainedVaultMenuCoordinator } from "../upstream-overlays/vault-main/item-more-options.component";
import { VaultFadeInOutSkeletonComponent } from "../upstream-overlays/vault-main/vault-fade-in-out-skeleton/vault-fade-in-out-skeleton.component";
import { VaultFadeInOutComponent } from "../upstream-overlays/vault-main/vault-fade-in-out/vault-fade-in-out.component";
import {
  VaultListItemsContainerComponent,
  type VaultMenuOpenChange,
} from "../upstream-overlays/vault-main/vault-list-items-container.component";
import { VaultLoadingSkeletonComponent } from "../upstream-overlays/vault-main/vault-loading-skeleton/vault-loading-skeleton.component";
import type { VaultField, VaultItem } from "../vault-demo";
import { VaultActionsService } from "./vault-actions.service";
import { VaultAutoFillSuggestionsComponent } from "./vault-autofill-suggestions.component";
import { VaultHierarchyComponent } from "./vault-hierarchy.component";
import {
  VAULT_MAIN_EVIDENCE_STATE,
  type VaultMainEvidenceState,
} from "./vault-main-evidence-state";
import { VaultRepromptDialogComponent } from "./vault-reprompt-dialog.component";
import { RetainedNewItemDropdownComponent } from "./retained-new-item-dropdown.component";
import { VaultRowActionsAdapter } from "./vault-row-actions.adapter";
import { VaultSessionService } from "./vault-session.service";
import { VaultFacade, type VaultMainState } from "./vault.facade";

@Component({
  selector: "bw-vault-list-page",
  standalone: true,
  imports: [
    ButtonComponent,
    MacosAlertStripComponent,
    NoItemsComponent,
    I18nPipe,
    PopupHeaderActionsComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    RootSearchComponent,
    RetainedNewItemDropdownComponent,
    RouterLink,
    TypographyDirective,
    VaultFadeInOutComponent,
    VaultFadeInOutSkeletonComponent,
    VaultAutoFillSuggestionsComponent,
    VaultHierarchyComponent,
    VaultListItemsContainerComponent,
    VaultLoadingSkeletonComponent,
    VaultRepromptDialogComponent,
  ],
  providers: [
    {
      provide: VaultRowActionsAdapter,
      useFactory: (
        store: PopupStateStore,
        router: Router,
        actions: VaultActionsService,
        session: VaultSessionService,
        feedback: AppFeedbackService,
      ) => new VaultRowActionsAdapter(store, router, actions, session, feedback),
      deps: [PopupStateStore, Router, VaultActionsService, VaultSessionService, AppFeedbackService],
    },
  ],
  template: `
    <popup-page class="macos-page macos-page--vault-list" [attr.data-vault-state]="vaultState">
      <popup-header slot="header" [pageTitle]="'vault' | i18n">
        <ng-container slot="end">
          <bw-retained-new-item-dropdown />
          <bw-popup-header-actions [showNew]="false" />
        </ng-container>
      </popup-header>
      <bw-root-search
        slot="above-scroll-area"
        [searchAriaLabel]="'searchVault' | i18n"
        [query]="vaultQuery"
        (queryChange)="setSearch($event)"
      />

      @if (showStaleSyncCallout) {
        <bw-macos-alert-strip
          kind="warning"
          urgency="assertive"
          [title]="'i18nVaultMayBeOutdated' | i18n"
          [message]="vaultSyncMessage"
          [actionLabel]="'i18nRetry' | i18n"
          actionTestId="vault-sync-retry"
          testId="vault-sync-callout"
          (action)="retrySync()"
        />
      }

      @if (vaultState === 'ready' || vaultState === 'no-results') {
        <bw-vault-autofill-suggestions />
      }

      @if (showSkeletons) {
        <vault-fade-in-out-skeleton>
          <vault-loading-skeleton />
        </vault-fade-in-out-skeleton>
      } @else if (vaultState === 'unavailable') {
        <bit-no-items>
          <ng-container slot="title">{{ vaultSyncMessage }}</ng-container>
          <button slot="button" bitButton buttonType="secondary" type="button" data-testid="vault-sync-retry" (click)="retrySync()">{{ "i18nRetry" | i18n }}</button>
        </bit-no-items>
      } @else if (vaultState === 'empty') {
        <vault-fade-in-out>
          <div class="tw-flex tw-flex-col tw-h-full tw-justify-center">
            <bit-no-items [icon]="vaultIcon">
              <ng-container slot="title">{{ "i18nEmptyVaultTitle" | i18n }}</ng-container>
              <ng-container slot="description">
                <p bitTypography="body2" class="tw-mx-6 tw-mt-2">{{ "i18nEmptyVaultDescription" | i18n }}</p>
              </ng-container>
              <a
                slot="button"
                bitButton
                buttonType="secondary"
                [routerLink]="['/add-cipher']"
                [queryParams]="{ type: '1' }"
              >
                {{ "i18nNewLogin" | i18n }}
              </a>
            </bit-no-items>
          </div>
        </vault-fade-in-out>
      } @else if (vaultState === 'no-results') {
        <div class="tw-flex tw-flex-col tw-justify-center tw-h-auto tw-pt-12">
          <bit-no-items [icon]="noResultsIcon">
            <ng-container slot="title">{{ "i18nNoSearchMatches" | i18n }}</ng-container>
            <ng-container slot="description">{{ "i18nNoSearchMatchesHint" | i18n }}</ng-container>
          </bit-no-items>
        </div>
      } @else {
        @if (hasSearchQuery) {
          <div class="tw-flex tw-flex-col tw-gap-3 tw-px-3 tw-pb-3 vault-sections macos-list">
            @for (section of sections; track section.id) {
              <app-vault-list-items-container
                [section]="section"
                [openMenuRowId]="openMenuRowId"
                [showQuickCopyActions]="showQuickCopyActions"
                (view)="viewItem($event)"
                (fill)="fillField($event)"
                (edit)="editItem($event)"
                (clone)="cloneItem($event)"
                (launch)="launchItem($event)"
                (toggleFavorite)="toggleFavorite($event)"
                (archive)="archiveItem($event)"
                (delete)="deleteItem($event)"
                (menuOpenChange)="setOpenMenu($event)"
              />
            }
          </div>
        } @else {
          <bw-vault-hierarchy
            [nodes]="hierarchy"
            [openMenuRowId]="openMenuRowId"
            [showQuickCopyActions]="showQuickCopyActions"
            (view)="viewItem($event)"
            (fill)="fillField($event)"
            (edit)="editItem($event)"
            (clone)="cloneItem($event)"
            (launch)="launchItem($event)"
            (toggleFavorite)="toggleFavorite($event)"
            (archive)="archiveItem($event)"
            (delete)="deleteItem($event)"
            (menuOpenChange)="setOpenMenu($event)"
          />
        }
      }
      <bw-vault-reprompt-dialog #vaultListReprompt />
    </popup-page>
  `,
})
export class VaultListPageComponent implements OnDestroy {
  @ViewChild("vaultListReprompt") private repromptDialog?: VaultRepromptDialogComponent;
  openMenuRowId: string | null = null;
  readonly noResultsIcon = NoResults;
  readonly vaultIcon = VaultOpen;

  constructor(
    private readonly store: PopupStateStore,
    private readonly settings: SettingsService,
    private readonly vault: VaultFacade,
    private readonly rowActions: VaultRowActionsAdapter,
    private readonly menuCoordinator: RetainedVaultMenuCoordinator,
    @Optional()
    @Inject(VAULT_MAIN_EVIDENCE_STATE)
    evidenceState: VaultMainEvidenceState | null = null,
  ) {
    if (evidenceState) {
      this.settings.setShowFavicons(false);
    }
    if (evidenceState === "compact") {
      this.settings.setCompactMode(true);
      this.settings.setTheme("light");
    } else if (evidenceState === "light" || evidenceState === "dark") {
      this.settings.setCompactMode(false);
      this.settings.setTheme(evidenceState);
    }
    if (evidenceState === "search-results") {
      this.vault.setSearch("Calendar");
    } else if (evidenceState === "no-results") {
      this.vault.setSearch("__no_results__");
    }
  }

  get sections() {
    return this.vault.sections();
  }

  get hierarchy() {
    return this.vault.hierarchy();
  }

  get vaultQuery(): string {
    return this.vault.queryValue();
  }

  get hasSearchQuery(): boolean {
    return this.vaultQuery.trim().length > 0;
  }

  get vaultState(): VaultMainState {
    return this.vault.vaultState();
  }

  get showSkeletons(): boolean {
    return this.vaultState === "loading";
  }

  get vaultSyncMessage(): string {
    return this.store.snapshot().vaultSyncMessage;
  }

  get showStaleSyncCallout(): boolean {
    return this.store.snapshot().vaultSyncStatus === "stale";
  }

  get showQuickCopyActions(): boolean {
    return this.settings.snapshot().showQuickCopyActions;
  }

  setSearch(query: string | null | undefined): void {
    this.openMenuRowId = null;
    this.menuCoordinator.closeAll();
    this.vault.setSearch(query ?? "");
  }

  @HostListener("input", ["$event"])
  clearOpenMenuOnInput(event: Event): void {
    this.openMenuRowId = null;
    this.menuCoordinator.closeAll();
  }

  setOpenMenu(change: VaultMenuOpenChange): void {
    if (change.open) {
      this.openMenuRowId = change.rowId;
    } else if (this.openMenuRowId === change.rowId) {
      this.openMenuRowId = null;
    }
  }

  ngOnDestroy(): void {
    this.rowActions.ngOnDestroy();
  }

  async viewItem(item: VaultItem): Promise<void> {
    await this.rowActions.view(item);
  }

  async editItem(item: VaultItem): Promise<void> {
    await this.rowActions.edit(item);
  }

  async cloneItem(item: VaultItem): Promise<void> {
    await this.rowActions.clone(item);
  }

  async copyField(request: {
    readonly item: VaultItem;
    readonly field: VaultField;
    readonly trigger: Event;
  }): Promise<void> {
    const receipt = claimLocalCopyFeedback(request.trigger);
    const status = await this.rowActions.copy(request.item, request.field);
    completeLocalCopyFeedback(receipt, copyReceiptFailed(status));
  }

  async fillField(request: {
    readonly item: VaultItem;
    readonly field: VaultField;
    readonly trigger: Event;
  }): Promise<void> {
    const receipt = claimLocalCopyFeedback(request.trigger);
    const status = await this.rowActions.fill(request.item, request.field);
    completeLocalCopyFeedback(receipt, copyReceiptFailed(status));
  }

  async launchItem(item: VaultItem): Promise<void> {
    await this.rowActions.launch(item);
  }

  async toggleFavorite(item: VaultItem): Promise<void> {
    await this.rowActions.favorite(item);
  }

  async archiveItem(item: VaultItem): Promise<void> {
    if (this.openLifecycleReprompt(item, () => this.archiveNow(item))) {
      return;
    }
    await this.archiveNow(item);
  }

  async deleteItem(item: VaultItem): Promise<void> {
    if (this.openLifecycleReprompt(item, () => this.deleteNow(item))) {
      return;
    }
    await this.deleteNow(item);
  }

  async retrySync(): Promise<void> {
    await this.rowActions.retrySync();
  }

  private openLifecycleReprompt(item: VaultItem, continuation: () => Promise<void>): boolean {
    if (!item.reprompt) {
      return false;
    }
    const isCurrent = this.rowActions.captureGuard(item);
    if (!isCurrent()) {
      return true;
    }
    if (!this.repromptDialog) {
      this.store.setStatus(translateOfficialMessage("i18nUnableToVerifyMasterPassword"));
      return true;
    }
    this.repromptDialog.openFor(item.id, async () => {
      if (isCurrent()) {
        await continuation();
      }
    });
    return true;
  }

  private async archiveNow(item: VaultItem): Promise<void> {
    await this.rowActions.archive(item);
  }

  private async deleteNow(item: VaultItem): Promise<void> {
    await this.rowActions.delete(item);
  }
}

function copyReceiptFailed(status: string | null): boolean {
  return status === null
    || /(?:unable|failed|failure|error|无法|失败|错误)/iu.test(status);
}
