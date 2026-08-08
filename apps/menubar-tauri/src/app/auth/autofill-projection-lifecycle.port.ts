import { InjectionToken } from "@angular/core";

export interface AutoFillProjectionLifecyclePort {
  invalidateAndLock(): Promise<void>;
}

export const AUTOFILL_PROJECTION_LIFECYCLE_PORT =
  new InjectionToken<AutoFillProjectionLifecyclePort | null>(
    "AUTOFILL_PROJECTION_LIFECYCLE_PORT",
    { providedIn: "root", factory: () => null },
  );
