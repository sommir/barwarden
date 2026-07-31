import { PopupStateStore } from "../popup-state";
import type { VaultItem, VaultItemType } from "./vault-item.model";
import type { VaultMainEvidenceState } from "./vault-main-evidence-state";
import {
  isPersonalCipherEvidenceState,
  isPersonalCipherFormEvidenceState,
} from "../evidence/personal-cipher-workflow-evidence";
import { isRecoveryEvidenceState } from "../evidence/recovery-workflow-evidence";

export {
  parseVaultMainEvidenceState,
  resolveVaultMainEvidenceState,
  vaultMainEvidenceStates,
} from "./vault-main-evidence-state";

const loginEvidenceRoutes = {
  "login-detail": "/view-cipher/calendar",
  "login-detail-reprompt": "/view-cipher/calendar",
  "login-history": "/cipher-password-history?cipherId=calendar",
  "login-history-empty": "/cipher-password-history?cipherId=calendar",
  "login-history-protected": "/view-cipher/calendar",
  "login-add": "/add-cipher?type=1",
  "login-edit": "/edit-cipher?cipherId=calendar&type=1",
  "login-clone": "/clone-cipher?cipherId=calendar&type=1",
  "login-archive": "/archive",
  "login-trash": "/trash",
  "card-detail": "/view-cipher/billing",
  "card-detail-reprompt": "/view-cipher/billing",
  "card-form-add": "/add-cipher?type=3",
  "card-form-edit": "/edit-cipher?cipherId=billing&type=3",
  "card-form-clone": "/clone-cipher?cipherId=billing&type=3",
  "card-add": "/add-cipher?type=3",
  "card-edit": "/edit-cipher?cipherId=billing&type=3",
  "card-clone": "/clone-cipher?cipherId=billing&type=3",
  "card-archive": "/archive",
  "card-trash": "/trash",
  "identity-detail": "/view-cipher/profile",
  "identity-detail-reprompt": "/view-cipher/profile",
  "identity-form-add": "/add-cipher?type=4",
  "identity-form-edit": "/edit-cipher?cipherId=profile&type=4",
  "identity-form-clone": "/clone-cipher?cipherId=profile&type=4",
  "identity-add": "/add-cipher?type=4",
  "identity-edit": "/edit-cipher?cipherId=profile&type=4",
  "identity-clone": "/clone-cipher?cipherId=profile&type=4",
  "identity-archive": "/archive",
  "identity-trash": "/trash",
  "note-detail": "/view-cipher/recovery",
  "note-form-add": "/add-cipher?type=2",
  "note-form-edit": "/edit-cipher?cipherId=recovery&type=2",
  "note-form-clone": "/clone-cipher?cipherId=recovery&type=2",
  "note-add": "/add-cipher?type=2",
  "note-edit": "/edit-cipher?cipherId=recovery&type=2",
  "note-clone": "/clone-cipher?cipherId=recovery&type=2",
  "note-archive": "/archive",
  "note-trash": "/trash",
  "personal-form-validation": "/add-cipher?type=3",
  "personal-form-failure": "/add-cipher?type=3",
  "personal-form-duplicate": "/add-cipher?type=3",
  "personal-form-stale": "/edit-cipher?cipherId=billing&type=3",
  "login-workflow-detail-default": "/view-cipher/calendar",
  "login-workflow-detail-revealed": "/view-cipher/calendar",
  "login-workflow-detail-reprompt": "/view-cipher/calendar",
  "login-workflow-detail-totp-rollover": "/view-cipher/calendar",
  "login-workflow-detail-multiple-uri": "/view-cipher/calendar",
  "login-workflow-detail-custom-field": "/view-cipher/calendar",
  "login-workflow-detail-archived": "/view-cipher/calendar",
  "login-workflow-detail-trashed": "/view-cipher/calendar",
  "login-workflow-detail-action-failure": "/view-cipher/calendar",
  "login-workflow-detail-long-text": "/view-cipher/calendar",
  "login-workflow-form-add": "/add-cipher?type=1",
  "login-workflow-form-edit": "/edit-cipher?cipherId=calendar&type=1",
  "login-workflow-form-clone": "/clone-cipher?cipherId=calendar&type=1",
  "login-workflow-form-validation": "/add-cipher?type=1",
  "login-workflow-form-save-failure": "/add-cipher?type=1",
  "login-workflow-form-duplicate": "/add-cipher?type=1",
  "login-workflow-form-stale": "/edit-cipher?cipherId=calendar&type=1",
  "login-workflow-form-compact": "/edit-cipher?cipherId=calendar&type=1",
  "login-workflow-form-light": "/edit-cipher?cipherId=calendar&type=1",
  "login-workflow-form-dark": "/edit-cipher?cipherId=calendar&type=1",
  "password-history-populated": "/cipher-password-history?cipherId=calendar",
  "password-history-empty": "/cipher-password-history?cipherId=calendar",
  "password-history-reprompt": "/cipher-password-history?cipherId=calendar",
  "folders-list": "/folders",
  "folders-empty": "/folders",
  "folders-add-dialog": "/folders",
  "folders-edit-dialog": "/folders",
  "folders-delete-confirmation": "/folders",
  "archive-list": "/archive",
  "archive-menu": "/archive",
  "archive-empty": "/archive",
  "trash-list": "/trash",
  "trash-menu": "/trash",
  "trash-permanent-delete-confirmation": "/trash",
  "trash-empty": "/trash",
  "recovery-operation-error": "/folders",
} as const satisfies Partial<Record<VaultMainEvidenceState, string>>;

export function vaultMainEvidenceRoute(evidenceState: VaultMainEvidenceState): string {
  return loginEvidenceRoutes[evidenceState as keyof typeof loginEvidenceRoutes] ?? "/tabs/vault";
}

export function applyVaultMainEvidenceState(
  store: PopupStateStore,
  evidenceState: VaultMainEvidenceState,
): void {
  store.setServerUrl("https://vault.example.test");
  store.setUnlocked("evidence-user");
  if (
    evidenceState === "populated" ||
    evidenceState.startsWith("login-workflow-form-") ||
    isPersonalCipherFormEvidenceState(evidenceState) ||
    isRecoveryEvidenceState(evidenceState)
  ) {
    store.setActiveSession({
      environment: {
        apiUrl: "https://api.example.test",
        identityUrl: "https://identity.example.test",
        webVaultUrl: "https://vault.example.test",
        iconsUrl: "https://icons.example.test",
        sendUrl: null,
        notificationsUrl: "https://notifications.example.test",
        eventsUrl: "https://events.example.test",
        keyConnectorUrl: null,
      },
      token: {
        accessToken: "fixture-a",
        refreshToken: "fixture-r",
        tokenType: "Bearer",
        expiresIn: 3600,
        clientId: "browser",
      },
      crypto: { userKeyB64: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==" },
    });
  }

  if (evidenceState === "loading") {
    store.beginVaultSync();
    return;
  }

  if (isRecoveryEvidenceState(evidenceState)) {
    applyRecoveryEvidenceState(store, evidenceState);
    return;
  }

  const loginWorkflowState = evidenceState.startsWith("login-workflow-");
  const personalWorkflowState = isPersonalCipherEvidenceState(evidenceState);
  const baseItems = withPasswordHistoryEvidence(
    loginWorkflowState
      ? workflowItems(evidenceState)
      : personalWorkflowState
        ? personalWorkflowItems()
      : evidenceState === "long-text"
        ? longTextItems
        : evidenceState === "large-list"
        ? largeListItems
        : populatedItems,
    evidenceState,
  );
  const protectedItemId = evidenceState.startsWith("card-")
    ? "billing"
    : evidenceState.startsWith("identity-")
      ? "profile"
      : evidenceState.startsWith("note-")
        ? "recovery"
      : "calendar";
  const protectedState = [
    "login-detail-reprompt",
    "login-history-protected",
    "login-archive",
    "login-trash",
    "card-detail-reprompt",
    "card-archive",
    "card-trash",
    "identity-detail-reprompt",
    "identity-archive",
    "identity-trash",
    "note-archive",
    "note-trash",
    "login-workflow-detail-reprompt",
  ].includes(evidenceState);
  const items = protectedState
    ? baseItems.map((item) => (item.id === protectedItemId ? { ...item, reprompt: true } : item))
    : baseItems;
  store.setItems(
    evidenceState === "empty" || evidenceState === "unavailable" ? [] : items,
    evidenceFolders,
    EVIDENCE_DATE,
  );
  if (evidenceState === "filtered" || evidenceState === "type-filter") {
    store.setFilterType("card");
  } else if (evidenceState === "folder-filter") {
    store.setFilterFolderId("work");
  } else if (evidenceState === "stale") {
    store.failVaultSync(true);
  } else if (evidenceState === "unavailable") {
    store.failVaultSync(false);
  } else if (
    evidenceState === "login-archive" ||
    evidenceState === "login-workflow-detail-archived" ||
    evidenceState === "card-archive" ||
    evidenceState === "identity-archive" ||
    evidenceState === "note-archive"
  ) {
    const item = items.find((candidate) => candidate.id === protectedItemId);
    store.setItems(
      items.filter((candidate) => candidate.id !== protectedItemId),
      evidenceFolders,
      EVIDENCE_DATE,
    );
    store.setArchivedItems(item ? [item] : []);
  } else if (
    evidenceState === "login-trash" ||
    evidenceState === "login-workflow-detail-trashed" ||
    evidenceState === "card-trash" ||
    evidenceState === "identity-trash" ||
    evidenceState === "note-trash"
  ) {
    const item = items.find((candidate) => candidate.id === protectedItemId);
    store.setItems(
      items.filter((candidate) => candidate.id !== protectedItemId),
      evidenceFolders,
      EVIDENCE_DATE,
    );
    store.setDeletedItems(item ? [item] : []);
  }
}

function applyRecoveryEvidenceState(
  store: PopupStateStore,
  evidenceState: VaultMainEvidenceState,
): void {
  const active = recoveryItems(evidenceState);
  const folders = evidenceState === "folders-empty" ? [] : recoveryFolders;
  store.setItems(active, folders, EVIDENCE_DATE);
  if (["archive-list", "archive-menu", "recovery-operation-error"].includes(evidenceState)) {
    store.setItems([], folders, EVIDENCE_DATE);
    store.setArchivedItems(active);
  } else if (["trash-list", "trash-menu", "trash-permanent-delete-confirmation"].includes(evidenceState)) {
    store.setItems([], folders, EVIDENCE_DATE);
    store.setDeletedItems(active);
  } else if (evidenceState === "archive-empty") {
    store.setArchivedItems([]);
  } else if (evidenceState === "trash-empty") {
    store.setDeletedItems([]);
  }
}

function recoveryItems(evidenceState: VaultMainEvidenceState): readonly VaultItem[] {
  const history = evidenceState === "password-history-empty"
    ? []
    : [
        { password: recoveryHistoryValue(0), lastUsedDate: "2026-07-10T08:09:10.000Z" },
        { password: recoveryHistoryValue(1), lastUsedDate: "2026-06-28T06:07:08.000Z" },
      ];
  return [
    { ...recoveryItem("calendar", "login", "Example Recovery Login", "login.example.test", false, "m10-work", "https://login.example.test"), passwordHistory: history, reprompt: evidenceState === "password-history-reprompt" },
    recoveryItem("m10-card", "card", "Example Recovery Card", "Visa ending 4242", true, "m10-personal"),
    recoveryItem("m10-identity", "identity", "Example Recovery Identity", "identity.example.test", false, "m10-work"),
    recoveryItem("m10-note", "secure-note", "Example Recovery Note", "Synthetic example.test note", false, "m10-personal"),
  ];
}

function recoveryHistoryValue(index: 0 | 1): string {
  return index === 0
    ? String.fromCharCode(77, 49, 48, 45, 72, 105, 115, 116, 111, 114, 121, 45, 65, 33)
    : String.fromCharCode(77, 49, 48, 45, 72, 105, 115, 116, 111, 114, 121, 45, 66, 33);
}

const recoveryFolders = [
  { id: "m10-work", name: "Example Work" },
  { id: "m10-personal", name: "Example Personal" },
] as const;

function recoveryItem(
  id: string,
  type: VaultItemType,
  name: string,
  subtitle: string,
  favorite: boolean,
  folderId: string,
  uri = "",
): VaultItem {
  const item = {
    ...evidenceItem(id, type, name, subtitle, favorite, folderId, uri),
    folderName: recoveryFolders.find((folder) => folder.id === folderId)?.name ?? "",
  };
  return type === "card" && item.card
    ? { ...item, card: { ...item.card, code: "M10-CVC-731" } }
    : item;
}

function personalWorkflowItems(): readonly VaultItem[] {
  return [
    {
      ...evidenceItem("billing", "card", "Example Card", "Visa ending 4242", true, "personal"),
      notes: "Synthetic example.test Card notes",
      fields: [
        { id: "brand", label: "Brand", value: "Visa", type: "text" },
        { id: "cardholder-name", label: "Cardholder", value: "Example Holder", type: "text" },
        { id: "number", label: "Number", value: "4242424242424242", concealed: true, type: "hidden" },
        { id: "exp-month", label: "Expiration month", value: "04", type: "text" },
        { id: "exp-year", label: "Expiration year", value: "2029", type: "text" },
        { id: "code", label: "Security code", value: "C123EXAMPLE", concealed: true, type: "hidden" },
        { id: "card-hidden", label: "Synthetic hidden", value: "card-hidden-example", concealed: true, type: "hidden" },
        { id: "card-linked", label: "Linked number", value: "", type: "linked", linkedId: 305 },
      ],
      card: {
        cardholderName: "Example Holder",
        brand: "Visa",
        number: "4242424242424242",
        expMonth: "04",
        expYear: "2029",
        code: "C123EXAMPLE",
      },
    },
    {
      ...evidenceItem("profile", "identity", "Example Identity", "identity.example.test", false, "work"),
      notes: "Synthetic example.test Identity notes",
      fields: [
        { id: "full-name", label: "Name", value: "Example Identity", type: "text" },
        { id: "username", label: "Username", value: "example-identity", type: "text" },
        { id: "company", label: "Company", value: "Example Test", type: "text" },
        { id: "ssn", label: "Social security number", value: "000-00-0000", concealed: true, type: "hidden" },
        { id: "passport-number", label: "Passport number", value: "P-EXAMPLE-123", concealed: true, type: "hidden" },
        { id: "license-number", label: "License number", value: "L-EXAMPLE-456", type: "text" },
        { id: "email", label: "Email", value: "identity.example.test", type: "text" },
        { id: "phone", label: "Phone", value: "+1 555 0100", type: "text" },
        { id: "address", label: "Address", value: "1 Example Way\nExample City 00000", type: "text" },
        { id: "identity-hidden", label: "Synthetic hidden", value: "identity-hidden-example", concealed: true, type: "hidden" },
        { id: "identity-linked", label: "Linked email", value: "", type: "linked", linkedId: 410 },
      ],
      identity: {
        title: "Mx",
        firstName: "Example",
        middleName: "Test",
        lastName: "Identity",
        username: "example-identity",
        company: "Example Test",
        ssn: "000-00-0000",
        passportNumber: "P-EXAMPLE-123",
        licenseNumber: "L-EXAMPLE-456",
        email: "identity.example.test",
        phone: "+1 555 0100",
        address1: "1 Example Way",
        address2: "",
        address3: "",
        city: "Example City",
        state: "CA",
        postalCode: "00000",
        country: "US",
      },
      canFill: true,
    },
    {
      ...evidenceItem("recovery", "secure-note", "Example Secure Note", "Synthetic note", false, "personal"),
      notes: "Synthetic example.test secure note body",
      fields: [
        { id: "notes", label: "Notes", value: "Synthetic example.test secure note body", type: "text" },
        { id: "note-hidden", label: "Synthetic hidden", value: "note-hidden-example", concealed: true, type: "hidden" },
      ],
      secureNote: { type: 0 },
    },
  ];
}

function workflowItems(evidenceState: VaultMainEvidenceState): readonly VaultItem[] {
  const base = populatedItems.find((item) => item.id === "calendar")!;
  const multipleUri = evidenceState === "login-workflow-detail-multiple-uri";
  const includeCustom = evidenceState === "login-workflow-detail-custom-field";
  const includeTotp = evidenceState === "login-workflow-detail-totp-rollover";
  return [{
    ...base,
    name: evidenceState === "login-workflow-detail-long-text"
      ? "A deliberately long example.test Login title that must wrap without moving retained actions outside the popup"
      : "Example Calendar",
    subtitle: "calendar-user",
    notes: "Sanitized example.test notes used only by deterministic evidence.",
    uris: multipleUri
      ? [
          { id: "calendar-uri-primary", uri: "https://calendar.example.test", matchType: "default" },
          { id: "calendar-uri-admin", uri: "https://admin.example.test", matchType: "host" },
        ]
      : [{ id: "calendar-uri-primary", uri: "https://calendar.example.test", matchType: "default" }],
    fields: [
      { id: "username", label: "Username", value: "calendar-user", type: "text" },
      { id: "password", label: "Password", value: "evidence-password", concealed: true, type: "hidden" },
      ...(includeTotp
        ? [{ id: "otp", label: "OTP", value: "JBSWY3DPEHPK3PXP", type: "totp" as const }]
        : []),
      ...(includeCustom
        ? [{ id: "deployment-region", label: "部署区域", value: "example-region", type: "text" as const }]
        : []),
    ],
    uri: "https://calendar.example.test",
    canLaunch: true,
    canFill: true,
  }];
}

function withPasswordHistoryEvidence(
  items: readonly VaultItem[],
  evidenceState: VaultMainEvidenceState,
): readonly VaultItem[] {
  if (!["login-history", "login-history-empty", "login-history-protected"].includes(evidenceState)) {
    return items;
  }

  const passwordHistory = evidenceState === "login-history-empty"
    ? []
    : [
        { password: "Previous-Example-4821!", lastUsedDate: "2026-07-10T08:09:10.000Z" },
        { password: "Older-Example-1736!", lastUsedDate: "2026-06-28T06:07:08.000Z" },
      ];
  return items.map((item) => item.id === "calendar" ? { ...item, passwordHistory } : item);
}

const EVIDENCE_DATE = new Date("2026-07-12T00:00:00.000Z");
const evidenceFolders = [
  { id: "work", name: "Work" },
  { id: "personal", name: "Personal" },
] as const;

const populatedItems: readonly VaultItem[] = [
  evidenceItem("mail", "login", "Example Mail", "demo-user", true, "work", "https://mail.example.test", true),
  evidenceItem("billing", "card", "Travel Card", "Visa ending 4242", true, "personal"),
  evidenceItem("profile", "identity", "Sample Identity", "Product Team", false, "work"),
  evidenceItem("recovery", "secure-note", "Recovery Notes", "Updated recently", false, "personal"),
  evidenceItem("calendar", "login", "Example Calendar", "calendar-user", false, "work", "https://calendar.example.test"),
  evidenceItem("hosting", "login", "Example Hosting", "ops-user", false, "work", "https://hosting.example.test"),
  evidenceItem("expenses", "card", "Expense Card", "Mastercard ending 1111", false, "work"),
  evidenceItem("address", "identity", "Shipping Identity", "Example City", false, "personal"),
  evidenceItem("handbook", "secure-note", "Team Handbook", "Internal reference", false, "work"),
  evidenceItem("support", "login", "Example Support", "support-user", false, "personal", "https://support.example.test"),
];

const longTextItems: readonly VaultItem[] = [
  evidenceItem(
    "long-entry",
    "login",
    "An intentionally long Vault item name that must remain inside the fixed row without resizing actions",
    "an-intentionally-long-user-label-that-must-ellipsis",
    true,
    "work",
    "https://long-label.example.test",
  ),
  ...populatedItems.slice(1),
];

const largeListItems: readonly VaultItem[] = Array.from({ length: 120 }, (_, index) => {
  const sequence = index + 1;
  return evidenceItem(
    `large-${index}`,
    "login",
    `Synthetic Vault Item ${sequence}`,
    `synthetic-user-${sequence}`,
    sequence % 20 === 0,
    sequence % 2 === 0 ? "work" : "personal",
    `https://item-${sequence}.example.test`,
  );
});

function evidenceItem(
  id: string,
  type: VaultItemType,
  name: string,
  subtitle: string,
  favorite: boolean,
  folderId: string,
  uri = "",
  includeTotp = false,
): VaultItem {
  const card = type === "card"
    ? {
        cardholderName: "Travel User",
        brand: "Visa",
        number: "4111111111111111",
        expMonth: "04",
        expYear: "2029",
        code: "123",
      }
    : undefined;
  const identity = type === "identity"
    ? {
        title: "Dr",
        firstName: "Ada",
        middleName: "Augusta",
        lastName: "Lovelace",
        username: "ada",
        company: "Analytical Engines",
        ssn: "000-00-0000",
        passportNumber: "P1234567",
        licenseNumber: "L7654321",
        email: "ada-example.test",
        phone: "+44 20 0000",
        address1: "12 Engine Lane",
        address2: "Suite 2",
        address3: "Research Park",
        city: "London",
        state: "Greater London",
        postalCode: "N1 1AA",
        country: "United Kingdom",
      }
    : undefined;
  const secureNote = type === "secure-note" ? { type: 0 } : undefined;
  const notes = type === "secure-note" ? "Synthetic recovery instructions" : "";
  return {
    id,
    type,
    name,
    subtitle,
    favorite,
    folderId,
    folderName: evidenceFolders.find((folder) => folder.id === folderId)?.name ?? "",
    organizationName: "",
    attachmentCount: 0,
    uris: uri ? [{ id: `${id}-uri`, uri, matchType: "default" }] : [],
    fields: type === "login"
      ? [
          { id: "username", label: "Username", value: subtitle },
          { id: "password", label: "Password", value: "evidence-password", concealed: true, type: "hidden" },
          ...(includeTotp
            ? [{ id: "otp", label: "OTP", value: "JBSWY3DPEHPK3PXP", type: "totp" as const }]
            : []),
        ]
      : type === "card"
        ? [
            { id: "brand", label: "Brand", value: card!.brand },
            { id: "cardholder-name", label: "Cardholder", value: card!.cardholderName },
            { id: "number", label: "Number", value: card!.number, concealed: true, type: "hidden" },
            { id: "exp-month", label: "Expiration month", value: card!.expMonth },
            { id: "exp-year", label: "Expiration year", value: card!.expYear },
            { id: "code", label: "Security code", value: card!.code, concealed: true, type: "hidden" },
          ]
        : type === "secure-note"
          ? [{ id: "notes", label: "Notes", value: notes }]
          : type === "identity"
            ? [{ id: "email", label: "Email", value: identity!.email }]
          : [],
    ...(card ? { card } : {}),
    ...(identity ? { identity } : {}),
    ...(secureNote ? { secureNote } : {}),
    createdDate: EVIDENCE_DATE.toISOString(),
    revisionDate: EVIDENCE_DATE.toISOString(),
    notes,
    canLaunch: type === "login" && Boolean(uri),
    canFill: type === "login" || type === "identity",
    uri,
  };
}
