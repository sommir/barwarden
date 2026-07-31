import { DestroyRef, Inject, Injectable, InjectionToken, Optional } from "@angular/core";

import { CipherType, FieldType } from "@bitwarden/common/vault/enums";
import { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";

import type { CipherFormConfig } from "../../../../../vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form-config.service";
import { CipherFormGenerationService } from "../../../../../vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form-generation.service";
import { CipherFormService } from "../../../../../vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form.service";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import {
  normalizeLoginDraft,
  type LoginCustomFieldType,
} from "./vault-login-draft";

export type RetainedLoginFormMode = "add" | "edit" | "clone";

export interface RetainedLoginFormConfig {
  readonly mode: RetainedLoginFormMode;
  readonly initial: CipherView;
  readonly folders: readonly FolderView[];
  readonly canViewSecrets: boolean;
}

export interface RetainedLoginFormSubmit {
  readonly mode: RetainedLoginFormMode;
  readonly value: CipherView;
}

export type RetainedOfficialCipherFormConfig = CipherFormConfig & {
  readonly canViewSecrets: boolean;
};

export interface RetainedLoginFormGenerator {
  generate(
    mode: "password" | "username",
    isCurrent?: () => boolean | Promise<boolean>,
  ): Promise<{ readonly credential: string }>;
}

export type RetainedLoginFormCredentialApply = (credential: string) => void;

export const RETAINED_LOGIN_FORM_GENERATOR =
  new InjectionToken<RetainedLoginFormGenerator>(
    "RETAINED_LOGIN_FORM_GENERATOR",
  );

export interface RetainedLoginFormGenerationOwner {
  capture(): object;
  isCurrent(token: object): boolean;
}

export const RETAINED_LOGIN_FORM_GENERATION_OWNER =
  new InjectionToken<RetainedLoginFormGenerationOwner>(
    "RETAINED_LOGIN_FORM_GENERATION_OWNER",
  );

export interface RetainedLoginFormStatusStore {
  setStatus(message: string): void;
}

export const RETAINED_LOGIN_FORM_STATUS_STORE =
  new InjectionToken<RetainedLoginFormStatusStore>(
    "RETAINED_LOGIN_FORM_STATUS_STORE",
  );

const retainedCipherCarrierBrand = Symbol("retainedCipherCarrier");
type RetainedCipherCarrier = Cipher & {
  readonly [retainedCipherCarrierBrand]: true;
};
const retainedCipherViews = new WeakMap<Cipher, CipherView>();

export function freshCipherView(source: CipherView): CipherView {
  const copy = CipherView.fromJSON(JSON.parse(JSON.stringify(source)));
  if (!copy) {
    throw new TypeError("Unable to copy retained Login cipher view");
  }
  copy.id = source.id;
  if (source.login?.fido2Credentials == null) {
    copy.login.fido2Credentials = source.login.fido2Credentials;
  }
  copy.fields = copy.fields.filter(
    (field) =>
      field.type === FieldType.Text ||
      field.type === FieldType.Hidden ||
      field.type === FieldType.Boolean,
  );
  return copy;
}

function retainedCipherCarrier(source: CipherView): RetainedCipherCarrier {
  const carrier = new Cipher() as RetainedCipherCarrier;
  Object.defineProperty(carrier, retainedCipherCarrierBrand, { value: true });
  retainedCipherViews.set(carrier, freshCipherView(source));
  return carrier;
}

function freshFolders(folders: readonly FolderView[]): FolderView[] {
  return folders.map((folder) =>
    FolderView.fromJSON(JSON.parse(JSON.stringify(folder))),
  );
}

export function buildOfficialLoginFormConfig(
  retained: RetainedLoginFormConfig,
): RetainedOfficialCipherFormConfig {
  const initial = freshCipherView(retained.initial);
  const firstUri = initial.login.uris?.[0]?.uri;
  const base = {
    admin: false,
    cipherType: CipherType.Login,
    organizationDataOwnershipDisabled: true as const,
    collections: [] as CipherFormConfig["collections"],
    organizations: [] as CipherFormConfig["organizations"],
    folders: freshFolders(retained.folders),
    canViewSecrets: retained.canViewSecrets,
    initialValues: {
      name: initial.name,
      folderId: initial.folderId,
      username: initial.login.username,
      ...(retained.canViewSecrets
        ? { password: initial.login.password }
        : {}),
      ...(firstUri == null ? {} : { loginUri: firstUri }),
    },
  };

  if (retained.mode === "add") {
    return { ...base, mode: "add" };
  }

  return {
    ...base,
    mode: retained.mode,
    originalCipher: retainedCipherCarrier(initial),
  };
}

@Injectable()
export class RetainedCipherFormService extends CipherFormService {
  override async decryptCipher(cipher: Cipher): Promise<CipherView> {
    const retained = retainedCipherViews.get(cipher);
    if (!retained) {
      throw new TypeError("Cipher is not a retained Login form carrier");
    }
    return freshCipherView(retained);
  }

  override async saveCipher(
    cipher: CipherView,
    _config: CipherFormConfig,
  ): Promise<CipherView> {
    return freshCipherView(cipher);
  }
}

@Injectable()
export class RetainedCipherFormGenerationService extends CipherFormGenerationService {
  private operationEpoch = 0;
  private alive = true;

  constructor(
    @Inject(RETAINED_LOGIN_FORM_GENERATOR)
    private readonly generator: RetainedLoginFormGenerator,
    @Optional()
    @Inject(RETAINED_LOGIN_FORM_GENERATION_OWNER)
    private readonly owner: RetainedLoginFormGenerationOwner | null = null,
    @Optional() destroyRef: DestroyRef | null = null,
    @Optional()
    @Inject(RETAINED_LOGIN_FORM_STATUS_STORE)
    private readonly status: RetainedLoginFormStatusStore | null = null,
  ) {
    super();
    destroyRef?.onDestroy(() => {
      this.alive = false;
      this.operationEpoch += 1;
    });
  }

  override async generatePassword(
    apply?: RetainedLoginFormCredentialApply,
  ): Promise<string | null> {
    return this.generate("password", apply);
  }

  override async generateUsername(
    _uri: string,
    apply?: RetainedLoginFormCredentialApply,
  ): Promise<string | null> {
    return this.generate("username", apply);
  }

  private async generate(
    mode: "password" | "username",
    apply?: RetainedLoginFormCredentialApply,
  ): Promise<string | null> {
    const epoch = ++this.operationEpoch;
    const owner = this.owner?.capture();
    const isCurrent = () => {
      try {
        return this.alive
          && epoch === this.operationEpoch
          && (!owner || this.owner?.isCurrent(owner) === true);
      } catch {
        return false;
      }
    };
    let result: { readonly credential: string };
    try {
      result = await this.generator.generate(mode, isCurrent);
    } catch {
      if (isCurrent()) this.status?.setStatus(translateOfficialMessage("i18nUnableToGenerateCredential"));
      return null;
    }
    if (!isCurrent()) return null;
    apply?.(result.credential);
    return result.credential;
  }
}

@Injectable()
export class RetainedCipherFormToastService {
  constructor(
    @Inject(RETAINED_LOGIN_FORM_STATUS_STORE)
    private readonly store: RetainedLoginFormStatusStore,
  ) {}

  showToast(options: {
    readonly message: string | readonly string[];
    readonly variant?: "error" | "success" | "warning" | "info";
    readonly title?: string | null;
  }): void {
    const message = Array.isArray(options.message)
      ? options.message.join(" ")
      : String(options.message ?? "");
    this.store.setStatus(message);
  }
}

@Injectable()
export class RetainedCipherFormCacheService {
  readonly initializedWithValue = false;

  cacheCipherView(_cipherView: CipherView): void {}

  getCachedCipherView(): CipherView | null {
    return null;
  }

  clearCache(): void {}
}

export function createRetainedLoginFormSubmit(
  mode: RetainedLoginFormMode,
  value: CipherView,
): RetainedLoginFormSubmit {
  return { mode, value: freshCipherView(value) };
}

export function retainedLoginSubmitToDraft(
  submit: RetainedLoginFormSubmit,
): ReturnType<typeof normalizeLoginDraft> {
  const cipher = freshCipherView(submit.value);
  return normalizeLoginDraft({
    name: cipher.name,
    username: cipher.login.username ?? "",
    password: cipher.login.password ?? "",
    totp: cipher.login.totp ?? "",
    uris: (cipher.login.uris ?? []).map((uri) => ({
      uri: uri.uri ?? "",
      matchType: uri.match == null ? "default" : String(uri.match),
    })),
    fields: cipher.fields.map((field) => ({
      name: field.name ?? "",
      value:
        field.type === FieldType.Boolean
          ? field.value === "true"
          : (field.value ?? ""),
      type: fieldType(field.type),
    })),
    notes: cipher.notes ?? "",
    favorite: cipher.favorite,
    folderId: cipher.folderId ?? "",
    reprompt: cipher.reprompt !== 0,
  });
}

function fieldType(type: FieldType): LoginCustomFieldType {
  if (type === FieldType.Hidden) {
    return "hidden";
  }
  if (type === FieldType.Boolean) {
    return "boolean";
  }
  return "text";
}
