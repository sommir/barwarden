import { AfterViewInit, Component, Input, OnDestroy, ViewChild } from "@angular/core";

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

  constructor(private readonly retainedDialog: RetainedFolderDialogService) {}

  ngAfterViewInit(): void {
    if (this.folderDialog) {
      this.retainedDialog.bind(this.folderDialog);
    }
  }

  ngOnDestroy(): void {
    if (this.folderDialog) {
      this.retainedDialog.unbind(this.folderDialog);
    }
  }
}
