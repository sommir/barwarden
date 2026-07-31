import type { AuthSession } from "../../auth/auth-session-store";
import { PopupStateStore } from "../popup-state";
import type { SendActionPort } from "./send-actions.service";
import type { SendItem } from "./send-item.model";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

export interface TextSendDraft {
  readonly name: string;
  readonly text: string;
  readonly notes: string;
  readonly authType?: "none" | "password";
  readonly deletionDate: string;
  readonly hidden: boolean;
  readonly hideEmail: boolean;
  readonly maxAccessCount?: number;
  readonly password?: string;
}

export type TextSendOperationResult =
  | { readonly committed: true; readonly send?: SendItem }
  | { readonly committed: false; readonly reason: "duplicate" | "stale" | "failure" };

export interface TextSendOperationOwnership {
  readonly token: symbol;
  readonly operationEpoch: number;
  readonly protectedOperationEpoch: number;
  readonly routeUrl: string;
  readonly session: AuthSession;
  readonly accountEmail: string;
  readonly serverUrl: string;
  readonly sends: readonly SendItem[];
  readonly source?: SendItem;
}

export interface TextSendOperationNavigation {
  currentUrl(): string;
}

export interface TextSendOperationDependencies {
  readonly store: PopupStateStore;
  readonly actions: SendActionPort;
  readonly navigation: TextSendOperationNavigation;
}

export class TextSendOperation {
  private operationEpoch = 0;
  private operationToken: symbol | null = null;
  private committing = false;

  constructor(private readonly dependencies: TextSendOperationDependencies) {}

  get pending(): boolean {
    return this.operationToken !== null;
  }

  get isCommitting(): boolean {
    return this.committing;
  }

  invalidate(): void {
    this.operationEpoch += 1;
    this.operationToken = null;
  }

  create(draft: TextSendDraft): Promise<TextSendOperationResult> {
    return this.run(
      draft,
      undefined,
      (owner) => this.dependencies.actions.createTextSend(owner.session, draft),
      (send) => {
        if (send) this.dependencies.store.saveSend(send);
        return send;
      },
    );
  }

  update(source: SendItem, draft: TextSendDraft): Promise<TextSendOperationResult> {
    return this.run(
      draft,
      source,
      (owner) => this.dependencies.actions.updateTextSend(owner.session, source, draft),
      (send) => {
        if (send) this.dependencies.store.saveSend(send);
        return send;
      },
    );
  }

  delete(source: SendItem): Promise<TextSendOperationResult> {
    return this.run(
      undefined,
      source,
      async (owner) => {
        await this.dependencies.actions.deleteSend(owner.session, source);
        return undefined;
      },
      () => {
        this.dependencies.store.deleteSend(source.id);
        return undefined;
      },
    );
  }

  removePassword(source: SendItem): Promise<TextSendOperationResult> {
    return this.run(
      undefined,
      source,
      async (owner) => {
        await this.dependencies.actions.removePassword(owner.session, source);
        if (!this.isCurrent(owner)) {
          throw staleOperation;
        }
        return this.dependencies.actions.refreshTextSend(owner.session, source.id);
      },
      (send) => {
        if (!send || send.id !== source.id || send.type !== "text") {
          throw new Error("Invalid refreshed Text Send");
        }
        this.dependencies.store.saveSend(send);
        return send;
      },
    );
  }

  private async run(
    draft: TextSendDraft | undefined,
    source: SendItem | undefined,
    transport: (owner: TextSendOperationOwnership) => Promise<SendItem | undefined>,
    commit: (send: SendItem | undefined) => SendItem | undefined,
  ): Promise<TextSendOperationResult> {
    if (this.operationToken !== null) {
      return duplicateResult;
    }
    if (source?.type !== undefined && source.type !== "text") {
      return this.failure();
    }
    if (draft && !validDraft(draft, source?.deletionDate)) {
      return this.failure();
    }

    const ownership = this.capture(source);
    if (!ownership) {
      return this.failure();
    }
    this.operationToken = ownership.token;
    if (!this.isCurrent(ownership)) {
      this.clear(ownership);
      return staleResult;
    }

    try {
      const send = await transport(ownership);
      if (!this.isCurrent(ownership)) {
        return staleResult;
      }
      this.committing = true;
      const committedSend = commit(send);
      this.committing = false;
      return { committed: true, ...(committedSend ? { send: committedSend } : {}) };
    } catch {
      if (!this.isCurrent(ownership)) {
        return staleResult;
      }
      return this.failure();
    } finally {
      this.committing = false;
      this.clear(ownership);
    }
  }

  private capture(source: SendItem | undefined): TextSendOperationOwnership | undefined {
    const state = this.dependencies.store.snapshot();
    const session = state.activeSession;
    if (!state.isUnlocked || !session?.crypto?.userKeyB64 || (source && !state.sends.includes(source))) {
      return undefined;
    }
    return {
      token: Symbol("text-send-operation"),
      operationEpoch: ++this.operationEpoch,
      protectedOperationEpoch: this.dependencies.store.beginProtectedOperation(),
      routeUrl: this.dependencies.navigation.currentUrl(),
      session,
      accountEmail: state.email,
      serverUrl: state.serverUrl,
      sends: state.sends,
      ...(source ? { source } : {}),
    };
  }

  private isCurrent(owner: TextSendOperationOwnership): boolean {
    const state = this.dependencies.store.snapshot();
    return this.operationToken === owner.token &&
      this.operationEpoch === owner.operationEpoch &&
      this.dependencies.store.isCurrentProtectedOperation(owner.protectedOperationEpoch) &&
      this.dependencies.navigation.currentUrl() === owner.routeUrl &&
      state.isUnlocked &&
      state.activeSession === owner.session &&
      state.email === owner.accountEmail &&
      state.serverUrl === owner.serverUrl &&
      state.sends === owner.sends &&
      (!owner.source || state.sends.find(({ id }) => id === owner.source?.id) === owner.source);
  }

  private clear(owner: TextSendOperationOwnership): void {
    if (this.operationToken === owner.token) {
      this.operationToken = null;
    }
  }

  private failure(): TextSendOperationResult {
    this.dependencies.store.setStatus(translateOfficialMessage("i18nUnableToSaveSend"));
    return failureResult;
  }
}

function validDraft(draft: TextSendDraft, existingDeletionDate: string | undefined): boolean {
  const timestamp = Date.parse(draft.deletionDate);
  return Number.isFinite(timestamp) &&
    (draft.deletionDate === existingDeletionDate || timestamp > Date.now());
}

const duplicateResult = { committed: false, reason: "duplicate" } as const;
const staleResult = { committed: false, reason: "stale" } as const;
const failureResult = { committed: false, reason: "failure" } as const;
const staleOperation = new Error("Stale Text Send operation");
