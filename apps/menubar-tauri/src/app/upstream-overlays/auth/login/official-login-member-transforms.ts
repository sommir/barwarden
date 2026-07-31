import type { PinnedMemberTransformContract } from "../../official-source-body-contract";

export const loginMemberContract = {
  authorityClass: "LoginComponent",
  authoritySha256:
    "1ef2a3bf77baaa4e25b559f5cee1b46fb5251ee79035236b9c8f9aa6dbd771b0",
  runtimeClass: "OfficialPasswordLoginComponent",
  transforms: [
    {
      authorityMember: "ngOnInit",
      runtimeMember: "ngOnInit",
      operations: [
        {
          kind: "replace",
          search:
            '[[statement:0]]\nwindow.addEventListener("popstate", this.handlePopState);\n[[/statement:0]]',
          replacement:
            "[[statement:0]]\nthis.navigationEmail = this.auth.takeNavigationEmail();\n[[/statement:0]]",
        },
        {
          kind: "remove",
          search:
            "[[statement:2]]\nif (this.clientType === ClientType.Desktop) {\n    await this.desktopOnInit();\n}\n[[/statement:2]]\n",
        },
      ],
      retainedAuthorityFragments: ["ngOnInit()"],
      retainedAuthorityStatements: [
        { index: 1, source: "await this.defaultOnInit();" },
      ],
    },
    {
      authorityMember: "continuePressed",
      runtimeMember: "continuePressed",
      operations: [
        {
          kind: "remove",
          search: "protected ",
        },
        {
          kind: "remove",
          search: "mpEntryLayoutOverride?: Partial<AnonLayoutWrapperData>",
        },
        {
          kind: "replace",
          search: ") {\n}\n[[/member-skeleton]]",
          replacement: "): Promise<void> {\n}\n[[/member-skeleton]]",
        },
        {
          kind: "replace",
          search:
            '[[statement:0]]\nhistory.pushState({}, "", window.location.href);\n[[/statement:0]]',
          replacement:
            "[[statement:0]]\nconst mpEntryLayoutOverride = undefined;\n[[/statement:0]]",
        },
      ],
      retainedAuthorityFragments: ["continuePressed("],
      retainedAuthorityStatements: [
        {
          index: 1,
          source: "await this.continue(mpEntryLayoutOverride);",
        },
      ],
    },
    {
      authorityMember: "submit",
      runtimeMember: "submit",
      operations: [
        {
          kind: "replace",
          search:
            "[[statement:0]]\nif (this.clientType === ClientType.Desktop) {\n    if (this.loginUiState !== LoginUiState.MASTER_PASSWORD_ENTRY) {\n        return;\n    }\n}\n[[/statement:0]]",
          replacement:
            "[[statement:0]]\nif (this.loginUiState !== LoginUiState.MASTER_PASSWORD_ENTRY) {\n    await this.continuePressed();\n    return;\n}\n[[/statement:0]]",
        },
        {
          kind: "replace",
          search:
            "[[statement:3]]\nif (this.formGroup.invalid) {\n    return;\n}\n[[/statement:3]]",
          replacement:
            "[[statement:3]]\nif (this.submitting) {\n    return;\n}\n[[/statement:3]]",
        },
        {
          kind: "replace",
          search:
            '[[statement:4]]\nif (!email || !masterPassword) {\n    this.logService.error("Email and master password are required");\n    return;\n}\n[[/statement:4]]',
          replacement:
            "[[statement:4]]\nthis.submitting = true;\n[[/statement:4]]",
        },
        {
          kind: "replace",
          search:
            "[[statement:5]]\nthis.orgPoliciesFromInvite = this.loginComponentService.getOrgPoliciesFromOrgInvite\n    ? await this.loginComponentService.getOrgPoliciesFromOrgInvite(email)\n    : null;\n[[/statement:5]]",
          replacement:
            "[[statement:5]]\nconst operation = ++this.navigationEpoch;\n[[/statement:5]]",
        },
        {
          kind: "replace",
          search:
            "[[statement:6]]\nconst orgMasterPasswordPolicyOptions = this.orgPoliciesFromInvite?.enforcedPasswordPolicyOptions;\n[[/statement:6]]",
          replacement:
            '[[statement:6]]\nconst normalizedEmail = email?.trim() ?? "";\n[[/statement:6]]',
        },
        {
          kind: "remove",
          search:
            "[[statement:9]]\ntry {\n    const authResult = await this.loginStrategyService.logIn(credentials);\n    await this.handleAuthResult(authResult);\n}\ncatch (error) {\n    this.logService.error(error);\n    await this.handleSubmitError(error);\n}\n[[/statement:9]]\n",
        },
        {
          kind: "replace",
          search:
            "[[statement:8]]\nconst credentials = new PasswordLoginCredentials(email, masterPassword, undefined, orgMasterPasswordPolicyOptions, preFetchedPreloginData);\n[[/statement:8]]\n",
          replacement:
            '[[statement:8]]\ntry {\n    if (this.formGroup.invalid ||\n        !normalizedEmail ||\n        !submittedMasterPassword ||\n        !this.environmentIsValid ||\n        !isValidHttpsServerUrl(this.serverUrl)) {\n        this.focusMasterPassword();\n        return;\n    }\n    this.store.setLoginError("");\n    this.authPending = true;\n    let result: RetainedLoginResult;\n    try {\n        result = await this.auth.login({\n            email: normalizedEmail,\n            masterPassword: submittedMasterPassword,\n            serverUrl: this.serverUrl,\n        });\n    }\n    catch {\n        if (this.isCurrent(operation) && !this.store.snapshot().loginError) {\n            this.store.setLoginError(translateOfficialMessage("i18nUnableToLoginServer"));\n        }\n        return;\n    }\n    finally {\n        this.authPending = false;\n    }\n    const state = this.store.snapshot();\n    if (!this.canNavigate(operation, result, normalizedEmail, state)) {\n        return;\n    }\n    try {\n        const navigated = await this.router.navigateByUrl(result === "vault"\n            ? "/tabs/vault"\n            : result === "twoFactor"\n                ? "/2fa"\n                : "/new-device-verification");\n        if (!navigated && this.isCurrent(operation)) {\n            this.store.setStatus(translateOfficialMessage("i18nUnableToNavigate"));\n        }\n        else if (navigated) {\n            transitionAccepted = true;\n        }\n    }\n    catch {\n        if (this.isCurrent(operation)) {\n            this.store.setStatus(translateOfficialMessage("i18nUnableToNavigate"));\n        }\n    }\n}\nfinally {\n    submittedMasterPassword = "";\n    if (!transitionAccepted) {\n        this.clearMasterPassword();\n    }\n    if (!transitionAccepted && this.navigationEpoch === operation) {\n        this.submitting = false;\n    }\n}\n[[/statement:8]]\n',
        },
        {
          kind: "replace",
          search:
            "[[statement:7]]\nconst preFetchedPreloginData = await firstValueFrom(this.passwordPreloginService.getPreloginData$(email));\n[[/statement:7]]\n",
          replacement:
            '[[statement:7]]\nlet submittedMasterPassword = masterPassword ?? "", transitionAccepted = false;\n[[/statement:7]]\n',
        },
      ],
      retainedAuthorityFragments: ["submit = async (): Promise<void> =>"],
      retainedAuthorityStatements: [
        {
          index: 1,
          source: "const { email, masterPassword } = this.formGroup.value;",
        },
        { index: 2, source: "this.formGroup.markAllAsTouched();" },
      ],
    },
    {
      authorityMember: "ngOnDestroy",
      runtimeMember: "ngOnDestroy",
      operations: [
        {
          kind: "replace",
          search:
            '[[statement:0]]\nwindow.removeEventListener("popstate", this.handlePopState);\n[[/statement:0]]',
          replacement: "[[statement:0]]\nthis.alive = false;\n[[/statement:0]]",
        },
        {
          kind: "replace",
          search:
            "[[statement:1]]\nif (this.clientType === ClientType.Desktop) {\n    this.broadcasterService.unsubscribe(BroadcasterSubscriptionId);\n}\n[[/statement:1]]",
          replacement:
            "[[statement:1]]\nthis.invalidateNavigation();\n[[/statement:1]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:4]]\nif (this.authPending) {\n    this.auth.cancel();\n}\n[[/statement:4]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:5]]\nthis.clearMasterPassword();\n[[/statement:5]]\n[[end-member]]",
        },
      ],
      retainedAuthorityFragments: ["ngOnDestroy(): void"],
      retainedAuthorityStatements: [
        { index: 2, source: "this.destroy$.next();" },
        { index: 3, source: "this.destroy$.complete();" },
      ],
    },
  ],
} as const satisfies PinnedMemberTransformContract;

export const hintMemberContract = {
  authorityClass: "PasswordHintComponent",
  authoritySha256:
    "e54d5e56c6c1e411dee574a7ac3d0ab8a6613362153aaeb51d9a61b8608e4f75",
  runtimeClass: "OfficialPasswordHintComponent",
  transforms: [
    {
      authorityMember: "ngOnInit",
      runtimeMember: "ngOnInit",
      operations: [
        {
          kind: "replace",
          search:
            '[[statement:0]]\nconst email = (await firstValueFrom(this.loginEmailService.loginEmail$)) ?? "";\n[[/statement:0]]',
          replacement:
            "[[statement:0]]\nconst email = await this.initialEmail();\n[[/statement:0]]",
        },
      ],
      retainedAuthorityFragments: ["ngOnInit(): Promise<void>"],
      retainedAuthorityStatements: [
        {
          index: 1,
          source: "this.formGroup.controls.email.setValue(email);",
        },
      ],
    },
    {
      authorityMember: "submit",
      runtimeMember: "submit",
      operations: [
        {
          kind: "replace",
          search: "() => {\n};\n[[/member-skeleton]]",
          replacement: "(): Promise<void> => {\n};\n[[/member-skeleton]]",
        },
        {
          kind: "replace",
          search:
            "[[statement:0]]\nconst isEmailValid = this.validateEmailOrShowToast(this.email);\n[[/statement:0]]",
          replacement:
            "[[statement:0]]\nconst isEmailValid = this.prepareSubmission();\n[[/statement:0]]",
        },
        {
          kind: "replace",
          search:
            "[[statement:2]]\nawait this.apiService.postPasswordHint(new PasswordHintRequest(this.email));\n[[/statement:2]]",
          replacement:
            "[[statement:2]]\nconst operation = ++this.navigationEpoch;\n[[/statement:2]]",
        },
        {
          kind: "replace",
          search:
            '[[statement:3]]\nthis.toastService.showToast({\n    variant: "success",\n    title: null,\n    message: this.i18nService.t("masterPassSent"),\n});\n[[/statement:3]]',
          replacement:
            "[[statement:3]]\nconst serverUrl = this.store.snapshot().serverUrl;\n[[/statement:3]]",
        },
        {
          kind: "replace",
          search:
            '[[statement:4]]\nawait this.router.navigate(["login"]);\n[[/statement:4]]',
          replacement:
            '[[statement:4]]\nconst email = this.formGroup.controls.email.value?.trim() ?? "";\n[[/statement:4]]',
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            '[[statement:5]]\ntry {\n    await this.hint.request(serverUrl, email);\n}\ncatch {\n    if (this.isCurrent(operation)) {\n        this.store.setStatus(translateOfficialMessage("i18nRequestPasswordHintFailed"));\n    }\n    return;\n}\nfinally {\n    if (this.navigationEpoch === operation) {\n        this.submitting = false;\n    }\n}\n[[/statement:5]]\n[[end-member]]',
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:6]]\nif (!this.isCurrent(operation) || this.store.snapshot().serverUrl !== serverUrl) {\n    return;\n}\n[[/statement:6]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            '[[statement:7]]\nthis.store.setStatus(translateOfficialMessage("i18nMasterPasswordHintSent"));\n[[/statement:7]]\n[[end-member]]',
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:8]]\nthis.auth.setNavigationEmail(email);\n[[/statement:8]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            '[[statement:9]]\ntry {\n    await this.router.navigateByUrl("/login");\n}\ncatch {\n}\n[[/statement:9]]\n[[end-member]]',
        },
      ],
      retainedAuthorityFragments: ["submit = async"],
      retainedAuthorityStatements: [
        {
          index: 1,
          source: "if (!isEmailValid) {\n    return;\n}",
        },
      ],
    },
    {
      authorityMember: "cancel",
      runtimeMember: "cancel",
      operations: [
        {
          kind: "remove",
          search: "protected ",
        },
        {
          kind: "replace",
          search: " {\n}\n[[/member-skeleton]]",
          replacement: ": Promise<void> {\n}\n[[/member-skeleton]]",
        },
        {
          kind: "replace",
          search:
            '[[statement:1]]\nawait this.router.navigate(["login"]);\n[[/statement:1]]',
          replacement:
            "[[statement:1]]\nconst operation = ++this.navigationEpoch;\n[[/statement:1]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:2]]\nthis.submitting = false;\n[[/statement:2]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:3]]\nthis.auth.cancel();\n[[/statement:3]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:4]]\nif (!this.isCurrent(operation)) {\n    return;\n}\n[[/statement:4]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            '[[statement:5]]\ntry {\n    await this.router.navigateByUrl("/login");\n}\ncatch {\n}\n[[/statement:5]]\n[[end-member]]',
        },
      ],
      retainedAuthorityFragments: ["async cancel()"],
      retainedAuthorityStatements: [
        {
          index: 0,
          source: "await this.loginEmailService.setLoginEmail(this.email);",
        },
      ],
    },
  ],
} as const satisfies PinnedMemberTransformContract;
