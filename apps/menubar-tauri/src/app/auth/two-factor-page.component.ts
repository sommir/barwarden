import { Component, DestroyRef, ViewChild } from "@angular/core";

import { PopupStateStore } from "../popup-state";
import { OfficialAnonymousShellComponent } from "../upstream-overlays/auth/anonymous/official-anonymous-shell.component";
import { OfficialTwoFactorComponent } from "../upstream-overlays/auth/two-factor/official-two-factor.component";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";

@Component({
  selector: "bw-two-factor-page",
  standalone: true,
  imports: [OfficialAnonymousShellComponent, OfficialTwoFactorComponent],
  template: `
    <bw-official-anonymous-shell
      [pageTitle]="i18n.t('twoStepLogin')"
      [pageSubtitle]="email"
      [showBackButton]="true"
      [backAction]="backAction"
    >
      <bw-official-two-factor />
    </bw-official-anonymous-shell>
  `,
})
export class TwoFactorPageComponent {
  @ViewChild(OfficialTwoFactorComponent)
  private challenge?: OfficialTwoFactorComponent;

  constructor(
    private readonly store: PopupStateStore,
    readonly i18n: OfficialI18nService,
    routeCache: PopupRouterCacheService,
    destroyRef: DestroyRef,
  ) {
    const releaseBackOwner = routeCache.registerBackOwner(() => this.backAction());
    destroyRef.onDestroy(releaseBackOwner);
  }

  get email(): string {
    return this.store.snapshot().authChallenge?.email ?? "";
  }

  readonly backAction = (): Promise<void> => this.challenge?.back() ?? Promise.resolve();
}
