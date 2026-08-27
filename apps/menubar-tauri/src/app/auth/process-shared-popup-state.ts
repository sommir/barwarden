import type { AuthSession } from "../../auth/auth-session-store";
import type {
  PopupState,
  PopupTabId,
  VaultSyncStatus,
} from "../popup-state";
import type { SendItem } from "../send/send-item.model";
import type { VaultItem } from "../vault/vault-item.model";

const PROCESS_SNAPSHOT_VERSION = 2;
const MAX_PROCESS_SNAPSHOT_BYTES = 2_500_000;
const PROCESS_SNAPSHOT_KEYS = [
  "schemaVersion",
  "activeTab",
  "isUnlocked",
  "isSyncing",
  "email",
  "serverUrl",
  "items",
  "archivedItems",
  "deletedItems",
  "folders",
  "organizations",
  "collections",
  "sends",
  "isSendDisabled",
  "sendPolicy",
  "statusMessage",
  "loginError",
  "syncError",
  "lastSyncDate",
  "lastSuccessfulSyncDate",
  "vaultSyncStatus",
  "vaultSyncMessage",
  "filterFolderId",
  "filterType",
  "isFilterVisible",
  "collapsedVaultSectionIds",
  "sendTypeFilter",
  "isSendFilterVisible",
] as const;

interface ProcessSharedPopupState {
  readonly schemaVersion: typeof PROCESS_SNAPSHOT_VERSION;
  readonly activeTab: PopupTabId;
  readonly isUnlocked: true;
  readonly isSyncing: boolean;
  readonly email: string;
  readonly serverUrl: string;
  readonly items: readonly ProcessSharedVaultItem[];
  readonly archivedItems: readonly ProcessSharedVaultItem[];
  readonly deletedItems: readonly ProcessSharedVaultItem[];
  readonly folders: PopupState["folders"];
  readonly organizations: PopupState["organizations"];
  readonly collections: PopupState["collections"];
  readonly sends: readonly ProcessSharedSendItem[];
  readonly isSendDisabled: boolean;
  readonly sendPolicy: PopupState["sendPolicy"];
  readonly statusMessage: string;
  readonly loginError: string;
  readonly syncError: string;
  readonly lastSyncDate: string | null;
  readonly lastSuccessfulSyncDate: string | null;
  readonly vaultSyncStatus: VaultSyncStatus;
  readonly vaultSyncMessage: string;
  readonly filterFolderId: string;
  readonly filterType: PopupState["filterType"];
  readonly isFilterVisible: boolean;
  readonly collapsedVaultSectionIds: readonly string[];
  readonly sendTypeFilter: PopupState["sendTypeFilter"];
  readonly isSendFilterVisible: boolean;
}

interface ProcessSharedVaultItem {
  readonly id: string;
  readonly type: VaultItem["type"];
  readonly name: string;
  readonly favorite: boolean;
  readonly folderId: string;
  readonly folderName: string;
  readonly organizationName: string;
  readonly attachmentCount: number;
  readonly createdDate: string;
  readonly revisionDate: string;
  readonly archivedDate?: string;
  readonly deletedDate?: string;
}

interface ProcessSharedSendItem {
  readonly id: string;
  readonly type: SendItem["type"];
  readonly name: string;
  readonly revisionDate: string;
  readonly deletionDate: string;
  readonly disabled: boolean;
  readonly accessCount: number;
  readonly maxAccessCount?: number;
  readonly hasPassword: boolean;
}

export function encodeProcessSharedPopupState(
  state: PopupState,
): ProcessSharedPopupState {
  if (!state.isUnlocked || !state.activeSession) {
    throw invalidSnapshot();
  }
  const shared: ProcessSharedPopupState = {
    schemaVersion: PROCESS_SNAPSHOT_VERSION,
    activeTab: state.activeTab,
    isUnlocked: true,
    isSyncing: state.isSyncing,
    email: state.email,
    serverUrl: state.serverUrl,
    items: processSharedVaultItems(state.items),
    archivedItems: processSharedVaultItems(state.archivedItems),
    deletedItems: processSharedVaultItems(state.deletedItems),
    folders: state.folders.map(({ id, name }) => ({ id, name })),
    organizations: state.organizations.map(({ id, name, enabled, status }) => ({
      id,
      name,
      enabled,
      status,
    })),
    collections: state.collections.map(({
      id,
      organizationId,
      name,
      readOnly,
      manage,
    }) => ({ id, organizationId, name, readOnly, manage })),
    sends: processSharedSendItems(state.sends),
    isSendDisabled: state.isSendDisabled,
    sendPolicy: state.sendPolicy,
    statusMessage: state.statusMessage,
    loginError: state.loginError,
    syncError: state.syncError,
    lastSyncDate: state.lastSyncDate?.toISOString() ?? null,
    lastSuccessfulSyncDate: state.lastSuccessfulSyncDate?.toISOString() ?? null,
    vaultSyncStatus: state.vaultSyncStatus,
    vaultSyncMessage: state.vaultSyncMessage,
    filterFolderId: state.filterFolderId,
    filterType: state.filterType,
    isFilterVisible: state.isFilterVisible,
    collapsedVaultSectionIds: state.collapsedVaultSectionIds,
    sendTypeFilter: state.sendTypeFilter,
    isSendFilterVisible: state.isSendFilterVisible,
  };
  return normalizeJsonSnapshot(shared);
}

function processSharedVaultItems(
  items: PopupState["items"],
): readonly ProcessSharedVaultItem[] {
  return items.map(({
    id,
    type,
    name,
    favorite,
    folderId,
    folderName,
    organizationName,
    attachmentCount,
    createdDate,
    revisionDate,
    archivedDate,
    deletedDate,
  }) => ({
    id,
    type,
    name,
    favorite,
    folderId,
    folderName,
    organizationName,
    attachmentCount,
    createdDate,
    revisionDate,
    ...(archivedDate === undefined ? {} : { archivedDate }),
    ...(deletedDate === undefined ? {} : { deletedDate }),
  }));
}

function processSharedSendItems(
  sends: PopupState["sends"],
): readonly ProcessSharedSendItem[] {
  return sends.map(({
    id,
    type,
    name,
    revisionDate,
    deletionDate,
    disabled,
    accessCount,
    maxAccessCount,
    hasPassword,
  }) => ({
    id,
    type,
    name,
    revisionDate,
    deletionDate,
    disabled,
    accessCount,
    ...(maxAccessCount === undefined ? {} : { maxAccessCount }),
    hasPassword: hasPassword === true,
  }));
}

function localVaultItems(
  value: unknown,
  localItems: PopupState["items"] = [],
): PopupState["items"] {
  return array(value).map((entry) => {
    const item = exactNestedRecord(entry, [
      "id",
      "type",
      "name",
      "favorite",
      "folderId",
      "folderName",
      "organizationName",
      "attachmentCount",
      "createdDate",
      "revisionDate",
      "archivedDate",
      "deletedDate",
    ]);
    const type = filterType(item["type"]);
    if (type === "") {
      throw invalidSnapshot();
    }
    const publicItem: VaultItem = {
      id: string(item["id"]),
      type,
      name: string(item["name"]),
      subtitle: "",
      favorite: boolean(item["favorite"]),
      folderId: string(item["folderId"]),
      folderName: string(item["folderName"]),
      organizationName: string(item["organizationName"]),
      attachmentCount: finiteNumber(item["attachmentCount"]),
      uris: [],
      fields: [],
      createdDate: string(item["createdDate"]),
      revisionDate: string(item["revisionDate"]),
      ...(item["archivedDate"] === undefined
        ? {}
        : { archivedDate: string(item["archivedDate"]) }),
      ...(item["deletedDate"] === undefined
        ? {}
        : { deletedDate: string(item["deletedDate"]) }),
      notes: "",
      canLaunch: false,
      canFill: false,
      uri: "",
      requiresVaultSyncBeforeEdit: true,
    };
    const local = localItems.find((candidate) =>
      candidate.id === publicItem.id
      && candidate.revisionDate === publicItem.revisionDate
    );
    return local
      ? {
          ...local,
          name: publicItem.name,
          favorite: publicItem.favorite,
          folderId: publicItem.folderId,
          folderName: publicItem.folderName,
          organizationName: publicItem.organizationName,
          attachmentCount: publicItem.attachmentCount,
          archivedDate: publicItem.archivedDate,
          deletedDate: publicItem.deletedDate,
        }
      : publicItem;
  });
}

function localSendItems(
  value: unknown,
  localItems: PopupState["sends"] = [],
): PopupState["sends"] {
  return array(value).map((entry) => {
    const item = exactNestedRecord(entry, [
      "id",
      "type",
      "name",
      "revisionDate",
      "deletionDate",
      "disabled",
      "accessCount",
      "maxAccessCount",
      "hasPassword",
    ]);
    const type = item["type"];
    if (type !== "text" && type !== "file") {
      throw invalidSnapshot();
    }
    const publicSend: SendItem = {
      id: string(item["id"]),
      accessId: "",
      type,
      name: string(item["name"]),
      notes: "",
      revisionDate: string(item["revisionDate"]),
      deletionDate: string(item["deletionDate"]),
      disabled: boolean(item["disabled"]),
      accessCount: finiteNumber(item["accessCount"]),
      ...(item["maxAccessCount"] === undefined
        ? {}
        : { maxAccessCount: finiteNumber(item["maxAccessCount"]) }),
      hasPassword: boolean(item["hasPassword"]),
    };
    const local = localItems.find((candidate) =>
      candidate.id === publicSend.id
      && candidate.revisionDate === publicSend.revisionDate
    );
    return local
      ? {
          ...local,
          name: publicSend.name,
          deletionDate: publicSend.deletionDate,
          disabled: publicSend.disabled,
          accessCount: publicSend.accessCount,
          maxAccessCount: publicSend.maxAccessCount,
          hasPassword: publicSend.hasPassword,
        }
      : publicSend;
  });
}

export function decodeProcessSharedPopupState(
  value: unknown,
  session: AuthSession,
  localState?: PopupState,
): PopupState {
  try {
    const shared = exactSnapshot(value);
    return {
      activeTab: popupTab(shared["activeTab"]),
      isUnlocked: true,
      isLoggingIn: false,
      isSyncing: boolean(shared["isSyncing"]),
      email: string(shared["email"]),
      serverUrl: string(shared["serverUrl"]),
      items: localVaultItems(shared["items"], localState?.items),
      archivedItems: localVaultItems(shared["archivedItems"], localState?.archivedItems),
      deletedItems: localVaultItems(shared["deletedItems"], localState?.deletedItems),
      folders: array(shared["folders"]) as PopupState["folders"],
      organizations: array(shared["organizations"]) as PopupState["organizations"],
      collections: array(shared["collections"]) as PopupState["collections"],
      sends: localSendItems(shared["sends"], localState?.sends),
      isSendDisabled: boolean(shared["isSendDisabled"]),
      sendPolicy: sendPolicy(shared["sendPolicy"]),
      statusMessage: string(shared["statusMessage"]),
      statusEventId: 0,
      loginError: string(shared["loginError"]),
      syncError: string(shared["syncError"]),
      lastSyncDate: date(shared["lastSyncDate"]),
      lastSuccessfulSyncDate: date(shared["lastSuccessfulSyncDate"]),
      vaultSyncStatus: vaultSyncStatus(shared["vaultSyncStatus"]),
      vaultSyncMessage: string(shared["vaultSyncMessage"]),
      vaultOwnerAccountId: null,
      activeSession: session,
      authChallenge: null,
      filterFolderId: string(shared["filterFolderId"]),
      filterType: filterType(shared["filterType"]),
      isFilterVisible: boolean(shared["isFilterVisible"]),
      collapsedVaultSectionIds: stringArray(shared["collapsedVaultSectionIds"]),
      sendTypeFilter: sendTypeFilter(shared["sendTypeFilter"]),
      isSendFilterVisible: boolean(shared["isSendFilterVisible"]),
    };
  } catch {
    throw invalidSnapshot();
  }
}

export function processSharedPopupStateRequiresLocalHydration(
  state: PopupState,
): boolean {
  return state.items.some((item) => item.requiresVaultSyncBeforeEdit === true)
    || state.archivedItems.some((item) => item.requiresVaultSyncBeforeEdit === true)
    || state.deletedItems.some((item) => item.requiresVaultSyncBeforeEdit === true)
    || state.sends.some((send) => send.accessId === "");
}

function exactSnapshot(value: unknown): Record<string, unknown> {
  assertJsonValue(value);
  if (!isPlainRecord(value)) {
    throw invalidSnapshot();
  }
  const keys = Object.keys(value);
  if (
    keys.length !== PROCESS_SNAPSHOT_KEYS.length ||
    !keys.every((key) => (PROCESS_SNAPSHOT_KEYS as readonly string[]).includes(key)) ||
    value["schemaVersion"] !== PROCESS_SNAPSHOT_VERSION ||
    value["isUnlocked"] !== true
  ) {
    throw invalidSnapshot();
  }
  return value;
}

function assertJsonValue(
  value: unknown,
  depth = 0,
  budget = { nodes: 0 },
): void {
  budget.nodes += 1;
  if (depth > 64 || budget.nodes > 100_000) {
    throw invalidSnapshot();
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertJsonValue(entry, depth + 1, budget);
    }
    return;
  }
  if (!isPlainRecord(value)) {
    throw invalidSnapshot();
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || sensitiveKey(key)) {
      throw invalidSnapshot();
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw invalidSnapshot();
    }
    assertJsonValue(descriptor.value, depth + 1, budget);
  }
}

function normalizeJsonSnapshot<T>(value: T): T {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw invalidSnapshot();
    }
    if (new TextEncoder().encode(serialized).byteLength > MAX_PROCESS_SNAPSHOT_BYTES) {
      throw invalidSnapshot();
    }
    const normalized = stripSensitiveKeys(JSON.parse(serialized)) as T;
    assertJsonValue(normalized);
    return normalized;
  } catch {
    throw invalidSnapshot();
  }
}

function exactNestedRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw invalidSnapshot();
  }
  const keys = Object.keys(value);
  if (!keys.every((key) => allowedKeys.includes(key))) {
    throw invalidSnapshot();
  }
  return value;
}

function stripSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripSensitiveKeys);
  }
  if (!isPlainRecord(value)) {
    return value;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!sensitiveKey(key)) {
      sanitized[key] = stripSensitiveKeys(entry);
    }
  }
  return sanitized;
}

function sensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase();
  return [
    "masterpassword",
    "accesstoken",
    "refreshtoken",
    "activesession",
    "sessiontoken",
  ].includes(normalized);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function string(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidSnapshot();
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw invalidSnapshot();
  }
  return value;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidSnapshot();
  }
  return value;
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw invalidSnapshot();
  }
  return value;
}

function stringArray(value: unknown): readonly string[] {
  const values = array(value);
  if (!values.every((entry) => typeof entry === "string")) {
    throw invalidSnapshot();
  }
  return values as readonly string[];
}

function date(value: unknown): Date | null {
  if (value === null) {
    return null;
  }
  const source = string(value);
  const parsed = new Date(source);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== source) {
    throw invalidSnapshot();
  }
  return parsed;
}

function vaultSyncStatus(value: unknown): VaultSyncStatus {
  if (
    value !== "initial" &&
    value !== "syncing" &&
    value !== "fresh" &&
    value !== "stale" &&
    value !== "unavailable"
  ) {
    throw invalidSnapshot();
  }
  return value;
}

function filterType(value: unknown): PopupState["filterType"] {
  if (
    value !== "" &&
    value !== "login" &&
    value !== "secure-note" &&
    value !== "card" &&
    value !== "identity" &&
    value !== "ssh-key"
  ) {
    throw invalidSnapshot();
  }
  return value;
}

function popupTab(value: unknown): PopupTabId {
  if (
    value !== "vault" &&
    value !== "otp" &&
    value !== "generator" &&
    value !== "send" &&
    value !== "settings"
  ) {
    throw invalidSnapshot();
  }
  return value;
}

function sendTypeFilter(value: unknown): PopupState["sendTypeFilter"] {
  if (value !== "" && value !== "text" && value !== "file") {
    throw invalidSnapshot();
  }
  return value;
}

function sendPolicy(value: unknown): PopupState["sendPolicy"] {
  if (
    !isPlainRecord(value) ||
    Reflect.ownKeys(value).length !== 2 ||
    !Object.hasOwn(value, "disabled") ||
    !Object.hasOwn(value, "hideEmailAllowed") ||
    typeof value["disabled"] !== "boolean" ||
    typeof value["hideEmailAllowed"] !== "boolean"
  ) {
    throw invalidSnapshot();
  }
  return {
    disabled: value["disabled"],
    hideEmailAllowed: value["hideEmailAllowed"],
  };
}

function invalidSnapshot(): Error {
  return new Error("Invalid process snapshot");
}
