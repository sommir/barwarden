import { Inject, Injectable } from "@angular/core";
import {
  catchError,
  defer,
  filter,
  map,
  shareReplay,
  switchMap,
  take,
  throwError,
} from "rxjs";

import type { Account } from "@bitwarden/common/auth/abstractions/account.service";

import {
  GENERATOR_RUNTIME,
  GENERATOR_STATUS,
  type GeneratorRuntimePort,
  type GeneratorStatusPort,
} from "./generator-runtime.port";

@Injectable()
export class OfficialGeneratorAccountAdapter {
  constructor(
    @Inject(GENERATOR_RUNTIME) private readonly runtime: GeneratorRuntimePort,
    @Inject(GENERATOR_STATUS) private readonly status: GeneratorStatusPort,
  ) {}

  readonly activeAccount$ = defer(() => this.runtime.activeSettings()).pipe(
    catchError((error: unknown) => {
      if (!isRecoverableStartupOwnershipError(error)) {
        return throwError(() => error);
      }

      return this.status.state$.pipe(
        filter((state) => state.isUnlocked),
        take(1),
        switchMap(() => defer(() => this.runtime.activeSettings())),
      );
    }),
    map(({ accountId }) => ({
      id: accountId,
      email: this.status.snapshot().email,
      emailVerified: true,
      name: undefined,
      creationDate: undefined,
    }) as Account),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
}

function isRecoverableStartupOwnershipError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message === "Active account is locked" ||
    error.message === "No active account is available";
}
