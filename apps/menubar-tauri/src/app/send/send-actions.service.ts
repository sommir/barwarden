import { InjectionToken } from "@angular/core";

import type { AuthSession } from "../../auth/auth-session-store";
import { BitwardenApiClient, type HttpTransport } from "../../bitwarden-api/bitwarden-api";
import { TauriHostService } from "../../host/tauri-host.service";
import type { SendItem } from "./send-item.model";
import { buildTextSendCreateRequest, buildTextSendUpdateRequest } from "./send-request.service";
import { textSendFromSyncResponse } from "./text-send-sync-projection";

export interface TextSendCreateDraft {
  readonly name: string;
  readonly text: string;
  readonly notes: string;
  readonly authType?: "none" | "password";
  readonly password?: string;
  readonly maxAccessCount?: number;
  readonly hidden?: boolean;
  readonly hideEmail?: boolean;
  readonly deletionDate: string;
}

export interface SendActionPort {
  createTextSend(session: AuthSession, draft: TextSendCreateDraft): Promise<SendItem>;
  updateTextSend(session: AuthSession, send: SendItem, draft: TextSendCreateDraft): Promise<SendItem>;
  deleteSend(session: AuthSession, send: SendItem): Promise<void>;
  removePassword(session: AuthSession, send: SendItem): Promise<void>;
  refreshTextSend(session: AuthSession, sendId: string): Promise<SendItem>;
}

export const SEND_ACTION_PORT = new InjectionToken<SendActionPort | null>("SEND_ACTION_PORT", {
  providedIn: "root",
  factory: () => null,
});

export class BitwardenSendActions implements SendActionPort {
  private readonly api: BitwardenApiClient;

  constructor(
    session: AuthSession,
    transport: HttpTransport = new TauriHostService(),
  ) {
    this.api = new BitwardenApiClient(session.environment, transport);
  }

  async createTextSend(session: AuthSession, draft: TextSendCreateDraft): Promise<SendItem> {
    if (!session.crypto?.userKeyB64) {
      throw new Error("Missing Bitwarden user key for Send encryption");
    }

    const buildResult = await buildTextSendCreateRequest({
      userKeyB64: session.crypto.userKeyB64,
      name: draft.name,
      text: draft.text,
      notes: draft.notes,
      authType: draft.authType,
      password: draft.password,
      maxAccessCount: draft.maxAccessCount,
      hidden: draft.hidden,
      hideEmail: draft.hideEmail,
      deletionDate: draft.deletionDate,
    });
    const response = await this.api.postSend<unknown>(
      buildResult.request,
      session.token.accessToken,
    );

    return sendItemFromTextResponse(response, draft, buildResult.urlB64Key);
  }

  async updateTextSend(
    session: AuthSession,
    send: SendItem,
    draft: TextSendCreateDraft,
  ): Promise<SendItem> {
    assertTextSend(send);
    if (!session.crypto?.userKeyB64) {
      throw new Error("Missing Bitwarden user key for Send encryption");
    }
    if (!send.urlB64Key) {
      throw new Error("Missing Bitwarden Send key for update");
    }

    const buildResult = await buildTextSendUpdateRequest({
      userKeyB64: session.crypto.userKeyB64,
      urlB64Key: send.urlB64Key,
      name: draft.name,
      text: draft.text,
      notes: draft.notes,
      authType: draft.authType,
      password: draft.password,
      preservePassword: Boolean(send.hasPassword && draft.authType !== "none" && !draft.password),
      maxAccessCount: draft.maxAccessCount,
      deletionDate: draft.deletionDate,
      existingDeletionDate: send.deletionDate,
      hidden: draft.hidden,
      hideEmail: draft.hideEmail,
    });
    const response = await this.api.putSend<unknown>(
      send.id,
      buildResult.request,
      session.token.accessToken,
    );

    return sendItemFromTextResponse(response, draft, buildResult.urlB64Key, send);
  }

  async deleteSend(session: AuthSession, send: SendItem): Promise<void> {
    assertTextSend(send);
    await this.api.deleteSend<void>(send.id, session.token.accessToken);
  }

  async removePassword(session: AuthSession, send: SendItem): Promise<void> {
    assertTextSend(send);
    await this.api.putSendRemovePassword<void>(send.id, session.token.accessToken);
  }

  async refreshTextSend(session: AuthSession, sendId: string): Promise<SendItem> {
    const response = await this.api.getSync(session.token.accessToken);
    const refreshed = await textSendFromSyncResponse(response, session.crypto?.userKeyB64, sendId);
    if (!refreshed || refreshed.hasPassword || refreshed.password) {
      throw new Error("Bitwarden Send refresh did not reconcile password removal");
    }
    return refreshed;
  }
}

function sendItemFromTextResponse(
  response: unknown,
  draft: TextSendCreateDraft,
  urlB64Key: string,
  fallback?: SendItem,
): SendItem {
  const record = isRecord(response) ? response : {};
  const now = new Date().toISOString();
  const id = stringProperty(record, "Id") || stringProperty(record, "id") || fallback?.id;
  const accessId = stringProperty(record, "AccessId") || stringProperty(record, "accessId") || fallback?.accessId;
  if (!id || !accessId) {
    throw new Error("Bitwarden Send create response did not include an id and access id");
  }

  return {
    id,
    accessId,
    urlB64Key,
    type: "text",
    name: draft.name,
    text: draft.text,
    ...(draft.hidden ? { hidden: true } : {}),
    ...(draft.hideEmail ? { hideEmail: true } : {}),
    notes: draft.notes,
    ...(draft.authType === "none"
      ? {}
      : draft.password || fallback?.hasPassword
        ? { hasPassword: true }
        : {}),
    ...(draft.maxAccessCount == null ? {} : { maxAccessCount: draft.maxAccessCount }),
    revisionDate: stringProperty(record, "RevisionDate") || stringProperty(record, "revisionDate") || now,
    deletionDate: stringProperty(record, "DeletionDate") || stringProperty(record, "deletionDate") || fallback?.deletionDate || now,
    disabled: booleanProperty(record, "Disabled") || booleanProperty(record, "disabled"),
    accessCount: numberProperty(record, "AccessCount") ?? numberProperty(record, "accessCount") ?? 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringProperty(value: Record<string, unknown>, name: string): string {
  const property = value[name];
  return typeof property === "string" ? property : "";
}

function booleanProperty(value: Record<string, unknown>, name: string): boolean {
  return value[name] === true;
}

function numberProperty(value: Record<string, unknown>, name: string): number | undefined {
  const property = value[name];
  return typeof property === "number" ? property : undefined;
}

function assertTextSend(send: SendItem): void {
  if (send.type !== "text") {
    throw new Error("File Send mutations are excluded");
  }
}
