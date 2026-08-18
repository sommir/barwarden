import "@angular/compiler";
import "zone.js";

import { Component, ElementRef, OnDestroy, OnInit, Type, inject } from "@angular/core";
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
  type Routes,
} from "@angular/router";
import { ScrollLayoutService } from "@bitwarden/components";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { describe, expect, it, vi } from "vitest";

import {
  PopupRouterCacheService,
  type PopupTabRoute,
} from "./popup-router-cache.service";
import { POPUP_ROUTER_CACHE_ROUTE_GRAPH } from "./popup-router-cache.lifecycle";
import { ios27RouteData, type Ios27PageFamily } from "./popup-route-metadata";
import { PopupRouteReuseStrategy } from "./popup-route-reuse.strategy";
import { retainedPopupRouteGraph } from "../app.routes";
import { OfficialI18nService } from "../official-ui/official-i18n.service";
import {
  FloatingTabSwitcherComponent,
  type FloatingTab,
} from "../popup-shell/floating-tab-switcher.component";
import { PopupStateStore } from "../popup-state";
import { SendFacade } from "../send/send.facade";
import { OtpFacade } from "../vault/otp.facade";
import { VaultFacade } from "../vault/vault.facade";

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

@Component({
  selector: "popup-vault-scroll-route",
  standalone: true,
  template: '<button data-popup-focus-key="vault:item-1">Vault item</button>',
})
class VaultScrollRouteComponent extends ScrollRouteHost {}

@Component({
  selector: "popup-otp-scroll-route",
  standalone: true,
  template: '<button data-popup-focus-key="otp:item-1">OTP item</button>',
})
class OtpScrollRouteComponent extends ScrollRouteHost {}

@Component({ selector: "popup-folders-scroll-route", standalone: true, template: "" })
class FoldersScrollRouteComponent extends ScrollRouteHost {}

@Component({
  selector: "popup-archive-scroll-route",
  standalone: true,
  template: '<button data-popup-focus-key="archive-item:item-1">Archive item</button>',
})
class ArchiveScrollRouteComponent extends ScrollRouteHost {}

const clickedTabs: readonly FloatingTab[] = [
  { label: "Vault", path: "/tabs/vault", icon: "bwi-vault" },
  { label: "OTP", path: "/tabs/otp", icon: "bwi-clock" },
  { label: "Generator", path: "/tabs/generator", icon: "bwi-generate" },
  { label: "Send", path: "/tabs/send", icon: "bwi-send" },
  { label: "Settings", path: "/tabs/settings", icon: "bwi-settings" },
];

@Component({
  selector: "popup-clicked-tabs-host",
  standalone: true,
  imports: [RouterOutlet, FloatingTabSwitcherComponent],
  template: `<router-outlet /><bw-floating-tab-switcher [tabs]="tabs" />`,
})
class ClickedTabsHostComponent {
  readonly tabs = clickedTabs;
}

@Component({
  selector: "popup-generator-scroll-route",
  standalone: true,
  template: '<button data-popup-focus-key="generator:copy">Copy generated value</button>',
})
class GeneratorScrollRouteComponent extends ScrollRouteHost {}

@Component({
  selector: "popup-send-scroll-route",
  standalone: true,
  template: '<button data-popup-focus-key="send:search">Search Sends</button>',
})
class SendScrollRouteComponent extends ScrollRouteHost {}

@Component({
  selector: "popup-settings-scroll-route",
  standalone: true,
  template: '<button data-popup-focus-key="settings:folders">Open folders</button>',
})
class SettingsScrollRouteComponent extends ScrollRouteHost {}

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

  it("returns an unretained detail to archive with scroll and focus", async () => {
    const { fixture, router, service, scrollLayout } = await createService(
      [
        {
          path: "archive",
          component: ArchiveScrollRouteComponent,
          data: ios27RouteData("vault", "secondary", false),
        },
        {
          path: "view-cipher/:id",
          component: CipherDetailRouteComponent,
          data: ios27RouteData("vault", "secondary", false),
        },
        {
          path: "tabs/vault",
          component: VaultScrollRouteComponent,
          data: ios27RouteData("vault", "base", true),
        },
      ],
      true,
      true,
    );

    await router.navigateByUrl("/archive");
    fixture!.detectChanges();
    const trigger = (fixture!.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '[data-popup-focus-key="archive-item:item-1"]',
    )!;
    trigger.focus();
    scrollLayout.scrollableRef()!.nativeElement.scrollTop = 121;
    await router.navigateByUrl("/view-cipher/item-1");
    fixture!.detectChanges();

    expect((service as unknown as {
      entries: Array<{ url: string; scrollTop: number; focusKey: string | null }>;
    }).entries.at(-1)).toEqual({
      url: "/archive",
      scrollTop: 121,
      focusKey: "archive-item:item-1",
    });
    expect(service.hasBackTarget()).toBe(true);
    await expect(service.back()).resolves.toBe(true);
    fixture!.detectChanges();
    await fixture!.whenStable();
    await Promise.resolve();

    expect(router.url).toBe("/archive");
    expect(scrollLayout.scrollableRef()!.nativeElement.scrollTop).toBe(121);
    expect(document.activeElement?.getAttribute("data-popup-focus-key"))
      .toBe("archive-item:item-1");
  });

  it("owns one scroll and content-focus snapshot for each of the five main tabs", async () => {
    const { fixture, router, service, scrollLayout } = await createService(
      [
        {
          path: "tabs/vault",
          component: VaultScrollRouteComponent,
          data: ios27RouteData("vault", "base", true),
        },
        {
          path: "tabs/otp",
          component: OtpScrollRouteComponent,
          data: ios27RouteData("otp", "base", true),
        },
        {
          path: "tabs/generator",
          component: GeneratorScrollRouteComponent,
          data: ios27RouteData("generator", "base", true),
        },
        {
          path: "tabs/send",
          component: SendScrollRouteComponent,
          data: ios27RouteData("send", "base", true),
        },
        {
          path: "tabs/settings",
          component: SettingsScrollRouteComponent,
          data: ios27RouteData("settings", "base", true),
        },
      ],
      true,
    );

    const visit = async (path: PopupTabRoute, focusKey: string, scrollTop: number) => {
      await router.navigateByUrl(path);
      fixture!.detectChanges();
      (fixture!.nativeElement as HTMLElement)
        .querySelector<HTMLElement>(`[data-popup-focus-key="${focusKey}"]`)!
        .focus();
      scrollLayout.scrollableRef()!.nativeElement.scrollTop = scrollTop;
    };

    await visit("/tabs/vault", "vault:item-1", 121);
    await visit("/tabs/otp", "otp:item-1", 42);
    await visit("/tabs/generator", "generator:copy", 33);
    await visit("/tabs/send", "send:search", 73);
    await visit("/tabs/settings", "settings:folders", 19);

    await router.navigateByUrl("/tabs/vault");
    fixture!.detectChanges();
    await fixture!.whenStable();
    await Promise.resolve();

    expect(scrollLayout.scrollableRef()!.nativeElement.scrollTop).toBe(121);
    expect(document.activeElement?.getAttribute("data-popup-focus-key")).toBe("vault:item-1");
    expect(Object.fromEntries((service as unknown as {
      tabSnapshots: Map<PopupTabRoute, { scrollTop: number; focusKey: string | null }>;
    }).tabSnapshots)).toEqual({
      "/tabs/vault": { scrollTop: 121, focusKey: "vault:item-1" },
      "/tabs/otp": { scrollTop: 42, focusKey: "otp:item-1" },
      "/tabs/generator": { scrollTop: 33, focusKey: "generator:copy" },
      "/tabs/send": { scrollTop: 73, focusKey: "send:search" },
      "/tabs/settings": { scrollTop: 19, focusKey: "settings:folders" },
    });
    expect(service.hasBackTarget()).toBe(false);
  });

  it("uses CSS.escape and focuses the first eligible descendant of a keyed owner", async () => {
    const { service } = await createService();
    const owner = document.createElement("div");
    const key = 'owner:"quoted"\\key';
    owner.setAttribute("data-popup-focus-key", key);
    const action = document.createElement("button");
    owner.append(action);
    document.body.append(owner);
    const css = globalThis.CSS ?? ({} as typeof CSS);
    const previousCss = globalThis.CSS;
    const previousEscape = css.escape;
    const escape = vi.fn((value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"'));
    Object.defineProperty(css, "escape", { configurable: true, value: escape });
    Object.defineProperty(globalThis, "CSS", { configurable: true, value: css });

    try {
      restoreScrollAndFocus(service, { scrollTop: 0, focusKey: key });

      expect(escape).toHaveBeenCalledWith(key);
      expect(document.activeElement).toBe(action);
    } finally {
      owner.remove();
      if (previousEscape === undefined) {
        Reflect.deleteProperty(css, "escape");
      } else {
        Object.defineProperty(css, "escape", { configurable: true, value: previousEscape });
      }
      if (previousCss === undefined) {
        Reflect.deleteProperty(globalThis, "CSS");
      }
    }
  });

  it("silently skips hidden, disabled, detached, and missing focus owners", async () => {
    const { service } = await createService();
    const baseline = document.createElement("button");
    baseline.textContent = "baseline";
    document.body.append(baseline);
    baseline.focus();

    const hidden = document.createElement("button");
    hidden.hidden = true;
    hidden.setAttribute("data-popup-focus-key", "edge:hidden");
    document.body.append(hidden);
    const disabled = document.createElement("button");
    disabled.disabled = true;
    disabled.setAttribute("data-popup-focus-key", "edge:disabled");
    document.body.append(disabled);
    const detached = document.createElement("button");
    detached.setAttribute("data-popup-focus-key", "edge:detached");

    try {
      for (const focusKey of ["edge:hidden", "edge:disabled", "edge:detached", "edge:missing"]) {
        expect(() => restoreScrollAndFocus(service, { scrollTop: 0, focusKey })).not.toThrow();
        expect(document.activeElement).toBe(baseline);
      }
    } finally {
      baseline.remove();
      hidden.remove();
      disabled.remove();
    }
  });

  it("stops remembering bubbling content focus after teardown", async () => {
    const { router, service } = await createService([
      {
        path: "tabs/send",
        component: RouteComponent,
        data: ios27RouteData("send", "base", true),
      },
    ]);
    await router.navigateByUrl("/tabs/send");
    service.ngOnDestroy();
    const content = document.createElement("button");
    content.setAttribute("data-popup-focus-key", "send:search");
    document.body.append(content);

    try {
      content.focus();
      expect((service as unknown as {
        tabSnapshots: Map<PopupTabRoute, { scrollTop: number; focusKey: string | null }>;
      }).tabSnapshots.size).toBe(0);
    } finally {
      content.remove();
    }
  });

  it("real tab clicks preserve Generator and Send content focus instead of the clicked tab key", async () => {
    const { fixture, router, service, scrollLayout } = await createClickedTabService();
    const host = fixture!.nativeElement as HTMLElement;
    const focus = (key: string) => host
      .querySelector<HTMLElement>(`[data-popup-focus-key="${key}"]`)!
      .focus();
    const clickTab = async (path: PopupTabRoute) => {
      const button = host.querySelector<HTMLButtonElement>(
        `[data-popup-focus-key="tab:${path}"]`,
      )!;
      button.focus();
      button.click();
      await fixture!.whenStable();
      fixture!.detectChanges();
      await Promise.resolve();
    };

    await router.navigateByUrl("/tabs/generator");
    fixture!.detectChanges();
    focus("generator:copy");
    scrollLayout.scrollableRef()!.nativeElement.scrollTop = 121;
    await clickTab("/tabs/send");

    expect(router.url).toBe("/tabs/send");
    focus("send:search");
    scrollLayout.scrollableRef()!.nativeElement.scrollTop = 73;
    await clickTab("/tabs/generator");
    expect(scrollLayout.scrollableRef()!.nativeElement.scrollTop).toBe(121);
    expect(document.activeElement?.getAttribute("data-popup-focus-key"))
      .toBe("generator:copy");

    await clickTab("/tabs/send");
    expect(scrollLayout.scrollableRef()!.nativeElement.scrollTop).toBe(73);
    expect(document.activeElement?.getAttribute("data-popup-focus-key")).toBe("send:search");
    expect(service.hasBackTarget()).toBe(false);
  });

  it("clear resets OTP/cache state but leaves page-owner searches and filters alone", async () => {
    const { service, otp, vault, send, store } = await createServiceWithStateOwners();
    otp.setSearch("OpenAI");
    vault.setSearch("GitHub");
    send.setSearch("Report");
    store.setFilterType("login");
    store.setSendTypeFilter("text");

    service.clear();

    expect(otp.query()).toBe("");
    expect(vault.queryValue()).toBe("GitHub");
    expect(send.queryValue()).toBe("Report");
    expect(store.snapshot().filterType).toBe("login");
    expect(store.snapshot().sendTypeFilter).toBe("text");
    expect(service.history()).toEqual([]);
  });
});

function createClickedTabService() {
  const leaf = (path: string, component: Type<unknown>, family: Ios27PageFamily) => ({
    path,
    component,
    data: ios27RouteData(family, "base", true),
  });
  return createService([
    leaf("tabs/generator", GeneratorScrollRouteComponent, "generator"),
    leaf("tabs/send", SendScrollRouteComponent, "send"),
  ], true, false, ClickedTabsHostComponent);
}

async function createService(
  routeConfig: Routes = retainedRoutes,
  mountRoutes = false,
  reuseTabsRoute = false,
  host: Type<unknown> = RoutedHostComponent,
) {
  await TestBed.configureTestingModule({
    imports: mountRoutes ? [host] : [],
    providers: [
      provideRouter(routeConfig),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: POPUP_ROUTER_CACHE_ROUTE_GRAPH, useValue: retainedPopupRouteGraph },
      ...(reuseTabsRoute ? [{ provide: RouteReuseStrategy, useExisting: PopupRouteReuseStrategy }] : []),
    ],
  }).compileComponents();

  const router = TestBed.inject(Router);
  const scrollLayout = TestBed.inject(ScrollLayoutService);
  const service = TestBed.inject(PopupRouterCacheService);
  const reuse = TestBed.inject(PopupRouteReuseStrategy);
  const fixture = mountRoutes ? TestBed.createComponent(host) : null;
  fixture?.detectChanges();
  return { fixture, reuse, router, scrollLayout, service };
}

async function createServiceWithStateOwners() {
  const base = await createService();
  return {
    ...base,
    otp: TestBed.inject(OtpFacade),
    vault: TestBed.inject(VaultFacade),
    send: TestBed.inject(SendFacade),
    store: TestBed.inject(PopupStateStore),
  };
}

function routeSnapshot(path: string): ActivatedRouteSnapshot {
  return { routeConfig: { path } } as ActivatedRouteSnapshot;
}

function restoreScrollAndFocus(
  service: PopupRouterCacheService,
  snapshot: { scrollTop: number; focusKey: string | null },
): void {
  (service as unknown as {
    restoreScrollAndFocus(value: { scrollTop: number; focusKey: string | null }): void;
  }).restoreScrollAndFocus(snapshot);
}
