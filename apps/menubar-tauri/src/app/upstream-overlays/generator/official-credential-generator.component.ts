import { Component } from "@angular/core";
import { RouterModule } from "@angular/router";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { ItemModule } from "@bitwarden/components";

import { PopupHeaderComponent } from "@bitwarden/browser-popup/layout/popup-header.component";
import { PopupPageComponent } from "@bitwarden/browser-popup/layout/popup-page.component";
import { OfficialGeneratorCoreComponent } from "./official-generator-core.component";
import { PopupHeaderActionsComponent } from "./official-generator-header-actions.component";

@Component({
  selector: "bw-official-credential-generator",
  templateUrl: "./official-credential-generator.component.html",
  imports: [
    OfficialGeneratorCoreComponent,
    PopupHeaderActionsComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    JslibModule,
    RouterModule,
    ItemModule,
  ],
})
export class OfficialCredentialGeneratorComponent {}
