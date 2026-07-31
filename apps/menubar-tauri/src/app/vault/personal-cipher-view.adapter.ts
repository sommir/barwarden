import {
  CipherRepromptType,
  CipherType,
  FieldType,
  SecureNoteType,
} from "@bitwarden/common/vault/enums";
import {
  CardLinkedId,
  IdentityLinkedId,
  type CardLinkedId as CardLinkedIdValue,
  type IdentityLinkedId as IdentityLinkedIdValue,
  type LinkedIdType,
} from "@bitwarden/common/vault/enums/linked-id-type.enum";
import { CardView } from "@bitwarden/common/vault/models/view/card.view";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { IdentityView } from "@bitwarden/common/vault/models/view/identity.view";
import { SecureNoteView } from "@bitwarden/common/vault/models/view/secure-note.view";

import type { VaultField, VaultItem } from "./vault-item.model";

export type RetainedPersonalCipherType = "card" | "identity" | "secure-note";

export interface OfficialPersonalCipherProjection {
  readonly itemId: string;
  readonly itemType: RetainedPersonalCipherType;
  readonly cipher: CipherView;
  readonly folder: FolderView | undefined;
  readonly actionFields: ReadonlyMap<string, VaultField>;
}

const standardFieldIds: Readonly<Record<RetainedPersonalCipherType, ReadonlySet<string>>> = {
  card: new Set(["cardholder-name", "brand", "number", "exp-month", "exp-year", "code", "notes"]),
  identity: new Set([
    "title", "first-name", "middle-name", "last-name", "username", "company", "ssn",
    "passport-number", "license-number", "email", "phone", "address", "address1",
    "address2", "address3", "address-1", "address-2", "address-3", "full-name",
    "city", "state", "postal-code", "country", "notes",
  ]),
  "secure-note": new Set(["notes"]),
};

export function projectPersonalCipherDetail(
  item: VaultItem,
): OfficialPersonalCipherProjection {
  if (item.id.trim() === "" || !isRetainedPersonalType(item.type)) {
    throw new TypeError("Official personal detail requires a retained item with an ID");
  }
  assertTypePayload(item);
  assertActionFieldIds(item.fields);
  assertLinkedFields(item.type, item.fields);

  const actionFields = new Map(item.fields.map((field) => [field.id, field] as const));
  const fields = item.fields
    .filter((field) => !standardFieldIds[item.type].has(field.id))
    .map((field) => officialFieldView(item.type, field));
  const cipher = CipherView.fromJSON({
    id: item.id,
    type: officialCipherType(item.type),
    name: item.name,
    notes: item.notes || undefined,
    favorite: item.favorite,
    folderId: item.folderId || undefined,
    reprompt: item.reprompt ? CipherRepromptType.Password : CipherRepromptType.None,
    creationDate: item.createdDate,
    revisionDate: item.revisionDate,
    attachments: [],
    collectionIds: [],
    fields: [],
  });
  if (!cipher) {
    throw new TypeError("Official personal CipherView projection failed");
  }

  cipher.fields = fields;
  if (item.type === "card") {
    cipher.card = CardView.fromJSON(item.card);
  } else if (item.type === "identity") {
    cipher.identity = IdentityView.fromJSON(item.identity);
  } else {
    cipher.secureNote = SecureNoteView.fromJSON({ type: SecureNoteType.Generic });
  }

  return {
    itemId: item.id,
    itemType: item.type,
    cipher,
    folder: item.folderId
      ? FolderView.fromJSON({
          id: item.folderId,
          name: item.folderName,
          revisionDate: item.revisionDate,
        })
      : undefined,
    actionFields,
  };
}

function isRetainedPersonalType(type: VaultItem["type"]): type is RetainedPersonalCipherType {
  return type === "card" || type === "identity" || type === "secure-note";
}

function assertTypePayload(
  item: VaultItem,
): asserts item is VaultItem & (
  | { readonly type: "card"; readonly card: NonNullable<VaultItem["card"]> }
  | { readonly type: "identity"; readonly identity: NonNullable<VaultItem["identity"]> }
  | { readonly type: "secure-note"; readonly secureNote: NonNullable<VaultItem["secureNote"]> }
) {
  if (
    (item.type === "card" && !item.card) ||
    (item.type === "identity" && !item.identity) ||
    (item.type === "secure-note" && item.secureNote?.type !== SecureNoteType.Generic)
  ) {
    throw new TypeError("Retained personal item is missing its official type payload");
  }
}

function officialCipherType(type: RetainedPersonalCipherType): CipherType {
  switch (type) {
    case "card": return CipherType.Card;
    case "identity": return CipherType.Identity;
    case "secure-note": return CipherType.SecureNote;
  }
}

function officialFieldView(type: RetainedPersonalCipherType, field: VaultField): FieldView {
  const linkedId = officialLinkedId(type, field);
  return FieldView.fromJSON({
    name: field.label,
    value: field.value,
    type: officialFieldType(field),
    ...(linkedId === undefined ? {} : { linkedId }),
  });
}

function assertActionFieldIds(fields: readonly VaultField[]): void {
  const ids = new Set<string>();
  for (const field of fields) {
    if (field.id.trim() === "" || ids.has(field.id)) {
      throw new TypeError("Personal action field IDs must be non-empty and unique");
    }
    ids.add(field.id);
  }
}

function assertLinkedFields(
  type: RetainedPersonalCipherType,
  fields: readonly VaultField[],
): void {
  for (const field of fields) {
    if (field.type === "linked") {
      officialLinkedId(type, field);
    }
  }
}

function officialLinkedId(
  type: RetainedPersonalCipherType,
  field: VaultField,
): LinkedIdType | undefined {
  if (field.type !== "linked") {
    return undefined;
  }
  if (type === "card" && isCardLinkedId(field.linkedId)) {
    return field.linkedId;
  }
  if (type === "identity" && isIdentityLinkedId(field.linkedId)) {
    return field.linkedId;
  }
  throw new TypeError("Linked field target is not valid for this personal cipher type");
}

const cardLinkedIds: ReadonlySet<number> = new Set(Object.values(CardLinkedId));
const identityLinkedIds: ReadonlySet<number> = new Set(Object.values(IdentityLinkedId));

function isCardLinkedId(value: number | undefined): value is CardLinkedIdValue {
  return typeof value === "number" && Number.isInteger(value) && cardLinkedIds.has(value);
}

function isIdentityLinkedId(value: number | undefined): value is IdentityLinkedIdValue {
  return typeof value === "number" && Number.isInteger(value) && identityLinkedIds.has(value);
}

function officialFieldType(field: VaultField): FieldType {
  switch (field.type) {
    case "hidden": return FieldType.Hidden;
    case "boolean": return FieldType.Boolean;
    case "linked": return FieldType.Linked;
    default: return FieldType.Text;
  }
}
