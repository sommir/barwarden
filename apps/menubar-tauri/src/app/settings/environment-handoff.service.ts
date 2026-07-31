import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";

import type { HostApi } from "../../host/host-api";
import { TauriHostService } from "../../host/tauri-host.service";
import { PopupStateStore } from "../popup-state";
import { aboutMetadata } from "./about-metadata";

export const helpUrl = "https://bitwarden.com/help/" as const;
export const twoStepLoginHelpUrl = "https://bitwarden.com/help/setup-two-step-login/" as const;
export const sourceUrl = aboutMetadata.sourceUrl;
const webVaultPaths = Object.freeze(["", "/#/settings/security/password"] as const);
const externalUrls = Object.freeze([helpUrl, twoStepLoginHelpUrl, sourceUrl] as const);

export type WebVaultPath = (typeof webVaultPaths)[number];
export type HelpOrSourceUrl = (typeof externalUrls)[number];

export const ENVIRONMENT_HANDOFF_HOST = new InjectionToken<HostApi | null>(
  "ENVIRONMENT_HANDOFF_HOST",
  {
    providedIn: "root",
    factory: () => null,
  },
);

@Injectable({ providedIn: "root" })
export class EnvironmentHandoffService {
  private readonly host: HostApi;

  constructor(
    private readonly store: PopupStateStore,
    @Optional() @Inject(ENVIRONMENT_HANDOFF_HOST) host: HostApi | null = null,
  ) {
    this.host = host ?? new TauriHostService();
  }

  async openWebVault(path: WebVaultPath): Promise<void> {
    if (!webVaultPaths.includes(path)) {
      throw new Error("Unsupported Web Vault URL");
    }
    await this.host.openUrl(`${this.activeWebVaultUrl()}${path}`);
  }

  async openExternal(url: HelpOrSourceUrl): Promise<void> {
    if (!externalUrls.includes(url) || !isHttpsUrl(url)) {
      throw new Error("Unsupported external URL");
    }
    await this.host.openUrl(url);
  }

  private activeWebVaultUrl(): string {
    const serverUrl = this.store.snapshot().serverUrl;
    try {
      const url = new URL(serverUrl);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new Error("Unsupported Web Vault URL");
      }
      return url.href.replace(/\/+$/, "");
    } catch {
      throw new Error("Unsupported Web Vault URL");
    }
  }
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
