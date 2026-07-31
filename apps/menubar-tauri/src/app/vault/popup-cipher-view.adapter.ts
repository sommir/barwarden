import type { VaultField, VaultItem } from "../vault-demo";
import type { VaultItemType } from "./vault-item.model";

export interface RetainedPopupCipherView {
  readonly id: string;
  readonly type: Exclude<VaultItemType, "ssh-key">;
  readonly name: string;
  readonly subtitle: string;
  readonly favorite: boolean;
  readonly folderId: string;
  readonly folderName: string;
  readonly reprompt: boolean;
  readonly edit: boolean;
  readonly viewPassword: boolean;
  readonly organizationId: undefined;
  readonly collectionIds: readonly string[];
  readonly hasAttachments: false;
  readonly hasPasskeys: false;
  readonly hasSshKey: false;
}

export interface RetainedVaultListCipherView extends RetainedPopupCipherView {
  readonly canLaunch: boolean;
  readonly uri: string;
  readonly fields: readonly VaultField[];
}

const retainedSources = new WeakMap<RetainedPopupCipherView, VaultItem>();
const recoveryViews = new WeakMap<VaultItem, RetainedPopupCipherView>();

export function toRetainedPopupCipherView(item: VaultItem): RetainedVaultListCipherView | null {
  if (item.type === "ssh-key") {
    return null;
  }

  const isPersonal = !item.organizationId;
  const retained: RetainedVaultListCipherView = {
    id: item.id,
    type: item.type,
    name: item.name,
    subtitle: item.subtitle,
    favorite: item.favorite,
    folderId: item.folderId,
    folderName: item.folderName,
    reprompt: Boolean(item.reprompt),
    edit: isPersonal,
    viewPassword: isPersonal,
    organizationId: undefined,
    collectionIds: [],
    hasAttachments: false,
    hasPasskeys: false,
    hasSshKey: false,
    canLaunch: item.canLaunch,
    uri: item.uri,
    fields: item.fields,
  };
  retainedSources.set(retained, item);
  return retained;
}

export function toRecoveryPopupCipherView(item: VaultItem): RetainedPopupCipherView | null {
  if (item.type === "ssh-key" || item.organizationId) {
    return null;
  }
  const retained = recoveryViews.get(item);
  if (retained) {
    return retained;
  }
  const projected = toRetainedPopupCipherView(item);
  if (!projected) {
    return null;
  }
  const recovery = Object.freeze({
    id: projected.id,
    type: projected.type,
    name: projected.name,
    subtitle: projected.subtitle,
    favorite: projected.favorite,
    folderId: projected.folderId,
    folderName: projected.folderName,
    reprompt: projected.reprompt,
    edit: projected.edit,
    viewPassword: projected.viewPassword,
    organizationId: projected.organizationId,
    collectionIds: Object.freeze([]),
    hasAttachments: projected.hasAttachments,
    hasPasskeys: projected.hasPasskeys,
    hasSshKey: projected.hasSshKey,
  });
  retainedSources.set(recovery, item);
  recoveryViews.set(item, recovery);
  return recovery;
}

export function resolveRetainedPopupCipherSource(
  view: RetainedPopupCipherView,
): VaultItem | undefined {
  return retainedSources.get(view);
}
