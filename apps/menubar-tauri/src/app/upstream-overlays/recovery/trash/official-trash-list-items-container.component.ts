import { Component, EventEmitter, Input, Output } from "@angular/core";

import {
  BitIconButtonComponent,
  ItemActionComponent,
  ItemComponent,
  ItemContentComponent,
  ItemGroupComponent,
  MenuComponent,
  MenuItemComponent,
  MenuTriggerForDirective,
  SectionComponent,
  SectionHeaderComponent,
  TypographyDirective,
} from "../../../official-ui/official-components";
import type { RetainedPopupCipherView } from "../../../vault/popup-cipher-view.adapter";
import type { RecoveryPageCommand } from "../recovery-command";
import { OfficialRecoveryCipherIconComponent } from "../recovery-cipher-icon.component";
import { I18nPipe } from "../../../official-ui/official-ui-common";

@Component({
  selector: "bw-official-trash-list-items-container",
  standalone: true,
  imports: [
    BitIconButtonComponent,
    I18nPipe,
    ItemActionComponent,
    ItemComponent,
    ItemContentComponent,
    ItemGroupComponent,
    MenuComponent,
    MenuItemComponent,
    MenuTriggerForDirective,
    SectionComponent,
    SectionHeaderComponent,
    TypographyDirective,
    OfficialRecoveryCipherIconComponent,
  ],
  templateUrl: "./official-trash-list-items-container.component.html",
})
export class OfficialTrashListItemsContainerComponent {
  @Input({ required: true }) readonly headerText = "";
  @Input({ required: true }) readonly items: readonly RetainedPopupCipherView[] = [];
  @Output() readonly command = new EventEmitter<RecoveryPageCommand>();

  emit(command: RecoveryPageCommand["command"], item: RetainedPopupCipherView): void {
    this.command.emit({ command, location: "trash", item });
  }
}
