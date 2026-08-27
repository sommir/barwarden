import { Component, Input } from "@angular/core";

@Component({
  selector: "bw-vault-form-section",
  standalone: true,
  template: `
    <section class="official-form-section macos-form-section">
      <div class="official-form-section-header">
        <h2>{{ title }}</h2>
        <ng-content select="[slot=header-end]" />
      </div>
      <div class="cipher-form-card macos-form-group">
        <ng-content />
      </div>
    </section>
  `,
})
export class VaultFormSectionComponent {
  @Input({ required: true }) title = "";
}
