import type { PopupStateStore } from "../popup-state";
import type {
  CardCipherDraft,
  CipherCustomFieldInput,
  IdentityCipherDraft,
  SecureNoteCipherDraft,
} from "../vault/personal-cipher-draft";
import type { VaultItem } from "../vault/vault-item.model";
import type { VaultMainEvidenceState } from "../vault/vault-main-evidence-state";
import type { VaultCipherWritePort } from "../vault/vault-cipher-write.service";

export const personalCipherEvidenceStates = [
  "card-detail",
  "card-detail-reprompt",
  "card-form-add",
  "card-form-edit",
  "card-form-clone",
  "identity-detail",
  "identity-detail-reprompt",
  "identity-form-add",
  "identity-form-edit",
  "identity-form-clone",
  "note-detail",
  "note-form-add",
  "note-form-edit",
  "note-form-clone",
  "personal-form-validation",
  "personal-form-failure",
  "personal-form-duplicate",
  "personal-form-stale",
] as const;

export type PersonalCipherEvidenceState = (typeof personalCipherEvidenceStates)[number];

const personalCipherEvidenceStateSet: ReadonlySet<string> = new Set(personalCipherEvidenceStates);
const evidenceDate = "2026-07-17T12:00:00.000Z";

export function isPersonalCipherEvidenceState(
  state: VaultMainEvidenceState,
): state is PersonalCipherEvidenceState {
  return personalCipherEvidenceStateSet.has(state);
}

export function isPersonalCipherFormEvidenceState(
  state: VaultMainEvidenceState,
): state is PersonalCipherEvidenceState {
  return isPersonalCipherEvidenceState(state) && state.includes("-form-");
}

export function createPersonalCipherWorkflowEvidenceHost(state: PersonalCipherEvidenceState) {
  const type = evidenceType(state);
  return {
    showPopup: async () => undefined,
    hidePopup: async () => undefined,
    copyText: async () => recordAction(
      type === "card"
        ? "copy_card_number"
        : type === "identity" ? "copy_identity_email" : "copy_secure_note_notes",
    ),
    pasteText: async () => recordAction(
      type === "card"
        ? "paste_card_number"
        : type === "identity" ? "paste_identity_email" : "paste_secure_note_notes",
    ),
    openUrl: async () => undefined,
    secureGet: async () => null,
    secureSet: async () => undefined,
    secureDelete: async () => undefined,
    getAccountLockIntents: async () => [],
    setAccountLockIntents: async () => undefined,
  };
}

export function createPersonalCipherWorkflowEvidenceWritePort(
  state: PersonalCipherEvidenceState,
  store: PopupStateStore,
): Pick<
  VaultCipherWritePort,
  | "createCardCipher"
  | "updateCardCipher"
  | "createIdentityCipher"
  | "updateIdentityCipher"
  | "createSecureNoteCipher"
  | "updateSecureNoteCipher"
> {
  return {
    createCardCipher: async (_session, draft) => evidenceWrite(
      state,
      store,
      "create_card",
      () => cardItem("m9-created-card", draft),
    ),
    updateCardCipher: async (_session, item, draft) => evidenceWrite(
      state,
      store,
      "update_card",
      () => cardItem(item.id, state === "card-form-edit" ? serverCardEdit(draft) : draft, item),
    ),
    createIdentityCipher: async (_session, draft) => evidenceWrite(
      state,
      store,
      "create_identity",
      () => identityItem("m9-created-identity", draft),
    ),
    updateIdentityCipher: async (_session, item, draft) => evidenceWrite(
      state,
      store,
      "update_identity",
      () => identityItem(
        item.id,
        state === "identity-form-edit" ? serverIdentityEdit(draft) : draft,
        item,
      ),
    ),
    createSecureNoteCipher: async (_session, draft) => evidenceWrite(
      state,
      store,
      "create_secure_note",
      () => secureNoteItem("m9-created-secure-note", draft),
    ),
    updateSecureNoteCipher: async (_session, item, draft) => evidenceWrite(
      state,
      store,
      "update_secure_note",
      () => secureNoteItem(
        item.id,
        state === "note-form-edit" ? serverSecureNoteEdit(draft) : draft,
        item,
      ),
    ),
  };
}

async function evidenceWrite(
  state: PersonalCipherEvidenceState,
  store: PopupStateStore,
  action: string,
  createItem: () => VaultItem,
): Promise<VaultItem> {
  if (state === "personal-form-failure") {
    throw new Error("Synthetic personal evidence save failure");
  }
  if (state === "personal-form-duplicate") {
    await waitForPersonalWriteRelease();
  }
  const item = createItem();
  recordAction(action);
  if (state === "personal-form-stale") {
    const snapshot = store.snapshot();
    store.setItems(
      snapshot.items.map((candidate) => ({ ...candidate })),
      snapshot.folders,
      snapshot.lastSyncDate ?? new Date(evidenceDate),
    );
  }
  return item;
}

async function waitForPersonalWriteRelease(): Promise<void> {
  const root = document.documentElement;
  root.dataset.bwEvidenceTransportPending = "true";
  root.dataset.bwEvidenceTransportCallCount = String(
    Number(root.dataset.bwEvidenceTransportCallCount ?? "0") + 1,
  );
  try {
    await new Promise<void>((resolve) => {
      document.addEventListener("bw-evidence-release-personal-write", () => resolve(), { once: true });
    });
  } finally {
    delete root.dataset.bwEvidenceTransportPending;
  }
}

function serverCardEdit(draft: CardCipherDraft): CardCipherDraft {
  return {
    ...draft,
    name: "Server-confirmed Card example.test",
    cardholderName: "Server Cardholder Example",
  };
}

function serverIdentityEdit(draft: IdentityCipherDraft): IdentityCipherDraft {
  return {
    ...draft,
    name: "Server-confirmed Identity example.test",
    title: "",
    firstName: "Server",
    middleName: "",
    lastName: "Identity Example",
  };
}

function serverSecureNoteEdit(draft: SecureNoteCipherDraft): SecureNoteCipherDraft {
  return {
    ...draft,
    name: "Server-confirmed Secure Note example.test",
    notes: "Server-confirmed synthetic note body example.test",
  };
}

function evidenceType(
  state: PersonalCipherEvidenceState,
): "card" | "identity" | "secure-note" {
  if (state.startsWith("identity")) return "identity";
  if (state.startsWith("note")) return "secure-note";
  return "card";
}

function recordAction(action: string): void {
  const root = document.documentElement;
  root.dataset.bwEvidenceLastHostAction = action;
  root.dataset.bwEvidenceHostActionCount = String(
    Number(root.dataset.bwEvidenceHostActionCount ?? "0") + 1,
  );
}

function cardItem(id: string, draft: CardCipherDraft, original?: VaultItem): VaultItem {
  const number = draft.number.trim();
  return {
    id,
    type: "card",
    name: draft.name.trim(),
    subtitle: number ? `•••• ${number.slice(-4)}` : "支付卡",
    favorite: draft.favorite ?? original?.favorite ?? false,
    ...(draft.reprompt ?? original?.reprompt ? { reprompt: true } : {}),
    folderId: draft.folderId ?? original?.folderId ?? "",
    folderName: folderName(draft.folderId ?? original?.folderId),
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    fields: [
      field("brand", "Brand", draft.brand ?? ""),
      field("cardholder-name", "Cardholder", draft.cardholderName),
      field("number", "Number", number, "hidden"),
      field("exp-month", "Expiration month", draft.expMonth),
      field("exp-year", "Expiration year", draft.expYear),
      field("code", "Security code", draft.code, "hidden"),
      ...customFields(draft.fields),
    ].filter((candidate) => candidate.value.length > 0 || candidate.type === "linked"),
    createdDate: original?.createdDate ?? evidenceDate,
    revisionDate: evidenceDate,
    card: {
      cardholderName: draft.cardholderName.trim(),
      brand: draft.brand?.trim() ?? "",
      number,
      expMonth: draft.expMonth.trim(),
      expYear: draft.expYear.trim(),
      code: draft.code.trim(),
    },
    notes: draft.notes.trim(),
    canLaunch: false,
    canFill: false,
    uri: "",
  };
}

function identityItem(
  id: string,
  draft: IdentityCipherDraft,
  original?: VaultItem,
): VaultItem {
  const identity = {
    title: draft.title?.trim() ?? "",
    firstName: draft.firstName.trim(),
    middleName: draft.middleName?.trim() ?? "",
    lastName: draft.lastName.trim(),
    username: draft.username?.trim() ?? "",
    company: draft.company?.trim() ?? "",
    ssn: draft.ssn?.trim() ?? "",
    passportNumber: draft.passportNumber?.trim() ?? "",
    licenseNumber: draft.licenseNumber?.trim() ?? "",
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    address1: draft.address1.trim(),
    address2: draft.address2?.trim() ?? "",
    address3: draft.address3?.trim() ?? "",
    city: draft.city?.trim() ?? "",
    state: draft.state?.trim() ?? "",
    postalCode: draft.postalCode?.trim() ?? "",
    country: draft.country?.trim() ?? "",
  };
  const fullName = [identity.title, identity.firstName, identity.middleName, identity.lastName]
    .filter(Boolean)
    .join(" ");
  const address = [
    identity.address1,
    identity.address2,
    identity.address3,
    [identity.city, identity.state, identity.postalCode].filter(Boolean).join(" "),
    identity.country,
  ].filter(Boolean).join("\n");
  return {
    id,
    type: "identity",
    name: draft.name.trim(),
    subtitle: identity.email || fullName || "身份",
    favorite: draft.favorite ?? original?.favorite ?? false,
    ...(draft.reprompt ?? original?.reprompt ? { reprompt: true } : {}),
    folderId: draft.folderId ?? original?.folderId ?? "",
    folderName: folderName(draft.folderId ?? original?.folderId),
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    fields: [
      field("full-name", "Name", fullName),
      field("username", "Username", identity.username),
      field("company", "Company", identity.company),
      field("ssn", "Social security number", identity.ssn, "hidden"),
      field("passport-number", "Passport number", identity.passportNumber, "hidden"),
      field("license-number", "License number", identity.licenseNumber),
      field("email", "Email", identity.email),
      field("phone", "Phone", identity.phone),
      field("address", "Address", address),
      ...customFields(draft.fields),
    ].filter((candidate) => candidate.value.length > 0 || candidate.type === "linked"),
    createdDate: original?.createdDate ?? evidenceDate,
    revisionDate: evidenceDate,
    identity,
    notes: draft.notes.trim(),
    canLaunch: false,
    canFill: true,
    uri: "",
  };
}

function secureNoteItem(
  id: string,
  draft: SecureNoteCipherDraft,
  original?: VaultItem,
): VaultItem {
  return {
    id,
    type: "secure-note",
    name: draft.name.trim(),
    subtitle: "Secure note",
    favorite: draft.favorite ?? original?.favorite ?? false,
    ...(draft.reprompt ?? original?.reprompt ? { reprompt: true } : {}),
    folderId: draft.folderId ?? original?.folderId ?? "",
    folderName: folderName(draft.folderId ?? original?.folderId),
    organizationName: "",
    attachmentCount: 0,
    uris: [],
    fields: [
      ...customFields(draft.fields),
      ...(draft.notes.trim() ? [field("notes", "Notes", draft.notes.trim())] : []),
    ],
    createdDate: original?.createdDate ?? evidenceDate,
    revisionDate: evidenceDate,
    secureNote: { type: draft.noteType ?? original?.secureNote?.type ?? 0 },
    notes: draft.notes.trim(),
    canLaunch: false,
    canFill: false,
    uri: "",
  };
}

function field(
  id: string,
  label: string,
  value: string,
  type: "text" | "hidden" = "text",
): VaultItem["fields"][number] {
  return {
    id,
    label,
    value: value.trim(),
    type,
    ...(type === "hidden" ? { concealed: true } : {}),
  };
}

function customFields(
  values: readonly CipherCustomFieldInput[] | undefined,
): VaultItem["fields"] {
  return (values ?? []).map((candidate, index) => ({
    id: `custom:${index}`,
    label: candidate.name,
    value: candidate.type === 2 ? String(candidate.value === true) :
      candidate.type === 3 ? "" : String(candidate.value ?? ""),
    type: candidate.type === 1 ? "hidden" as const :
      candidate.type === 2 ? "boolean" as const :
        candidate.type === 3 ? "linked" as const : "text" as const,
    ...(candidate.type === 1 ? { concealed: true } : {}),
    ...(candidate.type === 3 ? { linkedId: candidate.linkedId } : {}),
  }));
}

function folderName(folderId: string | undefined): string {
  return folderId === "work" ? "Work" : folderId === "personal" ? "Personal" : "";
}
