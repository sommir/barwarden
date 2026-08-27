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
  private readonly triggerState = signal<HTMLElement | null>(null);
  readonly trigger = this.triggerState.asReadonly();

  private presentationActive = false;
  private presentationEpoch = 0;

  constructor(
    @Inject(ACCESSIBILITY_SETTINGS_HOST)
    private readonly host: Pick<HostApi, "openUrl">,
  ) {}

  present(trigger: HTMLElement | null = activeHTMLElement()): void {
    if (this.presentationActive) {
      return;
    }
    this.presentationActive = true;
    this.presentationEpoch += 1;
    this.launchFailed.set(false);
    this.triggerState.set(trigger);
    this.isOpen.set(true);
  }

  dismiss(): void {
    if (this.presentationActive && !this.openingSettings()) {
      this.isOpen.set(false);
    }
  }

  sheetClosed(): void {
    if (!this.presentationActive) {
      return;
    }
    this.presentationActive = false;
    this.presentationEpoch += 1;
    this.isOpen.set(false);
    this.openingSettings.set(false);
    this.launchFailed.set(false);
    this.triggerState.set(null);
  }

  async openSystemSettings(): Promise<void> {
    if (!this.presentationActive || !this.isOpen() || this.openingSettings()) {
      return;
    }
    const epoch = this.presentationEpoch;
    this.openingSettings.set(true);
    this.launchFailed.set(false);
    try {
      await this.host.openUrl(ACCESSIBILITY_SETTINGS_URL);
      if (this.isCurrentPresentation(epoch)) {
        this.isOpen.set(false);
      }
    } catch {
      if (this.isCurrentPresentation(epoch)) {
        this.launchFailed.set(true);
      }
    } finally {
      if (this.isCurrentPresentation(epoch)) {
        this.openingSettings.set(false);
      }
    }
  }

  private isCurrentPresentation(epoch: number): boolean {
    return this.presentationActive && this.presentationEpoch === epoch;
  }
}

function activeHTMLElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
