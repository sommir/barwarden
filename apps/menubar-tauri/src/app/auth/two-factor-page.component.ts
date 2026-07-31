import { Component } from "@angular/core";

import { PopupStateStore } from "../popup-state";
import { OfficialAnonymousShellComponent } from "../upstream-overlays/auth/anonymous/official-anonymous-shell.component";
import { OfficialTwoFactorComponent } from "../upstream-overlays/auth/two-factor/official-two-factor.component";
import { OfficialI18nService } from "../official-ui/official-i18n.service";

@Component({
  selector: "bw-two-factor-page",
  standalone: true,
  imports: [OfficialAnonymousShellComponent, OfficialTwoFactorComponent],
  template: `
    <bw-official-anonymous-shell [pageTitle]="i18n.t('twoStepLogin')" [pageSubtitle]="email">
      <bw-official-two-factor />
    </bw-official-anonymous-shell>
  `,
})
export class TwoFactorPageComponent {
  constructor(
    private readonly store: PopupStateStore,
    readonly i18n: OfficialI18nService,
  ) {}

  get email(): string {
    return this.store.snapshot().authChallenge?.email ?? "";
  }
}
