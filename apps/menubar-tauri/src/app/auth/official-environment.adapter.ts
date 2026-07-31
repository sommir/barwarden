import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";
import { BehaviorSubject, type Observable } from "rxjs";

import {
  buildBitwardenEnvironment,
  buildSelfHostedEnvironmentFromServerUrl,
  type BitwardenEnvironment,
} from "../../bitwarden-api/bitwarden-api";
import { ACCOUNT_SESSION_PORT, type AccountSessionPort } from "../../auth/account-session-port";
import { PopupStateStore } from "../popup-state";

export type RetainedRegion = "US" | "EU" | "SelfHosted";

const LAST_SELF_HOSTED_SERVER_URL_KEY = "barwarden.last-self-hosted-server-url.v1";

export interface OfficialEnvironmentPort {
  readonly selected$: Observable<RetainedRegion>;
  selectCloud(region: "US" | "EU"): void;
  selectSelfHosted(serverUrl: string): void;
  environmentForAccount(accountId: string): BitwardenEnvironment | null;
}

export type AccountEnvironmentReadiness =
  | { readonly state: "loading" }
  | { readonly state: "ready" }
  | { readonly state: "error"; readonly message: "Unable to load saved account environments." };

export const OFFICIAL_ENVIRONMENT_ACCOUNT_SERVER_URLS = new InjectionToken<Map<string, string>>(
  "OFFICIAL_ENVIRONMENT_ACCOUNT_SERVER_URLS",
  { providedIn: "root", factory: () => new Map() },
);

@Injectable({ providedIn: "root" })
export class OfficialEnvironmentAdapter implements OfficialEnvironmentPort {
  private readonly selectedRegion = new BehaviorSubject<RetainedRegion>(
    regionForServerUrl(this.store.snapshot().serverUrl),
  );

  readonly selected$ = this.selectedRegion.asObservable();
  private readonly readiness = new BehaviorSubject<AccountEnvironmentReadiness>({ state: "loading" });
  private refreshEpoch = 0;
  readonly ready: Promise<void>;

  constructor(
    private readonly store: PopupStateStore,
    @Inject(OFFICIAL_ENVIRONMENT_ACCOUNT_SERVER_URLS)
    private readonly accountServerUrls: Map<string, string> = new Map(),
    @Optional() @Inject(ACCOUNT_SESSION_PORT) private readonly accountStore: AccountSessionPort | null = null,
  ) {
    if (this.accountStore) {
      this.ready = this.refreshAccounts();
    } else {
      this.readiness.next({ state: "ready" });
      this.ready = Promise.resolve();
    }
  }

  selectCloud(region: "US" | "EU"): void {
    const environment = buildBitwardenEnvironment({ region });
    this.store.setServerUrl(environment.webVaultUrl ?? "");
    this.selectedRegion.next(region);
  }

  selectSelfHosted(serverUrl: string): void {
    const normalizedServerUrl = normalizeRetainedSelfHostedBaseUrl(serverUrl);
    if (!normalizedServerUrl) {
      throw new Error("Self-hosted server URL must be an HTTPS base URL");
    }

    const environment = buildSelfHostedEnvironmentFromServerUrl(normalizedServerUrl);
    persistLastSelfHostedServerUrl(normalizedServerUrl);
    this.store.setServerUrl(environment.webVaultUrl ?? normalizedServerUrl);
    this.selectedRegion.next("SelfHosted");
  }

  /** The self-hosted dialog uses this after logout or a fresh app launch. */
  lastSelfHostedServerUrl(): string {
    const selected = normalizeRetainedSelfHostedBaseUrl(this.store.snapshot().serverUrl);
    if (selected && regionForServerUrl(selected) === "SelfHosted") {
      return selected;
    }
    return readLastSelfHostedServerUrl();
  }

  environmentForAccount(accountId: string): BitwardenEnvironment | null {
    if (this.readiness.value.state !== "ready") {
      return null;
    }
    const serverUrl = this.accountServerUrls.get(accountId);
    return serverUrl ? environmentForServerUrl(serverUrl) : null;
  }

  accountReadiness(): AccountEnvironmentReadiness {
    return this.readiness.value;
  }

  async refreshAccounts(): Promise<void> {
    const epoch = ++this.refreshEpoch;
    this.readiness.next({ state: "loading" });
    if (!this.accountStore) {
      if (epoch === this.refreshEpoch) {
        this.readiness.next({ state: "ready" });
      }
      return;
    }

    try {
      const accounts = await this.accountStore.list();
      if (epoch !== this.refreshEpoch) {
        return;
      }
      const next = new Map(accounts.map((account) => [account.id, account.serverUrl]));
      this.accountServerUrls.clear();
      for (const [accountId, serverUrl] of next) {
        this.accountServerUrls.set(accountId, serverUrl);
      }
      this.readiness.next({ state: "ready" });
    } catch {
      if (epoch !== this.refreshEpoch) {
        return;
      }
      this.accountServerUrls.clear();
      this.readiness.next({
        state: "error",
        message: "Unable to load saved account environments.",
      });
    }
  }

  currentEnvironment(): BitwardenEnvironment {
    const environment = environmentForServerUrl(this.store.snapshot().serverUrl);
    if (!environment) {
      throw new Error("Selected environment is not a valid HTTPS environment");
    }
    return environment;
  }
}

export function normalizeRetainedSelfHostedBaseUrl(serverUrl: string): string | null {
  const value = serverUrl.trim();
  if (!value) {
    return null;
  }

  const hasExplicitScheme = !hostnameWithPort(value) && /^[a-z][a-z\d+.-]*:/i.test(value);
  if ((hasExplicitScheme && !/^https:\/\//i.test(value)) || (!hasExplicitScheme && value.includes("://"))) {
    return null;
  }

  try {
    const url = new URL(hasExplicitScheme ? value : `https://${value}`);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
      return null;
    }

    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function environmentForServerUrl(serverUrl: string): BitwardenEnvironment | null {
  if (regionForServerUrl(serverUrl) === "SelfHosted") {
    const normalizedServerUrl = normalizeRetainedSelfHostedBaseUrl(serverUrl);
    if (!normalizedServerUrl) {
      return null;
    }
    return buildSelfHostedEnvironmentFromServerUrl(normalizedServerUrl);
  }
  const region = regionForServerUrl(serverUrl);
  return buildBitwardenEnvironment({ region });
}

function regionForServerUrl(serverUrl: string): RetainedRegion {
  if (serverUrl === buildBitwardenEnvironment({ region: "EU" }).webVaultUrl) {
    return "EU";
  }
  if (serverUrl === buildBitwardenEnvironment({ region: "US" }).webVaultUrl) {
    return "US";
  }
  return "SelfHosted";
}

function hostnameWithPort(value: string): boolean {
  return /^(?:localhost|(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d](?:[a-z\d-]*[a-z\d])?):\d+(?:[/?#]|$)/i.test(value);
}

function persistLastSelfHostedServerUrl(serverUrl: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_SELF_HOSTED_SERVER_URL_KEY, serverUrl);
  } catch {
    // This convenience value is non-sensitive; a storage failure must not block login.
  }
}

function readLastSelfHostedServerUrl(): string {
  try {
    const saved = globalThis.localStorage?.getItem(LAST_SELF_HOSTED_SERVER_URL_KEY) ?? "";
    return normalizeRetainedSelfHostedBaseUrl(saved) ?? "";
  } catch {
    return "";
  }
}
