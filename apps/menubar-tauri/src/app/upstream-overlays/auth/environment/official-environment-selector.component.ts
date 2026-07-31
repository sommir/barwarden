import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Output, ViewChild } from "@angular/core";
import { Observable, map } from "rxjs";

import { IconModule, LinkModule, MenuModule, TypographyModule } from "@bitwarden/components";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { I18nPipe } from "@bitwarden/ui-common";

import { OfficialEnvironmentAdapter } from "../../../auth/official-environment.adapter";
import { OfficialI18nService } from "../../../official-ui/official-i18n.service";
import { OfficialSelfHostedDialogComponent } from "./official-self-hosted-dialog.component";

type RetainedRegionOption = "US" | "EU" | "SelfHosted";

const availableRegions = [
  { key: "US" as const, domain: "vault.bitwarden.com" },
  { key: "EU" as const, domain: "vault.bitwarden.eu" },
];

/** Guarded overlay of the pinned environment selector with US, EU, and one-base-URL self-hosting retained. */
@Component({
  selector: "bw-login-environment-selector",
  standalone: true,
  imports: [CommonModule, I18nPipe, IconModule, LinkModule, MenuModule, OfficialSelfHostedDialogComponent, TypographyModule],
  providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
  templateUrl: "./official-environment-selector.component.html",
})
export class OfficialEnvironmentSelectorComponent {
  readonly ServerEnvironmentType = { SelfHosted: "SelfHosted" } as const;
  @Output() readonly serverUrlChange = new EventEmitter<string>();
  @Output() readonly environmentValidChange = new EventEmitter<boolean>();
  @Output() readonly interactionStarted = new EventEmitter<void>();
  @Output() readonly interactionCompleted = new EventEmitter<void>();
  @ViewChild(OfficialSelfHostedDialogComponent)
  private selfHostedDialog?: OfficialSelfHostedDialogComponent;

  readonly availableRegions = availableRegions;
  readonly selectedRegion$: Observable<(typeof availableRegions)[number] | undefined>;

  constructor(private readonly environment: OfficialEnvironmentAdapter) {
    this.selectedRegion$ = environment.selected$.pipe(
      map((selected) => availableRegions.find((region) => region.key === selected)),
    );
  }

  toggle(region: RetainedRegionOption, trigger?: HTMLElement): void {
    if (region === "SelfHosted") {
      this.selfHostedDialog?.open(
        trigger ?? document.body,
        this.environment.lastSelfHostedServerUrl(),
        true,
      );
      return;
    }
    this.environment.selectCloud(region);
    this.serverUrlChange.emit(this.environment.currentEnvironment().webVaultUrl ?? "");
    this.environmentValidChange.emit(true);
  }

  selectSelfHosted(serverUrl: string): void {
    this.environment.selectSelfHosted(serverUrl);
    this.serverUrlChange.emit(this.environment.currentEnvironment().webVaultUrl ?? "");
    this.environmentValidChange.emit(true);
  }

  restoreValidityAfterDismissal(): void {
    try {
      this.environment.currentEnvironment();
      this.environmentValidChange.emit(true);
    } catch {
      this.environmentValidChange.emit(false);
    }
  }
}
