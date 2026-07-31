import { Component } from "@angular/core";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { NoCredentialsIcon } from "@bitwarden/assets/svg";
import { NoItemsModule } from "@bitwarden/components";

@Component({
  selector: "bit-empty-credential-history",
  templateUrl: "./official-empty-generator-history.component.html",
  imports: [JslibModule, NoItemsModule],
})
export class OfficialEmptyGeneratorHistoryComponent {
  noCredentialsIcon = NoCredentialsIcon;

  constructor() {}
}
