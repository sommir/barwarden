import { DialogModule as CdkDialogModule } from "@angular/cdk/dialog";
import { Component, Inject, type OnDestroy, Optional, ViewChild } from "@angular/core";
import { Router } from "@angular/router";

import { TauriHostService } from "../../host/tauri-host.service";
import {
  ButtonComponent,
  DialogComponent,
  DialogFooterDirective,
} from "../official-ui/official-components";
import { AppBottomSheetComponent } from "../official-ui/app-bottom-sheet.component";
import { AppFeedbackService } from "../official-ui/app-feedback.service";
import { I18nPipe } from "../official-ui/official-ui-common";
import { POP_OUT_HOST, type PopOutHost } from "../popup-header-actions.component";
import { PopupStateStore } from "../popup-state";
import { OfficialTrashComponent } from "../upstream-overlays/recovery/trash/official-trash.component";
import {
  toRecoveryPopupCipherView,
  type RetainedPopupCipherView,
} from "./popup-cipher-view.adapter";
import {
  RecoveryPageActionsAdapter,
  type RecoveryPageCommand,
} from "./recovery-page-actions.adapter";
import { VaultActionsService } from "./vault-actions.service";
import { VaultRepromptDialogComponent } from "./vault-reprompt-dialog.component";

@Component({
  selector: "bw-trash-page",
  host: { class: "macos-page macos-page--secondary macos-page--vault-recovery" },
  standalone: true,
  imports: [
    AppBottomSheetComponent,
    ButtonComponent,
    CdkDialogModule,
    DialogComponent,
    DialogFooterDirective,
    I18nPipe,
    OfficialTrashComponent,
    VaultRepromptDialogComponent,
  ],
  template: `
    <bw-official-trash
      class="macos-page macos-page--vault-recovery"
      [items]="items"
      (back)="back()"
      (command)="execute($event)"
      (popOut)="popOut()"
    />
    <bw-vault-reprompt-dialog />
    <bw-app-bottom-sheet
      #permanentDeleteDialog
      testId="permanent-delete-confirmation"
      labelledBy="permanent-delete-title"
      (dismissed)="closePermanentDelete()"
      (click)="onPermanentDeleteDialogClick($event)"
    >
      <form bit-dialog dialogSize="small" (submit)="confirmPermanentDelete($event)">
        <span bitDialogTitle id="permanent-delete-title">{{ "i18nPermanentDeleteItemTitle" | i18n }}</span>
        <ng-container bitDialogContent>
          <p>{{ "i18nPermanentDeleteItemContent" | i18n }}</p>
        </ng-container>
        <ng-container bitDialogFooter>
          <button bitButton buttonType="danger" type="submit">{{ "i18nPermanentDelete" | i18n }}</button>
          <button bitButton buttonType="secondary" type="button" (click)="closePermanentDelete()">{{ "cancel" | i18n }}</button>
        </ng-container>
      </form>
    </bw-app-bottom-sheet>
  `,
})
export class TrashPageComponent implements OnDestroy {
  @ViewChild(VaultRepromptDialogComponent) private repromptDialog?: VaultRepromptDialogComponent;
  @ViewChild("permanentDeleteDialog") private permanentDeleteDialog?: AppBottomSheetComponent;

  private readonly adapter: RecoveryPageActionsAdapter;
  private pendingConfirmation: (() => Promise<void>) | null = null;
  private readonly popOutHost: PopOutHost;
  private itemsCache?: {
    readonly source: ReturnType<PopupStateStore["snapshot"]>["deletedItems"];
    readonly result: readonly RetainedPopupCipherView[];
  };

  constructor(
    private readonly store: PopupStateStore,
    actions: VaultActionsService,
    private readonly router: Router,
    private readonly feedback: AppFeedbackService,
    @Optional() @Inject(POP_OUT_HOST) popOutHost: PopOutHost | null = null,
  ) {
    this.popOutHost = popOutHost ?? new TauriHostService();
    this.adapter = new RecoveryPageActionsAdapter(
      store,
      router,
      actions,
      (itemId, continuation) => this.requestReprompt(itemId, continuation),
      (command, _item, continuation) => {
        if (command !== "permanent-delete") {
          return false;
        }
        this.pendingConfirmation = continuation;
        this.permanentDeleteDialog?.open();
        return true;
      },
      this.feedback,
    );
  }

  get items(): readonly RetainedPopupCipherView[] {
    const source = this.store.snapshot().deletedItems;
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
    await this.router.navigateByUrl("/vault-settings");
  }

  async popOut(): Promise<void> {
    await this.popOutHost.popOut(this.router.url);
  }

  async execute(command: RecoveryPageCommand): Promise<void> {
    await this.adapter.execute(command);
  }

  async view(item: RetainedPopupCipherView): Promise<void> {
    await this.execute({ command: "view", location: "trash", item });
  }

  async restore(itemId: string): Promise<void> {
    const item = this.items.find((candidate) => candidate.id === itemId);
    if (item) {
      await this.execute({ command: "restore", location: "trash", item });
    }
  }

  async deleteForever(itemId: string): Promise<void> {
    const item = this.items.find((candidate) => candidate.id === itemId);
    if (item) {
      await this.execute({ command: "permanent-delete", location: "trash", item });
    }
  }

  async confirmPermanentDelete(event?: Event): Promise<void> {
    event?.preventDefault();
    const continuation = this.pendingConfirmation;
    this.closePermanentDelete();
    await continuation?.();
  }

  onPermanentDeleteDialogClick(event: Event): void {
    if (isOfficialCloseButton(event.target)) {
      this.closePermanentDelete();
    }
  }

  closePermanentDelete(): void {
    this.pendingConfirmation = null;
    this.permanentDeleteDialog?.close();
  }

  ngOnDestroy(): void {
    this.closePermanentDelete();
    this.adapter.ngOnDestroy();
  }

  private requestReprompt(itemId: string, continuation: () => Promise<void>): boolean {
    if (!this.repromptDialog) {
      return false;
    }
    this.repromptDialog.openFor(itemId, continuation);
    return true;
  }
}

function isOfficialCloseButton(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button")?.querySelector(".bwi-close"));
}
