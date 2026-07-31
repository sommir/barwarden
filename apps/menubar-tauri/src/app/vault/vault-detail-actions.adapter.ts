import type { Router } from "@angular/router";

import type { AppFeedbackService } from "../official-ui/app-feedback.service";
import { PopupStateStore, type PopupState } from "../popup-state";
import type { VaultField, VaultItem } from "../vault-demo";
import {
  VaultActionsService,
  type VaultMutationNotCommitted,
  type VaultRemovalMutationOutcome,
} from "./vault-actions.service";
import type { VaultItemLocation } from "./vault.facade";

export type DetailAction =
  | {
      readonly kind: "copy" | "fill";
      readonly field: VaultField;
      readonly onComplete?: (outcome: DetailActionReceipt) => void;
    }
  | { readonly kind: "launch"; readonly uri: string }
  | { readonly kind: "archive" | "unarchive" | "trash" | "restore" | "delete-forever" };

export interface DetailActionReceipt {
  readonly committed: boolean;
  readonly status: string;
  readonly terminal: boolean;
}

export type DetailRepromptRequest = (
  itemId: string,
  continuation: () => Promise<void>,
) => boolean;

export type DetailUiRunner = <T>(operation: () => Promise<T>) => Promise<T>;

interface DetailActionContext {
  readonly activeSession: PopupState["activeSession"];
  readonly email: string;
  readonly epoch: number;
  readonly isUnlocked: boolean;
  readonly item: VaultItem;
  readonly location: VaultItemLocation;
  readonly route: string;
  readonly serverUrl: string;
}

export class VaultDetailActionsAdapter {
  private epoch = 0;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly store: PopupStateStore,
    private readonly router: Router,
    private readonly actions: VaultActionsService,
    private readonly requestReprompt?: DetailRepromptRequest,
    private readonly runInUi: DetailUiRunner = (operation) => operation(),
    private readonly feedback?: AppFeedbackService,
  ) {}

  async run(item: VaultItem, action: DetailAction): Promise<DetailActionReceipt> {
    const context = this.capture(item);
    if (!context || !this.ownsAction(context, action)) {
      return this.complete(action, notCommitted("Vault changed; action not applied."));
    }

    if (item.reprompt && isProtected(action)) {
      if (!this.requestReprompt) {
        return this.complete(action, notCommitted("Unable to verify master password."));
      }
      const requested = this.requestReprompt(item.id, () => this.execute(context, action));
      return requested
        ? notCommitted("Verification required.")
        : this.complete(action, notCommitted("Unable to verify master password."));
    }

    return this.execute(context, action);
  }

  invalidate(): void {
    this.epoch += 1;
    this.inFlight.clear();
  }

  captureGuard(item: VaultItem): () => boolean {
    const context = this.capture(item);
    return () => Boolean(context && this.isCurrent(context));
  }

  private async execute(
    context: DetailActionContext,
    action: DetailAction,
  ): Promise<DetailActionReceipt> {
    if (!this.isCurrent(context) || !this.ownsAction(context, action)) {
      return this.complete(action, notCommitted("Vault changed; action not applied."));
    }

    const actionKey = this.actionKey(context, action);
    if (this.inFlight.has(actionKey)) {
      return this.complete(action, notCommitted("Action already in progress."));
    }

    this.inFlight.add(actionKey);
    try {
      if (action.kind === "copy" || action.kind === "fill" || action.kind === "launch") {
        const isCurrent = () => this.isCurrent(context);
        const outcome = action.kind === "copy"
          ? await this.actions.copyFieldWithOutcome(action.field, isCurrent)
          : action.kind === "fill"
            ? await this.actions.fillFieldWithOutcome(action.field, isCurrent)
            : await this.actions.launchUriWithOutcome(action.uri, isCurrent);
        if (!outcome.committed) {
          if (outcome.reason !== "stale" && this.isCurrent(context)) {
            this.store.setStatus(outcome.status);
          }
          return this.complete(action, notCommitted(outcome.status));
        }

        if (this.isCurrent(context)) {
          this.store.setStatus(outcome.status);
          this.feedback?.show(outcome.status, { kind: "success" });
        }
        return this.complete(action, { committed: true, status: outcome.status, terminal: false });
      }

      const outcome = await this.runLifecycle(context, action.kind);
      if (!outcome.committed) {
        return this.complete(action, this.commitNotCommitted(context, outcome));
      }
      const canCommitCurrentUi = outcome.result.item === context.item &&
        this.isContextCurrent(context) &&
        this.currentItemAt(context.location, context.item.id) === undefined;
      if (canCommitCurrentUi) {
        this.store.setStatus(outcome.status);
        this.feedback?.show(outcome.status, { kind: "success" });
      }

      const returnRoute = action.kind === "restore" &&
        this.currentItemAt("archived", context.item.id) === context.item
        ? "/archive"
        : routeForLocation(context.location);
      this.invalidate();
      if (canCommitCurrentUi) {
        try {
          await this.runInUi(() => this.router.navigateByUrl(returnRoute));
        } catch {
          // The server mutation remains committed even when local navigation fails.
        }
      }
      return this.complete(action, { committed: true, status: outcome.status, terminal: true });
    } finally {
      this.inFlight.delete(actionKey);
    }
  }

  private runLifecycle(
    context: DetailActionContext,
    kind: Extract<DetailAction, { kind: "archive" | "unarchive" | "trash" | "restore" | "delete-forever" }>["kind"],
  ): Promise<VaultRemovalMutationOutcome> {
    const isCurrent = () => this.isCurrent(context);
    if (kind === "archive") {
      return this.actions.archiveItemWithOutcome(context.item, isCurrent);
    }
    if (kind === "unarchive") {
      return this.actions.unarchiveItemWithOutcome(context.item, isCurrent);
    }
    if (kind === "restore") {
      return this.actions.restoreDeletedItemWithOutcome(context.item, isCurrent);
    }
    if (kind === "delete-forever") {
      return this.actions.permanentlyDeleteItemWithOutcome(context.item, isCurrent);
    }
    return context.location === "archived"
      ? this.actions.deleteArchivedItemWithOutcome(context.item, isCurrent)
      : this.actions.deleteItemWithOutcome(context.item, isCurrent);
  }

  private commitNotCommitted(
    context: DetailActionContext,
    outcome: VaultMutationNotCommitted,
  ): DetailActionReceipt {
    if (outcome.reason !== "stale" && this.isCurrent(context)) {
      this.store.setStatus(outcome.status);
    }
    return notCommitted(outcome.status);
  }

  private capture(item: VaultItem): DetailActionContext | undefined {
    const state = this.store.snapshot();
    const location = locationOf(state, item);
    if (!state.isUnlocked || !location) {
      return undefined;
    }
    return {
      activeSession: state.activeSession,
      email: state.email,
      epoch: this.epoch,
      isUnlocked: state.isUnlocked,
      item,
      location,
      route: this.router.url,
      serverUrl: state.serverUrl,
    };
  }

  private isCurrent(context: DetailActionContext): boolean {
    return this.isContextCurrent(context) &&
      this.currentItemAt(context.location, context.item.id) === context.item;
  }

  private isContextCurrent(context: DetailActionContext): boolean {
    const state = this.store.snapshot();
    return this.epoch === context.epoch &&
      this.router.url === context.route &&
      state.isUnlocked === context.isUnlocked &&
      state.isUnlocked &&
      state.activeSession === context.activeSession &&
      state.email === context.email &&
      state.serverUrl === context.serverUrl;
  }

  private ownsAction(context: DetailActionContext, action: DetailAction): boolean {
    if (action.kind === "copy" || action.kind === "fill") {
      if (action.kind === "fill" && (context.location !== "active" || !context.item.canFill)) {
        return false;
      }
      return ownsField(context.item, action.field, action.kind);
    }
    if (action.kind === "launch") {
      return context.item.type === "login" &&
        context.item.uris.some(({ uri }) => uri === action.uri);
    }
    return actionLocation(action.kind, context.location);
  }

  private actionKey(context: DetailActionContext, action: DetailAction): string {
    if (action.kind === "copy" || action.kind === "fill") {
      return `${context.item.id}:${action.kind}:${action.field.id}`;
    }
    return `${context.item.id}:${action.kind}`;
  }

  private complete(action: DetailAction, outcome: DetailActionReceipt): DetailActionReceipt {
    action.onComplete?.(outcome);
    return outcome;
  }

  private currentItemAt(location: VaultItemLocation, itemId: string): VaultItem | undefined {
    const state = this.store.snapshot();
    return itemsAt(state, location).find((candidate) => candidate.id === itemId);
  }
}

function isProtected(action: DetailAction): boolean {
  if (action.kind !== "copy" && action.kind !== "fill") {
    return action.kind !== "launch";
  }
  return action.field.id === "password" ||
    action.field.id === "otp" ||
    action.field.type === "hidden" ||
    action.field.concealed === true;
}

function ownsField(item: VaultItem, field: VaultField, kind: "copy" | "fill"): boolean {
  if (!field.value || item.fields.includes(field)) {
    return Boolean(field.value);
  }
  if (kind === "copy" && field.id === "notes" && isNotesOwner(item.type)) {
    return field.value === item.notes;
  }
  if (item.type !== "login" || !field.id.startsWith("uri:")) {
    return false;
  }
  const index = Number(field.id.slice(4));
  return Number.isInteger(index) && index >= 0 && item.uris[index]?.uri === field.value;
}

function isNotesOwner(type: VaultItem["type"]): boolean {
  return type === "login" || type === "card" || type === "identity" || type === "secure-note";
}

function actionLocation(kind: DetailAction["kind"], location: VaultItemLocation): boolean {
  if (kind === "archive") {
    return location === "active";
  }
  if (kind === "unarchive") {
    return location === "archived";
  }
  if (kind === "trash") {
    return location === "active" || location === "archived";
  }
  return location === "deleted";
}

function locationOf(state: PopupState, item: VaultItem): VaultItemLocation | undefined {
  for (const location of ["active", "archived", "deleted"] as const) {
    if (itemsAt(state, location).some((candidate) => candidate === item)) {
      return location;
    }
  }
  return undefined;
}

function itemsAt(state: PopupState, location: VaultItemLocation): readonly VaultItem[] {
  return location === "active"
    ? state.items
    : location === "archived" ? state.archivedItems : state.deletedItems;
}

function routeForLocation(location: VaultItemLocation): string {
  return location === "active" ? "/tabs/vault" : location === "archived" ? "/archive" : "/trash";
}

function notCommitted(status: string): DetailActionReceipt {
  return { committed: false, status, terminal: false };
}
