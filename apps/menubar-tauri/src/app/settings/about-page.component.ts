import { Location } from "@angular/common";
import { Component } from "@angular/core";
import { Router } from "@angular/router";

import {
  OfficialAboutComponent,
} from "../upstream-overlays/settings/official-about.component";
import type {
  OfficialAboutDialogMetadata,
  OfficialAboutRevisionCopyStatus,
  OfficialAboutDialogView,
} from "../upstream-overlays/settings/official-about-dialog.component";
import { PopupStateStore } from "../popup-state";
import { aboutMetadata, aboutVersion } from "./about-metadata";
import { EnvironmentHandoffService, helpUrl, sourceUrl } from "./environment-handoff.service";
import { ClipboardPolicyService } from "./clipboard-policy.service";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { AppUpdateService, type AppUpdateView } from "../updates/app-update.service";

@Component({
  selector: "bw-about-page",
  host: { class: "macos-page macos-page--secondary macos-page--about" },
  standalone: true,
  imports: [OfficialAboutComponent],
  template: `
    <bw-official-about
      [metadata]="metadata"
      [metadataView]="metadataView"
      [revisionCopyStatus]="revisionCopyStatus"
      [handoffError]="handoffError"
      [updateView]="updateView"
      (back)="back()"
      (metadataViewChange)="setMetadataView($event)"
      (openThirdPartyNotices)="openThirdPartyNotices()"
      (openHelp)="openHelp()"
      (openWebVault)="openWebVault()"
      (openProjectSource)="openProjectSource()"
      (copyRevision)="copyRevision()"
      (checkForUpdates)="checkForUpdates()"
      (downloadAndRestart)="downloadAndRestart()"
      (dismissUpdate)="dismissUpdate()"
    />
  `,
})
export class AboutPageComponent {
  metadataView: OfficialAboutDialogView | null = null;
  revisionCopyStatus: OfficialAboutRevisionCopyStatus = "idle";
  handoffError = "";
  updateView: AppUpdateView;

  constructor(
    private readonly location: Location,
    private readonly handoff: EnvironmentHandoffService,
    private readonly store: PopupStateStore,
    private readonly clipboard: ClipboardPolicyService,
    private readonly updates: AppUpdateService,
    private readonly router: Router,
  ) {
    this.updateView = updates.snapshot();
  }

  get metadata(): Readonly<OfficialAboutDialogMetadata> {
    return {
      appVersion: aboutVersion,
      currentWebVaultUrl: this.store.snapshot().serverUrl,
      license: aboutMetadata.license,
      productName: aboutMetadata.productName,
      upstreamRevision: aboutMetadata.upstreamRevision,
    };
  }

  back(): void {
    this.location.back();
  }

  setMetadataView(view: OfficialAboutDialogView | null): void {
    this.metadataView = view;
    this.revisionCopyStatus = "idle";
  }

  closeMetadata(event?: Event): void {
    event?.preventDefault();
    this.setMetadataView(null);
  }

  async openHelp(): Promise<void> {
    await this.openHandoff(() => this.handoff.openExternal(helpUrl));
  }

  async openThirdPartyNotices(): Promise<void> {
    await this.router.navigateByUrl("/third-party-notices");
  }

  async openWebVault(): Promise<void> {
    await this.openHandoff(() => this.handoff.openWebVault(""));
  }

  async openProjectSource(): Promise<void> {
    await this.openHandoff(() => this.handoff.openExternal(sourceUrl));
  }

  async copyRevision(): Promise<void> {
    if (this.revisionCopyStatus === "copying") {
      return;
    }
    this.revisionCopyStatus = "copying";
    try {
      await this.clipboard.copy(this.metadata.upstreamRevision);
      this.revisionCopyStatus = "copied";
    } catch {
      this.revisionCopyStatus = "error";
    }
  }

  async checkForUpdates(): Promise<void> {
    const check = this.updates.checkManually();
    this.updateView = this.updates.snapshot();
    await check;
    this.updateView = this.updates.snapshot();
  }

  async downloadAndRestart(): Promise<void> {
    const install = this.updates.downloadAndRestart();
    this.updateView = this.updates.snapshot();
    await install;
    this.updateView = this.updates.snapshot();
  }

  dismissUpdate(): void {
    this.updates.dismiss();
    this.updateView = this.updates.snapshot();
  }

  private async openHandoff(action: () => Promise<void>): Promise<void> {
    this.handoffError = "";
    try {
      await action();
    } catch {
      this.handoffError = translateOfficialMessage("i18nUnableToOpenLink");
    }
  }
}
