import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  type OnDestroy,
  Output,
  signal,
  ViewChild,
} from "@angular/core";

import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";

import {
  BitIconButtonComponent,
  ButtonComponent,
  DialogComponent,
  DialogFooterDirective,
} from "../official-ui/official-components";
import { AppBottomSheetComponent } from "../official-ui/app-bottom-sheet.component";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";
import { PopupStateStore } from "../popup-state";
import {
  OfficialAddEditFolderDialogComponent,
  type OfficialFolderDialogSubmit,
} from "../upstream-overlays/recovery/folders/official-add-edit-folder-dialog.component";
import type { VaultFolder } from "./vault-item.model";
import {
  VaultFolderService,
  type FolderMutationOutcome,
  type FolderMutationOwnershipGuard,
} from "./vault-folder.service";

@Component({
  selector: "bw-vault-folder-dialog",
  standalone: true,
  imports: [
    AppBottomSheetComponent,
    BitIconButtonComponent,
    ButtonComponent,
    DialogComponent,
    DialogFooterDirective,
    I18nPipe,
    OfficialAddEditFolderDialogComponent,
  ],
  template: `
    <bw-app-bottom-sheet
      #folderDialog
      labelledBy="folder-dialog-title"
      testId="folder-dialog"
      (dismissed)="close()"
      (closed)="onFolderDialogClosed()"
      (click)="onFolderDialogClick($event)"
    >
      <bw-official-add-edit-folder-dialog
        [mode]="editingFolderId ? 'edit' : 'add'"
        [folder]="officialFolder"
        [saving]="isSaving"
        [errorMessage]="errorMessage()"
        (submitFolder)="submit($event)"
        (deleteFolder)="requestDelete()"
        (cancel)="close()"
      />
    </bw-app-bottom-sheet>

    <bw-app-bottom-sheet
      #deleteDialog
      testId="delete-folder-confirmation"
      labelledBy="delete-folder-title"
      (dismissed)="closeDeleteDialog()"
      (closed)="onDeleteDialogClosed()"
      (click)="onDeleteDialogClick($event)"
    >
      <form bit-dialog dialogSize="small" (submit)="confirmDelete($event)">
        <span bitDialogTitle id="delete-folder-title">{{ "i18nPermanentDeleteFolder" | i18n }}</span>
        <ng-container bitDialogContent>
          <p>{{ "i18nDeleteFolderContent" | i18n }}</p>
        </ng-container>
        <ng-container bitDialogFooter>
          <button bitButton buttonType="danger" type="submit" [disabled]="isSaving">
            {{ isSaving ? ("i18nDeleting" | i18n) : ("i18nDelete" | i18n) }}
          </button>
          <button #deleteCancel bitButton buttonType="secondary" type="button"
            data-testid="delete-folder-cancel" [disabled]="isSaving" (click)="closeDeleteDialog()">
            {{ "cancel" | i18n }}
          </button>
        </ng-container>
      </form>
    </bw-app-bottom-sheet>
  `,
})
export class VaultFolderDialogComponent implements OnDestroy {
  @ViewChild("folderDialog") private folderDialog?: AppBottomSheetComponent;
  @ViewChild("deleteDialog") private deleteDialog?: AppBottomSheetComponent;
  @ViewChild("deleteCancel", { read: ElementRef }) private deleteCancel?: ElementRef<HTMLButtonElement>;
  @Output() readonly folderCreated = new EventEmitter<VaultFolder>();

  editingFolderId = "";
  folderName = "";
  officialFolder: FolderView | null = null;
  isSaving = false;
  readonly errorMessage = signal("");
  isOpen = false;
  private sourceFolder: VaultFolder | null = null;
  private outerTrigger: HTMLElement | null = null;
  private deleteTrigger: HTMLElement | null = null;
  private restoreOuterFocusAfterDeleteClose = false;
  private operationToken = 0;

  constructor(
    private readonly store: PopupStateStore,
    private readonly folderService: VaultFolderService,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  ngOnDestroy(): void {
    this.operationToken += 1;
    this.outerTrigger = null;
    this.restoreOuterFocusAfterDeleteClose = false;
  }

  openFor(folder?: VaultFolder, trigger?: HTMLElement | null): void {
    const outerTrigger = trigger
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    this.operationToken += 1;
    this.deleteDialog?.close(false);
    this.folderDialog?.close(false);
    this.outerTrigger = outerTrigger;
    this.restoreOuterFocusAfterDeleteClose = false;
    this.sourceFolder = folder ? this.currentFolder(folder.id) : null;
    this.officialFolder = this.sourceFolder
      ? FolderView.fromJSON(this.sourceFolder as Parameters<typeof FolderView.fromJSON>[0])
      : null;
    this.editingFolderId = this.sourceFolder?.id ?? "";
    this.folderName = this.sourceFolder?.name ?? "";
    this.deleteTrigger = null;
    this.errorMessage.set("");
    this.isSaving = false;
    this.isOpen = true;
    this.changeDetectorRef.detectChanges();
    const folderName = this.folderDialog?.nativeElement.querySelector<HTMLInputElement>("#folderName");
    this.folderDialog?.open(this.outerTrigger, folderName);
  }

  async save(): Promise<FolderMutationOutcome> {
    if (this.isSaving) {
      return duplicateFolderMutation();
    }
    if (!this.folderName.trim()) {
      return saveFailure();
    }
    return this.commitSave({
      mode: this.editingFolderId ? "edit" : "add",
      folderId: this.editingFolderId,
      name: this.folderName,
    });
  }

  async submit(submission: OfficialFolderDialogSubmit | Event): Promise<FolderMutationOutcome> {
    if (submission instanceof Event) {
      submission.preventDefault();
      return this.save();
    }
    if (this.isSaving) {
      return duplicateFolderMutation();
    }
    if (!submission.name.trim()) {
      return saveFailure();
    }

    this.folderName = submission.name;
    return this.commitSave(submission);
  }

  requestDelete(): void {
    if (!this.editingFolderId || this.isSaving) {
      return;
    }
    if (this.currentFolder(this.editingFolderId) !== this.sourceFolder) {
      this.close();
      return;
    }
    this.deleteTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.folderDialog?.close(false);
    this.deleteDialog?.open(this.deleteTrigger, this.deleteCancel?.nativeElement ?? null);
  }

  cancelDelete(event: Event): void {
    event.preventDefault();
    this.closeDeleteDialog();
  }

  async confirmDelete(event?: Event): Promise<FolderMutationOutcome> {
    event?.preventDefault();
    if (this.isSaving) {
      return duplicateFolderMutation();
    }
    if (!this.editingFolderId) {
      return deleteFailure();
    }

    const token = this.operationToken;
    const session = this.store.snapshot().activeSession;
    const sourceFolder = this.sourceFolder;
    const folderId = this.editingFolderId;
    const ownership = this.ownershipGuard(token, sourceFolder, folderId);
    if (!this.contextCurrent(token, session, sourceFolder, folderId)) {
      this.close();
      return staleFolderMutation();
    }

    this.isSaving = true;
    this.errorMessage.set("");
    const outcome = await this.folderService.delete(session, folderId, ownership).catch(() => deleteFailure());

    if (this.operationToken !== token) {
      return staleFolderMutation();
    }
    if (!this.contextCurrent(token, session, sourceFolder, folderId)) {
      this.close();
      return staleFolderMutation();
    }

    this.isSaving = false;
    if (!outcome.committed) {
      this.finishNotCommitted(outcome, true);
      return outcome;
    }
    this.store.deleteFolder(folderId);
    this.close();
    return outcome;
  }

  onFolderDialogClick(event: Event): void {
    if (isOfficialCloseButton(event.target)) {
      this.close();
    }
  }

  onDeleteDialogClick(event: Event): void {
    if (isOfficialCloseButton(event.target)) {
      this.closeDeleteDialog();
    }
  }

  close(): void {
    this.operationToken += 1;
    const folderDialogOpen = this.folderDialog?.nativeElement.open ?? false;
    const deleteDialogOpen = this.deleteDialog?.nativeElement.open ?? false;
    this.isOpen = false;
    this.restoreOuterFocusAfterDeleteClose = !folderDialogOpen && deleteDialogOpen;
    this.deleteDialog?.close(false);
    this.folderDialog?.close();
    if (!folderDialogOpen && !deleteDialogOpen) {
      this.finishOuterClose(true);
    }
    this.editingFolderId = "";
    this.folderName = "";
    this.deleteTrigger = null;
    this.officialFolder = null;
    this.sourceFolder = null;
    this.isSaving = false;
    this.errorMessage.set("");
  }

  closeDeleteDialog(reopenFolder = true): void {
    this.deleteDialog?.close(false);
    if (reopenFolder && this.isOpen && this.editingFolderId) {
      const folderName = this.folderDialog?.nativeElement.querySelector<HTMLInputElement>("#folderName");
      const initialFocus = this.deleteTrigger?.isConnected ? this.deleteTrigger : folderName;
      this.folderDialog?.open(this.outerTrigger, initialFocus);
    }
  }

  onFolderDialogClosed(): void {
    if (!this.isOpen) {
      this.finishOuterClose(true);
    }
  }

  onDeleteDialogClosed(): void {
    if (!this.isOpen && this.restoreOuterFocusAfterDeleteClose) {
      this.finishOuterClose(true);
    }
  }

  private async commitSave(submission: OfficialFolderDialogSubmit): Promise<FolderMutationOutcome> {
    const token = this.operationToken;
    const session = this.store.snapshot().activeSession;
    const sourceFolder = this.sourceFolder;
    const folderId = submission.mode === "edit" ? submission.folderId : "";
    const ownership = this.ownershipGuard(token, sourceFolder, folderId);
    if (!this.contextCurrent(token, session, sourceFolder, folderId)) {
      this.close();
      return staleFolderMutation();
    }

    this.isSaving = true;
    this.errorMessage.set("");
    const outcome = await (submission.mode === "edit"
      ? this.folderService.update(session, submission.folderId, submission.name, ownership)
      : this.folderService.create(session, submission.name, ownership)
    ).catch(() => saveFailure());

    if (this.operationToken !== token) {
      return staleFolderMutation();
    }
    if (!this.contextCurrent(token, session, sourceFolder, folderId)) {
      this.close();
      return staleFolderMutation();
    }

    this.isSaving = false;
    if (!outcome.committed || !outcome.folder) {
      const notCommitted = outcome.committed ? saveFailure() : outcome;
      this.finishNotCommitted(notCommitted, false);
      return notCommitted;
    }

    const folder = this.store.saveFolder(outcome.folder);
    this.close();
    if (submission.mode === "add") {
      this.folderCreated.emit(folder);
    }
    return outcome;
  }

  private finishOuterClose(restoreFocus: boolean): void {
    const trigger = this.outerTrigger;
    const token = this.operationToken;
    this.outerTrigger = null;
    this.restoreOuterFocusAfterDeleteClose = false;
    if (restoreFocus && trigger?.isConnected) {
      window.setTimeout(() => {
        if (this.operationToken === token && !this.isOpen && trigger.isConnected) {
          trigger.focus();
        }
      });
    }
  }

  private ownershipGuard(
    token: number,
    sourceFolder: VaultFolder | null,
    folderId: string,
  ): FolderMutationOwnershipGuard {
    return {
      isCurrent: () => this.operationToken === token
        && this.sourceFolder === sourceFolder
        && (!folderId || this.currentFolder(folderId) === sourceFolder),
    };
  }

  private contextCurrent(
    token: number,
    session: ReturnType<PopupStateStore["snapshot"]>["activeSession"],
    sourceFolder: VaultFolder | null,
    folderId: string,
  ): boolean {
    return this.operationToken === token
      && this.store.snapshot().activeSession === session
      && this.sourceFolder === sourceFolder
      && (!folderId || this.currentFolder(folderId) === sourceFolder);
  }

  private currentFolder(folderId: string): VaultFolder | null {
    return this.store.snapshot().folders.find((folder) => folder.id === folderId) ?? null;
  }

  private finishNotCommitted(outcome: FolderMutationOutcome, deleting: boolean): void {
    if (outcome.committed) {
      return;
    }
    if (outcome.reason === "stale") {
      this.close();
      return;
    }
    if (deleting) {
      this.closeDeleteDialog();
    }
    this.errorMessage.set(
      outcome.status || translateOfficialMessage(
        deleting ? "i18nDeleteFolderFailed" : "i18nSaveFolderFailed",
      ),
    );
  }
}

function isOfficialCloseButton(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button")?.querySelector(".bwi-close"));
}

function saveFailure(): FolderMutationOutcome {
  return {
    committed: false,
    reason: "failure",
    status: translateOfficialMessage("i18nSaveFolderFailed"),
  };
}

function deleteFailure(): FolderMutationOutcome {
  return {
    committed: false,
    reason: "failure",
    status: translateOfficialMessage("i18nDeleteFolderFailed"),
  };
}

function duplicateFolderMutation(): FolderMutationOutcome {
  return { committed: false, reason: "duplicate", status: "" };
}

function staleFolderMutation(): FolderMutationOutcome {
  return { committed: false, reason: "stale", status: "" };
}
