import { Inject, Injectable } from "@angular/core";

import type { AccountLogoutCleanupPort } from "./account-logout-cleanup";
import {
  UNLOCK_METHODS_PORT,
  type UnlockMethodsPort,
} from "./unlock-methods.port";
import { GeneratorAccountCleanupService } from "../generator/generator-account-cleanup.service";
import { AutoFillProjectionService } from "../autofill/autofill-projection.service";

@Injectable({ providedIn: "root" })
export class CompositeAccountCleanupService implements AccountLogoutCleanupPort {
  constructor(
    @Inject(UNLOCK_METHODS_PORT) private readonly unlockMethods: UnlockMethodsPort,
    private readonly generatorCleanup: GeneratorAccountCleanupService,
    private readonly projectionCleanup: AutoFillProjectionService,
  ) {}

  async clearAccount(accountId: string): Promise<void> {
    await this.projectionCleanup.clearAccount(accountId);
    await this.unlockMethods.clearAccount(accountId);
    await this.generatorCleanup.clearAccount(accountId);
  }
}
