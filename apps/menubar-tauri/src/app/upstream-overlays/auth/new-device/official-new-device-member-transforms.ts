import type { PinnedMemberTransformContract } from "../../official-source-body-contract";

export const newDeviceMemberContract = {
  authorityClass: "NewDeviceVerificationComponent",
  authoritySha256:
    "dfbfecc6cb79f9c494e3ae9a3f81729f3240831c1efc47de854660566477cb85",
  runtimeClass: "OfficialNewDeviceVerificationComponent",
  transforms: [
    {
      authorityMember: "ngOnInit",
      runtimeMember: "ngOnInit",
      operations: [
        {
          kind: "replace",
          search:
            "[[statement:1]]\nthis.loginStrategySessionTimeoutService.loginSessionTimeout$\n    .pipe(takeUntil(this.destroy$))\n    .subscribe(() => {\n    try {\n        void this.router.navigate([this.authenticationSessionTimeoutRoute]);\n    }\n    catch (err) {\n        this.logService.error(`Failed to navigate to ${this.authenticationSessionTimeoutRoute} route`, err);\n    }\n});\n[[/statement:1]]",
          replacement:
            "[[statement:1]]\nthis.challenge.refresh();\n[[/statement:1]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:2]]\nthis.expirySubscription = this.challenge.expiresAt$.pipe(takeUntil(this.destroy$)).subscribe((expiresAt) => {\n    this.scheduleExpiry(expiresAt);\n});\n[[/statement:2]]\n[[end-member]]",
        },
      ],
      retainedAuthorityFragments: ["ngOnInit()"],
      retainedAuthorityStatements: [
        {
          index: 0,
          source:
            "this.showBackButton = this.newDeviceVerificationComponentService.showBackButton();",
        },
      ],
    },
    {
      authorityMember: "ngOnDestroy",
      runtimeMember: "ngOnDestroy",
      operations: [
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:2]]\nthis.alive = false;\n[[/statement:2]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:3]]\nthis.operationEpoch += 1;\n[[/statement:3]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:4]]\nthis.activeAction.set(null);\n[[/statement:4]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:5]]\nthis.disableRequestOTP = true;\n[[/statement:5]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:6]]\nthis.clearExpiryTimer();\n[[/statement:6]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:7]]\nthis.expirySubscription?.unsubscribe();\n[[/statement:7]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:8]]\nif (this.ownsChallenge) {\n    this.challenge.cancel();\n}\n[[/statement:8]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            '[[statement:9]]\nthis.formGroup.controls.code.setValue("");\n[[/statement:9]]\n[[end-member]]',
        },
      ],
      retainedAuthorityFragments: ["ngOnDestroy()"],
      retainedAuthorityStatements: [
        { index: 0, source: "this.destroy$.next();" },
        { index: 1, source: "this.destroy$.complete();" },
      ],
    },
    {
      authorityMember: "resendOTP",
      runtimeMember: "resendOTP",
      operations: [
        {
          kind: "replace",
          search: " {\n}\n[[/member-skeleton]]",
          replacement: ": Promise<void> {\n}\n[[/member-skeleton]]",
        },
        {
          kind: "replace",
          search:
            '[[statement:1]]\ntry {\n    const email = await this.loginStrategyService.getEmail();\n    const masterPasswordHash = await this.loginStrategyService.getMasterPasswordHash();\n    if (!email || !masterPasswordHash) {\n        throw new Error("Missing email or master password hash");\n    }\n    await this.apiService.send("POST", "/accounts/resend-new-device-otp", {\n        email: email,\n        masterPasswordHash: masterPasswordHash,\n    }, false, false);\n}\ncatch (e) {\n    this.logService.error(e);\n}\nfinally {\n    this.disableRequestOTP = false;\n}\n[[/statement:1]]',
          replacement:
            "[[statement:1]]\nif (!this.ownsChallenge || this.activeAction() !== null) {\n    return;\n}\n[[/statement:1]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            '[[statement:2]]\nthis.activeAction.set("resend");\n[[/statement:2]]\n[[end-member]]',
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:3]]\nconst operation = this.operationEpoch;\n[[/statement:3]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            '[[statement:4]]\ntry {\n    await this.challenge.resendOtp();\n}\nfinally {\n    if (this.isCurrent(operation) && this.activeAction() === "resend") {\n        this.activeAction.set(null);\n        this.disableRequestOTP = false;\n    }\n}\n[[/statement:4]]\n[[end-member]]',
        },
      ],
      retainedAuthorityFragments: ["resendOTP()"],
      retainedAuthorityStatements: [
        { index: 0, source: "this.disableRequestOTP = true;" },
      ],
    },
    {
      authorityMember: "submit",
      runtimeMember: "submit",
      operations: [
        {
          kind: "replace",
          search:
            '[[statement:2]]\ntry {\n    const authResult = await this.loginStrategyService.logInNewDeviceVerification(codeControl.value);\n    if (authResult.requiresTwoFactor) {\n        await this.router.navigate(["/2fa"]);\n        return;\n    }\n    await this.loginSuccessHandlerService.run(authResult.userId, authResult.masterPassword);\n    const activeUserId = await firstValueFrom(this.accountService.activeAccount$.pipe(getUserId));\n    const forceSetPasswordReason = await firstValueFrom(this.masterPasswordService.forceSetPasswordReason$(activeUserId));\n    if (forceSetPasswordReason === ForceSetPasswordReason.WeakMasterPassword ||\n        forceSetPasswordReason === ForceSetPasswordReason.AdminForcePasswordReset) {\n        await this.router.navigate(["/change-password"]);\n    }\n    else {\n        await this.router.navigate(["/vault"]);\n    }\n}\ncatch (e) {\n    this.logService.error(e);\n    let errorMessage = ((e as any)?.response?.error_description as string) ?? this.i18nService.t("errorOccurred");\n    if (errorMessage.includes("Invalid New Device OTP")) {\n        errorMessage = this.i18nService.t("invalidVerificationCode");\n    }\n    codeControl.setErrors({ serverError: { message: errorMessage } });\n    codeControl.markAsTouched();\n}\n[[/statement:2]]',
          replacement:
            "[[statement:2]]\nif (this.disableRequestOTP || !this.ownsChallenge) {\n    return;\n}\n[[/statement:2]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            '[[statement:3]]\nconst code = codeControl.value?.trim() ?? "";\n[[/statement:3]]\n[[end-member]]',
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:4]]\ncodeControl.setValue(code);\n[[/statement:4]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:5]]\nif (!code) {\n    codeControl.markAsTouched();\n    return;\n}\n[[/statement:5]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            '[[statement:6]]\nthis.activeAction.set("submit");\n[[/statement:6]]\n[[end-member]]',
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:7]]\nthis.disableRequestOTP = true;\n[[/statement:7]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:8]]\nlet operation = this.operationEpoch, transitionAccepted = false;\n[[/statement:8]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            '[[statement:9]]\ntry {\n    const outcome = await this.challenge.submitOtp(code);\n    if (this.isCurrent(operation)) {\n        transitionAccepted = await this.transferRoute(outcome);\n    }\n}\nfinally {\n    if (!transitionAccepted) {\n        codeControl.setValue("");\n    }\n    if (!transitionAccepted &&\n        this.isCurrent(operation) &&\n        this.activeAction() === "submit") {\n        this.activeAction.set(null);\n        this.disableRequestOTP = !this.ownsChallenge;\n    }\n}\n[[/statement:9]]\n[[end-member]]',
        },
      ],
      retainedAuthorityFragments: ["submit = async (): Promise<void> =>"],
      retainedAuthorityStatements: [
        {
          index: 0,
          source: 'const codeControl = this.formGroup.get("code");',
        },
        {
          index: 1,
          source: "if (!codeControl || !codeControl.value) {\n    return;\n}",
        },
      ],
    },
    {
      authorityMember: "onPaste",
      runtimeMember: "onPaste",
      operations: [
        {
          kind: "replace",
          search: " {\n}\n[[/member-skeleton]]",
          replacement: ": void {\n}\n[[/member-skeleton]]",
        },
        {
          kind: "replace",
          search:
            '[[statement:3]]\nthis.formGroup.get("code")?.setValue(pastedText);\n[[/statement:3]]',
          replacement:
            "[[statement:3]]\nthis.formGroup.controls.code.setValue(pastedText);\n[[/statement:3]]",
        },
      ],
      retainedAuthorityFragments: ["onPaste(event: ClipboardEvent)"],
      retainedAuthorityStatements: [
        {
          index: 0,
          source:
            'const pastedText = event.clipboardData?.getData("text")?.trim() ?? "";',
        },
      ],
    },
    {
      authorityMember: "goBack",
      runtimeMember: "goBack",
      operations: [
        {
          kind: "replace",
          search: "[[member-skeleton]]\nprotected ",
          replacement: "[[member-skeleton]]\nasync ",
        },
        {
          kind: "replace",
          search: " {\n}\n[[/member-skeleton]]",
          replacement: ": Promise<void> {\n}\n[[/member-skeleton]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:1]]\nthis.operationEpoch += 1;\n[[/statement:1]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:2]]\nthis.activeAction.set(null);\n[[/statement:2]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:3]]\nthis.disableRequestOTP = true;\n[[/statement:3]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:4]]\nthis.ownsChallenge = false;\n[[/statement:4]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:5]]\nthis.clearExpiryTimer();\n[[/statement:5]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            "[[statement:6]]\nthis.challenge.cancel();\n[[/statement:6]]\n[[end-member]]",
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            '[[statement:7]]\nthis.formGroup.controls.code.setValue("");\n[[/statement:7]]\n[[end-member]]',
        },
        {
          kind: "replace",
          search: "[[end-member]]",
          replacement:
            '[[statement:8]]\ntry {\n    const navigated = await this.router.navigateByUrl("/login");\n    if (!navigated) {\n        window.location.hash = "#/login";\n    }\n}\ncatch {\n    window.location.hash = "#/login";\n}\n[[/statement:8]]\n[[end-member]]',
        },
      ],
      retainedAuthorityFragments: ["goBack()"],
      retainedAuthorityStatements: [
        { index: 0, source: "this.location.back();" },
      ],
    },
  ],
} as const satisfies PinnedMemberTransformContract;
