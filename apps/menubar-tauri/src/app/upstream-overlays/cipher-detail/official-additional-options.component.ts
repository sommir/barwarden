import { Component, EventEmitter, Input, Output } from "@angular/core";

import { I18nPipe } from "@bitwarden/ui-common";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { BitLabelComponent } from "@bitwarden/components/form-control/label.component";
import { BitFormFieldComponent } from "@bitwarden/components/form-field/form-field.component";
import { BitSuffixDirective } from "@bitwarden/components/form-field/suffix.directive";
import { BitIconButtonComponent } from "@bitwarden/components/icon-button/icon-button.component";
import { BitInputDirective } from "@bitwarden/components/input/input.directive";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { TypographyDirective } from "@bitwarden/components/typography/typography.directive";

import type { VaultField } from "../../vault/vault-item.model";
import { translateOfficialMessage } from "../../official-ui/official-i18n.service";

/** Guarded native-copy transform of pinned AdditionalOptionsComponent. */
@Component({
  selector: "app-additional-options",
  standalone: true,
  imports: [
    BitFormFieldComponent,
    BitIconButtonComponent,
    BitInputDirective,
    BitLabelComponent,
    BitSuffixDirective,
    CardComponent,
    I18nPipe,
    SectionHeaderComponent,
    TypographyDirective,
  ],
  templateUrl: "./official-additional-options.component.html",
})
export class OfficialAdditionalOptionsComponent {
  @Input() notes = "";
  @Output() copyField = new EventEmitter<VaultField>();

  copyNotes(): void {
    this.copyField.emit({
      id: "notes",
      label: translateOfficialMessage("notes"),
      value: this.notes,
    });
  }
}
