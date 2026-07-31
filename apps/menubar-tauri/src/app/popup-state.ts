import { Injectable } from "@angular/core";
import { BehaviorSubject, type Observable } from "rxjs";

import type { AuthSession } from "../auth/auth-session-store";
import { buildBitwardenEnvironment } from "../bitwarden-api/bitwarden-api";
import type { SendItem, SendItemType } from "./send/send-item.model";
import type { TextSendPolicy } from "./send/text-send-policy";
import type {
  VaultCollection,
  VaultFolder,
  VaultItem,
  VaultItemType,
  VaultOrganization,
} from "./vault/vault-item.model";
import { translateOfficialMessage } from "./official-ui/official-i18n.service";

export type PopupTabId = "vault" | "otp" | "generator" | "send" | "settings";
export type AuthChallengeType = "twoFactor" | "newDevice";
export type VaultSyncStatus = "initial" | "syncing" | "fresh" | "stale" | "unavailable";
export type EditableVaultItemLocation = "active" | "archived";
export type DeletedVaultRestoreDestination = "active" | "archived";

const VAULT_HIERARCHY_NODE_PREFIX = "@hierarchy/node:";
const VAULT_HIERARCHY_CHILD_PREFIX = "@hierarchy/child:";
const VAULT_HIERARCHY_CLOSED = "__closed__";

export interface AuthChallenge {
  readonly type: AuthChallengeType;
  readonly email: string;
  readonly serverUrl: string;
  readonly providers?: readonly string[];
  readonly message?: string;
}

export interface PopupState {
  readonly activeTab: PopupTabId;
  readonly isUnlocked: boolean;
  readonly isLoggingIn: boolean;
  readonly isSyncing: boolean;
  readonly email: string;
  readonly serverUrl: string;
  readonly items: readonly VaultItem[];
  readonly archivedItems: readonly VaultItem[];
  readonly deletedItems: readonly VaultItem[];
  readonly folders: readonly VaultFolder[];
  readonly organizations: readonly VaultOrganization[];
  readonly collections: readonly VaultCollection[];
  readonly sends: readonly SendItem[];
  readonly isSendDisabled: boolean;
  readonly sendPolicy: TextSendPolicy;
  readonly statusMessage: string;
  /** Window-local event identity. Deliberately excluded from process snapshots. */
  readonly statusEventId: number;
  readonly loginError: string;
  readonly syncError: string;
  readonly lastSyncDate: Date | null;
  readonly lastSuccessfulSyncDate: Date | null;
  readonly vaultSyncStatus: VaultSyncStatus;
  readonly vaultSyncMessage: string;
  readonly activeSession: AuthSession | null;
  readonly authChallenge: AuthChallenge | null;
  readonly filterFolderId: string;
  readonly filterType: VaultItemType | "";
  readonly isFilterVisible: boolean;
  readonly collapsedVaultSectionIds: readonly string[];
  readonly sendTypeFilter: SendItemType | "";
  readonly isSendFilterVisible: boolean;
}

@Injectable({ providedIn: "root" })
export class PopupStateStore {
  private vaultSyncEpoch = 0;
  private protectedOperationEpoch = 0;
  private sendRevision = 0;
  private sendLifecycleRevision = 0;
  private readonly deletedRestoreDestinations = new WeakMap<
    VaultItem,
    DeletedVaultRestoreDestination
  >();

  private state: PopupState = {
    activeTab: "vault",
    isUnlocked: false,
    isLoggingIn: false,
    isSyncing: false,
    email: "",
    serverUrl: buildBitwardenEnvironment().webVaultUrl ?? "",
    items: [],
    archivedItems: [],
    deletedItems: [],
    folders: [],
    organizations: [],
    collections: [],
    sends: [],
    isSendDisabled: false,
    sendPolicy: { disabled: false, hideEmailAllowed: true },
    statusMessage: "",
    statusEventId: 0,
    loginError: "",
    syncError: "",
    lastSyncDate: null,
    lastSuccessfulSyncDate: null,
    vaultSyncStatus: "initial",
    vaultSyncMessage: "",
    activeSession: null,
    authChallenge: null,
    filterFolderId: "",
    filterType: "",
    isFilterVisible: true,
    collapsedVaultSectionIds: [],
    sendTypeFilter: "",
    isSendFilterVisible: false,
  };
  private readonly stateSubject = new BehaviorSubject<PopupState>(this.state);

  readonly state$: Observable<PopupState> = this.stateSubject.asObservable();

  snapshot(): PopupState {
    return this.state;
  }

  restore(state: PopupState): void {
    this.vaultSyncEpoch += 1;
    this.protectedOperationEpoch += 1;
    this.sendRevision += 1;
    this.sendLifecycleRevision += 1;
    this.rememberDeletedRestoreDestinations(state.deletedItems);
    this.commit(state);
  }

  beginProtectedOperation(): number {
    return ++this.protectedOperationEpoch;
  }

  isCurrentProtectedOperation(epoch: number): boolean {
    return epoch === this.protectedOperationEpoch;
  }

  cancelProtectedOperations(): void {
    this.protectedOperationEpoch += 1;
  }

  currentSendRevision(): number {
    return this.sendRevision;
  }

  currentSendLifecycleRevision(): number {
    return this.sendLifecycleRevision;
  }

  setLoggingIn(isLoggingIn: boolean): void {
    this.commit({ ...this.state, isLoggingIn });
  }

  setSyncing(isSyncing: boolean): void {
    this.commit({ ...this.state, isSyncing });
  }

  beginVaultSync(): number {
    const epoch = ++this.vaultSyncEpoch;
    this.commit({
      ...this.state,
      isSyncing: true,
      vaultSyncStatus: "syncing",
      vaultSyncMessage: "",
    });
    return epoch;
  }

  isCurrentVaultSync(epoch: number): boolean {
    return epoch === this.vaultSyncEpoch;
  }

  commitVaultSync(date: Date, epoch = this.vaultSyncEpoch): void {
    if (!this.isCurrentVaultSync(epoch)) {
      return;
    }
    this.commit({
      ...this.state,
      isSyncing: false,
      syncError: "",
      lastSyncDate: date,
      lastSuccessfulSyncDate: date,
      vaultSyncStatus: "fresh",
      vaultSyncMessage: "",
    });
  }

  failVaultSync(hasUsableItems: boolean, epoch = this.vaultSyncEpoch): void {
    if (!this.isCurrentVaultSync(epoch)) {
      return;
    }
    const message = hasUsableItems
      ? translateOfficialMessage("i18nSyncFailedShowingSavedVault")
      : translateOfficialMessage("i18nVaultLoadFailed");
    this.commit({
      ...this.state,
      isSyncing: false,
      syncError: message,
      vaultSyncStatus: hasUsableItems ? "stale" : "unavailable",
      vaultSyncMessage: message,
    });
  }

  setUnlocked(email: string): void {
    this.protectedOperationEpoch += 1;
    this.commit({ ...this.state, email, isUnlocked: true, loginError: "", authChallenge: null });
  }

  setLocked(): void {
    this.setLockedAccount(this.state.email, this.state.serverUrl);
  }

  setLockedAccount(email: string, serverUrl: string): void {
    this.vaultSyncEpoch += 1;
    this.protectedOperationEpoch += 1;
    this.sendRevision += 1;
    this.sendLifecycleRevision += 1;
    this.commit({
      ...this.state,
      isUnlocked: false,
      isLoggingIn: false,
      isSyncing: false,
      email,
      serverUrl,
      items: [],
      archivedItems: [],
      deletedItems: [],
      folders: [],
      organizations: [],
      collections: [],
      sends: [],
      isSendDisabled: false,
      sendPolicy: { disabled: false, hideEmailAllowed: true },
      statusMessage: translateOfficialMessage("locked"),
      statusEventId: this.state.statusEventId + 1,
      syncError: "",
      lastSyncDate: null,
      lastSuccessfulSyncDate: null,
      vaultSyncStatus: "initial",
      vaultSyncMessage: "",
      activeSession: null,
      authChallenge: null,
      filterFolderId: "",
      filterType: "",
      isFilterVisible: true,
      collapsedVaultSectionIds: [],
      sendTypeFilter: "",
      isSendFilterVisible: false,
    });
  }

  setItems(
    items: readonly VaultItem[],
    folders: readonly VaultFolder[] = this.state.folders,
    lastSyncDate = new Date(),
  ): void {
    this.commit({
      ...this.state,
      items,
      folders,
      lastSyncDate,
      lastSuccessfulSyncDate: lastSyncDate,
      vaultSyncStatus: "fresh",
      vaultSyncMessage: "",
    });
  }

  setArchivedItems(archivedItems: readonly VaultItem[]): void {
    this.commit({ ...this.state, archivedItems });
  }

  setDeletedItems(deletedItems: readonly VaultItem[]): void {
    this.rememberDeletedRestoreDestinations(deletedItems);
    this.commit({ ...this.state, deletedItems });
  }

  setOrganizationData(
    organizations: readonly VaultOrganization[],
    collections: readonly VaultCollection[],
  ): void {
    this.commit({ ...this.state, organizations, collections });
  }

  updateVaultItem(itemId: string, update: (item: VaultItem) => VaultItem): void {
    this.commit({
      ...this.state,
      items: this.state.items.map((item) => item.id === itemId ? update(item) : item),
    });
  }

  replaceVaultItem(itemId: string, item: VaultItem): boolean {
    const isActive = this.state.items.some((candidate) => candidate.id === itemId);
    const isArchived = this.state.archivedItems.some((candidate) => candidate.id === itemId);
    if (!isActive && !isArchived) {
      return false;
    }

    this.commit({
      ...this.state,
      items: isActive
        ? this.state.items.map((candidate) => candidate.id === itemId ? item : candidate)
        : this.state.items,
      archivedItems: isArchived
        ? this.state.archivedItems.map((candidate) => candidate.id === itemId ? item : candidate)
        : this.state.archivedItems,
    });
    return true;
  }

  addActiveVaultItem(item: VaultItem): boolean {
    const idExists = [
      ...this.state.items,
      ...this.state.archivedItems,
      ...this.state.deletedItems,
    ].some((candidate) => candidate.id === item.id);
    if (idExists) {
      return false;
    }
    this.commit({ ...this.state, items: [item, ...this.state.items] });
    return true;
  }

  replaceVaultItemExact(
    source: VaultItem,
    location: EditableVaultItemLocation | "deleted",
    replacement: VaultItem,
  ): boolean {
    if (location === "deleted") {
      return false;
    }
    const collection = location === "active" ? this.state.items : this.state.archivedItems;
    const index = collection.findIndex((candidate) => candidate === source);
    if (index < 0) {
      return false;
    }
    const replacementCollision = [
      ...this.state.items,
      ...this.state.archivedItems,
      ...this.state.deletedItems,
    ].some((candidate) => candidate !== source && candidate.id === replacement.id);
    if (replacementCollision) {
      return false;
    }
    const next = collection.map((candidate, candidateIndex) =>
      candidateIndex === index ? replacement : candidate,
    );
    this.commit({
      ...this.state,
      items: location === "active" ? next : this.state.items,
      archivedItems: location === "archived" ? next : this.state.archivedItems,
    });
    return true;
  }

  saveVaultItem(item: VaultItem): void {
    const isActive = this.state.items.some((candidate) => candidate.id === item.id);
    const isArchived = this.state.archivedItems.some((candidate) => candidate.id === item.id);
    this.commit({
      ...this.state,
      items: isActive
        ? this.state.items.map((candidate) => candidate.id === item.id ? item : candidate)
        : isArchived ? this.state.items : [item, ...this.state.items],
      archivedItems: isArchived
        ? this.state.archivedItems.map((candidate) => candidate.id === item.id ? item : candidate)
        : this.state.archivedItems,
    });
  }

  archiveVaultItem(itemId: string): void {
    const item = this.state.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }

    this.commit({
      ...this.state,
      items: this.state.items.filter((candidate) => candidate.id !== itemId),
      archivedItems: [item, ...this.state.archivedItems.filter((candidate) => candidate.id !== itemId)],
    });
  }

  deleteVaultItem(itemId: string): void {
    const item = this.state.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }
    this.deletedRestoreDestinations.set(item, "active");

    this.commit({
      ...this.state,
      items: this.state.items.filter((candidate) => candidate.id !== itemId),
      deletedItems: [item, ...this.state.deletedItems.filter((candidate) => candidate.id !== itemId)],
    });
  }

  restoreArchivedVaultItem(itemId: string): void {
    const item = this.state.archivedItems.find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }

    this.commit({
      ...this.state,
      archivedItems: this.state.archivedItems.filter((candidate) => candidate.id !== itemId),
      items: [item, ...this.state.items.filter((candidate) => candidate.id !== itemId)],
    });
  }

  restoreDeletedVaultItem(itemId: string, destination: "active" | "archived" = "active"): void {
    const item = this.state.deletedItems.find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }

    this.commit({
      ...this.state,
      deletedItems: this.state.deletedItems.filter((candidate) => candidate.id !== itemId),
      items: destination === "active"
        ? [item, ...this.state.items.filter((candidate) => candidate.id !== itemId)]
        : this.state.items,
      archivedItems: destination === "archived"
        ? [item, ...this.state.archivedItems.filter((candidate) => candidate.id !== itemId)]
        : this.state.archivedItems,
    });
  }

  saveFolder(folder: { readonly id?: string; readonly name: string }): VaultFolder {
    const name = folder.name.trim();
    const id = folder.id ?? uniqueFolderId(name, this.state.folders);
    const savedFolder = { id, name };
    const exists = this.state.folders.some((candidate) => candidate.id === id);

    this.commit({
      ...this.state,
      folders: exists
        ? this.state.folders.map((candidate) => candidate.id === id ? savedFolder : candidate)
        : [...this.state.folders, savedFolder],
      items: this.state.items.map((item) => item.folderId === id ? { ...item, folderName: name } : item),
    });

    return savedFolder;
  }

  deleteFolder(folderId: string): void {
    this.commit({
      ...this.state,
      folders: this.state.folders.filter((folder) => folder.id !== folderId),
      items: this.state.items.map((item) => item.folderId === folderId
        ? { ...item, folderId: "", folderName: "" }
        : item),
    });
  }

  moveArchivedVaultItemToTrash(itemId: string): void {
    const item = this.state.archivedItems.find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }
    this.deletedRestoreDestinations.set(item, "archived");

    this.commit({
      ...this.state,
      archivedItems: this.state.archivedItems.filter((candidate) => candidate.id !== itemId),
      deletedItems: [item, ...this.state.deletedItems.filter((candidate) => candidate.id !== itemId)],
    });
  }

  permanentlyDeleteVaultItem(itemId: string): void {
    this.commit({
      ...this.state,
      deletedItems: this.state.deletedItems.filter((candidate) => candidate.id !== itemId),
    });
  }

  deletedVaultItemRestoreDestination(item: VaultItem): DeletedVaultRestoreDestination {
    return this.deletedRestoreDestinations.get(item) ??
      (item.archivedDate ? "archived" : "active");
  }

  setSends(sends: readonly SendItem[], sendPolicy = this.state.sendPolicy): void {
    this.sendRevision += 1;
    this.commit({
      ...this.state,
      sends,
      sendPolicy,
      isSendDisabled: sendPolicy.disabled,
    });
  }

  setSendDisabled(isSendDisabled: boolean): void {
    this.commit({
      ...this.state,
      isSendDisabled,
      sendPolicy: { ...this.state.sendPolicy, disabled: isSendDisabled },
    });
  }

  saveSend(send: SendItem): void {
    const exists = this.state.sends.some((candidate) => candidate.id === send.id);
    this.sendRevision += 1;
    this.commit({
      ...this.state,
      sends: exists
        ? this.state.sends.map((candidate) => candidate.id === send.id ? send : candidate)
        : [send, ...this.state.sends],
    });
  }

  addSend(send: SendItem): void {
    this.saveSend(send);
  }

  deleteSend(sendId: string): void {
    this.sendRevision += 1;
    this.commit({
      ...this.state,
      sends: this.state.sends.filter((send) => send.id !== sendId),
    });
  }

  setStatus(statusMessage: string): void {
    this.commit({
      ...this.state,
      statusMessage,
      statusEventId: this.state.statusEventId + 1,
    });
  }

  setActiveTab(activeTab: PopupTabId): void {
    if (activeTab !== this.state.activeTab) {
      this.commit({ ...this.state, activeTab });
    }
  }

  setLoginError(loginError: string): void {
    this.commit({ ...this.state, loginError, authChallenge: loginError ? null : this.state.authChallenge });
  }

  setServerUrl(serverUrl: string): void {
    this.commit({ ...this.state, serverUrl });
  }

  setActiveSession(activeSession: AuthSession | null): void {
    if (activeSession !== this.state.activeSession) {
      this.protectedOperationEpoch += 1;
    }
    this.commit({ ...this.state, activeSession });
  }

  setAuthChallenge(authChallenge: AuthChallenge): void {
    this.setLockedAccount(authChallenge.email, authChallenge.serverUrl);
    this.commit({
      ...this.state,
      authChallenge,
      loginError: "",
      statusMessage: authChallenge.message ?? "Authentication required",
    });
  }

  setAuthChallengeError(authChallenge: AuthChallenge, loginError: string): void {
    this.setLockedAccount(authChallenge.email, authChallenge.serverUrl);
    this.commit({
      ...this.state,
      authChallenge,
      loginError,
      statusMessage: authChallenge.message ?? "Authentication required",
    });
  }

  clearAuthChallenge(): void {
    this.commit({ ...this.state, authChallenge: null });
  }

  setSyncError(syncError: string): void {
    this.commit({ ...this.state, syncError });
  }

  setFilterFolderId(filterFolderId: string): void {
    this.commit({ ...this.state, filterFolderId });
  }

  setFilterType(filterType: VaultItemType | ""): void {
    this.commit({ ...this.state, filterType });
  }

  setFilterVisible(isFilterVisible: boolean): void {
    this.commit({ ...this.state, isFilterVisible });
  }

  resetFilters(): void {
    this.commit({
      ...this.state,
      filterFolderId: "",
      filterType: "",
    });
  }

  isVaultSectionOpen(sectionId: string): boolean {
    return !this.state.collapsedVaultSectionIds.includes(sectionId);
  }

  toggleVaultSection(sectionId: string): void {
    const collapsed = this.state.collapsedVaultSectionIds;
    this.commit({
      ...this.state,
      collapsedVaultSectionIds: collapsed.includes(sectionId)
        ? collapsed.filter((id) => id !== sectionId)
        : [...collapsed, sectionId],
    });
  }

  vaultHierarchyOpenNodeId(): string | null {
    return this.vaultHierarchyOpenNodeIds()[0] ?? null;
  }

  vaultHierarchyOpenChildId(): string | null {
    return this.vaultHierarchyOpenChildIds()[0] ?? null;
  }

  /**
   * Hierarchy disclosures are independent.  Multiple vault categories can
   * remain open at once, like Finder's outline view, rather than behaving as
   * a single-choice accordion.
   */
  vaultHierarchyOpenNodeIds(): readonly string[] {
    const ids = this.hierarchyIds(VAULT_HIERARCHY_NODE_PREFIX);
    return ids.length === 0 && !this.hasClosedHierarchyMarker(VAULT_HIERARCHY_NODE_PREFIX)
      ? ["all-items"]
      : ids;
  }

  vaultHierarchyOpenChildIds(): readonly string[] {
    return this.hierarchyIds(VAULT_HIERARCHY_CHILD_PREFIX);
  }

  toggleVaultHierarchyNode(nodeId: string): void {
    this.toggleHierarchyId(VAULT_HIERARCHY_NODE_PREFIX, nodeId);
  }

  toggleVaultHierarchyChild(childId: string): void {
    this.toggleHierarchyId(VAULT_HIERARCHY_CHILD_PREFIX, childId);
  }

  setVaultHierarchyOpenState(
    nodeId: string | null,
    childId: string | null = null,
  ): void {
    const retained = this.state.collapsedVaultSectionIds.filter((id) =>
      !id.startsWith(VAULT_HIERARCHY_NODE_PREFIX)
      && !id.startsWith(VAULT_HIERARCHY_CHILD_PREFIX)
    );
    this.commit({
      ...this.state,
      collapsedVaultSectionIds: [
        ...retained,
        `${VAULT_HIERARCHY_NODE_PREFIX}${nodeId ?? VAULT_HIERARCHY_CLOSED}`,
        `${VAULT_HIERARCHY_CHILD_PREFIX}${childId ?? VAULT_HIERARCHY_CLOSED}`,
      ],
    });
  }

  private hierarchyIds(prefix: string): string[] {
    return this.state.collapsedVaultSectionIds
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => entry.slice(prefix.length))
      .filter((id) => id !== VAULT_HIERARCHY_CLOSED);
  }

  private hasClosedHierarchyMarker(prefix: string): boolean {
    return this.state.collapsedVaultSectionIds.includes(`${prefix}${VAULT_HIERARCHY_CLOSED}`);
  }

  private toggleHierarchyId(prefix: string, id: string): void {
    const retained = this.state.collapsedVaultSectionIds.filter((entry) => !entry.startsWith(prefix));
    const openIds = prefix === VAULT_HIERARCHY_NODE_PREFIX
      ? [...this.vaultHierarchyOpenNodeIds()]
      : this.hierarchyIds(prefix);
    const nextIds = openIds.includes(id)
      ? openIds.filter((openId) => openId !== id)
      : [...openIds, id];
    const needsClosedMarker = prefix === VAULT_HIERARCHY_NODE_PREFIX && nextIds.length === 0;

    this.commit({
      ...this.state,
      collapsedVaultSectionIds: [
        ...retained,
        ...nextIds.map((openId) => `${prefix}${openId}`),
        ...(needsClosedMarker ? [`${prefix}${VAULT_HIERARCHY_CLOSED}`] : []),
      ],
    });
  }

  setSendTypeFilter(sendTypeFilter: SendItemType | ""): void {
    this.commit({ ...this.state, sendTypeFilter });
  }

  setSendFilterVisible(isSendFilterVisible: boolean): void {
    this.commit({ ...this.state, isSendFilterVisible });
  }

  setLoggedOut(): void {
    this.vaultSyncEpoch += 1;
    this.protectedOperationEpoch += 1;
    this.sendRevision += 1;
    this.sendLifecycleRevision += 1;
    this.commit({
      ...this.state,
      isUnlocked: false,
      isLoggingIn: false,
      isSyncing: false,
      email: "",
      items: [],
      archivedItems: [],
      deletedItems: [],
      folders: [],
      organizations: [],
      collections: [],
      sends: [],
      isSendDisabled: false,
      sendPolicy: { disabled: false, hideEmailAllowed: true },
      loginError: "",
      syncError: "",
      lastSyncDate: null,
      lastSuccessfulSyncDate: null,
      vaultSyncStatus: "initial",
      vaultSyncMessage: "",
      activeSession: null,
      authChallenge: null,
      filterFolderId: "",
      filterType: "",
      isFilterVisible: true,
      collapsedVaultSectionIds: [],
      sendTypeFilter: "",
      isSendFilterVisible: false,
    });
  }

  private commit(next: PopupState): void {
    this.state = next;
    this.stateSubject.next(next);
  }

  private rememberDeletedRestoreDestinations(items: readonly VaultItem[]): void {
    for (const item of items) {
      this.deletedRestoreDestinations.set(item, item.archivedDate ? "archived" : "active");
    }
  }
}

function uniqueFolderId(name: string, folders: readonly VaultFolder[]): string {
  const base = slugifyFolderName(name) || "folder";
  const existingIds = new Set(folders.map((folder) => folder.id));
  if (!existingIds.has(base)) {
    return base;
  }

  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function slugifyFolderName(name: string): string {
  return name
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
