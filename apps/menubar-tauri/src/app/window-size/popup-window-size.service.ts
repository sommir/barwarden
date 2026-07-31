import { Inject, Injectable, InjectionToken } from "@angular/core";

import { createDefaultHostService } from "../../host/default-host.service";
import type { PopupWindowSizeHost } from "../../host/host-api";

export type { PopupWindowSizeHost } from "../../host/host-api";

const POPUP_MIN_HEIGHT = 600;
const POPUP_HEIGHT_PREFERENCE_KEY = "barwarden.popup-height.v1";

export interface PopupWindowSizePlatform {
  readonly viewportHeight: () => number;
  readonly onResize: (listener: () => void) => () => void;
  readonly readPreference: () => string | null;
  readonly writePreference: (value: string) => void;
}

export const POPUP_WINDOW_SIZE_HOST = new InjectionToken<PopupWindowSizeHost>(
  "POPUP_WINDOW_SIZE_HOST",
  { providedIn: "root", factory: createDefaultHostService },
);

function browserPlatform(): PopupWindowSizePlatform {
  return {
    viewportHeight: () => globalThis.innerHeight,
    onResize: (listener) => {
      globalThis.addEventListener("resize", listener);
      return () => globalThis.removeEventListener("resize", listener);
    },
    readPreference: () => {
      try {
        return globalThis.localStorage?.getItem(POPUP_HEIGHT_PREFERENCE_KEY) ?? null;
      } catch {
        return null;
      }
    },
    writePreference: (value) => {
      try {
        globalThis.localStorage?.setItem(POPUP_HEIGHT_PREFERENCE_KEY, value);
      } catch {
        // Height is a convenience preference; unavailable web storage must not
        // interrupt the popup lifecycle.
      }
    },
  };
}

export const POPUP_WINDOW_SIZE_PLATFORM = new InjectionToken<PopupWindowSizePlatform>(
  "POPUP_WINDOW_SIZE_PLATFORM",
  { providedIn: "root", factory: browserPlatform },
);

/**
 * Keeps the popup at the user's chosen height. Route/content changes never
 * resize the native window; only an explicit drag or a stored preference does.
 */
@Injectable({ providedIn: "root" })
export class PopupWindowSizeService {
  private maximumHeight = POPUP_MIN_HEIGHT;
  private unlistenResize: (() => void) | null = null;
  private disposed = false;

  constructor(
    @Inject(POPUP_WINDOW_SIZE_HOST) private readonly host: PopupWindowSizeHost,
    @Inject(POPUP_WINDOW_SIZE_PLATFORM)
    private readonly platform: PopupWindowSizePlatform = browserPlatform(),
  ) {}

  async start(): Promise<void> {
    let metrics: { readonly currentHeight: number; readonly maximumHeight: number };
    try {
      metrics = await this.host.getPopupWindowMetrics();
    } catch {
      metrics = { currentHeight: POPUP_MIN_HEIGHT, maximumHeight: POPUP_MIN_HEIGHT };
    }
    if (this.disposed) return;

    this.maximumHeight = Math.max(POPUP_MIN_HEIGHT, metrics.maximumHeight);
    const preferred = parsePreferredHeight(this.platform.readPreference());
    const target = clamp(preferred ?? metrics.currentHeight, POPUP_MIN_HEIGHT, this.maximumHeight);
    this.unlistenResize = this.platform.onResize(() => this.rememberViewportHeight());

    if (Math.abs(target - metrics.currentHeight) >= 1) {
      await this.host.setPopupHeight(target).catch(() => undefined);
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unlistenResize?.();
    this.unlistenResize = null;
  }

  private rememberViewportHeight(): void {
    if (this.disposed) return;
    const height = clamp(this.platform.viewportHeight(), POPUP_MIN_HEIGHT, this.maximumHeight);
    this.platform.writePreference(String(Math.round(height)));
  }
}

export function parsePreferredHeight(value: string | null): number | null {
  if (!value) return null;
  const height = Number(value);
  return Number.isFinite(height) && height >= POPUP_MIN_HEIGHT ? height : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
