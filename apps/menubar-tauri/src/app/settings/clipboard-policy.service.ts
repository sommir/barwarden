import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";

import type { HostApi } from "../../host/host-api";
import { TauriHostService } from "../../host/tauri-host.service";
import { SettingsService } from "./settings.service";

export const CLIPBOARD_POLICY_HOST = new InjectionToken<HostApi | null>("CLIPBOARD_POLICY_HOST", {
  providedIn: "root",
  factory: () => null,
});

@Injectable({ providedIn: "root" })
export class ClipboardPolicyService {
  private readonly defaultHost: HostApi;

  constructor(
    private readonly settings: SettingsService,
    @Optional() @Inject(CLIPBOARD_POLICY_HOST) host: HostApi | null = null,
  ) {
    this.defaultHost = host ?? new TauriHostService();
  }

  copy(value: string, host: HostApi | null = null): Promise<void> {
    return (host ?? this.defaultHost).copyText(
      value,
      this.settings.snapshot().clipboardClearSeconds,
    );
  }
}
