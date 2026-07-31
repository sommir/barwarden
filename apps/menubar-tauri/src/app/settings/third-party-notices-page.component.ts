import { Location } from "@angular/common";
import { Component } from "@angular/core";
import { Router } from "@angular/router";

import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { I18nPipe } from "../official-ui/official-ui-common";
import thirdPartyComponents from "../../../../../THIRD_PARTY_COMPONENTS.json";

@Component({
  selector: "bw-third-party-notices-page",
  host: {
    class: "macos-page macos-page--secondary macos-page--third-party-notices",
  },
  standalone: true,
  imports: [I18nPipe, PopupHeaderComponent, PopupPageComponent],
  templateUrl: "./third-party-notices-page.component.html",
  styleUrl: "./third-party-notices-page.component.css",
})
export class ThirdPartyNoticesPageComponent {
  readonly counts = thirdPartyComponents.counts;
  readonly licenseGroups = thirdPartyComponents.licenseGroups;

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.location.back();

  constructor(
    private readonly location: Location,
    private readonly router: Router,
  ) {}

  async openCompleteLicenses(): Promise<void> {
    await this.router.navigateByUrl("/third-party-licenses");
  }
}
