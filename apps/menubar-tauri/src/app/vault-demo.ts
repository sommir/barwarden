import { PasteError, type HostApi } from "../host/host-api";
import { ACCESSIBILITY_PERMISSION_STATUS } from "./official-ui/accessibility-permission-dialog.service";
import type { VaultField, VaultFolder, VaultItem } from "./vault/vault-item.model";

export type { VaultField, VaultFolder, VaultItem } from "./vault/vault-item.model";

export const demoFolders: readonly VaultFolder[] = [
  { id: "work", name: "Work" },
  { id: "personal", name: "Personal" },
];

export const demoVaultItems: readonly VaultItem[] = [
  {
    id: "github",
    type: "login",
    name: "GitHub",
    subtitle: "ops@example.com",
    folderId: "work",
    folderName: "Work",
    organizationName: "",
    attachmentCount: 0,
    uris: [
      { id: "github-uri-0", uri: "https://github.com", matchType: "default" },
      { id: "github-uri-1", uri: "https://gist.github.com", matchType: "default" },
    ],
    uri: "https://github.com",
    favorite: true,
    createdDate: "2026-07-01T09:00:00.000Z",
    revisionDate: "2026-07-04T09:00:00.000Z",
    notes: "",
    canLaunch: true,
    canFill: true,
    fields: [
      { id: "username", label: "Username", value: "ops@example.com" },
      {
        id: "password",
        label: "Password",
        value: "correct-horse-demo",
        concealed: true,
        type: "hidden",
      },
      { id: "otp", label: "OTP", value: "123456", type: "totp" },
      { id: "custom:Workspace", label: "Workspace", value: "engineering" },
    ],
  },
  {
    id: "card",
    type: "card",
    name: "Travel card",
    subtitle: "Visa",
    folderId: "personal",
    folderName: "Personal",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    uri: "",
    favorite: false,
    createdDate: "2026-07-02T09:00:00.000Z",
    revisionDate: "2026-07-05T09:00:00.000Z",
    notes: "",
    canLaunch: false,
    canFill: false,
    fields: [
      { id: "brand", label: "Brand", value: "Visa" },
      { id: "cardholder-name", label: "Cardholder", value: "Travel Ops" },
      { id: "issuer", label: "Issuer", value: "Stripe" },
      { id: "number", label: "Number", value: "4111 1111 1111 1111", concealed: true },
      { id: "exp-month", label: "Expiration month", value: "04" },
      { id: "exp-year", label: "Expiration year", value: "2029" },
      { id: "code", label: "Security code", value: "123", concealed: true, type: "hidden" },
    ],
    card: {
      cardholderName: "Travel Ops",
      brand: "Visa",
      number: "4111111111111111",
      expMonth: "04",
      expYear: "2029",
      code: "123",
    },
  },
  {
    id: "identity",
    type: "identity",
    name: "Personal identity",
    subtitle: "me@example.com",
    folderId: "personal",
    folderName: "Personal",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    uri: "",
    favorite: false,
    createdDate: "2026-07-03T09:00:00.000Z",
    revisionDate: "2026-07-06T09:00:00.000Z",
    notes: "",
    canLaunch: false,
    canFill: false,
    fields: [
      { id: "email", label: "Email", value: "me@example.com" },
      { id: "first-name", label: "First name", value: "Example" },
      { id: "last-name", label: "Last name", value: "Person" },
      { id: "phone", label: "Phone", value: "+1 555 0100" },
    ],
    identity: {
      title: "",
      firstName: "Example",
      middleName: "",
      lastName: "Person",
      username: "",
      company: "",
      ssn: "",
      passportNumber: "",
      licenseNumber: "",
      email: "me@example.com",
      phone: "+1 555 0100",
      address1: "",
      address2: "",
      address3: "",
      city: "",
      state: "",
      postalCode: "",
      country: "",
    },
  },
  {
    id: "note",
    type: "secure-note",
    name: "Recovery note",
    subtitle: "Secure note",
    folderId: "work",
    folderName: "Work",
    organizationName: "",
    attachmentCount: 1,
    uris: [],
    uri: "",
    favorite: true,
    createdDate: "2026-07-03T12:00:00.000Z",
    revisionDate: "2026-07-07T09:00:00.000Z",
    notes: "plain",
    canLaunch: false,
    canFill: false,
    fields: [{ id: "notes", label: "Notes", value: "plain" }],
    secureNote: { type: 0 },
  },
  {
    id: "ssh",
    type: "ssh-key",
    name: "Deploy key",
    subtitle: "ssh-rsa AAA",
    folderId: "work",
    folderName: "Work",
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    uri: "",
    favorite: false,
    createdDate: "2026-07-04T12:00:00.000Z",
    revisionDate: "2026-07-08T09:00:00.000Z",
    notes: "",
    canLaunch: false,
    canFill: false,
    fields: [
      { id: "private-key", label: "Private key", value: "[demo SSH private key omitted]", concealed: true, type: "hidden" },
      { id: "public-key", label: "Public key", value: "ssh-rsa AAA" },
      { id: "fingerprint", label: "Fingerprint", value: "SHA256:demo" },
    ],
  },
];

export function searchVaultItems(items: readonly VaultItem[], query: string): readonly VaultItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return items;
  }

  return items.filter((item) => searchableText(item).includes(normalizedQuery));
}

export async function copyVaultField(
  host: HostApi,
  field: VaultField,
  clearAfterSeconds: number,
): Promise<string> {
  await host.copyText(field.value, clearAfterSeconds);
  return `Copied ${field.label}`;
}

export async function fillVaultField(
  host: HostApi,
  field: VaultField,
  clearAfterSeconds: number,
): Promise<string> {
  try {
    await host.pasteText(field.value, clearAfterSeconds);
    return `Filled ${field.label}`;
  } catch (error) {
    if (error instanceof PasteError && error.valueCopied) {
      return error.code === "accessibility-denied"
        ? ACCESSIBILITY_PERMISSION_STATUS
        : "Paste unavailable; value copied.";
    }

    try {
      await host.copyText(field.value, clearAfterSeconds);
      return "Paste unavailable; value copied.";
    } catch {
      return "Unable to fill field.";
    }
  }
}

function searchableText(item: VaultItem): string {
  return [
    item.name,
    item.subtitle,
    item.uri,
    ...item.uris.map((uri) => uri.uri),
    ...item.fields.flatMap((field) => (field.concealed ? [field.label] : [field.label, field.value])),
  ]
    .join(" ")
    .toLocaleLowerCase();
}
