import { Component, EventEmitter, Input, Output } from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType, FieldType, type LinkedIdType } from "@bitwarden/common/vault/enums";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { I18nPipe } from "@bitwarden/ui-common";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { CheckboxComponent } from "@bitwarden/components/checkbox/checkbox.component";
import { FormControlComponent } from "@bitwarden/components/form-control/form-control.component";
import { BitLabelComponent } from "@bitwarden/components/form-control/label.component";
import { BitFormFieldComponent } from "@bitwarden/components/form-field/form-field.component";
import { BitSuffixDirective } from "@bitwarden/components/form-field/suffix.directive";
import { BitIconButtonComponent } from "@bitwarden/components/icon-button/icon-button.component";
import { BitInputDirective } from "@bitwarden/components/input/input.directive";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { TypographyDirective } from "@bitwarden/components/typography/typography.directive";

import type { VaultField } from "../../vault/vault-item.model";
import type { OfficialLoginDetailProjection } from "../../vault/login-cipher-view.adapter";
import type { OfficialPersonalCipherProjection } from "../../vault/personal-cipher-view.adapter";
import { OfficialColorPasswordComponent } from "./official-color-password.component";

type OfficialDetailProjection = OfficialLoginDetailProjection | OfficialPersonalCipherProjection;

const standardFieldIds: ReadonlyMap<CipherType, ReadonlySet<string>> = new Map([
  [CipherType.Login, new Set(["username", "password", "otp", "notes"])],
  [CipherType.Card, new Set(["cardholder-name", "brand", "number", "exp-month", "exp-year", "code", "notes"])],
  [CipherType.Identity, new Set([
    "title", "first-name", "middle-name", "last-name", "username", "company", "ssn",
    "passport-number", "license-number", "email", "phone", "address", "address1",
    "address2", "address3", "address-1", "address-2", "address-3", "full-name",
    "city", "state", "postal-code", "country", "notes",
  ])],
  [CipherType.SecureNote, new Set(["notes"])],
]);

/** Guarded Login-only native-action transform of pinned CustomFieldV2Component. */
@Component({
  selector: "official-custom-fields",
  standalone: true,
  imports: [
    BitFormFieldComponent,
    BitIconButtonComponent,
    BitInputDirective,
    BitLabelComponent,
    BitSuffixDirective,
    CardComponent,
    CheckboxComponent,
    OfficialColorPasswordComponent,
    FormControlComponent,
    I18nPipe,
    SectionHeaderComponent,
    TypographyDirective,
  ],
  templateUrl: "./official-custom-fields.component.html",
})
export class OfficialCustomFieldsComponent {
  @Input({ required: true }) projection!: OfficialDetailProjection;
  @Input() canFill = false;
  @Input() revealedFieldIds: ReadonlySet<string> = new Set();
  @Output() copyField = new EventEmitter<VaultField>();
  @Output() fillField = new EventEmitter<VaultField>();
  @Output() toggleReveal = new EventEmitter<string>();

  readonly fieldType = FieldType;
  readonly showHiddenValueCountFields = new Set<string>();

  constructor(private readonly i18nService: I18nService) {}

  actionField(index: number): VaultField {
    const field = this.customActionFields[index];
    if (!field) {
      throw new RangeError(`Missing custom action field at index ${index}`);
    }
    return field;
  }

  emptyFieldAriaLabel(field: FieldView): string | null {
    return field.value ? null : `${field.name}, ${this.i18nService.t("noValueEntered")}`;
  }

  linkedType(linkedId: LinkedIdType | undefined): string {
    const metadata = linkedId == null ? undefined : this.projection.cipher.linkedFieldOptions?.get(linkedId);
    return metadata ? this.i18nService.t(metadata.i18nKey) : "";
  }

  isRevealed(index: number): boolean {
    return this.revealedFieldIds.has(this.actionField(index).id);
  }

  toggleCount(index: number): void {
    const fieldId = this.actionField(index).id;
    if (this.showHiddenValueCountFields.has(fieldId)) {
      this.showHiddenValueCountFields.delete(fieldId);
    } else {
      this.showHiddenValueCountFields.add(fieldId);
    }
  }

  showsCount(index: number): boolean {
    return this.showHiddenValueCountFields.has(this.actionField(index).id);
  }

  private get customActionFields(): readonly VaultField[] {
    const excluded = standardFieldIds.get(this.projection.cipher.type) ?? new Set<string>();
    return [...this.projection.actionFields.values()].filter(
      (field) => !excluded.has(field.id),
    );
  }
}
