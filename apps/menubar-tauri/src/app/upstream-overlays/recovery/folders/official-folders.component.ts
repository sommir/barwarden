import { Component, EventEmitter, Input, Output } from "@angular/core";

import { NoFolders } from "@bitwarden/assets/svg";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";

import { PopupHeaderComponent } from "../../../layout/popup-header.component";
import { PopupPageComponent } from "../../../layout/popup-page.component";
import {
  BitIconButtonComponent,
  ButtonComponent,
  ItemComponent,
  ItemContentComponent,
  ItemGroupComponent,
  NoItemsComponent,
} from "../../../official-ui/official-components";
import { I18nPipe } from "../../../official-ui/official-ui-common";

@Component({
  selector: "bw-official-folders",
  standalone: true,
  imports: [
    BitIconButtonComponent,
    I18nPipe,
    ButtonComponent,
    ItemComponent,
    ItemContentComponent,
    ItemGroupComponent,
    NoItemsComponent,
    PopupHeaderComponent,
    PopupPageComponent,
  ],
  templateUrl: "./official-folders.component.html",
})
export class OfficialFoldersComponent {
  @Input({ required: true }) readonly folders: readonly FolderView[] = [];
  @Output() readonly addFolder = new EventEmitter<void>();
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly editFolder = new EventEmitter<FolderView>();
  @Output() readonly popOut = new EventEmitter<void>();

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.back.emit();
  readonly NoFoldersIcon = NoFolders;
}
