import { Component } from "@angular/core";

import { OfficialAnonymousShellComponent } from "../upstream-overlays/auth/anonymous/official-anonymous-shell.component";
import { OfficialPasswordLoginComponent } from "../upstream-overlays/auth/login/official-password-login.component";
import { OfficialI18nService } from "../official-ui/official-i18n.service";

@Component({
  selector: "bw-login-page",
  standalone: true,
  imports: [OfficialAnonymousShellComponent, OfficialPasswordLoginComponent],
  template: `
    <bw-official-anonymous-shell [pageTitle]="i18n.t('logIn')">
      <bw-official-password-login />
    </bw-official-anonymous-shell>
  `,
})
export class LoginPageComponent {
  constructor(readonly i18n: OfficialI18nService) {}
}
