import type { ActivatedRouteSnapshot } from "@angular/router";

export type Ios27PageFamily =
  | "auth"
  | "shell"
  | "vault"
  | "otp"
  | "generator"
  | "send"
  | "settings"
  | "document";

export type PopupLayer = "base" | "secondary";

export type PopupFocusKey = string & {
  readonly __popupFocusKey: unique symbol;
};

export function popupFocusKey(value: string): PopupFocusKey {
  if (!value || value.trim() !== value) {
    throw new Error("Popup focus keys must be non-empty and already trimmed");
  }
  return value as PopupFocusKey;
}

export interface Ios27RouteData {
  readonly ios27Family: Ios27PageFamily;
  readonly popupLayer: PopupLayer;
  readonly bottomNavigation: boolean;
}

const PAGE_FAMILIES = new Set<Ios27PageFamily>([
  "auth",
  "shell",
  "vault",
  "otp",
  "generator",
  "send",
  "settings",
  "document",
]);

const POPUP_LAYERS = new Set<PopupLayer>(["base", "secondary"]);

export function ios27RouteData(
  family: Ios27PageFamily,
  layer: PopupLayer,
  bottomNavigation = false,
): Ios27RouteData {
  return {
    ios27Family: family,
    popupLayer: layer,
    bottomNavigation,
  };
}

export function deepestIos27RouteData(
  root: ActivatedRouteSnapshot,
): Ios27RouteData | null {
  let current: ActivatedRouteSnapshot | null = root;
  let deepest: Ios27RouteData | null = null;

  while (current !== null) {
    if (isIos27RouteData(current.data)) {
      deepest = current.data;
    }
    current = current.firstChild;
  }

  return deepest;
}

function isIos27RouteData(value: unknown): value is Ios27RouteData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Ios27RouteData>;
  return PAGE_FAMILIES.has(candidate.ios27Family as Ios27PageFamily)
    && POPUP_LAYERS.has(candidate.popupLayer as PopupLayer)
    && typeof candidate.bottomNavigation === "boolean";
}
