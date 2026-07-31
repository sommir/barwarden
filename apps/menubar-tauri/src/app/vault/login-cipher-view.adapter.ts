import {
  UriMatchStrategy,
  type UriMatchStrategySetting,
} from "@bitwarden/common/models/domain/domain-service";
import {
  CipherRepromptType,
  CipherType,
  FieldType,
  type LinkedIdType,
} from "@bitwarden/common/vault/enums";
import { CipherView } from "@bitwarden/common/vault/models/view/cipher.view";
import { FieldView } from "@bitwarden/common/vault/models/view/field.view";
import { FolderView } from "@bitwarden/common/vault/models/view/folder.view";
import { LoginUriView } from "@bitwarden/common/vault/models/view/login-uri.view";
import { LoginView } from "@bitwarden/common/vault/models/view/login.view";

import type { VaultField, VaultItem } from "./vault-item.model";

const standardFieldIds = new Set(["username", "password", "otp", "notes"]);

export interface OfficialLoginDetailProjection {
  readonly cipher: CipherView;
  readonly folder: FolderView | undefined;
  readonly actionFields: ReadonlyMap<string, VaultField>;
}

function officialFieldType(field: VaultField): FieldType {
  switch (field.type) {
    case "hidden":
      return FieldType.Hidden;
    case "boolean":
      return FieldType.Boolean;
    case "linked":
      return FieldType.Linked;
    default:
      return FieldType.Text;
  }
}

function officialUriMatch(matchType: string): UriMatchStrategySetting | undefined {
  if (matchType === "default" || matchType.trim() === "") {
    return undefined;
  }

  const value = Number(matchType);
  return Number.isInteger(value) &&
    value >= UriMatchStrategy.Domain &&
    value <= UriMatchStrategy.Never
    ? (value as UriMatchStrategySetting)
    : undefined;
}

export function projectLoginDetail(item: VaultItem): OfficialLoginDetailProjection {
  if (item.type !== "login") {
    throw new TypeError("Official Login detail projection requires a Login item");
  }

  const actionFields = new Map(item.fields.map((field) => [field.id, field] as const));
  const fields = item.fields
    .filter((field) => !standardFieldIds.has(field.id))
    .map((field) => FieldView.fromJSON({
      name: field.label,
      value: field.value,
      type: officialFieldType(field),
      ...(field.type === "linked" && Number.isInteger(field.linkedId)
        ? { linkedId: field.linkedId as LinkedIdType }
        : {}),
    }));
  const login = LoginView.fromJSON({
    username: actionFields.get("username")?.value,
    password: actionFields.get("password")?.value,
    totp: actionFields.get("otp")?.value,
    passwordRevisionDate: item.passwordRevisionDate,
    uris: item.uris.map((uri) => LoginUriView.fromJSON({
      uri: uri.uri,
      match: officialUriMatch(uri.matchType),
    })),
    fido2Credentials: [],
  });
  const cipher = CipherView.fromJSON({
    id: item.id,
    type: CipherType.Login,
    name: item.name,
    notes: item.notes || undefined,
    favorite: item.favorite,
    folderId: item.folderId || undefined,
    reprompt: item.reprompt ? CipherRepromptType.Password : CipherRepromptType.None,
    creationDate: item.createdDate,
    revisionDate: item.revisionDate,
    attachments: [],
    collectionIds: [],
    passwordHistory: (item.passwordHistory ?? []).map((entry) => ({
      password: entry.password,
      lastUsedDate: entry.lastUsedDate,
    })),
  });
  if (cipher == null) {
    throw new TypeError("Official CipherView projection failed");
  }
  cipher.fields = fields;
  cipher.login = login;

  return {
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
