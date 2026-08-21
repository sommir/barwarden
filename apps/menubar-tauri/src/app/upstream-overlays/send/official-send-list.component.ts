import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { PopupHeaderComponent } from "@bitwarden/browser-popup/layout/popup-header.component";
import { PopupPageComponent } from "@bitwarden/browser-popup/layout/popup-page.component";
import { ButtonComponent } from "@bitwarden/components/button/button.component";
import { CalloutComponent } from "../../official-ui/official-components";
import { BitIconButtonComponent } from "@bitwarden/components/icon-button/icon-button.component";
import { ItemGroupComponent } from "@bitwarden/components/item/item-group.component";
import { NoItemsComponent } from "@bitwarden/components/no-items/no-items.component";
import { SearchComponent } from "@bitwarden/components/search/search.component";
import { SkeletonComponent } from "@bitwarden/components/skeleton/skeleton.component";
import { I18nPipe } from "../../official-ui/official-ui-common";
import {
  OfficialSendListItemsContainerComponent,
  type OfficialTextSendCopyRequest,
  type OfficialTextSendListItem,
} from "./official-send-list-items-container.component";

@Component({
  selector: "bw-official-send-list",
  standalone: true,
  imports: [
    BitIconButtonComponent,
    ButtonComponent,
    CalloutComponent,
    FormsModule,
    I18nPipe,
    ItemGroupComponent,
    NoItemsComponent,
    OfficialSendListItemsContainerComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    SearchComponent,
    SkeletonComponent,
  ],
  templateUrl: "./official-send-list.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfficialSendListComponent {
  readonly sends = input.required<readonly OfficialTextSendListItem[]>();
  readonly query = input.required<string>();
  readonly filtersVisible = input.required<boolean>();
  readonly filterType = input.required<"" | "text">();
  readonly loading = input.required<boolean>();
  readonly disabled = input.required<boolean>();
  readonly state = input.required<OfficialSendListState>();

  readonly queryChange = output<string>();
  readonly toggleFilters = output<void>();
  readonly filterChange = output<"" | "text">();
  readonly open = output<OfficialTextSendListItem | undefined>();
  readonly copyLink = output<OfficialTextSendCopyRequest>();
  readonly delete = output<OfficialTextSendListItem>();

  inputValue(event: Event): "" | "text" {
    return event.target instanceof HTMLSelectElement && event.target.value === "text" ? "text" : "";
  }
}

export type OfficialSendListState = "empty" | "no-results" | "ready";
