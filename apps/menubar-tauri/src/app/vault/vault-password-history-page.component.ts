import { Location } from "@angular/common";
import { ChangeDetectorRef, Component, Inject, Optional, ViewChild } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";

import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";

import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { POP_OUT_HOST, type PopOutHost } from "../popup-header-actions.component";
import { PopupStateStore } from "../popup-state";
import type { VaultField, VaultItem } from "../vault-demo";
import { BitIconButtonComponent } from "../official-ui/official-components";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import {
  claimCapturedLocalCopyFeedback,
  completeLocalCopyFeedback,
  type LocalCopyFeedbackReceipt,
} from "../official-ui/local-copy-feedback-event";
import {
  OfficialPasswordHistoryViewComponent,
  type OfficialPasswordHistoryCopyRequest,
} from "../upstream-overlays/recovery/password-history/official-password-history-view.component";
import { VaultActionsService } from "./vault-actions.service";
import { VaultFacade } from "./vault.facade";
import { projectLoginDetail } from "./login-cipher-view.adapter";
import { VaultRepromptDialogComponent } from "./vault-reprompt-dialog.component";
import { I18nPipe } from "../official-ui/official-ui-common";

type MaybeAsync<T> = T | PromiseLike<T>;

@Component({
  selector: "bw-vault-password-history-page",
  host: { class: "macos-page macos-page--secondary macos-page--vault-recovery" },
  standalone: true,
  imports: [
    BitIconButtonComponent,
    I18nPipe,
    OfficialPasswordHistoryViewComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    VaultRepromptDialogComponent,
  ],
  template: `
    <popup-page [loading]="loading" [loadingText]="'loading' | i18n">
      <popup-header slot="header" [pageTitle]="'passwordHistory' | i18n" [showBackButton]="true" [backAction]="backAction">
        <button slot="end" bitIconButton="bwi-popout" type="button" [label]="'i18nPopOut' | i18n" (click)="popOut()"></button>
      </popup-header>

      @if (!loading && cipher) {
        <bw-official-password-history-view [cipher]="cipher" (copyPassword)="copyPasswordHistory($event)" />
      }
    </popup-page>
    <bw-vault-reprompt-dialog />
  `,
})
export class VaultPasswordHistoryPageComponent {
  @ViewChild(VaultRepromptDialogComponent) private repromptDialog?: VaultRepromptDialogComponent;

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = (): Promise<void> => this.closeSafely();
  item: VaultItem | null = null;
  cipher: CipherView | null = null;
  loading = true;

  private closeRequested = false;
  private ownedItem: VaultItem | null = null;
  private pendingCopyReceipt: LocalCopyFeedbackReceipt | null = null;
  private readonly popOutHost: PopOutHost;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly location: Location,
    private readonly router: Router,
    private readonly vault: VaultFacade,
    private readonly actions: VaultActionsService,
    private readonly store: PopupStateStore,
    private readonly changeDetectorRef: ChangeDetectorRef,
    @Optional() @Inject(POP_OUT_HOST) popOutHost: PopOutHost | null = null,
  ) {
    this.popOutHost = popOutHost ?? { popOut: async (): Promise<void> => undefined };
    this.loadItem();
  }

  private loadItem(): void {
    const cipherId = this.route.snapshot.queryParamMap.get("cipherId");
    if (!cipherId) {
      void this.finishLoad(null, false);
      return;
    }

    const item = this.vault.itemById(cipherId) as MaybeAsync<VaultItem | null | undefined>;
    if (isPromiseLike(item)) {
      item.then((resolvedItem) => void this.finishLoad(resolvedItem ?? null, true));
      return;
    }

    void this.finishLoad(item ?? null, false);
  }

  private async finishLoad(item: VaultItem | null, refreshView: boolean): Promise<void> {
    if (!item || item.type !== "login") {
      this.loading = false;
      await this.closeSafely();
      if (refreshView) {
        this.changeDetectorRef.detectChanges();
      }
      return;
    }

    this.item = item;
    this.ownedItem = item;
    this.cipher = projectLoginDetail(item).cipher;
    this.loading = false;
    if (refreshView) {
      this.changeDetectorRef.detectChanges();
    }
  }

  async copyPasswordHistory(
    request: OfficialPasswordHistoryCopyRequest,
    repromptVerified = false,
  ): Promise<void> {
    const receipt = repromptVerified
      ? this.takePendingCopyReceipt()
      : claimCapturedLocalCopyFeedback();
    const sourceItem = this.ownedItem;
    if (!sourceItem || !this.ownsCurrentItem(sourceItem) || sourceItem.type !== "login" || request.cipherId !== sourceItem.id) {
      completeLocalCopyFeedback(receipt, true);
      return;
    }
    if (Number.isNaN(request.lastUsedDate.getTime())) {
      completeLocalCopyFeedback(receipt, true);
      return;
    }
    const lastUsedDate = request.lastUsedDate.toISOString();
    const entry = sourceItem.passwordHistory?.find(
      (candidate) => candidate.lastUsedDate === lastUsedDate && candidate.password === request.password,
    );
    if (!entry) {
      completeLocalCopyFeedback(receipt, true);
      return;
    }
    if (sourceItem.reprompt && !repromptVerified) {
      this.pendingCopyReceipt = receipt;
      this.repromptDialog?.openFor(sourceItem.id, () => this.copyPasswordHistory(request, true));
      return;
    }
    const field: VaultField = {
      id: `password-history:${lastUsedDate}`,
      label: translateOfficialMessage("passwordHistory"),
      value: request.password,
      concealed: true,
    };

    const outcome = await this.actions.copyFieldWithOutcome(
      field,
      () => this.ownsCurrentItem(sourceItem) && sourceItem.passwordHistory?.includes(entry) === true,
    );
    if (!this.ownsCurrentItem(sourceItem) || !sourceItem.passwordHistory?.includes(entry)) {
      completeLocalCopyFeedback(receipt, true);
      return;
    }
    if (!outcome.committed && outcome.reason === "stale") {
      completeLocalCopyFeedback(receipt, true);
      return;
    }
    this.store.setStatus(outcome.status);
    completeLocalCopyFeedback(receipt, !outcome.committed);
  }

  private takePendingCopyReceipt(): LocalCopyFeedbackReceipt | null {
    const receipt = this.pendingCopyReceipt;
    this.pendingCopyReceipt = null;
    return receipt;
  }

  private ownsCurrentItem(sourceItem: VaultItem): boolean {
    if (this.item !== sourceItem || this.ownedItem !== sourceItem) {
      return false;
    }

    try {
      const currentItem = this.vault.itemById(sourceItem.id) as MaybeAsync<VaultItem | null | undefined>;
      return !isPromiseLike(currentItem) && currentItem === sourceItem;
    } catch {
      return false;
    }
  }

  async popOut(): Promise<void> {
    await this.popOutHost.popOut(this.router.url);
  }

  async closeSafely(): Promise<void> {
    if (this.closeRequested) {
      return;
    }

    this.closeRequested = true;
    if (!hasNavigationHistory()) {
      await this.router.navigateByUrl("/tabs/vault", { replaceUrl: true });
      return;
    }

    this.location.back();
  }

}

function isPromiseLike<T>(value: MaybeAsync<T>): value is PromiseLike<T> {
  return typeof value === "object" && value !== null && "then" in value;
}

function hasNavigationHistory(): boolean {
  const historyState = globalThis.history?.state;
  if (typeof historyState?.navigationId === "number") {
    return historyState.navigationId > 1;
  }

  return (globalThis.history?.length ?? 0) > 1;
}
