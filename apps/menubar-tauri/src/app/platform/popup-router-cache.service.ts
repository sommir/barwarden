import { DOCUMENT } from "@angular/common";
import { Injectable, Injector, OnDestroy, afterNextRender, inject } from "@angular/core";
import { NavigationEnd, NavigationStart, Router } from "@angular/router";
import { Subscription } from "rxjs";

import { ScrollLayoutService } from "@bitwarden/components";

import {
  POPUP_ROUTER_CACHE_ROUTE_GRAPH,
  type PopupRouterCacheLifecyclePort,
} from "./popup-router-cache.lifecycle";
import {
  deepestIos27RouteData,
  type PopupFocusKey,
} from "./popup-route-metadata";
import { PopupRouteReuseStrategy } from "./popup-route-reuse.strategy";

export type RetainedPopupRoute = string;
export type PopupTabRoute =
  | "/tabs/vault"
  | "/tabs/otp"
  | "/tabs/generator"
  | "/tabs/send"
  | "/tabs/settings";

export interface PopupUiSnapshot {
  readonly scrollTop: number;
  readonly focusKey: PopupFocusKey | null;
}

type CacheEntry = PopupUiSnapshot & { readonly url: RetainedPopupRoute };

const POPUP_TAB_ROUTES = new Set<PopupTabRoute>([
  "/tabs/vault",
  "/tabs/otp",
  "/tabs/generator",
  "/tabs/send",
  "/tabs/settings",
]);

const TAB_SWITCHER_FOCUS_KEY = /^tab:\/tabs\//;
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "iframe",
  "object",
  "embed",
  "summary",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]",
].join(",");

@Injectable({ providedIn: "root" })
export class PopupRouterCacheService implements PopupRouterCacheLifecyclePort, OnDestroy {
  private readonly router = inject(Router);
  private readonly scrollLayout = inject(ScrollLayoutService);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly routeReuse = inject(PopupRouteReuseStrategy);
  private readonly retainedRoutes = new Set(inject(POPUP_ROUTER_CACHE_ROUTE_GRAPH));
  private entries: CacheEntry[] = [];
  private readonly tabSnapshots = new Map<PopupTabRoute, PopupUiSnapshot>();
  private restoring = false;
  private readonly routerSubscription: Subscription;

  private readonly onFocusIn = (event: FocusEvent): void => {
    const tab = popupTabRoute(this.router.url);
    const key = closestPopupFocusKey(event.target);
    if (!tab || !key || TAB_SWITCHER_FOCUS_KEY.test(key)) return;
    const previous = this.tabSnapshots.get(tab);
    this.tabSnapshots.set(tab, {
      scrollTop: previous?.scrollTop ?? 0,
      focusKey: key,
    });
  };

  constructor() {
    this.document.addEventListener("focusin", this.onFocusIn);
    this.routerSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart && !this.restoring) {
        this.captureTabSnapshot();
        this.captureScrollAndFocus();
      } else if (event instanceof NavigationEnd) {
        this.record(event.urlAfterRedirects);
        this.scheduleTabRestore(event.urlAfterRedirects);
      }
    });
  }

  ngOnDestroy(): void {
    this.document.removeEventListener("focusin", this.onFocusIn);
    this.routerSubscription.unsubscribe();
  }

  history(): readonly RetainedPopupRoute[] {
    return this.entries.map(({ url }) => url);
  }

  canRetain(url: string): url is RetainedPopupRoute {
    return this.retainedRoutes.has(url);
  }

  clear(): void {
    this.entries = [];
    this.tabSnapshots.clear();
    this.routeReuse.clear();
  }

  hasBackTarget(): boolean {
    const data = deepestIos27RouteData(this.router.routerState.snapshot.root);
    if (data?.popupLayer !== "secondary") return false;
    const current = canonicalUrl(this.router.url);
    const top = this.entries.at(-1);
    return Boolean(top && (top.url !== current || this.entries.length > 1));
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

  async back(): Promise<boolean> {
    this.captureScrollAndFocus();
    const current = canonicalUrl(this.router.url);
    if (this.entries.at(-1)?.url === current) this.entries.pop();

    while (this.entries.length > 0) {
      const entry = this.entries[this.entries.length - 1]!;
      if (await this.navigateAndRestore(entry)) {
        return true;
      }
      this.entries.pop();
    }

    await this.navigateFallback();
    return true;
  }

  private record(url: string): void {
    const route = canonicalUrl(url);
    if (this.restoring || !this.canRetain(route) || this.entries.at(-1)?.url === route) {
      return;
    }

    this.entries.push({ url: route, scrollTop: 0, focusKey: null });
  }

  private captureScrollAndFocus(): void {
    const entry = this.entries.at(-1);
    const current = canonicalUrl(this.router.url);
    if (!entry || entry.url !== current) return;

    const host = this.scrollLayout.scrollableRef()?.nativeElement;
    const candidate = closestPopupFocusKey(this.document.activeElement);
    const isTransientTabButton = popupTabRoute(current) !== null
      && candidate !== null
      && TAB_SWITCHER_FOCUS_KEY.test(candidate);
    this.entries[this.entries.length - 1] = {
      ...entry,
      scrollTop: host?.scrollTop ?? entry.scrollTop,
      focusKey: candidate === null || isTransientTabButton ? entry.focusKey : candidate,
    };
  }

  private captureTabSnapshot(): void {
    const tab = popupTabRoute(this.router.url);
    if (!tab) return;
    const previous = this.tabSnapshots.get(tab);
    const candidate = closestPopupFocusKey(this.document.activeElement);
    const isTransientTabButton = candidate !== null && TAB_SWITCHER_FOCUS_KEY.test(candidate);
    this.tabSnapshots.set(tab, {
      scrollTop: this.scrollLayout.scrollableRef()?.nativeElement.scrollTop
        ?? previous?.scrollTop
        ?? 0,
      focusKey: isTransientTabButton || candidate === null
        ? previous?.focusKey ?? null
        : candidate,
    });
  }

  private async navigateAndRestore(entry: CacheEntry): Promise<boolean> {
    await this.navigate(entry.url);

    if (canonicalUrl(this.router.url) !== entry.url) {
      return false;
    }

    afterNextRender(
      {
        write: () => {
          if (this.entries.at(-1) === entry) {
            this.restoreScrollAndFocus(entry);
          }
        },
      },
      { injector: this.injector },
    );

    return true;
  }

  private scheduleTabRestore(url: string): void {
    const tab = popupTabRoute(url);
    if (!tab) return;
    const snapshot = this.tabSnapshots.get(tab);
    if (!snapshot) return;

    afterNextRender(
      {
        write: () => {
          if (popupTabRoute(this.router.url) === tab) {
            this.restoreScrollAndFocus(snapshot);
          }
        },
      },
      { injector: this.injector },
    );
  }

  private restoreScrollAndFocus(snapshot: PopupUiSnapshot): void {
    const host = this.scrollLayout.scrollableRef()?.nativeElement;
    if (host) {
      host.scrollTop = snapshot.scrollTop;
    }
    if (!snapshot.focusKey) return;

    const owner = findFocusOwner(this.document, snapshot.focusKey);
    if (!owner) return;
    const target = isEligibleFocusTarget(owner)
      ? owner
      : Array.from(owner.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
          .find(isEligibleFocusTarget);
    if (!target?.isConnected) return;

    try {
      target.focus({ preventScroll: true });
    } catch {
      // Restoration is best-effort when the route changed again mid-render.
    }
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

function canonicalUrl(url: string): string {
  return url.split(/[?#]/, 1)[0] || "/";
}

function popupTabRoute(url: string): PopupTabRoute | null {
  const route = canonicalUrl(url) as PopupTabRoute;
  return POPUP_TAB_ROUTES.has(route) ? route : null;
}

function closestPopupFocusKey(target: EventTarget | null): PopupFocusKey | null {
  if (!(target instanceof Element)) return null;
  const key = target.closest<HTMLElement>("[data-popup-focus-key]")
    ?.getAttribute("data-popup-focus-key")
    ?.trim();
  return key ? key as PopupFocusKey : null;
}

function findFocusOwner(document: Document, key: PopupFocusKey): HTMLElement | null {
  const cssEscape = document.defaultView?.CSS?.escape ?? globalThis.CSS?.escape;
  if (typeof cssEscape === "function") {
    try {
      const escaped = cssEscape(key);
      const owner = document.querySelector<HTMLElement>(
        `[data-popup-focus-key="${escaped}"]`,
      );
      if (owner) return owner;
    } catch {
      // Fall through to an attribute comparison if a partial DOM shim rejects the selector.
    }
  }

  return Array.from(document.querySelectorAll<HTMLElement>("[data-popup-focus-key]"))
    .find((candidate) => candidate.getAttribute("data-popup-focus-key") === key)
    ?? null;
}

function isEligibleFocusTarget(element: HTMLElement): boolean {
  if (!element.isConnected || element.matches(":disabled,[aria-disabled='true']")) {
    return false;
  }
  if (element.closest("[hidden],[inert],[aria-hidden='true']")) return false;

  const view = element.ownerDocument.defaultView;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    const style = view?.getComputedStyle(ancestor);
    if (
      style?.display === "none"
      || style?.visibility === "hidden"
      || style?.visibility === "collapse"
      || style?.opacity === "0"
    ) {
      return false;
    }
  }

  return element.matches(FOCUSABLE_SELECTOR) && element.tabIndex >= 0;
}
