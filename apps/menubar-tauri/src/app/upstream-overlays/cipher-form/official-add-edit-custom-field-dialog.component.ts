import { DIALOG_DATA } from "@angular/cdk/dialog";
import { CommonModule } from "@angular/common";
import { Component, Inject } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { FieldType } from "@bitwarden/common/vault/enums";
import { AsyncActionsModule } from "@bitwarden/components/async-actions/async-actions.module";
import { ButtonModule } from "@bitwarden/components/button/button.module";
import { DialogComponent } from "@bitwarden/components/dialog/dialog/dialog.component";
import { DialogCloseDirective } from "@bitwarden/components/dialog/directives/dialog-close.directive";
import { DialogFooterDirective } from "@bitwarden/components/dialog/simple-dialog/simple-dialog.component";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { IconButtonModule } from "@bitwarden/components/icon-button/icon-button.module";
import { SelectModule } from "@bitwarden/components/select/select.module";

export type AddEditCustomFieldDialogData = {
  addField: (type: FieldType, label: string) => void;
  updateLabel: (index: number, label: string) => void;
  removeField: (index: number) => void;
  editLabelConfig?: { index: number; label: string };
  disallowHiddenField?: boolean;
};

@Component({
  selector: "vault-add-edit-custom-field-dialog",
  templateUrl: "./official-add-edit-custom-field-dialog.component.html",
  imports: [
    CommonModule,
    JslibModule,
    DialogCloseDirective,
    DialogComponent,
    DialogFooterDirective,
    ButtonModule,
    FormFieldModule,
    SelectModule,
    ReactiveFormsModule,
    IconButtonModule,
    AsyncActionsModule,
  ],
})
export class OfficialAddEditCustomFieldDialogComponent {
  variant: "add" | "edit";

  customFieldForm = this.formBuilder.group({
    type: FieldType.Text,
    label: ["", Validators.required],
  });

  fieldTypeOptions = [
    { name: this.i18nService.t("cfTypeText"), value: FieldType.Text },
    { name: this.i18nService.t("cfTypeHidden"), value: FieldType.Hidden },
    { name: this.i18nService.t("cfTypeCheckbox"), value: FieldType.Boolean },
  ];

  FieldType = FieldType;

  constructor(
    @Inject(DIALOG_DATA) private data: AddEditCustomFieldDialogData,
    private formBuilder: FormBuilder,
    private i18nService: I18nService,
  ) {
    this.variant = data.editLabelConfig ? "edit" : "add";

    this.fieldTypeOptions = this.fieldTypeOptions.filter((option) => {
      if (this.data.disallowHiddenField && option.value === FieldType.Hidden) {
        return false;
      }
      return true;
    });

    if (this.variant === "edit") {
      this.customFieldForm.controls.label.setValue(data.editLabelConfig.label);
      this.customFieldForm.controls.type.disable();
    }
  }

  getTypeHint(): string {
    switch (this.customFieldForm.get("type")?.value) {
      case FieldType.Text:
        return this.i18nService.t("textHelpText");
      case FieldType.Hidden:
        return this.i18nService.t("hiddenHelpText");
      case FieldType.Boolean:
        return this.i18nService.t("checkBoxHelpText");
      default:
        return "";
    }
  }

  submit = () => {
    if (this.variant === "add") {
      this.addField();
    } else {
      this.updateLabel();
    }
  };

  addField() {
    if (this.customFieldForm.invalid) {
      return;
    }

    const { type, label } = this.customFieldForm.value;
    this.data.addField(type, label);
  }

  updateLabel() {
    if (this.customFieldForm.invalid) {
      return;
    }

    const { label } = this.customFieldForm.value;
    this.data.updateLabel(this.data.editLabelConfig.index, label);
  }

  removeField() {
    this.data.removeField(this.data.editLabelConfig.index);
  }
}
