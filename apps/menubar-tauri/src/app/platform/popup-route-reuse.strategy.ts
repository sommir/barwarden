import { Injectable } from "@angular/core";
import {
  ActivatedRouteSnapshot,
  DetachedRouteHandle,
  RouteReuseStrategy,
  destroyDetachedRouteHandle,
} from "@angular/router";

/**
 * Keeps the tab shell and its primary pages alive while a full-screen detail
 * route is open. This prevents a detail back-navigation from rebuilding the
 * complete vault list and makes repeat tab changes immediate.
 */
@Injectable({ providedIn: "root" })
export class PopupRouteReuseStrategy implements RouteReuseStrategy {
  private readonly handles = new Map<string, DetachedRouteHandle>();
  private localeRefreshInProgress = false;

  shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return !this.localeRefreshInProgress && routeCacheKey(route) !== null;
  }

  store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    const key = routeCacheKey(route);
    if (key === null) {
      return;
    }

    // Angular passes null while it reattaches a stored tree. At that point the
    // router owns the view again, so clearing our reference must not destroy it.
    if (handle === null) {
      this.handles.delete(key);
      return;
    }

    this.clearHandle(key);
    this.handles.set(key, handle);
  }

  shouldAttach(route: ActivatedRouteSnapshot): boolean {
    const key = routeCacheKey(route);
    return !this.localeRefreshInProgress && key !== null && this.handles.has(key);
  }

  retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const key = routeCacheKey(route);
    return key === null ? null : this.handles.get(key) ?? null;
  }

  shouldReuseRoute(
    future: ActivatedRouteSnapshot,
    current: ActivatedRouteSnapshot,
  ): boolean {
    return !this.localeRefreshInProgress
      && future.routeConfig?.path !== "autofill-picker"
      && future.routeConfig === current.routeConfig;
  }

  beginLocaleRefresh(): void {
    this.localeRefreshInProgress = true;
    this.clear();
  }

  completeLocaleRefresh(): void {
    this.localeRefreshInProgress = false;
  }

  clear(): void {
    for (const key of this.handles.keys()) {
      this.clearHandle(key);
    }
  }

  private clearHandle(key: string): void {
    const handle = this.handles.get(key);
    if (handle !== undefined) {
      destroyDetachedRouteHandle(handle);
      this.handles.delete(key);
    }
  }

}

function routeCacheKey(route: ActivatedRouteSnapshot): string | null {
  const path = route.routeConfig?.path;
  return path !== undefined && MAIN_ROUTE_PATHS.has(path) ? path : null;
}

// The OTP list owns live countdown timers. Keeping it detached would leave those
// timers running while another tab is visible, so it is intentionally recreated.
// The fully expanded Vault owns hundreds of interactive row nodes. Keeping that
// detached subtree makes a later activation pay its full layout/paint cost
// synchronously. Its facade data remains in memory, so rebuilding a bounded
// first batch is faster and gives the route a responsive loading state.
const MAIN_ROUTE_PATHS = new Set(["tabs", "generator", "send", "settings"]);
