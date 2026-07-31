import { Component, input, Input, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { map } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import type { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { IconButtonModule } from "@bitwarden/components/icon-button/icon-button.module";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { SelectModule } from "@bitwarden/components/select/select.module";
import { TypographyModule } from "@bitwarden/components/typography/typography.module";

import type { RetainedOfficialPersonalCipherFormConfig } from "../../vault/retained-personal-cipher-form.adapter";
import { OfficialPersonalFormContainer } from "./official-personal-form-container";

@Component({
  selector: "vault-item-details-section",
  templateUrl: "./official-personal-item-details.component.html",
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
export class OfficialPersonalItemDetailsComponent implements OnInit {
  itemDetailsForm = this.formBuilder.group({
    name: ["", [Validators.required]],
    folderId: [null],
    favorite: [false],
  });
  protected favoriteButtonDisabled = false;
  @Input({ required: true }) config: RetainedOfficialPersonalCipherFormConfig;
  readonly originalCipherView = input<CipherView>();

  get initialValues() {
    return this.config.initialValues;
  }

  constructor(
    private cipherFormContainer: OfficialPersonalFormContainer,
    private formBuilder: FormBuilder,
  ) {
    this.cipherFormContainer.registerChildForm(
      "itemDetails",
      this.itemDetailsForm,
    );
    this.itemDetailsForm.valueChanges
      .pipe(
        takeUntilDestroyed(),
        map(() => this.itemDetailsForm.getRawValue()),
      )
      .subscribe((value) => {
        this.cipherFormContainer.patchCipher((cipher) => {
          cipher.name = value.name;
          cipher.folderId = value.folderId;
          cipher.favorite = value.favorite;
          return cipher;
        });
      });
  }

  get favoriteIcon(): string {
    return this.itemDetailsForm.controls.favorite.value
      ? "bwi-star-f"
      : "bwi-star";
  }

  toggleFavorite(): void {
    this.itemDetailsForm.controls.favorite.setValue(
      !this.itemDetailsForm.controls.favorite.value,
    );
  }

  async ngOnInit(): Promise<void> {
    const prefillCipher = this.cipherFormContainer.getInitialCipherView();
    this.itemDetailsForm.setValue({
      name: prefillCipher?.name || this.initialValues?.name || "",
      folderId: prefillCipher?.folderId || this.initialValues?.folderId || null,
      favorite: prefillCipher?.favorite ?? false,
    });
  }
}
