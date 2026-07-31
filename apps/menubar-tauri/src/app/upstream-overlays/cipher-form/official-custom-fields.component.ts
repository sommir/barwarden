import { LiveAnnouncer } from "@angular/cdk/a11y";
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
} from "@angular/cdk/drag-drop";
import { CommonModule } from "@angular/common";
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnInit,
  Output,
  QueryList,
  ViewChildren,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  FormArray,
  FormBuilder,
  FormsModule,
  ReactiveFormsModule,
} from "@angular/forms";
import { Subject, zip } from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { FieldType } from "@bitwarden/common/vault/enums";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { CheckboxModule } from "@bitwarden/components/checkbox/checkbox.module";
import { DialogRef } from "@bitwarden/components/dialog/dialog-ref";
import { DialogService } from "@bitwarden/components/dialog/dialog.service";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { IconButtonModule } from "@bitwarden/components/icon-button/icon-button.module";
import { LinkModule } from "@bitwarden/components/link/link.module";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { TypographyModule } from "@bitwarden/components/typography/typography.module";

import { OfficialLoginFormContainer } from "./official-login-form-container";
import {
  AddEditCustomFieldDialogData,
  OfficialAddEditCustomFieldDialogComponent,
} from "./official-add-edit-custom-field-dialog.component";

export type CustomField = {
  type: FieldType;
  name: string;
  value: string | boolean | null;
  newField: boolean;
};

@Component({
  selector: "vault-custom-fields",
  templateUrl: "./official-custom-fields.component.html",
  imports: [
    JslibModule,
    CommonModule,
    FormsModule,
    FormFieldModule,
    ReactiveFormsModule,
    SectionHeaderComponent,
    TypographyModule,
    CardComponent,
    IconButtonModule,
    CheckboxModule,
    DragDropModule,
    LinkModule,
  ],
})
export class OfficialCustomFieldsComponent implements OnInit, AfterViewInit {
  @Output() numberOfFieldsChange = new EventEmitter<number>();

  @ViewChildren("customFieldRow") customFieldRows: QueryList<
    ElementRef<HTMLDivElement>
  >;

  @Input() disableSectionMargin: boolean;

  customFieldsForm = this.formBuilder.group({
    fields: new FormArray([]),
  });

  dialogRef: DialogRef;

  isPartialEdit: boolean;

  hasCustomFields = false;

  private focusOnNewInput$ = new Subject<void>();

  protected parentFormDisabled: boolean = false;

  disallowHiddenField?: boolean;

  destroyed$: DestroyRef;
  FieldType = FieldType;

  constructor(
    private dialogService: DialogService,
    private cipherFormContainer: OfficialLoginFormContainer,
    private formBuilder: FormBuilder,
    private i18nService: I18nService,
    private liveAnnouncer: LiveAnnouncer,
  ) {
    this.destroyed$ = inject(DestroyRef);
    this.cipherFormContainer.registerChildForm(
      "customFields",
      this.customFieldsForm,
    );

    this.customFieldsForm.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.updateCipher(this.fields.getRawValue());
      });

    this.cipherFormContainer.formStatusChange$
      .pipe(takeUntilDestroyed())
      .subscribe((status) => {
        this.parentFormDisabled = status === "disabled";

        if (status === "enabled" && !this.cipherFormContainer.canViewSecrets) {
          this.fields.controls.forEach((field) => {
            const value = field.getRawValue() as CustomField;
            if (value.type === FieldType.Hidden && !value.newField) {
              field.get("value")?.disable({ emitEvent: false });
            }
          });
        }
      });
  }

  get fields(): FormArray {
    return this.customFieldsForm.controls.fields as FormArray;
  }

  canEdit(type: FieldType): boolean {
    return (
      !this.isPartialEdit &&
      (type !== FieldType.Hidden ||
        this.cipherFormContainer.originalCipherView === null ||
        this.cipherFormContainer.canViewSecrets)
    );
  }

  dragDisabled(type: FieldType): boolean {
    return !this.canEdit(type) || this.fields.length <= 1;
  }

  ngOnInit() {
    const prefillCipher = this.cipherFormContainer.getInitialCipherView();

    prefillCipher?.fields?.forEach((field) => {
      let value: string | boolean = field.value;

      if (field.type === FieldType.Boolean) {
        value = field.value === "true" ? true : false;
      } else if (
        field.type === FieldType.Hidden &&
        !this.cipherFormContainer.canViewSecrets
      ) {
        value = "";
      }

      const customField = this.formBuilder.group<CustomField>({
        type: field.type,
        name: field.name,
        value: value,
        newField: false,
      });

      if (
        field.type === FieldType.Hidden &&
        !this.cipherFormContainer.canViewSecrets
      ) {
        customField.controls.value.disable();
      }

      this.fields.push(customField);
    });

    if (this.cipherFormContainer.config.mode === "partial-edit") {
      this.isPartialEdit = true;
      this.customFieldsForm.disable();
    }
  }

  ngAfterViewInit(): void {
    zip(this.focusOnNewInput$, this.customFieldRows.changes)
      .pipe(takeUntilDestroyed(this.destroyed$))
      .subscribe(() => {
        const mostRecentRow = this.customFieldRows.last.nativeElement;
        const input = mostRecentRow.querySelector<HTMLInputElement>("input");
        const label = mostRecentRow
          .querySelector<HTMLLabelElement>("label")
          .textContent.trim();

        void this.liveAnnouncer
          .announce(this.i18nService.t("fieldAdded", label), "polite")
          .then(() => {
            input.focus();
          });
      });
  }

  openAddEditCustomFieldDialog(
    editLabelConfig?: AddEditCustomFieldDialogData["editLabelConfig"],
  ) {
    const { mode } = this.cipherFormContainer.config;
    this.dialogRef = this.dialogService.open<
      unknown,
      AddEditCustomFieldDialogData
    >(OfficialAddEditCustomFieldDialogComponent, {
      data: {
        addField: this.addField.bind(this),
        updateLabel: this.updateLabel.bind(this),
        removeField: this.removeField.bind(this),
        editLabelConfig,
        disallowHiddenField:
          mode === "edit" && !this.cipherFormContainer.canViewSecrets,
      },
    });
  }

  canViewPasswords(index: number) {
    if (this.cipherFormContainer.originalCipherView === null) {
      return true;
    }

    return (
      this.cipherFormContainer.canViewSecrets ||
      this.fields.at(index).value.newField
    );
  }

  updateLabel(index: number, label: string) {
    this.fields.at(index).patchValue({ name: label });
    void this.dialogRef?.close();
  }

  removeField(index: number) {
    this.fields.removeAt(index);
    void this.dialogRef?.close();
  }

  addField(type: FieldType, label: string) {
    void this.dialogRef?.close();

    let value = null;

    if (type === FieldType.Boolean) {
      value = false;
    }

    this.fields.push(
      this.formBuilder.group<CustomField>({
        type,
        name: label,
        value,
        newField: true,
      }),
    );

    this.focusOnNewInput$.next();
  }

  drop(event: CdkDragDrop<HTMLDivElement>) {
    moveItemInArray(
      this.fields.controls,
      event.previousIndex,
      event.currentIndex,
    );

    this.updateCipher(this.fields.controls.map((control) => control.value));
  }

  async handleKeyDown(event: KeyboardEvent, label: string, index: number) {
    if (event.key === "ArrowUp" && index !== 0) {
      event.preventDefault();

      const currentIndex = index - 1;
      this.drop({
        previousIndex: index,
        currentIndex,
      } as CdkDragDrop<HTMLDivElement>);
      await this.liveAnnouncer.announce(
        this.i18nService.t(
          "reorderFieldUp",
          label,
          currentIndex + 1,
          this.fields.length,
        ),
        "assertive",
      );

      setTimeout(() => {
        (event.target as HTMLButtonElement).focus();
      });
    }

    if (event.key === "ArrowDown" && index !== this.fields.length - 1) {
      event.preventDefault();

      const currentIndex = index + 1;
      this.drop({
        previousIndex: index,
        currentIndex,
      } as CdkDragDrop<HTMLDivElement>);
      await this.liveAnnouncer.announce(
        this.i18nService.t(
          "reorderFieldDown",
          label,
          currentIndex + 1,
          this.fields.length,
        ),
        "assertive",
      );
    }
  }

  private updateCipher(fields: CustomField[]) {
    const newFields = fields.map((field: CustomField) => {
      let value: string;

      if (typeof field.value === "number") {
        value = `${field.value}`;
      } else if (typeof field.value === "boolean") {
        value = field.value ? "true" : "false";
      } else {
        value = field.value;
      }

      const fieldView = new FieldView();
      fieldView.type = field.type;
      fieldView.name = field.name;
      fieldView.value = value;
      return fieldView;
    });

    this.hasCustomFields = newFields.length > 0;

    this.numberOfFieldsChange.emit(newFields.length);

    this.cipherFormContainer.patchCipher((cipher) => {
      cipher.fields = newFields;
      return cipher;
    });
  }
}
