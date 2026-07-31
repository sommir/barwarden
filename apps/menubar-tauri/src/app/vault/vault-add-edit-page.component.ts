import {
  ChangeDetectorRef,
  Component,
  Inject,
  OnDestroy,
  Optional,
  ViewChild,
} from "@angular/core";
import { ActivatedRoute, Router, type ParamMap } from "@angular/router";
import { map } from "rxjs";

import { CipherType } from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { DirtyFormService } from "@bitwarden/components/async-actions/dirty-form.service";
import { DialogService } from "@bitwarden/components/dialog/dialog.service";

import type { AuthSession } from "../../auth/auth-session-store";
import { TauriHostService } from "../../host/tauri-host.service";
import { PopupFooterComponent } from "../layout/popup-footer.component";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import {
  BitIconButtonComponent,
  ButtonComponent,
} from "../official-ui/official-components";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";
import { PopupStateStore, type PopupState } from "../popup-state";
import { POP_OUT_HOST, type PopOutHost } from "../popup-header-actions.component";
import { OfficialLoginCipherFormComponent } from "../upstream-overlays/cipher-form/official-login-cipher-form.component";
import { OfficialPersonalCipherFormComponent } from "../upstream-overlays/cipher-form/official-personal-cipher-form.component";
import type { VaultItem, VaultItemType } from "../vault-demo";
import { projectLoginDetail } from "./login-cipher-view.adapter";
import {
  PersonalCipherSaveOperation,
  type PersonalCipherSaveResult,
  type PersonalCipherType,
} from "./personal-cipher-save-operation";
import { projectPersonalCipherDetail } from "./personal-cipher-view.adapter";
import {
  buildOfficialLoginFormConfig,
  createRetainedLoginFormSubmit,
  retainedLoginSubmitToDraft,
  type RetainedLoginFormMode,
  type RetainedLoginFormSubmit,
  type RetainedOfficialCipherFormConfig,
} from "./retained-login-form.adapter";
import {
  buildOfficialPersonalCipherFormConfig,
  type RetainedOfficialPersonalCipherFormConfig,
  type RetainedPersonalCipherFormSubmit,
} from "./retained-personal-cipher-form.adapter";
import {
  BitwardenVaultCipherWriteActions,
  runLoginCipherWrite,
  VAULT_CIPHER_WRITE_PORT,
  type LoginCipherSaveOperationResult,
  type VaultCipherWritePort,
} from "./vault-cipher-write.service";
import { VaultFacade, type VaultItemLocation } from "./vault.facade";
import { VaultSessionService } from "./vault-session.service";
import { hasRequiredLoginName } from "./vault-login-draft";

interface CipherTypeView {
  readonly type: "login" | PersonalCipherType;
  readonly labelKey: string;
}

const CIPHER_TYPES: Record<string, CipherTypeView> = {
  "1": { type: "login", labelKey: "typeLogin" },
  "2": { type: "secure-note", labelKey: "typeNote" },
  "3": { type: "card", labelKey: "typeCard" },
  "4": { type: "identity", labelKey: "typeIdentity" },
};

const ITEM_TYPE_TO_QUERY_TYPE: Partial<Record<VaultItemType, string>> = {
  login: "1",
  "secure-note": "2",
  card: "3",
  identity: "4",
};

interface LoginSaveOwnership {
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
  readonly mode: RetainedLoginFormMode;
}

@Component({
  selector: "bw-vault-add-edit-page",
  host: { class: "macos-page macos-page--secondary macos-page--vault-form" },
  standalone: true,
  imports: [
    BitIconButtonComponent,
    ButtonComponent,
    I18nPipe,
    OfficialLoginCipherFormComponent,
    OfficialPersonalCipherFormComponent,
    PopupFooterComponent,
    PopupHeaderComponent,
    PopupPageComponent,
  ],
  template: `
    <popup-page class="macos-page macos-page--vault-form">
      <popup-header slot="header" [pageTitle]="pageTitle" showBackButton [backAction]="backAction">
        <button slot="end" bitIconButton="bwi-popout" type="button" [label]="'i18nPopOut' | i18n" (click)="popOut()"></button>
      </popup-header>

      <div class="cipher-form-scroll macos-list">
        @if (cipherType.type === 'login') {
          <bw-official-login-cipher-form
            formId="official-login-cipher-form"
            [config]="officialLoginConfig"
            [beforeSubmit]="onOfficialLoginBeforeSubmit"
          ></bw-official-login-cipher-form>
        } @else {
          <bw-official-personal-cipher-form
            formId="official-personal-cipher-form"
            [config]="officialPersonalConfig"
            [beforeSubmit]="onOfficialPersonalBeforeSubmit"
          ></bw-official-personal-cipher-form>
        }
      </div>

      <popup-footer slot="footer">
        @if (cipherType.type === 'login') {
          <button bitButton buttonType="primary" type="submit" form="official-login-cipher-form" [disabled]="!canSubmitOfficialLogin">{{ "save" | i18n }}</button>
        } @else {
          <button bitButton buttonType="primary" type="submit" form="official-personal-cipher-form" [disabled]="!canSubmitOfficialPersonal">{{ "save" | i18n }}</button>
        }
        <button bitButton buttonType="secondary" type="button" (click)="cancel($event)">{{ "cancel" | i18n }}</button>
      </popup-footer>
    </popup-page>
  `,
})
export class VaultAddEditPageComponent implements OnDestroy {
  @ViewChild(OfficialLoginCipherFormComponent)
  private officialLoginForm: OfficialLoginCipherFormComponent | undefined;
  @ViewChild(OfficialPersonalCipherFormComponent)
  private officialPersonalForm: OfficialPersonalCipherFormComponent | undefined;

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.backToVault();
  folderId = "";
  cipherType: CipherTypeView = CIPHER_TYPES["1"];
  selectedItem: VaultItem | undefined;
  officialLoginConfig!: RetainedOfficialCipherFormConfig;
  officialPersonalConfig!: RetainedOfficialPersonalCipherFormConfig;
  private saveEpoch = 0;
  private loginOperationToken: symbol | null = null;
  private loginCommitTerminal = false;
  private readonly routePath: string;
  private deferredRouteRedirected = false;
  private destroyed = false;
  private syncRequiredEditId: string | null = null;
  private readonly popOutHost: PopOutHost;
  private readonly personalOperation: PersonalCipherSaveOperation;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly vault: VaultFacade,
    private readonly store: PopupStateStore,
    private readonly dialogService: DialogService,
    private readonly dirtyFormService: DirtyFormService,
    private readonly vaultSession: VaultSessionService,
    private readonly changeDetectorRef: ChangeDetectorRef,
    @Optional()
    @Inject(VAULT_CIPHER_WRITE_PORT)
    private readonly cipherWrite: VaultCipherWritePort | null = null,
    @Optional() @Inject(POP_OUT_HOST) popOutHost: PopOutHost | null = null,
  ) {
    this.popOutHost = popOutHost ?? new TauriHostService();
    this.routePath = this.route.snapshot?.routeConfig?.path ?? "add-cipher";
    this.personalOperation = new PersonalCipherSaveOperation({
      store: this.store,
      vault: this.vault,
      navigation: {
        currentUrl: () => this.router.url,
        navigateByUrl: (url) => this.router.navigateByUrl(url),
      },
      context: () => ({
        mode: this.personalFormMode(),
        cipherType: this.cipherType.type,
        selectedItem: this.selectedItem,
      }),
      writePort: (session) => this.cipherWritePort(session),
    });
    this.applyRouteParams(this.route.snapshot.queryParamMap);
    this.route.queryParamMap
      .pipe(map((params) => this.routeState(params)))
      .subscribe(({ cipherType, selectedItem, folderId }) =>
        this.setRouteState(cipherType, selectedItem, folderId),
      );
  }

  get pageTitle(): string {
    const actionKey = this.routePath === "edit-cipher"
      ? "i18nEditItemType"
      : this.routePath === "clone-cipher"
        ? "i18nCloneItemType"
        : "i18nAddItemType";
    return translateOfficialMessage(
      actionKey,
      translateOfficialMessage(this.cipherType.labelKey),
    );
  }

  get canSubmitOfficialLogin(): boolean {
    const state = this.store.snapshot();
    return (
      this.cipherType.type === "login" &&
      !this.loginCommitTerminal &&
      this.loginOperationToken === null &&
      state.isUnlocked &&
      Boolean(state.activeSession?.crypto?.userKeyB64) &&
      !(this.routePath === "edit-cipher" && this.selectedItem?.requiresVaultSyncBeforeEdit)
    );
  }

  get canSubmitOfficialPersonal(): boolean {
    const state = this.store.snapshot();
    return (
      this.cipherType.type !== "login" &&
      !this.personalOperation.submitDisabled &&
      state.isUnlocked &&
      Boolean(state.activeSession?.crypto?.userKeyB64) &&
      !(this.routePath === "edit-cipher" && this.selectedItem?.requiresVaultSyncBeforeEdit)
    );
  }

  async popOut(): Promise<void> {
    await this.popOutHost.popOut(this.router.url);
  }

  async backToVault(): Promise<void> {
    const focusTarget = document.activeElement;
    this.invalidateOperations();
    if (!(await this.confirmDiscardChanges(focusTarget))) {
      return;
    }
    await this.router.navigateByUrl("/tabs/vault");
  }

  async cancel(trigger: Event | HTMLElement): Promise<void> {
    const focusTarget = trigger instanceof HTMLElement
      ? trigger
      : trigger.currentTarget instanceof HTMLElement
        ? trigger.currentTarget
        : document.activeElement;
    this.invalidateOperations();
    if (!(await this.confirmDiscardChanges(focusTarget))) {
      return;
    }
    await this.router.navigateByUrl("/tabs/vault");
  }

  readonly onOfficialLoginBeforeSubmit = async (value: CipherView): Promise<boolean> => {
    try {
      await this.saveOfficialLogin(createRetainedLoginFormSubmit(this.loginFormMode(), value));
    } catch {
      this.store.setStatus(translateOfficialMessage("i18nSaveItemFailed"));
    }
    return false;
  };

  readonly onOfficialPersonalBeforeSubmit = async (value: CipherView): Promise<boolean> => {
    try {
      await this.saveOfficialPersonal({
        mode: this.personalFormMode(),
        cipherType: value.type as RetainedPersonalCipherFormSubmit["cipherType"],
        value,
      });
    } catch {
      this.store.setStatus(translateOfficialMessage("i18nSaveItemFailed"));
    }
    return false;
  };

  saveOfficialPersonal(
    submit: RetainedPersonalCipherFormSubmit,
  ): Promise<PersonalCipherSaveResult> {
    return this.personalOperation.submit(submit);
  }

  async saveOfficialLogin(
    submit: RetainedLoginFormSubmit,
  ): Promise<LoginCipherSaveOperationResult> {
    if (this.loginCommitTerminal) {
      return { committed: false, reason: "stale" };
    }
    if (this.loginOperationToken !== null) {
      return { committed: false, reason: "duplicate" };
    }
    if (submit.mode !== this.loginFormMode() || this.cipherType.type !== "login") {
      return { committed: false, reason: "stale" };
    }

    const draft = retainedLoginSubmitToDraft(submit);
    const state = this.store.snapshot();
    const session = state.activeSession;
    const selectedLocation = this.selectedItem
      ? this.vault.itemLocation(this.selectedItem.id)
      : undefined;
    if (
      !hasRequiredLoginName(draft.name) ||
      !state.isUnlocked ||
      !session?.crypto?.userKeyB64 ||
      (submit.mode === "edit" &&
        (!this.selectedItem || this.selectedItem.requiresVaultSyncBeforeEdit))
    ) {
      this.store.setStatus(translateOfficialMessage("i18nSaveItemFailed"));
      return { committed: false, reason: "failure" };
    }
    if (submit.mode === "edit" && selectedLocation === "deleted") {
      this.store.setStatus(translateOfficialMessage("i18nSaveItemFailed"));
      return { committed: false, reason: "failure" };
    }
    if (
      submit.mode === "edit" &&
      (this.vault.itemById(this.selectedItem!.id) !== this.selectedItem ||
        (selectedLocation !== "active" && selectedLocation !== "archived"))
    ) {
      return { committed: false, reason: "stale" };
    }

    const token = Symbol("login-save");
    const ownership: LoginSaveOwnership = {
      token,
      operationEpoch: ++this.saveEpoch,
      protectedOperationEpoch: this.store.beginProtectedOperation(),
      routeUrl: this.router.url,
      session,
      accountEmail: state.email,
      serverUrl: state.serverUrl,
      selectedItem: this.selectedItem,
      selectedLocation,
      items: state.items,
      archivedItems: state.archivedItems,
      deletedItems: state.deletedItems,
      folders: state.folders,
      organizations: state.organizations,
      collections: state.collections,
      mode: submit.mode,
    };
    this.loginOperationToken = token;
    this.officialLoginForm?.disableFormFields();

    const result = await runLoginCipherWrite(
      () => submit.mode === "edit"
        ? this.cipherWritePort(session).updateLoginCipher(
            session,
            ownership.selectedItem!,
            draft,
          )
        : this.cipherWritePort(session).createLoginCipher(session, draft),
      () => this.isCurrentLoginSave(ownership),
    );

    if (!result.committed) {
      if (this.loginOperationToken === token) {
        this.loginOperationToken = null;
        this.officialLoginForm?.enableFormFields();
        if (result.reason === "failure") {
          this.store.setStatus(translateOfficialMessage("i18nSaveItemFailed"));
        }
      }
      return result;
    }

    if (!this.isCurrentLoginSave(ownership)) {
      this.loginOperationToken = null;
      this.officialLoginForm?.enableFormFields();
      return { committed: false, reason: "stale" };
    }

    if (submit.mode === "edit" && ownership.selectedItem) {
      if (!this.store.replaceVaultItem(ownership.selectedItem.id, result.item)) {
        this.loginOperationToken = null;
        this.officialLoginForm?.enableFormFields();
        return { committed: false, reason: "stale" };
      }
    } else {
      this.store.saveVaultItem(result.item);
    }
    this.loginCommitTerminal = true;
    const committedState = this.store.snapshot();
    this.store.setStatus(translateOfficialMessage("editedItem"));

    if (!this.isCurrentLoginNavigation(ownership, result.item, committedState)) {
      this.loginOperationToken = null;
      return { committed: false, reason: "stale" };
    }

    let navigated = false;
    try {
      navigated = await this.router.navigateByUrl(
        `/view-cipher/${encodeURIComponent(result.item.id)}`,
      );
    } catch {
      navigated = false;
    }
    this.loginOperationToken = null;
    if (!navigated) {
      this.store.setStatus(translateOfficialMessage("i18nItemSavedOpenFailed"));
    }
    return result;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.invalidateOperations();
  }

  private applyRouteParams(params: ParamMap | null | undefined): void {
    if (!params) return;
    const { cipherType, selectedItem, folderId } = this.routeState(params);
    this.setRouteState(cipherType, selectedItem, folderId);
  }

  private routeState(params: ParamMap): {
    readonly cipherType: CipherTypeView;
    readonly selectedItem: VaultItem | undefined;
    readonly folderId: string;
  } {
    const selectsItem = this.routePath === "edit-cipher" || this.routePath === "clone-cipher";
    const cipherId = params.get("cipherId") ?? "";
    const requestedItem = selectsItem && cipherId ? this.vault.itemById(cipherId) : undefined;
    const selectedItem = requestedItem?.type === "ssh-key" ? undefined : requestedItem;
    if (
      selectsItem &&
      (!selectedItem || selectedItem.type === "ssh-key") &&
      !this.deferredRouteRedirected
    ) {
      this.deferredRouteRedirected = true;
      void this.router.navigateByUrl("/tabs/vault");
    }
    const queryType = selectedItem
      ? ITEM_TYPE_TO_QUERY_TYPE[selectedItem.type] ?? "1"
      : params.get("type") ?? "1";
    return {
      cipherType: CIPHER_TYPES[queryType] ?? CIPHER_TYPES["1"],
      selectedItem,
      folderId: selectedItem?.folderId ?? params.get("folderId") ?? "",
    };
  }

  private setRouteState(
    cipherType: CipherTypeView,
    selectedItem: VaultItem | undefined,
    folderId: string,
  ): void {
    this.invalidateOperations();
    this.cipherType = cipherType;
    this.selectedItem = selectedItem;
    this.folderId = folderId;
    if (cipherType.type === "login") {
      this.officialLoginConfig = this.buildOfficialLoginConfig(selectedItem, folderId);
    } else {
      this.officialPersonalConfig = this.buildOfficialPersonalConfig(
        cipherType.type,
        selectedItem,
        folderId,
      );
    }
    this.refreshSyncRequiredEdit(selectedItem);
  }

  private refreshSyncRequiredEdit(selectedItem: VaultItem | undefined): void {
    if (
      this.routePath !== "edit-cipher" ||
      !selectedItem?.requiresVaultSyncBeforeEdit ||
      this.syncRequiredEditId === selectedItem.id
    ) {
      return;
    }

    this.syncRequiredEditId = selectedItem.id;
    const routeUrl = this.router.url;
    const state = this.store.snapshot();
    const isCurrent = () => {
      const current = this.store.snapshot();
      return (
        !this.destroyed &&
        this.router.url === routeUrl &&
        current.isUnlocked &&
        current.email === state.email &&
        current.serverUrl === state.serverUrl
      );
    };

    void this.vaultSession.syncNow(isCurrent).then(() => {
      if (!isCurrent()) {
        return;
      }
      const refreshed = this.vault.itemById(selectedItem.id);
      if (
        !refreshed ||
        refreshed.type !== selectedItem.type ||
        refreshed.requiresVaultSyncBeforeEdit
      ) {
        this.store.setStatus(translateOfficialMessage("i18nSyncBeforeEdit"));
        return;
      }
      this.setRouteState(this.cipherType, refreshed, refreshed.folderId);
    }).finally(() => {
      if (!this.destroyed) {
        this.changeDetectorRef.detectChanges();
      }
    });
  }

  private loginFormMode(): RetainedLoginFormMode {
    if (this.routePath === "edit-cipher") return "edit";
    return this.routePath === "clone-cipher" ? "clone" : "add";
  }

  private personalFormMode(): RetainedPersonalCipherFormSubmit["mode"] {
    return this.loginFormMode();
  }

  private buildOfficialLoginConfig(
    selectedItem: VaultItem | undefined,
    folderId: string,
  ): RetainedOfficialCipherFormConfig {
    const initial = selectedItem?.type === "login"
      ? projectLoginDetail(selectedItem).cipher
      : CipherView.fromJSON({
          type: CipherType.Login,
          name: "",
          folderId: folderId || undefined,
          fields: [],
          login: { uris: [], fido2Credentials: [] },
        });
    if (!initial) throw new TypeError("Unable to initialize official Login form");
    const state = this.store.snapshot();
    return buildOfficialLoginFormConfig({
      mode: this.loginFormMode(),
      initial,
      folders: this.officialFolders(state),
      canViewSecrets: state.isUnlocked && Boolean(state.activeSession?.crypto?.userKeyB64),
    });
  }

  private buildOfficialPersonalConfig(
    type: PersonalCipherType,
    selectedItem: VaultItem | undefined,
    folderId: string,
  ): RetainedOfficialPersonalCipherFormConfig {
    const cipherType = officialPersonalType(type);
    const initial = selectedItem
      ? projectPersonalCipherDetail(selectedItem).cipher
      : CipherView.fromJSON({
          type: cipherType,
          name: "",
          folderId: folderId || undefined,
          organizationId: null,
          collectionIds: [],
          fields: [],
          card: {},
          identity: {},
          secureNote: { type: 0 },
        });
    if (!initial) throw new TypeError("Unable to initialize official personal form");
    const state = this.store.snapshot();
    return buildOfficialPersonalCipherFormConfig({
      mode: this.personalFormMode(),
      cipherType,
      initial,
      folders: this.officialFolders(state),
      canViewSecrets: state.isUnlocked && Boolean(state.activeSession?.crypto?.userKeyB64),
    });
  }

  private officialFolders(state: PopupState): FolderView[] {
    return [
      FolderView.fromJSON({ id: null, name: translateOfficialMessage("i18nNoFolder") }),
      ...state.folders.map((folder) => FolderView.fromJSON(folder)),
    ];
  }

  private isCurrentLoginSave(ownership: LoginSaveOwnership): boolean {
    const state = this.store.snapshot();
    return (
      this.loginOperationToken === ownership.token &&
      this.saveEpoch === ownership.operationEpoch &&
      this.store.isCurrentProtectedOperation(ownership.protectedOperationEpoch) &&
      this.router.url === ownership.routeUrl &&
      this.cipherType.type === "login" &&
      this.loginFormMode() === ownership.mode &&
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
      this.selectedItem === ownership.selectedItem &&
      this.vault.itemLocation(ownership.selectedItem?.id ?? "") === ownership.selectedLocation &&
      (!ownership.selectedItem ||
        this.vault.itemById(ownership.selectedItem.id) === ownership.selectedItem)
    );
  }

  private isCurrentLoginNavigation(
    ownership: LoginSaveOwnership,
    item: VaultItem,
    committedState: PopupState,
  ): boolean {
    const state = this.store.snapshot();
    return (
      this.loginOperationToken === ownership.token &&
      this.saveEpoch === ownership.operationEpoch &&
      this.store.isCurrentProtectedOperation(ownership.protectedOperationEpoch) &&
      this.router.url === ownership.routeUrl &&
      this.cipherType.type === "login" &&
      this.loginFormMode() === ownership.mode &&
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
      this.vault.itemById(item.id) === item
    );
  }

  private invalidateOperations(): void {
    this.invalidateLoginOperation();
    this.personalOperation.invalidate();
    this.officialPersonalForm?.enableFormFields();
  }

  private invalidateLoginOperation(): void {
    this.saveEpoch += 1;
    this.loginOperationToken = null;
    if (!this.loginCommitTerminal) {
      this.officialLoginForm?.enableFormFields();
    }
  }

  private async confirmDiscardChanges(trigger: Element | null): Promise<boolean> {
    if (!this.dirtyFormService.hasDirtyForm()) {
      return true;
    }
    const confirmed = await this.dialogService.openSimpleDialog({
      title: translateOfficialMessage("i18nDiscardChangesTitle"),
      content: translateOfficialMessage("i18nDiscardChangesContent"),
      type: "warning",
      acceptButtonText: translateOfficialMessage("i18nDiscard"),
      cancelButtonText: translateOfficialMessage("cancel"),
    });
    if (!confirmed && trigger instanceof HTMLElement) {
      trigger.focus();
    }
    return confirmed;
  }

  private cipherWritePort(session: AuthSession): VaultCipherWritePort {
    return this.cipherWrite ?? new BitwardenVaultCipherWriteActions(session);
  }
}

function officialPersonalType(
  type: PersonalCipherType,
): CipherType.Card | CipherType.Identity | CipherType.SecureNote {
  if (type === "card") return CipherType.Card;
  if (type === "identity") return CipherType.Identity;
  return CipherType.SecureNote;
}
