import { Injectable, Injector, afterNextRender, inject } from "@angular/core";
import { NavigationEnd, NavigationStart, Router } from "@angular/router";

import { ScrollLayoutService } from "@bitwarden/components";

import {
  POPUP_ROUTER_CACHE_ROUTE_GRAPH,
  type PopupRouterCacheLifecyclePort,
} from "./popup-router-cache.lifecycle";
import { PopupRouteReuseStrategy } from "./popup-route-reuse.strategy";

export type RetainedPopupRoute = string;

type CacheEntry = {
  url: RetainedPopupRoute;
  scrollTop: number;
};

@Injectable({ providedIn: "root" })
export class PopupRouterCacheService implements PopupRouterCacheLifecyclePort {
  private readonly router = inject(Router);
  private readonly scrollLayout = inject(ScrollLayoutService);
  private readonly injector = inject(Injector);
  private readonly routeReuse = inject(PopupRouteReuseStrategy);
  private readonly retainedRoutes = new Set(inject(POPUP_ROUTER_CACHE_ROUTE_GRAPH));
  private entries: CacheEntry[] = [];
  private restoring = false;

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart && !this.restoring) {
        this.captureScroll();
      } else if (event instanceof NavigationEnd) {
        this.record(event.urlAfterRedirects);
      }
    });
  }

  history(): readonly RetainedPopupRoute[] {
    return this.entries.map(({ url }) => url);
  }

  canRetain(url: string): url is RetainedPopupRoute {
    return this.retainedRoutes.has(url);
  }

  clear(): void {
    this.entries = [];
    this.routeReuse.clear();
  }

  async restore(): Promise<boolean> {
    const hadEntries = this.entries.length > 0;
    while (this.entries.length > 0) {
      const entry = this.entries[this.entries.length - 1]!;
      if (await this.navigateAndRestore(entry)) {
        return true;
      }
      this.entries.pop();
    }

    if (hadEntries) {
      await this.navigateFallback();
      return true;
    }

    return false;
  }

  async back(): Promise<void> {
    this.captureScroll();
    this.entries.pop();

    while (this.entries.length > 0) {
      const entry = this.entries[this.entries.length - 1]!;
      if (await this.navigateAndRestore(entry)) {
        return;
      }
      this.entries.pop();
    }

    await this.navigateFallback();
  }

  private record(url: string): void {
    if (this.restoring || !this.canRetain(url) || this.entries.at(-1)?.url === url) {
      return;
    }

    this.entries.push({ url, scrollTop: 0 });
  }

  private captureScroll(): void {
    const entry = this.entries.at(-1);
    const host = this.scrollLayout.scrollableRef()?.nativeElement;

    if (entry && host) {
      entry.scrollTop = host.scrollTop;
    }
  }

  private async navigateAndRestore(entry: CacheEntry): Promise<boolean> {
    await this.navigate(entry.url);

    if (this.router.url !== entry.url) {
      return false;
    }

    afterNextRender(
      {
        write: () => {
          if (this.entries.at(-1) === entry) {
            const host = this.scrollLayout.scrollableRef()?.nativeElement;
            if (host) {
              host.scrollTop = entry.scrollTop;
            }
          }
        },
      },
      { injector: this.injector },
    );

    return true;
  }

  private async navigateFallback(): Promise<void> {
    await this.navigate("/tabs/vault");
  }

  private async navigate(url: RetainedPopupRoute): Promise<boolean> {
    this.restoring = true;
    try {
      return await this.router.navigateByUrl(url, { replaceUrl: true });
    } catch {
      return false;
    } finally {
      this.restoring = false;
    }
  }
}
