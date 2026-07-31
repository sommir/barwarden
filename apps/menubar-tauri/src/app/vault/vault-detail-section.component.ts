import { Component, Input } from "@angular/core";

@Component({
  selector: "bw-vault-detail-section",
  standalone: true,
  template: `
    <section class="official-detail-section">
      <div class="bit-section-header">
        <h2>{{ title }}</h2>
      </div>
      <div class="read-only-cipher-card">
        <ng-content />
      </div>
    </section>
  `,
})
export class VaultDetailSectionComponent {
  @Input({ required: true }) title = "";
}
