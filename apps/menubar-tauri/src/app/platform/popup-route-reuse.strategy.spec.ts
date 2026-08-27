import "@angular/compiler";

import { describe, expect, it } from "vitest";
import type { ActivatedRouteSnapshot, Route } from "@angular/router";

import { PopupRouteReuseStrategy } from "./popup-route-reuse.strategy";

function snapshot(routeConfig: Route): ActivatedRouteSnapshot {
  return { routeConfig } as ActivatedRouteSnapshot;
}

describe("PopupRouteReuseStrategy", () => {
  it("has no retired AutoFill picker exception in same-route reuse", () => {
    const strategy = new PopupRouteReuseStrategy();
    const routeConfig: Route = { path: "autofill-picker" };

    expect(strategy.shouldReuseRoute(snapshot(routeConfig), snapshot(routeConfig))).toBe(true);
  });

  it("continues reusing ordinary same-route navigation", () => {
    const strategy = new PopupRouteReuseStrategy();
    const routeConfig: Route = { path: "tabs" };

    expect(strategy.shouldReuseRoute(snapshot(routeConfig), snapshot(routeConfig))).toBe(true);
  });
});
