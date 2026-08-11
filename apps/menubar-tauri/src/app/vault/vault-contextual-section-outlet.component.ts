import { NgComponentOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  InjectionToken,
  Optional,
  type Type,
} from "@angular/core";

export const VAULT_CONTEXTUAL_SECTION = new InjectionToken<Type<unknown>>(
  "VAULT_CONTEXTUAL_SECTION",
);

@Component({
  selector: "bw-vault-contextual-section-outlet",
  standalone: true,
  imports: [NgComponentOutlet],
  template: `<ng-container [ngComponentOutlet]="section" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultContextualSectionOutletComponent {
  readonly section: Type<unknown> | null;

  constructor(
    @Optional() @Inject(VAULT_CONTEXTUAL_SECTION) section: unknown,
  ) {
    this.section = typeof section === "function" ? section as Type<unknown> : null;
  }
}
