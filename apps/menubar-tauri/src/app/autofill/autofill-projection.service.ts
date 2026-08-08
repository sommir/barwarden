import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";
import type { Subscription } from "rxjs";

import {
  ACCOUNT_SESSION_PORT,
  type AccountSessionPort,
} from "../../auth/account-session-port";
import { isTauriRuntime } from "../../host/default-host.service";
import {
  clearNativeAutoFillProjection,
  lockNativeAutoFillProjection,
  replaceNativeAutoFillProjection,
} from "../../host/autofill-projection.host";
import { PopupStateStore, type PopupState } from "../popup-state";
import type { VaultItem } from "../vault/vault-item.model";
import type {
  AutoFillProjectionInput,
  AutoFillProjectionLogin,
} from "./autofill-projection.model";

export interface AutoFillProjectionHost {
  replaceProjection(input: AutoFillProjectionInput): Promise<void>;
  clearProjection(accountId: string): Promise<void>;
  lockProjection(): Promise<void>;
}

export const AUTOFILL_PROJECTION_HOST = new InjectionToken<AutoFillProjectionHost | null>(
  "AUTOFILL_PROJECTION_HOST",
  { providedIn: "root", factory: () => null },
);

export const AUTOFILL_PROJECTION_CLOCK = new InjectionToken<() => Date>(
  "AUTOFILL_PROJECTION_CLOCK",
  { providedIn: "root", factory: () => () => new Date() },
);

const noopHost: AutoFillProjectionHost = {
  replaceProjection: async () => undefined,
  clearProjection: async () => undefined,
  lockProjection: async () => undefined,
};

@Injectable({ providedIn: "root" })
export class AutoFillProjectionService {
  private readonly host: AutoFillProjectionHost;
  private readonly subscription: Subscription;
  private operationTail: Promise<void> = Promise.resolve();
  private lastItems: readonly VaultItem[] | null = null;
  private wasUnlocked = false;
  private lifecycleEpoch = 0;
  private readonly revisionByAccount = new Map<string, number>();

  constructor(
    private readonly store: PopupStateStore,
    @Optional() @Inject(AUTOFILL_PROJECTION_HOST) host: AutoFillProjectionHost | null = null,
    @Optional() @Inject(ACCOUNT_SESSION_PORT) private readonly accounts: AccountSessionPort | null = null,
    @Inject(AUTOFILL_PROJECTION_CLOCK) private readonly clock: () => Date = () => new Date(),
  ) {
    this.host = host ?? (isTauriRuntime()
      ? new NativeAutoFillProjectionHost()
      : noopHost);
    this.wasUnlocked = this.store.snapshot().isUnlocked;
    this.subscription = this.store.state$.subscribe((state) => this.observe(state));
  }

  async clearAccount(accountId: string): Promise<void> {
    if (!accountId) return;
    await this.enqueue(() => this.host.clearProjection(accountId));
    this.revisionByAccount.delete(accountId);
  }

  settled(): Promise<void> {
    return this.operationTail;
  }

  destroy(): void {
    this.subscription.unsubscribe();
  }

  private observe(state: PopupState): void {
    if (this.wasUnlocked && !state.isUnlocked) {
      this.lifecycleEpoch += 1;
      this.lastItems = null;
      void this.enqueue(() => this.host.lockProjection());
    }
    this.wasUnlocked = state.isUnlocked;
    if (
      !state.isUnlocked ||
      !state.activeSession ||
      state.vaultSyncStatus !== "fresh" ||
      state.items === this.lastItems
    ) {
      return;
    }

    this.lastItems = state.items;
    const items = state.items;
    const epoch = this.lifecycleEpoch;
    void this.enqueue(async () => {
      const accountId = await this.activeAccountId();
      const current = this.store.snapshot();
      if (
        !accountId ||
        epoch !== this.lifecycleEpoch ||
        !current.isUnlocked ||
        !current.activeSession ||
        current.items !== items
      ) {
        return;
      }
      const vaultRevision = (this.revisionByAccount.get(accountId) ?? 0) + 1;
      await this.host.replaceProjection({
        accountId,
        vaultRevision,
        createdAt: this.clock().toISOString(),
        logins: items.flatMap(projectLogin),
      });
      this.revisionByAccount.set(accountId, vaultRevision);
    });
  }

  private async activeAccountId(): Promise<string | null> {
    const accounts = await this.accounts?.list();
    return accounts?.find((account) => account.isActive)?.id ?? null;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const pending = this.operationTail.then(operation);
    this.operationTail = pending.catch(() => undefined);
    return pending;
  }
}

class NativeAutoFillProjectionHost implements AutoFillProjectionHost {
  replaceProjection(input: AutoFillProjectionInput): Promise<void> {
    return replaceNativeAutoFillProjection(input);
  }

  clearProjection(accountId: string): Promise<void> {
    return clearNativeAutoFillProjection(accountId);
  }

  lockProjection(): Promise<void> {
    return lockNativeAutoFillProjection();
  }
}

function projectLogin(item: VaultItem): AutoFillProjectionLogin[] {
  if (item.type !== "login") return [];
  const value = (id: string) => item.fields.find((field) => field.id === id)?.value ?? "";
  return [{
    cipherId: item.id,
    name: item.name,
    username: value("username"),
    password: value("password"),
    uris: item.uris.map(({ uri, matchType }) => ({ uri, matchType })),
    totp: value("otp"),
    favorite: item.favorite,
    reprompt: item.reprompt === true,
  }];
}
