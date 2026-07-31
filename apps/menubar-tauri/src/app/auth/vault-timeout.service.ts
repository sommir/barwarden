import { Injectable } from "@angular/core";

import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";

@Injectable({ providedIn: "root" })
export class VaultTimeoutService {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private lockHandler: (() => void) | null = null;
  private logoutHandler: (() => void) | null = null;

  constructor(
    private readonly store: PopupStateStore,
    private readonly settings: SettingsService,
  ) {}

  start(): void {
    this.recordActivity();
  }

  reschedule(): void {
    this.recordActivity();
  }

  setLockHandler(handler: () => void): void {
    this.lockHandler = handler;
  }

  setTimeoutHandlers(lockHandler: () => void, logoutHandler: () => void): void {
    this.lockHandler = lockHandler;
    this.logoutHandler = logoutHandler;
  }

  useAccount(accountId: string | null): void {
    this.settings.useAccount(accountId);
  }

  stop(): void {
    if (this.timeoutId === null) {
      return;
    }

    clearTimeout(this.timeoutId);
    this.timeoutId = null;
  }

  recordActivity(): void {
    this.stop();

    if (!this.store.snapshot().isUnlocked) {
      return;
    }

    const timeoutMinutes = this.settings.snapshot().vaultTimeoutMinutes;
    if (timeoutMinutes < 0) {
      return;
    }
    if (timeoutMinutes === 0) {
      this.lockNow();
      return;
    }

    this.timeoutId = setTimeout(() => {
      if (this.store.snapshot().isUnlocked) {
        this.lockNow();
      }
      this.timeoutId = null;
    }, timeoutMinutes * 60_000);
  }

  private lockNow(): void {
    if (this.settings.snapshot().vaultTimeoutAction === "logout" && this.logoutHandler) {
      this.logoutHandler();
      return;
    }

    if (this.lockHandler) {
      this.lockHandler();
      return;
    }

    this.store.setLocked();
  }
}
