import { Component, ViewChild } from "@angular/core";
import { PopupStateStore } from "../popup-state";
import { OfficialAnonymousShellComponent } from "../upstream-overlays/auth/anonymous/official-anonymous-shell.component";
import { OfficialNewDeviceVerificationComponent } from "../upstream-overlays/auth/new-device/official-new-device-verification.component";
import { OfficialI18nService } from "../official-ui/official-i18n.service";

@Component({
  selector: "bw-new-device-verification-page",
  standalone: true,
  imports: [OfficialAnonymousShellComponent, OfficialNewDeviceVerificationComponent],
  template: `
    <bw-official-anonymous-shell
      [pageTitle]="i18n.t('verifyYourIdentity')"
      [pageSubtitle]="email"
      [showBackButton]="true"
      [backAction]="backAction"
    >
      <bw-official-new-device-verification />
    </bw-official-anonymous-shell>
  `,
})
export class NewDeviceVerificationPageComponent {
  @ViewChild(OfficialNewDeviceVerificationComponent)
  private challenge?: OfficialNewDeviceVerificationComponent;

  constructor(
    private readonly store: PopupStateStore,
    readonly i18n: OfficialI18nService,
  ) {}

  get email(): string {
    return this.store.snapshot().authChallenge?.email ?? "";
  }

  readonly backAction = (): Promise<void> => this.challenge?.goBack() ?? Promise.resolve();
}
