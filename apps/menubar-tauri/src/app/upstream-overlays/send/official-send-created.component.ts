import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import { ActiveSendIcon } from "@bitwarden/assets/svg";
import { SvgModule } from "@bitwarden/components";

import { PopupFooterComponent } from "@bitwarden/browser-popup/layout/popup-footer.component";
import { PopupHeaderComponent } from "@bitwarden/browser-popup/layout/popup-header.component";
import { PopupPageComponent } from "@bitwarden/browser-popup/layout/popup-page.component";
import { ButtonComponent } from "@bitwarden/components/button/button.component";
import { BitIconButtonComponent } from "@bitwarden/components/icon-button/icon-button.component";
import { I18nPipe } from "../../official-ui/official-ui-common";

export interface OfficialCreatedTextSend {
  readonly id: string;
  readonly name: string;
  readonly deletionDate: string;
  readonly hasPassword: boolean;
}

@Component({
  selector: "bw-official-send-created",
  standalone: true,
  imports: [
    BitIconButtonComponent,
    ButtonComponent,
    I18nPipe,
    PopupFooterComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    SvgModule,
  ],
  templateUrl: "./official-send-created.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfficialSendCreatedComponent {
  readonly send = input.required<OfficialCreatedTextSend>();
  readonly formattedExpiration = input.required<string>();
  readonly link = input.required<string>();
  readonly copyLink = output<Event>();
  readonly close = output<void>();
  readonly popOut = output<void>();

  readonly sendCreatedIcon = ActiveSendIcon;
  readonly backAction: import("@bitwarden/components/utils/function-to-observable").FunctionReturningAwaitable = () => {
    this.close.emit();
  };
}
