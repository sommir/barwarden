import { ChangeDetectionStrategy, Component } from "@angular/core";

import { CardComponent } from "@bitwarden/components/card/card.component";

@Component({
  selector: "read-only-cipher-card",
  standalone: true,
  imports: [CardComponent],
  templateUrl: "./official-read-only-cipher-card.component.html",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OfficialReadOnlyCipherCardComponent {}
