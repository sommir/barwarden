import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from "@angular/core";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
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
import { OfficialCreditCardNumberPipe } from "./official-credit-card-number.pipe";
import { OfficialReadOnlyCipherCardComponent } from "./official-read-only-cipher-card.component";

@Component({
  selector: "official-card-details",
  standalone: true,
  imports: [
    BitFormFieldComponent,
    BitIconButtonComponent,
    BitInputDirective,
    BitLabelComponent,
    BitSuffixDirective,
    I18nPipe,
    OfficialCreditCardNumberPipe,
    OfficialReadOnlyCipherCardComponent,
    SectionHeaderComponent,
    TypographyDirective,
  ],
  templateUrl: "./official-card-details.component.html",
})
export class OfficialCardDetailsComponent implements OnChanges {
  @Input({ required: true }) projection!: OfficialPersonalCipherProjection;
  @Input() revealedFieldIds: ReadonlySet<string> = new Set();
  @Input() allowLocalReveal = false;
  @Output() copyField = new EventEmitter<VaultField>();
  @Output() toggleReveal = new EventEmitter<string>();

  revealCardNumber = false;
  revealCardCode = false;

  constructor(private readonly i18nService: I18nService) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["projection"]) {
      this.revealCardNumber = false;
      this.revealCardCode = false;
    }
  }

  get cipher(): CipherView {
    return this.projection.cipher;
  }

  get setSectionTitle(): string {
    const brand = this.cipher.card.brand;
    return brand && brand !== "Other"
      ? this.i18nService.t("cardBrandDetails", brand)
      : this.i18nService.t("cardDetails");
  }

  actionField(fieldId: string): VaultField | undefined {
    return this.projection.actionFields.get(fieldId);
  }

  isRevealed(fieldId: "number" | "code"): boolean {
    return this.allowLocalReveal
      ? fieldId === "number" ? this.revealCardNumber : this.revealCardCode
      : this.revealedFieldIds.has(fieldId);
  }

  toggle(fieldId: "number" | "code"): void {
    if (this.allowLocalReveal) {
      if (fieldId === "number") {
        this.revealCardNumber = !this.revealCardNumber;
      } else {
        this.revealCardCode = !this.revealCardCode;
      }
    }
    this.toggleReveal.emit(fieldId);
  }
}
