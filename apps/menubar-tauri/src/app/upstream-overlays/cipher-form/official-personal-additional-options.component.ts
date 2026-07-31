import { CommonModule } from "@angular/common";
import {
  ChangeDetectorRef,
  Component,
  Input,
  OnInit,
  ViewChild,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import { map, of } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { CipherRepromptType } from "@bitwarden/common/vault/enums/cipher-reprompt-type";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { CheckboxModule } from "@bitwarden/components/checkbox/checkbox.module";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { LinkModule } from "@bitwarden/components/link/link.module";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { TypographyModule } from "@bitwarden/components/typography/typography.module";

import { OfficialPersonalCustomFieldsComponent } from "./official-personal-custom-fields.component";
import { OfficialPersonalFormContainer } from "./official-personal-form-container";

@Component({
  selector: "vault-additional-options-section",
  host: { "data-bw-retained-personal-form": "" },
  templateUrl: "./official-personal-additional-options.component.html",
  imports: [
    CommonModule,
    SectionHeaderComponent,
    TypographyModule,
    JslibModule,
    CardComponent,
    FormFieldModule,
    ReactiveFormsModule,
    CheckboxModule,
    OfficialPersonalCustomFieldsComponent,
    LinkModule,
  ],
})
export class OfficialPersonalAdditionalOptionsComponent implements OnInit {
  @ViewChild(OfficialPersonalCustomFieldsComponent)
  customFieldsComponent: OfficialPersonalCustomFieldsComponent;
  additionalOptionsForm = this.formBuilder.group({
    notes: [null as string],
    reprompt: [false],
  });
  passwordRepromptEnabled$ = of(true);
  hasCustomFields = false;
  isPartialEdit = false;
  @Input() disableSectionMargin: boolean;

  get allowNewField(): boolean {
    return this.additionalOptionsForm.enabled;
  }

  constructor(
    private cipherFormContainer: OfficialPersonalFormContainer,
    private formBuilder: FormBuilder,
    private changeDetectorRef: ChangeDetectorRef,
  ) {
    this.cipherFormContainer.registerChildForm(
      "additionalOptions",
      this.additionalOptionsForm,
    );
    this.additionalOptionsForm.valueChanges
      .pipe(
        takeUntilDestroyed(),
        map(() => this.additionalOptionsForm.getRawValue()),
      )
      .subscribe((value) => {
        this.cipherFormContainer.patchCipher((cipher) => {
          cipher.notes = value.notes;
          cipher.reprompt = value.reprompt
            ? CipherRepromptType.Password
            : CipherRepromptType.None;
          return cipher;
        });
      });
  }

  ngOnInit(): void {
    const prefillCipher = this.cipherFormContainer.getInitialCipherView();
    if (prefillCipher) {
      this.additionalOptionsForm.patchValue({
        notes: prefillCipher.notes,
        reprompt: prefillCipher.reprompt === CipherRepromptType.Password,
      });
    }
  }

  addCustomField(): void {
    this.customFieldsComponent.openAddEditCustomFieldDialog();
  }

  handleCustomFieldChange(numberOfCustomFields: number): void {
    this.hasCustomFields = numberOfCustomFields > 0;
    this.changeDetectorRef.detectChanges();
  }
}
