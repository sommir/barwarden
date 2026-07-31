import type { PopupStateStore } from "../popup-state";
import type { VaultItem } from "../vault/vault-item.model";
import type { VaultMainEvidenceState } from "../vault/vault-main-evidence-state";
import type {
  LoginCipherCreateDraft,
  VaultCipherWritePort,
} from "../vault/vault-cipher-write.service";

const workflowPrefix = "login-workflow-";

export function createLoginWorkflowEvidenceHost(state: VaultMainEvidenceState) {
  const shouldFail = state === "login-workflow-detail-action-failure";
  const action = async (name: "copy_text" | "paste_text" | "open_url") => {
    if (shouldFail) {
      throw new Error("Synthetic evidence action failure");
    }
    recordAction(name);
  };
  return {
    showPopup: async () => undefined,
    hidePopup: async () => undefined,
    copyText: async () => action("copy_text"),
    pasteText: async () => action("paste_text"),
    openUrl: async () => action("open_url"),
    secureGet: async () => null,
    secureSet: async () => undefined,
    secureDelete: async () => undefined,
    getAccountLockIntents: async () => [],
    setAccountLockIntents: async () => undefined,
  };
}

export function createLoginWorkflowEvidenceWritePort(
  state: VaultMainEvidenceState,
  store: PopupStateStore,
): Pick<VaultCipherWritePort, "createLoginCipher" | "updateLoginCipher"> {
  return {
    createLoginCipher: async (_session, draft) => {
      await evidenceWriteDelay(state);
      if (state === "login-workflow-form-save-failure") {
        throw new Error("Synthetic evidence save failure");
      }
      recordAction("create_login");
      return evidenceItem("evidence-created-login", draft);
    },
    updateLoginCipher: async (_session, item, draft) => {
      await evidenceWriteDelay(state);
      if (state === "login-workflow-form-save-failure") {
        throw new Error("Synthetic evidence save failure");
      }
      recordAction("update_login");
      if (state === "login-workflow-form-stale") {
        const snapshot = store.snapshot();
        store.setItems(
          snapshot.items.map((candidate) => candidate === item ? { ...candidate } : candidate),
          snapshot.folders,
          snapshot.lastSyncDate ?? new Date("2026-07-15T00:00:00.000Z"),
        );
      }
      return evidenceItem(item.id, draft, item);
    },
  };
}

export function isLoginWorkflowEvidenceState(state: VaultMainEvidenceState): boolean {
  return state.startsWith(workflowPrefix);
}

function evidenceWriteDelay(state: VaultMainEvidenceState): Promise<void> {
  return state === "login-workflow-form-duplicate"
    ? new Promise((resolve) => setTimeout(resolve, 150))
    : Promise.resolve();
}

function recordAction(action: string): void {
  const root = document.documentElement;
  root.dataset.bwEvidenceLastHostAction = action;
  const count = Number(root.dataset.bwEvidenceHostActionCount ?? "0") + 1;
  root.dataset.bwEvidenceHostActionCount = String(count);
}

function evidenceItem(
  id: string,
  draft: LoginCipherCreateDraft,
  original?: VaultItem,
): VaultItem {
  const now = "2026-07-15T12:00:00.000Z";
  return {
    id,
    type: "login",
    name: draft.name,
    subtitle: draft.username,
    favorite: draft.favorite ?? original?.favorite ?? false,
    ...(draft.reprompt ? { reprompt: true } : {}),
    folderId: draft.folderId ?? "",
    folderName: draft.folderId === "work" ? "Work" : "",
    organizationName: original?.organizationName ?? "",
    attachmentCount: original?.attachmentCount ?? 0,
    ...(original?.attachments ? { attachments: original.attachments } : {}),
    uris: (draft.uris ?? (draft.uri ? [{ uri: draft.uri, matchType: "default" }] : []))
      .map((entry, index) => ({ id: `${id}-uri-${index}`, ...entry })),
    fields: [
      { id: "username", label: "Username", value: draft.username, type: "text" },
      { id: "password", label: "Password", value: draft.password, concealed: true, type: "hidden" },
      ...(draft.totp ? [{ id: "otp", label: "OTP", value: draft.totp, type: "totp" as const }] : []),
      ...(draft.fields ?? []).map((field, index) => ({
        id: `${id}-field-${index}`,
        label: field.name,
        value: field.value,
        type: field.type === 1 ? "hidden" as const : field.type === 2 ? "boolean" as const : "text" as const,
        ...(field.type === 1 ? { concealed: true } : {}),
      })),
    ],
    createdDate: original?.createdDate ?? now,
    revisionDate: now,
    notes: draft.notes,
    canLaunch: Boolean(draft.uri || draft.uris?.length),
    canFill: true,
    uri: draft.uri || draft.uris?.[0]?.uri || "",
  };
}
