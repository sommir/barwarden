import type {
  OfficialMemberTransform,
  PinnedMemberTransformContract,
} from "../official-source-body-contract";

function unchangedMembers(
  ...members: readonly string[]
): readonly OfficialMemberTransform[] {
  return members.map((member) => ({
    authorityMember: member,
    runtimeMember: member,
    operations: [],
    retainedAuthorityFragments: ["[[member-skeleton]]"],
    retainedAuthorityStatements: [],
    allowUnchanged: true,
  }));
}

function renumberStatement(from: number, to: number) {
  return [
    {
      kind: "replace" as const,
      search: `[[statement:${from}]]`,
      replacement: `[[statement:${to}]]`,
    },
    {
      kind: "replace" as const,
      search: `[[/statement:${from}]]`,
      replacement: `[[/statement:${to}]]`,
    },
  ];
}

type MemberContractEntry = {
  readonly authority: string;
  readonly runtime: string;
  readonly contract: PinnedMemberTransformContract;
};

type TemplateOperation = {
  readonly search: string;
  readonly replacement: string;
};

type TemplateContract = {
  readonly authority: string;
  readonly runtime: string;
  readonly operations: readonly TemplateOperation[];
};

export const loginFormMemberContracts: readonly MemberContractEntry[] = [
  {
    authority: "libs/vault/src/cipher-form/components/cipher-form.component.ts",
    runtime: "official-login-cipher-form.component.ts",
    contract: {
      authorityClass: "CipherFormComponent",
      authoritySha256:
        "b29250c6046fc1f72513a2b5dcc599c79c8ee98d12504d168b012cc12f36dd82",
      runtimeClass: "OfficialLoginCipherFormComponent",
      enforceCompleteRuntimeMembers: true,
      transforms: [
        ...unchangedMembers(
          "bitSubmit",
          "formId",
          "submitBtn",
          "originalCipherView",
          "updatedCipherView",
        ),
        {
          authorityMember: "beforeSubmit",
          runtimeMember: "beforeSubmit",
          operations: [
            {
              kind: "replace",
              search: "() => Promise<boolean>",
              replacement: "(cipher: CipherView) => Promise<boolean>",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "config",
          runtimeMember: "config",
          operations: [
            {
              kind: "replace",
              search: "CipherFormConfig",
              replacement: "RetainedOfficialCipherFormConfig",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "destroyRef",
          runtimeMember: "destroyRef",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "_firstInitialized",
          runtimeMember: "_firstInitialized",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "cipherSaved",
          runtimeMember: "cipherSaved",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "formReadySubject",
          runtimeMember: "formReadySubject",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "formReady",
          runtimeMember: "formReady",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "formStatusChangeSubject",
          runtimeMember: "formStatusChangeSubject",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "formStatusChange$",
          runtimeMember: "formStatusChange$",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "cipherForm",
          runtimeMember: "cipherForm",
          operations: [
            {
              kind: "replace",
              search: "Cipher",
              replacement: "OfficialLogin",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "website:get",
          runtimeMember: "website:get",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "loading",
          runtimeMember: "loading",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "CipherType",
          runtimeMember: "CipherType",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "ngAfterViewInit",
          runtimeMember: "ngAfterViewInit",
          operations: [
            {
              kind: "replace",
              search:
                ".pipe(takeUntilDestroyed(this.destroyRef)).subscribe((loading) => {\n        this.submitBtn.loading.set(loading);\n    });\n    this.bitSubmit.disabled$.pipe(takeUntilDestroyed(this.destroyRef))",
              replacement:
                "\n        .pipe(takeUntilDestroyed(this.destroyRef))\n        .subscribe((loading) => {\n        this.submitBtn.loading.set(loading);\n    });\n    this.bitSubmit.disabled$\n        .pipe(takeUntilDestroyed(this.destroyRef))\n        ",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "disableFormFields",
          runtimeMember: "disableFormFields",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "enableFormFields",
          runtimeMember: "enableFormFields",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "registerChildForm",
          runtimeMember: "registerChildForm",
          operations: [
            {
              kind: "replace",
              search: "CipherForm>(name: K, group: Exclude<Cipher",
              replacement:
                "OfficialLoginForm>(name: K, group: Exclude<OfficialLogin",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "patchCipher",
          runtimeMember: "patchCipher",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "getInitialCipherView",
          runtimeMember: "getInitialCipherView",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "initializedWithCachedCipher",
          runtimeMember: "initializedWithCachedCipher",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "ngOnChanges",
          runtimeMember: "ngOnChanges",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "ngOnInit",
          runtimeMember: "ngOnInit",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "init",
          runtimeMember: "init",
          operations: [
            {
              kind: "replace",
              search:
                'CipherForm>({});\n[[/statement:4]]\n[[statement:5]]\nif (this.config == null) {\n    return;\n}\n[[/statement:5]]\n[[statement:6]]\nif (this.config.mode !== "add") {\n    if (this.config.originalCipher == null) {\n        throw new Error("Original cipher is required for edit or clone mode");\n    }\n    this.originalCipherView = await this.addEditFormService.decryptCipher(this.config.originalCipher);\n    this.updatedCipherView = await this.addEditFormService.decryptCipher(this.config.originalCipher);\n    if (this.config.mode === "clone") {\n        this.updatedCipherView.id = null;\n        this.updatedCipherView.key = undefined;\n        this.updatedCipherView.attachments = [];\n        if (this.updatedCipherView.login) {\n            this.updatedCipherView.login.fido2Credentials = null;\n        }\n    }\n}\nelse {\n    this.updatedCipherView.type = this.config.cipherType;\n    if (this.config.cipherType === CipherType.SecureNote) {\n        this.updatedCipherView.secureNote.type = SecureNoteType.Generic;\n    }',
              replacement:
                'OfficialLoginForm>({});\n[[/statement:4]]\n[[statement:5]]\nif (this.config == null) {\n    return;\n}\n[[/statement:5]]\n[[statement:6]]\nif (this.config.mode !== "add") {\n    if (this.config.originalCipher == null) {\n        throw new Error("Original cipher is required for edit or clone mode");\n    }\n    this.originalCipherView = await this.addEditFormService.decryptCipher(this.config.originalCipher);\n    this.updatedCipherView = await this.addEditFormService.decryptCipher(this.config.originalCipher);\n    if (this.config.mode === "clone") {\n        this.updatedCipherView.id = null;\n        this.updatedCipherView.key = undefined;\n        this.updatedCipherView.attachments = [];\n        if (this.updatedCipherView.login) {\n            this.updatedCipherView.login.fido2Credentials = null;\n        }\n    }\n}\nelse {\n    this.updatedCipherView.type = this.config.cipherType;',
            },
            {
              kind: "replace",
              search:
                "[[statement:8]]\nthis.loading = false;\n[[/statement:8]]\n[[statement:9]]\nthis.formReadySubject.next();\n[[/statement:9]]",
              replacement:
                "[[statement:8]]\nthis.loading = false;\n[[/statement:8]]\n[[statement:9]]\nthis.changeDetectorRef.detectChanges();\n[[/statement:9]]\n[[statement:10]]\nthis.formReadySubject.next();\n[[/statement:10]]",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "setInitialCipherFromCache",
          runtimeMember: "setInitialCipherFromCache",
          operations: [
            {
              kind: "replace",
              search:
                "const isEditingExistingCipher = this.updatedCipherView.id && this.updatedCipherView.id === cachedCipher.id;",
              replacement:
                "const isEditingExistingCipher = this.updatedCipherView.id &&\n    this.updatedCipherView.id === cachedCipher.id;",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "constructor",
          runtimeMember: "constructor",
          operations: [
            {
              kind: "replace",
              search:
                "ToastService, private i18nService: I18nService, private changeDetectorRef: ChangeDetectorRef, private cipherFormCacheService: CipherFormCacheService, private cipherArchiveService: CipherArchiveService, private accountService: Account",
              replacement:
                "RetainedCipherFormToastService, private i18nService: I18nService, private changeDetectorRef: ChangeDetectorRef, private cipherFormCacheService: RetainedCipherFormCache",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "countInvalidFields",
          runtimeMember: "countInvalidFields",
          operations: [
            {
              kind: "replace",
              search: ' ? ((control.errors?.["fieldCount"] as number) ?? 1)',
              replacement:
                '\n        ? ((control.errors?.["fieldCount"] as number) ?? 1)\n       ',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "submit",
          runtimeMember: "submit",
          operations: [
            {
              kind: "replace",
              search:
                '!this.config.organizationDataOwnershipDisabled && this.config.organizations.length === 0) {\n    this.toastService.showToast({\n        variant: "error",\n        message: this.i18nService.t("cannotSaveItemNoConfirmedOrgs"),\n    });\n    return;\n}\n[[/statement:0]]\n[[statement:1]]\nlet successToast: string = "editedItem";\n[[/statement:1]]\n[[statement:2]]\nif (this.cipherForm.invalid) {\n    this.cipherForm.markAllAsTouched();\n    const invalidFieldsCount = this.countInvalidFields(this.cipherForm);\n    if (invalidFieldsCount > 0) {\n        this.toastService.showToast({\n            variant: "error",\n            title: null,\n            message: invalidFieldsCount === 1\n                ? this.i18nService.t("singleFieldNeedsAttention")\n                : this.i18nService.t("multipleFieldsNeedAttention", invalidFieldsCount),\n        });\n    }\n    return;\n}\n[[/statement:2]]\n[[statement:3]]\nif (this.beforeSubmit) {\n    const shouldSubmit = await this.beforeSubmit();\n    if (!shouldSubmit) {\n        return;\n    }\n}\n[[/statement:3]]\n[[statement:4]]\nconst userCanArchive = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId, switchMap((userId) => this.cipherArchiveService.userCanArchive$(userId))));\n[[/statement:4]]\n[[statement:5]]\nif (!userCanArchive && this.updatedCipherView.archivedDate) {\n    this.updatedCipherView.archivedDate = null;\n    successToast = "itemRestored";\n}\n[[/statement:5]]\n[[statement:6]]\nconst savedCipher = await this.addEditFormService.saveCipher(this.updatedCipherView, this.config);\n[[/statement:6]]\n[[statement:7]]\nthis.cipherFormCacheService.clearCache();\n[[/statement:7]]\n[[statement:8]]\nthis.toastService.showToast({\n    variant: "success",\n    title: null,\n    message: this.i18nService.t(this.config.mode === "edit" || this.config.mode === "partial-edit"\n        ? successToast\n        : "addedItem"),\n});\n[[/statement:8]]\n[[statement:9]]\nthis.cipherSaved.emit(savedCipher);\n[[/statement:9',
              replacement:
                'this.cipherForm.invalid) {\n    this.cipherForm.markAllAsTouched();\n    this.focusFirstInvalidControl();\n    const invalidFieldsCount = this.countInvalidFields(this.cipherForm);\n    if (invalidFieldsCount > 0) {\n        this.toastService.showToast({\n            variant: "error",\n            title: null,\n            message: invalidFieldsCount === 1\n                ? this.i18nService.t("singleFieldNeedsAttention")\n                : this.i18nService.t("multipleFieldsNeedAttention", invalidFieldsCount),\n        });\n    }\n    return;\n}\n[[/statement:0]]\n[[statement:1]]\nif (this.beforeSubmit) {\n    const shouldSubmit = await this.beforeSubmit();\n    if (!shouldSubmit) {\n        return;\n    }\n}\n[[/statement:1]]\n[[statement:2]]\nconst savedCipher = await this.addEditFormService.saveCipher(this.updatedCipherView, this.config);\n[[/statement:2]]\n[[statement:3]]\nthis.cipherFormCacheService.clearCache();\n[[/statement:3]]\n[[statement:4]]\nthis.toastService.showToast({\n    variant: "success",\n    title: null,\n    message: this.i18nService.t(this.config.mode === "edit" ? "editedItem" : "addedItem"),\n});\n[[/statement:4]]\n[[statement:5]]\nthis.cipherSaved.emit(savedCipher);\n[[/statement:5',
            },
            ...renumberStatement(5, 6),
            ...renumberStatement(4, 5),
            ...renumberStatement(3, 4),
            ...renumberStatement(2, 3),
            ...renumberStatement(1, 2),
            {
              kind: "replace",
              search:
                "[[statement:2]]\nif (this.beforeSubmit) {\n    const shouldSubmit = await this.beforeSubmit();",
              replacement:
                "[[statement:1]]\nconst cipherForSubmit = this.cipherForSubmit();\n[[/statement:1]]\n[[statement:2]]\nif (this.beforeSubmit) {\n    const shouldSubmit = await this.beforeSubmit(cipherForSubmit);",
            },
            {
              kind: "replace",
              search: "this.updatedCipherView, this.config",
              replacement: "cipherForSubmit, this.config",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
      ],
      runtimeOnlyMembers: [
        {
          runtimeMember: "formElement",
          justification:
            "Scopes invalid-control lookup to this retained form element.",
          canonicalSha256:
            "c89eadf07e48038831dda4127f5ea1df54899956419e826b69b39013c5f287a9",
        },
        {
          runtimeMember: "canViewSecrets:get",
          justification:
            "Exposes the retained permission flag to official child sections.",
          canonicalSha256:
            "1bb55d9d2aceecf4fc34faf0c6c3e898f140b2be5776dd26db2a18cbfc4425af",
        },
        {
          runtimeMember: "focusFirstInvalidControl",
          justification:
            "Filters unavailable candidates, then focuses and centers the first usable invalid retained control.",
          canonicalSha256:
            "3954cee166b07ade4a641a6efc469f157349483c4cf20df9df4dc53c936affb9",
        },
        {
          runtimeMember: "cipherForSubmit",
          justification:
            "Restores denied original secrets only in the isolated submit copy.",
          canonicalSha256:
            "1b73c7650d939e831c1e9e8b412b2f061da8b840c555cc821c4a6008577b32ce",
        },
      ],
    },
  },
  {
    authority: "libs/vault/src/cipher-form/cipher-form-container.ts",
    runtime: "official-login-form-container.ts",
    contract: {
      authorityClass: "CipherFormContainer",
      authoritySha256:
        "d6a7f77b321237c86ebcc70b4f28bbe09b40cd878f5d4df9341091441b664afe",
      runtimeClass: "OfficialLoginFormContainer",
      enforceCompleteRuntimeMembers: true,
      transforms: [
        {
          authorityMember: "config",
          runtimeMember: "config",
          operations: [
            {
              kind: "replace",
              search: "CipherFormConfig",
              replacement: "RetainedOfficialCipherFormConfig",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "originalCipherView",
          runtimeMember: "originalCipherView",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "registerChildForm",
          runtimeMember: "registerChildForm",
          operations: [
            {
              kind: "replace",
              search: "CipherForm>(name: K, group: Exclude<Cipher",
              replacement:
                "OfficialLoginForm>(name: K, group: Exclude<OfficialLogin",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "website:get",
          runtimeMember: "website:get",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "patchCipher",
          runtimeMember: "patchCipher",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "getInitialCipherView",
          runtimeMember: "getInitialCipherView",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "initializedWithCachedCipher",
          runtimeMember: "initializedWithCachedCipher",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "disableFormFields",
          runtimeMember: "disableFormFields",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "enableFormFields",
          runtimeMember: "enableFormFields",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "formStatusChange$",
          runtimeMember: "formStatusChange$",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
      ],
      runtimeOnlyMembers: [
        {
          runtimeMember: "canViewSecrets",
          justification:
            "Carries the retained permission flag to the official form sections.",
          canonicalSha256:
            "321ec24ddf4faf6026623d584f9d1587908c1e08394308ef8f85602730109208",
        },
      ],
    },
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/item-details/item-details-section.component.ts",
    runtime: "official-login-item-details.component.ts",
    contract: {
      authorityClass: "ItemDetailsSectionComponent",
      authoritySha256:
        "acc521629a3bef92da2c71e6c8314f1ba0dff25a4e89e4d673fd70a92ee88f1a",
      runtimeClass: "OfficialLoginItemDetailsComponent",
      enforceCompleteRuntimeMembers: true,
      transforms: [
        {
          authorityMember: "config",
          runtimeMember: "config",
          operations: [
            {
              kind: "replace",
              search: "CipherFormConfig",
              replacement: "RetainedOfficialCipherFormConfig",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "itemDetailsForm",
          runtimeMember: "itemDetailsForm",
          operations: [
            {
              kind: "replace",
              search:
                "organizationId: [null],\n    folderId: [null],\n    collectionIds: new FormControl([], [Validators.required])",
              replacement: "folderId: [null]",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "favoriteButtonDisabled",
          runtimeMember: "favoriteButtonDisabled",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "originalCipherView",
          runtimeMember: "originalCipherView",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "initialValues:get",
          runtimeMember: "initialValues:get",
          operations: [
            {
              kind: "replace",
              search: ": OptionalInitialValues | undefined",
              replacement: "",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "constructor",
          runtimeMember: "constructor",
          operations: [
            {
              kind: "replace",
              search:
                'CipherFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService, private destroyRef: DestroyRef, private accountService: AccountService, private policyService: PolicyService, private platformUtilsService: PlatformUtilsService) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nthis.cipherFormContainer.registerChildForm("itemDetails", this.itemDetailsForm);\n[[/statement:0]]\n[[statement:1]]\nthis.itemDetailsForm.valueChanges\n    .pipe(takeUntilDestroyed(), map(() => this.itemDetailsForm.getRawValue()))\n    .subscribe((value) => {\n    this.cipherFormContainer.patchCipher((cipher) => {\n        Object.assign(cipher, {\n            name: value.name,\n            organizationId: value.organizationId,\n            folderId: value.folderId,\n            collectionIds: [\n                ...(value.collectionIds?.map((c) => c.id) || []),\n                ...this.readOnlyCollections.map((c) => c.id),\n            ]',
              replacement:
                'OfficialLoginFormContainer, private formBuilder: FormBuilder) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nthis.cipherFormContainer.registerChildForm("itemDetails", this.itemDetailsForm);\n[[/statement:0]]\n[[statement:1]]\nthis.itemDetailsForm.valueChanges\n    .pipe(takeUntilDestroyed(), map(() => this.itemDetailsForm.getRawValue()))\n    .subscribe((value) => {\n    this.cipherFormContainer.patchCipher((cipher) => {\n        Object.assign(cipher, {\n            name: value.name,\n            folderId: value.folderId',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "favoriteIcon:get",
          runtimeMember: "favoriteIcon:get",
          operations: [
            {
              kind: "replace",
              search: ' ? "bwi-star-f"',
              replacement: '\n    ? "bwi-star-f"\n   ',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "toggleFavorite",
          runtimeMember: "toggleFavorite",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "ngOnInit",
          runtimeMember: "ngOnInit",
          operations: [
            {
              kind: "replace",
              search:
                'this.organizations = this.config.organizations.sort(Utils.getSortFunction(this.i18nService, "name"));\n[[/statement:0]]\n[[statement:1]]\nthis.userId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));\n[[/statement:1]]\n[[statement:2]]\nconst prefillCipher = this.cipherFormContainer.getInitialCipherView();\n[[/statement:2]]\n[[statement:3]]\nif (prefillCipher) {\n    await this.initFromExistingCipher(prefillCipher);\n}\nelse {\n    const orgId = this.initialValues?.organizationId;\n    this.itemDetailsForm.setValue({\n        name: this.initialValues?.name || "",\n        organizationId: orgId || this.defaultOwner,\n        folderId: this.initialValues?.folderId || null,\n        collectionIds: [],\n        favorite: false,\n    });\n    await this.updateCollectionOptions(this.initialValues?.collectionIds ?? []);\n}\n[[/statement:3]]\n[[statement:4]]\nthis.setFormState();\n[[/statement:4]]\n[[statement:5]]\nthis.itemDetailsForm.controls.organizationId.valueChanges\n    .pipe(takeUntilDestroyed(this.destroyRef), distinctUntilChanged(), concatMap(async () => {\n    await this.updateCollectionOptions();\n    this.setFormState();\n}))\n    .subscribe();\n[[/statement:5',
              replacement:
                'const prefillCipher = this.cipherFormContainer.getInitialCipherView();\n[[/statement:0]]\n[[statement:1]]\nif (prefillCipher) {\n    await this.initFromExistingCipher(prefillCipher);\n}\nelse {\n    this.itemDetailsForm.setValue({\n        name: this.initialValues?.name || "",\n        folderId: this.initialValues?.folderId || null,\n        favorite: false,\n    });\n}\n[[/statement:1',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "initFromExistingCipher",
          runtimeMember: "initFromExistingCipher",
          operations: [
            {
              kind: "replace",
              search:
                ', collectionIds } = prefillCipher;\n[[/statement:0]]\n[[statement:1]]\nthis.itemDetailsForm.patchValue({\n    name: name ? name : (this.initialValues?.name ?? ""),\n    organizationId: prefillCipher.organizationId ?? null,\n    folderId: folderId ? folderId : (this.initialValues?.folderId ?? null),\n    collectionIds: [],\n    favorite: prefillCipher.favorite,\n});\n[[/statement:1]]\n[[statement:2]]\nconst orgId = this.itemDetailsForm.controls.organizationId.value as OrganizationId;\n[[/statement:2]]\n[[statement:3]]\nconst initializedWithCachedCipher = this.cipherFormContainer.initializedWithCachedCipher();\n[[/statement:3]]\n[[statement:4]]\nif (this.config.mode === "clone") {\n    if (!initializedWithCachedCipher) {\n        this.itemDetailsForm.controls.name.setValue(prefillCipher.name + " - " + this.i18nService.t("clone"));\n    }\n    if (!this.allowPersonalOwnership && prefillCipher.organizationId == null) {\n        this.itemDetailsForm.controls.organizationId.setValue(this.defaultOwner);\n    }\n}\n[[/statement:4]]\n[[statement:5]]\nconst prefillCollections = collectionIds?.length\n    ? (collectionIds as CollectionId[])\n    : (this.initialValues?.collectionIds ?? []);\n[[/statement:5]]\n[[statement:6]]\nawait this.updateCollectionOptions(prefillCollections);\n[[/statement:6]]\n[[statement:7]]\nthis.setCollectionControlState();\n[[/statement:7]]\n[[statement:8]]\nif (this.partialEdit) {\n    this.itemDetailsForm.disable();\n    this.itemDetailsForm.controls.favorite.enable();\n    this.itemDetailsForm.controls.folderId.enable();\n}\nelse if (this.config.mode === "edit") {\n    if (!this.config.isAdminConsole || !this.config.admin) {\n        this.readOnlyCollections = this.collections.filter((c) => c.organizationId === orgId &&\n            c.readOnly &&\n            this.originalCipherView().collectionIds.includes(c.id as CollectionId));\n    }\n}\n[[/statement:8',
              replacement:
                ' } = prefillCipher;\n[[/statement:0]]\n[[statement:1]]\nthis.itemDetailsForm.patchValue({\n    name: name ? name : (this.initialValues?.name ?? ""),\n    folderId: folderId ? folderId : (this.initialValues?.folderId ?? null),\n    favorite: prefillCipher.favorite,\n});\n[[/statement:1',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
      ],
    },
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/login-details-section/login-details-section.component.ts",
    runtime: "official-login-details.component.ts",
    contract: {
      authorityClass: "LoginDetailsSectionComponent",
      authoritySha256:
        "f1c1e10a7e8538e90e9286f121057cda1acf449da791c06437daff03c9b21304",
      runtimeClass: "OfficialLoginDetailsComponent",
      enforceCompleteRuntimeMembers: true,
      transforms: [
        ...unchangedMembers("newPasswordGenerated"),
        {
          authorityMember: "loginDetailsForm",
          runtimeMember: "loginDetailsForm",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "destroyRef",
          runtimeMember: "destroyRef",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "viewHiddenFields:get",
          runtimeMember: "viewHiddenFields:get",
          operations: [
            {
              kind: "replace",
              search:
                "if (this.cipherFormContainer.originalCipherView) {\n    return this.cipherFormContainer.originalCipherView.viewPassword;\n}\n[[/statement:0]]\n[[statement:1]]\nreturn true;\n[[/statement:1",
              replacement:
                "return this.cipherFormContainer.canViewSecrets;\n[[/statement:0",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "initialValues:get",
          runtimeMember: "initialValues:get",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "constructor",
          runtimeMember: "constructor",
          operations: [
            {
              kind: "replace",
              search:
                "CipherFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService, private generationService: CipherFormGenerationService, private auditService: AuditService, private toastService: ToastService, private eventCollectionService: EventCollectionService, \n@Optional()\nprivate totpCaptureService?: TotpCapture",
              replacement:
                "OfficialLoginFormContainer, private formBuilder: FormBuilder, private generationService: CipherFormGeneration",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "ngOnInit",
          runtimeMember: "ngOnInit",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "initFromExistingCipher",
          runtimeMember: "initFromExistingCipher",
          operations: [
            {
              kind: "replace",
              search:
                'this.initialValues?.password ?? existingLogin.password,\n    totp: existingLogin.totp,\n});\n[[/statement:0]]\n[[statement:1]]\nif (this.cipherFormContainer.config.mode != "clone") {\n    this.existingFido2Credentials = existingLogin.fido2Credentials;\n}\n[[/statement:1]]\n[[statement:2]]\nif (!this.viewHiddenFields) {\n    this.loginDetailsForm.controls.password.disable();\n    this.loginDetailsForm.controls.totp.disable();\n}\n[[/statement:2',
              replacement:
                'this.viewHiddenFields\n        ? (this.initialValues?.password ?? existingLogin.password)\n        : "",\n    totp: this.viewHiddenFields ? existingLogin.totp : "",\n});\n[[/statement:0]]\n[[statement:1]]\nif (!this.viewHiddenFields) {\n    this.loginDetailsForm.controls.password.disable();\n    this.loginDetailsForm.controls.totp.disable();\n}\n[[/statement:1',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "initNewCipher",
          runtimeMember: "initNewCipher",
          operations: [
            {
              kind: "replace",
              search:
                'this.initialValues?.password || "",\n});\n[[/statement:0]]\n[[end-member',
              replacement:
                'this.viewHiddenFields ? this.initialValues?.password || "" : "",\n});\n[[/statement:0]]\n[[statement:1]]\nif (!this.viewHiddenFields) {\n    this.loginDetailsForm.controls.password.disable();\n    this.loginDetailsForm.controls.totp.disable();\n}\n[[/statement:1]]\n[[end-member',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "generatePassword",
          runtimeMember: "generatePassword",
          operations: [
            {
              kind: "replace",
              search:
                "const newPassword = await this.generationService.generatePassword();\n[[/statement:0]]\n[[statement:1]]\nif (newPassword) {\n    this.loginDetailsForm.controls.password.patchValue(newPassword);\n    this.newPasswordGenerated = true;\n}\n[[/statement:1",
              replacement:
                "const completeReceipt = this.operationReceipt?.begin();\n[[/statement:0]]\n[[statement:1]]\ntry {\n    await(this.generationService as RetainedCipherFormGenerationService)\n        .generatePassword((newPassword) => {\n        if (newPassword) {\n            this.loginDetailsForm.controls.password.patchValue(newPassword);\n            this.newPasswordGenerated = true;\n        }\n    });\n}\nfinally {\n    completeReceipt?.();\n}\n[[/statement:1",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "generateUsername",
          runtimeMember: "generateUsername",
          operations: [
            {
              kind: "replace",
              search:
                "const newUsername = await this.generationService.generateUsername(this.cipherFormContainer.website);\n[[/statement:0]]\n[[statement:1]]\nif (newUsername) {\n    this.loginDetailsForm.controls.username.patchValue(newUsername);\n}\n[[/statement:1",
              replacement:
                "const completeReceipt = this.operationReceipt?.begin();\n[[/statement:0]]\n[[statement:1]]\ntry {\n    await(this.generationService as RetainedCipherFormGenerationService)\n        .generateUsername(this.cipherFormContainer.website, (newUsername) => {\n        if (newUsername) {\n            this.loginDetailsForm.controls.username.patchValue(newUsername);\n        }\n    });\n}\nfinally {\n    completeReceipt?.();\n}\n[[/statement:1",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
      ],
      runtimeOnlyMembers: [
        {
          runtimeMember: "operationReceipt",
          justification:
            "Keeps evidence operation completion pending through the retained control patch.",
          canonicalSha256:
            "17762ba47ce906fc7c8c1dba4e25bf7e72d9b8949642575913c7735935bdd023",
        },
      ],
    },
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/autofill-options/autofill-options.component.ts",
    runtime: "official-autofill-options.component.ts",
    contract: {
      authorityClass: "AutofillOptionsComponent",
      authoritySha256:
        "0c71900226564c615a60248bd56445bef351a19d2a9dbf00ae5d3af5c5f14034",
      runtimeClass: "OfficialAutofillOptionsComponent",
      enforceCompleteRuntimeMembers: true,
      transforms: [
        {
          authorityMember: "uriOptions",
          runtimeMember: "uriOptions",
          operations: [
            {
              kind: "replace",
              search: "@ViewChildren(UriOptionComponent)",
              replacement: "@ViewChildren(OfficialUriOptionComponent)",
            },
            {
              kind: "replace",
              search: "QueryList<UriOptionComponent>",
              replacement: "QueryList<OfficialUriOptionComponent>",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "autofillOptionsForm",
          runtimeMember: "autofillOptionsForm",
          operations: [
            {
              kind: "replace",
              search: "    autofillOnPageLoad: [null as boolean],\n",
              replacement: "",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "uriControls:get",
          runtimeMember: "uriControls:get",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "isPartialEdit:get",
          runtimeMember: "isPartialEdit:get",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "focusOnNewInput$",
          runtimeMember: "focusOnNewInput$",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "constructor",
          runtimeMember: "constructor",
          operations: [
            {
              kind: "replace",
              search:
                'CipherFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService, private liveAnnouncer: LiveAnnouncer, private domainSettingsService: DomainSettingsService, private autofillSettingsService: AutofillSettingsServiceAbstraction, private platformUtilsService: PlatformUtilsService, private configService: ConfigService) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nthis.cipherFormContainer.registerChildForm("autoFillOptions", this.autofillOptionsForm);\n[[/statement:0]]\n[[statement:1]]\nthis.autofillOptionsForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {\n    this.cipherFormContainer.patchCipher((cipher) => {\n        cipher.login.uris = value.uris?.map((uri: UriField) => Object.assign(new LoginUriView(), {\n            uri: uri.uri,\n            match: uri.matchDetection,\n        } as LoginUriView));\n        cipher.login.autofillOnPageLoad = value.autofillOnPageLoad;\n        return cipher;\n    });\n});\n[[/statement:1]]\n[[statement:2]]\nthis.updateDefaultAutofillLabel();\n[[/statement:2]]\n[[statement:3]]\nthis.focusOnNewInput$\n    .pipe(takeUntilDestroyed(), switchMap(() => this.uriOptions.changes.pipe(take(1))), switchMap(() => this.liveAnnouncer.announce(this.i18nService.t("websiteAdded"), "polite")))\n    .subscribe(() => {\n    this.uriOptions?.last?.focusInput();\n});\n[[/statement:3]]\n[[statement:4]]\nthis.cipherFormContainer.formStatusChange$.pipe(takeUntilDestroyed()).subscribe((status) => {\n    if (status === "disabled") {\n        this.autofillOptionsForm.disable({ emitEvent: false });\n    }\n    else if (!this.isPartialEdit) {\n        this.autofillOptionsForm.enable({ emitEvent: false });\n    }\n});\n[[/statement:4',
              replacement:
                'OfficialLoginFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService, private liveAnnouncer: LiveAnnouncer) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nthis.cipherFormContainer.registerChildForm("autoFillOptions", this.autofillOptionsForm);\n[[/statement:0]]\n[[statement:1]]\nthis.autofillOptionsForm.valueChanges\n    .pipe(takeUntilDestroyed())\n    .subscribe((value) => {\n    this.cipherFormContainer.patchCipher((cipher) => {\n        cipher.login.uris = value.uris?.map((uri: UriField) => Object.assign(new LoginUriView(), {\n            uri: uri.uri,\n            match: uri.matchDetection,\n        } as LoginUriView));\n        return cipher;\n    });\n});\n[[/statement:1]]\n[[statement:2]]\nthis.focusOnNewInput$\n    .pipe(takeUntilDestroyed(), switchMap(() => this.uriOptions.changes.pipe(take(1))), switchMap(() => this.liveAnnouncer.announce(this.i18nService.t("websiteAdded"), "polite")))\n    .subscribe(() => {\n    this.uriOptions?.last?.focusInput();\n});\n[[/statement:2]]\n[[statement:3]]\nthis.cipherFormContainer.formStatusChange$\n    .pipe(takeUntilDestroyed())\n    .subscribe((status) => {\n    if (status === "disabled") {\n        this.autofillOptionsForm.disable({ emitEvent: false });\n    }\n    else if (!this.isPartialEdit) {\n        this.autofillOptionsForm.enable({ emitEvent: false });\n    }\n});\n[[/statement:3',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "ngOnInit",
          runtimeMember: "ngOnInit",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "initFromExistingCipher",
          runtimeMember: "initFromExistingCipher",
          operations: [
            {
              kind: "replace",
              search:
                "this.autofillOptionsForm.patchValue({\n    autofillOnPageLoad: existingLogin.autofillOnPageLoad,\n});\n[[/statement:1]]\n[[statement:2]]\nif (this.cipherFormContainer.config.initialValues?.loginUri &&\n    !this.cipherFormContainer.initializedWithCachedCipher()) {\n    if (existingLogin.uris?.findIndex((uri) => uri.uri === this.cipherFormContainer.config.initialValues.loginUri) === -1) {\n        this.addUri({\n            uri: this.cipherFormContainer.config.initialValues.loginUri,\n            matchDetection: null,\n        });\n    }\n}\n[[/statement:2",
              replacement:
                "if (this.cipherFormContainer.config.initialValues?.loginUri &&\n    !this.cipherFormContainer.initializedWithCachedCipher()) {\n    if (existingLogin.uris?.findIndex((uri) => uri.uri === this.cipherFormContainer.config.initialValues.loginUri) === -1) {\n        this.addUri({\n            uri: this.cipherFormContainer.config.initialValues.loginUri,\n            matchDetection: null,\n        });\n    }\n}\n[[/statement:1",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "initNewCipher",
          runtimeMember: "initNewCipher",
          operations: [
            {
              kind: "replace",
              search:
                "statement:1]]\nthis.autofillOptionsForm.patchValue({\n    autofillOnPageLoad: null,\n});\n[[/statement:1]]\n[[",
              replacement: "",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "addUri",
          runtimeMember: "addUri",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "removeUri",
          runtimeMember: "removeUri",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "updateUriFields",
          runtimeMember: "updateUriFields",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "onUriItemDrop",
          runtimeMember: "onUriItemDrop",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "onUriItemKeydown",
          runtimeMember: "onUriItemKeydown",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "reorderUriItems",
          runtimeMember: "reorderUriItems",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
      ],
      runtimeOnlyMembers: [
        {
          runtimeMember: "defaultMatchDetection",
          justification:
            "Pins the retained null default after browser settings removal.",
          canonicalSha256:
            "9ea09a7ff24d7990bed556fdf51d1e54b913f1796166009f6e5c018b2a53fdbb",
        },
      ],
    },
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/autofill-options/uri-option.component.ts",
    runtime: "official-uri-option.component.ts",
    contract: {
      authorityClass: "UriOptionComponent",
      authoritySha256:
        "1080b380b2046f81815d605dc7410ecae2d0ad2e9c6d31ec4d1c3519421f76e4",
      runtimeClass: "OfficialUriOptionComponent",
      enforceCompleteRuntimeMembers: true,
      transforms: [
        ...unchangedMembers(
          "inputElement",
          "matchDetectionSelect",
          "canReorder",
          "canRemove",
          "index",
        ),
        {
          authorityMember: "uriForm",
          runtimeMember: "uriForm",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "uriMatchOptions",
          runtimeMember: "uriMatchOptions",
          operations: [
            {
              kind: "replace",
              search:
                ' label: this.i18nService.t("uriAdvancedOption"), value: null, disabled: true },\n    { label: this.i18nService.t("startsWith"), value: UriMatchStrategy.StartsWith },\n    { label: this.i18nService.t("regEx"), value: UriMatchStrategy.RegularExpression',
              replacement:
                '\n        label: this.i18nService.t("uriAdvancedOption"),\n        value: null,\n        disabled: true,\n    },\n    {\n        label: this.i18nService.t("startsWith"),\n        value: UriMatchStrategy.StartsWith,\n    },\n    {\n        label: this.i18nService.t("regEx"),\n        value: UriMatchStrategy.RegularExpression,\n   ',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "advancedOptionWarningMap",
          runtimeMember: "advancedOptionWarningMap",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "defaultMatchDetection:set",
          runtimeMember: "defaultMatchDetection:set",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "onKeydown",
          runtimeMember: "onKeydown",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "remove",
          runtimeMember: "remove",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "showMatchDetection",
          runtimeMember: "showMatchDetection",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "toggleMatchDetection",
          runtimeMember: "toggleMatchDetection",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "uriLabel:get",
          runtimeMember: "uriLabel:get",
          operations: [
            {
              kind: "replace",
              search:
                'const isAppUri = this.showAppLabel() &&\n    (this.uriForm.controls.uri.value?.startsWith(DESKTOP_APP_URI_PREFIX) ?? false);\n[[/statement:0]]\n[[statement:1]]\nif (isAppUri) {\n    return this.index === 0\n        ? this.i18nService.t("appUri")\n        : this.i18nService.t("appUriCount", this.index + 1);\n}\n[[/statement:1]]\n[[statement:2]]\nreturn this.index === 0\n    ? this.i18nService.t("websiteUri")\n    : this.i18nService.t("websiteUriCount", this.index + 1);\n[[/statement:2',
              replacement:
                'return this.index === 0\n    ? this.i18nService.t("websiteUri")\n    : this.i18nService.t("websiteUriCount", this.index + 1);\n[[/statement:0',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "toggleTitle:get",
          runtimeMember: "toggleTitle:get",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "onChange",
          runtimeMember: "onChange",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "onTouched",
          runtimeMember: "onTouched",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "handleKeydown",
          runtimeMember: "handleKeydown",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "constructor",
          runtimeMember: "constructor",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "handleAdvancedMatch",
          runtimeMember: "handleAdvancedMatch",
          operations: [
            {
              kind: "replace",
              search:
                " current === UriMatchStrategy.RegularExpression;\n[[/statement:1]]\n[[statement:2]]\nif (!valueChange || !isAdvanced) {\n    return;\n}\n[[/statement:2]]\n[[statement:3]]\nAdvancedUriOptionDialogComponent.open(this.dialogService, {",
              replacement:
                '\n    current === UriMatchStrategy.RegularExpression;\n[[/statement:1]]\n[[statement:2]]\nif (!valueChange || !isAdvanced) {\n    return;\n}\n[[/statement:2]]\n[[statement:3]]\nOfficialAdvancedUriOptionDialogComponent.open(this.dialogService, {\n    ariaLabel: this.i18nService.t("warningCapitalized"),',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "focusInput",
          runtimeMember: "focusInput",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "removeUri",
          runtimeMember: "removeUri",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "writeValue",
          runtimeMember: "writeValue",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "registerOnChange",
          runtimeMember: "registerOnChange",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "registerOnTouched",
          runtimeMember: "registerOnTouched",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "setDisabledState",
          runtimeMember: "setDisabledState",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "getMatchHints",
          runtimeMember: "getMatchHints",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
      ],
    },
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/autofill-options/advanced-uri-option-dialog.component.ts",
    runtime: "official-advanced-uri-option-dialog.component.ts",
    contract: {
      authorityClass: "AdvancedUriOptionDialogComponent",
      authoritySha256:
        "e2c2b826c3d9ec093d043062fd9a55090ad8f76cdcadf376f28e2c54abd0743e",
      runtimeClass: "OfficialAdvancedUriOptionDialogComponent",
      enforceCompleteRuntimeMembers: true,
      transforms: [
        {
          authorityMember: "constructor",
          runtimeMember: "constructor",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "params",
          runtimeMember: "params",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "contentKey:get",
          runtimeMember: "contentKey:get",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "onCancel",
          runtimeMember: "onCancel",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "onContinue",
          runtimeMember: "onContinue",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "open",
          runtimeMember: "open",
          operations: [
            {
              kind: "replace",
              search:
                "return dialogService.open<boolean>(AdvancedUriOptionDialogComponent, {\n    data: params,\n    disableClose: true,\n    positionStrategy: new CenterPositionStrategy(),\n});\n[[/statement:0",
              replacement:
                "const config = {\n    data: params,\n    disableClose: true,\n    positionStrategy: new CenterPositionStrategy(),\n    ariaLabel: params.ariaLabel,\n};\n[[/statement:0]]\n[[statement:1]]\nreturn dialogService.open<boolean>(OfficialAdvancedUriOptionDialogComponent, config);\n[[/statement:1",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
      ],
    },
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.ts",
    runtime: "official-additional-options.component.ts",
    contract: {
      authorityClass: "AdditionalOptionsSectionComponent",
      authoritySha256:
        "4a2c8f34f00349fc7da6702620090134a034825b7855f2d5899876abfc87d06f",
      runtimeClass: "OfficialAdditionalOptionsComponent",
      enforceCompleteRuntimeMembers: true,
      transforms: [
        ...unchangedMembers("disableSectionMargin"),
        {
          authorityMember: "customFieldsComponent",
          runtimeMember: "customFieldsComponent",
          operations: [
            {
              kind: "replace",
              search: "@ViewChild(CustomFieldsComponent)",
              replacement: "@ViewChild(OfficialCustomFieldsComponent)",
            },
            {
              kind: "replace",
              search: "customFieldsComponent: CustomFieldsComponent",
              replacement:
                "customFieldsComponent: OfficialCustomFieldsComponent",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "additionalOptionsForm",
          runtimeMember: "additionalOptionsForm",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "passwordRepromptEnabled$",
          runtimeMember: "passwordRepromptEnabled$",
          operations: [
            {
              kind: "replace",
              search:
                "this.passwordRepromptService.enabled$.pipe(shareReplay({ refCount: false, bufferSize: 1 })",
              replacement: "of(true",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "hasCustomFields",
          runtimeMember: "hasCustomFields",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "isPartialEdit",
          runtimeMember: "isPartialEdit",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "allowNewField:get",
          runtimeMember: "allowNewField:get",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "constructor",
          runtimeMember: "constructor",
          operations: [
            {
              kind: "replace",
              search:
                'CipherFormContainer, private formBuilder: FormBuilder, private passwordRepromptService: PasswordRepromptService, private changeDetectorRef: ChangeDetectorRef) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nthis.cipherFormContainer.registerChildForm("additionalOptions", this.additionalOptionsForm);\n[[/statement:0]]\n[[statement:1]]\nthis.additionalOptionsForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {\n    this.cipherFormContainer.patchCipher((cipher) => {\n        cipher.notes = value.notes;\n        cipher.reprompt = value.reprompt ? CipherRepromptType.Password',
              replacement:
                'OfficialLoginFormContainer, private formBuilder: FormBuilder, private changeDetectorRef: ChangeDetectorRef) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nthis.cipherFormContainer.registerChildForm("additionalOptions", this.additionalOptionsForm);\n[[/statement:0]]\n[[statement:1]]\nthis.additionalOptionsForm.valueChanges\n    .pipe(takeUntilDestroyed(), map(() => this.additionalOptionsForm.getRawValue()))\n    .subscribe((value) => {\n    this.cipherFormContainer.patchCipher((cipher) => {\n        cipher.notes = value.notes;\n        cipher.reprompt = value.reprompt\n            ? CipherRepromptType.Password\n           ',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "ngOnInit",
          runtimeMember: "ngOnInit",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "addCustomField",
          runtimeMember: "addCustomField",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "handleCustomFieldChange",
          runtimeMember: "handleCustomFieldChange",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
      ],
    },
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.ts",
    runtime: "official-custom-fields.component.ts",
    contract: {
      authorityClass: "CustomFieldsComponent",
      authoritySha256:
        "950793d4f897d21efaa81ede2c6bdaf1ee37bd1f99b1654c5092609f9ec8482c",
      runtimeClass: "OfficialCustomFieldsComponent",
      enforceCompleteRuntimeMembers: true,
      transforms: [
        ...unchangedMembers(
          "customFieldRows",
          "disableSectionMargin",
          "dialogRef",
          "isPartialEdit",
          "disallowHiddenField",
          "destroyed$",
        ),
        {
          authorityMember: "numberOfFieldsChange",
          runtimeMember: "numberOfFieldsChange",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "customFieldsForm",
          runtimeMember: "customFieldsForm",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "hasCustomFields",
          runtimeMember: "hasCustomFields",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "focusOnNewInput$",
          runtimeMember: "focusOnNewInput$",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "parentFormDisabled",
          runtimeMember: "parentFormDisabled",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "FieldType",
          runtimeMember: "FieldType",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "constructor",
          runtimeMember: "constructor",
          operations: [
            {
              kind: "replace",
              search:
                'CipherFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService, private liveAnnouncer: LiveAnnouncer, private eventCollectionService: EventCollectionService) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nthis.destroyed$ = inject(DestroyRef);\n[[/statement:0]]\n[[statement:1]]\nthis.cipherFormContainer.registerChildForm("customFields", this.customFieldsForm);\n[[/statement:1]]\n[[statement:2]]\nthis.customFieldsForm.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {\n    this.updateCipher(this.fields.getRawValue());\n});\n[[/statement:2]]\n[[statement:3]]\nthis.cipherFormContainer.formStatusChange$.pipe(takeUntilDestroyed())',
              replacement:
                'OfficialLoginFormContainer, private formBuilder: FormBuilder, private i18nService: I18nService, private liveAnnouncer: LiveAnnouncer) {\n}\n[[/member-skeleton]]\n[[statement:0]]\nthis.destroyed$ = inject(DestroyRef);\n[[/statement:0]]\n[[statement:1]]\nthis.cipherFormContainer.registerChildForm("customFields", this.customFieldsForm);\n[[/statement:1]]\n[[statement:2]]\nthis.customFieldsForm.valueChanges\n    .pipe(takeUntilDestroyed())\n    .subscribe(() => {\n    this.updateCipher(this.fields.getRawValue());\n});\n[[/statement:2]]\n[[statement:3]]\nthis.cipherFormContainer.formStatusChange$\n    .pipe(takeUntilDestroyed())\n    ',
            },
            {
              kind: "replace",
              search:
                'this.parentFormDisabled = status === "disabled";\n});\n[[/statement:3',
              replacement:
                'this.parentFormDisabled = status === "disabled";\n    if (status === "enabled" && !this.cipherFormContainer.canViewSecrets) {\n        this.fields.controls.forEach((field) => {\n            const value = field.getRawValue() as CustomField;\n            if (value.type === FieldType.Hidden && !value.newField) {\n                field.get("value")?.disable({ emitEvent: false });\n            }\n        });\n    }\n});\n[[/statement:3',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "fields:get",
          runtimeMember: "fields:get",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "canEdit",
          runtimeMember: "canEdit",
          operations: [
            {
              kind: "replace",
              search: "originalCipherView.viewPassword",
              replacement: "canViewSecrets",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "dragDisabled",
          runtimeMember: "dragDisabled",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "ngOnInit",
          runtimeMember: "ngOnInit",
          operations: [
            {
              kind: "replace",
              search:
                'linkedFieldsOptionsForCipher = this.getLinkedFieldsOptionsForCipher();\n[[/statement:0]]\n[[statement:1]]\nconst optionsArray = Array.from(linkedFieldsOptionsForCipher?.entries() ?? []);\n[[/statement:1]]\n[[statement:2]]\noptionsArray.sort((a, b) => a[1].sortPosition - b[1].sortPosition);\n[[/statement:2]]\n[[statement:3]]\nthis.linkedFieldOptions = optionsArray.map(([id, linkedFieldOption]) => ({\n    name: this.i18nService.t(linkedFieldOption.i18nKey),\n    value: id as LinkedIdType,\n}));\n[[/statement:3]]\n[[statement:4]]\nconst prefillCipher = this.cipherFormContainer.getInitialCipherView();\n[[/statement:4]]\n[[statement:5]]\nprefillCipher?.fields?.forEach((field) => {\n    let value: string | boolean = field.value;\n    if (field.type === FieldType.Boolean) {\n        value = field.value === "true" ? true : false;\n    }\n    const customField = this.formBuilder.group<CustomField>({\n        type: field.type,\n        name: field.name,\n        value: value,\n        linkedId: field.linkedId,\n        newField: false,\n    });\n    if (field.type === FieldType.Hidden &&\n        !this.cipherFormContainer.originalCipherView?.viewPassword) {\n        customField.controls.value.disable();\n    }\n    this.fields.push(customField);\n});\n[[/statement:5]]\n[[statement:6]]\nif (this.cipherFormContainer.config.mode === "partial-edit") {\n    this.isPartialEdit = true;\n    this.customFieldsForm.disable();\n}\n[[/statement:6',
              replacement:
                'prefillCipher = this.cipherFormContainer.getInitialCipherView();\n[[/statement:0]]\n[[statement:1]]\nprefillCipher?.fields?.forEach((field) => {\n    let value: string | boolean = field.value;\n    if (field.type === FieldType.Boolean) {\n        value = field.value === "true" ? true : false;\n    }\n    else if (field.type === FieldType.Hidden &&\n        !this.cipherFormContainer.canViewSecrets) {\n        value = "";\n    }\n    const customField = this.formBuilder.group<CustomField>({\n        type: field.type,\n        name: field.name,\n        value: value,\n        newField: false,\n    });\n    if (field.type === FieldType.Hidden &&\n        !this.cipherFormContainer.canViewSecrets) {\n        customField.controls.value.disable();\n    }\n    this.fields.push(customField);\n});\n[[/statement:1]]\n[[statement:2]]\nif (this.cipherFormContainer.config.mode === "partial-edit") {\n    this.isPartialEdit = true;\n    this.customFieldsForm.disable();\n}\n[[/statement:2',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "ngAfterViewInit",
          runtimeMember: "ngAfterViewInit",
          operations: [
            {
              kind: "replace",
              search: '.querySelector<HTMLLabelElement>("label")',
              replacement:
                '\n        .querySelector<HTMLLabelElement>("label")\n        ',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "openAddEditCustomFieldDialog",
          runtimeMember: "openAddEditCustomFieldDialog",
          operations: [
            {
              kind: "replace",
              search:
                'cipherType, mode, originalCipher } = this.cipherFormContainer.config;\n[[/statement:0]]\n[[statement:1]]\nthis.dialogRef = this.dialogService.open<unknown, AddEditCustomFieldDialogData>(AddEditCustomFieldDialogComponent, {\n    data: {\n        addField: this.addField.bind(this),\n        updateLabel: this.updateLabel.bind(this),\n        removeField: this.removeField.bind(this),\n        cipherType,\n        editLabelConfig,\n        disallowHiddenField: mode === "edit" && !originalCipher.viewPassword',
              replacement:
                'mode } = this.cipherFormContainer.config;\n[[/statement:0]]\n[[statement:1]]\nthis.dialogRef = this.dialogService.open<unknown, AddEditCustomFieldDialogData>(OfficialAddEditCustomFieldDialogComponent, {\n    data: {\n        addField: this.addField.bind(this),\n        updateLabel: this.updateLabel.bind(this),\n        removeField: this.removeField.bind(this),\n        editLabelConfig,\n        disallowHiddenField: mode === "edit" && !this.cipherFormContainer.canViewSecrets',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "canViewPasswords",
          runtimeMember: "canViewPasswords",
          operations: [
            {
              kind: "replace",
              search: "originalCipherView.viewPassword",
              replacement: "canViewSecrets",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "updateLabel",
          runtimeMember: "updateLabel",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "removeField",
          runtimeMember: "removeField",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "addField",
          runtimeMember: "addField",
          operations: [
            {
              kind: "replace",
              search:
                "let linkedId = null;\n[[/statement:2]]\n[[statement:3]]\nif (type === FieldType.Boolean) {\n    value = false;\n}\n[[/statement:3]]\n[[statement:4]]\nif (type === FieldType.Linked && this.linkedFieldOptions.length > 0) {\n    linkedId = this.linkedFieldOptions[0].value;\n}\n[[/statement:4]]\n[[statement:5]]\nthis.fields.push(this.formBuilder.group<CustomField>({\n    type,\n    name: label,\n    value,\n    linkedId,\n    newField: true,\n}));\n[[/statement:5]]\n[[statement:6]]\nthis.focusOnNewInput$.next();\n[[/statement:6",
              replacement:
                "if (type === FieldType.Boolean) {\n    value = false;\n}\n[[/statement:2]]\n[[statement:3]]\nthis.fields.push(this.formBuilder.group<CustomField>({\n    type,\n    name: label,\n    value,\n    newField: true,\n}));\n[[/statement:3]]\n[[statement:4]]\nthis.focusOnNewInput$.next();\n[[/statement:4",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "drop",
          runtimeMember: "drop",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "handleKeyDown",
          runtimeMember: "handleKeyDown",
          operations: [
            {
              kind: "replace",
              search:
                ' previousIndex: index, currentIndex } as CdkDragDrop<HTMLDivElement>);\n    await this.liveAnnouncer.announce(this.i18nService.t("reorderFieldUp", label, currentIndex + 1, this.fields.length), "assertive");\n    setTimeout(() => {\n        (event.target as HTMLButtonElement).focus();\n    });\n}\n[[/statement:0]]\n[[statement:1]]\nif (event.key === "ArrowDown" && index !== this.fields.length - 1) {\n    event.preventDefault();\n    const currentIndex = index + 1;\n    this.drop({ previousIndex: index, currentIndex',
              replacement:
                '\n        previousIndex: index,\n        currentIndex,\n    } as CdkDragDrop<HTMLDivElement>);\n    await this.liveAnnouncer.announce(this.i18nService.t("reorderFieldUp", label, currentIndex + 1, this.fields.length), "assertive");\n    setTimeout(() => {\n        (event.target as HTMLButtonElement).focus();\n    });\n}\n[[/statement:0]]\n[[statement:1]]\nif (event.key === "ArrowDown" && index !== this.fields.length - 1) {\n    event.preventDefault();\n    const currentIndex = index + 1;\n    this.drop({\n        previousIndex: index,\n        currentIndex,\n   ',
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "updateCipher",
          runtimeMember: "updateCipher",
          operations: [
            {
              kind: "replace",
              search: "fieldView.linkedId = field.linkedId ?? undefined;\n    ",
              replacement: "",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
      ],
    },
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.ts",
    runtime: "official-add-edit-custom-field-dialog.component.ts",
    contract: {
      authorityClass: "AddEditCustomFieldDialogComponent",
      authoritySha256:
        "76e8fddd3f50b19427677aa33f30c93d6e430c6f251a6524135fb1b7e6d04f2b",
      runtimeClass: "OfficialAddEditCustomFieldDialogComponent",
      enforceCompleteRuntimeMembers: true,
      transforms: [
        ...unchangedMembers("variant"),
        {
          authorityMember: "customFieldForm",
          runtimeMember: "customFieldForm",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "fieldTypeOptions",
          runtimeMember: "fieldTypeOptions",
          operations: [
            {
              kind: "replace",
              search:
                '    { name: this.i18nService.t("cfTypeLinked"), value: FieldType.Linked },\n',
              replacement: "",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "FieldType",
          runtimeMember: "FieldType",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "constructor",
          runtimeMember: "constructor",
          operations: [
            {
              kind: "replace",
              search:
                "const omitLinkedFieldTypeForCiphers: number[] = [\n        CipherType.SecureNote,\n        CipherType.SshKey,\n        CipherType.BankAccount,\n        CipherType.DriversLicense,\n        CipherType.Passport,\n    ];\n    if (omitLinkedFieldTypeForCiphers.includes(this.data.cipherType)) {\n        return option.value !== FieldType.Linked;\n    }\n    ",
              replacement: "",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "getTypeHint",
          runtimeMember: "getTypeHint",
          operations: [
            {
              kind: "replace",
              search:
                'case FieldType.Linked:\n        return this.i18nService.t("linkedHelpText");\n    ',
              replacement: "",
            },
          ],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowNoRetainedStatement: true,
        },
        {
          authorityMember: "submit",
          runtimeMember: "submit",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "addField",
          runtimeMember: "addField",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "updateLabel",
          runtimeMember: "updateLabel",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
        {
          authorityMember: "removeField",
          runtimeMember: "removeField",
          operations: [],
          retainedAuthorityFragments: ["[[member-skeleton]]"],
          retainedAuthorityStatements: [],
          allowUnchanged: true,
        },
      ],
    },
  },
];

export const loginFormTemplateContracts: readonly TemplateContract[] = [
  {
    authority:
      "libs/vault/src/cipher-form/components/cipher-form.component.html",
    runtime: "official-login-cipher-form.component.html",
    operations: [
      {
        search:
          '@if (!loading) {\n  <vault-new-item-nudge [configType]="config.cipherType"> </vault-new-item-nudge>\n}\n<form [id]="formId" [formGroup]="cipherForm" [bitSubmit]="submit">\n  @if (!loading) {\n    <!-- TODO: Should we show a loading spinner here? Or emit a ready event for the container to handle loading state -->\n    <vault-item-details-section\n      [config]="config"\n      [originalCipherView]="originalCipherView"\n    ></vault-item-details-section>\n\n    @if (config.cipherType === CipherType.Login) {\n      <vault-login-details-section></vault-login-details-section>\n    }\n\n    @if (config.cipherType === CipherType.Identity) {\n      <vault-identity-section\n        [disabled]="config.mode === \'partial-edit\'"\n        [originalCipherView]="originalCipherView"\n      ></vault-identity-section>\n    }\n\n    @if (config.cipherType === CipherType.Card) {\n      <vault-card-details-section\n        [originalCipherView]="originalCipherView"\n        [disabled]="config.mode === \'partial-edit\'"\n      ></vault-card-details-section>\n    }\n\n    @if (config.cipherType === CipherType.SshKey) {\n      <vault-sshkey-section [originalCipherView]="originalCipherView"></vault-sshkey-section>\n    }\n\n    @if (config.cipherType === CipherType.BankAccount) {\n      <vault-bank-account-section\n        [disabled]="config.mode === \'partial-edit\'"\n        [originalCipherView]="originalCipherView"\n      ></vault-bank-account-section>\n    }\n\n    @if (config.cipherType === CipherType.DriversLicense) {\n      <vault-drivers-license-section\n        [disabled]="config.mode === \'partial-edit\'"\n        [originalCipherView]="originalCipherView"\n      ></vault-drivers-license-section>\n    }\n\n    @if (config.cipherType === CipherType.Passport) {\n      <vault-passport-section\n        [disabled]="config.mode === \'partial-edit\'"\n        [originalCipherView]="originalCipherView"\n      ></vault-passport-section>\n    }\n\n    <vault-additional-options-section\n      [disableSectionMargin]="config.mode !== \'edit\'"\n    ></vault-additional-options-section>\n\n    <!-- Attachments are only available for existing ciphers -->\n    @if (config.mode == "edit") {\n      <ng-content select="[slot=attachment-button]"></ng-content>\n    }',
        replacement:
          '<form #formElement class="macos-cipher-form" [id]="formId" [formGroup]="cipherForm" [bitSubmit]="submit">\n  @if (!loading) {\n    <!-- TODO: Should we show a loading spinner here? Or emit a ready event for the container to handle loading state -->\n    <vault-item-details-section\n      [config]="config"\n      [originalCipherView]="originalCipherView"\n    ></vault-item-details-section>\n\n    <vault-login-details-section></vault-login-details-section>\n\n    <vault-additional-options-section\n      [disableSectionMargin]="config.mode !== \'edit\'"\n    ></vault-additional-options-section>',
      },
    ],
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/item-details/item-details-section.component.html",
    runtime: "official-login-item-details.component.html",
    operations: [
      {
        search:
          '@if (showArchiveBadge()) {\n      <button type="button" bit-chip-action [label]="\'archived\' | i18n"></button>\n    }\n    @if (!config.hideIndividualVaultFields) {\n      <button\n        slot="end"\n        type="button"\n        size="small"\n        [bitIconButton]="favoriteIcon"\n        role="checkbox"\n        [attr.aria-checked]="itemDetailsForm.value.favorite"\n        [label]="\'favorite\' | i18n"\n        (click)="toggleFavorite()"\n        [disabled]="favoriteButtonDisabled"\n      ></button>\n    }\n  </bit-section-header>\n  <bit-card>\n    <bit-form-field>\n      <bit-label>{{ "itemName" | i18n }}</bit-label>\n      <input bitInput formControlName="name" />\n    </bit-form-field>\n    @if (showOwnership) {\n      <bit-form-field>\n        <bit-label>{{ "owner" | i18n }}</bit-label>\n        <bit-select formControlName="organizationId">\n          @if (showPersonalOwnershipOption) {\n            <bit-option [value]="null" [label]="userEmail$ | async"></bit-option>\n          }\n          @for (org of organizations; track org.id) {\n            <bit-option [value]="org.id" [label]="org.name"></bit-option>\n          }\n        </bit-select>\n      </bit-form-field>\n    }\n    @if (showCollectionsControl) {\n      <ng-container>\n        <bit-form-field class="tw-w-full" [disableMargin]="config.hideIndividualVaultFields">\n          <bit-label>{{ "collections" | i18n }}</bit-label>\n          <bit-multi-select\n            class="tw-w-full"\n            formControlName="collectionIds"\n            [baseItems]="collectionOptions"\n          ></bit-multi-select>\n          @if (readOnlyCollectionsNames.length > 0) {\n            <bit-hint data-testid="view-only-hint">\n              {{ "cannotRemoveViewOnlyCollections" | i18n: readOnlyCollectionsNames.join(", ") }}\n            </bit-hint>\n          }\n        </bit-form-field>\n      </ng-container>\n    }\n    @if (!config.hideIndividualVaultFields) {\n      <bit-form-field disableMargin>\n        <bit-label>{{ "folder" | i18n }}</bit-label>\n        <bit-select formControlName="folderId">\n          @for (folder of config.folders; track folder.id) {\n            <bit-option [value]="folder.id" [label]="folder.name"></bit-option>\n          }\n        </bit-select>\n      </bit-form-field>\n    }',
        replacement:
          '<button\n      slot="end"\n      type="button"\n      size="small"\n      [bitIconButton]="favoriteIcon"\n      role="checkbox"\n      [attr.aria-checked]="itemDetailsForm.value.favorite"\n      [label]="\'favorite\' | i18n"\n      (click)="toggleFavorite()"\n      [disabled]="favoriteButtonDisabled"\n    ></button>\n  </bit-section-header>\n  <bit-card>\n    <bit-form-field>\n      <bit-label>{{ "itemName" | i18n }}</bit-label>\n      <input bitInput formControlName="name" />\n    </bit-form-field>\n    <bit-form-field disableMargin>\n      <bit-label>{{ "folder" | i18n }}</bit-label>\n      <bit-select formControlName="folderId">\n        @for (folder of config.folders; track folder.id) {\n          <bit-option [value]="folder.id" [label]="folder.name"></bit-option>\n        }\n      </bit-select>\n    </bit-form-field>',
      },
      {
        search: '<section [formGroup]="itemDetailsForm" class="tw-mb-5 bit-compact:tw-mb-4">',
        replacement: '<section [formGroup]="itemDetailsForm" class="tw-mb-5 bit-compact:tw-mb-4 macos-form-section">',
      },
      {
        search: 'size="small"\n',
        replacement: 'size="small"\n      class="macos-hit-target"\n',
      },
      {
        search: '<bit-card>\n    <bit-form-field>\n      <bit-label>{{ "itemName" | i18n }}</bit-label>\n      <input bitInput formControlName="name" />',
        replacement: '<bit-card class="macos-form-group">\n    <bit-form-field class="macos-field-owner">\n      <bit-label>{{ "itemName" | i18n }}</bit-label>\n      <input class="macos-control-visible" bitInput formControlName="name" />',
      },
      {
        search: '<bit-form-field disableMargin>\n',
        replacement: '<bit-form-field class="macos-field-owner" disableMargin>\n',
      },
      {
        search: '<bit-select formControlName="folderId">',
        replacement: '<bit-select class="macos-control-visible" formControlName="folderId">',
      },
    ],
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/login-details-section/login-details-section.component.html",
    runtime: "official-login-details.component.html",
    operations: [
      {
        search:
          '\n        loginDetailsForm.controls.password.enabled &&\n        loginDetailsForm.controls.password.value?.length > 0\n      ) {\n        <button\n          type="button"\n          bitIconButton="bwi-check-circle"\n          bitSuffix\n          data-testid="check-password-button"\n          [label]="\'checkPassword\' | i18n"\n          [bitAction]="checkPassword"\n        ></button>\n      }\n      @if (viewHiddenFields) {\n        <button\n          type="button"\n          bitIconButton\n          bitSuffix\n          data-testid="toggle-password-visibility"\n          bitPasswordInputToggle\n          (toggledChange)="logVisibleEvent($event, EventType.Cipher_ClientToggledPasswordVisible)"\n        ></button>\n      }\n      @if (loginDetailsForm.controls.password.enabled) {\n        <button\n          type="button"\n          bitIconButton="bwi-generate"\n          bitSuffix\n          data-testid="generate-password-button"\n          [label]="\'generatePassword\' | i18n"\n          [bitAction]="generatePassword"\n        ></button>\n      }\n    </bit-form-field>\n\n    @if (hasPasskey) {\n      <bit-form-field>\n        <bit-label>{{ "typePasskey" | i18n }}</bit-label>\n        <input\n          bitInput\n          readonly\n          [value]="fido2CredentialCreationDateValue"\n          data-testid="passkey-field"\n        />\n        @if (loginDetailsForm.enabled && viewHiddenFields) {\n          <button\n            type="button"\n            bitIconButton="bwi-minus-circle"\n            buttonType="dangerGhost"\n            bitSuffix\n            [bitAction]="removePasskey"\n            data-testid="remove-passkey-button"\n            [label]="\'removePasskey\' | i18n"\n          ></button>\n        }\n      </bit-form-field>\n    }\n\n    <bit-form-field disableMargin>\n      <bit-label>\n        {{ "authenticatorKey" | i18n }}\n        <button\n          bitLink\n          type="button"\n          [bitPopoverTriggerFor]="totpPopover"\n          [appA11yTitle]="\'learnMoreAboutAuthenticators\' | i18n"\n          slot="end"\n          startIcon="bwi-question-circle"\n        ></button>\n        <bit-popover #totpPopover [title]="\'totpHelperTitle\' | i18n">\n          <p class="tw-mb-0">\n            {{ (canCaptureTotp ? "totpHelperWithCapture" : "totpHelper") | i18n }}\n          </p>\n        </bit-popover>\n      </bit-label>\n      <input bitInput formControlName="totp" type="password" class="tw-font-mono" />\n      @if (viewHiddenFields) {\n        <button\n          type="button"\n          bitIconButton\n          bitSuffix\n          data-testid="toggle-totp-visibility"\n          bitPasswordInputToggle\n          (toggledChange)="logVisibleEvent($event, EventType.Cipher_ClientToggledTOTPSeedVisible)"\n        ></button>\n      }\n      @if (canCaptureTotp) {\n        <button\n          type="button"\n          bitIconButton="bwi-camera"\n          bitSuffix\n          data-testid="capture-totp-button"\n          [bitAction]="captureTotp"\n          [label]="\'totpCapture\' | i18n"',
        replacement:
          'viewHiddenFields) {\n        <button\n          type="button"\n          bitIconButton\n          bitSuffix\n          data-testid="toggle-password-visibility"\n          bitPasswordInputToggle\n        ></button>\n      }\n      @if (loginDetailsForm.controls.password.enabled) {\n        <button\n          type="button"\n          bitIconButton="bwi-generate"\n          bitSuffix\n          data-testid="generate-password-button"\n          [label]="\'generatePassword\' | i18n"\n          [bitAction]="generatePassword"\n        ></button>\n      }\n    </bit-form-field>\n\n    <bit-form-field disableMargin>\n      <bit-label>\n        {{ "authenticatorKey" | i18n }}\n        <button\n          bitLink\n          type="button"\n          [bitPopoverTriggerFor]="totpPopover"\n          [attr.aria-label]="\'learnMoreAboutAuthenticators\' | i18n"\n          slot="end"\n          startIcon="bwi-question-circle"\n        ></button>\n        <bit-popover #totpPopover [title]="\'totpHelperTitle\' | i18n">\n          <p class="tw-mb-0">\n            {{ "totpHelper" | i18n }}\n          </p>\n        </bit-popover>\n      </bit-label>\n      <input bitInput formControlName="totp" type="password" class="tw-font-mono" />\n      @if (viewHiddenFields) {\n        <button\n          type="button"\n          bitIconButton\n          bitSuffix\n          data-testid="toggle-totp-visibility"\n          bitPasswordInputToggle',
      },
    ],
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/autofill-options/autofill-options.component.html",
    runtime: "official-autofill-options.component.html",
    operations: [
      {
        search:
          '$ | async"\n          [index]="i"\n          [showAppLabel]="showAddAppDropdown()"\n        ></vault-autofill-uri-option>\n      }\n    </ng-container>\n\n    @if (autofillOptionsForm.enabled) {\n      @if (showAddAppDropdown()) {\n        <button\n          type="button"\n          bitLink\n          linkType="primary"\n          [class.tw-mb-6]="autofillOnPageLoadEnabled$ | async"\n          startIcon="bwi-plus"\n          [bitMenuTriggerFor]="addUriMenu"\n        >\n          {{ "addWebsiteOrApp" | i18n }}\n        </button>\n        <bit-menu #addUriMenu>\n          <button\n            type="button"\n            bitMenuItem\n            (click)="addUri({ uri: null, matchDetection: null }, true)"\n          >\n            {{ "website" | i18n }}\n          </button>\n          <button\n            type="button"\n            bitMenuItem\n            (click)="addUri({ uri: desktopAppUriPrefix, matchDetection: null }, true)"\n          >\n            {{ "app" | i18n }}\n          </button>\n        </bit-menu>\n      } @else {\n        <button\n          type="button"\n          bitLink\n          linkType="primary"\n          [class.tw-mb-6]="autofillOnPageLoadEnabled$ | async"\n          (click)="addUri({ uri: null, matchDetection: null }, true)"\n          startIcon="bwi-plus"\n        >\n          {{ "addWebsite" | i18n }}\n        </button>\n      }\n    }\n\n    @if (autofillOnPageLoadEnabled$ | async) {\n      <bit-form-field disableMargin>\n        <bit-label>{{ "autoFillOnPageLoad" | i18n }}</bit-label>\n        <bit-select formControlName="autofillOnPageLoad" [items]="autofillOptions"></bit-select>\n      </bit-form-field',
        replacement:
          '"\n          [index]="i"\n        ></vault-autofill-uri-option>\n      }\n    </ng-container>\n\n    @if (autofillOptionsForm.enabled) {\n      <button\n        type="button"\n        bitLink\n        linkType="primary"\n        (click)="addUri({ uri: null, matchDetection: null }, true)"\n        startIcon="bwi-plus"\n      >\n        {{ "addWebsite" | i18n }}\n      </button',
      },
    ],
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/autofill-options/uri-option.component.html",
    runtime: "official-uri-option.component.html",
    operations: [],
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/autofill-options/advanced-uri-option-dialog.component.html",
    runtime: "official-advanced-uri-option-dialog.component.html",
    operations: [
      {
        search:
          '  <br />\n      <button bitLink type="button" linkType="primary" (click)="openLink($event)">\n        {{ "uriMatchWarningDialogLink" | i18n }}\n      </button>\n    ',
        replacement: "",
      },
    ],
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/additional-options/additional-options-section.component.html",
    runtime: "official-additional-options.component.html",
    operations: [],
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/custom-fields/custom-fields.component.html",
    runtime: "official-custom-fields.component.html",
    operations: [
      {
        search:
          '  (toggledChange)="logHiddenEvent($event)"\n                  ></button>\n                }\n              </bit-form-field>\n            }\n\n            <!-- Boolean Field -->\n            @if (field.value.type === FieldType.Boolean) {\n              <bit-form-control class="tw-flex-1" disableMargin>\n                <input\n                  bitCheckbox\n                  formControlName="value"\n                  type="checkbox"\n                  data-testid="custom-boolean-field"\n                />\n                <bit-label>{{ field.value.name }}</bit-label>\n              </bit-form-control>\n            }\n\n            <!-- Linked Field -->\n            @if (field.value.type === FieldType.Linked) {\n              <bit-form-field class="tw-flex-1" disableMargin>\n                <bit-label>{{ field.value.name }}</bit-label>\n                <bit-select formControlName="linkedId" data-testid="custom-linked-field">\n                  @for (option of linkedFieldOptions; track $index) {\n                    <bit-option [value]="option.value" [label]="option.name"></bit-option>\n                  }\n                </bit-select>\n              </bit-form-field',
        replacement:
          '></button>\n                }\n              </bit-form-field>\n            }\n\n            <!-- Boolean Field -->\n            @if (field.value.type === FieldType.Boolean) {\n              <bit-form-control class="tw-flex-1" disableMargin>\n                <input\n                  bitCheckbox\n                  formControlName="value"\n                  type="checkbox"\n                  data-testid="custom-boolean-field"\n                />\n                <bit-label>{{ field.value.name }}</bit-label>\n              </bit-form-control',
      },
    ],
  },
  {
    authority:
      "libs/vault/src/cipher-form/components/custom-fields/add-edit-custom-field-dialog/add-edit-custom-field-dialog.component.html",
    runtime: "official-add-edit-custom-field-dialog.component.html",
    operations: [
      {
        search:
          '  @if (customFieldForm.value.type === FieldType.Linked) {\n        <bit-hint>\n          {{ "linkedLabelHelpText" | i18n }}\n        </bit-hint>\n      }\n    ',
        replacement: "",
      },
    ],
  },
];

export function applyExactTemplateTransforms(
  authority: string,
  operations: readonly TemplateOperation[],
): string {
  return operations.reduce((source, operation) => {
    const matches = source.split(operation.search).length - 1;
    if (operation.search.length === 0 || matches !== 1) {
      throw new Error(
        `Template operation must match exactly once; received ${matches}`,
      );
    }
    return source.replace(operation.search, operation.replacement);
  }, authority);
}
