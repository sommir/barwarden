import { InjectionToken } from "@angular/core";

export interface AvailableAppUpdate {
  readonly version: string;
  readonly notes: string | null;
  downloadAndInstall(onProgress: (value: number | null) => void): Promise<void>;
}

export interface AppUpdatePort {
  check(): Promise<AvailableAppUpdate | null>;
}

export const APP_UPDATE_PORT = new InjectionToken<AppUpdatePort | null>("APP_UPDATE_PORT", {
  providedIn: "root",
  factory: () => null,
});
