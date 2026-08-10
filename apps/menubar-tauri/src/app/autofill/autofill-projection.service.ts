import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";
import type { Subscription } from "rxjs";

import { isTauriRuntime } from "../../host/default-host.service";
import {
  captureNativeAutoFillProjectionBinding,
  clearNativeAutoFillProjection,
  lockNativeAutoFillProjection,
  replaceNativeAutoFillProjection,
  resetNativeAutoFillProjectionForReprojection,
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
import { AutoFillBindingsService } from "./autofill-bindings.service";

export interface AutoFillProjectionHost {
  captureBinding(accountId: string): Promise<AutoFillProjectionBinding>;
  replaceProjection(input: AutoFillProjectionInput, binding: AutoFillProjectionBinding): Promise<void>;
  clearProjection(accountId: string): Promise<void>;
  lockProjection(): Promise<void>;
  resetProjection(): Promise<void>;
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
  resetProjection: async () => undefined,
};

@Injectable({ providedIn: "root" })
export class AutoFillProjectionService implements AutoFillProjectionLifecyclePort {
  private readonly host: AutoFillProjectionHost;
  private readonly stateSubscription: Subscription;
  private readonly matchingSubscription: Subscription;
  private operationTail: Promise<void> = Promise.resolve();
  private lastItems: readonly VaultItem[] | null = null;
  private wasUnlocked = false;
  private lifecycleEpoch = 0;

  constructor(
    private readonly store: PopupStateStore,
    @Optional() @Inject(AUTOFILL_PROJECTION_HOST) host: AutoFillProjectionHost | null = null,
    @Inject(AUTOFILL_PROJECTION_CLOCK) private readonly clock: () => Date = () => new Date(),
    private readonly matchingState: AutoFillBindingsService = new AutoFillBindingsService(),
  ) {
    this.host = host ?? (isTauriRuntime()
      ? new NativeAutoFillProjectionHost()
      : noopHost);
    this.wasUnlocked = this.store.snapshot().isUnlocked;
    this.stateSubscription = this.store.state$.subscribe((state) => this.observe(state));
    this.matchingSubscription = this.matchingState.changes$.subscribe(() => {
      this.invalidateLifecycle();
      const pending = this.enqueueProjection(this.store.snapshot());
      if (pending) {
        void pending.catch(() => {
          this.store.setSyncError(translateOfficialMessage("i18nUnableToLockAutoFill"));
        });
      }
    });
  }

  async clearAccount(accountId: string): Promise<void> {
    if (!accountId) return;
    await this.enqueue(async () => {
      await this.clearWithRetry(accountId);
      this.matchingState.clearAccountAfterProjectionRemoval(accountId);
    });
  }

  async invalidateAndLock(): Promise<void> {
    this.invalidateLifecycle();
    await this.enqueue(() => this.lockWithRetry());
  }

  async resetForReprojection(): Promise<void> {
    this.invalidateLifecycle();
    await this.enqueue(() => this.resetWithRetry());
  }

  async reprojectCurrent(): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      this.invalidateLifecycle();
      const pending = this.enqueueProjection(this.store.snapshot());
      if (!pending) {
        throw new Error("projection unavailable");
      }
      if (await pending) return;
    }
    throw new Error("projection unavailable");
  }

  settled(): Promise<void> {
    return this.operationTail;
  }

  destroy(): void {
    this.stateSubscription.unsubscribe();
    this.matchingSubscription.unsubscribe();
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

  private enqueueProjection(state: PopupState): Promise<boolean> | null {
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
    let projected = false;
    const pending = this.enqueue(async () => {
      if (!this.isCurrentSnapshot(snapshot)) return;
      const binding = await this.host.captureBinding(snapshot.accountId);
      if (binding.accountId !== snapshot.accountId || !this.isCurrentSnapshot(snapshot)) return;
      projected = await this.replaceWithRetry(snapshot, {
        accountId: snapshot.accountId,
        createdAt: this.clock().toISOString(),
        logins: snapshot.items.flatMap((item) => projectLogin(
          item,
          this.matchingState.lastUsedAtFor(snapshot.accountId, item.id),
        )),
        ...this.matchingState.snapshot(snapshot.accountId),
      }, binding);
    }).then(() => projected);
    // State observers intentionally fire-and-forget. Keep those background
    // rejections handled while explicit callers can still await the same
    // rejected promise and surface a fixed failure state.
    void pending.catch(() => undefined);
    return pending;
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
  ): Promise<boolean> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!this.isCurrentSnapshot(identity)) return false;
      try {
        await this.host.replaceProjection(input, binding);
        return this.isCurrentSnapshot(identity);
      } catch (error) {
        lastError = error;
        if (!this.isCurrentSnapshot(identity)) return false;
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

  private async resetWithRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.host.resetProjection();
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

@Injectable()
export class NativeAutoFillProjectionHost implements AutoFillProjectionHost {
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


  resetProjection(): Promise<void> {
    return resetNativeAutoFillProjectionForReprojection();
  }
}

function projectLogin(item: VaultItem, lastUsedAt?: number): AutoFillProjectionLogin[] {
  if (item.type !== "login") return [];
  const value = (id: string) => item.fields.find((field) => field.id === id)?.value ?? "";
  return [{
    cipherId: item.id,
    name: item.name,
    username: value("username"),
    password: value("password"),
    uris: item.uris.flatMap(({ uri, matchType }) => {
      const normalizedUri = uri.trim();
      return normalizedUri.length === 0 ? [] : [{
        uri: normalizedUri,
        matchType: canonicalProjectionUriMatch(matchType),
      }];
    }),
    totp: value("otp"),
    favorite: item.favorite,
    reprompt: item.reprompt === true,
    ...(lastUsedAt == null ? {} : { lastUsedAt }),
  }];
}

function canonicalProjectionUriMatch(value: string): 0 | 1 | 2 | 3 | 4 | 5 {
  const normalized = value.trim();
  if (normalized === "" || normalized === "default") return 0;
  const numeric = Number(normalized);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 5
    ? numeric as 0 | 1 | 2 | 3 | 4 | 5
    : 5;
}
