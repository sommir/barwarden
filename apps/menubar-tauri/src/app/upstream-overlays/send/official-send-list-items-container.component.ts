import { CommonModule } from "@angular/common";
import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import { BitIconButtonComponent } from "@bitwarden/components/icon-button/icon-button.component";
import { IconComponent } from "@bitwarden/components/icon/icon.component";
import { ItemActionComponent } from "@bitwarden/components/item/item-action.component";
import { ItemComponent } from "@bitwarden/components/item/item.component";
import { ItemContentComponent } from "@bitwarden/components/item/item-content.component";
import { ItemGroupComponent } from "@bitwarden/components/item/item-group.component";
import { SectionComponent } from "@bitwarden/components/section/section.component";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import {
  MenuComponent,
  MenuItemComponent,
  MenuTriggerForDirective,
} from "../../official-ui/official-components";
import { I18nPipe } from "../../official-ui/official-ui-common";

export interface OfficialTextSendListItem {
  readonly id: string;
  readonly name: string;
  readonly deletionDate: string;
  readonly disabled: boolean;
  readonly expired: boolean;
  readonly maxAccessCountReached: boolean;
  readonly hasPassword: boolean;
}

export interface OfficialTextSendCopyRequest {
  readonly send: OfficialTextSendListItem;
  readonly trigger: Event;
}

@Component({
  selector: "bw-official-send-list-items-container",
  standalone: true,
  imports: [
    BitIconButtonComponent,
    CommonModule,
    I18nPipe,
    IconComponent,
    ItemActionComponent,
    ItemComponent,
    ItemContentComponent,
    ItemGroupComponent,
    MenuComponent,
    MenuItemComponent,
    MenuTriggerForDirective,
    SectionComponent,
    SectionHeaderComponent,
  ],
  templateUrl: "./official-send-list-items-container.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfficialSendListItemsContainerComponent {
  readonly sends = input.required<readonly OfficialTextSendListItem[]>();
  readonly headerText = input.required<string>();

  readonly open = output<OfficialTextSendListItem>();
  readonly copyLink = output<OfficialTextSendCopyRequest>();
  readonly delete = output<OfficialTextSendListItem>();

  requestDelete(send: OfficialTextSendListItem, trigger: BitIconButtonComponent): void {
    trigger.getFocusTarget().focus();
    this.delete.emit(send);
  }

  trackById(_index: number, send: OfficialTextSendListItem): string {
    return send.id;
  }
}
