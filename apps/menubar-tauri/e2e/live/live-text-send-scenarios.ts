import type { AuthSession } from "../../src/auth/auth-session-store";
import type { BitwardenApiClient } from "../../src/bitwarden-api/bitwarden-api";
import type { PopupStateStore } from "../../src/app/popup-state";
import type { BitwardenSendActions } from "../../src/app/send/send-actions.service";
import type { SendItem } from "../../src/app/send/send-item.model";
import type { SendLinkBuilder } from "../../src/app/send/send-created-page.component";
import { TextSendOperation, type TextSendDraft } from "../../src/app/send/text-send-operation";
import type { VaultSyncResult } from "../../src/vault/vault-sync.service";
import {
  assertLiveCleanup,
  runLiveMutation,
  type LiveRunContext,
  type LiveStageResult,
} from "./live-test-protocol";

type LiveTextSendApi = Pick<BitwardenApiClient, "getSync" | "deleteSend">;

export interface LiveTextSendDependencies {
  readonly session: AuthSession;
  readonly api: LiveTextSendApi;
  readonly actions: Pick<BitwardenSendActions, keyof BitwardenSendActions>;
  readonly store: Pick<PopupStateStore, "saveSend">;
  readonly operation: TextSendOperation;
  readonly context: LiveRunContext;
  readonly linkBuilder: Pick<SendLinkBuilder, "linkFor">;
  readonly clipboard: {
    copyText(value: string): Promise<void>;
    copyCallCount(): number;
  };
  readonly transportGuard: Pick<LiveTextSendTransportGuard, "protectFileSendIds">;
  readonly syncProjection: () => Promise<VaultSyncResult>;
  assertGeneratedArtifactAbsence(): void;
}

export async function runTextSendScenario(
  deps: LiveTextSendDependencies,
  onStage?: (stage: "file-send-non-interference") => void,
): Promise<readonly LiveStageResult[]> {
  let fileIdsBefore: ReadonlySet<string> = new Set();
  let created: SendItem | undefined;
  let createdId = "";
  let directlyDeleted = false;
  let textSendCompleted = false;

  const directDelete = async () => {
    if (!createdId || directlyDeleted) return;
    await deps.api.deleteSend<void>(createdId, deps.session.token.accessToken);
    directlyDeleted = true;
  };

  const textResult = await runLiveMutation(deps.context, "text-send", [], async () => {
    fileIdsBefore = fileSendIds(await deps.api.getSync(deps.session.token.accessToken));
    deps.transportGuard.protectFileSendIds(fileIdsBefore);

    const requestedCreate = createDraft(deps.context.prefix);
    created = await deps.actions.createTextSend(deps.session, requestedCreate);
    createdId = created.id;
    deps.context.cleanup.register("send", directDelete);
    deps.context.track("send", createdId, requestedCreate.name);
    if (created.type !== "text") {
      throw new Error("Live Text Send create did not complete");
    }
    deps.store.saveSend(created);

    await assertTextSendState(deps, createdId, requestedCreate, false, "Live Text Send create sync did not complete");

    const requestedUpdate = updateDraft(deps.context.prefix);
    const contentUpdate = await deps.operation.update(created, requestedUpdate);
    created = committedTextSend(contentUpdate, createdId);
    await assertTextSendState(
      deps,
      createdId,
      requestedUpdate,
      false,
      "Live Text Send content sync did not complete",
    );

    const requestedPassword = passwordDraft(deps.context.prefix);
    const passwordUpdate = await deps.operation.update(created, requestedPassword);
    created = committedTextSend(passwordUpdate, createdId);
    await assertTextSendState(
      deps,
      createdId,
      requestedPassword,
      true,
      "Live Text Send password sync did not complete",
    );

    const passwordRemoval = await deps.operation.removePassword(created);
    created = committedTextSend(passwordRemoval, createdId);
    if (created.hasPassword || created.password) {
      throw new Error("Live Text Send password refresh did not complete");
    }
    await assertTextSendState(
      deps,
      createdId,
      requestedPassword,
      false,
      "Live Text Send password refresh did not complete",
    );

    const link = deps.linkBuilder.linkFor(created);
    assertCreatedTextSendLink(link, deps.session, created);
    await deps.clipboard.copyText(link);
    if (deps.clipboard.copyCallCount() !== 1) {
      throw new Error("Live Text Send link copy did not complete");
    }

    const deletion = await deps.operation.delete(created);
    if (!deletion.committed) {
      throw new Error("Live Text Send delete did not complete");
    }
    directlyDeleted = true;
    textSendCompleted = true;
  }, async () => {
    if (textSendCompleted) onStage?.("file-send-non-interference");
    const sync = await deps.api.getSync(deps.session.token.accessToken);
    const fileIdsAfter = fileSendIds(sync);
    if (!sameIds(fileIdsBefore, fileIdsAfter)) {
      throw new Error("Live File Send snapshot changed");
    }
    const projection = await deps.syncProjection();
    assertLiveCleanup(sync, projection, deps.context);
    deps.assertGeneratedArtifactAbsence();
  });

  return [
    textResult,
    {
      service: deps.context.service,
      mode: deps.context.mode,
      stage: "file-send-non-interference",
      status: "passed",
    },
  ];
}

export function fileSendIds(sync: unknown): ReadonlySet<string> {
  if (!isRecord(sync)) throw new Error("Live File Send snapshot is malformed");
  const keys = ["Sends", "sends"].filter((key) => Object.hasOwn(sync, key));
  if (keys.length === 0 || keys.some((key) => !Array.isArray(sync[key]))) {
    throw new Error("Live File Send snapshot is malformed");
  }

  const ids = new Set<string>();
  for (const key of keys) {
    for (const entry of sync[key] as unknown[]) {
      if (!isRecord(entry)) throw new Error("Live File Send snapshot is malformed");
      const type = matchingProperty(entry, "Type", "type");
      if (typeof type !== "number") throw new Error("Live File Send snapshot is malformed");
      if (type !== 1) continue;
      const id = matchingProperty(entry, "Id", "id");
      if (typeof id !== "string" || !id.trim()) {
        throw new Error("Live File Send snapshot is malformed");
      }
      ids.add(id);
    }
  }
  return ids;
}

export class LiveTextSendTransportGuard {
  private protectedFileIds: ReadonlySet<string> = new Set();

  protectFileSendIds(ids: ReadonlySet<string>): void {
    this.protectedFileIds = new Set(ids);
  }

  assertAllowed(url: string, init: RequestInit): void {
    let pathSegments: string[];
    try {
      pathSegments = new URL(url).pathname.split("/").filter(Boolean);
    } catch {
      throw new Error("Live Text Send transport did not complete");
    }

    const sendsIndex = pathSegments.lastIndexOf("sends");
    if (sendsIndex < 0) return;
    const sendPath = pathSegments.slice(sendsIndex + 1);
    if (sendPath.some((segment) => segment.toLowerCase() === "file")) {
      throwFileSendTransportError();
    }

    const method = (init.method ?? "GET").toUpperCase();
    const targetId = decodedPathSegment(sendPath[0]);
    if (
      targetId &&
      this.protectedFileIds.has(targetId) &&
      (method === "PUT" || method === "DELETE")
    ) {
      throwFileSendTransportError();
    }

    const isSharedMutation =
      (method === "POST" || method === "PUT") &&
      sendPath.length <= 1;
    if (isSharedMutation) {
      assertTextOnlySendBody(init.body);
    }
  }
}

function createDraft(prefix: string): TextSendDraft {
  return {
    name: `${prefix} Text Send`,
    text: "isolated live Text Send",
    notes: "",
    authType: "none",
    deletionDate: futureDeletionDate(),
    hidden: false,
    hideEmail: false,
  };
}

function updateDraft(prefix: string): TextSendDraft {
  return {
    ...createDraft(prefix),
    name: `${prefix} Text Send updated`,
    text: "isolated live Text Send updated",
    maxAccessCount: 3,
  };
}

function passwordDraft(prefix: string): TextSendDraft {
  return {
    ...updateDraft(prefix),
    authType: "password",
    password: `${prefix}-password`,
  };
}

function committedTextSend(
  result: Awaited<ReturnType<TextSendOperation["create"]>>,
  expectedId: string,
): SendItem {
  if (
    !result.committed ||
    !result.send ||
    result.send.type !== "text" ||
    result.send.id !== expectedId
  ) {
    throw new Error("Live Text Send operation did not complete");
  }
  return result.send;
}

async function assertTextSendState(
  deps: LiveTextSendDependencies,
  id: string,
  expected: Pick<TextSendDraft, "text" | "maxAccessCount">,
  hasPassword: boolean,
  message: string,
): Promise<void> {
  await deps.api.getSync(deps.session.token.accessToken);
  const projection = await deps.syncProjection();
  const send = projection.sends.find((candidate) => candidate.id === id);
  if (
    !send ||
    send.type !== "text" ||
    send.text !== expected.text ||
    send.maxAccessCount !== expected.maxAccessCount ||
    Boolean(send.hasPassword || send.password) !== hasPassword
  ) {
    throw new Error(message);
  }
}

function assertCreatedTextSendLink(link: string, session: AuthSession, send: SendItem): void {
  const configured = session.environment.sendUrl;
  if (!configured || !send.urlB64Key) throw new Error("Live Text Send link did not complete");
  let base: URL;
  let parsed: URL;
  try {
    base = new URL(configured);
    parsed = new URL(link);
  } catch {
    throw new Error("Live Text Send link did not complete");
  }
  const basePath = base.pathname.replace(/\/$/, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.host !== base.host ||
    !parsed.pathname.startsWith(`${basePath}/`) ||
    parsed.hash !== `#/send/${send.accessId}/${send.urlB64Key}`
  ) {
    throw new Error("Live Text Send link did not complete");
  }
}

function futureDeletionDate(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function assertTextOnlySendBody(body: BodyInit | null | undefined): void {
  if (typeof body !== "string") throwFileSendTransportError();
  let request: unknown;
  try {
    request = JSON.parse(body);
  } catch {
    throwFileSendTransportError();
  }
  if (!isRecord(request)) throwFileSendTransportError();

  const types = [request["Type"], request["type"]].filter((value) => value !== undefined);
  const files = [request["File"], request["file"]].filter((value) => value !== undefined);
  if (
    types.some((value) => value === 1) ||
    files.some((value) => value !== null) ||
    Object.hasOwn(request, "FileLength") ||
    Object.hasOwn(request, "fileLength")
  ) {
    throwFileSendTransportError();
  }
}

function decodedPathSegment(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("Live Text Send transport did not complete");
  }
}

function throwFileSendTransportError(): never {
  throw new Error("Live Text Send transport called a File Send endpoint");
}

function matchingProperty(record: Record<string, unknown>, pascalCase: string, camelCase: string): unknown {
  const values = [record[pascalCase], record[camelCase]].filter((value) => value !== undefined);
  if (values.length > 1 && values[0] !== values[1]) {
    throw new Error("Live File Send snapshot is malformed");
  }
  return values[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
