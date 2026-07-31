// Official Settings overlay source; generated.
import { CommonModule } from "@angular/common";
import { Component, OnInit } from "@angular/core";
import { RouterModule } from "@angular/router";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { SyncService } from "@bitwarden/common/vault/abstractions/sync/sync.service.abstraction";
import { ItemModule, SpinnerComponent, ToastOptions, ToastService } from "@bitwarden/components";

import { PopOutComponent } from "../../../platform/popup/components/pop-out.component";
import { PopupHeaderComponent } from "../../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../../platform/popup/layout/popup-page.component";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  templateUrl: "vault-settings.component.html",
  imports: [
    CommonModule,
    JslibModule,
    RouterModule,
    PopupPageComponent,
    PopupHeaderComponent,
    PopOutComponent,
    ItemModule,
    SpinnerComponent,
  ],
})
export class VaultSettingsComponent implements OnInit {
  lastSync = "--";
  syncLoading = false;

  constructor(
    private syncService: SyncService,
    private toastService: ToastService,
    private i18nService: I18nService,
  ) {}

  async ngOnInit() {
    await this.setLastSync();
  }

  async sync() {
    this.syncLoading = true;
    let toastConfig: ToastOptions;

    try {
      const success = await this.syncService.fullSync(true);
      if (success) {
        await this.setLastSync();
        toastConfig = {
          variant: "success",
          title: "",
          message: this.i18nService.t("syncingComplete"),
        };
      } else {
        toastConfig = {
          variant: "error",
          title: "",
          message: this.i18nService.t("syncingFailed"),
        };
      }
      this.toastService.showToast(toastConfig);
    } finally {
      this.syncLoading = false;
    }
  }

  private async setLastSync() {
    const last = await this.syncService.getLastSync();
    if (last != null) {
      this.lastSync = last.toLocaleDateString() + " " + last.toLocaleTimeString();
    } else {
      this.lastSync = this.i18nService.t("never");
    }
  }
}
