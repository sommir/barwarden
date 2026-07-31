import { TauriHostService } from "../../../host/tauri-host.service";

import { normalizeRetainedPopoutRoute } from "./retained-popout-route";

/**
 * Native popup-only replacement for the one BrowserPopupUtils dependency used by PopOutComponent.
 * It reads only this SPA's hash route and sends it to the existing native pop_out command.
 */
export default class BrowserPopupUtils {
  static inSidebar(_win: Window): boolean {
    return false;
  }

  static inPopout(win: Window): boolean {
    return new URL(win.location.href).searchParams.get("uilocation") === "popout";
  }

  static async openCurrentPagePopout(win: Window): Promise<void> {
    await new TauriHostService().popOut(currentPopupRoute(win.location));
  }
}

export function currentPopupRoute(location: Location): string {
  return normalizeRetainedPopoutRoute(location.hash.replace(/^#/, ""));
}
