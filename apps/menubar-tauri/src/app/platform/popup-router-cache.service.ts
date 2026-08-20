import { DOCUMENT } from "@angular/common";
import { Injectable, Injector, OnDestroy, afterNextRender, inject } from "@angular/core";
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationStart,
  Router,
} from "@angular/router";
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
import { OtpFacade } from "../vault/otp.facade";

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
export type PopupBackContinuation = (fallbackUrl?: string) => Promise<boolean>;
type PopupBackOwner = {
  readonly id: symbol;
  readonly back: (resume: PopupBackContinuation) => void | Promise<void>;
};
type TransientBackEntry = CacheEntry & {
  readonly destinationUrl: string;
  readonly token: number;
  readonly navigationId: number | null;
};
type PendingFocusRestore = {
  readonly token: number;
  readonly owner: HTMLElement;
  readonly observer: MutationObserver;
  readonly route: string;
  readonly epoch: number;
};

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
  private readonly otp = inject(OtpFacade);
  private readonly retainedRoutes = new Set(inject(POPUP_ROUTER_CACHE_ROUTE_GRAPH));
  private entries: CacheEntry[] = [];
  private backOwner: PopupBackOwner | null = null;
  private pendingTransientBack: TransientBackEntry | null = null;
  private transientBack: TransientBackEntry | null = null;
  private nextTransientBackToken = 0;
  private readonly tabSnapshots = new Map<PopupTabRoute, PopupUiSnapshot>();
  private restoring = false;
  private tabSnapshotEpoch = 0;
  private tabCaptureSuppressed = false;
  private readonly suppressionNavigationIds = new Set<number>();
  private nextFocusRestoreToken = 0;
  private pendingFocusRestore: PendingFocusRestore | null = null;
  private readonly routerSubscription: Subscription;

  private readonly onFocusIn = (event: FocusEvent): void => {
    const pending = this.pendingFocusRestore;
    if (
      pending
      && (!(event.target instanceof Node) || !pending.owner.contains(event.target))
    ) {
      this.cancelPendingFocusRestore();
    }
    if (this.tabCaptureSuppressed) return;
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
      if (event instanceof NavigationStart) {
        this.cancelPendingFocusRestore();
        if (this.tabCaptureSuppressed) {
          this.suppressionNavigationIds.add(event.id);
        }
        if (!this.restoring) {
          if (!this.tabCaptureSuppressed) {
            this.captureTabSnapshot();
          }
          this.captureScrollAndFocus();
        }
        const pending = this.pendingTransientBack;
        if (pending && pending.destinationUrl === canonicalUrl(event.url)) {
          this.pendingTransientBack = { ...pending, navigationId: event.id };
        } else if (pending?.navigationId === null) {
          this.pendingTransientBack = null;
        }
      } else if (event instanceof NavigationEnd) {
        const captureWasSuppressed = this.tabCaptureSuppressed;
        if (
          captureWasSuppressed
          && this.suppressionNavigationIds.delete(event.id)
        ) {
          this.tabCaptureSuppressed = false;
          this.suppressionNavigationIds.clear();
        }
        this.commitTransientBack(event);
        this.record(event.urlAfterRedirects);
        if (!captureWasSuppressed) {
          this.scheduleTabRestore(event.urlAfterRedirects);
        }
      } else if (
        event instanceof NavigationCancel
        || event instanceof NavigationError
        || event instanceof NavigationSkipped
      ) {
        if (this.pendingTransientBack?.navigationId === event.id) {
          this.pendingTransientBack = null;
        }
        this.suppressionNavigationIds.delete(event.id);
      }
    });
  }

  ngOnDestroy(): void {
    this.document.removeEventListener("focusin", this.onFocusIn);
    this.cancelPendingFocusRestore();
    this.routerSubscription.unsubscribe();
  }

  history(): readonly RetainedPopupRoute[] {
    return this.entries.map(({ url }) => url);
  }

  canRetain(url: string): url is RetainedPopupRoute {
    return this.retainedRoutes.has(url);
  }

  clear(): void {
    this.tabSnapshotEpoch += 1;
    this.tabCaptureSuppressed = true;
    this.suppressionNavigationIds.clear();
    this.cancelPendingFocusRestore();
    this.entries = [];
    this.backOwner = null;
    this.pendingTransientBack = null;
    this.transientBack = null;
    this.nextTransientBackToken += 1;
    this.tabSnapshots.clear();
    this.routeReuse.clear();
    this.otp.resetSearch();
  }

  hasBackTarget(): boolean {
    if (this.backOwner) return true;
    const data = deepestIos27RouteData(this.router.routerState.snapshot.root);
    if (data?.popupLayer !== "secondary") return false;
    const current = canonicalUrl(this.router.url);
    if (this.transientBack?.destinationUrl === current) return true;
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
    const owner = this.backOwner;
    if (owner) {
      await owner.back(async (fallbackUrl) => {
        if (this.backOwner?.id !== owner.id) return false;
        return this.backWithoutOwner(fallbackUrl);
      });
      return true;
    }

    return this.backWithoutOwner();
  }

  registerBackOwner(
    back: (resume: PopupBackContinuation) => void | Promise<void>,
  ): () => void {
    const owner: PopupBackOwner = { id: Symbol("popup-back-owner"), back };
    this.backOwner = owner;
    return () => {
      if (this.backOwner?.id === owner.id) {
        this.backOwner = null;
      }
    };
  }

  stageTransientBack(destinationUrl: string, focusKey?: PopupFocusKey): void {
    const current = canonicalUrl(this.router.url);
    const host = this.scrollLayout.scrollableRef()?.nativeElement;
    const candidate = focusKey ?? closestPopupFocusKey(this.document.activeElement);
    this.pendingTransientBack = {
      url: current,
      scrollTop: host?.scrollTop ?? 0,
      focusKey: candidate,
      destinationUrl: canonicalUrl(destinationUrl),
      token: ++this.nextTransientBackToken,
      navigationId: null,
    };
  }

  private async backWithoutOwner(fallbackUrl?: string): Promise<boolean> {
    const current = canonicalUrl(this.router.url);
    const transient = this.transientBack;
    if (transient?.destinationUrl === current) {
      this.transientBack = null;
      if (await this.navigateTransientAndRestore(transient)) return true;
    }

    this.captureScrollAndFocus();
    if (this.entries.at(-1)?.url === current) this.entries.pop();

    if (fallbackUrl) {
      const target = canonicalUrl(fallbackUrl);
      let targetIndex = -1;
      for (let index = this.entries.length - 1; index >= 0; index -= 1) {
        if (this.entries[index]?.url === target) {
          targetIndex = index;
          break;
        }
      }
      if (targetIndex >= 0) {
        this.entries = this.entries.slice(0, targetIndex + 1);
        const entry = this.entries[targetIndex]!;
        if (await this.navigateAndRestore(entry)) return true;
      } else if (await this.navigate(target)) {
        return true;
      }
    }

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

  private commitTransientBack(event: NavigationEnd): void {
    const pending = this.pendingTransientBack;
    const destination = canonicalUrl(event.urlAfterRedirects);
    if (pending?.navigationId === event.id && pending.destinationUrl === destination) {
      this.pendingTransientBack = null;
      this.transientBack = pending;
      return;
    }
    if (this.transientBack && this.transientBack.destinationUrl !== destination) {
      this.transientBack = null;
    }
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

  private async navigateTransientAndRestore(entry: TransientBackEntry): Promise<boolean> {
    await this.navigate(entry.url);
    if (canonicalUrl(this.router.url) !== canonicalUrl(entry.url)) return false;
    const token = entry.token;
    afterNextRender(
      {
        write: () => {
          if (
            token === this.nextTransientBackToken
            && canonicalUrl(this.router.url) === canonicalUrl(entry.url)
            && this.transientBack === null
          ) {
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
    const epoch = this.tabSnapshotEpoch;

    afterNextRender(
      {
        write: () => {
          if (
            epoch === this.tabSnapshotEpoch
            && this.tabSnapshots.get(tab) === snapshot
            && popupTabRoute(this.router.url) === tab
          ) {
            this.restoreScrollAndFocus(snapshot);
          }
        },
      },
      { injector: this.injector },
    );
  }

  private restoreScrollAndFocus(snapshot: PopupUiSnapshot): void {
    this.cancelPendingFocusRestore();
    const host = this.scrollLayout.scrollableRef()?.nativeElement;
    if (host) {
      host.scrollTop = snapshot.scrollTop;
    }
    if (!snapshot.focusKey) return;

    const owner = findFocusOwner(this.document, snapshot.focusKey);
    if (!owner) return;
    const target = eligibleFocusTarget(owner);
    if (target) {
      focusWithoutScroll(target);
      return;
    }

    const MutationObserverConstructor = this.document.defaultView?.MutationObserver;
    if (!MutationObserverConstructor) return;
    const token = ++this.nextFocusRestoreToken;
    const route = canonicalUrl(this.router.url);
    const epoch = this.tabSnapshotEpoch;
    const observer = new MutationObserverConstructor(() => {
      const pending = this.pendingFocusRestore;
      if (
        pending?.token !== token
        || pending.observer !== observer
        || pending.owner !== owner
        || pending.route !== route
        || pending.epoch !== epoch
        || epoch !== this.tabSnapshotEpoch
        || canonicalUrl(this.router.url) !== route
        || !owner.isConnected
        || findFocusOwner(this.document, snapshot.focusKey!) !== owner
      ) {
        observer.disconnect();
        if (this.pendingFocusRestore?.token === token) {
          this.pendingFocusRestore = null;
        }
        return;
      }
      const appearedTarget = eligibleFocusTarget(owner);
      if (!appearedTarget) return;
      this.cancelPendingFocusRestore();
      focusWithoutScroll(appearedTarget);
    });
    this.pendingFocusRestore = { token, owner, observer, route, epoch };
    observer.observe(owner, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["aria-disabled", "aria-hidden", "class", "disabled", "hidden", "inert", "style"],
    });
  }

  private cancelPendingFocusRestore(): void {
    const pending = this.pendingFocusRestore;
    this.pendingFocusRestore = null;
    pending?.observer.disconnect();
  }

  private async navigateFallback(): Promise<void> {
    await this.navigate("/tabs/vault");
  }

  private async navigate(url: string): Promise<boolean> {
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

function eligibleFocusTarget(owner: HTMLElement): HTMLElement | undefined {
  return isEligibleFocusTarget(owner)
    ? owner
    : Array.from(owner.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .find(isEligibleFocusTarget);
}

function focusWithoutScroll(target: HTMLElement): void {
  if (!target.isConnected) return;
  try {
    target.focus({ preventScroll: true });
  } catch {
    // Restoration is best-effort when the route changed again mid-render.
  }
}
