import { InjectionToken } from "@angular/core";

import { createDefaultHostService } from "../../host/default-host.service";
import type { LaunchAtLoginHost } from "../../host/launch-at-login";

export const LAUNCH_AT_LOGIN_HOST = new InjectionToken<LaunchAtLoginHost>(
  "LAUNCH_AT_LOGIN_HOST",
  {
    providedIn: "root",
    factory: createDefaultHostService,
  },
);
