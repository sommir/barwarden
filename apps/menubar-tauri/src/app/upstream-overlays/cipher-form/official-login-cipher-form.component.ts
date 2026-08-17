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
import { FieldType } from "@bitwarden/common/vault/enums";
import { CipherType } from "@bitwarden/common/vault/enums/cipher-type";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { AsyncActionsModule } from "@bitwarden/components/async-actions/async-actions.module";
import { BitSubmitDirective } from "@bitwarden/components/async-actions/bit-submit.directive";
import { ButtonComponent } from "@bitwarden/components/button/button.component";

import { CipherFormGenerationService } from "../../../../../../vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form-generation.service";
import { CipherFormService } from "../../../../../../vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form.service";
import {
  RetainedCipherFormCacheService,
  RetainedCipherFormGenerationService,
  RetainedCipherFormService,
  RetainedCipherFormToastService,
  RETAINED_LOGIN_FORM_GENERATION_OWNER,
  freshCipherView,
  type RetainedOfficialCipherFormConfig,
} from "../../vault/retained-login-form.adapter";
import { RetainedLoginFormRouteOwner } from "../../vault/retained-login-form-generation-owner";
import { OfficialAdditionalOptionsComponent } from "./official-additional-options.component";
import {
  OfficialLoginFormContainer,
  type OfficialLoginForm,
} from "./official-login-form-container";
import { OfficialLoginItemDetailsComponent } from "./official-login-item-details.component";
import { OfficialLoginDetailsComponent } from "./official-login-details.component";

@Component({
  selector: "bw-official-login-cipher-form",
  templateUrl: "./official-login-cipher-form.component.html",
  providers: [
    {
      provide: OfficialLoginFormContainer,
      useExisting: forwardRef(() => OfficialLoginCipherFormComponent),
    },
    { provide: CipherFormService, useClass: RetainedCipherFormService },
    {
      provide: CipherFormGenerationService,
      useClass: RetainedCipherFormGenerationService,
    },
    RetainedLoginFormRouteOwner,
    {
      provide: RETAINED_LOGIN_FORM_GENERATION_OWNER,
      useExisting: RetainedLoginFormRouteOwner,
    },
    RetainedCipherFormToastService,
    RetainedCipherFormCacheService,
  ],
  imports: [
    AsyncActionsModule,
    ReactiveFormsModule,
    OfficialLoginItemDetailsComponent,
    OfficialAdditionalOptionsComponent,
    OfficialLoginDetailsComponent,
  ],
})
export class OfficialLoginCipherFormComponent
  implements AfterViewInit, OnInit, OnChanges, OfficialLoginFormContainer
{
  @ViewChild(BitSubmitDirective)
  private bitSubmit: BitSubmitDirective;
  @ViewChild("formElement", { read: ElementRef })
  private formElement?: ElementRef<HTMLFormElement>;
  private destroyRef = inject(DestroyRef);
  private _firstInitialized = false;

  @Input({ required: true }) formId: string;

  @Input({ required: true }) config: RetainedOfficialCipherFormConfig;

  @Input()
  submitBtn?: ButtonComponent;

  @Input()
  beforeSubmit: (cipher: CipherView) => Promise<boolean>;

  @Output() cipherSaved = new EventEmitter<CipherView>();

  private formReadySubject = new Subject<void>();

  @Output() formReady = this.formReadySubject.asObservable();

  private formStatusChangeSubject = new BehaviorSubject<
    "enabled" | "disabled" | null
  >(null);

  @Output() formStatusChange$ = this.formStatusChangeSubject.asObservable();

  originalCipherView: CipherView | null;

  protected cipherForm = this.formBuilder.group<OfficialLoginForm>({});

  protected updatedCipherView: CipherView | null;

  get website(): string | null {
    return this.updatedCipherView?.login?.uris?.[0]?.uri ?? null;
  }

  get canViewSecrets(): boolean {
    return this.config.canViewSecrets;
  }

  protected loading: boolean = true;

  CipherType = CipherType;

  ngAfterViewInit(): void {
    if (this.submitBtn) {
      this.bitSubmit.loading$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((loading) => {
          this.submitBtn.loading.set(loading);
        });

      this.bitSubmit.disabled$
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((disabled) => {
          this.submitBtn.disabled.set(disabled);
        });
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
    }
  }

  registerChildForm<K extends keyof OfficialLoginForm>(
    name: K,
    group: Exclude<OfficialLoginForm[K], undefined>,
  ): void {
    this.cipherForm.setControl(name, group);
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

    return this.originalCipherView;
  }

  initializedWithCachedCipher(): boolean {
    return this.cipherFormCacheService.initializedWithValue;
  }

  async ngOnChanges() {
    if (this._firstInitialized) {
      await this.init();
    }
  }

  async ngOnInit() {
    await this.init();
    this._firstInitialized = true;
  }

  async init() {
    this.loading = true;

    this.changeDetectorRef.detectChanges();

    this.updatedCipherView = new CipherView();
    this.originalCipherView = null;
    this.cipherForm = this.formBuilder.group<OfficialLoginForm>({});

    if (this.config == null) {
      return;
    }

    if (this.config.mode !== "add") {
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
        this.updatedCipherView.id = null;
        this.updatedCipherView.key = undefined;
        this.updatedCipherView.attachments = [];

        if (this.updatedCipherView.login) {
          this.updatedCipherView.login.fido2Credentials = null;
        }
      }
    } else {
      this.updatedCipherView.type = this.config.cipherType;
    }

    this.setInitialCipherFromCache();

    this.loading = false;
    this.changeDetectorRef.detectChanges();
    this.formReadySubject.next();
  }

  setInitialCipherFromCache() {
    const hasOverlayData =
      this.config.initialValues &&
      (this.config.initialValues.username !== undefined ||
        this.config.initialValues.password !== undefined);

    if (hasOverlayData) {
      this.cipherFormCacheService.clearCache();
      return;
    }

    const cachedCipher = this.cipherFormCacheService.getCachedCipherView();
    if (cachedCipher === null) {
      return;
    }

    const isEditingExistingCipher =
      this.updatedCipherView.id &&
      this.updatedCipherView.id === cachedCipher.id;
    const isCreatingNewCipher =
      !this.updatedCipherView.id &&
      !cachedCipher.id &&
      this.updatedCipherView.type === cachedCipher.type;

    if (isEditingExistingCipher || isCreatingNewCipher) {
      this.updatedCipherView = cachedCipher;
    }
  }

  constructor(
    private formBuilder: FormBuilder,
    private addEditFormService: CipherFormService,
    private toastService: RetainedCipherFormToastService,
    private i18nService: I18nService,
    private changeDetectorRef: ChangeDetectorRef,
    private cipherFormCacheService: RetainedCipherFormCacheService,
  ) {}

  private countInvalidFields(formGroup: FormGroup): number {
    return Object.values(formGroup.controls).reduce((count, control) => {
      if (control instanceof FormGroup) {
        return count + this.countInvalidFields(control);
      }

      const fieldCount = control.invalid
        ? ((control.errors?.["fieldCount"] as number) ?? 1)
        : 0;
      return count + fieldCount;
    }, 0);
  }

  focusFirstInvalidControl(): HTMLElement | null {
    this.changeDetectorRef.detectChanges();
    const target =
      this.formElement?.nativeElement.querySelector<HTMLElement>(
        'input[aria-invalid="true"],textarea[aria-invalid="true"],select[aria-invalid="true"],[role="combobox"][aria-invalid="true"],.ng-invalid[tabindex]:not(form)',
      ) ?? null;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "center", behavior: "auto" });
    return target;
  }

  private cipherForSubmit(): CipherView {
    const cipherToSave = freshCipherView(this.updatedCipherView);

    if (!this.canViewSecrets && this.originalCipherView) {
      cipherToSave.login.password = this.originalCipherView.login.password;
      cipherToSave.login.totp = this.originalCipherView.login.totp;

      const originalHiddenFields =
        this.originalCipherView.fields?.filter(
          (field) => field.type === FieldType.Hidden,
        ) ?? [];
      let hiddenFieldIndex = 0;
      cipherToSave.fields?.forEach((field) => {
        if (field.type === FieldType.Hidden) {
          field.value =
            originalHiddenFields[hiddenFieldIndex]?.value ?? field.value;
          hiddenFieldIndex += 1;
        }
      });
    }

    return cipherToSave;
  }

  submit = async () => {
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

    const cipherForSubmit = this.cipherForSubmit();
    if (this.beforeSubmit) {
      const shouldSubmit = await this.beforeSubmit(cipherForSubmit);
      if (!shouldSubmit) {
        return;
      }
    }

    const savedCipher = await this.addEditFormService.saveCipher(
      cipherForSubmit,
      this.config,
    );

    this.cipherFormCacheService.clearCache();

    this.toastService.showToast({
      variant: "success",
      title: null,
      message: this.i18nService.t(
        this.config.mode === "edit" ? "editedItem" : "addedItem",
      ),
    });

    this.cipherSaved.emit(savedCipher);
  };
}
