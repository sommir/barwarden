import { Component, EventEmitter, Input, Output } from "@angular/core";

import { EmptyTrash } from "@bitwarden/assets/svg";

import { PopupHeaderComponent } from "../../../layout/popup-header.component";
import { PopupPageComponent } from "../../../layout/popup-page.component";
import {
  BitIconButtonComponent,
  NoItemsComponent,
} from "../../../official-ui/official-components";
import { MacosAlertStripComponent } from "../../../official-ui/macos-alert-strip.component";
import { I18nPipe } from "../../../official-ui/official-ui-common";
import type { RetainedPopupCipherView } from "../../../vault/popup-cipher-view.adapter";
import type { RecoveryPageCommand } from "../recovery-command";
import { OfficialTrashListItemsContainerComponent } from "./official-trash-list-items-container.component";

@Component({
  selector: "bw-official-trash",
  standalone: true,
  imports: [
    BitIconButtonComponent,
    I18nPipe,
    MacosAlertStripComponent,
    NoItemsComponent,
    OfficialTrashListItemsContainerComponent,
    PopupHeaderComponent,
    PopupPageComponent,
  ],
  templateUrl: "./official-trash.component.html",
})
export class OfficialTrashComponent {
  @Input({ required: true }) readonly items: readonly RetainedPopupCipherView[] = [];
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly command = new EventEmitter<RecoveryPageCommand>();
  @Output() readonly popOut = new EventEmitter<void>();

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.back.emit();
  readonly emptyTrashIcon = EmptyTrash;
}
