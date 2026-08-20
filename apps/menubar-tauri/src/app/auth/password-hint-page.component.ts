import { Component, DestroyRef, ViewChild } from "@angular/core";

import { OfficialI18nService } from "../official-ui/official-i18n.service";
import { OfficialAnonymousShellComponent } from "../upstream-overlays/auth/anonymous/official-anonymous-shell.component";
import { OfficialPasswordHintComponent } from "../upstream-overlays/auth/login/official-password-hint.component";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";

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

  constructor(
    readonly i18n: OfficialI18nService,
    routeCache: PopupRouterCacheService,
    destroyRef: DestroyRef,
  ) {
    const releaseBackOwner = routeCache.registerBackOwner(() => this.backAction());
    destroyRef.onDestroy(releaseBackOwner);
  }

  readonly backAction = (): Promise<void> => this.hint?.cancel() ?? Promise.resolve();
}
