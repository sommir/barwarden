import { Inject, Injectable, InjectionToken, Optional } from "@angular/core";

import type { AuthSession } from "../../auth/auth-session-store";
import {
  BitwardenApiClient,
  type CipherPartialUpdateRequest,
} from "../../bitwarden-api/bitwarden-api";
import { PasteError, type HostApi } from "../../host/host-api";
import { TauriHostService } from "../../host/tauri-host.service";
import { PopupStateStore } from "../popup-state";
import { SettingsService } from "../settings/settings.service";
import { type VaultField, type VaultItem } from "../vault-demo";
import { generateTotpCode, type TotpCode } from "./totp.service";
import { ACCESSIBILITY_PERMISSION_STATUS } from "../official-ui/accessibility-permission-dialog.service";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

export const VAULT_ACTION_HOST = new InjectionToken<HostApi | null>("VAULT_ACTION_HOST", {
  providedIn: "root",
  factory: () => null,
});

export interface VaultCipherActionPort {
  updateCipherPartial(
    session: AuthSession,
    itemId: string,
    request: CipherPartialUpdateRequest,
  ): Promise<void>;
  softDeleteCipher(session: AuthSession, itemId: string): Promise<void>;
  archiveCipher(session: AuthSession, itemId: string): Promise<void>;
  unarchiveCipher(session: AuthSession, itemId: string): Promise<void>;
  restoreCipher(session: AuthSession, itemId: string): Promise<void>;
  deleteCipher(session: AuthSession, itemId: string): Promise<void>;
}

export type VaultMutationNotCommittedReason = "duplicate" | "failure" | "stale";

export interface VaultMutationNotCommitted {
  readonly committed: false;
  readonly reason: VaultMutationNotCommittedReason;
  readonly status: string;
}

export interface VaultFavoriteMutationCommitted {
  readonly committed: true;
  readonly status: string;
  readonly result: {
    readonly kind: "replacement";
    readonly item: VaultItem;
  };
}

export interface VaultRemovalMutationCommitted {
  readonly committed: true;
  readonly status: string;
  readonly result: {
    readonly kind: "removed";
    readonly item: VaultItem;
  };
}

export type VaultFavoriteMutationOutcome =
  | VaultFavoriteMutationCommitted
  | VaultMutationNotCommitted;

export type VaultRemovalMutationOutcome =
  | VaultRemovalMutationCommitted
  | VaultMutationNotCommitted;

export type VaultActionContextGuard = () => boolean;

export interface VaultNativeActionCommitted {
  readonly committed: true;
  readonly status: string;
}

export interface VaultNativeActionNotCommitted {
  readonly committed: false;
  readonly reason: "failure" | "stale";
  readonly status: string;
}

export type VaultNativeActionOutcome =
  | VaultNativeActionCommitted
  | VaultNativeActionNotCommitted;

export type VaultTotpCodeGenerator = (seed: string, epochSeconds: number) => Promise<TotpCode>;

export const VAULT_TOTP_CODE_GENERATOR = new InjectionToken<VaultTotpCodeGenerator>(
  "VAULT_TOTP_CODE_GENERATOR",
  {
    providedIn: "root",
    factory: () => generateTotpCode,
  },
);

export const VAULT_CIPHER_ACTION_PORT = new InjectionToken<VaultCipherActionPort | null>(
  "VAULT_CIPHER_ACTION_PORT",
  {
    providedIn: "root",
    factory: () => null,
  },
);

@Injectable({ providedIn: "root" })
export class VaultActionsService {
  private readonly host: HostApi;
  private readonly totpCodeGenerator: VaultTotpCodeGenerator;
  private readonly favoriteMutations = new Set<string>();
  private readonly lifecycleMutations = new Map<string, symbol>();

  constructor(
    @Optional() @Inject(VAULT_ACTION_HOST) host: HostApi | null = null,
    private readonly settings: SettingsService = new SettingsService(),
    private readonly store: PopupStateStore = new PopupStateStore(),
    @Optional()
    @Inject(VAULT_CIPHER_ACTION_PORT)
    private readonly cipherActions: VaultCipherActionPort | null = null,
    @Optional()
    @Inject(VAULT_TOTP_CODE_GENERATOR)
    totpCodeGenerator: VaultTotpCodeGenerator | null = null,
  ) {
    this.host = host ?? new TauriHostService();
    this.totpCodeGenerator = totpCodeGenerator ?? generateTotpCode;
  }

  async copyField(field: VaultField, epochSeconds = Date.now() / 1000): Promise<string> {
    return (await this.copyFieldWithOutcome(field, alwaysCurrent, epochSeconds)).status;
  }

  async copyFieldWithOutcome(
    field: VaultField,
    isCurrent: VaultActionContextGuard,
    epochSeconds = Date.now() / 1000,
  ): Promise<VaultNativeActionOutcome> {
    if (!guardAllows(isCurrent)) {
      return staleNativeAction();
    }
    const resolvedField = await this.resolveActionField(field, epochSeconds);
    if (!guardAllows(isCurrent)) {
      return staleNativeAction();
    }
    if (!resolvedField) {
      return failedNativeAction(translateOfficialMessage("i18nUnableToGenerateOtp"));
    }

    return this.copyResolvedField(
      resolvedField,
      isCurrent,
      translateOfficialMessage("i18nCopiedLabel", resolvedField.label),
      translateOfficialMessage("i18nUnableToCopyField"),
    );
  }

  async fillField(field: VaultField, epochSeconds = Date.now() / 1000): Promise<string> {
    return (await this.fillFieldWithOutcome(field, alwaysCurrent, epochSeconds)).status;
  }

  async fillFieldWithOutcome(
    field: VaultField,
    isCurrent: VaultActionContextGuard,
    epochSeconds = Date.now() / 1000,
  ): Promise<VaultNativeActionOutcome> {
    if (!guardAllows(isCurrent)) {
      return staleNativeAction();
    }
    const resolvedField = await this.resolveActionField(field, epochSeconds);
    if (!guardAllows(isCurrent)) {
      return staleNativeAction();
    }
    if (!resolvedField) {
      return failedNativeAction(translateOfficialMessage("i18nUnableToGenerateOtp"));
    }

    const settings = this.settings.snapshot();
    if (settings.fillMode === "clipboard-copy") {
      return this.copyResolvedField(
        resolvedField,
        isCurrent,
        translateOfficialMessage("i18nCopiedLabel", resolvedField.label),
        translateOfficialMessage("i18nUnableToFillField"),
      );
    }

    if (!guardAllows(isCurrent)) {
      return staleNativeAction();
    }
    try {
      await this.host.pasteText(resolvedField.value, settings.clipboardClearSeconds);
      if (!guardAllows(isCurrent)) {
        return staleNativeAction();
      }
      return committedNativeAction(translateOfficialMessage("i18nFilledLabel", resolvedField.label));
    } catch (error) {
      if (!guardAllows(isCurrent)) {
        return staleNativeAction();
      }
      if (error instanceof PasteError && error.valueCopied) {
        return committedNativeAction(
          error.code === "accessibility-denied"
            ? ACCESSIBILITY_PERMISSION_STATUS
            : translateOfficialMessage("i18nPasteUnavailableValueCopied"),
        );
      }
      return this.copyResolvedField(
        resolvedField,
        isCurrent,
        translateOfficialMessage("i18nPasteUnavailableValueCopied"),
        translateOfficialMessage("i18nUnableToFillField"),
      );
    }
  }

  async launchUri(uri: string): Promise<string> {
    return (await this.launchUriWithOutcome(uri, alwaysCurrent)).status;
  }

  async launchUriWithOutcome(
    uri: string,
    isCurrent: VaultActionContextGuard,
  ): Promise<VaultNativeActionOutcome> {
    if (!uri) {
      return failedNativeAction(translateOfficialMessage("i18nNoUri"));
    }

    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      return failedNativeAction(translateOfficialMessage("i18nUnableToOpenUrl"));
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return failedNativeAction(translateOfficialMessage("i18nUnableToOpenUrl"));
    }
    if (!guardAllows(isCurrent)) {
      return staleNativeAction();
    }

    try {
      await this.host.openUrl(uri);
      if (!guardAllows(isCurrent)) {
        return staleNativeAction();
      }
      return committedNativeAction(translateOfficialMessage("i18nOpenedUrl"));
    } catch {
      if (!guardAllows(isCurrent)) {
        return staleNativeAction();
      }
      return failedNativeAction(translateOfficialMessage("i18nUnableToOpenUrl"));
    }
  }

  async launchItem(item: VaultItem): Promise<string> {
    return this.launchUri(item.uri);
  }

  async toggleFavorite(item: VaultItem): Promise<string> {
    return (await this.toggleFavoriteWithOutcome(item)).status;
  }

  async toggleFavoriteWithOutcome(
    item: VaultItem,
    isCurrent: VaultActionContextGuard = () => true,
  ): Promise<VaultFavoriteMutationOutcome> {
    if (!guardAllows(isCurrent)) {
      return notCommitted("stale", "Vault changed; action not applied.");
    }
    if (this.favoriteMutations.has(item.id)) {
      return notCommitted("duplicate", translateOfficialMessage("i18nFavoriteUpdateInProgress"));
    }
    if (this.currentItem(item.id) !== item) {
      return notCommitted("stale", "Vault changed; action not applied.");
    }

    this.favoriteMutations.add(item.id);
    try {
      if (!guardAllows(isCurrent)) {
        return notCommitted("stale", "Vault changed; action not applied.");
      }
      const favorite = !item.favorite;
      const serverOutcome = await this.runServerCipherAction(
        (port, session) =>
          port.updateCipherPartial(session, item.id, {
            favorite,
            ...(item.folderId ? { folderId: item.folderId } : {}),
          }),
        translateOfficialMessage("i18nUnableToUpdateFavorite"),
        isCurrent,
      );
      if (serverOutcome) {
        return serverOutcome;
      }
      if (!guardAllows(isCurrent) || this.currentItem(item.id) !== item) {
        return notCommitted("stale", translateOfficialMessage("i18nVaultChangedActionNotApplied"));
      }

      this.store.updateVaultItem(item.id, (candidate) => ({
        ...candidate,
        favorite,
      }));
      const replacement = this.currentItem(item.id);
      if (!replacement) {
        return notCommitted("stale", translateOfficialMessage("i18nVaultChangedActionNotApplied"));
      }
      return {
        committed: true,
        status: translateOfficialMessage(item.favorite ? "i18nRemovedFromFavorites" : "i18nAddedToFavorites"),
        result: { kind: "replacement", item: replacement },
      };
    } finally {
      this.favoriteMutations.delete(item.id);
    }
  }

  async archiveItem(item: VaultItem): Promise<string> {
    return (await this.archiveItemWithOutcome(item)).status;
  }

  async archiveItemWithOutcome(
    item: VaultItem,
    isCurrent: VaultActionContextGuard = () => true,
  ): Promise<VaultRemovalMutationOutcome> {
    return this.runActiveRemovalMutation(
      item,
      (port, session) => port.archiveCipher(session, item.id),
      translateOfficialMessage("i18nUnableToArchiveItem"),
      () => this.store.archiveVaultItem(item.id),
      translateOfficialMessage("i18nArchivedItem"),
      isCurrent,
    );
  }

  async deleteItem(item: VaultItem): Promise<string> {
    return (await this.deleteItemWithOutcome(item)).status;
  }

  async deleteItemWithOutcome(
    item: VaultItem,
    isCurrent: VaultActionContextGuard = () => true,
  ): Promise<VaultRemovalMutationOutcome> {
    return this.runActiveRemovalMutation(
      item,
      (port, session) => port.softDeleteCipher(session, item.id),
      translateOfficialMessage("i18nUnableToDeleteItem"),
      () => this.store.deleteVaultItem(item.id),
      translateOfficialMessage("i18nMovedItemToTrash"),
      isCurrent,
    );
  }

  async unarchiveItem(item: VaultItem): Promise<string> {
    return (await this.unarchiveItemWithOutcome(item)).status;
  }

  async unarchiveItemWithOutcome(
    item: VaultItem,
    isCurrent: VaultActionContextGuard = () => true,
  ): Promise<VaultRemovalMutationOutcome> {
    return this.runRemovalMutation(
      item,
      "archived",
      (port, session) => port.unarchiveCipher(session, item.id),
      translateOfficialMessage("i18nUnableToUnarchiveItem"),
      () => this.store.restoreArchivedVaultItem(item.id),
      translateOfficialMessage("i18nItemUnarchived"),
      isCurrent,
    );
  }

  async deleteArchivedItem(item: VaultItem): Promise<string> {
    return (await this.deleteArchivedItemWithOutcome(item)).status;
  }

  async deleteArchivedItemWithOutcome(
    item: VaultItem,
    isCurrent: VaultActionContextGuard = () => true,
  ): Promise<VaultRemovalMutationOutcome> {
    return this.runRemovalMutation(
      item,
      "archived",
      (port, session) => port.softDeleteCipher(session, item.id),
      translateOfficialMessage("i18nUnableToDeleteItem"),
      () => this.store.moveArchivedVaultItemToTrash(item.id),
      translateOfficialMessage("i18nMovedItemToTrash"),
      isCurrent,
    );
  }

  async restoreDeletedItem(item: VaultItem): Promise<string> {
    return (await this.restoreDeletedItemWithOutcome(item)).status;
  }

  async restoreDeletedItemWithOutcome(
    item: VaultItem,
    isCurrent: VaultActionContextGuard = () => true,
  ): Promise<VaultRemovalMutationOutcome> {
    const destination = this.store.deletedVaultItemRestoreDestination(item);
    return this.runRemovalMutation(
      item,
      "deleted",
      (port, session) => port.restoreCipher(session, item.id),
      translateOfficialMessage("i18nUnableToRestoreItem"),
      () => this.store.restoreDeletedVaultItem(item.id, destination),
      translateOfficialMessage(destination === "archived" ? "i18nArchivedItemRestored" : "i18nItemRestored"),
      isCurrent,
    );
  }

  async permanentlyDeleteItem(item: VaultItem): Promise<string> {
    return (await this.permanentlyDeleteItemWithOutcome(item)).status;
  }

  async permanentlyDeleteItemWithOutcome(
    item: VaultItem,
    isCurrent: VaultActionContextGuard = () => true,
  ): Promise<VaultRemovalMutationOutcome> {
    return this.runRemovalMutation(
      item,
      "deleted",
      (port, session) => port.deleteCipher(session, item.id),
      translateOfficialMessage("i18nUnableToPermanentlyDeleteItem"),
      () => this.store.permanentlyDeleteVaultItem(item.id),
      translateOfficialMessage("i18nItemPermanentlyDeleted"),
      isCurrent,
    );
  }

  private async runRemovalMutation(
    item: VaultItem,
    location: VaultItemLocation,
    serverAction: (port: VaultCipherActionPort, session: AuthSession) => Promise<void>,
    failureStatus: string,
    applyLocal: () => void,
    successStatus: string,
    isCurrent: VaultActionContextGuard,
  ): Promise<VaultRemovalMutationOutcome> {
    if (this.currentItemAt(location, item.id) !== item) {
      return notCommitted("stale", translateOfficialMessage("i18nVaultChangedActionNotApplied"));
    }
    const session = this.store.snapshot().activeSession;
    if (!session) {
      return notCommitted("failure", translateOfficialMessage("i18nVaultSessionUnavailable"));
    }
    if (!guardAllows(isCurrent)) {
      return notCommitted("stale", translateOfficialMessage("i18nVaultChangedActionNotApplied"));
    }
    if (this.lifecycleMutations.has(item.id)) {
      return notCommitted("duplicate", translateOfficialMessage("i18nItemUpdateInProgress"));
    }

    const token = Symbol(item.id);
    this.lifecycleMutations.set(item.id, token);
    try {
      if (!this.lifecycleMutationIsCurrent(item, location, session, token, isCurrent)) {
        return notCommitted("stale", translateOfficialMessage("i18nVaultChangedActionNotApplied"));
      }
      try {
        await serverAction(this.cipherActionPort(session), session);
      } catch {
        return this.lifecycleMutationIsCurrent(item, location, session, token, isCurrent)
          ? notCommitted("failure", failureStatus)
          : notCommitted("stale", translateOfficialMessage("i18nVaultChangedActionNotApplied"));
      }
      if (!this.lifecycleMutationIsCurrent(item, location, session, token, isCurrent)) {
        return notCommitted("stale", translateOfficialMessage("i18nVaultChangedActionNotApplied"));
      }
      applyLocal();
      return {
        committed: true,
        status: successStatus,
        result: { kind: "removed", item },
      };
    } finally {
      if (this.lifecycleMutations.get(item.id) === token) {
        this.lifecycleMutations.delete(item.id);
      }
    }
  }

  private async runActiveRemovalMutation(
    item: VaultItem,
    serverAction: (port: VaultCipherActionPort, session: AuthSession) => Promise<void>,
    failureStatus: string,
    applyLocal: () => void,
    successStatus: string,
    isCurrent: VaultActionContextGuard,
  ): Promise<VaultRemovalMutationOutcome> {
    return this.runRemovalMutation(
      item,
      "active",
      serverAction,
      failureStatus,
      applyLocal,
      successStatus,
      isCurrent,
    );
  }

  private lifecycleMutationIsCurrent(
    item: VaultItem,
    location: VaultItemLocation,
    session: AuthSession,
    token: symbol,
    isCurrent: VaultActionContextGuard,
  ): boolean {
    return this.lifecycleMutations.get(item.id) === token &&
      this.store.snapshot().activeSession === session &&
      this.currentItemAt(location, item.id) === item &&
      guardAllows(isCurrent);
  }

  private async runServerCipherAction(
    action: (port: VaultCipherActionPort, session: AuthSession) => Promise<void>,
    failureStatus: string,
    isCurrent: VaultActionContextGuard,
  ): Promise<VaultMutationNotCommitted | null> {
    if (!guardAllows(isCurrent)) {
      return notCommitted("stale", translateOfficialMessage("i18nVaultChangedActionNotApplied"));
    }
    const session = this.store.snapshot().activeSession;
    if (!session) {
      return notCommitted("failure", translateOfficialMessage("i18nVaultSessionUnavailable"));
    }

    try {
      await action(this.cipherActionPort(session), session);
      if (!guardAllows(isCurrent) || this.store.snapshot().activeSession !== session) {
        return notCommitted("stale", translateOfficialMessage("i18nVaultChangedActionNotApplied"));
      }
      return null;
    } catch {
      return guardAllows(isCurrent) && this.store.snapshot().activeSession === session
        ? notCommitted("failure", failureStatus)
        : notCommitted("stale", translateOfficialMessage("i18nVaultChangedActionNotApplied"));
    }
  }

  private async resolveActionField(field: VaultField, epochSeconds: number): Promise<VaultField | null> {
    if (field.type !== "totp") {
      return field;
    }

    try {
      const { code } = await this.totpCodeGenerator(field.value, Math.floor(epochSeconds));
      return { ...field, value: code };
    } catch {
      return null;
    }
  }

  private async copyResolvedField(
    field: VaultField,
    isCurrent: VaultActionContextGuard,
    successStatus: string,
    failureStatus: string,
  ): Promise<VaultNativeActionOutcome> {
    if (!guardAllows(isCurrent)) {
      return staleNativeAction();
    }
    try {
      await this.host.copyText(field.value, this.settings.snapshot().clipboardClearSeconds);
      if (!guardAllows(isCurrent)) {
        return staleNativeAction();
      }
      return committedNativeAction(successStatus);
    } catch {
      if (!guardAllows(isCurrent)) {
        return staleNativeAction();
      }
      return failedNativeAction(failureStatus);
    }
  }

  private cipherActionPort(session: AuthSession): VaultCipherActionPort {
    return this.cipherActions ?? new BitwardenVaultCipherActions(session);
  }

  private currentItem(itemId: string): VaultItem | undefined {
    return this.store.snapshot().items.find((candidate) => candidate.id === itemId);
  }

  private currentItemAt(location: VaultItemLocation, itemId: string): VaultItem | undefined {
    const state = this.store.snapshot();
    const items = location === "active"
      ? state.items
      : location === "archived" ? state.archivedItems : state.deletedItems;
    return items.find((candidate) => candidate.id === itemId);
  }
}

function notCommitted(
  reason: VaultMutationNotCommittedReason,
  status: string,
): VaultMutationNotCommitted {
  return { committed: false, reason, status };
}

function committedNativeAction(status: string): VaultNativeActionCommitted {
  return { committed: true, status };
}

function failedNativeAction(status: string): VaultNativeActionNotCommitted {
  return { committed: false, reason: "failure", status };
}

function staleNativeAction(): VaultNativeActionNotCommitted {
  return {
    committed: false,
    reason: "stale",
    status: translateOfficialMessage("i18nVaultChangedActionNotApplied"),
  };
}

function guardAllows(isCurrent: VaultActionContextGuard): boolean {
  try {
    return isCurrent();
  } catch {
    return false;
  }
}

function alwaysCurrent(): boolean {
  return true;
}

type VaultItemLocation = "active" | "archived" | "deleted";

class BitwardenVaultCipherActions implements VaultCipherActionPort {
  private readonly api: BitwardenApiClient;

  constructor(session: AuthSession) {
    this.api = new BitwardenApiClient(session.environment, new TauriHostService());
  }

  updateCipherPartial(
    session: AuthSession,
    itemId: string,
    request: CipherPartialUpdateRequest,
  ): Promise<void> {
    return this.api.putPartialCipher<void>(itemId, session.token.accessToken, request);
  }

  softDeleteCipher(session: AuthSession, itemId: string): Promise<void> {
    return this.api.putDeleteCipher<void>(itemId, session.token.accessToken);
  }

  archiveCipher(session: AuthSession, itemId: string): Promise<void> {
    return this.api.putArchiveCiphers<void>([itemId], session.token.accessToken);
  }

  unarchiveCipher(session: AuthSession, itemId: string): Promise<void> {
    return this.api.putUnarchiveCiphers<void>([itemId], session.token.accessToken);
  }

  restoreCipher(session: AuthSession, itemId: string): Promise<void> {
    return this.api.putRestoreCipher<void>(itemId, session.token.accessToken);
  }

  deleteCipher(session: AuthSession, itemId: string): Promise<void> {
    return this.api.deleteCipher<void>(itemId, session.token.accessToken);
  }
}
