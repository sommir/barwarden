import type {
  ExactMemberTransformOperation,
  OfficialMemberTransform,
  PinnedMemberTransformContract,
  RuntimeOnlyMemberContract,
} from "../official-source-body-contract";
import {
  applyExactTemplateTransforms,
  loginFormTemplateContracts,
} from "./official-login-form-member-transforms";

type MemberContractEntry = {
  readonly authority: string;
  readonly runtime: string;
  readonly contract: PinnedMemberTransformContract;
};

export type PersonalTemplateOperation = {
  readonly search: string;
  readonly replacement: string;
};

export type PersonalTemplateContract = {
  readonly authority: string;
  readonly runtime: string;
  readonly operations: readonly PersonalTemplateOperation[];
};

export const personalFormMemberContracts: readonly MemberContractEntry[] = [
  {
    "authority": "libs/vault/src/cipher-form/components/cipher-form.component.ts",
    "runtime": "official-personal-cipher-form.component.ts",
    "contract": {
      "authorityClass": "CipherFormComponent",
      "authoritySha256": "b29250c6046fc1f72513a2b5dcc599c79c8ee98d12504d168b012cc12f36dd82",
      "runtimeClass": "OfficialPersonalCipherFormComponent",
      "enforceCompleteRuntimeMembers": true,
      "transforms": [
        {
          "authorityMember": "bitSubmit",
          "runtimeMember": "bitSubmit",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "destroyRef",
          "runtimeMember": "destroyRef",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "_firstInitialized",
          "runtimeMember": "_firstInitialized",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "formId",
          "runtimeMember": "formId",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "config",
          "runtimeMember": "config",
          "operations": [
            {
              "kind": "replace",
              "search": "\n@Input({ required: true })\nconfig: CipherFormConfig;\n[[/member-skeleton]]\n[[end-member]]",
              "replacement": "\n@Input({ required: true })\nconfig: RetainedOfficialPersonalCipherFormConfig;\n[[/member-skeleton]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "submitBtn",
          "runtimeMember": "submitBtn",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "beforeSubmit",
          "runtimeMember": "beforeSubmit",
          "operations": [
            {
              "kind": "replace",
              "search": "\n@Input()\nbeforeSubmit: () => Promise<boolean>;\n[[/member-skeleton]]\n[[end-member]]",
              "replacement": "\n@Input({ required: true })\nbeforeSubmit: (cipher: CipherView) => Promise<boolean>;\n[[/member-skeleton]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "cipherSaved",
          "runtimeMember": "cipherSaved",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "formReadySubject",
          "runtimeMember": "formReadySubject",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "formReady",
          "runtimeMember": "formReady",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "formStatusChangeSubject",
          "runtimeMember": "formStatusChangeSubject",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "formStatusChange$",
          "runtimeMember": "formStatusChange$",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "originalCipherView",
          "runtimeMember": "originalCipherView",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "cipherForm",
          "runtimeMember": "cipherForm",
          "operations": [
            {
              "kind": "replace",
              "search": "\nprotected cipherForm;\n[[/member-skeleton]]\n[[initializer]]\nthis.formBuilder.group<CipherForm>({})\n[[/initializer]]\n[[end-member]]",
              "replacement": "\nprotected cipherForm;\n[[/member-skeleton]]\n[[initializer]]\nthis.formBuilder.group<OfficialPersonalForm>({})\n[[/initializer]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "updatedCipherView",
          "runtimeMember": "updatedCipherView",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "loading",
          "runtimeMember": "loading",
          "operations": [
            {
              "kind": "replace",
              "search": "\nprotected loading: boolean;\n[[/member-skeleton]]\n[[initializer]]\ntrue\n[[/initializer]]\n[[end-member]]",
              "replacement": "\nprotected loading;\n[[/member-skeleton]]\n[[initializer]]\ntrue\n[[/initializer]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "CipherType",
          "runtimeMember": "CipherType",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "website:get",
          "runtimeMember": "website:get",
          "operations": [
            {
              "kind": "replace",
              "search": "\nget website(): string | null {\n}\n[[/member-skeleton]]\n[[statement:0]]\nreturn this.updatedCipherView?.login?.uris?.[0]?.uri ?? null;\n[[/statement:0]]\n[[end-member]]",
              "replacement": "\nget website(): string | null {\n}\n[[/member-skeleton]]\n[[statement:0]]\nreturn null;\n[[/statement:0]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "constructor",
          "runtimeMember": "constructor",
          "operations": [
            {
              "kind": "replace",
              "search": "\nconstructor(private formBuilder: FormBuilder, private addEditFormService: CipherFormService, private toastService: ToastService, private i18nService: I18nService, private changeDetectorRef: ChangeDetectorRef, private cipherFormCacheService: CipherFormCacheService, private cipherArchiveService: CipherArchiveService, private accountService: AccountService) {\n}\n[[/member-skeleton]]\n[[end-member]]",
              "replacement": "\nconstructor(private formBuilder: FormBuilder, private addEditFormService: RetainedPersonalCipherFormService, private toastService: RetainedPersonalCipherFormToastService, private i18nService: I18nService, private changeDetectorRef: ChangeDetectorRef, private cipherFormCacheService: RetainedPersonalCipherFormCacheService) {\n}\n[[/member-skeleton]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "ngAfterViewInit",
          "runtimeMember": "ngAfterViewInit",
          "operations": [
            {
              "kind": "replace",
              "search": "\nngAfterViewInit(): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nif (this.submitBtn) {\n    this.bitSubmit.loading$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((loading) => {\n        this.submitBtn.loading.set(loading);\n    });\n    this.bitSubmit.disabled$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((disabled) => {\n        this.submitBtn.disabled.set(disabled);\n    });\n}\n[[/statement:0]]\n[[end-member]]",
              "replacement": "\nngAfterViewInit(): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nif (this.submitBtn) {\n    this.bitSubmit.loading$\n        .pipe(takeUntilDestroyed(this.destroyRef))\n        .subscribe((loading) => this.submitBtn.loading.set(loading));\n    this.bitSubmit.disabled$\n        .pipe(takeUntilDestroyed(this.destroyRef))\n        .subscribe((disabled) => this.submitBtn.disabled.set(disabled));\n}\n[[/statement:0]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "disableFormFields",
          "runtimeMember": "disableFormFields",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "enableFormFields",
          "runtimeMember": "enableFormFields",
          "operations": [
            {
              "kind": "replace",
              "search": "\nenableFormFields(): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nif (this.formStatusChangeSubject.getValue() === \"disabled\") {\n    this.cipherForm.enable({ emitEvent: false });\n    this.formStatusChangeSubject.next(\"enabled\");\n}\n[[/statement:0]]\n[[end-member]]",
              "replacement": "\nenableFormFields(): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nif (this.formStatusChangeSubject.getValue() === \"disabled\") {\n    this.cipherForm.enable({ emitEvent: false });\n    this.formStatusChangeSubject.next(\"enabled\");\n    this.restoreDeniedControlState();\n}\n[[/statement:0]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "registerChildForm",
          "runtimeMember": "registerChildForm",
          "operations": [
            {
              "kind": "replace",
              "search": "\nregisterChildForm<K extends keyof CipherForm>(name: K, group: Exclude<CipherForm[K], undefined>): void {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nregisterChildForm<K extends keyof OfficialPersonalForm>(name: K, group: Exclude<OfficialPersonalForm[K], undefined>): void {\n}\n[[/member-skeleton]]\n"
            },
            {
              "kind": "replace",
              "search": "\n[[end-member]]",
              "replacement": "\n[[statement:1]]\nconst order: readonly (keyof OfficialPersonalForm)[] = [\n    \"itemDetails\",\n    this.config.cipherType === CipherType.Card ? \"cardDetails\" : \"identityDetails\",\n    \"additionalOptions\",\n    \"customFields\",\n];\n[[/statement:1]]\n[[statement:2]]\nconst controls = this.cipherForm.controls as Record<keyof OfficialPersonalForm, OfficialPersonalForm[keyof OfficialPersonalForm]>;\n[[/statement:2]]\n[[statement:3]]\nconst sorted = order.flatMap((key) => (controls[key] ? [[key, controls[key]] as const] : []));\n[[/statement:3]]\n[[statement:4]]\nfor (const key of Object.keys(controls) as (keyof OfficialPersonalForm)[]) {\n    delete controls[key];\n}\n[[/statement:4]]\n[[statement:5]]\nfor (const [key, control] of sorted) {\n    controls[key] = control;\n}\n[[/statement:5]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.cipherForm.setControl(name, group);"
            }
          ]
        },
        {
          "authorityMember": "patchCipher",
          "runtimeMember": "patchCipher",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "getInitialCipherView",
          "runtimeMember": "getInitialCipherView",
          "operations": [
            {
              "kind": "replace",
              "search": "\n[[statement:1]]\nif (cachedCipherView && this.initializedWithCachedCipher()) {\n    return cachedCipherView;\n}\n[[/statement:1]]\n[[statement:2]]\nreturn this.originalCipherView;\n[[/statement:2]]\n[[end-member]]",
              "replacement": "\n[[statement:1]]\nif (cachedCipherView && this.initializedWithCachedCipher()) {\n    return cachedCipherView;\n}\n[[/statement:1]]\n[[statement:2]]\nreturn this.originalCipherView ?? this.updatedCipherView;\n[[/statement:2]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "const cachedCipherView = this.cipherFormCacheService.getCachedCipherView();"
            }
          ]
        },
        {
          "authorityMember": "initializedWithCachedCipher",
          "runtimeMember": "initializedWithCachedCipher",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "ngOnChanges",
          "runtimeMember": "ngOnChanges",
          "operations": [
            {
              "kind": "replace",
              "search": "\nasync ngOnChanges() {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nasync ngOnChanges(): Promise<void> {\n}\n[[/member-skeleton]]\n"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "if (this._firstInitialized) {\n    await this.init();\n}"
            }
          ]
        },
        {
          "authorityMember": "ngOnInit",
          "runtimeMember": "ngOnInit",
          "operations": [
            {
              "kind": "replace",
              "search": "\nasync ngOnInit() {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nasync ngOnInit(): Promise<void> {\n}\n[[/member-skeleton]]\n"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "await this.init();"
            }
          ]
        },
        {
          "authorityMember": "init",
          "runtimeMember": "init",
          "operations": [
            {
              "kind": "replace",
              "search": "\nasync init() {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nasync init(): Promise<void> {\n}\n[[/member-skeleton]]\n"
            },
            {
              "kind": "replace",
              "search": "\n[[statement:1]]\nthis.changeDetectorRef.detectChanges();\n[[/statement:1]]\n[[statement:2]]\nthis.updatedCipherView = new CipherView();\n[[/statement:2]]\n[[statement:3]]\nthis.originalCipherView = null;\n[[/statement:3]]\n[[statement:4]]\nthis.cipherForm = this.formBuilder.group<CipherForm>({});\n[[/statement:4]]\n[[statement:5]]\nif (this.config == null) {\n    return;\n}\n[[/statement:5]]\n[[statement:6]]\nif (this.config.mode !== \"add\") {\n    if (this.config.originalCipher == null) {\n        throw new Error(\"Original cipher is required for edit or clone mode\");\n    }\n    this.originalCipherView = await this.addEditFormService.decryptCipher(this.config.originalCipher);\n    this.updatedCipherView = await this.addEditFormService.decryptCipher(this.config.originalCipher);\n    if (this.config.mode === \"clone\") {\n        this.updatedCipherView.id = null;\n        this.updatedCipherView.key = undefined;\n        this.updatedCipherView.attachments = [];\n        if (this.updatedCipherView.login) {\n            this.updatedCipherView.login.fido2Credentials = null;\n        }\n    }\n}\nelse {\n    this.updatedCipherView.type = this.config.cipherType;\n    if (this.config.cipherType === CipherType.SecureNote) {\n        this.updatedCipherView.secureNote.type = SecureNoteType.Generic;\n    }\n}\n[[/statement:6]]\n[[statement:7]]\nthis.setInitialCipherFromCache();\n[[/statement:7]]\n[[statement:8]]\nthis.loading = false;\n[[/statement:8]]\n[[statement:9]]\nthis.formReadySubject.next();\n[[/statement:9]]\n[[end-member]]",
              "replacement": "\n[[statement:1]]\nthis.changeDetectorRef.detectChanges();\n[[/statement:1]]\n[[statement:2]]\nthis.originalCipherView = null;\n[[/statement:2]]\n[[statement:3]]\nthis.protectedOriginalCipherView = null;\n[[/statement:3]]\n[[statement:4]]\nthis.cipherForm = this.formBuilder.group<OfficialPersonalForm>({});\n[[/statement:4]]\n[[statement:5]]\nif (this.config == null) {\n    return;\n}\n[[/statement:5]]\n[[statement:6]]\nif (this.config.mode === \"add\") {\n    this.updatedCipherView = initialPersonalCipherView(this.config);\n    this.stripServerState(this.updatedCipherView);\n    this.updatedCipherView.type = this.config.cipherType;\n    if (this.config.cipherType === CipherType.SecureNote) {\n        this.updatedCipherView.secureNote.type = SecureNoteType.Generic;\n    }\n}\nelse {\n    if (this.config.originalCipher == null) {\n        throw new Error(\"Original cipher is required for edit or clone mode\");\n    }\n    this.originalCipherView = await this.addEditFormService.decryptCipher(this.config.originalCipher);\n    this.updatedCipherView = await this.addEditFormService.decryptCipher(this.config.originalCipher);\n    if (this.config.mode === \"clone\") {\n        this.stripServerState(this.updatedCipherView);\n    }\n}\n[[/statement:6]]\n[[statement:7]]\nthis.protectedOriginalCipherView = freshPersonalCipherView(this.updatedCipherView);\n[[/statement:7]]\n[[statement:8]]\nthis.setInitialCipherFromCache();\n[[/statement:8]]\n[[statement:9]]\nthis.loading = false;\n[[/statement:9]]\n[[statement:10]]\nthis.changeDetectorRef.detectChanges();\n[[/statement:10]]\n[[statement:11]]\nthis.formReadySubject.next();\n[[/statement:11]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.loading = true;"
            }
          ]
        },
        {
          "authorityMember": "setInitialCipherFromCache",
          "runtimeMember": "setInitialCipherFromCache",
          "operations": [
            {
              "kind": "replace",
              "search": "\nsetInitialCipherFromCache() {\n}\n[[/member-skeleton]]\n[[statement:0]]\nconst hasOverlayData = this.config.initialValues &&\n    (this.config.initialValues.username !== undefined ||\n        this.config.initialValues.password !== undefined);\n[[/statement:0]]\n[[statement:1]]\nif (hasOverlayData) {\n    this.cipherFormCacheService.clearCache();\n    return;\n}\n[[/statement:1]]\n[[statement:2]]\nconst cachedCipher = this.cipherFormCacheService.getCachedCipherView();\n[[/statement:2]]\n[[statement:3]]\nif (cachedCipher === null) {\n    return;\n}\n[[/statement:3]]\n[[statement:4]]\nconst isEditingExistingCipher = this.updatedCipherView.id && this.updatedCipherView.id === cachedCipher.id;\n[[/statement:4]]\n[[statement:5]]\nconst isCreatingNewCipher = !this.updatedCipherView.id &&\n    !cachedCipher.id &&\n    this.updatedCipherView.type === cachedCipher.type;\n[[/statement:5]]\n[[statement:6]]\nif (isEditingExistingCipher || isCreatingNewCipher) {\n    this.updatedCipherView = cachedCipher;\n}\n[[/statement:6]]\n[[end-member]]",
              "replacement": "\nsetInitialCipherFromCache(): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nconst cachedCipher = this.cipherFormCacheService.getCachedCipherView();\n[[/statement:0]]\n[[statement:1]]\nif (cachedCipher === null) {\n    return;\n}\n[[/statement:1]]\n[[statement:2]]\nconst sameExisting = this.updatedCipherView.id &&\n    this.updatedCipherView.id === cachedCipher.id;\n[[/statement:2]]\n[[statement:3]]\nconst sameNew = !this.updatedCipherView.id &&\n    !cachedCipher.id &&\n    this.updatedCipherView.type === cachedCipher.type;\n[[/statement:3]]\n[[statement:4]]\nif (sameExisting || sameNew) {\n    this.updatedCipherView = cachedCipher;\n}\n[[/statement:4]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "countInvalidFields",
          "runtimeMember": "countInvalidFields",
          "operations": [
            {
              "kind": "replace",
              "search": "\nprivate countInvalidFields(formGroup: FormGroup): number {\n}\n[[/member-skeleton]]\n[[statement:0]]\nreturn Object.values(formGroup.controls).reduce((count, control) => {\n    if (control instanceof FormGroup) {\n        return count + this.countInvalidFields(control);\n    }\n    const fieldCount = control.invalid ? ((control.errors?.[\"fieldCount\"] as number) ?? 1) : 0;\n    return count + fieldCount;\n}, 0);\n[[/statement:0]]\n[[end-member]]",
              "replacement": "\nprivate countInvalidFields(formGroup: FormGroup): number {\n}\n[[/member-skeleton]]\n[[statement:0]]\nreturn Object.values(formGroup.controls).reduce((count, control) => {\n    if (control instanceof FormGroup) {\n        return count + this.countInvalidFields(control);\n    }\n    return (count +\n        (control.invalid\n            ? ((control.errors?.[\"fieldCount\"] as number) ?? 1)\n            : 0));\n}, 0);\n[[/statement:0]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "submit",
          "runtimeMember": "submit",
          "operations": [
            {
              "kind": "replace",
              "search": "\nsubmit = async () => {\n};\n[[/member-skeleton]]\n[[statement:0]]\nif (!this.config.organizationDataOwnershipDisabled && this.config.organizations.length === 0) {\n    this.toastService.showToast({\n        variant: \"error\",\n        message: this.i18nService.t(\"cannotSaveItemNoConfirmedOrgs\"),\n    });\n    return;\n}\n[[/statement:0]]\n[[statement:1]]\nlet successToast: string = \"editedItem\";\n[[/statement:1]]\n[[statement:2]]\nif (this.cipherForm.invalid) {\n    this.cipherForm.markAllAsTouched();\n    const invalidFieldsCount = this.countInvalidFields(this.cipherForm);\n    if (invalidFieldsCount > 0) {\n        this.toastService.showToast({\n            variant: \"error\",\n            title: null,\n            message: invalidFieldsCount === 1\n                ? this.i18nService.t(\"singleFieldNeedsAttention\")\n                : this.i18nService.t(\"multipleFieldsNeedAttention\", invalidFieldsCount),\n        });\n    }\n    return;\n}\n[[/statement:2]]\n[[statement:3]]\nif (this.beforeSubmit) {\n    const shouldSubmit = await this.beforeSubmit();\n    if (!shouldSubmit) {\n        return;\n    }\n}\n[[/statement:3]]\n[[statement:4]]\nconst userCanArchive = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId, switchMap((userId) => this.cipherArchiveService.userCanArchive$(userId))));\n[[/statement:4]]\n[[statement:5]]\nif (!userCanArchive && this.updatedCipherView.archivedDate) {\n    this.updatedCipherView.archivedDate = null;\n    successToast = \"itemRestored\";\n}\n[[/statement:5]]\n[[statement:6]]\nconst savedCipher = await this.addEditFormService.saveCipher(this.updatedCipherView, this.config);\n[[/statement:6]]\n[[statement:7]]\nthis.cipherFormCacheService.clearCache();\n[[/statement:7]]\n[[statement:8]]\nthis.toastService.showToast({\n    variant: \"success\",\n    title: null,\n    message: this.i18nService.t(this.config.mode === \"edit\" || this.config.mode === \"partial-edit\"\n        ? successToast\n        : \"addedItem\"),\n});\n[[/statement:8]]\n[[statement:9]]\nthis.cipherSaved.emit(savedCipher);\n[[/statement:9]]\n[[end-member]]",
              "replacement": "\nsubmit = async (): Promise<void> => {\n};\n[[/member-skeleton]]\n[[statement:0]]\nif (typeof this.beforeSubmit !== \"function\") {\n    return;\n}\n[[/statement:0]]\n[[statement:1]]\nif (this.cipherForm.invalid) {\n    this.cipherForm.markAllAsTouched();\n    this.focusFirstInvalidControl();\n    const invalidFieldsCount = this.countInvalidFields(this.cipherForm);\n    if (invalidFieldsCount > 0) {\n        this.toastService.showToast({\n            variant: \"error\",\n            title: null,\n            message: invalidFieldsCount === 1\n                ? this.i18nService.t(\"singleFieldNeedsAttention\")\n                : this.i18nService.t(\"multipleFieldsNeedAttention\", invalidFieldsCount),\n        });\n    }\n    return;\n}\n[[/statement:1]]\n[[statement:2]]\nconst cipher = this.cipherForSubmit();\n[[/statement:2]]\n[[statement:3]]\nthis.disableFormFields();\n[[/statement:3]]\n[[statement:4]]\ntry {\n    await this.beforeSubmit(cipher);\n}\nfinally {\n    this.enableFormFields();\n}\n[[/statement:4]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        }
      ],
      "runtimeOnlyMembers": [
        {
          "runtimeMember": "formElement",
          "justification": "Scopes invalid-control lookup to this retained personal form element.",
          "canonicalSha256": "c89eadf07e48038831dda4127f5ea1df54899956419e826b69b39013c5f287a9"
        },
        {
          "runtimeMember": "protectedOriginalCipherView",
          "justification": "Keeps denied server values outside Angular controls for unchanged-value restoration.",
          "canonicalSha256": "4688d84fb485a576580561416bbdea8f49dd871268faf01958cb1aab91b9c0b0"
        },
        {
          "runtimeMember": "canViewSecrets:get",
          "justification": "Exposes the retained personal-form permission supplied by the native page boundary.",
          "canonicalSha256": "1bb55d9d2aceecf4fc34faf0c6c3e898f140b2be5776dd26db2a18cbfc4425af"
        },
        {
          "runtimeMember": "focusFirstInvalidControl",
          "justification": "Filters unavailable candidates, then focuses and centers the first usable invalid retained personal control.",
          "canonicalSha256": "3954cee166b07ade4a641a6efc469f157349483c4cf20df9df4dc53c936affb9"
        },
        {
          "runtimeMember": "cipherForSubmit",
          "justification": "Builds an isolated submit copy and restores only unchanged denied values before transport.",
          "canonicalSha256": "b85f1cab8364d4678a3e68e792fb8294fdbea30130580d6510cbad0b1dde4d22"
        },
        {
          "runtimeMember": "stripServerState",
          "justification": "Clears server and runtime metadata from retained add and clone submission copies.",
          "canonicalSha256": "86407a10d2d58029f6770575b6916a25ff6504739af55c3e1affbf50158ce55e"
        },
        {
          "runtimeMember": "restoreDeniedControlState",
          "justification": "Re-disables denied secret controls after the awaited native transport restores the form.",
          "canonicalSha256": "5121356854932efe572df622735f548f65421131b75356f14a59849a56fb72a6"
        }
      ]
    }
  },
  {
    "authority": "libs/vault/src/cipher-form/cipher-form-container.ts",
    "runtime": "official-personal-form-container.ts",
    "contract": {
      "authorityClass": "CipherFormContainer",
      "authoritySha256": "d6a7f77b321237c86ebcc70b4f28bbe09b40cd878f5d4df9341091441b664afe",
      "runtimeClass": "OfficialPersonalFormContainer",
      "enforceCompleteRuntimeMembers": true,
      "transforms": [
        {
          "authorityMember": "config",
          "runtimeMember": "config",
          "operations": [
            {
              "kind": "replace",
              "search": "\nreadonly config: CipherFormConfig;\n[[/member-skeleton]]\n[[end-member]]",
              "replacement": "\nreadonly config: RetainedOfficialPersonalCipherFormConfig;\n[[/member-skeleton]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "originalCipherView",
          "runtimeMember": "originalCipherView",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "registerChildForm",
          "runtimeMember": "registerChildForm",
          "operations": [
            {
              "kind": "replace",
              "search": "\nabstract registerChildForm<K extends keyof CipherForm>(name: K, group: Exclude<CipherForm[K], undefined>): void;\n[[/member-skeleton]]\n[[end-member]]",
              "replacement": "\nabstract registerChildForm<K extends keyof OfficialPersonalForm>(name: K, group: Exclude<OfficialPersonalForm[K], undefined>): void;\n[[/member-skeleton]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "website:get",
          "runtimeMember": "website:get",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "patchCipher",
          "runtimeMember": "patchCipher",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "getInitialCipherView",
          "runtimeMember": "getInitialCipherView",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "initializedWithCachedCipher",
          "runtimeMember": "initializedWithCachedCipher",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "disableFormFields",
          "runtimeMember": "disableFormFields",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "enableFormFields",
          "runtimeMember": "enableFormFields",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "formStatusChange$",
          "runtimeMember": "formStatusChange$",
          "operations": [
            {
              "kind": "replace",
              "search": "\nformStatusChange$: Observable<\"enabled\" | \"disabled\">;\n[[/member-skeleton]]\n[[end-member]]",
              "replacement": "\nreadonly formStatusChange$: Observable<\"enabled\" | \"disabled\">;\n[[/member-skeleton]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        }
      ],
      "runtimeOnlyMembers": [
        {
          "runtimeMember": "canViewSecrets",
          "justification": "Adds the retained native permission contract required by secret-bearing child sections.",
          "canonicalSha256": "321ec24ddf4faf6026623d584f9d1587908c1e08394308ef8f85602730109208"
        }
      ]
    }
  },
  {
    "authority": "libs/vault/src/cipher-form/components/item-details/item-details-section.component.ts",
    "runtime": "official-personal-item-details.component.ts",
    "contract": {
      "authorityClass": "ItemDetailsSectionComponent",
      "authoritySha256": "acc521629a3bef92da2c71e6c8314f1ba0dff25a4e89e4d673fd70a92ee88f1a",
      "runtimeClass": "OfficialPersonalItemDetailsComponent",
      "enforceCompleteRuntimeMembers": true,
      "transforms": [
        {
          "authorityMember": "itemDetailsForm",
          "runtimeMember": "itemDetailsForm",
          "operations": [
            {
              "kind": "replace",
              "search": "\nitemDetailsForm;\n[[/member-skeleton]]\n[[initializer]]\nthis.formBuilder.group({\n    name: [\"\", [Validators.required]],\n    organizationId: [null],\n    folderId: [null],\n    collectionIds: new FormControl([], [Validators.required]),\n    favorite: [false],\n})\n[[/initializer]]\n[[end-member]]",
              "replacement": "\nitemDetailsForm;\n[[/member-skeleton]]\n[[initializer]]\nthis.formBuilder.group({\n    name: [\"\", [Validators.required]],\n    folderId: [null],\n    favorite: [false],\n})\n[[/initializer]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "favoriteButtonDisabled",
          "runtimeMember": "favoriteButtonDisabled",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "config",
          "runtimeMember": "config",
          "operations": [
            {
              "kind": "replace",
              "search": "\n@Input({ required: true })\nconfig: CipherFormConfig;\n[[/member-skeleton]]\n[[end-member]]",
              "replacement": "\n@Input({ required: true })\nconfig: RetainedOfficialPersonalCipherFormConfig;\n[[/member-skeleton]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "originalCipherView",
          "runtimeMember": "originalCipherView",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "initialValues:get",
          "runtimeMember": "initialValues:get",
          "operations": [
            {
              "kind": "replace",
              "search": "\nget initialValues(): OptionalInitialValues | undefined {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nget initialValues() {\n}\n[[/member-skeleton]]\n"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "return this.config.initialValues;"
            }
          ]
        },
        {
          "authorityMember": "constructor",
          "runtimeMember": "constructor",
          "operations": [
            {
              "kind": "replace",
              "search": "\nconstructor(private cipherFormContainer: CipherFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService, private destroyRef: DestroyRef, private accountService: AccountService, private policyService: PolicyService, private platformUtilsService: PlatformUtilsService) {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nconstructor(private cipherFormContainer: OfficialPersonalFormContainer, private formBuilder: FormBuilder) {\n}\n[[/member-skeleton]]\n"
            },
            {
              "kind": "replace",
              "search": "\n[[statement:1]]\nthis.itemDetailsForm.valueChanges\n    .pipe(takeUntilDestroyed(), map(() => this.itemDetailsForm.getRawValue()))\n    .subscribe((value) => {\n    this.cipherFormContainer.patchCipher((cipher) => {\n        Object.assign(cipher, {\n            name: value.name,\n            organizationId: value.organizationId,\n            folderId: value.folderId,\n            collectionIds: [\n                ...(value.collectionIds?.map((c) => c.id) || []),\n                ...this.readOnlyCollections.map((c) => c.id),\n            ],\n            favorite: value.favorite,\n        } as CipherView);\n        return cipher;\n    });\n});\n[[/statement:1]]\n[[end-member]]",
              "replacement": "\n[[statement:1]]\nthis.itemDetailsForm.valueChanges\n    .pipe(takeUntilDestroyed(), map(() => this.itemDetailsForm.getRawValue()))\n    .subscribe((value) => {\n    this.cipherFormContainer.patchCipher((cipher) => {\n        cipher.name = value.name;\n        cipher.folderId = value.folderId;\n        cipher.favorite = value.favorite;\n        return cipher;\n    });\n});\n[[/statement:1]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.cipherFormContainer.registerChildForm(\"itemDetails\", this.itemDetailsForm);"
            }
          ]
        },
        {
          "authorityMember": "favoriteIcon:get",
          "runtimeMember": "favoriteIcon:get",
          "operations": [
            {
              "kind": "replace",
              "search": "\nget favoriteIcon() {\n}\n[[/member-skeleton]]\n[[statement:0]]\nreturn this.itemDetailsForm.controls.favorite.value ? \"bwi-star-f\" : \"bwi-star\";\n[[/statement:0]]\n[[end-member]]",
              "replacement": "\nget favoriteIcon(): string {\n}\n[[/member-skeleton]]\n[[statement:0]]\nreturn this.itemDetailsForm.controls.favorite.value\n    ? \"bwi-star-f\"\n    : \"bwi-star\";\n[[/statement:0]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "toggleFavorite",
          "runtimeMember": "toggleFavorite",
          "operations": [
            {
              "kind": "replace",
              "search": "\ntoggleFavorite() {\n}\n[[/member-skeleton]]\n",
              "replacement": "\ntoggleFavorite(): void {\n}\n[[/member-skeleton]]\n"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.itemDetailsForm.controls.favorite.setValue(!this.itemDetailsForm.controls.favorite.value);"
            }
          ]
        },
        {
          "authorityMember": "ngOnInit",
          "runtimeMember": "ngOnInit",
          "operations": [
            {
              "kind": "replace",
              "search": "\nasync ngOnInit() {\n}\n[[/member-skeleton]]\n[[statement:0]]\nthis.organizations = this.config.organizations.sort(Utils.getSortFunction(this.i18nService, \"name\"));\n[[/statement:0]]\n[[statement:1]]\nthis.userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));\n[[/statement:1]]\n[[statement:2]]\nconst prefillCipher = this.cipherFormContainer.getInitialCipherView();\n[[/statement:2]]\n[[statement:3]]\nif (prefillCipher) {\n    await this.initFromExistingCipher(prefillCipher);\n}\nelse {\n    const orgId = this.initialValues?.organizationId;\n    this.itemDetailsForm.setValue({\n        name: this.initialValues?.name || \"\",\n        organizationId: orgId || this.defaultOwner,\n        folderId: this.initialValues?.folderId || null,\n        collectionIds: [],\n        favorite: false,\n    });\n    await this.updateCollectionOptions(this.initialValues?.collectionIds ?? []);\n}\n[[/statement:3]]\n[[statement:4]]\nthis.setFormState();\n[[/statement:4]]\n[[statement:5]]\nthis.itemDetailsForm.controls.organizationId.valueChanges\n    .pipe(takeUntilDestroyed(this.destroyRef), distinctUntilChanged(), concatMap(async () => {\n    await this.updateCollectionOptions();\n    this.setFormState();\n}))\n    .subscribe();\n[[/statement:5]]\n[[end-member]]",
              "replacement": "\nasync ngOnInit(): Promise<void> {\n}\n[[/member-skeleton]]\n[[statement:0]]\nconst prefillCipher = this.cipherFormContainer.getInitialCipherView();\n[[/statement:0]]\n[[statement:1]]\nthis.itemDetailsForm.setValue({\n    name: prefillCipher?.name || this.initialValues?.name || \"\",\n    folderId: prefillCipher?.folderId || this.initialValues?.folderId || null,\n    favorite: prefillCipher?.favorite ?? false,\n});\n[[/statement:1]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        }
      ]
    }
  },
  {
    "authority": "libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.ts",
    "runtime": "official-card-details-section.component.ts",
    "contract": {
      "authorityClass": "CardDetailsSectionComponent",
      "authoritySha256": "4f93d71ede1a090474b83faf65c15152b3d62b931915e4e6e8076f98eecced7f",
      "runtimeClass": "OfficialCardDetailsSectionComponent",
      "enforceCompleteRuntimeMembers": true,
      "transforms": [
        {
          "authorityMember": "originalCipherView",
          "runtimeMember": "originalCipherView",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "disabled",
          "runtimeMember": "disabled",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "cardDetailsForm",
          "runtimeMember": "cardDetailsForm",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "cardBrands",
          "runtimeMember": "cardBrands",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "expirationMonths",
          "runtimeMember": "expirationMonths",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "initialValues:get",
          "runtimeMember": "initialValues:get",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "constructor",
          "runtimeMember": "constructor",
          "operations": [
            {
              "kind": "replace",
              "search": "\nconstructor(private cipherFormContainer: CipherFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService, private eventCollectionService: EventCollectionService) {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nconstructor(private cipherFormContainer: OfficialPersonalFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService) {\n}\n[[/member-skeleton]]\n"
            },
            {
              "kind": "replace",
              "search": "\n[[statement:1]]\nthis.cardDetailsForm.valueChanges\n    .pipe(takeUntilDestroyed())\n    .subscribe(({ cardholderName, number, brand, expMonth, expYear, code }) => {\n    this.cipherFormContainer.patchCipher((cipher) => {\n        const expirationYear = normalizeExpiryYearFormat(expYear) ?? \"\";\n        cipher.card.cardholderName = cardholderName;\n        cipher.card.number = number;\n        cipher.card.brand = brand;\n        cipher.card.expMonth = expMonth;\n        cipher.card.expYear = expirationYear;\n        cipher.card.code = code;\n        return cipher;\n    });\n});\n[[/statement:1]]\n[[statement:2]]\nthis.cardDetailsForm.controls.number.valueChanges\n    .pipe(takeUntilDestroyed())\n    .subscribe((number) => {\n    const brand = CardView.getCardBrandByPatterns(number);\n    if (brand) {\n        this.cardDetailsForm.controls.brand.setValue(brand);\n    }\n});\n[[/statement:2]]\n[[end-member]]",
              "replacement": "\n[[statement:1]]\nthis.cardDetailsForm.valueChanges\n    .pipe(takeUntilDestroyed())\n    .subscribe(({ cardholderName, number, brand, expMonth, expYear, code }) => {\n    this.cipherFormContainer.patchCipher((cipher) => {\n        cipher.card.cardholderName = cardholderName;\n        cipher.card.number = number;\n        cipher.card.brand = brand;\n        cipher.card.expMonth = expMonth ? expMonth.padStart(2, \"0\") : \"\";\n        cipher.card.expYear = normalizeExpiryYearFormat(expYear) ?? \"\";\n        cipher.card.code = code;\n        return cipher;\n    });\n});\n[[/statement:1]]\n[[statement:2]]\nthis.cardDetailsForm.controls.number.valueChanges\n    .pipe(takeUntilDestroyed())\n    .subscribe((number) => {\n    const brand = CardView.getCardBrandByPatterns(number?.replace(/[\\s-]/g, \"\"));\n    if (brand)\n        this.cardDetailsForm.controls.brand.setValue(brand);\n});\n[[/statement:2]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.cipherFormContainer.registerChildForm(\"cardDetails\", this.cardDetailsForm);"
            }
          ]
        },
        {
          "authorityMember": "ngOnInit",
          "runtimeMember": "ngOnInit",
          "operations": [
            {
              "kind": "replace",
              "search": "\nngOnInit() {\n}\n[[/member-skeleton]]\n[[statement:0]]\nconst prefillCipher = this.cipherFormContainer.getInitialCipherView();\n[[/statement:0]]\n[[statement:1]]\nif (prefillCipher) {\n    this.initFromExistingCipher(prefillCipher.card);\n}\nelse {\n    this.initNewCipher();\n}\n[[/statement:1]]\n[[statement:2]]\nif (this.disabled) {\n    this.cardDetailsForm.disable();\n}\n[[/statement:2]]\n[[end-member]]",
              "replacement": "\nngOnInit(): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nconst card = this.cipherFormContainer.getInitialCipherView()?.card;\n[[/statement:0]]\n[[statement:1]]\nthis.cardDetailsForm.patchValue({\n    cardholderName: this.initialValues?.cardholderName ?? card?.cardholderName ?? \"\",\n    number: this.canViewSecrets\n        ? (this.initialValues?.number ?? card?.number ?? \"\")\n        : \"\",\n    brand: this.initialValues?.brand ?? card?.brand ?? \"\",\n    expMonth: this.normalizeExpirationMonth(this.initialValues?.expMonth ?? card?.expMonth ?? \"\"),\n    expYear: this.initialValues?.expYear ?? card?.expYear ?? \"\",\n    code: this.canViewSecrets\n        ? (this.initialValues?.code ?? card?.code ?? \"\")\n        : \"\",\n});\n[[/statement:1]]\n[[statement:2]]\nif (this.disabled)\n    this.cardDetailsForm.disable();\n[[/statement:2]]\n[[statement:3]]\nif (!this.canViewSecrets) {\n    this.cardDetailsForm.controls.number.disable();\n    this.cardDetailsForm.controls.code.disable();\n}\n[[/statement:3]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "getSectionHeading",
          "runtimeMember": "getSectionHeading",
          "operations": [
            {
              "kind": "replace",
              "search": "\n[[statement:1]]\nif (brand && brand !== \"Other\") {\n    return this.i18nService.t(\"cardBrandDetails\", brand);\n}\n[[/statement:1]]\n[[statement:2]]\nreturn this.i18nService.t(\"cardDetails\");\n[[/statement:2]]\n[[end-member]]",
              "replacement": "\n[[statement:1]]\nreturn brand && brand !== \"Other\"\n    ? this.i18nService.t(\"cardBrandDetails\", brand)\n    : this.i18nService.t(\"cardDetails\");\n[[/statement:1]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "const { brand } = this.cardDetailsForm.value;"
            }
          ]
        }
      ],
      "runtimeOnlyMembers": [
        {
          "runtimeMember": "canViewSecrets:get",
          "justification": "Reads the retained native permission contract for Card secret controls.",
          "canonicalSha256": "cfee798323b6dcbe9bdf7ee5fcddf4f67843bc409be1fdb0e21c1b212b3f93be"
        },
        {
          "runtimeMember": "normalizeExpirationMonth",
          "justification": "Maps canonical zero-padded Card months onto official select option values.",
          "canonicalSha256": "34f6cae0855531491cc83785cd0bba02ee9c4a33c988ec04834520e750da05ff"
        }
      ]
    }
  },
  {
    "authority": "libs/vault/src/cipher-form/components/identity/identity.component.ts",
    "runtime": "official-identity-section.component.ts",
    "contract": {
      "authorityClass": "IdentitySectionComponent",
      "authoritySha256": "ce8f12cd3bde0a5f406ee8620cc2ce80c114adb26fa6caa4e447205a1cc235a0",
      "runtimeClass": "OfficialIdentitySectionComponent",
      "enforceCompleteRuntimeMembers": true,
      "transforms": [
        {
          "authorityMember": "originalCipherView",
          "runtimeMember": "originalCipherView",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "disabled",
          "runtimeMember": "disabled",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "identityTitleOptions",
          "runtimeMember": "identityTitleOptions",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "identityForm",
          "runtimeMember": "identityForm",
          "operations": [
            {
              "kind": "replace",
              "search": "\nprotected identityForm;\n[[/member-skeleton]]\n[[initializer]]\nthis.formBuilder.group({\n    title: [null],\n    firstName: [\"\"],\n    middleName: [\"\"],\n    lastName: [\"\"],\n    username: [\"\"],\n    company: [\"\"],\n    ssn: [\"\"],\n    passportNumber: [\"\"],\n    licenseNumber: [\"\"],\n    email: [\"\"],\n    phone: [\"\"],\n    address1: [\"\"],\n    address2: [\"\"],\n    address3: [\"\"],\n    city: [\"\"],\n    state: [\"\"],\n    postalCode: [\"\"],\n    country: [\"\"],\n})\n[[/initializer]]\n[[end-member]]",
              "replacement": "\nprotected identityForm;\n[[/member-skeleton]]\n[[initializer]]\nthis.formBuilder.group({\n    title: [null as string],\n    firstName: [\"\"],\n    middleName: [\"\"],\n    lastName: [\"\"],\n    username: [\"\"],\n    company: [\"\"],\n    ssn: [\"\"],\n    passportNumber: [\"\"],\n    licenseNumber: [\"\"],\n    email: [\"\"],\n    phone: [\"\"],\n    address1: [\"\"],\n    address2: [\"\"],\n    address3: [\"\"],\n    city: [\"\"],\n    state: [\"\"],\n    postalCode: [\"\"],\n    country: [\"\"],\n})\n[[/initializer]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "initialValues:get",
          "runtimeMember": "initialValues:get",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "constructor",
          "runtimeMember": "constructor",
          "operations": [
            {
              "kind": "replace",
              "search": "\nconstructor(private cipherFormContainer: CipherFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService) {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nconstructor(private cipherFormContainer: OfficialPersonalFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService) {\n}\n[[/member-skeleton]]\n"
            },
            {
              "kind": "replace",
              "search": "\n[[statement:1]]\nthis.identityForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {\n    const data = new IdentityView();\n    data.title = value.title;\n    data.firstName = value.firstName;\n    data.middleName = value.middleName;\n    data.lastName = value.lastName;\n    data.username = value.username;\n    data.company = value.company;\n    data.ssn = value.ssn;\n    data.passportNumber = value.passportNumber;\n    data.licenseNumber = value.licenseNumber;\n    data.email = value.email;\n    data.phone = value.phone;\n    data.address1 = value.address1;\n    data.address2 = value.address2;\n    data.address3 = value.address3;\n    data.city = value.city;\n    data.state = value.state;\n    data.postalCode = value.postalCode;\n    data.country = value.country;\n    this.cipherFormContainer.patchCipher((cipher) => {\n        cipher.identity = data;\n        return cipher;\n    });\n});\n[[/statement:1]]\n[[end-member]]",
              "replacement": "\n[[statement:1]]\nthis.identityForm.valueChanges\n    .pipe(takeUntilDestroyed())\n    .subscribe((value) => {\n    const data = new IdentityView();\n    Object.assign(data, value);\n    data.title = this.canonicalTitle(value.title);\n    this.cipherFormContainer.patchCipher((cipher) => {\n        cipher.identity = data;\n        return cipher;\n    });\n});\n[[/statement:1]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.cipherFormContainer.registerChildForm(\"identityDetails\", this.identityForm);"
            }
          ]
        },
        {
          "authorityMember": "ngOnInit",
          "runtimeMember": "ngOnInit",
          "operations": [
            {
              "kind": "replace",
              "search": "\nngOnInit() {\n}\n[[/member-skeleton]]\n[[statement:0]]\nif (this.disabled) {\n    this.identityForm.disable();\n}\n[[/statement:0]]\n[[statement:1]]\nconst prefillCipher = this.cipherFormContainer.getInitialCipherView();\n[[/statement:1]]\n[[statement:2]]\nif (prefillCipher) {\n    this.initFromExistingCipher(prefillCipher.identity);\n    this.populateFormData(prefillCipher);\n}\nelse {\n    this.initNewCipher();\n    this.identityForm.patchValue({\n        username: this.cipherFormContainer.config.initialValues?.username || \"\",\n    });\n}\n[[/statement:2]]\n[[end-member]]",
              "replacement": "\nngOnInit(): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nconst identity = this.cipherFormContainer.getInitialCipherView()?.identity;\n[[/statement:0]]\n[[statement:1]]\nthis.identityForm.patchValue({\n    title: this.localizedTitle(this.initialValues?.title ?? identity?.title ?? null),\n    firstName: this.initialValues?.firstName ?? identity?.firstName ?? \"\",\n    middleName: this.initialValues?.middleName ?? identity?.middleName ?? \"\",\n    lastName: this.initialValues?.lastName ?? identity?.lastName ?? \"\",\n    username: this.initialValues?.username ?? identity?.username ?? \"\",\n    company: this.initialValues?.company ?? identity?.company ?? \"\",\n    ssn: this.canViewSecrets\n        ? (this.initialValues?.ssn ?? identity?.ssn ?? \"\")\n        : \"\",\n    passportNumber: this.canViewSecrets\n        ? (this.initialValues?.passportNumber ?? identity?.passportNumber ?? \"\")\n        : \"\",\n    licenseNumber: this.initialValues?.licenseNumber ?? identity?.licenseNumber ?? \"\",\n    email: this.initialValues?.email ?? identity?.email ?? \"\",\n    phone: this.initialValues?.phone ?? identity?.phone ?? \"\",\n    address1: this.initialValues?.address1 ?? identity?.address1 ?? \"\",\n    address2: this.initialValues?.address2 ?? identity?.address2 ?? \"\",\n    address3: this.initialValues?.address3 ?? identity?.address3 ?? \"\",\n    city: this.initialValues?.city ?? identity?.city ?? \"\",\n    state: this.initialValues?.state ?? identity?.state ?? \"\",\n    postalCode: this.initialValues?.postalCode ?? identity?.postalCode ?? \"\",\n    country: this.initialValues?.country ?? identity?.country ?? \"\",\n});\n[[/statement:1]]\n[[statement:2]]\nif (this.disabled)\n    this.identityForm.disable();\n[[/statement:2]]\n[[statement:3]]\nif (!this.canViewSecrets) {\n    this.identityForm.controls.ssn.disable();\n    this.identityForm.controls.passportNumber.disable();\n}\n[[/statement:3]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        }
      ],
      "runtimeOnlyMembers": [
        {
          "runtimeMember": "canViewSecrets:get",
          "justification": "Reads the retained native permission contract for Identity secret controls.",
          "canonicalSha256": "cfee798323b6dcbe9bdf7ee5fcddf4f67843bc409be1fdb0e21c1b212b3f93be"
        },
        {
          "runtimeMember": "localizedTitle",
          "justification": "Maps canonical Identity titles onto exact pinned localized select option values.",
          "canonicalSha256": "caf6371c99a54662833c5d8096dc2a041674f69b20b563a522fa648d47d8d067"
        },
        {
          "runtimeMember": "canonicalTitle",
          "justification": "Maps localized Identity select values back to canonical Task 3 draft values.",
          "canonicalSha256": "5b829fa92a3226cf6fa6f09faed8a65d2a55b01b615edcf6dd6a7514d0d052eb"
        }
      ]
    }
  },
  {
    "authority": "libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.ts",
    "runtime": "official-personal-additional-options.component.ts",
    "contract": {
      "authorityClass": "AdditionalOptionsSectionComponent",
      "authoritySha256": "4a2c8f34f00349fc7da6702620090134a034825b7855f2d5899876abfc87d06f",
      "runtimeClass": "OfficialPersonalAdditionalOptionsComponent",
      "enforceCompleteRuntimeMembers": true,
      "transforms": [
        {
          "authorityMember": "customFieldsComponent",
          "runtimeMember": "customFieldsComponent",
          "operations": [
            {
              "kind": "replace",
              "search": "\n@ViewChild(CustomFieldsComponent)\ncustomFieldsComponent: CustomFieldsComponent;\n[[/member-skeleton]]\n[[end-member]]",
              "replacement": "\n@ViewChild(OfficialPersonalCustomFieldsComponent)\ncustomFieldsComponent: OfficialPersonalCustomFieldsComponent;\n[[/member-skeleton]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "additionalOptionsForm",
          "runtimeMember": "additionalOptionsForm",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "passwordRepromptEnabled$",
          "runtimeMember": "passwordRepromptEnabled$",
          "operations": [
            {
              "kind": "replace",
              "search": "\npasswordRepromptEnabled$;\n[[/member-skeleton]]\n[[initializer]]\nthis.passwordRepromptService.enabled$.pipe(shareReplay({ refCount: false, bufferSize: 1 }))\n[[/initializer]]\n[[end-member]]",
              "replacement": "\npasswordRepromptEnabled$;\n[[/member-skeleton]]\n[[initializer]]\nof(true)\n[[/initializer]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "hasCustomFields",
          "runtimeMember": "hasCustomFields",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "isPartialEdit",
          "runtimeMember": "isPartialEdit",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "disableSectionMargin",
          "runtimeMember": "disableSectionMargin",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "allowNewField:get",
          "runtimeMember": "allowNewField:get",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "constructor",
          "runtimeMember": "constructor",
          "operations": [
            {
              "kind": "replace",
              "search": "\nconstructor(private cipherFormContainer: CipherFormContainer, private formBuilder: FormBuilder, private passwordRepromptService: PasswordRepromptService, private changeDetectorRef: ChangeDetectorRef) {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nconstructor(private cipherFormContainer: OfficialPersonalFormContainer, private formBuilder: FormBuilder, private changeDetectorRef: ChangeDetectorRef) {\n}\n[[/member-skeleton]]\n"
            },
            {
              "kind": "replace",
              "search": "\n[[statement:1]]\nthis.additionalOptionsForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {\n    this.cipherFormContainer.patchCipher((cipher) => {\n        cipher.notes = value.notes;\n        cipher.reprompt = value.reprompt ? CipherRepromptType.Password : CipherRepromptType.None;\n        return cipher;\n    });\n});\n[[/statement:1]]\n[[end-member]]",
              "replacement": "\n[[statement:1]]\nthis.additionalOptionsForm.valueChanges\n    .pipe(takeUntilDestroyed(), map(() => this.additionalOptionsForm.getRawValue()))\n    .subscribe((value) => {\n    this.cipherFormContainer.patchCipher((cipher) => {\n        cipher.notes = value.notes;\n        cipher.reprompt = value.reprompt\n            ? CipherRepromptType.Password\n            : CipherRepromptType.None;\n        return cipher;\n    });\n});\n[[/statement:1]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.cipherFormContainer.registerChildForm(\"additionalOptions\", this.additionalOptionsForm);"
            }
          ]
        },
        {
          "authorityMember": "ngOnInit",
          "runtimeMember": "ngOnInit",
          "operations": [
            {
              "kind": "replace",
              "search": "\nngOnInit() {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nngOnInit(): void {\n}\n[[/member-skeleton]]\n"
            },
            {
              "kind": "replace",
              "search": "\n[[statement:1]]\nif (prefillCipher) {\n    this.additionalOptionsForm.patchValue({\n        notes: prefillCipher.notes,\n        reprompt: prefillCipher.reprompt === CipherRepromptType.Password,\n    });\n}\n[[/statement:1]]\n[[statement:2]]\nif (this.cipherFormContainer.config.mode === \"partial-edit\") {\n    this.additionalOptionsForm.disable();\n    this.isPartialEdit = true;\n}\n[[/statement:2]]\n[[end-member]]",
              "replacement": "\n[[statement:1]]\nif (prefillCipher) {\n    this.additionalOptionsForm.patchValue({\n        notes: prefillCipher.notes,\n        reprompt: prefillCipher.reprompt === CipherRepromptType.Password,\n    });\n}\n[[/statement:1]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "const prefillCipher = this.cipherFormContainer.getInitialCipherView();"
            }
          ]
        },
        {
          "authorityMember": "addCustomField",
          "runtimeMember": "addCustomField",
          "operations": [
            {
              "kind": "replace",
              "search": "\naddCustomField() {\n}\n[[/member-skeleton]]\n",
              "replacement": "\naddCustomField(): void {\n}\n[[/member-skeleton]]\n"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.customFieldsComponent.openAddEditCustomFieldDialog();"
            }
          ]
        },
        {
          "authorityMember": "handleCustomFieldChange",
          "runtimeMember": "handleCustomFieldChange",
          "operations": [
            {
              "kind": "replace",
              "search": "\nhandleCustomFieldChange(numberOfCustomFields: number) {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nhandleCustomFieldChange(numberOfCustomFields: number): void {\n}\n[[/member-skeleton]]\n"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.hasCustomFields = numberOfCustomFields > 0;"
            }
          ]
        }
      ]
    }
  },
  {
    "authority": "libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.ts",
    "runtime": "official-personal-custom-fields.component.ts",
    "contract": {
      "authorityClass": "CustomFieldsComponent",
      "authoritySha256": "950793d4f897d21efaa81ede2c6bdaf1ee37bd1f99b1654c5092609f9ec8482c",
      "runtimeClass": "OfficialPersonalCustomFieldsComponent",
      "enforceCompleteRuntimeMembers": true,
      "transforms": [
        {
          "authorityMember": "numberOfFieldsChange",
          "runtimeMember": "numberOfFieldsChange",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "customFieldRows",
          "runtimeMember": "customFieldRows",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "disableSectionMargin",
          "runtimeMember": "disableSectionMargin",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "customFieldsForm",
          "runtimeMember": "customFieldsForm",
          "operations": [
            {
              "kind": "replace",
              "search": "\ncustomFieldsForm;\n[[/member-skeleton]]\n[[initializer]]\nthis.formBuilder.group({\n    fields: new FormArray([]),\n})\n[[/initializer]]\n[[end-member]]",
              "replacement": "\ncustomFieldsForm;\n[[/member-skeleton]]\n[[initializer]]\nthis.formBuilder.group({ fields: new FormArray([]) })\n[[/initializer]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "dialogRef",
          "runtimeMember": "dialogRef",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "linkedFieldOptions",
          "runtimeMember": "linkedFieldOptions",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "isPartialEdit",
          "runtimeMember": "isPartialEdit",
          "operations": [
            {
              "kind": "replace",
              "search": "\nisPartialEdit: boolean;\n[[/member-skeleton]]\n[[end-member]]",
              "replacement": "\nisPartialEdit;\n[[/member-skeleton]]\n[[initializer]]\nfalse\n[[/initializer]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "hasCustomFields",
          "runtimeMember": "hasCustomFields",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "focusOnNewInput$",
          "runtimeMember": "focusOnNewInput$",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "parentFormDisabled",
          "runtimeMember": "parentFormDisabled",
          "operations": [
            {
              "kind": "replace",
              "search": "\nprotected parentFormDisabled: boolean;\n[[/member-skeleton]]\n[[initializer]]\nfalse\n[[/initializer]]\n[[end-member]]",
              "replacement": "\nprotected parentFormDisabled;\n[[/member-skeleton]]\n[[initializer]]\nfalse\n[[/initializer]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "destroyed$",
          "runtimeMember": "destroyed$",
          "operations": [
            {
              "kind": "replace",
              "search": "\ndestroyed$: DestroyRef;\n[[/member-skeleton]]\n[[end-member]]",
              "replacement": "\ndestroyed$;\n[[/member-skeleton]]\n[[initializer]]\ninject(DestroyRef)\n[[/initializer]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "FieldType",
          "runtimeMember": "FieldType",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "constructor",
          "runtimeMember": "constructor",
          "operations": [
            {
              "kind": "replace",
              "search": "\nconstructor(private dialogService: DialogService, private cipherFormContainer: CipherFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService, private liveAnnouncer: LiveAnnouncer, private eventCollectionService: EventCollectionService) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nthis.destroyed$ = inject(DestroyRef);\n[[/statement:0]]\n[[statement:1]]\nthis.cipherFormContainer.registerChildForm(\"customFields\", this.customFieldsForm);\n[[/statement:1]]\n[[statement:2]]\nthis.customFieldsForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {\n    this.updateCipher(this.fields.getRawValue());\n});\n[[/statement:2]]\n[[statement:3]]\nthis.cipherFormContainer.formStatusChange$.pipe(takeUntilDestroyed()).subscribe((status) => {\n    this.parentFormDisabled = status === \"disabled\";\n});\n[[/statement:3]]\n[[end-member]]",
              "replacement": "\nconstructor(private dialogService: DialogService, private cipherFormContainer: OfficialPersonalFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService, private liveAnnouncer: LiveAnnouncer) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nthis.cipherFormContainer.registerChildForm(\"customFields\", this.customFieldsForm);\n[[/statement:0]]\n[[statement:1]]\nthis.customFieldsForm.valueChanges\n    .pipe(takeUntilDestroyed())\n    .subscribe(() => {\n    this.updateCipher(this.fields.getRawValue());\n});\n[[/statement:1]]\n[[statement:2]]\nthis.cipherFormContainer.formStatusChange$\n    .pipe(takeUntilDestroyed())\n    .subscribe((status) => {\n    this.parentFormDisabled = status === \"disabled\";\n    if (status === \"enabled\" && !this.cipherFormContainer.canViewSecrets) {\n        this.fields.controls.forEach((field) => {\n            const value = field.getRawValue() as PersonalCustomField;\n            if (value.type === FieldType.Hidden && !value.newField) {\n                field.get(\"value\")?.disable({ emitEvent: false });\n            }\n        });\n    }\n});\n[[/statement:2]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "fields:get",
          "runtimeMember": "fields:get",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "canEdit",
          "runtimeMember": "canEdit",
          "operations": [
            {
              "kind": "replace",
              "search": "\ncanEdit(type: FieldType): boolean {\n}\n[[/member-skeleton]]\n[[statement:0]]\nreturn (!this.isPartialEdit &&\n    (type !== FieldType.Hidden ||\n        this.cipherFormContainer.originalCipherView === null ||\n        this.cipherFormContainer.originalCipherView.viewPassword));\n[[/statement:0]]\n[[end-member]]",
              "replacement": "\ncanEdit(type: FieldType): boolean {\n}\n[[/member-skeleton]]\n[[statement:0]]\nreturn (!this.isPartialEdit &&\n    (type !== FieldType.Hidden ||\n        this.cipherFormContainer.originalCipherView === null ||\n        this.cipherFormContainer.canViewSecrets));\n[[/statement:0]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "dragDisabled",
          "runtimeMember": "dragDisabled",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "ngOnInit",
          "runtimeMember": "ngOnInit",
          "operations": [
            {
              "kind": "replace",
              "search": "\nngOnInit() {\n}\n[[/member-skeleton]]\n[[statement:0]]\nconst linkedFieldsOptionsForCipher = this.getLinkedFieldsOptionsForCipher();\n[[/statement:0]]\n[[statement:1]]\nconst optionsArray = Array.from(linkedFieldsOptionsForCipher?.entries() ?? []);\n[[/statement:1]]\n[[statement:2]]\noptionsArray.sort((a, b) => a[1].sortPosition - b[1].sortPosition);\n[[/statement:2]]\n[[statement:3]]\nthis.linkedFieldOptions = optionsArray.map(([id, linkedFieldOption]) => ({\n    name: this.i18nService.t(linkedFieldOption.i18nKey),\n    value: id as LinkedIdType,\n}));\n[[/statement:3]]\n[[statement:4]]\nconst prefillCipher = this.cipherFormContainer.getInitialCipherView();\n[[/statement:4]]\n[[statement:5]]\nprefillCipher?.fields?.forEach((field) => {\n    let value: string | boolean = field.value;\n    if (field.type === FieldType.Boolean) {\n        value = field.value === \"true\" ? true : false;\n    }\n    const customField = this.formBuilder.group<CustomField>({\n        type: field.type,\n        name: field.name,\n        value: value,\n        linkedId: field.linkedId,\n        newField: false,\n    });\n    if (field.type === FieldType.Hidden &&\n        !this.cipherFormContainer.originalCipherView?.viewPassword) {\n        customField.controls.value.disable();\n    }\n    this.fields.push(customField);\n});\n[[/statement:5]]\n[[statement:6]]\nif (this.cipherFormContainer.config.mode === \"partial-edit\") {\n    this.isPartialEdit = true;\n    this.customFieldsForm.disable();\n}\n[[/statement:6]]\n[[end-member]]",
              "replacement": "\nngOnInit(): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nconst options = Array.from(this.getLinkedFieldsOptionsForCipher()?.entries() ?? []);\n[[/statement:0]]\n[[statement:1]]\noptions.sort((a, b) => a[1].sortPosition - b[1].sortPosition);\n[[/statement:1]]\n[[statement:2]]\nthis.linkedFieldOptions = options.map(([id, option]) => ({\n    name: this.i18nService.t(option.i18nKey),\n    value: id as LinkedIdType,\n}));\n[[/statement:2]]\n[[statement:3]]\nthis.cipherFormContainer\n    .getInitialCipherView()\n    ?.fields?.forEach((field) => {\n    let value: string | boolean = field.value;\n    if (field.type === FieldType.Boolean) {\n        value = field.value === \"true\";\n    }\n    else if (field.type === FieldType.Hidden &&\n        !this.cipherFormContainer.canViewSecrets) {\n        value = \"\";\n    }\n    const customField = this.formBuilder.group<PersonalCustomField>({\n        type: field.type,\n        name: field.name,\n        value,\n        linkedId: field.linkedId,\n        newField: false,\n    });\n    if (field.type === FieldType.Hidden &&\n        !this.cipherFormContainer.canViewSecrets) {\n        customField.controls.value.disable();\n    }\n    this.fields.push(customField);\n});\n[[/statement:3]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "ngAfterViewInit",
          "runtimeMember": "ngAfterViewInit",
          "operations": [
            {
              "kind": "replace",
              "search": "\nngAfterViewInit(): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nzip(this.focusOnNewInput$, this.customFieldRows.changes)\n    .pipe(takeUntilDestroyed(this.destroyed$))\n    .subscribe(() => {\n    const mostRecentRow = this.customFieldRows.last.nativeElement;\n    const input = mostRecentRow.querySelector<HTMLInputElement>(\"input\");\n    const label = mostRecentRow.querySelector<HTMLLabelElement>(\"label\").textContent.trim();\n    void this.liveAnnouncer\n        .announce(this.i18nService.t(\"fieldAdded\", label), \"polite\")\n        .then(() => {\n        input.focus();\n    });\n});\n[[/statement:0]]\n[[end-member]]",
              "replacement": "\nngAfterViewInit(): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nzip(this.focusOnNewInput$, this.customFieldRows.changes)\n    .pipe(takeUntilDestroyed(this.destroyed$))\n    .subscribe(() => {\n    const row = this.customFieldRows.last.nativeElement;\n    const input = row.querySelector<HTMLInputElement>(\"input\");\n    const label = row.querySelector<HTMLLabelElement>(\"label\")?.textContent?.trim() ??\n        \"\";\n    void this.liveAnnouncer\n        .announce(this.i18nService.t(\"fieldAdded\", label), \"polite\")\n        .then(() => input?.focus());\n});\n[[/statement:0]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "openAddEditCustomFieldDialog",
          "runtimeMember": "openAddEditCustomFieldDialog",
          "operations": [
            {
              "kind": "replace",
              "search": "\nopenAddEditCustomFieldDialog(editLabelConfig?: AddEditCustomFieldDialogData[\"editLabelConfig\"]) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nconst { cipherType, mode, originalCipher } = this.cipherFormContainer.config;\n[[/statement:0]]\n[[statement:1]]\nthis.dialogRef = this.dialogService.open<unknown, AddEditCustomFieldDialogData>(AddEditCustomFieldDialogComponent, {\n    data: {\n        addField: this.addField.bind(this),\n        updateLabel: this.updateLabel.bind(this),\n        removeField: this.removeField.bind(this),\n        cipherType,\n        editLabelConfig,\n        disallowHiddenField: mode === \"edit\" && !originalCipher.viewPassword,\n    },\n});\n[[/statement:1]]\n[[end-member]]",
              "replacement": "\nopenAddEditCustomFieldDialog(editLabelConfig?: PersonalAddEditCustomFieldDialogData[\"editLabelConfig\"]): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nconst { mode, cipherType } = this.cipherFormContainer.config;\n[[/statement:0]]\n[[statement:1]]\nthis.dialogRef = this.dialogService.open<unknown, PersonalAddEditCustomFieldDialogData>(OfficialPersonalAddEditCustomFieldDialogComponent, {\n    data: {\n        addField: this.addField.bind(this),\n        updateLabel: this.updateLabel.bind(this),\n        removeField: this.removeField.bind(this),\n        cipherType: cipherType as PersonalAddEditCustomFieldDialogData[\"cipherType\"],\n        editLabelConfig,\n        disallowHiddenField: mode === \"edit\" && !this.cipherFormContainer.canViewSecrets,\n    },\n});\n[[/statement:1]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "canViewPasswords",
          "runtimeMember": "canViewPasswords",
          "operations": [
            {
              "kind": "replace",
              "search": "\ncanViewPasswords(index: number) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nif (this.cipherFormContainer.originalCipherView === null) {\n    return true;\n}\n[[/statement:0]]\n[[statement:1]]\nreturn (this.cipherFormContainer.originalCipherView.viewPassword ||\n    this.fields.at(index).value.newField);\n[[/statement:1]]\n[[end-member]]",
              "replacement": "\ncanViewPasswords(index: number): boolean {\n}\n[[/member-skeleton]]\n[[statement:0]]\nreturn (this.cipherFormContainer.canViewSecrets ||\n    this.fields.at(index).value.newField);\n[[/statement:0]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "updateLabel",
          "runtimeMember": "updateLabel",
          "operations": [
            {
              "kind": "replace",
              "search": "\nupdateLabel(index: number, label: string) {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nupdateLabel(index: number, label: string): void {\n}\n[[/member-skeleton]]\n"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.fields.at(index).patchValue({ name: label });"
            }
          ]
        },
        {
          "authorityMember": "removeField",
          "runtimeMember": "removeField",
          "operations": [
            {
              "kind": "replace",
              "search": "\nremoveField(index: number) {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nremoveField(index: number): void {\n}\n[[/member-skeleton]]\n"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.fields.removeAt(index);"
            }
          ]
        },
        {
          "authorityMember": "addField",
          "runtimeMember": "addField",
          "operations": [
            {
              "kind": "replace",
              "search": "\naddField(type: FieldType, label: string) {\n}\n[[/member-skeleton]]\n",
              "replacement": "\naddField(type: FieldType, label: string): void {\n}\n[[/member-skeleton]]\n"
            },
            {
              "kind": "replace",
              "search": "\n[[statement:1]]\nlet value = null;\n[[/statement:1]]\n[[statement:2]]\nlet linkedId = null;\n[[/statement:2]]\n[[statement:3]]\nif (type === FieldType.Boolean) {\n    value = false;\n}\n[[/statement:3]]\n[[statement:4]]\nif (type === FieldType.Linked && this.linkedFieldOptions.length > 0) {\n    linkedId = this.linkedFieldOptions[0].value;\n}\n[[/statement:4]]\n[[statement:5]]\nthis.fields.push(this.formBuilder.group<CustomField>({\n    type,\n    name: label,\n    value,\n    linkedId,\n    newField: true,\n}));\n[[/statement:5]]\n[[statement:6]]\nthis.focusOnNewInput$.next();\n[[/statement:6]]\n[[end-member]]",
              "replacement": "\n[[statement:1]]\nlet value: string | boolean | null = null;\n[[/statement:1]]\n[[statement:2]]\nlet linkedId: LinkedIdType = null;\n[[/statement:2]]\n[[statement:3]]\nif (type === FieldType.Boolean)\n    value = false;\n[[/statement:3]]\n[[statement:4]]\nif (type === FieldType.Linked) {\n    if (this.linkedFieldOptions.length === 0) {\n        throw new TypeError(\"Linked fields are unavailable for this cipher type\");\n    }\n    linkedId = this.linkedFieldOptions[0].value;\n}\n[[/statement:4]]\n[[statement:5]]\nthis.fields.push(this.formBuilder.group<PersonalCustomField>({\n    type,\n    name: label,\n    value,\n    linkedId,\n    newField: true,\n}));\n[[/statement:5]]\n[[statement:6]]\nthis.focusOnNewInput$.next();\n[[/statement:6]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "void this.dialogRef?.close();"
            }
          ]
        },
        {
          "authorityMember": "drop",
          "runtimeMember": "drop",
          "operations": [
            {
              "kind": "replace",
              "search": "\ndrop(event: CdkDragDrop<HTMLDivElement>) {\n}\n[[/member-skeleton]]\n",
              "replacement": "\ndrop(event: CdkDragDrop<HTMLDivElement>): void {\n}\n[[/member-skeleton]]\n"
            },
            {
              "kind": "replace",
              "search": "\n[[statement:1]]\nthis.updateCipher(this.fields.controls.map((control) => control.value));\n[[/statement:1]]\n[[end-member]]",
              "replacement": "\n[[statement:1]]\nthis.updateCipher(this.fields.controls.map((control) => control.getRawValue()));\n[[/statement:1]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "moveItemInArray(this.fields.controls, event.previousIndex, event.currentIndex);"
            }
          ]
        },
        {
          "authorityMember": "handleKeyDown",
          "runtimeMember": "handleKeyDown",
          "operations": [
            {
              "kind": "replace",
              "search": "\nasync handleKeyDown(event: KeyboardEvent, label: string, index: number) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nif (event.key === \"ArrowUp\" && index !== 0) {\n    event.preventDefault();\n    const currentIndex = index - 1;\n    this.drop({ previousIndex: index, currentIndex } as CdkDragDrop<HTMLDivElement>);\n    await this.liveAnnouncer.announce(this.i18nService.t(\"reorderFieldUp\", label, currentIndex + 1, this.fields.length), \"assertive\");\n    setTimeout(() => {\n        (event.target as HTMLButtonElement).focus();\n    });\n}\n[[/statement:0]]\n[[statement:1]]\nif (event.key === \"ArrowDown\" && index !== this.fields.length - 1) {\n    event.preventDefault();\n    const currentIndex = index + 1;\n    this.drop({ previousIndex: index, currentIndex } as CdkDragDrop<HTMLDivElement>);\n    await this.liveAnnouncer.announce(this.i18nService.t(\"reorderFieldDown\", label, currentIndex + 1, this.fields.length), \"assertive\");\n}\n[[/statement:1]]\n[[end-member]]",
              "replacement": "\nasync handleKeyDown(event: KeyboardEvent, label: string, index: number): Promise<void> {\n}\n[[/member-skeleton]]\n[[statement:0]]\nif (event.key === \"ArrowUp\" && index !== 0) {\n    event.preventDefault();\n    const currentIndex = index - 1;\n    this.drop({\n        previousIndex: index,\n        currentIndex,\n    } as CdkDragDrop<HTMLDivElement>);\n    await this.liveAnnouncer.announce(this.i18nService.t(\"reorderFieldUp\", label, currentIndex + 1, this.fields.length), \"assertive\");\n    setTimeout(() => (event.target as HTMLButtonElement).focus());\n}\n[[/statement:0]]\n[[statement:1]]\nif (event.key === \"ArrowDown\" && index !== this.fields.length - 1) {\n    event.preventDefault();\n    const currentIndex = index + 1;\n    this.drop({\n        previousIndex: index,\n        currentIndex,\n    } as CdkDragDrop<HTMLDivElement>);\n    await this.liveAnnouncer.announce(this.i18nService.t(\"reorderFieldDown\", label, currentIndex + 1, this.fields.length), \"assertive\");\n    setTimeout(() => (event.target as HTMLButtonElement).focus());\n}\n[[/statement:1]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "getLinkedFieldsOptionsForCipher",
          "runtimeMember": "getLinkedFieldsOptionsForCipher",
          "operations": [
            {
              "kind": "replace",
              "search": "\nprivate getLinkedFieldsOptionsForCipher() {\n}\n[[/member-skeleton]]\n[[statement:0]]\nswitch (this.cipherFormContainer.config.cipherType) {\n    case CipherType.Login:\n        return LoginView.prototype.linkedFieldOptions;\n    case CipherType.Card:\n        return CardView.prototype.linkedFieldOptions;\n    case CipherType.Identity:\n        return IdentityView.prototype.linkedFieldOptions;\n    default:\n        return null;\n}\n[[/statement:0]]\n[[end-member]]",
              "replacement": "\nprivate getLinkedFieldsOptionsForCipher() {\n}\n[[/member-skeleton]]\n[[statement:0]]\nswitch (this.cipherFormContainer.config.cipherType) {\n    case CipherType.Card:\n        return CardView.prototype.linkedFieldOptions;\n    case CipherType.Identity:\n        return IdentityView.prototype.linkedFieldOptions;\n    default:\n        return null;\n}\n[[/statement:0]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "updateCipher",
          "runtimeMember": "updateCipher",
          "operations": [
            {
              "kind": "replace",
              "search": "\nprivate updateCipher(fields: CustomField[]) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nconst newFields = fields.map((field: CustomField) => {\n    let value: string;\n    if (typeof field.value === \"number\") {\n        value = `${field.value}`;\n    }\n    else if (typeof field.value === \"boolean\") {\n        value = field.value ? \"true\" : \"false\";\n    }\n    else {\n        value = field.value;\n    }\n    const fieldView = new FieldView();\n    fieldView.type = field.type;\n    fieldView.name = field.name;\n    fieldView.value = value;\n    fieldView.linkedId = field.linkedId ?? undefined;\n    return fieldView;\n});\n[[/statement:0]]\n",
              "replacement": "\nprivate updateCipher(fields: PersonalCustomField[]): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nconst newFields = fields.map((field) => {\n    const fieldView = new FieldView();\n    fieldView.type = field.type;\n    fieldView.name = field.name;\n    fieldView.value =\n        typeof field.value === \"boolean\"\n            ? field.value\n                ? \"true\"\n                : \"false\"\n            : (field.value ?? null);\n    fieldView.linkedId = field.linkedId ?? undefined;\n    return fieldView;\n});\n[[/statement:0]]\n"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 1,
              "source": "this.hasCustomFields = newFields.length > 0;"
            }
          ]
        }
      ]
    }
  },
  {
    "authority": "libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.ts",
    "runtime": "official-personal-add-edit-custom-field-dialog.component.ts",
    "contract": {
      "authorityClass": "AddEditCustomFieldDialogComponent",
      "authoritySha256": "76e8fddd3f50b19427677aa33f30c93d6e430c6f251a6524135fb1b7e6d04f2b",
      "runtimeClass": "OfficialPersonalAddEditCustomFieldDialogComponent",
      "enforceCompleteRuntimeMembers": true,
      "transforms": [
        {
          "authorityMember": "variant",
          "runtimeMember": "variant",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "customFieldForm",
          "runtimeMember": "customFieldForm",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "fieldTypeOptions",
          "runtimeMember": "fieldTypeOptions",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "FieldType",
          "runtimeMember": "FieldType",
          "operations": [],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowUnchanged": true
        },
        {
          "authorityMember": "constructor",
          "runtimeMember": "constructor",
          "operations": [
            {
              "kind": "replace",
              "search": "\nconstructor(\n@Inject(DIALOG_DATA)\nprivate data: AddEditCustomFieldDialogData, private formBuilder: FormBuilder, private i18nService: I18nService) {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nconstructor(\n@Inject(DIALOG_DATA)\nprivate data: PersonalAddEditCustomFieldDialogData, private formBuilder: FormBuilder, private i18nService: I18nService) {\n}\n[[/member-skeleton]]\n"
            },
            {
              "kind": "replace",
              "search": "\n[[statement:1]]\nthis.fieldTypeOptions = this.fieldTypeOptions.filter((option) => {\n    if (this.data.disallowHiddenField && option.value === FieldType.Hidden) {\n        return false;\n    }\n    const omitLinkedFieldTypeForCiphers: number[] = [\n        CipherType.SecureNote,\n        CipherType.SshKey,\n        CipherType.BankAccount,\n        CipherType.DriversLicense,\n        CipherType.Passport,\n    ];\n    if (omitLinkedFieldTypeForCiphers.includes(this.data.cipherType)) {\n        return option.value !== FieldType.Linked;\n    }\n    return true;\n});\n[[/statement:1]]\n[[statement:2]]\nif (this.variant === \"edit\") {\n    this.customFieldForm.controls.label.setValue(data.editLabelConfig.label);\n    this.customFieldForm.controls.type.disable();\n}\n[[/statement:2]]\n[[end-member]]",
              "replacement": "\n[[statement:1]]\nthis.fieldTypeOptions = this.fieldTypeOptions.filter((option) => {\n    if (data.disallowHiddenField && option.value === FieldType.Hidden) {\n        return false;\n    }\n    if (data.cipherType === CipherType.SecureNote) {\n        return option.value !== FieldType.Linked;\n    }\n    return true;\n});\n[[/statement:1]]\n[[statement:2]]\nif (this.variant === \"edit\") {\n    this.customFieldForm.controls.label.setValue(data.editLabelConfig.label);\n    this.customFieldForm.controls.type.disable();\n}\n[[/statement:2]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.variant = data.editLabelConfig ? \"edit\" : \"add\";"
            }
          ]
        },
        {
          "authorityMember": "getTypeHint",
          "runtimeMember": "getTypeHint",
          "operations": [
            {
              "kind": "replace",
              "search": "\ngetTypeHint(): string {\n}\n[[/member-skeleton]]\n[[statement:0]]\nswitch (this.customFieldForm.get(\"type\")?.value) {\n    case FieldType.Text:\n        return this.i18nService.t(\"textHelpText\");\n    case FieldType.Hidden:\n        return this.i18nService.t(\"hiddenHelpText\");\n    case FieldType.Boolean:\n        return this.i18nService.t(\"checkBoxHelpText\");\n    case FieldType.Linked:\n        return this.i18nService.t(\"linkedHelpText\");\n    default:\n        return \"\";\n}\n[[/statement:0]]\n[[end-member]]",
              "replacement": "\ngetTypeHint(): string {\n}\n[[/member-skeleton]]\n[[statement:0]]\nswitch (this.customFieldForm.controls.type.value) {\n    case FieldType.Text:\n        return this.i18nService.t(\"textHelpText\");\n    case FieldType.Hidden:\n        return this.i18nService.t(\"hiddenHelpText\");\n    case FieldType.Boolean:\n        return this.i18nService.t(\"checkBoxHelpText\");\n    case FieldType.Linked:\n        return this.i18nService.t(\"linkedHelpText\");\n    default:\n        return \"\";\n}\n[[/statement:0]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "submit",
          "runtimeMember": "submit",
          "operations": [
            {
              "kind": "replace",
              "search": "\nsubmit = () => {\n};\n[[/member-skeleton]]\n[[statement:0]]\nif (this.variant === \"add\") {\n    this.addField();\n}\nelse {\n    this.updateLabel();\n}\n[[/statement:0]]\n[[end-member]]",
              "replacement": "\nsubmit = (): void => {\n};\n[[/member-skeleton]]\n[[statement:0]]\nif (this.variant === \"add\")\n    this.addField();\nelse\n    this.updateLabel();\n[[/statement:0]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "addField",
          "runtimeMember": "addField",
          "operations": [
            {
              "kind": "replace",
              "search": "\naddField() {\n}\n[[/member-skeleton]]\n[[statement:0]]\nif (this.customFieldForm.invalid) {\n    return;\n}\n[[/statement:0]]\n",
              "replacement": "\naddField(): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nif (this.customFieldForm.invalid)\n    return;\n[[/statement:0]]\n"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 1,
              "source": "const { type, label } = this.customFieldForm.value;"
            }
          ]
        },
        {
          "authorityMember": "updateLabel",
          "runtimeMember": "updateLabel",
          "operations": [
            {
              "kind": "replace",
              "search": "\nupdateLabel() {\n}\n[[/member-skeleton]]\n[[statement:0]]\nif (this.customFieldForm.invalid) {\n    return;\n}\n[[/statement:0]]\n[[statement:1]]\nconst { label } = this.customFieldForm.value;\n[[/statement:1]]\n[[statement:2]]\nthis.data.updateLabel(this.data.editLabelConfig.index, label);\n[[/statement:2]]\n[[end-member]]",
              "replacement": "\nupdateLabel(): void {\n}\n[[/member-skeleton]]\n[[statement:0]]\nif (this.customFieldForm.invalid)\n    return;\n[[/statement:0]]\n[[statement:1]]\nthis.data.updateLabel(this.data.editLabelConfig.index, this.customFieldForm.value.label);\n[[/statement:1]]\n[[end-member]]"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [],
          "allowNoRetainedStatement": true
        },
        {
          "authorityMember": "removeField",
          "runtimeMember": "removeField",
          "operations": [
            {
              "kind": "replace",
              "search": "\nremoveField() {\n}\n[[/member-skeleton]]\n",
              "replacement": "\nremoveField(): void {\n}\n[[/member-skeleton]]\n"
            }
          ],
          "retainedAuthorityFragments": [
            "[[member-skeleton]]"
          ],
          "retainedAuthorityStatements": [
            {
              "index": 0,
              "source": "this.data.removeField(this.data.editLabelConfig.index);"
            }
          ]
        }
      ]
    }
  }
] as const;

const loginItemTemplate = loginFormTemplateContracts.find(
  ({ runtime }) => runtime === "official-login-item-details.component.html",
)!;
const loginDialogTemplate = loginFormTemplateContracts.find(
  ({ runtime }) =>
    runtime === "official-add-edit-custom-field-dialog.component.html",
)!;

export const personalFormTemplateContracts: readonly PersonalTemplateContract[] =
  [
    {
      authority:
        "libs/vault/src/cipher-form/components/cipher-form.component.html",
      runtime: "official-personal-cipher-form.component.html",
      operations: [
        {
          search: loginFormTemplateContracts[0].operations[0].search,
          replacement:
            '<form #formElement class="macos-cipher-form" [id]="formId" [formGroup]="cipherForm" [bitSubmit]="submit">\n  @if (!loading) {\n    <!-- TODO: Should we show a loading spinner here? Or emit a ready event for the container to handle loading state -->\n    <vault-item-details-section\n      [config]="config"\n      [originalCipherView]="originalCipherView"\n    ></vault-item-details-section>\n\n    @if (config.cipherType === CipherType.Identity) {\n      <vault-identity-section\n        [disabled]="false"\n        [originalCipherView]="originalCipherView"\n      ></vault-identity-section>\n    }\n\n    @if (config.cipherType === CipherType.Card) {\n      <vault-card-details-section\n        [originalCipherView]="originalCipherView"\n        [disabled]="false"\n      ></vault-card-details-section>\n    }\n\n    <vault-additional-options-section\n      [disableSectionMargin]="config.mode !== \'edit\'"\n    ></vault-additional-options-section>',
        },
      ],
    },
    {
      authority: loginItemTemplate.authority,
      runtime: "official-personal-item-details.component.html",
      operations: loginItemTemplate.operations,
    },
    {
      authority:
        "libs/vault/src/cipher-form/components/card-details-section/card-details-section.component.html",
      runtime: "official-card-details-section.component.html",
      operations: [
        {
          search:
            '      <button\n        type="button"\n        bitIconButton\n        bitSuffix\n        bitPasswordInputToggle\n        data-testid="visibility-for-card-number"\n        (toggledChange)="logCardEvent($event, EventType.Cipher_ClientToggledCardNumberVisible)"\n      ></button>',
          replacement:
            '      @if (canViewSecrets) {\n        <button\n          type="button"\n          bitIconButton\n          bitSuffix\n          bitPasswordInputToggle\n          data-testid="visibility-for-card-number"\n        ></button>\n      }',
        },
        {
          search:
            '      <button\n        type="button"\n        bitIconButton\n        bitSuffix\n        bitPasswordInputToggle\n        data-testid="visibility-for-card-code"\n        (toggledChange)="logCardEvent($event, EventType.Cipher_ClientToggledCardCodeVisible)"\n      ></button>',
          replacement:
            '      @if (canViewSecrets) {\n        <button\n          type="button"\n          bitIconButton\n          bitSuffix\n          bitPasswordInputToggle\n          data-testid="visibility-for-card-code"\n        ></button>\n      }',
        },
      ],
    },
    {
      authority:
        "libs/vault/src/cipher-form/components/identity/identity.component.html",
      runtime: "official-identity-section.component.html",
      operations: [
        {
          search:
            '        <button\n          type="button"\n          bitIconButton\n          bitSuffix\n          bitPasswordInputToggle\n          data-testid="visibility-for-ssn"\n        ></button>',
          replacement:
            '        @if (canViewSecrets) {\n          <button\n            type="button"\n            bitIconButton\n            bitSuffix\n            bitPasswordInputToggle\n            data-testid="visibility-for-ssn"\n          ></button>\n        }',
        },
        {
          search:
            '        <button\n          type="button"\n          bitIconButton\n          bitSuffix\n          bitPasswordInputToggle\n          data-testid="visibility-for-passport-number"\n        ></button>',
          replacement:
            '        @if (canViewSecrets) {\n          <button\n            type="button"\n            bitIconButton\n            bitSuffix\n            bitPasswordInputToggle\n            data-testid="visibility-for-passport-number"\n          ></button>\n        }',
        },
      ],
    },
    {
      authority:
        "libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.html",
      runtime: "official-personal-additional-options.component.html",
      operations: [],
    },
    {
      authority:
        "libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.html",
      runtime: "official-personal-custom-fields.component.html",
      operations: [
        {
          search:
            '                    (toggledChange)="logHiddenEvent($event)"\n',
          replacement: "",
        },
        {
          search: '<section class="tw-mb-5 bit-compact:tw-mb-4" [ngClass]="{ \'tw-mb-0\': disableSectionMargin }">',
          replacement: '<section class="tw-mb-5 bit-compact:tw-mb-4 macos-form-section" [ngClass]="{ \'tw-mb-0\': disableSectionMargin }">',
        },
        {
          search: '<bit-card\n        formArrayName="fields"',
          replacement: '<bit-card\n        class="macos-form-group macos-custom-fields"\n        formArrayName="fields"',
        },
        {
          search: 'class="tw-flex tw-p-3 -tw-mx-3 tw-gap-4 tw-bg-background tw-rounded-lg first:-tw-mt-3 last-of-type:tw-mb-0"',
          replacement: 'class="tw-flex tw-p-3 -tw-mx-3 tw-gap-4 tw-bg-background tw-rounded-lg first:-tw-mt-3 last-of-type:tw-mb-0 macos-custom-field-row"',
        },
        {
          search: '<!-- Text Field -->\n            @if (field.value.type === FieldType.Text) {\n              <bit-form-field class="tw-flex-1" disableMargin>',
          replacement: '<!-- Text Field -->\n            @if (field.value.type === FieldType.Text) {\n              <bit-form-field class="tw-flex-1 macos-field-owner" disableMargin>',
        },
        {
          search: '<input bitInput formControlName="value" data-testid="custom-text-field" />',
          replacement: '<input class="macos-control-visible" bitInput formControlName="value" data-testid="custom-text-field" />',
        },
        {
          search: '<!-- Hidden Field -->\n            @if (field.value.type === FieldType.Hidden) {\n              <bit-form-field class="tw-flex-1" disableMargin>',
          replacement: '<!-- Hidden Field -->\n            @if (field.value.type === FieldType.Hidden) {\n              <bit-form-field class="tw-flex-1 macos-field-owner" disableMargin>',
        },
        {
          search: 'data-testid="custom-hidden-field"\n                  class="tw-font-mono"',
          replacement: 'data-testid="custom-hidden-field"\n                  class="tw-font-mono macos-control-visible"',
        },
        {
          search: '<!-- Boolean Field -->\n            @if (field.value.type === FieldType.Boolean) {\n              <bit-form-control class="tw-flex-1" disableMargin>',
          replacement: '<!-- Boolean Field -->\n            @if (field.value.type === FieldType.Boolean) {\n              <bit-form-control class="tw-flex-1 macos-field-owner" disableMargin>',
        },
        {
          search: '<!-- Linked Field -->\n            @if (field.value.type === FieldType.Linked) {\n              <bit-form-field class="tw-flex-1" disableMargin>',
          replacement: '<!-- Linked Field -->\n            @if (field.value.type === FieldType.Linked) {\n              <bit-form-field class="tw-flex-1 macos-field-owner" disableMargin>',
        },
        {
          search: '<bit-select formControlName="linkedId" data-testid="custom-linked-field">',
          replacement: '<bit-select class="macos-control-visible" formControlName="linkedId" data-testid="custom-linked-field">',
        },
        {
          search: 'class="tw-self-center tw-mt-2"\n                data-testid="edit-custom-field-button"',
          replacement: 'class="tw-self-center tw-mt-2 macos-hit-target macos-custom-field-action"\n                data-testid="edit-custom-field-button"',
        },
        {
          search: 'class="tw-self-center tw-mt-2"\n                cdkDragHandle',
          replacement: 'class="tw-self-center tw-mt-2 macos-hit-target macos-custom-field-action"\n                cdkDragHandle',
        },
      ],
    },
    {
      authority: loginDialogTemplate.authority,
      runtime: "official-personal-add-edit-custom-field-dialog.component.html",
      operations: loginDialogTemplate.operations,
    },
  ];

export { applyExactTemplateTransforms };
