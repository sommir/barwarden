import { Inject, Injectable, InjectionToken, signal } from "@angular/core";

import { TauriHostService } from "../../host/tauri-host.service";
import type { WebsiteContextHost } from "../../host/website-context";

export const WEBSITE_CONTEXT_HOST = new InjectionToken<WebsiteContextHost>(
  "WEBSITE_CONTEXT_HOST",
  {
    providedIn: "root",
    factory: () => new TauriHostService(),
  },
);

@Injectable({ providedIn: "root" })
export class CurrentWebsiteContextService {
  private readonly currentUrl = signal<string | null>(null);
  private requestEpoch = 0;

  constructor(
    @Inject(WEBSITE_CONTEXT_HOST)
    private readonly host: WebsiteContextHost,
  ) {}

  url(): string | null {
    return this.currentUrl();
  }

  async refresh(): Promise<void> {
    const epoch = ++this.requestEpoch;
    try {
      const context = await this.host.capturedWebsiteContext();
      if (epoch === this.requestEpoch) {
        this.currentUrl.set(context.status === "available" ? context.url : null);
      }
    } catch {
      if (epoch === this.requestEpoch) {
        this.currentUrl.set(null);
      }
    }
  }

  clear(): void {
    this.requestEpoch += 1;
    this.currentUrl.set(null);
  }
}
