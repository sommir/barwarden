import { Component } from "@angular/core";

@Component({
  selector: "bw-bit-item-group",
  standalone: true,
  template: `<div class="bit-item-group"><ng-content /></div>`,
})
export class BitItemGroupComponent {}

@Component({
  selector: "bw-bit-item",
  standalone: true,
  template: `<div class="bit-item"><ng-content /></div>`,
})
export class BitItemComponent {}
