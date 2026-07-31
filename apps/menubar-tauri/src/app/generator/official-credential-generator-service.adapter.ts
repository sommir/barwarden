import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";
import {
  BehaviorSubject,
  Observable,
  ReplaySubject,
  firstValueFrom,
  map,
  shareReplay,
  switchMap,
  take,
  withLatestFrom,
} from "rxjs";

import type { Account } from "@bitwarden/common/auth/abstractions/account.service";
import type { UserStateSubject } from "@bitwarden/common/tools/state/user-state-subject";
import {
  Algorithm,
  BuiltIn,
  GeneratedCredential,
  type AlgorithmMetadata,
  type CredentialAlgorithm,
  type CredentialPreference,
  type CredentialType,
  type GenerateRequest,
  type CatchallGenerationOptions,
  type EffUsernameGenerationOptions,
  type PassphraseGenerationOptions,
  type PasswordGenerationOptions,
  type SubaddressGenerationOptions,
} from "@bitwarden/generator-core";

import {
  GENERATOR_OPERATION_RECEIPT,
  GENERATOR_RUNTIME,
  GENERATOR_OWNERSHIP_STATE,
  type GeneratorMode,
  type GeneratorOperationReceiptPort,
  type GeneratorOwnershipStatePort,
  type GeneratorRuntimePort,
  type GeneratorSettingsSnapshot,
} from "./generator-runtime.port";

export const GENERATOR_INITIAL_ALGORITHM = new InjectionToken<CredentialAlgorithm | null>(
  "GENERATOR_INITIAL_ALGORITHM",
  { providedIn: "root", factory: () => null },
);

@Injectable()
export class OfficialCredentialGeneratorServiceAdapter {
  private readonly settingsWrites = new RuntimeSettingsWriteQueue();

  constructor(
    @Inject(GENERATOR_RUNTIME) private readonly runtime: GeneratorRuntimePort,
    @Inject(GENERATOR_INITIAL_ALGORITHM) private readonly initialAlgorithm: CredentialAlgorithm | null,
    @Optional() @Inject(GENERATOR_OWNERSHIP_STATE)
    private readonly ownershipState: GeneratorOwnershipStatePort | null = null,
    @Optional() @Inject(GENERATOR_OPERATION_RECEIPT)
    private readonly operationReceipt: GeneratorOperationReceiptPort | null = null,
  ) {}

  readonly generate$ = (dependencies: {
    readonly on$: Observable<GenerateRequest>;
    readonly account$: Observable<Account>;
  }): Observable<GeneratedCredential> => dependencies.on$.pipe(
    withLatestFrom(dependencies.account$),
    switchMap(([request, account]) => new Observable<GeneratedCredential>((subscriber) => {
      const completeReceipt = this.operationReceipt?.begin();
      let receiptCompleted = false;
      const completeOperation = () => {
        if (receiptCompleted) return;
        receiptCompleted = true;
        completeReceipt?.();
      };
      let current = true;
      const session = captureSession(this.ownershipState);
      const isCurrent = () => current
        && !subscriber.closed
        && this.retainsSessionOwnership(session);
      const algorithm = request.algorithm;
      if (!algorithm) {
        try {
          subscriber.error(new Error("Generator algorithm is unavailable"));
        } finally {
          completeOperation();
        }
        return () => {
          current = false;
          completeOperation();
        };
      }
      void this.generate(algorithm, account.id, isCurrent).then(
        ({ credential }) => {
          try {
            if (!isCurrent()) return;
            subscriber.next(new GeneratedCredential(
              credential,
              this.algorithm(algorithm).type,
              new Date(),
              request.source,
            ));
            subscriber.complete();
          } finally {
            completeOperation();
          }
        },
        (error: unknown) => {
          try {
            if (isCurrent()) subscriber.error(error);
          } finally {
            completeOperation();
          }
        },
      );
      return () => {
        current = false;
        completeOperation();
      };
    })),
  );

  readonly algorithms$ = (
    type: CredentialType,
    _dependencies: { readonly account$: Observable<Account> },
  ): Observable<AlgorithmMetadata[]> => new BehaviorSubject(
    algorithmsFor(type),
  );

  readonly algorithm = (id: CredentialAlgorithm): AlgorithmMetadata => metadataFor(id);

  readonly preferences = (
    _dependencies: { readonly account$: Observable<Account> },
  ): UserStateSubject<CredentialPreference> => {
    const initial = this.initialAlgorithm;
    const initialUsername = initial !== null && isUsernameMetadata(initial);
    const initialEmail = initial === Algorithm.plusAddress || initial === Algorithm.catchall;
    const preference: CredentialPreference = {
      email: {
        algorithm: initialEmail ? initial : Algorithm.plusAddress,
        updated: initialEmail ? new Date() : new Date(0),
      },
      username: {
        algorithm: initialUsername ? initial : Algorithm.username,
        updated: initialUsername && !initialEmail ? new Date() : new Date(0),
      },
      password: {
        algorithm: initial === Algorithm.passphrase ? Algorithm.passphrase : Algorithm.password,
        updated: initialUsername ? new Date(0) : new Date(),
      },
    };
    return new BehaviorSubject(preference) as unknown as UserStateSubject<CredentialPreference>;
  };

  readonly settings = <Settings extends object>(
    metadata: { readonly id: CredentialAlgorithm },
    dependencies: { readonly account$: Observable<Account> },
  ): UserStateSubject<Settings> => new RuntimeSettingsSubject(
    this.runtime,
    metadata.id,
    dependencies.account$,
    this.settingsWrites,
    this.ownershipState,
  ) as unknown as UserStateSubject<Settings>;

  readonly policy$ = <Settings>(
    metadata: { readonly id: CredentialAlgorithm },
    _dependencies: { readonly account$: Observable<Account> },
  ): Observable<unknown> => new BehaviorSubject({ constraints: constraintsFor(metadata.id) });

  private async generate(
    algorithm: CredentialAlgorithm,
    accountId: string,
    isCurrent: () => boolean | Promise<boolean>,
  ): Promise<{ readonly credential: string }> {
    await assertCurrentOperation(isCurrent);
    const mode = modeFor(algorithm);
    if (mode === "username") {
      await this.settingsWrites.run(async () => {
        await assertCurrentOperation(isCurrent);
        const active = await this.activeSettingsFor(accountId);
        await assertCurrentOperation(isCurrent);
        const type = usernameModeFor(algorithm);
        if (active.settings.username.type !== type) {
          await assertCurrentOperation(isCurrent);
          await this.runtime.updateUsernameSettings(accountId, {
            ...active.settings.username,
            type,
          });
          await assertCurrentOperation(isCurrent);
          await this.activeSettingsFor(accountId);
          await assertCurrentOperation(isCurrent);
        }
      });
    } else {
      await this.activeSettingsFor(accountId);
      await assertCurrentOperation(isCurrent);
    }
    await assertCurrentOperation(isCurrent);
    const result = await this.runtime.generate(mode, isCurrent);
    await assertCurrentOperation(isCurrent);
    await this.activeSettingsFor(accountId);
    await assertCurrentOperation(isCurrent);
    return result;
  }

  private async activeSettingsFor(accountId: string) {
    const active = await this.runtime.activeSettings();
    if (active.accountId !== accountId) {
      throw new Error("Generator account changed during generation");
    }
    return active;
  }

  private retainsSessionOwnership(session: object | null): boolean {
    return retainsSessionOwnership(this.ownershipState, session);
  }
}

class RuntimeSettingsWriteQueue {
  private barrier: Promise<void> = Promise.resolve();

  run<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.barrier.then(operation, operation);
    this.barrier = result.then(() => undefined, () => undefined);
    return result;
  }
}

class RuntimeSettingsSubject<Settings extends object> extends Observable<Settings> {
  private readonly values: ReplaySubject<Settings>;
  private readonly accountId$: Observable<string>;
  readonly withConstraints$: Observable<{ readonly state: Settings; readonly constraints: object }>;
  private usernameOperationEpoch = 0;

  constructor(
    private readonly runtime: GeneratorRuntimePort,
    private readonly id: CredentialAlgorithm,
    account$: Observable<Account>,
    private readonly writes: RuntimeSettingsWriteQueue,
    private readonly ownershipState: GeneratorOwnershipStatePort | null,
  ) {
    const values = new ReplaySubject<Settings>(1);
    super((subscriber) => values.subscribe(subscriber));
    this.values = values;
    this.accountId$ = account$.pipe(map((account) => account.id), take(1), shareReplay(1));
    this.withConstraints$ = this.pipe(map((state) => ({ state, constraints: constraintsFor(id) })));
    void firstValueFrom(this.accountId$).then(async (accountId) => {
      const active = await runtime.activeSettings();
      if (active.accountId === accountId) values.next(selectSettings(active.settings, id) as Settings);
    }).catch(() => undefined);
  }

  next(value: Settings): void {
    const operationEpoch = isUsernameMetadata(this.id) ? ++this.usernameOperationEpoch : 0;
    const session = captureSession(this.ownershipState);
    const isCurrent = () => (operationEpoch === 0 || operationEpoch === this.usernameOperationEpoch)
      && retainsSessionOwnership(this.ownershipState, session);
    void this.writes.run(async () => {
      if (!isCurrent()) return;
      const accountId = await firstValueFrom(this.accountId$);
      if (!isCurrent()) return;
      const active = await this.runtime.activeSettings();
      if (active.accountId !== accountId || !isCurrent()) return;
      const snapshot = await updateSettings(this.runtime, accountId, active.settings, this.id, value);
      if (!isCurrent()) return;
      const completedFor = await this.runtime.activeSettings();
      if (completedFor.accountId !== accountId || !isCurrent()) return;
      this.values.next(selectSettings(snapshot, this.id) as Settings);
    }).catch(() => undefined);
  }
}

function captureSession(ownershipState: GeneratorOwnershipStatePort | null): object | null {
  if (!ownershipState) return null;
  try {
    return ownershipState.snapshot().activeSession;
  } catch {
    return null;
  }
}

function retainsSessionOwnership(
  ownershipState: GeneratorOwnershipStatePort | null,
  session: object | null,
): boolean {
  if (!ownershipState) return true;
  try {
    const current = ownershipState.snapshot();
    return session !== null && current.activeSession === session && current.isUnlocked;
  } catch {
    return false;
  }
}

async function assertCurrentOperation(
  isCurrent: () => boolean | Promise<boolean>,
): Promise<void> {
  try {
    if (await isCurrent()) return;
  } catch {
    // Treat rejected ownership checks as stale operations.
  }
  throw new Error("Generator operation is no longer current");
}

function selectSettings(
  settings: GeneratorSettingsSnapshot,
  id: CredentialAlgorithm,
): object {
  switch (id) {
    case Algorithm.passphrase:
      return settings.passphrase;
    case Algorithm.username:
      return {
        wordCapitalize: settings.username.wordCapitalize,
        wordIncludeNumber: settings.username.wordIncludeNumber,
      } satisfies EffUsernameGenerationOptions;
    case Algorithm.plusAddress:
      return { subaddressEmail: settings.username.subaddressEmail } satisfies SubaddressGenerationOptions;
    case Algorithm.catchall:
      return { catchallDomain: settings.username.catchallDomain } satisfies CatchallGenerationOptions;
    default:
      return settings.password;
  }
}

async function updateSettings<Settings extends object>(
  runtime: GeneratorRuntimePort,
  accountId: string,
  active: GeneratorSettingsSnapshot,
  id: CredentialAlgorithm,
  value: Settings,
): Promise<GeneratorSettingsSnapshot> {
  if (id === Algorithm.passphrase) {
    return runtime.updatePassphraseSettings(accountId, {
      ...active.passphrase,
      ...value as PassphraseGenerationOptions,
    });
  }
  if (isUsernameMetadata(id)) {
    return runtime.updateUsernameSettings(accountId, {
      ...active.username,
      ...value,
      type: usernameModeFor(id),
    });
  }
  return runtime.updatePasswordSettings(accountId, {
    ...active.password,
    ...value as PasswordGenerationOptions,
  });
}

function constraintsFor(id: CredentialAlgorithm) {
  return id === Algorithm.passphrase ? {
    policyInEffect: false,
    numWords: { min: 3, max: 20, recommendation: 6 },
    wordSeparator: { maxLength: 1 },
    capitalize: { readonly: false },
    includeNumber: { readonly: false },
  } : {
    policyInEffect: false,
    length: { min: 5, max: 128, recommendation: 14 },
    minNumber: { min: 0, max: 9 },
    minSpecial: { min: 0, max: 9 },
    uppercase: { readonly: false },
    lowercase: { readonly: false },
    number: { readonly: false },
    special: { readonly: false },
  };
}

function modeFor(id: CredentialAlgorithm): GeneratorMode {
  if (id === Algorithm.passphrase) return "passphrase";
  return isUsernameMetadata(id) ? "username" : "password";
}

function algorithmsFor(type: CredentialType): AlgorithmMetadata[] {
  if (type === "password") return [BuiltIn.password, BuiltIn.passphrase];
  if (type === "username") return [BuiltIn.effWordList];
  return [BuiltIn.plusAddress, BuiltIn.catchall];
}

function metadataFor(id: CredentialAlgorithm): AlgorithmMetadata {
  switch (id) {
    case Algorithm.password:
      return BuiltIn.password;
    case Algorithm.passphrase:
      return BuiltIn.passphrase;
    case Algorithm.username:
      return BuiltIn.effWordList;
    case Algorithm.plusAddress:
      return BuiltIn.plusAddress;
    case Algorithm.catchall:
      return BuiltIn.catchall;
    default:
      throw new Error("Generator algorithm is unavailable");
  }
}

function isUsernameMetadata(id: CredentialAlgorithm): boolean {
  return id === Algorithm.username || id === Algorithm.plusAddress || id === Algorithm.catchall;
}

function usernameModeFor(id: CredentialAlgorithm): GeneratorSettingsSnapshot["username"]["type"] {
  if (id === Algorithm.plusAddress) return "subaddress";
  if (id === Algorithm.catchall) return "catchall";
  return "word";
}
