import { Component } from "@angular/core";
import { Router } from "@angular/router";

import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { I18nPipe } from "../official-ui/official-ui-common";
import thirdPartyComponents from "../../../../../THIRD_PARTY_COMPONENTS.json";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";
import { DocumentSearchComponent } from "./document-search.component";

@Component({
  selector: "bw-third-party-notices-page",
  host: {
    class: "macos-page macos-page--secondary macos-page--third-party-notices",
  },
  standalone: true,
  imports: [DocumentSearchComponent, I18nPipe, PopupHeaderComponent, PopupPageComponent],
  templateUrl: "./third-party-notices-page.component.html",
  styleUrl: "./third-party-notices-page.component.css",
})
export class ThirdPartyNoticesPageComponent {
  readonly counts = thirdPartyComponents.counts;
  readonly licenseGroups = thirdPartyComponents.licenseGroups;
  query = "";

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.routeCache.back();

  constructor(
    private readonly routeCache: PopupRouterCacheService,
    private readonly router: Router,
  ) {}

  async openCompleteLicenses(): Promise<void> {
    await this.router.navigateByUrl("/third-party-licenses");
  }

  get filteredLicenseGroups(): typeof this.licenseGroups {
    const needle = this.query.trim().toLocaleLowerCase();
    if (needle.length === 0) {
      return this.licenseGroups;
    }
    return this.licenseGroups.filter((group) =>
      group.expression.toLocaleLowerCase().includes(needle),
    );
  }

  setQuery(query: string): void {
    this.query = query;
  }
}
