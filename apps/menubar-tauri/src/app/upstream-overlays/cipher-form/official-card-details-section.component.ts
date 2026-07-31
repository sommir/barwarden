import { Component, Input, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { normalizeExpiryYearFormat } from "@bitwarden/common/autofill/utils";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import type { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { IconButtonModule } from "@bitwarden/components/icon-button/icon-button.module";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { SelectModule } from "@bitwarden/components/select/select.module";
import { TypographyModule } from "@bitwarden/components/typography/typography.module";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { OfficialPersonalFormContainer } from "./official-personal-form-container";

@Component({
  selector: "vault-card-details-section",
  templateUrl: "./official-card-details-section.component.html",
  imports: [
    CardComponent,
    TypographyModule,
    FormFieldModule,
    ReactiveFormsModule,
    SelectModule,
    SectionHeaderComponent,
    IconButtonModule,
    JslibModule,
  ],
})
export class OfficialCardDetailsSectionComponent implements OnInit {
  @Input() originalCipherView: CipherView;
  @Input() disabled: boolean;
  cardDetailsForm = this.formBuilder.group({
    cardholderName: "",
    number: "",
    brand: "",
    expMonth: "",
    expYear: "" as string | number,
    code: "",
  });
  readonly cardBrands = [
    { name: "-- " + this.i18nService.t("select") + " --", value: null },
    { name: "Visa", value: "Visa" },
    { name: "Mastercard", value: "Mastercard" },
    { name: "American Express", value: "Amex" },
    { name: "Discover", value: "Discover" },
    { name: "Diners Club", value: "Diners Club" },
    { name: "JCB", value: "JCB" },
    { name: "Maestro", value: "Maestro" },
    { name: "UnionPay", value: "UnionPay" },
    { name: "RuPay", value: "RuPay" },
    { name: this.i18nService.t("other"), value: "Other" },
  ];
  readonly expirationMonths = [
    { name: "-- " + this.i18nService.t("select") + " --", value: null },
    { name: "01 - " + this.i18nService.t("january"), value: "1" },
    { name: "02 - " + this.i18nService.t("february"), value: "2" },
    { name: "03 - " + this.i18nService.t("march"), value: "3" },
    { name: "04 - " + this.i18nService.t("april"), value: "4" },
    { name: "05 - " + this.i18nService.t("may"), value: "5" },
    { name: "06 - " + this.i18nService.t("june"), value: "6" },
    { name: "07 - " + this.i18nService.t("july"), value: "7" },
    { name: "08 - " + this.i18nService.t("august"), value: "8" },
    { name: "09 - " + this.i18nService.t("september"), value: "9" },
    { name: "10 - " + this.i18nService.t("october"), value: "10" },
    { name: "11 - " + this.i18nService.t("november"), value: "11" },
    { name: "12 - " + this.i18nService.t("december"), value: "12" },
  ];

  get initialValues() {
    return this.cipherFormContainer.config.initialValues;
  }

  get canViewSecrets(): boolean {
    return this.cipherFormContainer.canViewSecrets;
  }

  constructor(
    private cipherFormContainer: OfficialPersonalFormContainer,
    private formBuilder: FormBuilder,
    private i18nService: I18nService,
  ) {
    this.cipherFormContainer.registerChildForm(
      "cardDetails",
      this.cardDetailsForm,
    );
    this.cardDetailsForm.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(
        ({ cardholderName, number, brand, expMonth, expYear, code }) => {
          this.cipherFormContainer.patchCipher((cipher) => {
            cipher.card.cardholderName = cardholderName;
            cipher.card.number = number;
            cipher.card.brand = brand;
            cipher.card.expMonth = expMonth ? expMonth.padStart(2, "0") : "";
            cipher.card.expYear = normalizeExpiryYearFormat(expYear) ?? "";
            cipher.card.code = code;
            return cipher;
          });
        },
      );
    this.cardDetailsForm.controls.number.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((number) => {
        const brand = CardView.getCardBrandByPatterns(
          number?.replace(/[\s-]/g, ""),
        );
        if (brand) this.cardDetailsForm.controls.brand.setValue(brand);
      });
  }

  ngOnInit(): void {
    const card = this.cipherFormContainer.getInitialCipherView()?.card;
    this.cardDetailsForm.patchValue({
      cardholderName:
        this.initialValues?.cardholderName ?? card?.cardholderName ?? "",
      number: this.canViewSecrets
        ? (this.initialValues?.number ?? card?.number ?? "")
        : "",
      brand: this.initialValues?.brand ?? card?.brand ?? "",
      expMonth: this.normalizeExpirationMonth(
        this.initialValues?.expMonth ?? card?.expMonth ?? "",
      ),
      expYear: this.initialValues?.expYear ?? card?.expYear ?? "",
      code: this.canViewSecrets
        ? (this.initialValues?.code ?? card?.code ?? "")
        : "",
    });
    if (this.disabled) this.cardDetailsForm.disable();
    if (!this.canViewSecrets) {
      this.cardDetailsForm.controls.number.disable();
      this.cardDetailsForm.controls.code.disable();
    }
  }

  getSectionHeading(): string {
    const { brand } = this.cardDetailsForm.value;
    return brand && brand !== "Other"
      ? this.i18nService.t("cardBrandDetails", brand)
      : this.i18nService.t("cardDetails");
  }

  private normalizeExpirationMonth(value: string | null | undefined): string {
    if (!value) return "";
    const month = Number.parseInt(value, 10);
    return month >= 1 && month <= 12 ? String(month) : "";
  }
}
