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
import { CipherRepromptType } from "@bitwarden/common/vault/enums";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { CheckboxModule } from "@bitwarden/components/checkbox/checkbox.module";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { LinkModule } from "@bitwarden/components/link/link.module";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { TypographyModule } from "@bitwarden/components/typography/typography.module";

import { OfficialCustomFieldsComponent } from "./official-custom-fields.component";
import { OfficialLoginFormContainer } from "./official-login-form-container";

@Component({
  selector: "vault-additional-options-section",
  templateUrl: "./official-additional-options.component.html",
  imports: [
    CommonModule,
    SectionHeaderComponent,
    TypographyModule,
    JslibModule,
    CardComponent,
    FormFieldModule,
    ReactiveFormsModule,
    CheckboxModule,
    CommonModule,
    OfficialCustomFieldsComponent,
    LinkModule,
  ],
})
export class OfficialAdditionalOptionsComponent implements OnInit {
  @ViewChild(OfficialCustomFieldsComponent)
  customFieldsComponent: OfficialCustomFieldsComponent;

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
    private cipherFormContainer: OfficialLoginFormContainer,
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

  ngOnInit() {
    const prefillCipher = this.cipherFormContainer.getInitialCipherView();

    if (prefillCipher) {
      this.additionalOptionsForm.patchValue({
        notes: prefillCipher.notes,
        reprompt: prefillCipher.reprompt === CipherRepromptType.Password,
      });
    }

    if (this.cipherFormContainer.config.mode === "partial-edit") {
      this.additionalOptionsForm.disable();
      this.isPartialEdit = true;
    }
  }

  addCustomField() {
    this.customFieldsComponent.openAddEditCustomFieldDialog();
  }

  handleCustomFieldChange(numberOfCustomFields: number) {
    this.hasCustomFields = numberOfCustomFields > 0;

    this.changeDetectorRef.detectChanges();
  }
}
