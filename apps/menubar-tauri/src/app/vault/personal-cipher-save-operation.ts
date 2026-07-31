import { CipherType } from "@bitwarden/common/vault/enums";

import type { AuthSession } from "../../auth/auth-session-store";
import {
  PopupStateStore,
  type EditableVaultItemLocation,
  type PopupState,
} from "../popup-state";
import type { VaultItem } from "./vault-item.model";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import {
  retainedPersonalSubmitToDraft,
  type RetainedPersonalCipherFormSubmit,
} from "./retained-personal-cipher-form.adapter";
import {
  runPersonalCipherWrite,
  type CardCipherDraft,
  type IdentityCipherDraft,
  type SecureNoteCipherDraft,
  type VaultCipherWritePort,
} from "./vault-cipher-write.service";
import { VaultFacade, type VaultItemLocation } from "./vault.facade";

export type PersonalCipherType = "card" | "identity" | "secure-note";
export type PersonalCipherMode = RetainedPersonalCipherFormSubmit["mode"];

export interface PersonalCipherOperationOwnership {
  readonly token: symbol;
  readonly operationEpoch: number;
  readonly protectedOperationEpoch: number;
  readonly routeUrl: string;
  readonly session: AuthSession;
  readonly accountEmail: string;
  readonly serverUrl: string;
  readonly selectedItem: VaultItem | undefined;
  readonly selectedLocation: VaultItemLocation | undefined;
  readonly items: PopupState["items"];
  readonly archivedItems: PopupState["archivedItems"];
  readonly deletedItems: PopupState["deletedItems"];
  readonly folders: PopupState["folders"];
  readonly organizations: PopupState["organizations"];
  readonly collections: PopupState["collections"];
  readonly mode: PersonalCipherMode;
  readonly cipherType: PersonalCipherType;
}

export type PersonalCipherSaveResult =
  | { readonly committed: true; readonly item: VaultItem }
  | {
      readonly committed: false;
      readonly reason: "duplicate" | "stale" | "failure";
    };

export interface PersonalCipherOperationContext {
  readonly mode: PersonalCipherMode;
  readonly cipherType: PersonalCipherType | "login";
  readonly selectedItem: VaultItem | undefined;
}

export interface PersonalCipherOperationNavigation {
  currentUrl(): string;
  navigateByUrl(url: string): Promise<boolean>;
}

export interface PersonalCipherSaveOperationDependencies {
  readonly store: PopupStateStore;
  readonly vault: VaultFacade;
  readonly navigation: PersonalCipherOperationNavigation;
  readonly context: () => PersonalCipherOperationContext;
  readonly writePort: (session: AuthSession) => VaultCipherWritePort;
}

export class PersonalCipherSaveOperation {
  private operationEpoch = 0;
  private operationToken: symbol | null = null;
  private committedTerminal = false;

  constructor(private readonly dependencies: PersonalCipherSaveOperationDependencies) {}

  get submitDisabled(): boolean {
    return this.committedTerminal || this.operationToken !== null;
  }

  invalidate(): void {
    this.operationEpoch += 1;
    this.operationToken = null;
  }

  async submit(
    submit: RetainedPersonalCipherFormSubmit,
  ): Promise<PersonalCipherSaveResult> {
    if (this.committedTerminal) {
      return staleResult;
    }
    if (this.operationToken !== null) {
      return { committed: false, reason: "duplicate" };
    }

    let draft: ReturnType<typeof retainedPersonalSubmitToDraft>;
    try {
      draft = retainedPersonalSubmitToDraft(submit);
    } catch {
      return this.failure();
    }

    const captured = this.captureOwnership(submit);
    if ("reason" in captured) {
      return captured.reason === "failure" ? this.failure() : captured;
    }
    const ownership = captured.ownership;
    this.operationToken = ownership.token;

    const pretransport = this.pretransportResult(ownership, submit);
    if (pretransport) {
      this.clearPending(ownership.token);
      if (pretransport.reason === "failure") {
        this.dependencies.store.setStatus(translateOfficialMessage("i18nSaveItemFailed"));
      }
      return pretransport;
    }

    const result = await runPersonalCipherWrite(
      () => this.write(ownership, draft),
      () => this.isCurrent(ownership),
    );
    if (!result.committed) {
      if (this.operationToken === ownership.token) {
        this.clearPending(ownership.token);
        if (result.reason === "failure") {
          this.dependencies.store.setStatus(translateOfficialMessage("i18nSaveItemFailed"));
        }
      }
      return result;
    }

    if (!this.isCurrent(ownership)) {
      this.clearPending(ownership.token);
      return staleResult;
    }
    const validated = validateReturnedPersonalItem(result.item, ownership.cipherType);
    if (!validated) {
      this.clearPending(ownership.token);
      return this.failure();
    }

    const precommitState = this.dependencies.store.snapshot();
    let committed = false;
    try {
      committed = ownership.mode === "edit"
        ? this.dependencies.store.replaceVaultItemExact(
            ownership.selectedItem!,
            ownership.selectedLocation as EditableVaultItemLocation,
            validated.item,
          )
        : this.dependencies.store.addActiveVaultItem(validated.item);
    } catch {
      this.restoreAfterFailedCommit(precommitState);
      this.clearPending(ownership.token);
      return this.failure();
    }
    if (!committed) {
      this.clearPending(ownership.token);
      return staleResult;
    }

    this.committedTerminal = true;
    this.dependencies.store.setStatus(translateOfficialMessage("editedItem"));
    const committedState = this.dependencies.store.snapshot();
    if (this.isCurrentAfterCommit(ownership, validated.item, committedState)) {
      let navigated = false;
      try {
        navigated = await this.dependencies.navigation.navigateByUrl(
          `/view-cipher/${encodeURIComponent(validated.id)}`,
        );
      } catch {
        navigated = false;
      }
      if (
        !navigated &&
        this.isCurrentAfterCommit(ownership, validated.item, committedState)
      ) {
        this.dependencies.store.setStatus(translateOfficialMessage("i18nItemSavedOpenFailed"));
      }
    }
    this.clearPending(ownership.token);
    return result;
  }

  private captureOwnership(
    submit: RetainedPersonalCipherFormSubmit,
  ):
    | { readonly ownership: PersonalCipherOperationOwnership }
    | Extract<PersonalCipherSaveResult, { committed: false }> {
    const context = this.dependencies.context();
    const state = this.dependencies.store.snapshot();
    const session = state.activeSession;
    const submittedType = personalTypeFromCipherType(submit.cipherType);
    if (
      !submittedType ||
      submit.mode !== context.mode ||
      submittedType !== context.cipherType ||
      !state.isUnlocked ||
      !session?.crypto?.userKeyB64 ||
      !hasPersonalOwnership(submit.value.organizationId, submit.value.collectionIds)
    ) {
      return { committed: false, reason: "failure" };
    }

    const selectedItem = context.selectedItem;
    const selectedLocation = selectedItem
      ? this.dependencies.vault.itemLocation(selectedItem.id)
      : undefined;
    const selectedSourceResult = validateSelectedSource(
      context,
      selectedItem,
      selectedLocation,
      this.dependencies.vault,
    );
    if (selectedSourceResult) {
      return selectedSourceResult;
    }

    const token = Symbol("personal-cipher-save");
    return {
      ownership: {
        token,
        operationEpoch: ++this.operationEpoch,
        protectedOperationEpoch: this.dependencies.store.beginProtectedOperation(),
        routeUrl: this.dependencies.navigation.currentUrl(),
        session,
        accountEmail: state.email,
        serverUrl: state.serverUrl,
        selectedItem,
        selectedLocation,
        items: state.items,
        archivedItems: state.archivedItems,
        deletedItems: state.deletedItems,
        folders: state.folders,
        organizations: state.organizations,
        collections: state.collections,
        mode: context.mode,
        cipherType: context.cipherType,
      },
    };
  }

  private pretransportResult(
    ownership: PersonalCipherOperationOwnership,
    submit: RetainedPersonalCipherFormSubmit,
  ): Extract<PersonalCipherSaveResult, { committed: false }> | null {
    if (!this.isCurrent(ownership)) {
      return staleResult;
    }
    if (
      !hasPersonalOwnership(submit.value.organizationId, submit.value.collectionIds) ||
      !validPersonalSource(ownership.selectedItem, ownership.mode, ownership.cipherType)
    ) {
      return { committed: false, reason: "failure" };
    }
    return null;
  }

  private isCurrent(ownership: PersonalCipherOperationOwnership): boolean {
    const { store, vault, navigation } = this.dependencies;
    const state = store.snapshot();
    const context = this.dependencies.context();
    return (
      this.operationToken === ownership.token &&
      this.operationEpoch === ownership.operationEpoch &&
      store.isCurrentProtectedOperation(ownership.protectedOperationEpoch) &&
      navigation.currentUrl() === ownership.routeUrl &&
      context.mode === ownership.mode &&
      context.cipherType === ownership.cipherType &&
      context.selectedItem === ownership.selectedItem &&
      state.isUnlocked &&
      state.activeSession === ownership.session &&
      state.email === ownership.accountEmail &&
      state.serverUrl === ownership.serverUrl &&
      state.items === ownership.items &&
      state.archivedItems === ownership.archivedItems &&
      state.deletedItems === ownership.deletedItems &&
      state.folders === ownership.folders &&
      state.organizations === ownership.organizations &&
      state.collections === ownership.collections &&
      (!ownership.selectedItem ||
        (vault.itemLocation(ownership.selectedItem.id) === ownership.selectedLocation &&
          vault.itemById(ownership.selectedItem.id) === ownership.selectedItem))
    );
  }

  private isCurrentAfterCommit(
    ownership: PersonalCipherOperationOwnership,
    item: VaultItem,
    committedState: PopupState,
  ): boolean {
    try {
      const { store, navigation } = this.dependencies;
      const state = store.snapshot();
      const context = this.dependencies.context();
      const expectedItems = ownership.mode === "edit" && ownership.selectedLocation === "archived"
        ? state.archivedItems
        : state.items;
      return (
        this.operationToken === ownership.token &&
        this.operationEpoch === ownership.operationEpoch &&
        store.isCurrentProtectedOperation(ownership.protectedOperationEpoch) &&
        navigation.currentUrl() === ownership.routeUrl &&
        context.mode === ownership.mode &&
        context.cipherType === ownership.cipherType &&
        context.selectedItem === ownership.selectedItem &&
        state.isUnlocked &&
        state.activeSession === ownership.session &&
        state.email === ownership.accountEmail &&
        state.serverUrl === ownership.serverUrl &&
        state.items === committedState.items &&
        state.archivedItems === committedState.archivedItems &&
        state.deletedItems === committedState.deletedItems &&
        state.folders === committedState.folders &&
        state.organizations === committedState.organizations &&
        state.collections === committedState.collections &&
        expectedItems.includes(item)
      );
    } catch {
      return false;
    }
  }

  private restoreAfterFailedCommit(state: PopupState): void {
    try {
      if (this.dependencies.store.snapshot() !== state) {
        this.dependencies.store.restore(state);
      }
    } catch {
      // The typed failure below remains the only operation result and feedback.
    }
  }

  private write(
    ownership: PersonalCipherOperationOwnership,
    draft: ReturnType<typeof retainedPersonalSubmitToDraft>,
  ): Promise<VaultItem> {
    const port = this.dependencies.writePort(ownership.session);
    const update = ownership.mode === "edit";
    if (ownership.cipherType === "card") {
      const cardDraft = draft as CardCipherDraft;
      return update
        ? port.updateCardCipher(ownership.session, ownership.selectedItem!, cardDraft)
        : port.createCardCipher(ownership.session, cardDraft);
    }
    if (ownership.cipherType === "identity") {
      const identityDraft = draft as IdentityCipherDraft;
      return update
        ? port.updateIdentityCipher(ownership.session, ownership.selectedItem!, identityDraft)
        : port.createIdentityCipher(ownership.session, identityDraft);
    }
    const secureNoteDraft = draft as SecureNoteCipherDraft;
    return update
      ? port.updateSecureNoteCipher(ownership.session, ownership.selectedItem!, secureNoteDraft)
      : port.createSecureNoteCipher(ownership.session, secureNoteDraft);
  }

  private clearPending(token: symbol): void {
    if (this.operationToken === token) {
      this.operationToken = null;
    }
  }

  private failure(): Extract<PersonalCipherSaveResult, { committed: false }> {
    this.dependencies.store.setStatus(translateOfficialMessage("i18nSaveItemFailed"));
    return { committed: false, reason: "failure" };
  }
}

const staleResult = { committed: false, reason: "stale" } as const;

function validateSelectedSource(
  context: PersonalCipherOperationContext,
  selectedItem: VaultItem | undefined,
  selectedLocation: VaultItemLocation | undefined,
  vault: VaultFacade,
): Extract<PersonalCipherSaveResult, { committed: false }> | null {
  if (context.mode === "add") {
    return selectedItem === undefined ? null : staleResult;
  }
  if (!validPersonalSource(selectedItem, context.mode, context.cipherType)) {
    return { committed: false, reason: "failure" };
  }
  if (selectedLocation === "deleted") {
    return { committed: false, reason: "failure" };
  }
  if (
    (selectedLocation !== "active" && selectedLocation !== "archived") ||
    vault.itemById(selectedItem!.id) !== selectedItem
  ) {
    return staleResult;
  }
  return null;
}

function validPersonalSource(
  selectedItem: VaultItem | undefined,
  mode: PersonalCipherMode,
  cipherType: PersonalCipherType,
): boolean {
  if (mode === "add") {
    return selectedItem === undefined;
  }
  return Boolean(
    selectedItem &&
    selectedItem.type === cipherType &&
    hasPersonalOwnership(selectedItem.organizationId, selectedItem.collectionIds) &&
    !(mode === "edit" && selectedItem.requiresVaultSyncBeforeEdit),
  );
}

function hasPersonalOwnership(organizationId: unknown, collectionIds: unknown): boolean {
  return organizationId == null && (
    collectionIds == null || (Array.isArray(collectionIds) && collectionIds.length === 0)
  );
}

interface ValidatedPersonalItem {
  readonly item: VaultItem;
  readonly id: string;
}

function validateReturnedPersonalItem(
  item: unknown,
  type: PersonalCipherType,
): ValidatedPersonalItem | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return null;
  }
  try {
    if (Object.getPrototypeOf(item) !== Object.prototype) {
      return null;
    }
    const values = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(item)) {
      if (typeof key !== "string") {
        return null;
      }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        return null;
      }
      const firstObservedValue = Reflect.get(item, key);
      const secondObservedValue = Reflect.get(item, key);
      if (
        !Object.is(firstObservedValue, descriptor.value) ||
        !Object.is(secondObservedValue, descriptor.value)
      ) {
        return null;
      }
      values.set(key, descriptor.value);
    }

    const id = values.get("id");
    if (
      values.get("type") !== type ||
      typeof id !== "string" ||
      id.trim().length === 0 ||
      !hasValidCommonVaultItemFields(values) ||
      !hasPersonalOwnership(values.get("organizationId"), values.get("collectionIds")) ||
      !hasTypeSpecificData(values, type)
    ) {
      return null;
    }
    return { item: item as VaultItem, id };
  } catch {
    return null;
  }
}

function hasValidCommonVaultItemFields(values: ReadonlyMap<string, unknown>): boolean {
  return (
    typeof values.get("name") === "string" &&
    typeof values.get("subtitle") === "string" &&
    typeof values.get("favorite") === "boolean" &&
    typeof values.get("folderId") === "string" &&
    typeof values.get("folderName") === "string" &&
    typeof values.get("organizationName") === "string" &&
    typeof values.get("attachmentCount") === "number" &&
    Number.isFinite(values.get("attachmentCount")) &&
    Array.isArray(values.get("uris")) &&
    Array.isArray(values.get("fields")) &&
    typeof values.get("createdDate") === "string" &&
    typeof values.get("revisionDate") === "string" &&
    typeof values.get("notes") === "string" &&
    typeof values.get("canLaunch") === "boolean" &&
    typeof values.get("canFill") === "boolean" &&
    typeof values.get("uri") === "string"
  );
}

function hasTypeSpecificData(
  values: ReadonlyMap<string, unknown>,
  type: PersonalCipherType,
): boolean {
  const data = values.get(
    type === "card" ? "card" : type === "identity" ? "identity" : "secureNote",
  );
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

function personalTypeFromCipherType(cipherType: CipherType): PersonalCipherType | null {
  if (cipherType === CipherType.Card) return "card";
  if (cipherType === CipherType.Identity) return "identity";
  if (cipherType === CipherType.SecureNote) return "secure-note";
  return null;
}
