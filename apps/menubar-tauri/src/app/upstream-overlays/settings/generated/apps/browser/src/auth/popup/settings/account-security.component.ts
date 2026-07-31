// Official Settings overlay source; generated.
// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { BehaviorSubject, firstValueFrom } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { FingerprintDialogComponent } from "@bitwarden/auth/angular";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { EnvironmentService } from "@bitwarden/common/platform/abstractions/environment.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import {
  CardComponent,
  DialogService,
  ItemModule,
  SectionComponent,
  SectionHeaderComponent,
  TypographyModule,
} from "@bitwarden/components";
type FingerprintKeyPort = { userPublicKey$(userId: string): import("rxjs").Observable<unknown | null>; getFingerprint(userId: string, publicKey: unknown): Promise<string> };
import { SessionTimeoutSettingsComponent } from "@bitwarden/key-management-ui";

import { PopOutComponent } from "../../../platform/popup/components/pop-out.component";
import { PopupHeaderComponent } from "../../../platform/popup/layout/popup-header.component";
import { PopupPageComponent } from "../../../platform/popup/layout/popup-page.component";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  templateUrl: "account-security.component.html",
  imports: [
    CardComponent,
    CommonModule,
    ItemModule,
    JslibModule,
    PopOutComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    SectionComponent,
    SectionHeaderComponent,
    SessionTimeoutSettingsComponent,
    TypographyModule,
  ],
})
export class AccountSecurityComponent {
  protected refreshTimeoutSettings$ = new BehaviorSubject<void>(undefined);

  constructor(
    private accountService: AccountService,
    private environmentService: EnvironmentService,
    private fingerprintKeyPort: FingerprintKeyPort,
    private dialogService: DialogService,
    private logService: LogService,
    private platformUtilsService: PlatformUtilsService,
  ) {}

  async changePassword() {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: { key: "continueToWebApp" },
      content: { key: "changeMasterPasswordOnWebConfirmation" },
      type: "info",
      acceptButtonText: { key: "continue" },
      cancelButtonText: { key: "cancel" },
    });
    if (confirmed) {
      const env = await firstValueFrom(this.environmentService.environment$);
      this.platformUtilsService.launchUri(env.getWebVaultUrl());
    }
  }

  async twoStep() {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: { key: "twoStepLoginConfirmationTitle" },
      content: { key: "twoStepLoginConfirmationContent" },
      type: "info",
      acceptButtonText: { key: "continue" },
      cancelButtonText: { key: "cancel" },
    });
    if (confirmed) {
      this.platformUtilsService.launchUri("https://bitwarden.com/help/setup-two-step-login/");
    }
  }

  async openAcctFingerprintDialog() {
    const activeUserId = await firstValueFrom(getUserId(this.accountService.activeAccount$));
    const publicKey = await firstValueFrom(this.fingerprintKeyPort.userPublicKey$(activeUserId));
    if (publicKey == null) {
      this.logService.error(
        "[AccountSecurityComponent] No public key available for the user: " +
          activeUserId +
          " fingerprint can't be displayed.",
      );
      return;
    }
    const fingerprint = await this.fingerprintKeyPort.getFingerprint(activeUserId, publicKey);
    const dialogRef = FingerprintDialogComponent.open(this.dialogService, { fingerprint });
    return firstValueFrom(dialogRef.closed);
  }
}
