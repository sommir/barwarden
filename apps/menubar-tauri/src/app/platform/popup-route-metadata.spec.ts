import "@angular/compiler";

import type { ActivatedRouteSnapshot } from "@angular/router";
import { describe, expect, it } from "vitest";

import {
  deepestIos27RouteData,
  ios27RouteData,
} from "./popup-route-metadata";

describe("popup route metadata", () => {
  it("creates literal typed metadata with a false bottom-navigation default", () => {
    expect(ios27RouteData("auth", "secondary")).toEqual({
      ios27Family: "auth",
      popupLayer: "secondary",
      bottomNavigation: false,
    });
    expect(ios27RouteData("vault", "base", true)).toEqual({
      ios27Family: "vault",
      popupLayer: "base",
      bottomNavigation: true,
    });
  });

  it("returns the deepest valid metadata on the activated first-child chain", () => {
    const leaf = snapshot(ios27RouteData("vault", "base", true));
    const invalid = snapshot({ ios27Family: "vault", popupLayer: "base" }, leaf);
    const root = snapshot(ios27RouteData("shell", "base", true), invalid);

    expect(deepestIos27RouteData(root)).toEqual({
      ios27Family: "vault",
      popupLayer: "base",
      bottomNavigation: true,
    });
  });

  it("returns null when no activated snapshot has complete route metadata", () => {
    const root = snapshot({}, snapshot({ popupLayer: "secondary" }));

    expect(deepestIos27RouteData(root)).toBeNull();
  });
});

function snapshot(
  data: object,
  firstChild: ActivatedRouteSnapshot | null = null,
): ActivatedRouteSnapshot {
  return { data, firstChild } as unknown as ActivatedRouteSnapshot;
}
