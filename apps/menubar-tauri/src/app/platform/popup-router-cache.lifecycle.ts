import { InjectionToken } from "@angular/core";

export interface PopupRouterCacheLifecyclePort {
  clear(): void;
}

export const POPUP_ROUTER_CACHE_LIFECYCLE_PORT = new InjectionToken<PopupRouterCacheLifecyclePort | null>(
  "POPUP_ROUTER_CACHE_LIFECYCLE_PORT",
  { providedIn: "root", factory: () => null },
);

export const POPUP_ROUTER_CACHE_ROUTE_GRAPH = new InjectionToken<readonly string[]>(
  "POPUP_ROUTER_CACHE_ROUTE_GRAPH",
  { providedIn: "root", factory: () => [] },
);
