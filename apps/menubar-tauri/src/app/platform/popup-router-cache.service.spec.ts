import "@angular/compiler";
import "zone.js";

import { Component, ElementRef, OnDestroy, OnInit, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  DetachedRouteHandle,
  Router,
  RouterOutlet,
  RouteReuseStrategy,
  provideRouter,
} from "@angular/router";
import { ScrollLayoutService } from "@bitwarden/components";
import { describe, expect, it, vi } from "vitest";

import { PopupRouterCacheService } from "./popup-router-cache.service";
import { POPUP_ROUTER_CACHE_ROUTE_GRAPH } from "./popup-router-cache.lifecycle";
import { PopupRouteReuseStrategy } from "./popup-route-reuse.strategy";
import { retainedPopupRouteGraph } from "../app.routes";

@Component({ standalone: true, template: "" })
class RouteComponent {}

@Component({ standalone: true, imports: [RouterOutlet], template: "<router-outlet />" })
class RoutedHostComponent {}

@Component({ selector: "bw-retained-tabs-route", standalone: true, imports: [RouterOutlet], template: "<router-outlet />" })
class RetainedTabsRouteComponent {}

@Component({ selector: "bw-retained-vault-route", standalone: true, template: "" })
class RetainedVaultRouteComponent {
  static instances = 0;

  constructor() {
    RetainedVaultRouteComponent.instances += 1;
  }
}

@Component({ selector: "bw-retained-otp-route", standalone: true, template: "" })
class RetainedOtpRouteComponent {
  static instances = 0;

  constructor() {
    RetainedOtpRouteComponent.instances += 1;
  }
}

@Component({ selector: "bw-cipher-detail-route", standalone: true, template: "" })
class CipherDetailRouteComponent {}

class ScrollRouteHost implements OnInit, OnDestroy {
  private readonly element = inject(ElementRef<HTMLElement>);
  private readonly scrollLayout = inject(ScrollLayoutService);

  ngOnInit(): void {
    this.scrollLayout.scrollableRef.set(this.element);
  }

  ngOnDestroy(): void {
    if (this.scrollLayout.scrollableRef()?.nativeElement === this.element.nativeElement) {
      this.scrollLayout.scrollableRef.set(null);
    }
  }
}

@Component({ selector: "popup-vault-scroll-route", standalone: true, template: "" })
class VaultScrollRouteComponent extends ScrollRouteHost {}

@Component({ selector: "popup-folders-scroll-route", standalone: true, template: "" })
class FoldersScrollRouteComponent extends ScrollRouteHost {}

const redirectToVaultGuard: CanActivateFn = () => inject(Router).parseUrl("/tabs/vault");

const retainedRoutes = [
  { path: "tabs/vault", component: RouteComponent },
  { path: "tabs/generator", component: RouteComponent },
  { path: "tabs/send", component: RouteComponent },
  { path: "tabs/settings", component: RouteComponent },
  { path: "folders", component: RouteComponent },
  { path: "login", component: RouteComponent },
  { path: "2fa", component: RouteComponent },
  { path: "view-cipher/:id", component: RouteComponent },
];

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

describe("PopupRouterCacheService", () => {
  it("retains tab and nested route history for official back navigation", async () => {
    const { router, service } = await createService();

    await router.navigateByUrl("/tabs/vault");
    await router.navigateByUrl("/tabs/generator");
    await router.navigateByUrl("/folders");

    expect(service.history()).toEqual(["/tabs/vault", "/tabs/generator", "/folders"]);

    await service.back();
    expect(router.url).toBe("/tabs/generator");
    await service.back();
    expect(router.url).toBe("/tabs/vault");
  });

  it("does not add duplicate navigation entries", async () => {
    const { router, service } = await createService();

    await router.navigateByUrl("/tabs/vault");
    await router.navigateByUrl("/tabs/vault");

    expect(service.history()).toEqual(["/tabs/vault"]);
  });

  it("rejects login, challenge, item, query, and unknown URLs", async () => {
    const { service } = await createService();

    expect(service.canRetain("/tabs/vault")).toBe(true);
    expect(service.canRetain("/login")).toBe(false);
    expect(service.canRetain("/2fa")).toBe(false);
    expect(service.canRetain("/view-cipher/item-123")).toBe(false);
    expect(service.canRetain("/tabs/vault?accountId=account-123")).toBe(false);
    expect(service.canRetain("/not-a-route")).toBe(false);
  });

  it("falls back to the vault tab when back has no retained predecessor", async () => {
    const { router, service } = await createService();

    await service.back();

    expect(router.url).toBe("/tabs/vault");
  });

  it("clears retained URLs and offsets through the narrow lifecycle port", async () => {
    const { router, service } = await createService();

    await router.navigateByUrl("/tabs/vault");
    service.clear();

    expect(service.history()).toEqual([]);
    await service.back();
    expect(router.url).toBe("/tabs/vault");
  });

  it("retains the tabs route tree without retaining the heavy vault child", async () => {
    const { reuse, service } = await createService();
    const tabsRoute = routeSnapshot("tabs");
    const vaultRoute = routeSnapshot("vault");
    const detailRoute = routeSnapshot("view-cipher/:id");
    const handle = {} as DetachedRouteHandle;

    expect(reuse.shouldDetach(tabsRoute)).toBe(true);
    expect(reuse.shouldDetach(vaultRoute)).toBe(false);
    expect(reuse.shouldDetach(detailRoute)).toBe(false);

    reuse.store(tabsRoute, handle);

    expect(reuse.shouldAttach(tabsRoute)).toBe(true);
    expect(reuse.retrieve(tabsRoute)).toBe(handle);
    expect(reuse.shouldReuseRoute(tabsRoute, tabsRoute)).toBe(true);

    service.clear();
    expect(reuse.shouldAttach(tabsRoute)).toBe(false);
    expect(reuse.retrieve(tabsRoute)).toBeNull();
  });

  it("rebuilds the mounted vault route progressively after a detail round trip", async () => {
    RetainedVaultRouteComponent.instances = 0;
    const { fixture, router } = await createService(
      [
        {
          path: "tabs",
          component: RetainedTabsRouteComponent,
          children: [{ path: "vault", component: RetainedVaultRouteComponent }],
        },
        { path: "view-cipher/:id", component: CipherDetailRouteComponent },
      ],
      true,
      true,
    );

    await router.navigateByUrl("/tabs/vault");
    fixture!.detectChanges();
    await router.navigateByUrl("/view-cipher/item-1");
    fixture!.detectChanges();
    await router.navigateByUrl("/tabs/vault");
    fixture!.detectChanges();

    expect(RetainedVaultRouteComponent.instances).toBe(2);
  });

  it("recreates heavy Vault and timer-driven OTP pages when switching primary tabs", async () => {
    RetainedVaultRouteComponent.instances = 0;
    RetainedOtpRouteComponent.instances = 0;
    const { fixture, router } = await createService(
      [
        {
          path: "tabs",
          component: RetainedTabsRouteComponent,
          children: [
            { path: "vault", component: RetainedVaultRouteComponent },
            { path: "otp", component: RetainedOtpRouteComponent },
          ],
        },
      ],
      true,
      true,
    );

    await router.navigateByUrl("/tabs/vault");
    fixture!.detectChanges();
    await router.navigateByUrl("/tabs/otp");
    fixture!.detectChanges();
    await router.navigateByUrl("/tabs/vault");
    fixture!.detectChanges();
    await router.navigateByUrl("/tabs/otp");
    fixture!.detectChanges();

    expect(RetainedVaultRouteComponent.instances).toBe(2);
    expect(RetainedOtpRouteComponent.instances).toBe(2);
  });

  it("rejects a stale retained entry and restores the vault fallback", async () => {
    const { router, service } = await createService([
      { path: "tabs/vault", component: RouteComponent },
    ]);
    const navigateByUrl = vi.spyOn(router, "navigateByUrl");
    (service as unknown as { entries: Array<{ url: string; scrollTop: number }> }).entries = [
      { url: "/folders", scrollTop: 24 },
    ];

    await service.restore();

    expect(service.history()).toEqual([]);
    expect(navigateByUrl).toHaveBeenLastCalledWith("/tabs/vault", { replaceUrl: true });
  });

  it("rejects an entry when a guard redirects its successful navigation", async () => {
    const { router, service } = await createService([
      { path: "tabs/vault", component: RouteComponent },
      { path: "folders", component: RouteComponent, canActivate: [redirectToVaultGuard] },
    ]);
    (service as unknown as { entries: Array<{ url: string; scrollTop: number }> }).entries = [
      { url: "/folders", scrollTop: 24 },
    ];

    await service.restore();

    expect(router.url).toBe("/tabs/vault");
    expect(service.history()).toEqual([]);
  });

  it("pops wildcard-redirected back entries before returning to the vault fallback", async () => {
    const { router, service } = await createService([
      { path: "tabs/vault", component: RouteComponent },
      { path: "**", redirectTo: "tabs/vault" },
    ]);
    (service as unknown as { entries: Array<{ url: string; scrollTop: number }> }).entries = [
      { url: "/tabs/vault", scrollTop: 0 },
      { url: "/folders", scrollTop: 24 },
      { url: "/tabs/generator", scrollTop: 12 },
    ];

    await service.back();

    expect(router.url).toBe("/tabs/vault");
    expect(service.history()).toEqual(["/tabs/vault"]);
  });

  it("restores a routed scroll offset onto the replacement host after back navigation", async () => {
    const { fixture, router, scrollLayout, service } = await createService(
      [
        { path: "tabs/vault", component: VaultScrollRouteComponent },
        { path: "folders", component: FoldersScrollRouteComponent },
      ],
      true,
    );

    await router.navigateByUrl("/tabs/vault");
    fixture!.detectChanges();
    const vaultHost = scrollLayout.scrollableRef()!.nativeElement;
    vaultHost.scrollTop = 88;

    await router.navigateByUrl("/folders");
    fixture!.detectChanges();
    const foldersHost = scrollLayout.scrollableRef()!.nativeElement;
    foldersHost.scrollTop = 12;
    expect(foldersHost).not.toBe(vaultHost);

    await service.back();
    await fixture!.whenStable();
    await Promise.resolve();

    const restoredVaultHost = scrollLayout.scrollableRef()!.nativeElement;

    expect(restoredVaultHost).not.toBe(vaultHost);
    expect(restoredVaultHost.scrollTop).toBe(88);
    expect(foldersHost.scrollTop).toBe(12);
  });
});

async function createService(routeConfig = retainedRoutes, mountRoutes = false, reuseTabsRoute = false) {
  await TestBed.configureTestingModule({
    imports: mountRoutes ? [RoutedHostComponent] : [],
    providers: [
      provideRouter(routeConfig),
      { provide: POPUP_ROUTER_CACHE_ROUTE_GRAPH, useValue: retainedPopupRouteGraph },
      ...(reuseTabsRoute ? [{ provide: RouteReuseStrategy, useExisting: PopupRouteReuseStrategy }] : []),
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  const scrollLayout = TestBed.inject(ScrollLayoutService);
  const service = TestBed.inject(PopupRouterCacheService);
  const reuse = TestBed.inject(PopupRouteReuseStrategy);
  const fixture = mountRoutes ? TestBed.createComponent(RoutedHostComponent) : null;
  fixture?.detectChanges();
  return { fixture, reuse, router, scrollLayout, service };
}

function routeSnapshot(path: string): ActivatedRouteSnapshot {
  return { routeConfig: { path } } as ActivatedRouteSnapshot;
}
