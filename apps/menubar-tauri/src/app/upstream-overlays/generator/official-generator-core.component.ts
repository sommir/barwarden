import { LiveAnnouncer } from "@angular/cdk/a11y";
import { AsyncPipe } from "@angular/common";
import {
  Component,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
} from "@angular/core";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  ReplaySubject,
  Subject,
  takeUntil,
  withLatestFrom,
} from "rxjs";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { Account } from "@bitwarden/common/auth/abstractions/account.service";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import {
  ToastService,
  Option,
  CardComponent,
  ColorPasswordComponent,
  BitIconButtonComponent,
  FormFieldModule,
  SectionComponent,
  SectionHeaderComponent,
  SelectModule,
  ToggleGroupModule,
  TypographyModule,
} from "@bitwarden/components";
import {
  AlgorithmsByType,
  CredentialGeneratorService,
  GenerateRequest,
  GeneratedCredential,
  isSameAlgorithm,
  isEmailAlgorithm,
  isPasswordAlgorithm,
  isUsernameAlgorithm,
  CredentialAlgorithm,
  AlgorithmMetadata,
  Algorithm,
  Type,
} from "@bitwarden/generator-core";
import { GeneratorHistoryService } from "@bitwarden/generator-history";
import { I18nPipe } from "@bitwarden/ui-common";

import { PassphraseSettingsComponent } from "@bitwarden/generator-overlay/passphrase-settings";
import { PasswordSettingsComponent } from "@bitwarden/generator-overlay/password-settings";
import { UsernameSettingsComponent } from "@bitwarden/generator-overlay/username-settings";
import { SubaddressSettingsComponent } from "@bitwarden/generator-overlay/subaddress-settings";
import { CatchallSettingsComponent } from "@bitwarden/generator-overlay/catchall-settings";
import { GeneratorClipboardDirective } from "../../generator/generator-clipboard.directive";
import { OfficialGeneratorAccountAdapter } from "../../generator/official-generator-account.adapter";
import { translate } from "../../generator/official-generator-translate.adapter";

const IDENTIFIER = "identifier";

// FIXME(https://bitwarden.atlassian.net/browse/CL-764): Migrate to OnPush
// eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection
@Component({
  selector: "bw-official-generator-core",
  templateUrl: "./official-generator-core.component.html",
  imports: [
    ToggleGroupModule,
    CardComponent,
    ColorPasswordComponent,
    BitIconButtonComponent,
    GeneratorClipboardDirective,
    PasswordSettingsComponent,
    PassphraseSettingsComponent,
    UsernameSettingsComponent,
    SubaddressSettingsComponent,
    CatchallSettingsComponent,
    SectionComponent,
    SectionHeaderComponent,
    TypographyModule,
    ReactiveFormsModule,
    FormFieldModule,
    SelectModule,
    AsyncPipe,
    JslibModule,
    I18nPipe,
  ],
})
export class OfficialGeneratorCoreComponent implements OnInit, OnChanges, OnDestroy {
  private readonly destroyed = new Subject<void>();

  constructor(
    private generatorService: CredentialGeneratorService,
    private generatorHistoryService: GeneratorHistoryService,
    private toastService: ToastService,
    private i18nService: I18nService,
    private accountService: OfficialGeneratorAccountAdapter,
    private zone: NgZone,
    private formBuilder: FormBuilder,
    private ariaLive: LiveAnnouncer,
  ) {}

  /** exports algorithm symbols to the template */
  protected readonly Algorithm = Algorithm;

  /** Binds the component to a specific user's settings. When this input is not provided,
   * the form binds to the active user
   */
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-signals
  @Input()
  account: Account | null = null;

  protected account$ = new ReplaySubject<Account>(1);

  async ngOnChanges(changes: SimpleChanges) {
    const account = changes?.["account"];
    if (account?.previousValue?.id !== account?.currentValue?.id) {
      this.account$.next(account.currentValue ?? this.account);
    }
  }

  /** Emits credentials created from a generation request. */
  // FIXME(https://bitwarden.atlassian.net/browse/CL-903): Migrate to Signals
  // eslint-disable-next-line @angular-eslint/prefer-output-emitter-ref
  @Output()
  readonly onGenerated = new EventEmitter<GeneratedCredential>();

  protected root$ = new BehaviorSubject<{ nav: string | null }>({
    nav: null,
  });

  protected onRootChanged(value: { nav: string }) {
    // prevent subscription cycle
    if (this.root$.value.nav !== value.nav) {
      this.zone.run(() => {
        this.root$.next(value);
      });
    }
  }

  protected username = this.formBuilder.group({
    nav: [null as string | null],
  });

  async ngOnInit() {
    const account = this.account ?? await firstValueFrom(this.accountService.activeAccount$);
    if (!account) {
      throw new Error("Active account is unavailable");
    } else if (!this.account) {
      this.account$.next(account);
    }

    combineLatest([
      this.generatorService.algorithms$("email", { account$: this.account$ }),
      this.generatorService.algorithms$("username", { account$: this.account$ }),
    ])
      .pipe(
        map((algorithms) => algorithms.flat()),
        map((algorithms) => {
          algorithms.sort((a, b) => a.weight - b.weight);
          return this.toOptions(algorithms);
        }),
        takeUntil(this.destroyed),
      )
      .subscribe((usernames) => {
        this.zone.run(() => {
          this.usernameOptions$.next(usernames);
        });
      });

    this.generatorService
      .algorithms$("password", { account$: this.account$ })
      .pipe(
        map((algorithms) => {
          const options = this.toOptions(algorithms);
          options.push({ value: IDENTIFIER, label: this.i18nService.t("username") });
          return options;
        }),
        takeUntil(this.destroyed),
      )
      .subscribe(this.rootOptions$);

    this.maybeAlgorithm$
      .pipe(
        map((a) => {
          if (a?.i18nKeys?.description) {
            return translate(a.i18nKeys.description, this.i18nService);
          } else {
            return "";
          }
        }),
        takeUntil(this.destroyed),
      )
      .subscribe((hint) => {
        // update subjects within the angular zone so that the
        // template bindings refresh immediately
        this.zone.run(() => {
          this.credentialTypeHint$.next(hint);
        });
      });

    this.maybeAlgorithm$
      .pipe(
        map((a) => a?.type),
        distinctUntilChanged(),
        takeUntil(this.destroyed),
      )
      .subscribe((category) => {
        // update subjects within the angular zone so that the
        // template bindings refresh immediately
        this.zone.run(() => {
          this.category$.next(category);
        });
      });

    // wire up the generator
    this.generatorService
      .generate$({
        on$: this.generate$,
        account$: this.account$,
      })
      .pipe(
        catchError((error: unknown, generator) => {
          if (typeof error === "string") {
            this.toastService.showToast({
              message: error,
              variant: "error",
              title: "",
            });
          } else {
            this.toastService.showToast({ message: this.i18nService.t("i18nUnableToGenerateCredential"), variant: "error", title: "" });
          }

          // continue with origin stream
          return generator;
        }),
        withLatestFrom(this.account$, this.maybeAlgorithm$),
        takeUntil(this.destroyed),
      )
      .subscribe(([generated, account, algorithm]) => {
        // Pass the string-form algorithm id so the history view can disambiguate
        //   sub-types within a category (e.g. password vs passphrase).
        const algorithmId = typeof algorithm?.id === "string" ? algorithm.id : undefined;
        this.generatorHistoryService
          .track(
            account.id,
            generated.credential,
            generated.category,
            generated.generationDate,
            algorithmId,
          )
          .catch(() => {
            this.toastService.showToast({ message: this.i18nService.t("i18nUnableToUpdateGeneratorHistory"), variant: "error", title: "" });
          });

        // update subjects within the angular zone so that the
        // template bindings refresh immediately
        this.zone.run(() => {
          if (algorithm && generated.source === this.USER_REQUEST) {
            this.announce(translate(algorithm.i18nKeys.credentialGenerated, this.i18nService));
          }

          this.generatedCredential$.next(generated);
          this.onGenerated.next(generated);
        });
      });

    type CascadeValue = { nav: string; algorithm?: CredentialAlgorithm };
    const activeRoot$ = new Subject<CascadeValue>();
    const activeIdentifier$ = new Subject<CascadeValue>();

    this.root$
      .pipe(
        map((root): CascadeValue => {
          if (root.nav === IDENTIFIER) {
            return { nav: root.nav };
          } else if (root.nav) {
            return { nav: root.nav, algorithm: JSON.parse(root.nav) };
          } else {
            return { nav: IDENTIFIER };
          }
        }),
        takeUntil(this.destroyed),
      )
      .subscribe(activeRoot$);

    this.username.valueChanges
      .pipe(
        map((username): CascadeValue => {
          if (username.nav) {
            return { nav: username.nav, algorithm: JSON.parse(username.nav) };
          }
          const [algorithm] = AlgorithmsByType[Type.username];
          return { nav: JSON.stringify(algorithm), algorithm };
        }),
        takeUntil(this.destroyed),
      )
      .subscribe(activeIdentifier$);

    // update active algorithm
    combineLatest([activeRoot$, activeIdentifier$])
      .pipe(
        map(([root, username]) => {
          const selection = root.algorithm ?? username.algorithm;
          if (selection) {
            return this.generatorService.algorithm(selection);
          } else {
            return null;
          }
        }),
        distinctUntilChanged((prev, next) => {
          if (prev === null || next === null) {
            return false;
          } else {
            return isSameAlgorithm(prev.id, next.id);
          }
        }),
        takeUntil(this.destroyed),
      )
      .subscribe((algorithm) => {
        // update subjects within the angular zone so that the
        // template bindings refresh immediately
        this.zone.run(() => {
          this.maybeAlgorithm$.next(algorithm);
        });
      });

    // assume the last-selected generator algorithm is the user's preferred one
    const preferences = await this.generatorService.preferences({ account$: this.account$ });
    this.algorithm$
      .pipe(withLatestFrom(preferences), takeUntil(this.destroyed))
      .subscribe(([algorithm, preference]) => {
        function setPreference(type: "password" | "username" | "email") {
          preference[type].algorithm = algorithm.id;
          preference[type].updated = new Date();
        }
        if (isEmailAlgorithm(algorithm.id)) {
          setPreference("email");
        } else if (isUsernameAlgorithm(algorithm.id)) {
          setPreference("username");
        } else if (isPasswordAlgorithm(algorithm.id)) {
          setPreference("password");
        } else {
          return;
        }
        preferences.next(preference);
      });

    // populate the form with the user's preferences to kick off interactivity
    preferences
      .pipe(
        map(({ email, username, password }) => {
          const usernamePreference = email.updated > username.updated ? email : username;
          const usernameNav = JSON.stringify(usernamePreference.algorithm);
          const rootNav = usernamePreference.updated > password.updated
            ? IDENTIFIER
            : JSON.stringify(password.algorithm);
          return {
            root: {
              selection: { nav: rootNav },
              active: {
                nav: rootNav,
                algorithm: rootNav === IDENTIFIER ? undefined : password.algorithm,
              } as CascadeValue,
            },
            username: {
              selection: { nav: usernameNav },
              active: { nav: usernameNav, algorithm: usernamePreference.algorithm },
            },
          };
        }),
        takeUntil(this.destroyed),
      )
      .subscribe(({ root, username }) => {
        // update navigation; break subscription loop
        this.onRootChanged(root.selection);
        this.username.setValue(username.selection, { emitEvent: false });
        activeRoot$.next(root.active);
        activeIdentifier$.next(username.active);
      });

    // automatically regenerate when the algorithm switches if the algorithm
    // allows it; otherwise set a placeholder
    this.maybeAlgorithm$.pipe(takeUntil(this.destroyed)).subscribe((a) => {
      this.zone.run(() => {
        if (a?.capabilities?.autogenerate) {
          this.generate("autogenerate").catch(() => {
            this.toastService.showToast({ message: this.i18nService.t("i18nUnableToGenerateCredential"), variant: "error", title: "" });
          });
        } else {
          this.generatedCredential$.next(undefined);
        }
      });
    });
  }

  private announce(message: string) {
    this.ariaLive.announce(message).catch(() => undefined);
  }

  /** Lists the top-level credential types supported by the component. */
  protected rootOptions$ = new BehaviorSubject<Option<string>[]>([]);

  /** Lists the provider-free credential types of the username algorithm box. */
  protected usernameOptions$ = new BehaviorSubject<Option<string>[]>([]);

  /** tracks the currently selected credential type */
  protected maybeAlgorithm$ = new ReplaySubject<AlgorithmMetadata | null>(1);

  /** tracks the last valid algorithm selection */
  protected algorithm$ = this.maybeAlgorithm$.pipe(
    filter((algorithm): algorithm is AlgorithmMetadata => !!algorithm),
  );

  protected showAlgorithm$ = this.maybeAlgorithm$;

  /**
   * Emits the copy button aria-label respective of the selected credential type
   */
  protected credentialTypeCopyLabel$ = this.algorithm$.pipe(
    map(({ i18nKeys: { copyCredential } }) => translate(copyCredential, this.i18nService)),
  );

  /**
   * Emits the generate button aria-label respective of the selected credential type
   */
  protected credentialTypeGenerateLabel$ = this.algorithm$.pipe(
    map(({ i18nKeys: { generateCredential } }) => translate(generateCredential, this.i18nService)),
  );

  /**
   * Emits the copy credential toast respective of the selected credential type
   */
  protected credentialTypeLabel$ = this.algorithm$.pipe(
    map(({ i18nKeys: { credentialType } }) => translate(credentialType, this.i18nService)),
  );

  /** Emits hint key for the currently selected credential type */
  protected credentialTypeHint$ = new ReplaySubject<string | undefined>(1);

  /** tracks the currently selected credential category */
  protected category$ = new ReplaySubject<string | undefined>(1);

  private readonly generatedCredential$ = new BehaviorSubject<GeneratedCredential | undefined>(
    undefined,
  );

  /** Emits the last generated value. */
  protected readonly value$ = this.generatedCredential$.pipe(
    map((generated) => generated?.credential ?? ""),
  );

  /** Identifies generator requests that were requested by the user */
  protected readonly USER_REQUEST = "user request";

  /** Emits when a new credential is requested */
  private readonly generate$ = new Subject<GenerateRequest>();

  /** Request a new value from the generator
   * @param source a label used to trace generation request
   *  origin in the debugger.
   */
  protected async generate(source: string) {
    const algorithm = await firstValueFrom(this.algorithm$);
    const request: GenerateRequest = { source, algorithm: algorithm.id };
    this.generate$.next(request);
  }

  private toOptions(algorithms: AlgorithmMetadata[]) {
    const options: Option<string>[] = algorithms.map((algorithm) => ({
      value: JSON.stringify(algorithm.id),
      label: translate(algorithm.i18nKeys.name, this.i18nService),
    }));

    return options;
  }

  ngOnDestroy() {
    this.destroyed.next();
    this.destroyed.complete();

    // finalize subjects
    this.generate$.complete();
    this.generatedCredential$.complete();

    // finalize component bindings
    this.onGenerated.complete();
  }
}
