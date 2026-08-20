import "zone.js";
import "@angular/compiler";

import {
  BrowserTestingModule,
  platformBrowserTesting,
} from "@angular/platform-browser/testing";
import { TestBed } from "@angular/core/testing";
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
