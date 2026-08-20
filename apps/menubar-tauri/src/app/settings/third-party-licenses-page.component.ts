import { Component } from "@angular/core";

import completeLicenseText from "../../../../../THIRD_PARTY_LICENSES.txt?raw";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { I18nPipe } from "../official-ui/official-ui-common";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";

@Component({
  selector: "bw-third-party-licenses-page",
  host: {
    class: "macos-page macos-page--secondary macos-page--third-party-licenses",
  },
  standalone: true,
  imports: [I18nPipe, PopupHeaderComponent, PopupPageComponent],
  templateUrl: "./third-party-licenses-page.component.html",
  styleUrl: "./third-party-licenses-page.component.css",
})
export class ThirdPartyLicensesPageComponent {
  readonly licenseText = completeLicenseText;

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.routeCache.back();

  constructor(private readonly routeCache: PopupRouterCacheService) {}
}
