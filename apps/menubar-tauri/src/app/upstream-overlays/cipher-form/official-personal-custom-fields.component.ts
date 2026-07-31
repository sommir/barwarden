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
import { CipherType } from "@bitwarden/common/vault/enums/cipher-type";
import { FieldType } from "@bitwarden/common/vault/enums/field-type.enum";
import type { LinkedIdType } from "@bitwarden/common/vault/enums/linked-id-type.enum";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";
import { CardComponent } from "@bitwarden/components/card/card.component";
import { CheckboxModule } from "@bitwarden/components/checkbox/checkbox.module";
import { DialogRef } from "@bitwarden/components/dialog/dialog-ref";
import { DialogService } from "@bitwarden/components/dialog/dialog.service";
import { FormFieldModule } from "@bitwarden/components/form-field/form-field.module";
import { IconButtonModule } from "@bitwarden/components/icon-button/icon-button.module";
import { LinkModule } from "@bitwarden/components/link/link.module";
import { SectionHeaderComponent } from "@bitwarden/components/section/section-header.component";
import { SelectModule } from "@bitwarden/components/select/select.module";
import { TypographyModule } from "@bitwarden/components/typography/typography.module";

import {
  OfficialPersonalAddEditCustomFieldDialogComponent,
  type PersonalAddEditCustomFieldDialogData,
} from "./official-personal-add-edit-custom-field-dialog.component";
import { OfficialPersonalFormContainer } from "./official-personal-form-container";

export type PersonalCustomField = {
  type: FieldType;
  name: string;
  value: string | boolean | null;
  linkedId: LinkedIdType;
  newField: boolean;
};

@Component({
  selector: "vault-custom-fields",
  templateUrl: "./official-personal-custom-fields.component.html",
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
    SelectModule,
    DragDropModule,
    LinkModule,
  ],
})
export class OfficialPersonalCustomFieldsComponent
  implements OnInit, AfterViewInit
{
  @Output() numberOfFieldsChange = new EventEmitter<number>();
  @ViewChildren("customFieldRow")
  customFieldRows: QueryList<ElementRef<HTMLDivElement>>;
  @Input() disableSectionMargin: boolean;
  customFieldsForm = this.formBuilder.group({ fields: new FormArray([]) });
  dialogRef: DialogRef;
  linkedFieldOptions: { name: string; value: LinkedIdType }[] = [];
  isPartialEdit = false;
  hasCustomFields = false;
  private focusOnNewInput$ = new Subject<void>();
  protected parentFormDisabled = false;
  destroyed$ = inject(DestroyRef);
  FieldType = FieldType;

  constructor(
    private dialogService: DialogService,
    private cipherFormContainer: OfficialPersonalFormContainer,
    private formBuilder: FormBuilder,
    private i18nService: I18nService,
    private liveAnnouncer: LiveAnnouncer,
  ) {
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
            const value = field.getRawValue() as PersonalCustomField;
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

  ngOnInit(): void {
    const options = Array.from(
      this.getLinkedFieldsOptionsForCipher()?.entries() ?? [],
    );
    options.sort((a, b) => a[1].sortPosition - b[1].sortPosition);
    this.linkedFieldOptions = options.map(([id, option]) => ({
      name: this.i18nService.t(option.i18nKey),
      value: id as LinkedIdType,
    }));

    this.cipherFormContainer
      .getInitialCipherView()
      ?.fields?.forEach((field) => {
        let value: string | boolean = field.value;
        if (field.type === FieldType.Boolean) {
          value = field.value === "true";
        } else if (
          field.type === FieldType.Hidden &&
          !this.cipherFormContainer.canViewSecrets
        ) {
          value = "";
        }
        const customField = this.formBuilder.group<PersonalCustomField>({
          type: field.type,
          name: field.name,
          value,
          linkedId: field.linkedId,
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
  }

  ngAfterViewInit(): void {
    zip(this.focusOnNewInput$, this.customFieldRows.changes)
      .pipe(takeUntilDestroyed(this.destroyed$))
      .subscribe(() => {
        const row = this.customFieldRows.last.nativeElement;
        const input = row.querySelector<HTMLInputElement>("input");
        const label =
          row.querySelector<HTMLLabelElement>("label")?.textContent?.trim() ??
          "";
        void this.liveAnnouncer
          .announce(this.i18nService.t("fieldAdded", label), "polite")
          .then(() => input?.focus());
      });
  }

  openAddEditCustomFieldDialog(
    editLabelConfig?: PersonalAddEditCustomFieldDialogData["editLabelConfig"],
  ): void {
    const { mode, cipherType } = this.cipherFormContainer.config;
    this.dialogRef = this.dialogService.open<
      unknown,
      PersonalAddEditCustomFieldDialogData
    >(OfficialPersonalAddEditCustomFieldDialogComponent, {
      data: {
        addField: this.addField.bind(this),
        updateLabel: this.updateLabel.bind(this),
        removeField: this.removeField.bind(this),
        cipherType:
          cipherType as PersonalAddEditCustomFieldDialogData["cipherType"],
        editLabelConfig,
        disallowHiddenField:
          mode === "edit" && !this.cipherFormContainer.canViewSecrets,
      },
    });
  }

  canViewPasswords(index: number): boolean {
    return (
      this.cipherFormContainer.canViewSecrets ||
      this.fields.at(index).value.newField
    );
  }

  updateLabel(index: number, label: string): void {
    this.fields.at(index).patchValue({ name: label });
    void this.dialogRef?.close();
  }

  removeField(index: number): void {
    this.fields.removeAt(index);
    void this.dialogRef?.close();
  }

  addField(type: FieldType, label: string): void {
    void this.dialogRef?.close();
    let value: string | boolean | null = null;
    let linkedId: LinkedIdType = null;
    if (type === FieldType.Boolean) value = false;
    if (type === FieldType.Linked) {
      if (this.linkedFieldOptions.length === 0) {
        throw new TypeError(
          "Linked fields are unavailable for this cipher type",
        );
      }
      linkedId = this.linkedFieldOptions[0].value;
    }
    this.fields.push(
      this.formBuilder.group<PersonalCustomField>({
        type,
        name: label,
        value,
        linkedId,
        newField: true,
      }),
    );
    this.focusOnNewInput$.next();
  }

  drop(event: CdkDragDrop<HTMLDivElement>): void {
    moveItemInArray(
      this.fields.controls,
      event.previousIndex,
      event.currentIndex,
    );
    this.updateCipher(
      this.fields.controls.map((control) => control.getRawValue()),
    );
  }

  async handleKeyDown(
    event: KeyboardEvent,
    label: string,
    index: number,
  ): Promise<void> {
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
      setTimeout(() => (event.target as HTMLButtonElement).focus());
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
      setTimeout(() => (event.target as HTMLButtonElement).focus());
    }
  }

  private getLinkedFieldsOptionsForCipher() {
    switch (this.cipherFormContainer.config.cipherType) {
      case CipherType.Card:
        return CardView.prototype.linkedFieldOptions;
      case CipherType.Identity:
        return IdentityView.prototype.linkedFieldOptions;
      default:
        return null;
    }
  }

  private updateCipher(fields: PersonalCustomField[]): void {
    const newFields = fields.map((field) => {
      const fieldView = new FieldView();
      fieldView.type = field.type;
      fieldView.name = field.name;
      fieldView.value =
        typeof field.value === "boolean"
          ? field.value
            ? "true"
            : "false"
          : (field.value ?? null);
      fieldView.linkedId = field.linkedId ?? undefined;
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
