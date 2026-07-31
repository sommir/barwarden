import { InjectionToken, type Provider } from "@angular/core";

import { AccountSessionStore } from "../../auth/account-session-store";
import { ACCOUNT_SESSION_PORT } from "../../auth/account-session-port";
import type { HostApi } from "../../host/host-api";
import type { VaultSyncResult } from "../../vault/vault-sync.service";
import { VAULT_SYNC_PORT, type VaultSyncPort } from "../auth/vault-sync.shared";
import { PopupStateStore } from "../popup-state";
import {
  VAULT_ACTION_HOST,
  VAULT_CIPHER_ACTION_PORT,
  type VaultCipherActionPort,
} from "../vault/vault-actions.service";
import {
  VAULT_FOLDER_API,
  VAULT_FOLDER_CRYPTO,
  type VaultFolderApi,
  type VaultFolderCrypto,
} from "../vault/vault-folder.service";
import type { VaultItem } from "../vault/vault-item.model";
import type { VaultMainEvidenceState } from "../vault/vault-main-evidence-state";

export const recoveryEvidenceStates = [
  "password-history-populated",
  "password-history-empty",
  "password-history-reprompt",
  "folders-list",
  "folders-empty",
  "folders-add-dialog",
  "folders-edit-dialog",
  "folders-delete-confirmation",
  "archive-list",
  "archive-menu",
  "archive-empty",
  "trash-list",
  "trash-menu",
  "trash-permanent-delete-confirmation",
  "trash-empty",
  "recovery-operation-error",
] as const;

export type RecoveryEvidenceState = (typeof recoveryEvidenceStates)[number];

export interface RecoveryEvidenceReceipt {
  readonly action: "copy_history" | "create_folder" | "update_folder" | "delete_folder" | "favorite" | "archive" | "unarchive" | "soft_delete" | "restore" | "permanent_delete";
  readonly itemType: "login" | "card" | "identity" | "secure-note";
  readonly outcome: "committed" | "duplicate" | "failure" | "stale" | "cancelled";
}

type RecoveryEvidenceAction = RecoveryEvidenceReceipt["action"];
type RecoveryEvidenceItemType = RecoveryEvidenceReceipt["itemType"];

declare global {
  interface Window {
    __bwRecoverySecureGet?: (key: string) => Promise<string | null>;
    __bwRecoverySecureSet?: (key: string, value: string) => Promise<void>;
    __bwRecoverySecureDelete?: (key: string) => Promise<void>;
    __bwRecoveryServerCommit?: (action: string, itemId: string | null) => Promise<void>;
    __bwRecoveryFreshSync?: () => Promise<VaultSyncResult>;
    __bwRecoveryNativeCopy?: (value: string) => Promise<void>;
    __bwRecoveryPrepareRelaunch?: () => Promise<void>;
  }
}

const stateSet: ReadonlySet<string> = new Set(recoveryEvidenceStates);
const RECOVERY_EVIDENCE_TRANSPORT = new InjectionToken<RecoveryEvidenceTransport>(
  "RECOVERY_EVIDENCE_TRANSPORT",
);
const RECOVERY_EVIDENCE_HOST = new InjectionToken<RecoveryEvidenceHost>(
  "RECOVERY_EVIDENCE_HOST",
);

export function isRecoveryEvidenceState(
  state: VaultMainEvidenceState,
): state is RecoveryEvidenceState {
  return stateSet.has(state);
}

export function createRecoveryWorkflowEvidenceProviders(
  state: RecoveryEvidenceState,
): Provider[] {
  return [
    {
      provide: RECOVERY_EVIDENCE_TRANSPORT,
      deps: [PopupStateStore],
      useFactory: (store: PopupStateStore) => new RecoveryEvidenceTransport(state, store),
    },
    {
      provide: RECOVERY_EVIDENCE_HOST,
      deps: [RECOVERY_EVIDENCE_TRANSPORT],
      useFactory: (transport: RecoveryEvidenceTransport) => new RecoveryEvidenceHost(transport),
    },
    {
      provide: ACCOUNT_SESSION_PORT,
      deps: [RECOVERY_EVIDENCE_HOST, PopupStateStore],
      useFactory: (host: RecoveryEvidenceHost, store: PopupStateStore) => {
        const accountStore = new AccountSessionStore(host);
        host.attachRelaunchPreparation(accountStore, store);
        return accountStore;
      },
    },
    {
      provide: VAULT_SYNC_PORT,
      useFactory: createRecoverySyncPort,
    },
    {
      provide: VAULT_ACTION_HOST,
      useExisting: RECOVERY_EVIDENCE_HOST,
    },
    {
      provide: VAULT_FOLDER_API,
      deps: [RECOVERY_EVIDENCE_TRANSPORT],
      useFactory: (transport: RecoveryEvidenceTransport) => createRecoveryFolderApi(transport),
    },
    {
      provide: VAULT_FOLDER_CRYPTO,
      useFactory: createRecoveryFolderCrypto,
    },
    {
      provide: VAULT_CIPHER_ACTION_PORT,
      deps: [RECOVERY_EVIDENCE_TRANSPORT],
      useFactory: (transport: RecoveryEvidenceTransport) => createRecoveryCipherActionPort(transport),
    },
  ];
}

class RecoveryEvidenceHost implements HostApi {
  constructor(private readonly transport: RecoveryEvidenceTransport) {}

  attachRelaunchPreparation(accountStore: AccountSessionStore, store: PopupStateStore): void {
    window.__bwRecoveryPrepareRelaunch = async () => {
      const snapshot = store.snapshot();
      if (!snapshot.activeSession) {
        throw new Error("Recovery evidence session is unavailable");
      }
      await accountStore.saveAccount({
        email: snapshot.email,
        serverUrl: snapshot.serverUrl,
        session: snapshot.activeSession,
      });
    };
  }

  showPopup(): Promise<void> { return Promise.resolve(); }
  hidePopup(): Promise<void> { return Promise.resolve(); }
  pasteText(): Promise<void> { return Promise.resolve(); }
  openUrl(): Promise<void> { return Promise.resolve(); }
  getAccountLockIntents(): Promise<readonly string[]> { return Promise.resolve([]); }
  setAccountLockIntents(): Promise<void> { return Promise.resolve(); }

  async copyText(value: string): Promise<void> {
    await requiredBridge("__bwRecoveryNativeCopy")(value);
    await this.transport.commit("copy_history", "login", null);
  }

  secureGet(key: string): Promise<string | null> {
    return requiredBridge("__bwRecoverySecureGet")(key);
  }

  secureSet(key: string, value: string): Promise<void> {
    return requiredBridge("__bwRecoverySecureSet")(key, value);
  }

  secureDelete(key: string): Promise<void> {
    return requiredBridge("__bwRecoverySecureDelete")(key);
  }
}

function createRecoverySyncPort(): VaultSyncPort {
  return {
    sync: async () => requiredBridge("__bwRecoveryFreshSync")(),
  };
}

function createRecoveryFolderCrypto(): VaultFolderCrypto {
  return {
    encryptString: async () => "m10-encrypted-folder",
  };
}

function createRecoveryFolderApi(transport: RecoveryEvidenceTransport): VaultFolderApi {
  return {
    postFolder: async () => {
      await transport.commit("create_folder", "login", null);
      return { id: "m10-created-folder" };
    },
    putFolder: async () => transport.commit("update_folder", "login", null),
    deleteFolder: async () => transport.commit("delete_folder", "login", null),
  };
}

function createRecoveryCipherActionPort(
  transport: RecoveryEvidenceTransport,
): VaultCipherActionPort {
  return {
    updateCipherPartial: async (_session, itemId) =>
      transport.commit("favorite", itemType(itemId), itemId),
    softDeleteCipher: async (_session, itemId) =>
      transport.commit("soft_delete", itemType(itemId), itemId),
    archiveCipher: async (_session, itemId) =>
      transport.commit("archive", itemType(itemId), itemId),
    unarchiveCipher: async (_session, itemId) =>
      transport.commit("unarchive", itemType(itemId), itemId),
    restoreCipher: async (_session, itemId) =>
      transport.commit("restore", itemType(itemId), itemId),
    deleteCipher: async (_session, itemId) =>
      transport.commit("permanent_delete", itemType(itemId), itemId),
  };
}

class RecoveryEvidenceTransport {
  private readonly release = new Set<() => void>();
  private stalePending = false;
  private failureAvailable: boolean;

  constructor(
    state: RecoveryEvidenceState,
    private readonly store: PopupStateStore,
  ) {
    this.failureAvailable = state === "recovery-operation-error";
    document.addEventListener("bw-evidence-release-recovery-transport", this.releaseTransport);
    document.addEventListener("bw-evidence-recovery-transition", this.applyTransition);
    window.addEventListener("hashchange", this.markPendingStale);
  }

  async commit(
    action: RecoveryEvidenceAction,
    type: RecoveryEvidenceItemType,
    itemId: string | null,
  ): Promise<void> {
    const root = document.documentElement;
    root.dataset.bwEvidenceTransportCallCount = String(
      Number(root.dataset.bwEvidenceTransportCallCount ?? "0") + 1,
    );

    if (this.failureAvailable) {
      this.failureAvailable = false;
      recordReceipt({ action, itemType: type, outcome: "failure" });
      throw new Error("Synthetic recovery evidence operation failure");
    }

    if (root.dataset.bwEvidenceRecoveryBarrier === "true") {
      root.dataset.bwEvidenceTransportPending = "true";
      await new Promise<void>((resolve) => this.release.add(resolve));
      delete root.dataset.bwEvidenceTransportPending;
      delete root.dataset.bwEvidenceRecoveryBarrier;
    }

    await requiredBridge("__bwRecoveryServerCommit")(action, itemId);
    recordReceipt({
      action,
      itemType: type,
      outcome: this.stalePending ? "stale" : "committed",
    });
    this.stalePending = false;
  }

  private readonly releaseTransport = (): void => {
    for (const resolve of this.release) resolve();
    this.release.clear();
  };

  private readonly markPendingStale = (): void => {
    if (this.release.size > 0) this.stalePending = true;
  };

  private readonly applyTransition = (event: Event): void => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
    if (event.detail === "sanitize-history") {
      this.sanitizeHistory();
      return;
    }
    if (event.detail === "source-replacement") {
      this.replaceRuntimeState(event.detail);
    } else if (event.detail === "lock") {
      this.store.setLocked();
      this.replaceOrganizationState(event.detail);
      this.store.setStatus("Newer lock status");
    } else if (event.detail === "account-switch") {
      const session = this.store.snapshot().activeSession;
      this.store.setActiveSession(session ? {
        ...session,
        token: { ...session.token, accessToken: `${session.token.accessToken}-new-account` },
      } : null);
      this.replaceRuntimeState(event.detail);
    }
    if (this.release.size > 0) this.stalePending = true;
  };

  private replaceRuntimeState(label: "source-replacement" | "account-switch"): void {
    const snapshot = this.store.snapshot();
    const replace = (item: VaultItem): VaultItem => ({
      ...item,
      name: `Newer ${label} ${itemTypeLabel(item)}`,
      collectionIds: [`m10-${label}-collection`],
    });
    const folders = snapshot.folders.map((folder) => ({ ...folder }));
    this.store.setItems(snapshot.items.map(replace), folders, new Date());
    this.store.setArchivedItems(snapshot.archivedItems.map(replace));
    this.store.setDeletedItems(snapshot.deletedItems.map(replace));
    this.replaceOrganizationState(label);
    this.store.setStatus(`Newer ${label} status`);
  }

  private replaceOrganizationState(label: string): void {
    this.store.setOrganizationData(
      [{ id: `m10-${label}-organization`, name: "Newer organization", enabled: true, status: 2 }],
      [{
        id: `m10-${label}-collection`,
        organizationId: `m10-${label}-organization`,
        name: "Newer collection",
        readOnly: false,
        manage: true,
      }],
    );
  }

  private sanitizeHistory(): void {
    const snapshot = this.store.snapshot();
    const sanitize = (item: VaultItem): VaultItem => item.passwordHistory
      ? { ...item, passwordHistory: item.passwordHistory.map((entry) => ({ ...entry, password: "" })) }
      : item;
    this.store.setItems(snapshot.items.map(sanitize), snapshot.folders, snapshot.lastSyncDate ?? new Date());
    this.store.setArchivedItems(snapshot.archivedItems.map(sanitize));
    this.store.setDeletedItems(snapshot.deletedItems.map(sanitize));
  }
}

function requiredBridge<K extends keyof Pick<Window,
  | "__bwRecoverySecureGet"
  | "__bwRecoverySecureSet"
  | "__bwRecoverySecureDelete"
  | "__bwRecoveryServerCommit"
  | "__bwRecoveryFreshSync"
  | "__bwRecoveryNativeCopy"
>>(name: K): NonNullable<Window[K]> {
  const bridge = window[name];
  if (typeof bridge !== "function") {
    throw new Error("Recovery evidence bridge is unavailable");
  }
  return bridge as NonNullable<Window[K]>;
}

function itemType(itemId: string): RecoveryEvidenceItemType {
  if (itemId.includes("card")) return "card";
  if (itemId.includes("identity")) return "identity";
  if (itemId.includes("note")) return "secure-note";
  return "login";
}

function itemTypeLabel(item: VaultItem): string {
  if (item.type === "card") return "Card";
  if (item.type === "identity") return "Identity";
  if (item.type === "secure-note") return "Note";
  return "Login";
}

function recordReceipt(receipt: RecoveryEvidenceReceipt): void {
  document.documentElement.dataset.bwEvidenceRecoveryReceipt = JSON.stringify(receipt);
}
