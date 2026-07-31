import type { AuthSession } from "../../auth/auth-session-store";
import { buildSelfHostedEnvironmentFromServerUrl } from "../../bitwarden-api/bitwarden-api";
import type { HostApi } from "../../host/host-api";
import { PopupStateStore } from "../popup-state";
import type { SendActionPort, TextSendCreateDraft } from "./send-actions.service";
import type { SendItem } from "./send-item.model";
import type { SendEvidenceState } from "./send-evidence-state";

type SendEvidenceFailure = { readonly kind: "send-evidence-failure" };

const evidenceMutationFailure: SendEvidenceFailure = Object.freeze({
  kind: "send-evidence-failure",
});

export function applySendEvidenceState(store: PopupStateStore, state: SendEvidenceState): void {
  store.setServerUrl("https://send-fixture.invalid");
  store.setUnlocked("m12-local-fixture");
  store.setActiveSession(evidenceSession);

  if (state === "list-loading") {
    store.setSyncing(true);
    return;
  }

  if (state !== "list-empty" && state !== "form-add") {
    store.setSends([evidenceSend]);
  }
  if (state === "list-disabled") {
    store.setSendDisabled(true);
  }
}

export function sendEvidenceRoute(state: SendEvidenceState): string {
  if (state === "view" || state === "form-edit" || state === "mutation-error") {
    return "/edit-send?sendId=m12-text-send&type=text";
  }
  if (state === "form-add") return "/add-send?type=text";
  if (state === "created") return "/send-created?sendId=m12-text-send&type=text";
  return "/tabs/send";
}

export function createSendEvidenceActionPort(state: SendEvidenceState): SendActionPort {
  let current: SendItem = evidenceSend;
  let pendingUpdate: (() => void) | undefined;
  let failNext = state === "mutation-error";

  const record = (action: string) => {
    const root = globalThis.document?.documentElement;
    if (!root) return;
    const actions = root.dataset.bwEvidenceSendActions?.split(",").filter(Boolean) ?? [];
    root.dataset.bwEvidenceSendActions = [...actions, action].join(",");
  };
  const failIfRequested = () => {
    if (!failNext) return;
    failNext = false;
    record("mutation-error");
    throw evidenceMutationFailure;
  };

  globalThis.__bwReleaseSendStaleResult = () => pendingUpdate?.();
  globalThis.__bwResetSendEvidenceFixture = () => {
    current = evidenceSend;
    pendingUpdate = undefined;
    failNext = false;
    record("cleanup");
  };

  return {
    async createTextSend(_session: AuthSession, draft: TextSendCreateDraft): Promise<SendItem> {
      failIfRequested();
      record("create");
      current = sendFromDraft("m12-created-send", "m12-created-access", draft);
      return current;
    },
    async updateTextSend(
      _session: AuthSession,
      send: SendItem,
      draft: TextSendCreateDraft,
    ): Promise<SendItem> {
      failIfRequested();
      record("update");
      const updated = sendFromDraft(send.id, send.accessId, draft, send);
      if (draft.name === "Stale local result") {
        await new Promise<void>((resolve) => { pendingUpdate = resolve; });
        record("stale-result-released");
      }
      current = updated;
      return updated;
    },
    async deleteSend(): Promise<void> {
      failIfRequested();
      record("delete");
    },
    async removePassword(): Promise<void> {
      failIfRequested();
      record("password-remove");
      current = { ...current, hasPassword: false, password: undefined };
    },
    async refreshTextSend(): Promise<SendItem> {
      record("refresh");
      return current;
    },
  };
}

export function createSendEvidenceHost(): HostApi {
  return {
    showPopup: async () => undefined,
    hidePopup: async () => undefined,
    copyText: async () => recordHostAction("copy"),
    pasteText: async () => recordHostAction("paste"),
    openUrl: async () => recordHostAction("open-url"),
    secureGet: async () => null,
    secureSet: async () => undefined,
    secureDelete: async () => undefined,
    getAccountLockIntents: async () => [],
    setAccountLockIntents: async () => undefined,
  };
}

export const evidenceSend: SendItem = {
  id: "m12-text-send",
  accessId: "m12-text-access",
  urlB64Key: "local-link-material",
  type: "text",
  name: "Release instructions",
  text: "Deterministic example text for local verification.",
  hidden: true,
  hideEmail: true,
  notes: "Reserved example notes",
  revisionDate: "2026-07-19T00:00:00.000Z",
  deletionDate: "2026-07-26T00:00:00.000Z",
  disabled: false,
  maxAccessCount: 3,
  accessCount: 1,
  hasPassword: true,
};

const evidenceSession: AuthSession = {
  environment: buildSelfHostedEnvironmentFromServerUrl("https://send-fixture.invalid"),
  token: {
    accessToken: "",
    refreshToken: "",
    tokenType: "",
    expiresIn: 0,
  },
  crypto: { userKeyB64: "opaque-local-session-material" },
};

function sendFromDraft(
  id: string,
  accessId: string,
  draft: TextSendCreateDraft,
  source?: SendItem,
): SendItem {
  return {
    ...evidenceSend,
    ...source,
    id,
    accessId,
    name: draft.name,
    text: draft.text,
    notes: draft.notes,
    deletionDate: draft.deletionDate,
    hidden: Boolean(draft.hidden),
    hideEmail: Boolean(draft.hideEmail),
    maxAccessCount: draft.maxAccessCount,
    hasPassword: Boolean(draft.password || source?.hasPassword),
    revisionDate: "2026-07-19T04:00:00.000Z",
  };
}

function recordHostAction(action: string): void {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  const actions = root.dataset.bwEvidenceSendActions?.split(",").filter(Boolean) ?? [];
  root.dataset.bwEvidenceSendActions = [...actions, action].join(",");
}

declare global {
  var __bwReleaseSendStaleResult: (() => void) | undefined;
  var __bwResetSendEvidenceFixture: (() => void) | undefined;
}
