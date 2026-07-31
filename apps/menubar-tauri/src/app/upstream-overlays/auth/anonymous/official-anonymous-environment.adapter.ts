import { Injectable } from "@angular/core";
import { of } from "rxjs";

import {
  type Environment,
  EnvironmentService,
  Region,
  type RegionConfig,
  type Urls,
} from "@bitwarden/common/platform/abstractions/environment.service";

import { buildBitwardenEnvironment } from "../../../../bitwarden-api/bitwarden-api";

@Injectable()
export class OfficialAnonymousEnvironmentAdapter extends EnvironmentService {
  private readonly environment = new RetainedAnonymousEnvironment();

  readonly environment$ = of(this.environment);
  readonly globalEnvironment$ = this.environment$;
  readonly cloudWebVaultUrl$ = of(this.environment.getWebVaultUrl());

  availableRegions(): RegionConfig[] {
    return [];
  }

  async setEnvironment(_region: Region, _urls?: Urls): Promise<Urls> {
    return this.environment.getUrls();
  }

  async seedUserEnvironment(): Promise<void> {}
  async setCloudRegion(): Promise<void> {}
  getEnvironment$() { return this.environment$; }
  async getEnvironment(): Promise<Environment> { return this.environment; }
}

class RetainedAnonymousEnvironment implements Environment {
  private readonly environment = buildBitwardenEnvironment();

  getRegion(): Region { return Region.US; }
  getUrls(): Urls {
    return {
      api: this.environment.apiUrl,
      identity: this.environment.identityUrl,
      icons: this.environment.iconsUrl ?? undefined,
      webVault: this.environment.webVaultUrl ?? undefined,
      send: this.environment.sendUrl ?? undefined,
    };
  }
  isCloud(): boolean { return true; }
  getApiUrl(): string { return this.environment.apiUrl; }
  getEventsUrl(): string { return this.environment.apiUrl; }
  getIconsUrl(): string { return this.environment.iconsUrl ?? ""; }
  getIdentityUrl(): string { return this.environment.identityUrl; }
  getKeyConnectorUrl(): string | null { return null; }
  getNotificationsUrl(): string { return ""; }
  getScimUrl(): string { return ""; }
  getSendUrl(): string { return this.environment.sendUrl ?? ""; }
  getWebVaultUrl(): string { return this.environment.webVaultUrl ?? ""; }
  getHostname(): string { return "vault.bitwarden.com"; }
  hasBaseUrl(): boolean { return false; }
}
