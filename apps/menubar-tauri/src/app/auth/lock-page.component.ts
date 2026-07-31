import { Component } from "@angular/core";

import { OfficialLockComponent } from "../upstream-overlays/auth/lock/official-lock.component";

@Component({
  selector: "bw-lock-page",
  standalone: true,
  imports: [OfficialLockComponent],
  template: `<bw-official-lock />`,
})
export class LockPageComponent {}
