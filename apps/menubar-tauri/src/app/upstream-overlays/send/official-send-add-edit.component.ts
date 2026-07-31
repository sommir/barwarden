import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";

import { PopupFooterComponent } from "@bitwarden/browser-popup/layout/popup-footer.component";
import { PopupHeaderComponent } from "@bitwarden/browser-popup/layout/popup-header.component";
import { PopupPageComponent } from "@bitwarden/browser-popup/layout/popup-page.component";
import { ButtonComponent, CalloutComponent } from "../../official-ui/official-components";
import { translateOfficialMessage } from "../../official-ui/official-i18n.service";
import { I18nPipe } from "../../official-ui/official-ui-common";
import type { RetainedTextSendFormValue } from "../../send/retained-text-send-form.service";
import { OfficialSendDetailsComponent } from "./official-send-details.component";

export type OfficialSendMode = "add" | "edit";

@Component({ selector: "bw-official-send-add-edit", standalone: true, imports: [ButtonComponent, CalloutComponent, I18nPipe, OfficialSendDetailsComponent, PopupFooterComponent, PopupHeaderComponent, PopupPageComponent], templateUrl: "./official-send-add-edit.component.html", changeDetection: ChangeDetectionStrategy.OnPush })
export class OfficialSendAddEditComponent {
  readonly mode = input<OfficialSendMode>("add"); readonly editing = input(false); readonly disabled = input(false); readonly pending = input(false); readonly valid = input(false); readonly unavailable = input(false); readonly value = input<RetainedTextSendFormValue>({ name: "", text: "", hidden: false, deletionPresetHours: 168, authType: "none", password: "", maxAccessCount: "", hideEmail: false, notes: "" }); readonly originalHadPassword = input(false); readonly hideEmailAllowed = input(true); readonly status = input<string>("");
  readonly backAction: import("@bitwarden/components/utils/function-to-observable").FunctionReturningAwaitable = () => { this.back.emit(); };
  readonly edit = output<void>(); readonly save = output<void>(); readonly cancel = output<void>(); readonly back = output<void>(); readonly delete = output<void>(); readonly removePassword = output<void>(); readonly generatePassword = output<void>(); readonly copyPassword = output<Event>(); readonly valueChange = output<Partial<RetainedTextSendFormValue>>(); readonly editingChange = output<boolean>();
  get title(): string {
    return translateOfficialMessage(
      this.mode() === "add"
        ? "i18nAddTextSend"
        : this.editing()
          ? "i18nEditTextSend"
          : "i18nViewTextSend",
    );
  }
}
