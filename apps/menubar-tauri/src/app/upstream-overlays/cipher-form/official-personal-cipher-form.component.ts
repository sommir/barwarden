import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  forwardRef,
  inject,
  Input,
  OnChanges,
  OnInit,
  Output,
  ViewChild,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, FormGroup, ReactiveFormsModule } from "@angular/forms";
import { BehaviorSubject, Subject } from "rxjs";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { CipherType } from "@bitwarden/common/vault/enums/cipher-type";
import { FieldType } from "@bitwarden/common/vault/enums/field-type.enum";
import { SecureNoteType } from "@bitwarden/common/vault/enums/secure-note-type.enum";
import type { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { AsyncActionsModule } from "@bitwarden/components/async-actions/async-actions.module";
import { BitSubmitDirective } from "@bitwarden/components/async-actions/bit-submit.directive";
import { ButtonComponent } from "@bitwarden/components/button/button.component";

import {
  RetainedPersonalCipherFormCacheService,
  RetainedPersonalCipherFormService,
  RetainedPersonalCipherFormToastService,
  freshPersonalCipherView,
  initialPersonalCipherView,
  type RetainedOfficialPersonalCipherFormConfig,
} from "../../vault/retained-personal-cipher-form.adapter";
import { OfficialCardDetailsSectionComponent } from "./official-card-details-section.component";
import { OfficialIdentitySectionComponent } from "./official-identity-section.component";
import { OfficialPersonalAdditionalOptionsComponent } from "./official-personal-additional-options.component";
import {
  OfficialPersonalFormContainer,
  type OfficialPersonalForm,
} from "./official-personal-form-container";
import { OfficialPersonalItemDetailsComponent } from "./official-personal-item-details.component";

const invalidControlSelector = [
  'input[aria-invalid="true"]',
  'textarea[aria-invalid="true"]',
  'select[aria-invalid="true"]',
  '[role="combobox"][aria-invalid="true"]',
  ".ng-invalid[tabindex]",
].join(",");

function isFocusableInvalidControl(
  candidate: HTMLElement,
  form: HTMLFormElement,
): boolean {
  if (
    candidate === form ||
    candidate.matches('input[type="hidden"], :disabled') ||
    candidate.closest('[hidden], [aria-hidden="true"], [inert]')
  ) {
    return false;
  }

  for (let current: HTMLElement | null = candidate; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    ) {
      return false;
    }
    if (current === form) {
      break;
    }
  }

  const browserHasLayout = document.documentElement.getClientRects().length > 0;
  return !browserHasLayout || candidate.getClientRects().length > 0;
}

@Component({
  selector: "bw-official-personal-cipher-form",
  templateUrl: "./official-personal-cipher-form.component.html",
  providers: [
    {
      provide: OfficialPersonalFormContainer,
      useExisting: forwardRef(() => OfficialPersonalCipherFormComponent),
    },
    RetainedPersonalCipherFormService,
    RetainedPersonalCipherFormToastService,
    RetainedPersonalCipherFormCacheService,
  ],
  imports: [
    AsyncActionsModule,
    ReactiveFormsModule,
    OfficialPersonalItemDetailsComponent,
    OfficialCardDetailsSectionComponent,
    OfficialIdentitySectionComponent,
    OfficialPersonalAdditionalOptionsComponent,
  ],
})
export class OfficialPersonalCipherFormComponent
  implements AfterViewInit, OnInit, OnChanges, OfficialPersonalFormContainer
{
  @ViewChild(BitSubmitDirective)
  private bitSubmit: BitSubmitDirective;
  @ViewChild("formElement", { read: ElementRef })
  private formElement?: ElementRef<HTMLFormElement>;
  private destroyRef = inject(DestroyRef);
  private _firstInitialized = false;
  private protectedOriginalCipherView: CipherView | null = null;

  @Input({ required: true }) formId: string;
  @Input({ required: true }) config: RetainedOfficialPersonalCipherFormConfig;
  @Input() submitBtn?: ButtonComponent;
  @Input({ required: true }) beforeSubmit: (cipher: CipherView) => Promise<boolean>;

  @Output() cipherSaved = new EventEmitter<CipherView>();
  private formReadySubject = new Subject<void>();
  @Output() formReady = this.formReadySubject.asObservable();
  private formStatusChangeSubject = new BehaviorSubject<
    "enabled" | "disabled" | null
  >(null);
  @Output() formStatusChange$ = this.formStatusChangeSubject.asObservable();

  originalCipherView: CipherView | null;
  protected cipherForm = this.formBuilder.group<OfficialPersonalForm>({});
  protected updatedCipherView: CipherView | null;
  protected loading = true;
  CipherType = CipherType;

  get website(): string | null {
    return null;
  }

  get canViewSecrets(): boolean {
    return this.config.canViewSecrets;
  }

  constructor(
    private formBuilder: FormBuilder,
    private addEditFormService: RetainedPersonalCipherFormService,
    private toastService: RetainedPersonalCipherFormToastService,
    private i18nService: I18nService,
    private changeDetectorRef: ChangeDetectorRef,
    private cipherFormCacheService: RetainedPersonalCipherFormCacheService,
  ) {}

  ngAfterViewInit(): void {
    if (this.submitBtn) {
      this.bitSubmit.loading$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((loading) => this.submitBtn.loading.set(loading));
      this.bitSubmit.disabled$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((disabled) => this.submitBtn.disabled.set(disabled));
    }
  }

  disableFormFields(): void {
    this.cipherForm.disable({ emitEvent: false });
    this.formStatusChangeSubject.next("disabled");
  }

  enableFormFields(): void {
    if (this.formStatusChangeSubject.getValue() === "disabled") {
      this.cipherForm.enable({ emitEvent: false });
      this.formStatusChangeSubject.next("enabled");
      this.restoreDeniedControlState();
    }
  }

  registerChildForm<K extends keyof OfficialPersonalForm>(
    name: K,
    group: Exclude<OfficialPersonalForm[K], undefined>,
  ): void {
    this.cipherForm.setControl(name, group);
    const order: readonly (keyof OfficialPersonalForm)[] = [
      "itemDetails",
      this.config.cipherType === CipherType.Card ? "cardDetails" : "identityDetails",
      "additionalOptions",
      "customFields",
    ];
    const controls = this.cipherForm.controls as Record<
      keyof OfficialPersonalForm,
      OfficialPersonalForm[keyof OfficialPersonalForm]
    >;
    const sorted = order.flatMap((key) => (controls[key] ? [[key, controls[key]] as const] : []));
    for (const key of Object.keys(controls) as (keyof OfficialPersonalForm)[]) {
      delete controls[key];
    }
    for (const [key, control] of sorted) {
      controls[key] = control;
    }
  }

  patchCipher(updateFn: (current: CipherView) => CipherView): void {
    this.updatedCipherView = updateFn(this.updatedCipherView);
    this.cipherFormCacheService.cacheCipherView(this.updatedCipherView);
  }

  getInitialCipherView(): CipherView {
    const cachedCipherView = this.cipherFormCacheService.getCachedCipherView();
    if (cachedCipherView && this.initializedWithCachedCipher()) {
      return cachedCipherView;
    }
    return this.originalCipherView ?? this.updatedCipherView;
  }

  initializedWithCachedCipher(): boolean {
    return this.cipherFormCacheService.initializedWithValue;
  }

  async ngOnChanges(): Promise<void> {
    if (this._firstInitialized) {
      await this.init();
    }
  }

  async ngOnInit(): Promise<void> {
    await this.init();
    this._firstInitialized = true;
  }

  async init(): Promise<void> {
    this.loading = true;
    this.changeDetectorRef.detectChanges();
    this.originalCipherView = null;
    this.protectedOriginalCipherView = null;
    this.cipherForm = this.formBuilder.group<OfficialPersonalForm>({});

    if (this.config == null) {
      return;
    }

    if (this.config.mode === "add") {
      this.updatedCipherView = initialPersonalCipherView(this.config);
      this.stripServerState(this.updatedCipherView);
      this.updatedCipherView.type = this.config.cipherType;
      if (this.config.cipherType === CipherType.SecureNote) {
        this.updatedCipherView.secureNote.type = SecureNoteType.Generic;
      }
    } else {
      if (this.config.originalCipher == null) {
        throw new Error("Original cipher is required for edit or clone mode");
      }
      this.originalCipherView = await this.addEditFormService.decryptCipher(
        this.config.originalCipher,
      );
      this.updatedCipherView = await this.addEditFormService.decryptCipher(
        this.config.originalCipher,
      );
      if (this.config.mode === "clone") {
        this.stripServerState(this.updatedCipherView);
      }
    }
    this.protectedOriginalCipherView = freshPersonalCipherView(
      this.updatedCipherView,
    );
    this.setInitialCipherFromCache();
    this.loading = false;
    this.changeDetectorRef.detectChanges();
    this.formReadySubject.next();
  }

  setInitialCipherFromCache(): void {
    const cachedCipher = this.cipherFormCacheService.getCachedCipherView();
    if (cachedCipher === null) {
      return;
    }
    const sameExisting =
      this.updatedCipherView.id &&
      this.updatedCipherView.id === cachedCipher.id;
    const sameNew =
      !this.updatedCipherView.id &&
      !cachedCipher.id &&
      this.updatedCipherView.type === cachedCipher.type;
    if (sameExisting || sameNew) {
      this.updatedCipherView = cachedCipher;
    }
  }

  private countInvalidFields(formGroup: FormGroup): number {
    return Object.values(formGroup.controls).reduce((count, control) => {
      if (control instanceof FormGroup) {
        return count + this.countInvalidFields(control);
      }
      return (
        count +
        (control.invalid
          ? ((control.errors?.["fieldCount"] as number) ?? 1)
          : 0)
      );
    }, 0);
  }

  focusFirstInvalidControl(): HTMLElement | null {
    this.changeDetectorRef.detectChanges();
    const form = this.formElement?.nativeElement;
    if (!form) {
      return null;
    }
    for (const candidate of Array.from(
      form.querySelectorAll<HTMLElement>(invalidControlSelector),
    )) {
      if (!isFocusableInvalidControl(candidate, form)) {
        continue;
      }
      try {
        candidate.focus({ preventScroll: true });
      } catch {
        continue;
      }
      if (document.activeElement !== candidate) {
        continue;
      }
      candidate.scrollIntoView?.({ block: "center", behavior: "auto" });
      return candidate;
    }
    return null;
  }

  private cipherForSubmit(): CipherView {
    const cipher = freshPersonalCipherView(this.updatedCipherView);
    if (this.config.mode === "clone") {
      this.stripServerState(cipher);
    }
    if (this.canViewSecrets || !this.protectedOriginalCipherView) {
      return cipher;
    }
    const original = this.protectedOriginalCipherView;
    if (cipher.type === CipherType.Card) {
      if (!cipher.card.number) cipher.card.number = original.card.number;
      if (!cipher.card.code) cipher.card.code = original.card.code;
    } else if (cipher.type === CipherType.Identity) {
      if (!cipher.identity.ssn) cipher.identity.ssn = original.identity.ssn;
      if (!cipher.identity.passportNumber) {
        cipher.identity.passportNumber = original.identity.passportNumber;
      }
    }
    const originalsByName = new Map<string, string[]>();
    for (const field of original.fields) {
      if (field.type === FieldType.Hidden) {
        const values = originalsByName.get(field.name ?? "") ?? [];
        values.push(field.value ?? "");
        originalsByName.set(field.name ?? "", values);
      }
    }
    for (const field of cipher.fields) {
      if (field.type === FieldType.Hidden && !field.value) {
        const values = originalsByName.get(field.name ?? "");
        if (values?.length) field.value = values.shift()!;
      }
    }
    return cipher;
  }

  submit = async (): Promise<void> => {
    if (typeof this.beforeSubmit !== "function") {
      return;
    }
    if (this.cipherForm.invalid) {
      this.cipherForm.markAllAsTouched();
      this.focusFirstInvalidControl();
      const invalidFieldsCount = this.countInvalidFields(this.cipherForm);
      if (invalidFieldsCount > 0) {
        this.toastService.showToast({
          variant: "error",
          title: null,
          message:
            invalidFieldsCount === 1
              ? this.i18nService.t("singleFieldNeedsAttention")
              : this.i18nService.t(
                  "multipleFieldsNeedAttention",
                  invalidFieldsCount,
                ),
        });
      }
      return;
    }

    const cipher = this.cipherForSubmit();
    this.disableFormFields();
    try {
      await this.beforeSubmit(cipher);
    } finally {
      this.enableFormFields();
    }
  };

  private stripServerState(cipher: CipherView): void {
    cipher.id = null;
    cipher.key = undefined;
    cipher.attachments = [];
    cipher.organizationId = null;
    cipher.collectionIds = [];
    cipher.archivedDate = null;
    cipher.deletedDate = null;
    Reflect.deleteProperty(cipher, "creationDate");
    Reflect.deleteProperty(cipher, "revisionDate");
    Reflect.deleteProperty(cipher, "passwordRevisionDate");
    cipher.permissions = undefined;
    cipher.localData = undefined;
    cipher.passwordHistory = [];
    cipher.edit = false;
    cipher.viewPassword = false;
    cipher.organizationUseTotp = false;
    cipher.decryptionFailure = false;
    Reflect.deleteProperty(cipher, "decryptionState");
  }

  private restoreDeniedControlState(): void {
    if (this.canViewSecrets) return;
    const card = this.cipherForm.controls.cardDetails;
    card?.controls.number.disable({ emitEvent: false });
    card?.controls.code.disable({ emitEvent: false });
    const identity = this.cipherForm.controls.identityDetails;
    identity?.controls.ssn.disable({ emitEvent: false });
    identity?.controls.passportNumber.disable({ emitEvent: false });
  }
}
