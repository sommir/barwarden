import { DialogModule as CdkDialogModule } from "@angular/cdk/dialog";
import { Component, ElementRef, Inject, type OnDestroy, Optional, signal, ViewChild } from "@angular/core";
import { Router } from "@angular/router";

import { TauriHostService } from "../../host/tauri-host.service";
import {
  OfficialArchiveComponent,
} from "../upstream-overlays/recovery/archive/official-archive.component";
import {
  ButtonComponent,
  DialogComponent,
  DialogFooterDirective,
} from "../official-ui/official-components";
import { AppBottomSheetComponent } from "../official-ui/app-bottom-sheet.component";
import { AppFeedbackService } from "../official-ui/app-feedback.service";
import { I18nPipe } from "../official-ui/official-ui-common";
import { MacosAlertStripComponent } from "../official-ui/macos-alert-strip.component";
import { POP_OUT_HOST, type PopOutHost } from "../popup-header-actions.component";
import { PopupStateStore } from "../popup-state";
import {
  toRecoveryPopupCipherView,
  type RetainedPopupCipherView,
} from "./popup-cipher-view.adapter";
import {
  RecoveryPageActionsAdapter,
  type RecoveryPageActionResult,
  type RecoveryPageCommand,
} from "./recovery-page-actions.adapter";
import { VaultActionsService } from "./vault-actions.service";
import { VaultRepromptDialogComponent } from "./vault-reprompt-dialog.component";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";

@Component({
  selector: "bw-archive-page",
  host: { class: "macos-page macos-page--secondary macos-page--vault-recovery" },
  standalone: true,
  imports: [
    AppBottomSheetComponent,
    ButtonComponent,
    CdkDialogModule,
    DialogComponent,
    DialogFooterDirective,
    I18nPipe,
    MacosAlertStripComponent,
    OfficialArchiveComponent,
    VaultRepromptDialogComponent,
  ],
  template: `
    <bw-official-archive
      class="macos-page macos-page--vault-recovery"
      [items]="items"
      (back)="back()"
      (command)="execute($event)"
      (popOut)="popOut()"
    />
    <bw-vault-reprompt-dialog />
    <bw-app-bottom-sheet
      #deleteDialog
      testId="archive-delete-confirmation"
      labelledBy="archive-delete-title"
      [disableClose]="confirmationBusy"
      [attr.aria-busy]="confirmationBusy"
      (dismissed)="closeDeleteDialog()"
      (click)="onDeleteDialogClick($event)"
    >
      <form bit-dialog dialogSize="small" (submit)="confirmDelete($event)">
        <span bitDialogTitle id="archive-delete-title">{{ "i18nDeleteItemTitle" | i18n }}</span>
        <ng-container bitDialogContent>
          <p>{{ "i18nArchiveDeleteContent" | i18n }}</p>
          @if (confirmationError()) {
            <bw-macos-alert-strip kind="danger" urgency="assertive"
              [message]="confirmationError()" testId="recovery-confirmation-error" />
          }
        </ng-container>
        <ng-container bitDialogFooter>
          <button bitButton buttonType="danger" type="submit" [disabled]="confirmationBusy">{{ "i18nDelete" | i18n }}</button>
          <button #confirmationCancel bitAutofocus bitButton buttonType="secondary" type="button"
            data-testid="archive-delete-cancel" [disabled]="confirmationBusy"
            (click)="closeDeleteDialog()">{{ "cancel" | i18n }}</button>
        </ng-container>
      </form>
    </bw-app-bottom-sheet>
  `,
})
export class ArchivePageComponent implements OnDestroy {
  @ViewChild(VaultRepromptDialogComponent) private repromptDialog?: VaultRepromptDialogComponent;
  @ViewChild("deleteDialog") private deleteDialog?: AppBottomSheetComponent;
  @ViewChild("confirmationCancel", { read: ElementRef })
  private confirmationCancel?: ElementRef<HTMLButtonElement>;

  private readonly adapter: RecoveryPageActionsAdapter;
  readonly confirmationError = signal("");
  confirmationBusy = false;
  private pendingConfirmation: (() => Promise<RecoveryPageActionResult>) | null = null;
  private readonly popOutHost: PopOutHost;
  private itemsCache?: {
    readonly source: ReturnType<PopupStateStore["snapshot"]>["archivedItems"];
    readonly result: readonly RetainedPopupCipherView[];
  };

  constructor(
    private readonly store: PopupStateStore,
    actions: VaultActionsService,
    private readonly router: Router,
    private readonly routeCache: PopupRouterCacheService,
    private readonly feedback: AppFeedbackService,
    @Optional() @Inject(POP_OUT_HOST) popOutHost: PopOutHost | null = null,
  ) {
    this.popOutHost = popOutHost ?? new TauriHostService();
    this.adapter = new RecoveryPageActionsAdapter(
      store,
      router,
      actions,
      (itemId, continuation) => this.requestReprompt(itemId, continuation),
      (command, _item, continuation, trigger) =>
        command === "soft-delete" ? this.openConfirmation(continuation, trigger) : false,
      this.feedback,
    );
  }

  get items(): readonly RetainedPopupCipherView[] {
    const source = this.store.snapshot().archivedItems;
    if (this.itemsCache?.source === source) {
      return this.itemsCache.result;
    }

    const result = source
      .map(toRecoveryPopupCipherView)
      .filter((item): item is RetainedPopupCipherView => item !== null);
    this.itemsCache = { source, result };
    return result;
  }

  async back(): Promise<void> {
    await this.routeCache.back();
  }

  async popOut(): Promise<void> {
    await this.popOutHost.popOut(this.router.url);
  }

  async execute(command: RecoveryPageCommand): Promise<void> {
    if (command.command === "soft-delete") {
      await Promise.resolve();
    }
    await this.adapter.execute(command);
  }

  async view(item: RetainedPopupCipherView): Promise<void> {
    await this.execute({ command: "view", location: "archive", item });
  }

  async edit(item: RetainedPopupCipherView): Promise<void> {
    await this.execute({ command: "edit", location: "archive", item });
  }

  async clone(item: RetainedPopupCipherView): Promise<void> {
    await this.execute({ command: "clone", location: "archive", item });
  }

  async unarchive(itemId: string): Promise<void> {
    const item = this.items.find((candidate) => candidate.id === itemId);
    if (item) {
      await this.execute({ command: "unarchive", location: "archive", item });
    }
  }

  async requestDelete(itemId: string): Promise<void> {
    const item = this.items.find((candidate) => candidate.id === itemId);
    if (item) {
      await this.execute({ command: "soft-delete", location: "archive", item });
    }
  }

  async confirmDelete(event?: Event): Promise<void> {
    event?.preventDefault();
    const continuation = this.pendingConfirmation;
    if (!continuation || this.confirmationBusy) return;
    this.confirmationBusy = true;
    this.confirmationError.set("");
    const outcome = await continuation();
    if (this.pendingConfirmation !== continuation) return;
    this.confirmationBusy = false;
    if (outcome.terminal || outcome.reason === "stale") {
      this.closeDeleteDialog();
      return;
    }
    this.confirmationError.set(outcome.status);
  }

  onDeleteDialogClick(event: Event): void {
    if (isOfficialCloseButton(event.target)) {
      this.closeDeleteDialog();
    }
  }

  closeDeleteDialog(force = false): void {
    if (this.confirmationBusy && !force) return;
    this.pendingConfirmation = null;
    this.confirmationBusy = false;
    this.confirmationError.set("");
    this.deleteDialog?.close();
  }

  ngOnDestroy(): void {
    this.closeDeleteDialog(true);
    this.adapter.ngOnDestroy();
  }

  private requestReprompt(itemId: string, continuation: () => Promise<void>): boolean {
    if (!this.repromptDialog) {
      return false;
    }
    this.repromptDialog.openFor(itemId, continuation);
    return true;
  }

  private openConfirmation(
    continuation: () => Promise<RecoveryPageActionResult>,
    trigger?: HTMLElement,
  ): boolean {
    this.pendingConfirmation = continuation;
    this.confirmationError.set("");
    this.confirmationBusy = false;
    this.deleteDialog?.open(trigger, this.confirmationCancel?.nativeElement ?? null);
    return true;
  }
}

function isOfficialCloseButton(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button")?.querySelector(".bwi-close"));
}
