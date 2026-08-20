import {
  validatePinnedMemberTransforms,
  type PinnedMemberTransformContract,
} from "../official-source-body-contract";

export const officialGeneratorCoreMemberContract = {
  authorityClass: "CredentialGeneratorComponent",
  authoritySha256:
    "060a0e00d686c3a9a2cb422880fe171e7dccd7d4b0691a0783bee86b53c56e0b",
  runtimeClass: "OfficialGeneratorCoreComponent",
  transforms: [
    {
      authorityMember: "destroyed",
      runtimeMember: "destroyed",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "Algorithm",
      runtimeMember: "Algorithm",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "account",
      runtimeMember: "account",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "account$",
      runtimeMember: "account$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "onGenerated",
      runtimeMember: "onGenerated",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "root$",
      runtimeMember: "root$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "onRootChanged",
      runtimeMember: "onRootChanged",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "username",
      runtimeMember: "username",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "rootOptions$",
      runtimeMember: "rootOptions$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "usernameOptions$",
      runtimeMember: "usernameOptions$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "maybeAlgorithm$",
      runtimeMember: "maybeAlgorithm$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "algorithm$",
      runtimeMember: "algorithm$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "credentialTypeCopyLabel$",
      runtimeMember: "credentialTypeCopyLabel$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "credentialTypeGenerateLabel$",
      runtimeMember: "credentialTypeGenerateLabel$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "credentialTypeLabel$",
      runtimeMember: "credentialTypeLabel$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "credentialTypeHint$",
      runtimeMember: "credentialTypeHint$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "category$",
      runtimeMember: "category$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "generatedCredential$",
      runtimeMember: "generatedCredential$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "value$",
      runtimeMember: "value$",
      operations: [
        {
          kind: "replace",
          search: 'map((generated) => generated?.credential ?? "-")',
          replacement: 'map((generated) => generated?.credential ?? "")',
        },
      ],
      retainedAuthorityFragments: ["protected readonly value$"],
      retainedAuthorityStatements: [],
    },
    {
      authorityMember: "USER_REQUEST",
      runtimeMember: "USER_REQUEST",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "generate$",
      runtimeMember: "generate$",
      operations: [],
      retainedAuthorityFragments: ["[[member-skeleton]]"],
      retainedAuthorityStatements: [],
      allowUnchanged: true,
    },
    {
      authorityMember: "toOptions",
      runtimeMember: "toOptions",
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
          kind: "remove",
          search: ", private logService: LogService",
        },
        {
          kind: "replace",
          search: "private accountService: AccountService",
          replacement:
            "private accountService: OfficialGeneratorAccountAdapter",
        },
      ],
      retainedAuthorityFragments: [
        "private generatorService: CredentialGeneratorService",
      ],
      retainedAuthorityStatements: [],
      allowNoRetainedStatement: true,
    },
    {
      authorityMember: "ngOnChanges",
      runtimeMember: "ngOnChanges",
      operations: [
        {
          kind: "replace",
          search:
            "[[statement:0]]\nconst account = changes?.account;\n[[/statement:0]]",
          replacement:
            '[[statement:0]]\nconst account = changes?.["account"];\n[[/statement:0]]',
        },
        {
          kind: "replace",
          search:
            '[[statement:1]]\nif (account?.previousValue?.id !== account?.currentValue?.id) {\n    this.log.debug({\n        previousUserId: account?.previousValue?.id as UserId,\n        currentUserId: account?.currentValue?.id as UserId,\n    }, "account input change detected");\n    this.account$.next(account.currentValue ?? this.account);\n}\n[[/statement:1]]',
          replacement:
            "[[statement:1]]\nif (account?.previousValue?.id !== account?.currentValue?.id) {\n    this.account$.next(account.currentValue ?? this.account);\n}\n[[/statement:1]]",
        },
      ],
      retainedAuthorityFragments: ["async ngOnChanges(changes: SimpleChanges)"],
      retainedAuthorityStatements: [],
      allowNoRetainedStatement: true,
    },
    {
      authorityMember: "ngOnInit",
      runtimeMember: "ngOnInit",
      operations: [
        {
          kind: "replace",
          search:
            '[[statement:0]]\nthis.log = ifEnabledSemanticLoggerProvider(this.debug, this.logService, {\n    type: "CredentialGeneratorComponent",\n});\n[[/statement:0]]\n[[statement:1]]\nif (!this.account) {\n    const account = await firstValueFrom(this.accountService.activeAccount$);\n    if (!account) {\n        this.log.panic("active account cannot be `null`.");\n    }\n    this.log.info({ userId: account.id }, "account not specified; using active account settings");\n    this.account$.next(account);\n}\n[[/statement:1]]\n[[statement:2]]\ncombineLatest([\n    this.generatorService.algorithms$("email", { account$: this.account$ }),\n    this.generatorService.algorithms$("username", { account$: this.account$ }),\n])\n    .pipe(map((algorithms) => algorithms.flat()), map((algorithms) => {\n    const usernames = algorithms.filter((a) => !isForwarderExtensionId(a.id));\n    usernames.sort((a, b) => a.weight - b.weight);\n    const usernameOptions = this.toOptions(usernames);\n    usernameOptions.splice(-1, 0, {\n        value: FORWARDER,\n        label: this.i18nService.t("forwardedEmail"),\n    });\n    const forwarders = algorithms.filter((a) => isForwarderExtensionId(a.id));\n    forwarders.sort((a, b) => a.weight - b.weight);\n    const forwarderOptions = this.toOptions(forwarders);\n    forwarderOptions.unshift({ value: NONE_SELECTED, label: this.i18nService.t("select") });\n    return [usernameOptions, forwarderOptions] as const;\n}), tap((algorithms) => this.log.debug({ algorithms: algorithms as object }, "algorithms loaded")), takeUntil(this.destroyed))\n    .subscribe(([usernames, forwarders]) => {\n    this.zone.run(() => {\n        this.usernameOptions$.next(usernames);\n        this.forwarderOptions$.next(forwarders);\n    });\n});\n[[/statement:2]]\n[[statement:3]]\nthis.generatorService\n    .algorithms$("password", { account$: this.account$ })\n    .pipe(map((algorithms) => {\n    const options = this.toOptions(algorithms);\n    options.push({ value: IDENTIFIER, label: this.i18nService.t("username") });\n    return options;\n}), takeUntil(this.destroyed))\n    .subscribe(this.rootOptions$);\n[[/statement:3]]',
          replacement:
            '[[statement:0]]\nconst account = this.account ?? await firstValueFrom(this.accountService.activeAccount$);\n[[/statement:0]]\n[[statement:1]]\nif (!account) {\n    throw new Error("Active account is unavailable");\n}\nelse if (!this.account) {\n    this.account$.next(account);\n}\n[[/statement:1]]\n[[statement:2]]\ncombineLatest([\n    this.generatorService.algorithms$("email", { account$: this.account$ }),\n    this.generatorService.algorithms$("username", { account$: this.account$ }),\n])\n    .pipe(map((algorithms) => algorithms.flat()), map((algorithms) => {\n    algorithms.sort((a, b) => a.weight - b.weight);\n    return this.toOptions(algorithms);\n}), takeUntil(this.destroyed))\n    .subscribe((usernames) => {\n    this.zone.run(() => {\n        this.usernameOptions$.next(usernames);\n    });\n});\n[[/statement:2]]\n[[statement:3]]\nthis.generatorService\n    .algorithms$("password", { account$: this.account$ })\n    .pipe(map((algorithms) => {\n    const options = this.toOptions(algorithms);\n    options.push({ value: IDENTIFIER, label: this.i18nService.t("username") });\n    return options;\n}), takeUntil(this.destroyed))\n    .subscribe(this.rootOptions$);\n[[/statement:3]]',
        },
        {
          kind: "replace",
          search:
            '[[statement:6]]\nthis.generatorService\n    .generate$({\n    on$: this.generate$,\n    account$: this.account$,\n})\n    .pipe(catchError((error: unknown, generator) => {\n    if (typeof error === "string") {\n        this.toastService.showToast({\n            message: error,\n            variant: "error",\n            title: "",\n        });\n    }\n    else {\n        this.logService.error(error);\n    }\n    return generator;\n}), withLatestFrom(this.account$, this.maybeAlgorithm$), takeUntil(this.destroyed))\n    .subscribe(([generated, account, algorithm]) => {\n    this.log.debug({ source: generated.source ?? null, algorithm: algorithm?.id ?? null }, "credential generated");\n    const algorithmId = typeof algorithm?.id === "string" ? algorithm.id : undefined;\n    this.generatorHistoryService\n        .track(account.id, generated.credential, generated.category, generated.generationDate, algorithmId)\n        .catch((e: unknown) => {\n        this.logService.error(e);\n    });\n    this.zone.run(() => {\n        if (algorithm && generated.source === this.USER_REQUEST) {\n            this.announce(translate(algorithm.i18nKeys.credentialGenerated, this.i18nService));\n        }\n        this.generatedCredential$.next(generated);\n        this.onGenerated.next(generated);\n    });\n});\n[[/statement:6]]',
          replacement:
            '[[statement:6]]\nthis.generatorService\n    .generate$({\n    on$: this.generate$,\n    account$: this.account$,\n})\n    .pipe(catchError((error: unknown, generator) => {\n    if (typeof error === "string") {\n        this.toastService.showToast({\n            message: error,\n            variant: "error",\n            title: "",\n        });\n    }\n    else {\n        this.toastService.showToast({ message: this.i18nService.t("i18nUnableToGenerateCredential"), variant: "error", title: "" });\n    }\n    return generator;\n}), withLatestFrom(this.account$, this.maybeAlgorithm$), takeUntil(this.destroyed))\n    .subscribe(([generated, account, algorithm]) => {\n    const algorithmId = typeof algorithm?.id === "string" ? algorithm.id : undefined;\n    this.generatorHistoryService\n        .track(account.id, generated.credential, generated.category, generated.generationDate, algorithmId)\n        .catch(() => {\n        this.toastService.showToast({ message: this.i18nService.t("i18nUnableToUpdateGeneratorHistory"), variant: "error", title: "" });\n    });\n    this.zone.run(() => {\n        if (algorithm && generated.source === this.USER_REQUEST) {\n            this.announce(translate(algorithm.i18nKeys.credentialGenerated, this.i18nService));\n        }\n        this.generatedCredential$.next(generated);\n        this.onGenerated.next(generated);\n    });\n});\n[[/statement:6]]',
        },
        {
          kind: "replace",
          search:
            '[[statement:9]]\nconst activeIdentifier$ = new Subject<CascadeValue>();\n[[/statement:9]]\n[[statement:10]]\nconst activeForwarder$ = new Subject<CascadeValue>();\n[[/statement:10]]\n[[statement:11]]\nthis.root$\n    .pipe(map((root): CascadeValue => {\n    if (root.nav === IDENTIFIER) {\n        return { nav: root.nav };\n    }\n    else if (root.nav) {\n        return { nav: root.nav, algorithm: JSON.parse(root.nav) };\n    }\n    else {\n        return { nav: IDENTIFIER };\n    }\n}), takeUntil(this.destroyed))\n    .subscribe(activeRoot$);\n[[/statement:11]]\n[[statement:12]]\nthis.username.valueChanges\n    .pipe(map((username): CascadeValue => {\n    if (username.nav === FORWARDER) {\n        return { nav: username.nav };\n    }\n    else if (username.nav) {\n        return { nav: username.nav, algorithm: JSON.parse(username.nav) };\n    }\n    else {\n        const [algorithm] = AlgorithmsByType[Type.username];\n        return { nav: JSON.stringify(algorithm), algorithm };\n    }\n}), takeUntil(this.destroyed))\n    .subscribe(activeIdentifier$);\n[[/statement:12]]\n[[statement:13]]\nthis.forwarder.valueChanges\n    .pipe(map((forwarder): CascadeValue => {\n    if (forwarder.nav === NONE_SELECTED) {\n        return { nav: forwarder.nav };\n    }\n    else if (forwarder.nav) {\n        return { nav: forwarder.nav, algorithm: JSON.parse(forwarder.nav) };\n    }\n    else {\n        return { nav: NONE_SELECTED };\n    }\n}), takeUntil(this.destroyed))\n    .subscribe(activeForwarder$);\n[[/statement:13]]\n[[statement:14]]\ncombineLatest([activeRoot$, activeIdentifier$, activeForwarder$])\n    .pipe(map(([root, username, forwarder]) => {\n    const showForwarder = !root.algorithm && !username.algorithm;\n    const forwarderId = showForwarder && forwarder.algorithm && isForwarderExtensionId(forwarder.algorithm)\n        ? forwarder.algorithm.forwarder\n        : null;\n    return [showForwarder, forwarderId] as const;\n}), distinctUntilChanged((prev, next) => prev[0] === next[0] && prev[1] === next[1]), takeUntil(this.destroyed))\n    .subscribe(([showForwarder, forwarderId]) => {\n    this.log.debug({ forwarderId, showForwarder }, "forwarder visibility updated");\n    this.zone.run(() => {\n        this.showForwarder$.next(showForwarder);\n        this.forwarderId$.next(forwarderId);\n    });\n});\n[[/statement:14]]\n[[statement:15]]\ncombineLatest([activeRoot$, activeIdentifier$, activeForwarder$])\n    .pipe(map(([root, username, forwarder]) => {\n    const selection = root.algorithm ?? username.algorithm ?? forwarder.algorithm;\n    if (selection) {\n        return this.generatorService.algorithm(selection);\n    }\n    else {\n        return null;\n    }\n}), distinctUntilChanged((prev, next) => {\n    if (prev === null || next === null) {\n        return false;\n    }\n    else {\n        return isSameAlgorithm(prev.id, next.id);\n    }\n}), takeUntil(this.destroyed))\n    .subscribe((algorithm) => {\n    this.log.debug({ algorithm: algorithm?.id ?? null }, "algorithm selected");\n    this.zone.run(() => {\n        this.maybeAlgorithm$.next(algorithm);\n    });\n});\n[[/statement:15]]\n[[statement:16]]\nconst preferences = await this.generatorService.preferences({ account$: this.account$ });\n[[/statement:16]]\n[[statement:17]]\nthis.algorithm$\n    .pipe(withLatestFrom(preferences), takeUntil(this.destroyed))\n    .subscribe(([algorithm, preference]) => {\n    function setPreference(type: CredentialType) {\n        const p = preference[type];\n        p.algorithm = algorithm.id;\n        p.updated = new Date();\n    }\n    if (isEmailAlgorithm(algorithm.id)) {\n        setPreference("email");\n    }\n    else if (isUsernameAlgorithm(algorithm.id)) {\n        setPreference("username");\n    }\n    else if (isPasswordAlgorithm(algorithm.id)) {\n        setPreference("password");\n    }\n    else {\n        return;\n    }\n    this.log.info({ algorithm: algorithm.id, type: algorithm.type }, "algorithm preferences updated");\n    preferences.next(preference);\n});\n[[/statement:17]]\n[[statement:18]]\npreferences\n    .pipe(map(({ email, username, password }) => {\n    const usernamePref = email.updated > username.updated ? email : username;\n    const forwarderPref = isForwarderExtensionId(usernamePref.algorithm)\n        ? usernamePref\n        : null;\n    const forwarderNav = !forwarderPref\n        ? NONE_SELECTED\n        : JSON.stringify(forwarderPref.algorithm);\n    const userNav = forwarderPref ? FORWARDER : JSON.stringify(usernamePref.algorithm);\n    const rootNav = usernamePref.updated > password.updated\n        ? IDENTIFIER\n        : JSON.stringify(password.algorithm);\n    const cascade = {\n        root: {\n            selection: { nav: rootNav },\n            active: {\n                nav: rootNav,\n                algorithm: rootNav === IDENTIFIER ? undefined : password.algorithm,\n            } as CascadeValue,\n        },\n        username: {\n            selection: { nav: userNav },\n            active: {\n                nav: userNav,\n                algorithm: forwarderPref ? undefined : usernamePref.algorithm,\n            },\n        },\n        forwarder: {\n            selection: { nav: forwarderNav },\n            active: {\n                nav: forwarderNav,\n                algorithm: forwarderPref?.algorithm,\n            },\n        },\n    };\n    return cascade;\n}), takeUntil(this.destroyed))\n    .subscribe(({ root, username, forwarder }) => {\n    this.log.debug({\n        root: root.selection,\n        username: username.selection,\n        forwarder: forwarder.selection,\n    }, "navigation updated");\n    this.onRootChanged(root.selection);\n    this.username.setValue(username.selection, { emitEvent: false });\n    this.forwarder.setValue(forwarder.selection, { emitEvent: false });\n    activeRoot$.next(root.active);\n    activeIdentifier$.next(username.active);\n    activeForwarder$.next(forwarder.active);\n});\n[[/statement:18]]\n[[statement:19]]\nthis.maybeAlgorithm$.pipe(takeUntil(this.destroyed)).subscribe((a) => {\n    this.zone.run(() => {\n        if (a?.capabilities?.autogenerate) {\n            this.log.debug("autogeneration enabled");\n            this.generate("autogenerate").catch((e: unknown) => {\n                this.log.error(e as object, "a failure occurred during autogeneration");\n            });\n        }\n        else {\n            this.log.debug("autogeneration disabled; clearing generated credential");\n            this.generatedCredential$.next(undefined);\n        }\n    });\n});\n[[/statement:19]]\n[[statement:20]]\nthis.log.debug("component initialized");\n[[/statement:20]]',
          replacement:
            '[[statement:9]]\nconst activeIdentifier$ = new Subject<CascadeValue>();\n[[/statement:9]]\n[[statement:10]]\nthis.root$\n    .pipe(map((root): CascadeValue => {\n    if (root.nav === IDENTIFIER) {\n        return { nav: root.nav };\n    }\n    else if (root.nav) {\n        return { nav: root.nav, algorithm: JSON.parse(root.nav) };\n    }\n    else {\n        return { nav: IDENTIFIER };\n    }\n}), takeUntil(this.destroyed))\n    .subscribe(activeRoot$);\n[[/statement:10]]\n[[statement:11]]\nthis.username.valueChanges\n    .pipe(map((username): CascadeValue => {\n    if (username.nav) {\n        return { nav: username.nav, algorithm: JSON.parse(username.nav) };\n    }\n    const [algorithm] = AlgorithmsByType[Type.username];\n    return { nav: JSON.stringify(algorithm), algorithm };\n}), takeUntil(this.destroyed))\n    .subscribe(activeIdentifier$);\n[[/statement:11]]\n[[statement:12]]\ncombineLatest([activeRoot$, activeIdentifier$])\n    .pipe(map(([root, username]) => {\n    const selection = root.algorithm ?? username.algorithm;\n    if (selection) {\n        return this.generatorService.algorithm(selection);\n    }\n    else {\n        return null;\n    }\n}), distinctUntilChanged((prev, next) => {\n    if (prev === null || next === null) {\n        return false;\n    }\n    else {\n        return isSameAlgorithm(prev.id, next.id);\n    }\n}), takeUntil(this.destroyed))\n    .subscribe((algorithm) => {\n    this.zone.run(() => {\n        this.maybeAlgorithm$.next(algorithm);\n    });\n});\n[[/statement:12]]\n[[statement:13]]\nconst preferences = await this.generatorService.preferences({ account$: this.account$ });\n[[/statement:13]]\n[[statement:14]]\nthis.algorithm$\n    .pipe(withLatestFrom(preferences), takeUntil(this.destroyed))\n    .subscribe(([algorithm, preference]) => {\n    function setPreference(type: "password" | "username" | "email") {\n        preference[type].algorithm = algorithm.id;\n        preference[type].updated = new Date();\n    }\n    if (isEmailAlgorithm(algorithm.id)) {\n        setPreference("email");\n    }\n    else if (isUsernameAlgorithm(algorithm.id)) {\n        setPreference("username");\n    }\n    else if (isPasswordAlgorithm(algorithm.id)) {\n        setPreference("password");\n    }\n    else {\n        return;\n    }\n    preferences.next(preference);\n});\n[[/statement:14]]\n[[statement:15]]\npreferences\n    .pipe(map(({ email, username, password }) => {\n    const usernamePreference = email.updated > username.updated ? email : username;\n    const usernameNav = JSON.stringify(usernamePreference.algorithm);\n    const rootNav = usernamePreference.updated > password.updated\n        ? IDENTIFIER\n        : JSON.stringify(password.algorithm);\n    return {\n        root: {\n            selection: { nav: rootNav },\n            active: {\n                nav: rootNav,\n                algorithm: rootNav === IDENTIFIER ? undefined : password.algorithm,\n            } as CascadeValue,\n        },\n        username: {\n            selection: { nav: usernameNav },\n            active: { nav: usernameNav, algorithm: usernamePreference.algorithm },\n        },\n    };\n}), takeUntil(this.destroyed))\n    .subscribe(({ root, username }) => {\n    this.onRootChanged(root.selection);\n    this.username.setValue(username.selection, { emitEvent: false });\n    activeRoot$.next(root.active);\n    activeIdentifier$.next(username.active);\n});\n[[/statement:15]]\n[[statement:16]]\nthis.maybeAlgorithm$.pipe(takeUntil(this.destroyed)).subscribe((a) => {\n    this.zone.run(() => {\n        if (a?.capabilities?.autogenerate) {\n            this.generate("autogenerate").catch(() => {\n                this.toastService.showToast({ message: this.i18nService.t("i18nUnableToGenerateCredential"), variant: "error", title: "" });\n            });\n        }\n        else {\n            this.generatedCredential$.next(undefined);\n        }\n    });\n});\n[[/statement:16]]',
        },
      ],
      retainedAuthorityFragments: ["async ngOnInit()"],
      retainedAuthorityStatements: [
        {
          index: 4,
          source:
            'this.maybeAlgorithm$\n    .pipe(map((a) => {\n    if (a?.i18nKeys?.description) {\n        return translate(a.i18nKeys.description, this.i18nService);\n    }\n    else {\n        return "";\n    }\n}), takeUntil(this.destroyed))\n    .subscribe((hint) => {\n    this.zone.run(() => {\n        this.credentialTypeHint$.next(hint);\n    });\n});',
        },
        {
          index: 5,
          source:
            "this.maybeAlgorithm$\n    .pipe(map((a) => a?.type), distinctUntilChanged(), takeUntil(this.destroyed))\n    .subscribe((category) => {\n    this.zone.run(() => {\n        this.category$.next(category);\n    });\n});",
        },
        {
          index: 7,
          source:
            "type CascadeValue = {\n    nav: string;\n    algorithm?: CredentialAlgorithm;\n};",
        },
        {
          index: 8,
          source: "const activeRoot$ = new Subject<CascadeValue>();",
        },
      ],
    },
    {
      authorityMember: "announce",
      runtimeMember: "announce",
      operations: [
        {
          kind: "replace",
          search:
            "[[statement:0]]\nthis.ariaLive.announce(message).catch((e) => this.logService.error(e));\n[[/statement:0]]",
          replacement:
            "[[statement:0]]\nthis.ariaLive.announce(message).catch(() => undefined);\n[[/statement:0]]",
        },
      ],
      retainedAuthorityFragments: ["private announce(message: string)"],
      retainedAuthorityStatements: [],
      allowNoRetainedStatement: true,
    },
    {
      authorityMember: "showAlgorithm$",
      runtimeMember: "showAlgorithm$",
      operations: [
        {
          kind: "replace",
          search:
            "this.maybeAlgorithm$.pipe(combineLatestWith(this.showForwarder$), map(([algorithm, showForwarder]) => (showForwarder ? null : algorithm)))",
          replacement: "this.maybeAlgorithm$",
        },
      ],
      retainedAuthorityFragments: ["protected showAlgorithm$;"],
      retainedAuthorityStatements: [],
    },
    {
      authorityMember: "generate",
      runtimeMember: "generate",
      operations: [
        {
          kind: "replace",
          search:
            '[[statement:2]]\nif (this.website) {\n    request.website = this.website;\n}\n[[/statement:2]]\n[[statement:3]]\nthis.log.debug(request, "generation requested");\n[[/statement:3]]\n[[statement:4]]\nthis.generate$.next(request);\n[[/statement:4]]',
          replacement:
            "[[statement:2]]\nthis.generate$.next(request);\n[[/statement:2]]",
        },
      ],
      retainedAuthorityFragments: ["protected async generate(source: string)"],
      retainedAuthorityStatements: [
        {
          index: 0,
          source: "const algorithm = await firstValueFrom(this.algorithm$);",
        },
        {
          index: 1,
          source:
            "const request: GenerateRequest = { source, algorithm: algorithm.id };",
        },
      ],
    },
    {
      authorityMember: "ngOnDestroy",
      runtimeMember: "ngOnDestroy",
      operations: [
        {
          kind: "remove",
          search:
            '\n[[statement:5]]\nthis.log.debug("component destroyed");\n[[/statement:5]]',
        },
      ],
      retainedAuthorityFragments: ["this.destroyed.next();"],
      retainedAuthorityStatements: [
        {
          index: 0,
          source: "this.destroyed.next();",
        },
        {
          index: 1,
          source: "this.destroyed.complete();",
        },
        {
          index: 2,
          source: "this.generate$.complete();",
        },
        {
          index: 3,
          source: "this.generatedCredential$.complete();",
        },
        {
          index: 4,
          source: "this.onGenerated.complete();",
        },
      ],
    },
  ],
  enforceCompleteRuntimeMembers: true,
  runtimeOnlyMembers: [],
} as const satisfies PinnedMemberTransformContract;

export function validateOfficialGeneratorMemberTransforms(
  authoritySource: string,
  runtimeSource: string,
): string[] {
  return validatePinnedMemberTransforms(
    authoritySource,
    runtimeSource,
    officialGeneratorCoreMemberContract,
  );
}

export const officialGeneratorHistoryParentMemberContract = {
  authorityClass: "CredentialGeneratorHistoryComponent",
  authoritySha256:
    "135ed3e3f83612bdeb0f03df5db0b4dadddfddd178098b6ae0b40e74d1131bfd",
  runtimeClass: "OfficialGeneratorHistoryComponent",
  transforms: [
    unchangedMember("destroyed"),
    unchangedMember("hasHistory$"),
    unchangedMember("account$"),
    {
      authorityMember: "ngOnDestroy",
      runtimeMember: "ngOnDestroy",
      operations: [
        {
          kind: "replace",
          search: "ngOnDestroy()",
          replacement: "ngOnDestroy(): void",
        },
        {
          kind: "replace",
          search:
            '[[statement:2]]\nthis.log.debug("component destroyed");\n[[/statement:2]]',
          replacement:
            "[[statement:2]]\nthis.history.destroy();\n[[/statement:2]]",
        },
      ],
      retainedAuthorityFragments: ["this.destroyed.next();"],
      retainedAuthorityStatements: [
        { index: 0, source: "this.destroyed.next();" },
        { index: 1, source: "this.destroyed.complete();" },
      ],
    },
  ],
  enforceCompleteRuntimeMembers: true,
  runtimeOnlyMembers: [
    runtimeMember("loading$", "Route-scoped secure history loading state.", "debb7ec7f6210e8465a5a060bb21edc2343054aab46c3acec9ff7cc56f27566d"),
    runtimeMember("clearing$", "Native clear operation pending state.", "a7a34bf1a4a81ecc0c69608c56d61f4f696925f20efba38cc509ec8c68d67e26"),
    runtimeMember("statusMessage$", "Sanitized native adapter failure status.", "d5d768d75e4a9f1d771e7d9c8ad7a9dbb0ef0aea3173e45d7da3b74e45e86262"),
    runtimeMember("confirming", "Synchronous duplicate native confirmation guard.", "fc25fbbffb0fe3d3d7b3aea2cbffc89be50ac7d45a42b0501266c1eb64461cee"),
    runtimeMember("clearDialog", "Shared application bottom-sheet ownership.", "84203a93de5bf221fc56609190d7599fa94dda70719ce8109028ee09f4e10b60"),
    runtimeMember("clearTrigger", "Native dialog trigger focus restoration.", "8f22309f52e7f07643904bdd251ca14d38ced56aa782747cb7351606d905cf7f"),
    runtimeMember("clearCancel", "Native dialog initial cancel focus.", "59fd2e728a7c150ba2df3d93808c7b06455e592c7c19ff5dbc4bc935b33ee56d"),
    runtimeMember("constructor", "Tauri account and history adapter injection boundary.", "5a2b605f897e4b8839af048f7b7c036e195a9f2daf257dd4d0fd93da303b4b3c"),
    runtimeMember("ngOnInit", "Owned one-shot secure history projection lifecycle.", "7f1e206ea23cbea11c4537e976d226795186cc44cee6fd5b092710913ddbb66c"),
    runtimeMember("clear", "Shared bottom sheet replaces official DialogService.", "3980dfabfa67775cc4c9857d3bccd322a491c63ee7dcba667e65ae3b8ea41ecd"),
    runtimeMember("cancelClear", "Native dialog cancel command boundary.", "b09c1ddd9c8036e86fb71113b726171d4e35bc76b18e281050782eadfd2c4f56"),
    runtimeMember("confirmClear", "Session-owned transactional clear command.", "5a0c76461165f51412d273f69e79443e67a9a964d3b8e1a93613569e5d49c49d"),
    runtimeMember("closeDialog", "Shared bottom-sheet deterministic close adapter.", "7e2b121ac24880bb6763b16ee2ce6d3c51b940e8ee5e9b765cdd227f19c28d6f"),
  ],
} as const satisfies PinnedMemberTransformContract;

export const officialGeneratorHistoryRowsMemberContract = {
  authorityClass: "CredentialGeneratorHistoryComponent",
  authoritySha256:
    "def6a043801b7a02f97c9f7dfc59a4b84732692e9df26489a46a3614a55ffe0b",
  runtimeClass: "OfficialGeneratorHistoryRowsComponent",
  transforms: [
    unchangedMember("destroyed"),
    unchangedMember("credentials$"),
    {
      authorityMember: "constructor",
      runtimeMember: "constructor",
      operations: [{
        kind: "replace",
        search: "private logService: LogService",
        replacement: "private historyView: OfficialGeneratorHistoryViewAdapter",
      }],
      retainedAuthorityFragments: ["private generatorService: CredentialGeneratorService"],
      retainedAuthorityStatements: [],
      allowNoRetainedStatement: true,
    },
    {
      authorityMember: "account",
      runtimeMember: "account",
      operations: [{ kind: "replace", search: "account: Account;", replacement: "account!: Account;" }],
      retainedAuthorityFragments: ["@Input({ required: true })"],
      retainedAuthorityStatements: [],
      allowNoRetainedStatement: true,
    },
    unchangedMember("account$"),
    {
      authorityMember: "ngOnChanges",
      runtimeMember: "ngOnChanges",
      operations: [
        { kind: "replace", search: "async ngOnChanges(changes: SimpleChanges)", replacement: "async ngOnChanges(changes: SimpleChanges): Promise<void>" },
        { kind: "replace", search: "const account = changes?.account;", replacement: 'const account = changes?.["account"];' },
        {
          kind: "replace",
          search:
            '    this.log.debug({\n        previousUserId: account?.previousValue?.id as UserId,\n        currentUserId: account?.currentValue?.id as UserId,\n    }, "account input change detected");\n',
          replacement: "",
        },
      ],
      retainedAuthorityFragments: ["this.account$.next(account.currentValue ?? this.account);"],
      retainedAuthorityStatements: [],
      allowNoRetainedStatement: true,
    },
    {
      authorityMember: "ngOnInit",
      runtimeMember: "ngOnInit",
      operations: [
        { kind: "replace", search: "ngOnInit()", replacement: "ngOnInit(): void" },
        {
          kind: "remove",
          search:
            '[[statement:0]]\nthis.log = ifEnabledSemanticLoggerProvider(this.debug, this.logService, {\n    type: "CredentialGeneratorComponent",\n});\n[[/statement:0]]\n',
        },
        {
          kind: "remove",
          search: 'tap((account) => this.log.info({ accountId: account.id }, "loading credential history")), ',
        },
        {
          kind: "replace",
          search: 'map((credentials) => credentials.filter((c) => (c.credential ?? "") !== ""))',
          replacement: 'map((credentials) => credentials.filter((credential) => credential.credential !== ""))',
        },
        { kind: "replace", search: "[[statement:1]]", replacement: "[[statement:0]]" },
        { kind: "replace", search: "[[/statement:1]]", replacement: "[[/statement:0]]" },
      ],
      retainedAuthorityFragments: ["this.history.credentials$(account.id)"],
      retainedAuthorityStatements: [],
      allowNoRetainedStatement: true,
    },
    unchangedMember("getCopyText"),
    unchangedMember("getGeneratedValueText"),
    unchangedMember("algorithmId"),
    {
      authorityMember: "ngOnDestroy",
      runtimeMember: "ngOnDestroy",
      operations: [
        { kind: "replace", search: "ngOnDestroy()", replacement: "ngOnDestroy(): void" },
        {
          kind: "remove",
          search: '\n[[statement:2]]\nthis.log.debug("component destroyed");\n[[/statement:2]]',
        },
      ],
      retainedAuthorityFragments: ["this.destroyed.next();"],
      retainedAuthorityStatements: [
        { index: 0, source: "this.destroyed.next();" },
        { index: 1, source: "this.destroyed.complete();" },
      ],
    },
  ],
  enforceCompleteRuntimeMembers: true,
  runtimeOnlyMembers: [
    runtimeMember("copy", "Native clipboard policy replaces appCopyClick.", "8d39f0fd480f5f8f09603ed6b19576918e546ffaab72ca5bd105671e98db27a1"),
  ],
} as const satisfies PinnedMemberTransformContract;

export const officialEmptyGeneratorHistoryMemberContract = {
  authorityClass: "EmptyCredentialHistoryComponent",
  authoritySha256:
    "f4eed1dd01f5983b6d961e324b6d18010afcd82962352f501e3bf1ec5b16fd65",
  runtimeClass: "OfficialEmptyGeneratorHistoryComponent",
  transforms: [
    unchangedMember("noCredentialsIcon"),
    unchangedMember("constructor"),
  ],
  enforceCompleteRuntimeMembers: true,
  runtimeOnlyMembers: [],
} as const satisfies PinnedMemberTransformContract;

export const officialGeneratorHistoryDeletedAuthorityMembers = {
  parent: ["account", "debug", "log", "ngOnChanges"] as const,
  rows: ["debug", "log"] as const,
};

export function validateOfficialGeneratorHistoryParentMemberTransforms(
  authoritySource: string,
  runtimeSource: string,
): string[] {
  return validatePinnedMemberTransforms(
    authoritySource,
    runtimeSource,
    officialGeneratorHistoryParentMemberContract,
  );
}

export function validateOfficialGeneratorHistoryRowsMemberTransforms(
  authoritySource: string,
  runtimeSource: string,
): string[] {
  return validatePinnedMemberTransforms(
    authoritySource,
    runtimeSource,
    officialGeneratorHistoryRowsMemberContract,
  );
}

export function validateOfficialEmptyGeneratorHistoryMemberTransforms(
  authoritySource: string,
  runtimeSource: string,
): string[] {
  return validatePinnedMemberTransforms(
    authoritySource,
    runtimeSource,
    officialEmptyGeneratorHistoryMemberContract,
  );
}

function unchangedMember(member: string) {
  return {
    authorityMember: member,
    runtimeMember: member,
    operations: [],
    retainedAuthorityFragments: ["[[member-skeleton]]"],
    retainedAuthorityStatements: [],
    allowUnchanged: true,
  } as const;
}

function runtimeMember(runtimeMemberName: string, justification: string, canonicalSha256: string) {
  return { runtimeMember: runtimeMemberName, justification, canonicalSha256 } as const;
}

export type ExactContinuousBlockTransform = {
  readonly search: string;
  readonly replacement: string;
};

export type ExactContinuousSourceContract = {
  readonly authority: string;
  readonly runtime: string;
  readonly authoritySha256: string;
  readonly transforms: readonly ExactContinuousBlockTransform[];
};

export const generatorTemplateContracts = [
  {
    authority:
      "libs/tools/generator/components/src/credential-generator.component.html",
    runtime:
      "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-core.component.html",
    authoritySha256:
      "c907585b53fe214b153707ad1dace68a5801cc30f0f9a2ac79c204ba1ba9734e",
    transforms: [
      {
        search:
          '<!-- FIXME: root$ should be powered using a reactive form -->\n<bit-toggle-group\n  fullWidth\n  class="tw-mb-4"\n  [selected]="(root$ | async).nav"\n  (selectedChange)="onRootChanged({ nav: $event })"\n  attr.aria-label="{{ \'type\' | i18n }}"\n>\n  @for (option of rootOptions$ | async; track option) {\n    <bit-toggle [value]="option.value">\n      {{ option.label }}\n    </bit-toggle>\n  }\n</bit-toggle-group>\n\n',
        replacement: "",
      },
      {
        search: "<nudge-generator-spotlight></nudge-generator-spotlight>\n\n",
        replacement: "",
      },
      {
        search:
          '    <bit-color-password class="tw-font-mono" [password]="value$ | async"></bit-color-password>',
        replacement:
          '    @let generatedValue = value$ | async;\n    @if (generatedValue) {\n      <bit-color-password class="tw-font-mono" [password]="generatedValue"></bit-color-password>\n    } @else {\n      <p class="macos-generator-preparing" role="status">{{ "i18nGenerating" | i18n }}</p>\n    }',
      },
      {
        search:
          '      showToast\n      [label]="credentialTypeCopyLabel$ | async"\n      [appCopyClick]="value$ | async"\n      [valueLabel]="credentialTypeLabel$ | async"\n      [disabled]="!(algorithm$ | async)"',
        replacement:
          '      [label]="credentialTypeCopyLabel$ | async"\n      [valueLabel]="credentialTypeLabel$ | async"\n      [disabled]="!(algorithm$ | async)"\n      [bwGeneratorClipboard]="value$ | async"',
      },
      {
        search:
          '<bit-card class="tw-flex tw-justify-between tw-mb-4">\n  <div class="tw-grow tw-flex tw-items-center tw-min-w-0">',
        replacement:
          '<section class="macos-generator__result" aria-labelledby="generator-result-title">\n  <h2 id="generator-result-title" class="tw-sr-only">{{ "generator" | i18n }}</h2>\n  <div class="macos-generator__value">',
      },
      {
        search: '  <div class="tw-flex tw-items-center tw-space-x-1">',
        replacement: '  <div class="macos-generator__result-actions">',
      },
      {
        search:
          '    <button\n      type="button"\n      bitIconButton="bwi-generate"\n      buttonType="primaryGhost"\n      (click)="generate(USER_REQUEST)"\n      [label]="credentialTypeGenerateLabel$ | async"\n      [disabled]="!(algorithm$ | async)"\n    >\n      {{ credentialTypeGenerateLabel$ | async }}\n    </button>\n    <button\n      type="button"\n      bitIconButton="bwi-clone"\n      buttonType="primaryGhost"\n      [label]="credentialTypeCopyLabel$ | async"\n      [valueLabel]="credentialTypeLabel$ | async"\n      [disabled]="!(algorithm$ | async)"\n      [bwGeneratorClipboard]="value$ | async"\n    ></button>',
        replacement:
          '    <button\n      class="macos-hit-target"\n      data-testid="generator-copy"\n      data-popup-focus-key="generator:copy"\n      type="button"\n      bitIconButton="bwi-clone"\n      buttonType="primary"\n      [label]="credentialTypeCopyLabel$ | async"\n      [valueLabel]="credentialTypeLabel$ | async"\n      [disabled]="!(algorithm$ | async)"\n      [bwGeneratorClipboard]="value$ | async"\n    ></button>\n    <button\n      class="macos-hit-target"\n      data-testid="generator-regenerate"\n      type="button"\n      bitIconButton="bwi-generate"\n      buttonType="primaryGhost"\n      (click)="generate(USER_REQUEST)"\n      [label]="credentialTypeGenerateLabel$ | async"\n      [disabled]="!(algorithm$ | async)"\n    >\n      {{ credentialTypeGenerateLabel$ | async }}\n    </button>',
      },
      {
        search: "  </div>\n</bit-card>\n@let showAlgorithm = showAlgorithm$ | async;",
        replacement:
          '  </div>\n</section>\n<!-- FIXME: root$ should be powered using a reactive form -->\n<section class="macos-generator__mode">\n  <bit-toggle-group\n    fullWidth\n    [selected]="(root$ | async).nav"\n    (selectedChange)="onRootChanged({ nav: $event })"\n    attr.aria-label="{{ \'type\' | i18n }}"\n  >\n    @for (option of rootOptions$ | async; track option) {\n      <bit-toggle [value]="option.value">\n        {{ option.label }}\n      </bit-toggle>\n    }\n  </bit-toggle-group>\n</section>\n<section class="macos-generator__settings">\n@let showAlgorithm = showAlgorithm$ | async;',
      },
      {
        search:
          '@if ((category$ | async) !== "password") {\n  <bit-section>\n    <bit-section-header>\n      <h2 bitTypography="h6">{{ "options" | i18n }}</h2>\n    </bit-section-header>\n    <div class="tw-mb-4">\n      <bit-card>\n        <form [formGroup]="username" class="tw-container">\n          <bit-form-field>\n            <bit-label>{{ "type" | i18n }}</bit-label>\n            <bit-select\n              [items]="usernameOptions$ | async"\n              formControlName="nav"\n              data-testid="username-type"\n            >\n            </bit-select>\n            @if (credentialTypeHint$ | async) {\n              <bit-hint>{{ credentialTypeHint$ | async }}</bit-hint>\n            }\n          </bit-form-field>\n        </form>\n        @if (showForwarder$ | async) {\n          <form [formGroup]="forwarder" class="tw-container">\n            <bit-form-field>\n              <bit-label>{{ "service" | i18n }}</bit-label>\n              <bit-select\n                [items]="forwarderOptions$ | async"\n                formControlName="nav"\n                data-testid="email-forwarding-service"\n              >\n              </bit-select>\n            </bit-form-field>\n          </form>\n        }\n        @if (showAlgorithm?.id === Algorithm.catchall) {\n          <tools-catchall-settings\n            [account]="account"\n            (onUpdated)="generate(\'catchall settings\')"\n          />\n        }\n        @if (forwarderId$ | async; as forwarderId) {\n          <tools-forwarder-settings [account]="account" [forwarder]="forwarderId" />\n        }\n        @if (showAlgorithm?.id === Algorithm.plusAddress) {\n          <tools-subaddress-settings\n            [account]="account"\n            (onUpdated)="generate(\'subaddress settings\')"\n          />\n        }\n        @if (showAlgorithm?.id === Algorithm.username) {\n          <tools-username-settings\n            [account]="account"\n            (onUpdated)="generate(\'username settings\')"\n          />\n        }\n      </bit-card>\n    </div>\n  </bit-section>\n}\n',
        replacement:
          '@if ((category$ | async) !== "password") {\n  <bit-section>\n    <bit-section-header>\n      <h2 bitTypography="h6">{{ "options" | i18n }}</h2>\n    </bit-section-header>\n    <div class="tw-mb-4">\n      <bit-card>\n        <form [formGroup]="username" class="tw-container">\n          <bit-form-field>\n            <bit-label>{{ "type" | i18n }}</bit-label>\n            <bit-select\n              [items]="usernameOptions$ | async"\n              formControlName="nav"\n              data-testid="username-type"\n            >\n            </bit-select>\n            @if (credentialTypeHint$ | async) {\n              <bit-hint>{{ credentialTypeHint$ | async }}</bit-hint>\n            }\n          </bit-form-field>\n        </form>\n        @if (showAlgorithm?.id === Algorithm.catchall) {\n          <tools-catchall-settings\n            [account]="account"\n            (onUpdated)="generate(\'catchall settings\')"\n          />\n        }\n        @if (showAlgorithm?.id === Algorithm.plusAddress) {\n          <tools-subaddress-settings\n            [account]="account"\n            (onUpdated)="generate(\'subaddress settings\')"\n          />\n        }\n        @if (showAlgorithm?.id === Algorithm.username) {\n          <tools-username-settings\n            [account]="account"\n            (onUpdated)="generate(\'username settings\')"\n          />\n        }\n      </bit-card>\n    </div>\n  </bit-section>\n}\n</section>\n',
      },
      {
        search:
          '          <bit-form-field>\n            <bit-label>{{ "type" | i18n }}</bit-label>\n            <bit-select\n              [items]="usernameOptions$ | async"',
        replacement:
          '          <bit-form-field class="macos-field-owner">\n            <bit-label>{{ "type" | i18n }}</bit-label>\n            <bit-select\n              class="macos-control-visible"\n              [items]="usernameOptions$ | async"',
      },
    ],
  },
  {
    authority:
      "apps/browser/src/tools/popup/generator/credential-generator.component.html",
    runtime:
      "apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.html",
    authoritySha256:
      "d334de44aee06d8efbdfefbc79c3452247548005275a37f7e1a95fcef6b2691a",
    transforms: [
      {
        search: "<popup-page>",
        replacement:
          '<popup-page class="macos-generator" data-generator-layout="result-first">',
      },
      {
        search: "      <app-pop-out />\n      <app-current-account />",
        replacement: "      <bw-popup-header-actions />",
      },
      {
        search: "  <tools-credential-generator />",
        replacement: "  <bw-official-generator-core />",
      },
      {
        search:
          '  <bit-item>\n    <a type="button" bit-item-content routerLink="/generator-history">',
        replacement:
          '  <bit-item class="macos-generator__history-row">\n    <a class="macos-generator__history-link" data-popup-focus-key="generator:history" bit-item-content routerLink="/generator-history">',
      },
    ],
  },
  {
    authority:
      "apps/browser/src/tools/popup/generator/credential-generator-history.component.html",
    runtime:
      "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.html",
    authoritySha256:
      "71d92f22dbfbfc72db18a85f97d526228b4e31e60609dd4a05c8c2ee48fabdc8",
    transforms: [
      { search: "<popup-page>", replacement: '<popup-page [attr.aria-busy]="loading$ | async">' },
      {
        search:
          '  <bit-empty-credential-history *ngIf="!(hasHistory$ | async)" style="display: contents" />\n  <bit-credential-generator-history [account]="account$ | async" *ngIf="hasHistory$ | async" />',
        replacement:
          '  @if (!(loading$ | async)) {\n    <section class="macos-generator-history__content" data-testid="generator-history-content">\n      <bit-empty-credential-history *ngIf="!(hasHistory$ | async)" style="display: contents" />\n      <bit-credential-generator-history\n        role="list"\n        [account]="account$ | async"\n        *ngIf="hasHistory$ | async"\n      />\n    </section>\n  }',
      },
      {
        search:
          '  <popup-footer slot="footer">\n    <button\n      [disabled]="!(hasHistory$ | async)"\n      bitButton\n      type="submit"\n      buttonType="primary"\n      (click)="clear()"\n    >\n      {{ "clearHistory" | i18n }}\n    </button>\n  </popup-footer>',
        replacement:
          '  @if (statusMessage$ | async; as statusMessage) {\n    <bw-macos-alert-strip\n      kind="danger"\n      [title]="\'i18nGeneratorHistoryFailed\' | i18n"\n      [message]="statusMessage"\n    />\n  }\n  @if ((hasHistory$ | async) && !(loading$ | async)) {\n    <popup-footer slot="footer">\n      <button\n        #clearTrigger\n        class="macos-generator-history__clear-action"\n        data-testid="generator-history-clear"\n        [disabled]="clearing$ | async"\n        bitButton\n        type="submit"\n        buttonType="primary"\n        (click)="clear()"\n      >\n        {{ "clearHistory" | i18n }}\n      </button>\n    </popup-footer>\n  }',
      },
      {
        search: "\n</popup-page>",
        replacement:
          '\n  <bw-app-bottom-sheet\n    #clearDialog\n    labelledBy="generator-history-dialog-title"\n    describedBy="generator-history-dialog-description"\n    testId="generator-history-dialog"\n    (dismissed)="cancelClear()"\n  >\n    <form class="app-bottom-sheet-panel">\n      <header class="app-bottom-sheet-header">\n        <h2 id="generator-history-dialog-title">\n          {{ "clearGeneratorHistoryTitle" | i18n }}\n        </h2>\n      </header>\n      <div class="app-bottom-sheet-body">\n        <p id="generator-history-dialog-description">\n          {{ "cleargGeneratorHistoryDescription" | i18n }}\n        </p>\n      </div>\n      <footer class="app-bottom-sheet-footer">\n        <button\n          #clearCancel\n          class="macos-generator-history__sheet-action"\n          data-testid="generator-history-clear-cancel"\n          bitButton\n          buttonType="secondary"\n          type="button"\n          [disabled]="confirming || (clearing$ | async)"\n          (click)="cancelClear()"\n        >\n          {{ "cancel" | i18n }}\n        </button>\n        <button\n          class="macos-generator-history__sheet-action"\n          data-testid="generator-history-clear-confirm"\n          bitButton\n          buttonType="danger"\n          type="button"\n          [disabled]="confirming || (clearing$ | async)"\n          (click)="confirmClear()"\n        >\n          {{ "clearHistory" | i18n }}\n        </button>\n      </footer>\n    </form>\n  </bw-app-bottom-sheet>\n</popup-page>',
      },
    ],
  },
  {
    authority:
      "libs/tools/generator/components/src/credential-generator-history.component.html",
    runtime:
      "apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history-rows.component.html",
    authoritySha256:
      "2eef6e1fcc3d03b4685dacff58e9b7afb5204ac62038372f942e21c4b65a28b7",
    transforms: [
      {
        search: "@for (credential of credentials$ | async; track credential) {",
        replacement:
          "@for (credential of credentials$ | async; track credential; let historyIndex = $index) {",
      },
      {
        search: "  <bit-item>",
        replacement: '  <bit-item\n    class="macos-generator-history__row macos-row macos-row--double"\n    role="listitem"\n    [attr.aria-label]="getGeneratedValueText(credential)"\n  >',
      },
      {
        search:
          '          [appCopyClick]="credential.credential"\n          [valueLabel]="getGeneratedValueText(credential)"\n          [label]="getCopyText(credential)"\n          showToast',
        replacement:
          '          [attr.data-popup-focus-key]="\'generator-history:\' + credential.generationDate.getTime() + \':\' + historyIndex"\n          [label]="getCopyText(credential)"\n          (click)="copy(credential, $event.currentTarget)"',
      },
    ],
  },
  {
    authority:
      "libs/tools/generator/components/src/empty-credential-history.component.html",
    runtime:
      "apps/menubar-tauri/src/app/upstream-overlays/generator/official-empty-generator-history.component.html",
    authoritySha256:
      "84f3c4f1a1f8d0288bec387047b7233b9ec039cff39d3b788ab29ee93b1e616e",
    transforms: [],
  },
] as const satisfies readonly ExactContinuousSourceContract[];

export function applyExactContinuousBlockTransforms(
  authoritySource: string,
  contract: ExactContinuousSourceContract,
): string {
  let transformed = authoritySource;
  for (const [index, operation] of contract.transforms.entries()) {
    const matches =
      operation.search.length === 0
        ? 0
        : transformed.split(operation.search).length - 1;
    if (matches !== 1) {
      throw new Error(
        `${contract.authority} block ${index + 1} must match exactly once; received ${matches}`,
      );
    }
    if (operation.search === authoritySource) {
      throw new Error(`${contract.authority} cannot replace the whole source`);
    }
    transformed = transformed.replace(operation.search, operation.replacement);
  }
  return transformed;
}
