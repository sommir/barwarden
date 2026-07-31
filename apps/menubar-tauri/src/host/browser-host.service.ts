import { FetchHttpTransport, type HttpTransport } from "../bitwarden-api/bitwarden-api";
import type {
  AccountLockIntentHost,
  HostApi,
  PopupWindowMetrics,
  ProcessSessionAttachment,
  ProcessSessionMutation,
  ProcessSessionSnapshot,
  SecureCompareAndSwapHost,
  SecureUuidHost,
} from "./host-api";
import type { LaunchAtLoginHost } from "./launch-at-login";

const secureMemory = new Map<string, string>();
const pendingSecureUuids = new Map<string, Promise<string>>();
const ACCOUNT_LOCK_INTENTS_KEY = "barwarden.account-lock-intents";
const browserProcessGeneration = crypto.randomUUID();
let browserProcessSnapshot: ProcessSessionSnapshot = {
  processGeneration: browserProcessGeneration,
  version: 0,
  syncVersion: 0,
  authorization: "signed-out",
  activeAccountId: null,
  syncState: "idle",
  failureCode: null,
  sharedSnapshot: null,
  originWindowLabel: null,
};
let browserColdOwner: BrowserHostService | null = null;
let browserProcessSessionHandoff: unknown | null = null;

export class BrowserHostService implements HostApi, SecureCompareAndSwapHost, SecureUuidHost, AccountLockIntentHost, LaunchAtLoginHost, HttpTransport {
  private readonly transport = new FetchHttpTransport();
  private launchAtLoginEnabled = false;

  getLaunchAtLogin(): Promise<boolean> {
    return Promise.resolve(this.launchAtLoginEnabled);
  }

  setLaunchAtLogin(enabled: boolean): Promise<boolean> {
    this.launchAtLoginEnabled = enabled;
    return Promise.resolve(this.launchAtLoginEnabled);
  }

  showPopup(): Promise<void> {
    return Promise.resolve();
  }

  hidePopup(): Promise<void> {
    return Promise.resolve();
  }

  getPopupWindowMetrics(): Promise<PopupWindowMetrics> {
    return Promise.resolve({ currentHeight: 600, maximumHeight: 600 });
  }

  setPopupHeight(_height: number): Promise<PopupWindowMetrics> {
    return this.getPopupWindowMetrics();
  }

  popOut(route: string): Promise<void> {
    globalThis.window?.open?.(`#${route}`, "_blank", "noopener");
    return Promise.resolve();
  }

  attachProcessSession(): Promise<ProcessSessionAttachment> {
    const startupMode = browserColdOwner === null || browserColdOwner === this
      ? "cold"
      : "attach";
    browserColdOwner ??= this;
    return Promise.resolve({ startupMode, snapshot: browserProcessSnapshot });
  }

  processSessionSnapshot(): Promise<ProcessSessionSnapshot> {
    return Promise.resolve(browserProcessSnapshot);
  }

  mutateProcessSession(mutation: ProcessSessionMutation): Promise<ProcessSessionSnapshot> {
    const next = { ...browserProcessSnapshot, version: browserProcessSnapshot.version + 1 };
    switch (mutation.type) {
      case "unlocked":
        browserProcessSnapshot = {
          ...next,
          authorization: "unlocked",
          activeAccountId: mutation.activeAccountId,
          syncState: "idle",
          failureCode: null,
          sharedSnapshot: mutation.sharedSnapshot ?? null,
        };
        break;
      case "locked":
        browserProcessSessionHandoff = null;
        browserProcessSnapshot = {
          ...next,
          authorization: "locked",
          syncState: "idle",
          failureCode: null,
          sharedSnapshot: null,
        };
        break;
      case "logged-out":
        browserProcessSessionHandoff = null;
        browserProcessSnapshot = {
          ...next,
          authorization: "signed-out",
          activeAccountId: null,
          syncState: "idle",
          failureCode: null,
          sharedSnapshot: null,
        };
        break;
      case "account-selected":
        browserProcessSessionHandoff = null;
        browserProcessSnapshot = {
          ...next,
          authorization: "locked",
          activeAccountId: mutation.activeAccountId,
          syncState: "idle",
          failureCode: null,
          sharedSnapshot: null,
        };
        break;
      case "sync-started":
        browserProcessSnapshot = {
          ...next,
          syncVersion: next.syncVersion + 1,
          syncState: "syncing",
          failureCode: null,
        };
        break;
      case "sync-succeeded":
        browserProcessSnapshot = {
          ...next,
          syncVersion: next.syncVersion + 1,
          syncState: "fresh",
          failureCode: null,
          sharedSnapshot: mutation.sharedSnapshot ?? next.sharedSnapshot,
        };
        break;
      case "sync-failed":
        browserProcessSnapshot = {
          ...next,
          syncVersion: next.syncVersion + 1,
          syncState: "stale",
          failureCode: mutation.code,
        };
        break;
      case "snapshot-updated":
        browserProcessSnapshot = {
          ...next,
          sharedSnapshot: mutation.sharedSnapshot,
        };
        break;
      case "active-tab-updated": {
        const previousSnapshot = browserProcessSnapshot.sharedSnapshot;
        const sharedSnapshot = previousSnapshot && typeof previousSnapshot === "object" &&
          !Array.isArray(previousSnapshot)
          ? { ...(previousSnapshot as Record<string, unknown>), activeTab: mutation.activeTab }
          : previousSnapshot;
        browserProcessSnapshot = { ...next, sharedSnapshot };
        break;
      }
      case "recovery-required":
        browserProcessSessionHandoff = null;
        browserProcessSnapshot = {
          ...next,
          authorization: "recovery-required",
          activeAccountId: mutation.activeAccountId,
          syncState: "invalid",
          failureCode: mutation.code,
          sharedSnapshot: null,
        };
        break;
    }
    return Promise.resolve(browserProcessSnapshot);
  }

  setProcessSessionHandoff(session: unknown): Promise<void> {
    browserProcessSessionHandoff = session;
    return Promise.resolve();
  }

  processSessionHandoff(): Promise<unknown | null> {
    return Promise.resolve(browserProcessSessionHandoff);
  }

  async copyText(value: string): Promise<void> {
    await globalThis.navigator?.clipboard?.writeText(value);
  }

  async pasteText(value: string): Promise<void> {
    await this.copyText(value);
  }

  openUrl(url: string): Promise<void> {
    globalThis.window?.open?.(url, "_blank", "noopener");
    return Promise.resolve();
  }

  secureGet(key: string): Promise<string | null> {
    return Promise.resolve(secureMemory.get(key) ?? null);
  }

  secureSet(key: string, value: string): Promise<void> {
    secureMemory.set(key, value);
    return Promise.resolve();
  }

  secureDelete(key: string): Promise<void> {
    secureMemory.delete(key);
    return Promise.resolve();
  }

  secureCompareAndSwap(
    key: string,
    expected: string | null,
    replacement: string | null,
  ): Promise<boolean> {
    if ((secureMemory.get(key) ?? null) !== expected) return Promise.resolve(false);
    if (replacement === null) secureMemory.delete(key);
    else secureMemory.set(key, replacement);
    return Promise.resolve(true);
  }

  secureGetOrCreateUuid(key: string): Promise<string> {
    const pending = pendingSecureUuids.get(key);
    if (pending) {
      return pending;
    }

    const created = this.loadOrCreateUuid(key);
    pendingSecureUuids.set(key, created);
    void created.catch(() => {
      if (pendingSecureUuids.get(key) === created) {
        pendingSecureUuids.delete(key);
      }
    });
    return created;
  }

  async getAccountLockIntents(): Promise<readonly string[]> {
    const raw = requiredLocalStorage().getItem(ACCOUNT_LOCK_INTENTS_KEY);
    if (!raw) {
      return [];
    }

    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value) || !value.every((id) => typeof id === "string")) {
      throw new Error("account lock state unavailable");
    }
    return value;
  }

  async setAccountLockIntents(accountIds: readonly string[], locked: boolean): Promise<void> {
    const storage = requiredLocalStorage();
    const locks = globalThis.navigator?.locks;
    if (!locks) {
      throw new Error("account lock state unavailable");
    }
    await locks.request(ACCOUNT_LOCK_INTENTS_KEY, async () => {
      const intents = new Set(await this.getAccountLockIntents());
      for (const accountId of accountIds) {
        if (locked) {
          intents.add(accountId);
        } else {
          intents.delete(accountId);
        }
      }
      storage.setItem(ACCOUNT_LOCK_INTENTS_KEY, JSON.stringify([...intents]));
    });
  }

  fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    return this.transport.fetchJson<T>(url, init);
  }

  private async loadOrCreateUuid(key: string): Promise<string> {
    const stored = await this.secureGet(key);
    if (stored) {
      return stored;
    }

    const value = crypto.randomUUID();
    await this.secureSet(key, value);
    return value;
  }
}

function requiredLocalStorage(): Storage {
  const storage = globalThis.localStorage;
  if (!storage) {
    throw new Error("browser storage unavailable");
  }
  return storage;
}
