import { Injectable } from "@angular/core";

import { CipherType } from "@bitwarden/common/vault/enums/cipher-type";
import { FieldType } from "@bitwarden/common/vault/enums/field-type.enum";
import {
  CardLinkedId,
  IdentityLinkedId,
} from "@bitwarden/common/vault/enums/linked-id-type.enum";
import { SecureNoteType } from "@bitwarden/common/vault/enums/secure-note-type.enum";
import type { Cipher } from "@bitwarden/common/vault/models/domain/cipher";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import type { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";
import { SecureNoteView } from "@bitwarden/common/vault/models/view/secure-note.view";

import type { CipherFormConfig } from "../../../../../vendor/bitwarden-clients/libs/vault/src/cipher-form/abstractions/cipher-form-config.service";
import { PopupStateStore } from "../popup-state";
import type {
  CardCipherDraft,
  CipherCustomFieldInput,
  IdentityCipherDraft,
  SecureNoteCipherDraft,
} from "./personal-cipher-draft";

export type RetainedPersonalCipherType =
  | typeof CipherType.Card
  | typeof CipherType.Identity
  | typeof CipherType.SecureNote;

export interface RetainedPersonalCipherFormConfig {
  readonly mode: "add" | "edit" | "clone";
  readonly cipherType: RetainedPersonalCipherType;
  readonly initial: CipherView;
  readonly folders: readonly FolderView[];
  readonly canViewSecrets: boolean;
}

export interface RetainedPersonalCipherFormSubmit {
  readonly mode: RetainedPersonalCipherFormConfig["mode"];
  readonly cipherType: RetainedPersonalCipherType;
  readonly value: CipherView;
}

export type RetainedOfficialPersonalCipherFormConfig = CipherFormConfig & {
  readonly canViewSecrets: boolean;
};

const personalCipherViews = new WeakMap<Cipher, CipherView>();
const personalConfigInitialViews = new WeakMap<object, CipherView>();

export function freshPersonalCipherView(source: CipherView): CipherView {
  assertPersonalCipherType(source.type);
  const cipherType = source.type;
  const copy = Object.assign(Object.create(Object.getPrototypeOf(source)), {
    id: source.id,
    organizationId: source.organizationId,
    folderId: source.folderId,
    name: source.name,
    notes: source.notes,
    type: source.type,
    favorite: source.favorite,
    organizationUseTotp: source.organizationUseTotp,
    permissions: source.permissions,
    edit: source.edit,
    viewPassword: source.viewPassword,
    localData: source.localData,
    card:
      cipherType === CipherType.Card ? projectCard(source.card) : new CardView(),
    identity:
      cipherType === CipherType.Identity
        ? projectIdentity(source.identity)
        : new IdentityView(),
    secureNote:
      cipherType === CipherType.SecureNote
        ? projectSecureNote(source.secureNote)
        : new SecureNoteView(),
    attachments: [],
    fields: source.fields.map((field) => projectField(cipherType, field)),
    passwordHistory: [],
    collectionIds: [...source.collectionIds],
    revisionDate: source.revisionDate ? new Date(source.revisionDate) : undefined,
    creationDate: source.creationDate ? new Date(source.creationDate) : undefined,
    deletedDate: source.deletedDate ? new Date(source.deletedDate) : undefined,
    archivedDate: source.archivedDate ? new Date(source.archivedDate) : undefined,
    reprompt: source.reprompt,
    key: source.key,
    decryptionFailure: source.decryptionFailure,
  }) as CipherView;
  return copy;
}

function retainedCipherCarrier(source: CipherView): Cipher {
  const carrier = {} as Cipher;
  personalCipherViews.set(carrier, freshPersonalCipherView(source));
  return carrier;
}

function freshFolders(folders: readonly FolderView[]): FolderView[] {
  return folders.map((source) => {
    const folder = new FolderView();
    folder.id = source.id;
    folder.name = source.name;
    folder.revisionDate = source.revisionDate
      ? new Date(source.revisionDate)
      : folder.revisionDate;
    return folder;
  });
}

export function buildOfficialPersonalCipherFormConfig(
  retained: RetainedPersonalCipherFormConfig,
): RetainedOfficialPersonalCipherFormConfig {
  assertPersonalCipherType(retained.cipherType);
  if (retained.initial.type !== retained.cipherType) {
    throw new TypeError(
      "Personal form cipher type does not match initial CipherView",
    );
  }
  const initial = freshPersonalCipherView(retained.initial);
  const commonInitialValues = {
    name: initial.name,
    folderId: initial.folderId,
  };
  const initialValues =
    retained.cipherType === CipherType.Card
      ? {
          ...commonInitialValues,
          cardholderName: initial.card.cardholderName,
          brand: initial.card.brand,
          expMonth: initial.card.expMonth,
          expYear: initial.card.expYear,
          ...(retained.canViewSecrets
            ? { number: initial.card.number, code: initial.card.code }
            : {}),
        }
      : retained.cipherType === CipherType.Identity
        ? {
            ...commonInitialValues,
            title: initial.identity.title,
            firstName: initial.identity.firstName,
            middleName: initial.identity.middleName,
            lastName: initial.identity.lastName,
            username: initial.identity.username,
            company: initial.identity.company,
            licenseNumber: initial.identity.licenseNumber,
            email: initial.identity.email,
            phone: initial.identity.phone,
            address1: initial.identity.address1,
            address2: initial.identity.address2,
            address3: initial.identity.address3,
            city: initial.identity.city,
            state: initial.identity.state,
            postalCode: initial.identity.postalCode,
            country: initial.identity.country,
            ...(retained.canViewSecrets
              ? {
                  ssn: initial.identity.ssn,
                  passportNumber: initial.identity.passportNumber,
                }
              : {}),
          }
        : commonInitialValues;
  const base = {
    admin: false,
    cipherType: retained.cipherType,
    organizationDataOwnershipDisabled: true as const,
    collections: [] as CipherFormConfig["collections"],
    organizations: [] as CipherFormConfig["organizations"],
    folders: freshFolders(retained.folders),
    canViewSecrets: retained.canViewSecrets,
    initialValues,
  };
  const config: RetainedOfficialPersonalCipherFormConfig =
    retained.mode === "add"
      ? { ...base, mode: "add" }
      : {
          ...base,
          mode: retained.mode,
          originalCipher: retainedCipherCarrier(initial),
        };
  personalConfigInitialViews.set(config, initial);
  return config;
}

export function initialPersonalCipherView(
  config: RetainedOfficialPersonalCipherFormConfig,
): CipherView {
  const initial = personalConfigInitialViews.get(config);
  if (!initial) {
    throw new TypeError(
      "Personal form config was not built by the retained adapter",
    );
  }
  return freshPersonalCipherView(initial);
}

@Injectable()
export class RetainedPersonalCipherFormService {
  async decryptCipher(cipher: Cipher): Promise<CipherView> {
    const retained = personalCipherViews.get(cipher);
    if (!retained) {
      throw new TypeError("Cipher is not a retained personal form carrier");
    }
    return freshPersonalCipherView(retained);
  }

  async saveCipher(
    cipher: CipherView,
    _config: CipherFormConfig,
  ): Promise<CipherView> {
    return freshPersonalCipherView(cipher);
  }
}

@Injectable()
export class RetainedPersonalCipherFormToastService {
  constructor(private readonly store: PopupStateStore) {}

  showToast(options: {
    readonly message: string | readonly string[];
    readonly variant?: "error" | "success" | "warning" | "info";
    readonly title?: string | null;
  }): void {
    this.store.setStatus(
      Array.isArray(options.message)
        ? options.message.join(" ")
        : String(options.message ?? ""),
    );
  }
}

@Injectable()
export class RetainedPersonalCipherFormCacheService {
  readonly initializedWithValue = false;
  cacheCipherView(_cipherView: CipherView): void {}
  getCachedCipherView(): CipherView | null {
    return null;
  }
}

export function retainedPersonalSubmitToDraft(
  submit: RetainedPersonalCipherFormSubmit,
): CardCipherDraft | IdentityCipherDraft | SecureNoteCipherDraft {
  if (submit.value.type !== submit.cipherType) {
    throw new TypeError(
      "Personal submit cipher type does not match CipherView",
    );
  }
  const cipher = freshPersonalCipherView(submit.value);
  const common = {
    name: cipher.name,
    notes: cipher.notes ?? "",
    favorite: cipher.favorite,
    folderId: cipher.folderId ?? undefined,
    reprompt: cipher.reprompt !== 0,
    fields: customFieldInputs(cipher),
  };
  if (submit.cipherType === CipherType.Card) {
    return {
      ...common,
      cardholderName: cipher.card.cardholderName ?? "",
      brand: cipher.card.brand ?? undefined,
      number: cipher.card.number ?? "",
      expMonth: canonicalExpirationMonth(cipher.card.expMonth),
      expYear: cipher.card.expYear ?? "",
      code: cipher.card.code ?? "",
    };
  }
  if (submit.cipherType === CipherType.Identity) {
    return {
      ...common,
      title: cipher.identity.title ?? undefined,
      firstName: cipher.identity.firstName ?? "",
      middleName: cipher.identity.middleName ?? undefined,
      lastName: cipher.identity.lastName ?? "",
      username: cipher.identity.username ?? undefined,
      company: cipher.identity.company ?? undefined,
      ssn: cipher.identity.ssn ?? undefined,
      passportNumber: cipher.identity.passportNumber ?? undefined,
      licenseNumber: cipher.identity.licenseNumber ?? undefined,
      email: cipher.identity.email ?? "",
      phone: cipher.identity.phone ?? "",
      address1: cipher.identity.address1 ?? "",
      address2: cipher.identity.address2 ?? undefined,
      address3: cipher.identity.address3 ?? undefined,
      city: cipher.identity.city ?? undefined,
      state: cipher.identity.state ?? undefined,
      postalCode: cipher.identity.postalCode ?? undefined,
      country: cipher.identity.country ?? undefined,
    };
  }
  return {
    ...common,
    noteType: cipher.secureNote.type ?? SecureNoteType.Generic,
  };
}

function canonicalExpirationMonth(value: string | null | undefined): string {
  if (!value) return "";
  const month = Number.parseInt(value, 10);
  return month >= 1 && month <= 12 ? String(month).padStart(2, "0") : "";
}

function projectCard(source: CardView): CardView {
  const card = new CardView();
  card.cardholderName = source.cardholderName;
  card.brand = source.brand;
  card.number = source.number;
  card.expMonth = source.expMonth;
  card.expYear = source.expYear;
  card.code = source.code;
  return card;
}

function projectIdentity(source: IdentityView): IdentityView {
  const identity = new IdentityView();
  identity.title = source.title;
  identity.firstName = source.firstName;
  identity.middleName = source.middleName;
  identity.lastName = source.lastName;
  identity.username = source.username;
  identity.company = source.company;
  identity.ssn = source.ssn;
  identity.passportNumber = source.passportNumber;
  identity.licenseNumber = source.licenseNumber;
  identity.email = source.email;
  identity.phone = source.phone;
  identity.address1 = source.address1;
  identity.address2 = source.address2;
  identity.address3 = source.address3;
  identity.city = source.city;
  identity.state = source.state;
  identity.postalCode = source.postalCode;
  identity.country = source.country;
  return identity;
}

function projectSecureNote(source: SecureNoteView): SecureNoteView {
  const secureNote = new SecureNoteView();
  secureNote.type = source.type;
  return secureNote;
}

function projectField(
  cipherType: RetainedPersonalCipherType,
  source: FieldView,
): FieldView {
  if (
    source.type !== FieldType.Text &&
    source.type !== FieldType.Hidden &&
    source.type !== FieldType.Boolean &&
    source.type !== FieldType.Linked
  ) {
    throw new TypeError(`Unsupported field type: ${String(source.type)}`);
  }
  if (source.type === FieldType.Linked) {
    if (cipherType === CipherType.SecureNote) {
      throw new TypeError("Secure Note ciphers cannot contain linked fields");
    }
    if (!validLinkedId(cipherType, source.linkedId)) {
      throw new TypeError("Linked field target is not valid for this personal cipher type");
    }
  }
  const field = new FieldView();
  field.name = source.name;
  field.value = source.value;
  field.type = source.type;
  field.linkedId = source.linkedId;
  return field;
}

function customFieldInputs(cipher: CipherView): CipherCustomFieldInput[] {
  return cipher.fields.map((field) => ({
    name: field.name ?? "",
    value:
      field.type === FieldType.Boolean
        ? field.value === "true"
        : field.type === FieldType.Linked
          ? null
          : (field.value ?? ""),
    type: field.type as CipherCustomFieldInput["type"],
    ...(field.type === FieldType.Linked ? { linkedId: field.linkedId } : {}),
  }));
}

function assertPersonalCipherType(
  value: CipherType,
): asserts value is RetainedPersonalCipherType {
  if (
    value !== CipherType.Card &&
    value !== CipherType.Identity &&
    value !== CipherType.SecureNote
  ) {
    throw new TypeError("Cipher type is not a retained personal cipher type");
  }
}

function validLinkedId(
  type: typeof CipherType.Card | typeof CipherType.Identity,
  linkedId: number | undefined,
): boolean {
  const values =
    type === CipherType.Card
      ? Object.values(CardLinkedId)
      : Object.values(IdentityLinkedId);
  return (
    typeof linkedId === "number" &&
    new Set<number>(values as readonly number[]).has(linkedId)
  );
}
