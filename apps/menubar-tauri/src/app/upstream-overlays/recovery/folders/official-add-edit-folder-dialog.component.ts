import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";

import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";

import {
  BitFormFieldComponent,
  BitHintDirective,
  BitIconButtonComponent,
  BitInputDirective,
  BitLabelComponent,
  ButtonComponent,
  DialogComponent,
  DialogFooterDirective,
} from "../../../official-ui/official-components";
import { MacosAlertStripComponent } from "../../../official-ui/macos-alert-strip.component";
import { I18nPipe } from "../../../official-ui/official-ui-common";

export interface OfficialFolderDialogSubmit {
  readonly mode: "add" | "edit";
  readonly folderId: string;
  readonly name: string;
}

@Component({
  selector: "bw-official-add-edit-folder-dialog",
  standalone: true,
  imports: [
    BitFormFieldComponent,
    I18nPipe,
    BitHintDirective,
    BitIconButtonComponent,
    BitInputDirective,
    BitLabelComponent,
    ButtonComponent,
    DialogComponent,
    DialogFooterDirective,
    MacosAlertStripComponent,
  ],
  templateUrl: "./official-add-edit-folder-dialog.component.html",
})
export class OfficialAddEditFolderDialogComponent implements OnChanges {
  @Input({ required: true }) mode: "add" | "edit" = "add";
  @Input() folder: FolderView | null = null;
  @Input() saving = false;
  @Input() errorMessage = "";
  @Output() readonly submitFolder = new EventEmitter<OfficialFolderDialogSubmit>();
  @Output() readonly deleteFolder = new EventEmitter<void>();
  @Output() readonly cancel = new EventEmitter<void>();

  name = "";

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["folder"] || changes["mode"]) {
      this.name = this.folder?.name ?? "";
    }
  }

  submit(event: Event): void {
    event.preventDefault();
    const name = this.name.trim();
    if (!name || this.saving) {
      return;
    }

    this.submitFolder.emit({ mode: this.mode, folderId: this.folder?.id ?? "", name });
  }

  inputValue(event: Event): void {
    this.name = event.target instanceof HTMLInputElement ? event.target.value : "";
  }
}
