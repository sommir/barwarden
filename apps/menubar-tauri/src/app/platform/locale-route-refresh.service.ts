import { Injectable, OnDestroy } from "@angular/core";
import { Router } from "@angular/router";
import { Subscription } from "rxjs";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { PopupRouteReuseStrategy } from "./popup-route-reuse.strategy";

/**
 * Rebuilds the current routed surface after a language change.
 *
 * Several retained official components compute translated labels while they are
 * constructed. The normal tab cache intentionally keeps those components
 * alive, so a locale change must explicitly invalidate the active route before
 * the cached Chinese labels can be shown again under an English locale.
 */
@Injectable({ providedIn: "root" })
export class LocaleRouteRefreshService implements OnDestroy {
  private initialized = false;
  private refreshChain = Promise.resolve();
  private readonly localeSubscription: Subscription;

  constructor(
    i18n: I18nService,
    private readonly router: Router,
    private readonly routeReuse: PopupRouteReuseStrategy,
  ) {
    this.localeSubscription = i18n.locale$.subscribe(() => {
      if (!this.initialized) {
        this.initialized = true;
        return;
      }

      this.refreshChain = this.refreshChain.then(() => this.refreshCurrentRoute());
    });
  }

  ngOnDestroy(): void {
    this.localeSubscription.unsubscribe();
  }

  private async refreshCurrentRoute(): Promise<void> {
    const currentUrl = this.router.url;
    if (!currentUrl || currentUrl === "/") {
      return;
    }

    this.routeReuse.beginLocaleRefresh();
    try {
      await this.router.navigateByUrl(currentUrl, { replaceUrl: true });
    } finally {
      this.routeReuse.completeLocaleRefresh();
    }
  }
}
