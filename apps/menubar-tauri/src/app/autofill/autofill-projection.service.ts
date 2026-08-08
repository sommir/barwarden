import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";
import type { Subscription } from "rxjs";

import { isTauriRuntime } from "../../host/default-host.service";
import {
  captureNativeAutoFillProjectionBinding,
  clearNativeAutoFillProjection,
  lockNativeAutoFillProjection,
  replaceNativeAutoFillProjection,
} from "../../host/autofill-projection.host";
import { PopupStateStore, type PopupState } from "../popup-state";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import type { VaultItem } from "../vault/vault-item.model";
import type {
  AutoFillProjectionInput,
  AutoFillProjectionBinding,
  AutoFillProjectionLogin,
} from "./autofill-projection.model";
import type { AutoFillProjectionLifecyclePort } from "../auth/autofill-projection-lifecycle.port";

export interface AutoFillProjectionHost {
  captureBinding(accountId: string): Promise<AutoFillProjectionBinding>;
  replaceProjection(input: AutoFillProjectionInput, binding: AutoFillProjectionBinding): Promise<void>;
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
  captureBinding: async (accountId) => ({ token: `browser:${accountId}`, accountId }),
  replaceProjection: async () => undefined,
  clearProjection: async () => undefined,
  lockProjection: async () => undefined,
};

@Injectable({ providedIn: "root" })
export class AutoFillProjectionService implements AutoFillProjectionLifecyclePort {
  private readonly host: AutoFillProjectionHost;
  private readonly subscription: Subscription;
  private operationTail: Promise<void> = Promise.resolve();
  private lastItems: readonly VaultItem[] | null = null;
  private wasUnlocked = false;
  private lifecycleEpoch = 0;

  constructor(
    private readonly store: PopupStateStore,
    @Optional() @Inject(AUTOFILL_PROJECTION_HOST) host: AutoFillProjectionHost | null = null,
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
    await this.enqueue(() => this.clearWithRetry(accountId));
  }

  async invalidateAndLock(): Promise<void> {
    this.invalidateLifecycle();
    await this.enqueue(() => this.lockWithRetry());
  }

  async reprojectCurrent(): Promise<void> {
    this.invalidateLifecycle();
    const pending = this.enqueueProjection(this.store.snapshot());
    if (!pending) {
      throw new Error("projection unavailable");
    }
    await pending;
  }

  settled(): Promise<void> {
    return this.operationTail;
  }

  destroy(): void {
    this.subscription.unsubscribe();
  }

  private observe(state: PopupState): void {
    if (this.wasUnlocked && !state.isUnlocked) {
      this.invalidateLifecycle();
      void this.enqueue(() => this.lockWithRetry()).catch(() => {
        this.store.setSyncError(translateOfficialMessage("i18nUnableToLockAutoFill"));
      });
    }
    this.wasUnlocked = state.isUnlocked;
    void this.enqueueProjection(state);
  }

  private enqueueProjection(state: PopupState): Promise<void> | null {
    if (
      !state.isUnlocked ||
      !state.activeSession ||
      !state.vaultOwnerAccountId ||
      state.vaultSyncStatus !== "fresh" ||
      state.items === this.lastItems
    ) {
      return null;
    }

    this.lastItems = state.items;
    const snapshot = {
      epoch: this.lifecycleEpoch,
      session: state.activeSession,
      items: state.items,
      accountId: state.vaultOwnerAccountId,
    } as const;
    return this.enqueue(async () => {
      if (!this.isCurrentSnapshot(snapshot)) return;
      const binding = await this.host.captureBinding(snapshot.accountId);
      if (binding.accountId !== snapshot.accountId || !this.isCurrentSnapshot(snapshot)) return;
      await this.replaceWithRetry(snapshot, {
        accountId: snapshot.accountId,
        createdAt: this.clock().toISOString(),
        logins: snapshot.items.flatMap(projectLogin),
      }, binding);
    });
  }

  private invalidateLifecycle(): void {
    this.lifecycleEpoch += 1;
    this.lastItems = null;
  }

  private isCurrentSnapshot(snapshot: {
    readonly epoch: number;
    readonly session: PopupState["activeSession"];
    readonly items: readonly VaultItem[];
    readonly accountId: string;
  }): boolean {
    const current = this.store.snapshot();
    return snapshot.epoch === this.lifecycleEpoch &&
      current.isUnlocked &&
      current.activeSession === snapshot.session &&
      current.items === snapshot.items &&
      current.vaultOwnerAccountId === snapshot.accountId;
  }

  private async replaceWithRetry(
    identity: { readonly epoch: number; readonly session: PopupState["activeSession"]; readonly items: readonly VaultItem[]; readonly accountId: string },
    input: AutoFillProjectionInput,
    binding: AutoFillProjectionBinding,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!this.isCurrentSnapshot(identity)) return;
      try {
        await this.host.replaceProjection(input, binding);
        return;
      } catch (error) {
        lastError = error;
        if (!this.isCurrentSnapshot(identity)) return;
      }
    }
    throw lastError;
  }

  private async lockWithRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.host.lockProjection();
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private async clearWithRetry(accountId: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.host.clearProjection(accountId);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const pending = this.operationTail.then(operation);
    this.operationTail = pending.catch(() => undefined);
    return pending;
  }
}

class NativeAutoFillProjectionHost implements AutoFillProjectionHost {
  async captureBinding(accountId: string): Promise<AutoFillProjectionBinding> {
    const binding = await captureNativeAutoFillProjectionBinding(accountId) as AutoFillProjectionBinding;
    if (!binding || binding.accountId !== accountId || typeof binding.token !== "string") {
      throw new Error("projection binding unavailable");
    }
    return binding;
  }

  replaceProjection(input: AutoFillProjectionInput, binding: AutoFillProjectionBinding): Promise<void> {
    return replaceNativeAutoFillProjection(input, binding.token);
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
