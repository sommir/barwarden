import { Component, Input } from "@angular/core";

@Component({
  selector: "bw-no-items",
  standalone: true,
  template: `
    <section class="bit-no-items">
      <div class="bit-no-items-icon" aria-hidden="true">
        <i class="bwi" [class]="icon"></i>
      </div>
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>
      <ng-content />
    </section>
  `,
})
export class NoItemsComponent {
  @Input({ required: true }) icon = "";
  @Input({ required: true }) title = "";
  @Input({ required: true }) description = "";
}
