import { Component, EventEmitter, Input, Output } from "@angular/core";

import { PopupHeaderComponent } from "../../../layout/popup-header.component";
import { PopupPageComponent } from "../../../layout/popup-page.component";
import {
  BitIconButtonComponent,
  ItemActionComponent,
  ItemComponent,
  ItemContentComponent,
  ItemGroupComponent,
  MenuComponent,
  MenuItemComponent,
  MenuTriggerForDirective,
  NoItemsComponent,
  SectionComponent,
  SectionHeaderComponent,
  TypographyDirective,
} from "../../../official-ui/official-components";
import type { RetainedPopupCipherView } from "../../../vault/popup-cipher-view.adapter";
import type { RecoveryPageCommand } from "../recovery-command";
import { OfficialRecoveryCipherIconComponent } from "../recovery-cipher-icon.component";
import { I18nPipe } from "../../../official-ui/official-ui-common";

@Component({
  selector: "bw-official-archive",
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
    NoItemsComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    SectionComponent,
    SectionHeaderComponent,
    TypographyDirective,
    OfficialRecoveryCipherIconComponent,
  ],
  templateUrl: "./official-archive.component.html",
})
export class OfficialArchiveComponent {
  @Input({ required: true }) readonly items: readonly RetainedPopupCipherView[] = [];
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly command = new EventEmitter<RecoveryPageCommand>();
  @Output() readonly popOut = new EventEmitter<void>();

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.back.emit();

  emit(command: RecoveryPageCommand["command"], item: RetainedPopupCipherView): void {
    this.command.emit({ command, location: "archive", item });
  }
}
