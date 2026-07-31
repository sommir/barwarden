import type { OpaqueCipherPayload } from "./opaque-cipher-payload";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

export type VaultItemType = "login" | "card" | "identity" | "secure-note" | "ssh-key";
export type RetainedPersonalCipherType = Extract<VaultItemType, "card" | "identity" | "secure-note">;

export interface VaultUri {
  readonly id: string;
  readonly uri: string;
  readonly matchType: string;
}

export interface VaultField {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly concealed?: boolean;
  readonly type?: "text" | "hidden" | "boolean" | "totp" | "linked";
  readonly linkedId?: number;
}

export interface VaultFolder {
  readonly id: string;
  readonly name: string;
}

export interface VaultOrganization {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly status: number;
}

export interface VaultCollection {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly readOnly: boolean;
  readonly manage: boolean;
}

export interface VaultAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly size: string;
  readonly encryptedKey?: string;
}

export interface VaultPasswordHistoryEntry {
  readonly password: string;
  readonly lastUsedDate: string;
}

export interface VaultCardData {
  readonly cardholderName: string;
  readonly brand: string;
  readonly number: string;
  readonly expMonth: string;
  readonly expYear: string;
  readonly code: string;
}

export interface VaultIdentityData {
  readonly title: string;
  readonly firstName: string;
  readonly middleName: string;
  readonly lastName: string;
  readonly username: string;
  readonly company: string;
  readonly ssn: string;
  readonly passportNumber: string;
  readonly licenseNumber: string;
  readonly email: string;
  readonly phone: string;
  readonly address1: string;
  readonly address2: string;
  readonly address3: string;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly country: string;
}

export interface VaultSecureNoteData {
  readonly type: number;
}

export interface VaultItem {
  readonly id: string;
  readonly opaqueServerPayload?: OpaqueCipherPayload;
  readonly requiresVaultSyncBeforeEdit?: boolean;
  readonly encryptedKey?: string;
  readonly organizationId?: string;
  readonly collectionIds?: readonly string[];
  readonly type: VaultItemType;
  readonly name: string;
  readonly subtitle: string;
  readonly favorite: boolean;
  readonly reprompt?: boolean;
  readonly folderId: string;
  readonly folderName: string;
  readonly organizationName: string;
  readonly attachmentCount: number;
  readonly attachments?: readonly VaultAttachment[];
  readonly uris: readonly VaultUri[];
  readonly fields: readonly VaultField[];
  readonly createdDate: string;
  readonly revisionDate: string;
  readonly passwordRevisionDate?: string;
  readonly archivedDate?: string;
  readonly deletedDate?: string;
  readonly passwordHistory?: readonly VaultPasswordHistoryEntry[];
  readonly card?: VaultCardData;
  readonly identity?: VaultIdentityData;
  readonly secureNote?: VaultSecureNoteData;
  readonly notes: string;
  readonly canLaunch: boolean;
  readonly canFill: boolean;
  readonly uri: string;
}

export const vaultItemTypes: readonly VaultItemType[] = [
  "login",
  "card",
  "identity",
  "secure-note",
  "ssh-key",
];

export function vaultItemTypeLabel(type: VaultItemType): string {
  return translateOfficialMessage({
    login: "typeLogin",
    card: "typeCard",
    identity: "typeIdentity",
    "secure-note": "typeNote",
    "ssh-key": "i18nSshKey",
  }[type]);
}
