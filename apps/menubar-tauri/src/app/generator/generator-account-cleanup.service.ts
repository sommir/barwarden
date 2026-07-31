import { Inject, Injectable } from "@angular/core";

import type { AccountLogoutCleanupPort } from "../auth/account-logout-cleanup";
import { GeneratorHistoryStore } from "./generator-history.store";
import { GENERATOR_HISTORY_STORE, generatorSettingsStorageKey } from "./generator.service";
import { SettingsService } from "../settings/settings.service";

@Injectable({ providedIn: "root" })
export class GeneratorAccountCleanupService implements AccountLogoutCleanupPort {
  constructor(
    @Inject(GENERATOR_HISTORY_STORE) private readonly historyStore: GeneratorHistoryStore,
    private readonly settings: SettingsService,
  ) {}

  async clearAccount(accountId: string): Promise<void> {
    await this.historyStore.clear(accountId);
    globalThis.localStorage?.removeItem(generatorSettingsStorageKey(accountId));
    this.settings.clearAccount(accountId);
  }
}
