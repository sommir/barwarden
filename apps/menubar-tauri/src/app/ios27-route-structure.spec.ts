import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
import { LiveAnnouncer } from "@angular/cdk/a11y";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mountProductionRoute,
  productionRouteStructuralCases,
} from "./evidence/ios27-route-structure.harness";

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("Cannot set base providers")) {
    throw error;
  }
}

afterEach(() => {
  document
    .querySelectorAll('style[data-test-owner="ios27-route-structure"]')
    .forEach((node) => node.remove());
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.bwTheme;
  delete document.documentElement.dataset.bwCompactMode;
  vi.clearAllTimers();
  TestBed.resetTestingModule();
});

describe("mounted iOS 27 production route structure", () => {
  it("registers all 33 visible production route cases", () => {
    expect(productionRouteStructuralCases).toHaveLength(33);
  });

  it.each([
    ["/tabs/vault", "app-new-item-dropdown button[bitbutton]", ":scope > span > span"],
    ["/folders", "[data-testid='new-folder-button']", ":scope > span > span"],
    ["/tabs/send", "[data-testid='send-new-action']", ".macos-header-action-disc"],
  ] as const)(
    "keeps the real %s header create action avatar-sized",
    async (route, actionSelector, paintSelector) => {
      const testCase = productionRouteStructuralCases.find((entry) => entry.route === route)!;
      const { fixture, host } = await mountProductionRoute(testCase);
      const routeHost = host.querySelector<HTMLElement>(testCase.routeHostSelector)!;
      const action = routeHost.querySelector<HTMLElement>(actionSelector);

      expect(action).not.toBeNull();
      const actionStyle = getComputedStyle(action!);
      expect(actionStyle.width).toBe("44px");
      expect(actionStyle.minWidth).toBe("44px");
      expect(actionStyle.maxWidth).toBe("44px");
      expect(actionStyle.height).toBe("44px");
      expect(actionStyle.minHeight).toBe("44px");
      expect(actionStyle.maxHeight).toBe("44px");
      expect(actionStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(actionStyle.borderRadius).toBe("999px");

      const paint = action!.querySelector<HTMLElement>(paintSelector);
      expect(paint).not.toBeNull();
      const paintStyle = getComputedStyle(paint!);
      expect(paintStyle.width).toBe("32px");
      expect(paintStyle.height).toBe("32px");

      fixture.destroy();
    },
  );

  it.each([
    "/tabs/vault",
    "/tabs/generator",
    "/tabs/send",
    "/tabs/settings",
  ] as const)(
    "reserves bottom safe area below real %s content for the floating tab bar",
    async (route) => {
      const testCase = productionRouteStructuralCases.find((entry) => entry.route === route)!;
      const { fixture, host } = await mountProductionRoute(testCase);
      const routeHost = host.querySelector<HTMLElement>(testCase.routeHostSelector)!;
      const scroll = routeHost.querySelector<HTMLElement>(
        '[data-testid="popup-layout-scroll-region"]',
      )!;
      const page = routeHost.querySelector<HTMLElement>("popup-page")!;
      const nav = host.querySelector<HTMLElement>(".floating-tab-switcher")!;

      expect(nav).not.toBeNull();
      expect(getComputedStyle(page).getPropertyValue("--mac-page-bottom-safe").trim())
        .toBe("88px");
      expect(getComputedStyle(scroll).paddingBottom).toBe("var(--mac-page-bottom-safe)");
      expect(getComputedStyle(scroll).scrollPaddingBottom).toBe("var(--mac-page-bottom-safe)");

      fixture.destroy();
    },
  );

  it("keeps the real Appearance selects compact when focused", async () => {
    const testCase = productionRouteStructuralCases.find((entry) => entry.route === "/appearance")!;
    const { fixture, host } = await mountProductionRoute(testCase);
    const routeHost = host.querySelector<HTMLElement>(testCase.routeHostSelector)!;
    const selects = Array.from(
      routeHost.querySelectorAll<HTMLElement>("bit-select.macos-control-visible"),
    );

    expect(selects).toHaveLength(2);
    for (const select of selects) {
      const ngSelect = select.querySelector<HTMLElement>("ng-select")!;
      const paint = select.querySelector<HTMLElement>("ng-select > .ng-select-container")!;
      const combobox = select.querySelector<HTMLElement>('input[role="combobox"]')!;
      expect(getComputedStyle(select).width).toBe("160px");
      expect(getComputedStyle(ngSelect).width).toBe("100%");
      expect(getComputedStyle(paint).width).toBe("100%");
      combobox.focus();
      fixture.detectChanges();
      expect(getComputedStyle(select).width).toBe("160px");
      expect(getComputedStyle(ngSelect).width).toBe("100%");
      expect(getComputedStyle(paint).width).toBe("100%");
      expect(getComputedStyle(select).outlineWidth).toBe("0px");
      expect(getComputedStyle(ngSelect).outlineWidth).toBe("0px");
      expect(getComputedStyle(paint).outlineWidth).toBe("2px");
      expect(Number.parseFloat(getComputedStyle(select).height)).toBeGreaterThanOrEqual(44);
      expect(getComputedStyle(paint).height).toBe("40px");
    }

    fixture.destroy();
  });

  it.each([
    ["/tabs/vault", ".vault-hierarchy__items bit-item-group"],
    ["/folders", "bit-item-group"],
    ["/tabs/send", ".macos-send-list"],
    ["/tabs/settings", ".macos-preference-group"],
    ["/appearance", ".macos-preference-group"],
  ] as const)(
    "clips the first real %s content group with rounded corners",
    async (route, groupSelector) => {
      const testCase = productionRouteStructuralCases.find((entry) => entry.route === route)!;
      const { fixture, host } = await mountProductionRoute(testCase);
      const routeHost = host.querySelector<HTMLElement>(testCase.routeHostSelector)!;
      const group = routeHost.querySelector<HTMLElement>(groupSelector);

      expect(group).not.toBeNull();
      const groupStyle = getComputedStyle(group!);
      expect(groupStyle.borderRadius).toBe("12px");
      expect(groupStyle.overflow).toBe("hidden");

      fixture.destroy();
    },
  );

  it.each([
    ["/2fa", "/2fa"],
    ["/archive", "/archive"],
    ["/send-created?sendId=m12-text-send&type=text", "/send-created?sendId=m12-text-send&type=text"],
    ["/appearance", "/appearance"],
  ] as const)(
    "lets AppComponent consume the real evidence token for %s",
    async (route, expectedStartupUrl) => {
      const testCase = productionRouteStructuralCases.find((entry) => entry.route === route)!;
      const { evidenceStartupUrl, fixture } = await mountProductionRoute(testCase);

      expect(evidenceStartupUrl).toBe(expectedStartupUrl);
      fixture.destroy();
    },
  );

  it.each([
    ["/lock", "Barwarden"],
    ["/2fa", "两步登录"],
    ["/new-device-verification", "验证您的身份"],
    ["/hint", "请求密码提示"],
  ] as const)(
    "announces the unique active heading for the real %s route",
    async (route, expectedHeading) => {
      const live = { announce: vi.fn(async () => undefined), clear: vi.fn() };
      const testCase = productionRouteStructuralCases.find((entry) => entry.route === route)!;
      const { fixture, host, router } = await mountProductionRoute(testCase, [
        { provide: LiveAnnouncer, useValue: live },
      ]);
      live.announce.mockClear();
      const staleHeading = document.createElement("h1");
      staleHeading.textContent = "stale private heading";
      host.prepend(staleHeading);

      await router.navigateByUrl(`${route}?private=secret-route-value`);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      await fixture.whenStable();

      expect(live.announce.mock.calls).toEqual([[expectedHeading, "polite"]]);
      expect(JSON.stringify(live.announce.mock.calls)).not.toContain("secret-route-value");
      expect(JSON.stringify(live.announce.mock.calls)).not.toContain("stale private heading");
      fixture.destroy();
    },
  );

  it.each(productionRouteStructuralCases)(
    "mounts $route with one iOS 27 shell",
    async (testCase) => {
      const { fixture, host, router } = await mountProductionRoute(testCase);

      expect(router.url).toBe(testCase.route);
      const routeHost = host.querySelector<HTMLElement>(testCase.routeHostSelector);
      expect(routeHost).not.toBeNull();
      const appRoot = host.matches("barwarden-root")
        ? host
        : host.querySelector<HTMLElement>("barwarden-root") ?? host;
      expect(appRoot.classList).toContain(`ios27-family--${testCase.family}`);
      expect(routeHost!.querySelectorAll("popup-page")).toHaveLength(1);
      expect(routeHost!.querySelectorAll('[data-testid="popup-layout-scroll-region"]'))
        .toHaveLength(1);
      const navigation = host.querySelectorAll(
        'nav[aria-label="主要导航"],nav[aria-label="Primary navigation"]',
      );
      expect(navigation).toHaveLength(
        testCase.layer === "base" && testCase.family !== "auth" ? 1 : 0,
      );
      expect(routeHost!.querySelectorAll("popup-header > header")).toHaveLength(1);
      if (testCase.layer === "secondary") {
        expect(routeHost!.querySelector(
          'popup-header button[aria-label="返回"],popup-header button[aria-label="Back"]',
        )).not.toBeNull();
      }
      const scroll = routeHost!.querySelector<HTMLElement>(
        '[data-testid="popup-layout-scroll-region"]',
      )!;
      // jsdom normally reports 0/0. When layout metrics are available, this
      // assertion becomes a real overflow check; Task 7 owns native WebKit proof.
      if (scroll.clientWidth > 0) {
        expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
      }
      for (const surface of routeHost!.querySelectorAll<HTMLElement>(
        "bit-card,bit-item-group,.macos-group",
      )) {
        expect(getComputedStyle(surface).boxShadow, testCase.route).toBe("none");
      }

      fixture.destroy();
    },
  );
});
