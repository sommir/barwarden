import { InjectionToken } from "@angular/core";

import type { AuthSession } from "../../auth/auth-session-store";
import {
  buildBitwardenEnvironment,
  buildSelfHostedEnvironmentFromServerUrl,
  type BitwardenEnvironment,
} from "../../bitwarden-api/bitwarden-api";
import type { VaultSyncResult } from "../../vault/vault-sync.service";

export interface VaultSyncPort {
  sync(session: AuthSession): Promise<VaultSyncResult>;
}

export const VAULT_SYNC_PORT = new InjectionToken<VaultSyncPort | null>("VAULT_SYNC_PORT", {
  providedIn: "root",
  factory: () => null,
});

export function environmentFromServerUrl(serverUrl: string): BitwardenEnvironment {
  const normalizedServerUrl = normalizeServerUrl(serverUrl);
  const cloudEnvironment = [
    buildBitwardenEnvironment(),
    buildBitwardenEnvironment({ region: "EU" }),
  ].find((environment) => normalizedServerUrl === normalizeServerUrl(environment.webVaultUrl ?? ""));
  if (cloudEnvironment) {
    return cloudEnvironment;
  }

  return buildSelfHostedEnvironmentFromServerUrl(serverUrl);
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/g, "");
}
