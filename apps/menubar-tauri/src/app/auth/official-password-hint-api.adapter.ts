import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";

import { BitwardenApiClient, type HttpTransport } from "../../bitwarden-api/bitwarden-api";
import { TauriHostService } from "../../host/tauri-host.service";
import { environmentFromServerUrl } from "./vault-sync.shared";

export interface OfficialPasswordHintPort {
  request(serverUrl: string, email: string): Promise<void>;
}

export class OfficialPasswordHintRequestError extends Error {
  constructor() {
    super("Unable to request password hint");
  }
}

export const OFFICIAL_PASSWORD_HINT_TRANSPORT = new InjectionToken<HttpTransport | null>(
  "OFFICIAL_PASSWORD_HINT_TRANSPORT",
  { providedIn: "root", factory: () => null },
);

@Injectable({ providedIn: "root" })
export class OfficialPasswordHintApiAdapter implements OfficialPasswordHintPort {
  private readonly transport: HttpTransport;

  constructor(
    @Optional() @Inject(OFFICIAL_PASSWORD_HINT_TRANSPORT) transport: HttpTransport | null = null,
  ) {
    this.transport = transport ?? new TauriHostService();
  }

  async request(serverUrl: string, email: string): Promise<void> {
    try {
      const safeServerUrl = normalizeSupportedHttpsServerUrl(serverUrl);
      await new BitwardenApiClient(environmentFromServerUrl(safeServerUrl), this.transport).postPasswordHint({
        email: email.trim(),
      });
    } catch {
      throw new OfficialPasswordHintRequestError();
    }
  }
}

function normalizeSupportedHttpsServerUrl(serverUrl: string): string {
  const url = new URL(serverUrl.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Unsupported server URL");
  }

  const pathname = url.pathname.replace(/\/+$/g, "") || "";
  const isCloud = url.hostname === "vault.bitwarden.com" || url.hostname === "vault.bitwarden.eu";
  if (isCloud && (pathname || url.port)) {
    throw new Error("Unsupported cloud server URL");
  }

  return `${url.origin}${pathname}`;
}
