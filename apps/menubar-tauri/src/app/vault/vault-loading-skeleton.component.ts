import { Component } from "@angular/core";

@Component({
  selector: "bw-vault-loading-skeleton",
  standalone: true,
  template: `
    <section class="vault-loading-skeleton macos-list" aria-hidden="true" data-vault-state="loading">
      <div class="vault-skeleton-heading"></div>
      <div class="vault-skeleton-stack">
        @for (row of rows; track row) {
          <div class="vault-skeleton-row">
            <span class="vault-skeleton-icon"></span>
            <span class="vault-skeleton-text">
              <span class="vault-skeleton-line is-title"></span>
              <span class="vault-skeleton-line is-subtitle"></span>
            </span>
          </div>
        }
      </div>
    </section>
  `,
})
export class VaultLoadingSkeletonComponent {
  readonly rows = [0, 1, 2, 3, 4];
}
