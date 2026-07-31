import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";

import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { I18nPipe } from "@bitwarden/ui-common";
import { BitLabelComponent } from "@bitwarden/components/form-control/label.component";
import { BitFormFieldComponent } from "@bitwarden/components/form-field/form-field.component";
import { BitSuffixDirective } from "@bitwarden/components/form-field/suffix.directive";
import { BitIconButtonComponent } from "@bitwarden/components/icon-button/icon-button.component";
import { BitInputDirective } from "@bitwarden/components/input/input.directive";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { TypographyDirective } from "@bitwarden/components/typography/typography.directive";

import type { VaultField } from "../../vault/vault-item.model";
import type { OfficialPersonalCipherProjection } from "../../vault/personal-cipher-view.adapter";
import { OfficialReadOnlyCipherCardComponent } from "./official-read-only-cipher-card.component";

@Component({
  selector: "official-identity-sections",
  standalone: true,
  imports: [
    BitFormFieldComponent,
    BitIconButtonComponent,
    BitInputDirective,
    BitLabelComponent,
    BitSuffixDirective,
    I18nPipe,
    OfficialReadOnlyCipherCardComponent,
    SectionHeaderComponent,
    TypographyDirective,
  ],
  templateUrl: "./official-identity-sections.component.html",
})
export class OfficialIdentitySectionsComponent implements OnChanges {
  @Input({ required: true }) projection!: OfficialPersonalCipherProjection;
  @Input() canFill = false;
  @Input() revealedFieldIds: ReadonlySet<string> = new Set();
  @Input() allowLocalReveal = false;
  @Output() copyField = new EventEmitter<VaultField>();
  @Output() fillField = new EventEmitter<VaultField>();
  @Output() toggleReveal = new EventEmitter<string>();

  private readonly localRevealedFieldIds = new Set<string>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["projection"]) {
      this.localRevealedFieldIds.clear();
    }
  }

  get cipher(): CipherView {
    return this.projection.cipher;
  }

  get addressFields(): string {
    const { address1, address2, address3, fullAddressPart2, country } = this.cipher.identity;
    return [address1, address2, address3, fullAddressPart2, country].filter(Boolean).join("\n");
  }

  get addressRows(): number {
    return this.addressFields.split("\n").length;
  }

  get hasPersonalDetails(): boolean {
    const { username, company, fullName } = this.cipher.identity;
    return Boolean(fullName || username || company);
  }

  get hasIdentificationDetails(): boolean {
    const { ssn, passportNumber, licenseNumber } = this.cipher.identity;
    return Boolean(ssn || passportNumber || licenseNumber);
  }

  get hasContactDetails(): boolean {
    const { email, phone } = this.cipher.identity;
    return Boolean(email || phone || this.addressFields);
  }

  actionField(fieldId: string): VaultField | undefined {
    return this.projection.actionFields.get(fieldId);
  }

  isRevealed(fieldId: string): boolean {
    return this.allowLocalReveal
      ? this.localRevealedFieldIds.has(fieldId)
      : this.revealedFieldIds.has(fieldId);
  }

  toggle(fieldId: string): void {
    if (this.allowLocalReveal) {
      if (this.localRevealedFieldIds.has(fieldId)) {
        this.localRevealedFieldIds.delete(fieldId);
      } else {
        this.localRevealedFieldIds.add(fieldId);
      }
    }
    this.toggleReveal.emit(fieldId);
  }
}
