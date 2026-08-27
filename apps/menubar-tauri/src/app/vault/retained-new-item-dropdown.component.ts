import { AfterViewInit, Component, ElementRef, Input, OnDestroy, ViewChild } from "@angular/core";

import {
  NewItemDropdownComponent,
  type NewItemInitialValues,
} from "@bitwarden/official-vault-popup/new-item-dropdown.component";
import { DialogService } from "@bitwarden/components";

import { retainedNewItemProviders } from "./retained-item-types.provider";
import { VaultFolderDialogComponent } from "./vault-folder-dialog.component";

export class RetainedFolderDialogService {
  private dialog?: VaultFolderDialogComponent;

  bind(dialog: VaultFolderDialogComponent): void {
    this.dialog = dialog;
  }

  unbind(dialog: VaultFolderDialogComponent): void {
    if (this.dialog === dialog) {
      this.dialog = undefined;
    }
  }

  openFolderDialog(): void {
    if (!this.dialog) {
      throw new Error("The retained folder dialog is not bound.");
    }
    this.dialog.openFor();
  }
}

@Component({
  selector: "bw-retained-new-item-dropdown",
  standalone: true,
  imports: [NewItemDropdownComponent, VaultFolderDialogComponent],
  providers: [
    ...retainedNewItemProviders,
    RetainedFolderDialogService,
    { provide: DialogService, useExisting: RetainedFolderDialogService },
  ],
  template: `
    <app-new-item-dropdown [initialValues]="initialValues" />
    <bw-vault-folder-dialog />
  `,
})
export class RetainedNewItemDropdownComponent implements AfterViewInit, OnDestroy {
  @Input() initialValues?: NewItemInitialValues;
  @ViewChild(VaultFolderDialogComponent) private folderDialog?: VaultFolderDialogComponent;
  @ViewChild(NewItemDropdownComponent, { read: ElementRef })
  private newItemDropdownHost?: ElementRef<HTMLElement>;

  constructor(private readonly retainedDialog: RetainedFolderDialogService) {}

  ngAfterViewInit(): void {
    if (this.folderDialog) {
      this.retainedDialog.bind(this.folderDialog);
    }
    const trigger = this.newItemDropdownHost?.nativeElement
      .querySelector<HTMLButtonElement>("button[bitbutton]");
    if (!trigger) throw new Error("Retained New Item trigger is unavailable.");
    trigger.dataset["popupFocusKey"] = "vault:new-item";
  }

  ngOnDestroy(): void {
    if (this.folderDialog) {
      this.retainedDialog.unbind(this.folderDialog);
    }
  }
}
