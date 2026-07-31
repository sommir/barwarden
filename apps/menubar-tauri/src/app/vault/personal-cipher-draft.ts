import {
  CardLinkedId,
  IdentityLinkedId,
} from "@bitwarden/common/vault/enums/linked-id-type.enum";

import type {
  RetainedPersonalCipherType,
  VaultField,
  VaultItem,
} from "./vault-item.model";

export interface CipherCustomFieldInput {
  readonly name: string;
  readonly value: string | boolean | null;
  readonly type: 0 | 1 | 2 | 3;
  readonly linkedId?: number;
}

export interface CardCipherDraft {
  readonly name: string;
  readonly cardholderName: string;
  readonly brand?: string;
  readonly number: string;
  readonly expMonth: string;
  readonly expYear: string;
  readonly code: string;
  readonly notes: string;
  readonly favorite?: boolean;
  readonly folderId?: string;
  readonly reprompt?: boolean;
  readonly fields?: readonly CipherCustomFieldInput[];
}

export interface IdentityCipherDraft {
  readonly name: string;
  readonly title?: string;
  readonly firstName: string;
  readonly middleName?: string;
  readonly lastName: string;
  readonly username?: string;
  readonly company?: string;
  readonly ssn?: string;
  readonly passportNumber?: string;
  readonly licenseNumber?: string;
  readonly email: string;
  readonly phone: string;
  readonly address1: string;
  readonly address2?: string;
  readonly address3?: string;
  readonly city?: string;
  readonly state?: string;
  readonly postalCode?: string;
  readonly country?: string;
  readonly notes: string;
  readonly favorite?: boolean;
  readonly folderId?: string;
  readonly reprompt?: boolean;
  readonly fields?: readonly CipherCustomFieldInput[];
}

export interface SecureNoteCipherDraft {
  readonly name: string;
  readonly notes: string;
  readonly noteType?: number;
  readonly favorite?: boolean;
  readonly folderId?: string;
  readonly reprompt?: boolean;
  readonly fields?: readonly CipherCustomFieldInput[];
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

const cardLinkedIds: ReadonlySet<number> = numericEnumValues(CardLinkedId);
const identityLinkedIds: ReadonlySet<number> = numericEnumValues(IdentityLinkedId);

export function personalCipherFieldInputs(item: VaultItem): readonly CipherCustomFieldInput[] {
  if (!isRetainedPersonalCipherType(item.type)) {
    throw new TypeError("Personal cipher fields require a retained personal cipher type");
  }
  const type = item.type;

  return item.fields
    .filter((field) => !standardFieldIds[type].has(field.id))
    .map((field) => personalCipherFieldInput(type, field));
}

function personalCipherFieldInput(
  type: RetainedPersonalCipherType,
  field: VaultField,
): CipherCustomFieldInput {
  const name = field.label.trim();
  switch (field.type) {
    case "hidden":
      return { name, value: field.value, type: 1 };
    case "boolean":
      return { name, value: field.value.trim().toLowerCase() === "true", type: 2 };
    case "linked":
      if (!validLinkedId(type, field.linkedId)) {
        throw new TypeError("Linked field target is not valid for this personal cipher type");
      }
      return { name, value: null, type: 3, linkedId: field.linkedId };
    default:
      return { name, value: field.value, type: 0 };
  }
}

function validLinkedId(type: RetainedPersonalCipherType, value: number | undefined): value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return false;
  }
  return type === "card"
    ? cardLinkedIds.has(value)
    : type === "identity" && identityLinkedIds.has(value);
}

function numericEnumValues(value: object): ReadonlySet<number> {
  return new Set(Object.values(value).filter((entry): entry is number => typeof entry === "number"));
}

function isRetainedPersonalCipherType(type: VaultItem["type"]): type is RetainedPersonalCipherType {
  return type === "card" || type === "identity" || type === "secure-note";
}
