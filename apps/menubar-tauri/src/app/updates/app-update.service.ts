import { Inject, Injectable, Optional } from "@angular/core";

import {
  APP_UPDATE_PORT,
  type AppUpdatePort,
  type AvailableAppUpdate,
} from "./app-update.port";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "error";

export interface AppUpdateView {
  readonly status: AppUpdateStatus;
  readonly version: string | null;
  readonly notes: string | null;
  readonly progress: number | null;
  readonly message: string;
}

@Injectable({ providedIn: "root" })
export class AppUpdateService {
  private candidate: AvailableAppUpdate | null = null;
  private operation: Promise<void> | null = null;
  private view = createView("idle", null, null, null, "");

  constructor(
    @Optional() @Inject(APP_UPDATE_PORT) private readonly port: AppUpdatePort | null = null,
  ) {}

  snapshot(): AppUpdateView {
    return this.view;
  }

  checkManually(): Promise<void> {
    return this.check(true);
  }

  checkInBackground(): Promise<void> {
    return this.check(false);
  }

  downloadAndRestart(): Promise<void> {
    if (this.operation || !this.candidate) {
      return this.operation ?? Promise.resolve();
    }

    const candidate = this.candidate;
    this.publish("downloading", candidate.version, candidate.notes, null, "");
    this.operation = candidate
      .downloadAndInstall((progress) => {
        this.publish("downloading", candidate.version, candidate.notes, normalizeProgress(progress), "");
      })
      .then(() => {
        this.candidate = null;
        this.publish("idle", null, null, null, "");
      })
      .catch(() => {
        this.candidate = null;
        this.publish(
          "error",
          null,
          null,
          null,
          translateOfficialMessage("i18nUpdateInstallFailed"),
        );
      })
      .finally(() => {
        this.operation = null;
      });
    return this.operation;
  }

  dismiss(): void {
    if (this.operation) {
      return;
    }
    this.candidate = null;
    this.publish("idle", null, null, null, "");
  }

  private check(manual: boolean): Promise<void> {
    if (this.operation) {
      return this.operation;
    }

    this.publish("checking", null, null, null, "");
    this.operation = this.resolveCandidate(manual).finally(() => {
      this.operation = null;
    });
    return this.operation;
  }

  private async resolveCandidate(manual: boolean): Promise<void> {
    if (!this.port) {
      this.publish(
        manual ? "error" : "idle",
        null,
        null,
        null,
        manual ? translateOfficialMessage("i18nUpdateUnsupported") : "",
      );
      return;
    }

    try {
      const candidate = await this.port.check();
      this.candidate = candidate;
      if (candidate) {
        this.publish("available", candidate.version, candidate.notes, null, "");
        return;
      }
      this.publish(
        manual ? "up-to-date" : "idle",
        null,
        null,
        null,
        manual ? translateOfficialMessage("i18nUpToDate") : "",
      );
    } catch {
      this.candidate = null;
      this.publish(
        manual ? "error" : "idle",
        null,
        null,
        null,
        manual ? translateOfficialMessage("i18nUpdateCheckFailed") : "",
      );
    }
  }

  private publish(
    status: AppUpdateStatus,
    version: string | null,
    notes: string | null,
    progress: number | null,
    message: string,
  ): void {
    this.view = createView(status, version, notes, progress, message);
  }
}

function normalizeProgress(progress: number | null): number | null {
  if (progress === null || !Number.isFinite(progress)) {
    return null;
  }
  return Math.min(1, Math.max(0, progress));
}

function createView(
  status: AppUpdateStatus,
  version: string | null,
  notes: string | null,
  progress: number | null,
  message: string,
): AppUpdateView {
  return Object.freeze({ status, version, notes, progress, message });
}
