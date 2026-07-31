import { DialogModule as CdkDialogModule } from "@angular/cdk/dialog";
import { Component, Inject, OnDestroy, Optional, ViewChild } from "@angular/core";
import { Router } from "@angular/router";

import type { AuthSession } from "../../auth/auth-session-store";
import type { HostApi } from "../../host/host-api";
import { TauriHostService } from "../../host/tauri-host.service";
import { AppBottomSheetComponent } from "../official-ui/app-bottom-sheet.component";
import { AppFeedbackService } from "../official-ui/app-feedback.service";
import {
  claimLocalCopyFeedback,
  completeLocalCopyFeedback,
} from "../official-ui/local-copy-feedback-event";
import {
  ButtonComponent,
  DialogComponent,
  DialogFooterDirective,
} from "../official-ui/official-components";
import {
  OfficialSendListComponent,
} from "../upstream-overlays/send/official-send-list.component";
import type {
  OfficialTextSendCopyRequest,
  OfficialTextSendListItem,
} from "../upstream-overlays/send/official-send-list-items-container.component";
import { PopupStateStore } from "../popup-state";
import { ClipboardPolicyService } from "../settings/clipboard-policy.service";
import { SEND_CREATED_HOST, SendLinkBuilder } from "./send-created-page.component";
import { BitwardenSendActions, SEND_ACTION_PORT, type SendActionPort } from "./send-actions.service";
import type { SendItem } from "./send-item.model";
import { SendFacade, type SendState } from "./send.facade";
import { TextSendOperation } from "./text-send-operation";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";

export { SEND_ACTION_PORT, type SendActionPort } from "./send-actions.service";

@Component({
  selector: "bw-send-page",
  host: { class: "macos-page macos-page--send" },
  standalone: true,
  imports: [
    AppBottomSheetComponent,
    ButtonComponent,
    CdkDialogModule,
    DialogComponent,
    DialogFooterDirective,
    I18nPipe,
    OfficialSendListComponent,
  ],
  providers: [SendLinkBuilder],
  template: `
    <bw-official-send-list
      [sends]="sends"
      [query]="query"
      [filtersVisible]="filtersVisible"
      [loading]="loading"
      [disabled]="disabled"
      [state]="state"
      (queryChange)="setSearch($event)"
      (toggleFilters)="toggleFilters()"
      (filterChange)="setType($event)"
      (open)="open($event)"
      (copyLink)="copy($event)"
      (delete)="requestDelete($event)"
    />
    <bw-app-bottom-sheet
      #deleteDialog
      testId="send-permanent-delete-confirmation"
      labelledBy="send-permanent-delete-title"
      [disableClose]="deleting"
      (dismissed)="closeDeleteConfirmation()"
    >
      <form bit-dialog dialogSize="small" (submit)="confirmDelete($event)">
        <span bitDialogTitle id="send-permanent-delete-title">{{ "i18nPermanentDeleteSend" | i18n }}</span>
        <ng-container bitDialogContent>
          <p>{{ "i18nPermanentDeleteSendContent" | i18n: pendingDeleteName }}</p>
        </ng-container>
        <ng-container bitDialogFooter>
          <button bitButton buttonType="danger" type="submit" [disabled]="deleting">
            {{ deleting ? ("i18nDeletingSend" | i18n) : ("i18nPermanentDelete" | i18n) }}
          </button>
          <button
            bitButton
            buttonType="secondary"
            type="button"
            [disabled]="deleting"
            (click)="closeDeleteConfirmation()"
          >
            {{ "cancel" | i18n }}
          </button>
        </ng-container>
      </form>
    </bw-app-bottom-sheet>
  `,
})
export class SendPageComponent implements OnDestroy {
  @ViewChild("deleteDialog") private deleteDialog?: AppBottomSheetComponent;

  private readonly host: HostApi;
  private readonly operation: TextSendOperation;
  private pendingDelete: SendItem | null = null;
  private sendsCache?: {
    readonly source: readonly SendItem[];
    readonly now: number;
    readonly result: readonly OfficialTextSendListItem[];
  };
  deleting = false;

  constructor(
    private readonly sendFacade: SendFacade,
    private readonly store: PopupStateStore,
    private readonly router: Router,
    private readonly linkBuilder: SendLinkBuilder,
    private readonly clipboardPolicy: ClipboardPolicyService,
    private readonly feedback: AppFeedbackService,
    @Optional() @Inject(SEND_CREATED_HOST) host: HostApi | null = null,
    @Optional() @Inject(SEND_ACTION_PORT) sendActions: SendActionPort | null = null,
  ) {
    this.host = host ?? new TauriHostService();
    this.operation = new TextSendOperation({
      store,
      actions: sendActions ?? sessionSendActions(),
      navigation: { currentUrl: () => this.router.url },
    });
  }

  get query(): string {
    return this.sendFacade.queryValue();
  }

  get sends(): readonly OfficialTextSendListItem[] {
    // Expiration is shown at second precision, while Angular may evaluate this
    // getter several times in one change-detection pass.
    const now = Math.floor(Date.now() / 1_000) * 1_000;
    const source = this.sendFacade.filteredSends();
    const cached = this.sendsCache;
    if (cached?.source === source && cached.now === now) {
      return cached.result;
    }

    const result = source
      .filter(isTextSend)
      .map((send) => ({
        id: send.id,
        name: send.name,
        deletionDate: send.deletionDate,
        disabled: send.disabled,
        expired: Number.isFinite(Date.parse(send.deletionDate)) && Date.parse(send.deletionDate) <= now,
        maxAccessCountReached: send.maxAccessCount != null && send.accessCount >= send.maxAccessCount,
        hasPassword: Boolean(send.hasPassword || send.password),
      }));
    this.sendsCache = { source, now, result };
    return result;
  }

  get state(): SendState {
    if (this.sends.length > 0) {
      return "ready";
    }
    return this.store.snapshot().sends.some(isTextSend) ? "no-results" : "empty";
  }

  get filtersVisible(): boolean {
    return this.sendFacade.filtersVisible();
  }

  get loading(): boolean {
    return this.sendFacade.showSkeletons();
  }

  get disabled(): boolean {
    return this.sendFacade.sendDisabled();
  }

  get pendingDeleteName(): string {
    return this.pendingDelete?.name ?? "";
  }

  setSearch(query: string): void {
    this.sendFacade.setSearch(query);
  }

  toggleFilters(): void {
    this.sendFacade.toggleFilters();
  }

  setType(type: "" | "text"): void {
    this.sendFacade.setTypeFilter(type);
  }

  open(send: OfficialTextSendListItem | undefined): void {
    if (!send) {
      void this.router.navigate(["/add-send"], { queryParams: { type: "text" } });
      return;
    }
    void this.router.navigate(["/edit-send"], {
      queryParams: { sendId: send.id, type: "text" },
    });
  }

  async copy(request: OfficialTextSendCopyRequest): Promise<void> {
    const receipt = claimLocalCopyFeedback(request.trigger);
    const send = request.send;
    const source = this.source(send);
    const link = source ? this.linkBuilder.linkFor(source) : "";
    if (!link) {
      this.store.setStatus(translateOfficialMessage("i18nCopySendLinkFailed"));
      completeLocalCopyFeedback(receipt, true);
      return;
    }
    try {
      await this.clipboardPolicy.copy(link, this.host);
      const message = translateOfficialMessage("i18nSendLinkCopied");
      this.store.setStatus(message);
      this.feedback.show(message, { kind: "success" });
      completeLocalCopyFeedback(receipt, false);
    } catch {
      this.store.setStatus(translateOfficialMessage("i18nCopySendLinkFailed"));
      completeLocalCopyFeedback(receipt, true);
    }
  }

  requestDelete(send: OfficialTextSendListItem): void {
    if (this.deleting) {
      return;
    }
    const source = this.source(send);
    if (!source) {
      return;
    }
    this.pendingDelete = source;
    this.deleteDialog?.open();
  }

  async confirmDelete(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.deleting) {
      return;
    }
    const source = this.pendingDelete;
    if (!source) {
      return;
    }
    this.deleting = true;
    try {
      const result = await this.operation.delete(source);
      if (result.committed) {
        const message = translateOfficialMessage("i18nSendDeleted");
        this.store.setStatus(message);
        this.feedback.show(message, { kind: "success" });
      } else if (result.reason === "failure") {
        this.store.setStatus(translateOfficialMessage("i18nDeleteSendFailed"));
      }
    } finally {
      this.deleting = false;
      this.closeDeleteConfirmation();
    }
  }

  closeDeleteConfirmation(force = false): void {
    if (this.deleting && !force) {
      return;
    }
    this.pendingDelete = null;
    this.deleteDialog?.close();
  }

  ngOnDestroy(): void {
    this.closeDeleteConfirmation(true);
    this.operation.invalidate();
  }

  private source(send: OfficialTextSendListItem): SendItem | undefined {
    return this.store.snapshot().sends.find((candidate) => candidate.id === send.id && isTextSend(candidate));
  }
}

function isTextSend(send: SendItem): boolean {
  return send.type === "text";
}

function sessionSendActions(): SendActionPort {
  const actions = (session: AuthSession) => new BitwardenSendActions(session);
  return {
    createTextSend: (session, draft) => actions(session).createTextSend(session, draft),
    updateTextSend: (session, send, draft) => actions(session).updateTextSend(session, send, draft),
    deleteSend: (session, send) => actions(session).deleteSend(session, send),
    removePassword: (session, send) => actions(session).removePassword(session, send),
    refreshTextSend: (session, sendId) => actions(session).refreshTextSend(session, sendId),
  };
}
