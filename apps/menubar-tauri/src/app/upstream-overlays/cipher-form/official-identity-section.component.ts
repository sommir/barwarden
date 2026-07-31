import { Component, Input, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import type { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { IconButtonModule } from "@bitwarden/components/icon-button/icon-button.module";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { SelectModule } from "@bitwarden/components/select/select.module";
import { TypographyModule } from "@bitwarden/components/typography/typography.module";

import { OfficialPersonalFormContainer } from "./official-personal-form-container";

@Component({
  selector: "vault-identity-section",
  templateUrl: "./official-identity-section.component.html",
  imports: [
    JslibModule,
    ReactiveFormsModule,
    SectionHeaderComponent,
    CardComponent,
    FormFieldModule,
    IconButtonModule,
    SelectModule,
    TypographyModule,
  ],
})
export class OfficialIdentitySectionComponent implements OnInit {
  @Input() originalCipherView: CipherView;
  @Input() disabled: boolean;
  identityTitleOptions = [
    { name: "-- " + this.i18nService.t("select") + " --", value: null },
    { name: this.i18nService.t("mr"), value: this.i18nService.t("mr") },
    { name: this.i18nService.t("mrs"), value: this.i18nService.t("mrs") },
    { name: this.i18nService.t("ms"), value: this.i18nService.t("ms") },
    { name: this.i18nService.t("mx"), value: this.i18nService.t("mx") },
    { name: this.i18nService.t("dr"), value: this.i18nService.t("dr") },
  ];
  protected identityForm = this.formBuilder.group({
    title: [null as string],
    firstName: [""],
    middleName: [""],
    lastName: [""],
    username: [""],
    company: [""],
    ssn: [""],
    passportNumber: [""],
    licenseNumber: [""],
    email: [""],
    phone: [""],
    address1: [""],
    address2: [""],
    address3: [""],
    city: [""],
    state: [""],
    postalCode: [""],
    country: [""],
  });

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
      "identityDetails",
      this.identityForm,
    );
    this.identityForm.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => {
        const data = new IdentityView();
        Object.assign(data, value);
        data.title = this.canonicalTitle(value.title);
        this.cipherFormContainer.patchCipher((cipher) => {
          cipher.identity = data;
          return cipher;
        });
      });
  }

  ngOnInit(): void {
    const identity = this.cipherFormContainer.getInitialCipherView()?.identity;
    this.identityForm.patchValue({
      title: this.localizedTitle(
        this.initialValues?.title ?? identity?.title ?? null,
      ),
      firstName: this.initialValues?.firstName ?? identity?.firstName ?? "",
      middleName: this.initialValues?.middleName ?? identity?.middleName ?? "",
      lastName: this.initialValues?.lastName ?? identity?.lastName ?? "",
      username: this.initialValues?.username ?? identity?.username ?? "",
      company: this.initialValues?.company ?? identity?.company ?? "",
      ssn: this.canViewSecrets
        ? (this.initialValues?.ssn ?? identity?.ssn ?? "")
        : "",
      passportNumber: this.canViewSecrets
        ? (this.initialValues?.passportNumber ?? identity?.passportNumber ?? "")
        : "",
      licenseNumber:
        this.initialValues?.licenseNumber ?? identity?.licenseNumber ?? "",
      email: this.initialValues?.email ?? identity?.email ?? "",
      phone: this.initialValues?.phone ?? identity?.phone ?? "",
      address1: this.initialValues?.address1 ?? identity?.address1 ?? "",
      address2: this.initialValues?.address2 ?? identity?.address2 ?? "",
      address3: this.initialValues?.address3 ?? identity?.address3 ?? "",
      city: this.initialValues?.city ?? identity?.city ?? "",
      state: this.initialValues?.state ?? identity?.state ?? "",
      postalCode: this.initialValues?.postalCode ?? identity?.postalCode ?? "",
      country: this.initialValues?.country ?? identity?.country ?? "",
    });
    if (this.disabled) this.identityForm.disable();
    if (!this.canViewSecrets) {
      this.identityForm.controls.ssn.disable();
      this.identityForm.controls.passportNumber.disable();
    }
  }

  private localizedTitle(value: string | null | undefined): string | null {
    switch (value) {
      case "Mr":
        return this.i18nService.t("mr");
      case "Mrs":
        return this.i18nService.t("mrs");
      case "Ms":
        return this.i18nService.t("ms");
      case "Mx":
        return this.i18nService.t("mx");
      case "Dr":
        return this.i18nService.t("dr");
      default:
        return value ?? null;
    }
  }

  private canonicalTitle(value: string | null | undefined): string | null {
    if (value === this.i18nService.t("mr")) return "Mr";
    if (value === this.i18nService.t("mrs")) return "Mrs";
    if (value === this.i18nService.t("ms")) return "Ms";
    if (value === this.i18nService.t("mx")) return "Mx";
    if (value === this.i18nService.t("dr")) return "Dr";
    return value ?? null;
  }
}
