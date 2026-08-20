import { Component, ViewChild } from "@angular/core";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { OfficialAnonymousShellComponent } from "../upstream-overlays/auth/anonymous/official-anonymous-shell.component";
import { OfficialPasswordHintComponent } from "../upstream-overlays/auth/login/official-password-hint.component";

@Component({
  selector: "bw-password-hint-page",
  standalone: true,
  imports: [OfficialAnonymousShellComponent, OfficialPasswordHintComponent],
  template: `
    <bw-official-anonymous-shell
      [pageTitle]="i18n.t('requestHint')"
      [showBackButton]="true"
      [backAction]="backAction"
    >
      <bw-official-password-hint />
    </bw-official-anonymous-shell>
  `,
})
export class PasswordHintPageComponent {
  @ViewChild(OfficialPasswordHintComponent)
  private hint?: OfficialPasswordHintComponent;

  constructor(readonly i18n: OfficialI18nService) {}

  readonly backAction = (): Promise<void> => this.hint?.cancel() ?? Promise.resolve();
}
