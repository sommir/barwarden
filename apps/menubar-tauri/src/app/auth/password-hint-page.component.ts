import { Component, ViewChild } from "@angular/core";

import { OfficialAnonymousShellComponent } from "../upstream-overlays/auth/anonymous/official-anonymous-shell.component";
import { OfficialPasswordHintComponent } from "../upstream-overlays/auth/login/official-password-hint.component";

@Component({
  selector: "bw-password-hint-page",
  standalone: true,
  imports: [OfficialAnonymousShellComponent, OfficialPasswordHintComponent],
  template: `
    <bw-official-anonymous-shell [showBackButton]="true" [backAction]="backAction">
      <bw-official-password-hint />
    </bw-official-anonymous-shell>
  `,
})
export class PasswordHintPageComponent {
  @ViewChild(OfficialPasswordHintComponent)
  private hint?: OfficialPasswordHintComponent;

  readonly backAction = (): Promise<void> => this.hint?.cancel() ?? Promise.resolve();
}
