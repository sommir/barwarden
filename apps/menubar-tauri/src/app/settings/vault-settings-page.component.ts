import { ChangeDetectorRef, Component } from "@angular/core";
import { Router } from "@angular/router";

import {
  OfficialVaultSettingsComponent,
  type RetainedVaultSettingsRoute,
} from "../upstream-overlays/settings/official-vault-settings.component";
import { PopupStateStore } from "../popup-state";
import { VaultSessionService } from "../vault/vault-session.service";
import type { RetainedSettingsActions } from "./settings-actions.port";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

@Component({
  selector: "bw-vault-settings-page",
  host: { class: "macos-page macos-page--secondary macos-page--settings-detail" },
  standalone: true,
  imports: [OfficialVaultSettingsComponent],
  template: `
    <bw-official-vault-settings
      [isSyncing]="isSyncing"
      [syncLabel]="syncLabel"
      [syncError]="syncError"
      (back)="back()"
      (navigate)="navigateTo($event)"
      (sync)="syncNow()"
    />
  `,
})
export class VaultSettingsPageComponent {
  isSyncing = false;
  syncError = "";

  constructor(
    private readonly store: PopupStateStore,
    private readonly vaultSession: VaultSessionService,
    private readonly router: Router,
    private readonly changeDetectorRef: ChangeDetectorRef,
  ) {}

  get syncLabel(): string {
    if (this.isSyncing) {
      return translateOfficialMessage("i18nSyncing");
    }
    const lastSyncDate = this.store.snapshot().lastSyncDate;
    return lastSyncDate
      ? lastSyncDate.toLocaleString()
      : translateOfficialMessage("i18nNeverSynced");
  }

  async back(): Promise<void> {
    await this.router.navigateByUrl("/tabs/settings");
  }

  async navigateTo(route: RetainedVaultSettingsRoute): Promise<void> {
    await this.router.navigateByUrl(route);
  }

  readonly syncNow: RetainedSettingsActions["syncNow"] = async () => {
    if (this.isSyncing) {
      return;
    }
    this.isSyncing = true;
    this.syncError = "";
    try {
      await this.vaultSession.syncNow();
    } catch {
      this.syncError = translateOfficialMessage("i18nSyncVaultFailedRetry");
    } finally {
      this.isSyncing = false;
      this.changeDetectorRef.markForCheck();
    }
  };
}
