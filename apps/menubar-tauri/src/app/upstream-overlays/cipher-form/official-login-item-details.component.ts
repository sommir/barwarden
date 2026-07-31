import { Component, input, Input, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { map } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { IconButtonModule } from "@bitwarden/components/icon-button/icon-button.module";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { SelectModule } from "@bitwarden/components/select/select.module";
import { TypographyModule } from "@bitwarden/components/typography/typography.module";

import type { RetainedOfficialCipherFormConfig } from "../../vault/retained-login-form.adapter";
import { OfficialLoginFormContainer } from "./official-login-form-container";

@Component({
  selector: "vault-item-details-section",
  templateUrl: "./official-login-item-details.component.html",
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
export class OfficialLoginItemDetailsComponent implements OnInit {
  itemDetailsForm = this.formBuilder.group({
    name: ["", [Validators.required]],
    folderId: [null],
    favorite: [false],
  });

  protected favoriteButtonDisabled = false;

  @Input({ required: true })
  config: RetainedOfficialCipherFormConfig;

  readonly originalCipherView = input<CipherView>();

  get initialValues() {
    return this.config.initialValues;
  }

  constructor(
    private cipherFormContainer: OfficialLoginFormContainer,
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
          Object.assign(cipher, {
            name: value.name,
            folderId: value.folderId,
            favorite: value.favorite,
          } as CipherView);
          return cipher;
        });
      });
  }

  get favoriteIcon() {
    return this.itemDetailsForm.controls.favorite.value
      ? "bwi-star-f"
      : "bwi-star";
  }

  toggleFavorite() {
    this.itemDetailsForm.controls.favorite.setValue(
      !this.itemDetailsForm.controls.favorite.value,
    );
  }

  async ngOnInit() {
    const prefillCipher = this.cipherFormContainer.getInitialCipherView();

    if (prefillCipher) {
      await this.initFromExistingCipher(prefillCipher);
    } else {
      this.itemDetailsForm.setValue({
        name: this.initialValues?.name || "",
        folderId: this.initialValues?.folderId || null,
        favorite: false,
      });
    }
  }

  private async initFromExistingCipher(prefillCipher: CipherView) {
    const { name, folderId } = prefillCipher;

    this.itemDetailsForm.patchValue({
      name: name ? name : (this.initialValues?.name ?? ""),
      folderId: folderId ? folderId : (this.initialValues?.folderId ?? null),
      favorite: prefillCipher.favorite,
    });
  }
}
