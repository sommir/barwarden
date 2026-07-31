import { Inject, Injectable, InjectionToken, signal } from "@angular/core";

import type { HostApi } from "../../host/host-api";
import { TauriHostService } from "../../host/tauri-host.service";

export const ACCESSIBILITY_PERMISSION_STATUS = "已复制内容；启用“辅助功能”权限后可自动填充。";
export const ACCESSIBILITY_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

export const ACCESSIBILITY_SETTINGS_HOST = new InjectionToken<Pick<HostApi, "openUrl">>(
  "ACCESSIBILITY_SETTINGS_HOST",
  {
    providedIn: "root",
    factory: () => new TauriHostService(),
  },
);

/** Coordinates the explicit, user-initiated accessibility permission handoff. */
@Injectable({ providedIn: "root" })
export class AccessibilityPermissionDialogService {
  readonly isOpen = signal(false);
  readonly openingSettings = signal(false);
  readonly launchFailed = signal(false);

  constructor(
    @Inject(ACCESSIBILITY_SETTINGS_HOST)
    private readonly host: Pick<HostApi, "openUrl">,
  ) {}

  present(): void {
    this.launchFailed.set(false);
    this.isOpen.set(true);
  }

  dismiss(): void {
    if (!this.openingSettings()) {
      this.isOpen.set(false);
    }
  }

  async openSystemSettings(): Promise<void> {
    if (this.openingSettings()) {
      return;
    }
    this.openingSettings.set(true);
    this.launchFailed.set(false);
    try {
      await this.host.openUrl(ACCESSIBILITY_SETTINGS_URL);
      this.isOpen.set(false);
    } catch {
      this.launchFailed.set(true);
    } finally {
      this.openingSettings.set(false);
    }
  }
}
