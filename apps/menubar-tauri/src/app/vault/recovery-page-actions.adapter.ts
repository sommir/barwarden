import type { OnDestroy } from "@angular/core";
import type { Router } from "@angular/router";

import type { AppFeedbackService } from "../official-ui/app-feedback.service";
export type {
  RecoveryCommand,
  RecoveryLocation,
  RecoveryPageActionResult,
  RecoveryPageCommand,
} from "../upstream-overlays/recovery/recovery-command";
import type {
  RecoveryCommand,
  RecoveryLocation,
  RecoveryPageActionResult,
  RecoveryPageCommand,
} from "../upstream-overlays/recovery/recovery-command";
import type { VaultItem } from "../vault-demo";
import {
  resolveRetainedPopupCipherSource,
  toRecoveryPopupCipherView,
  type RetainedPopupCipherView,
} from "./popup-cipher-view.adapter";

export type RecoveryRepromptRequest = (
  itemId: string,
  continuation: () => Promise<void>,
) => boolean;

export type RecoveryConfirmationRequest = (
  command: Extract<RecoveryCommand, "soft-delete" | "permanent-delete">,
  item: RetainedPopupCipherView,
  continuation: () => Promise<RecoveryPageActionResult>,
  trigger?: HTMLElement,
) => boolean;

interface RecoveryActionContext {
  readonly activeSession: unknown;
  readonly email: string;
  readonly epoch: number;
  readonly item: RetainedPopupCipherView;
  readonly location: RecoveryLocation;
  readonly route: string;
  readonly serverUrl: string;
  readonly source: VaultItem;
  readonly trigger?: HTMLElement;
}

export class RecoveryPageActionsAdapter implements OnDestroy {
  private destroyed = false;
  private epoch = 0;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly store: RecoveryStatePort,
    private readonly router: Router,
    private readonly actions: RecoveryLifecycleActionsPort,
    private readonly requestReprompt?: RecoveryRepromptRequest,
    private readonly requestConfirmation?: RecoveryConfirmationRequest,
    private readonly feedback?: AppFeedbackService,
  ) {}

  async execute(command: RecoveryPageCommand): Promise<RecoveryPageActionResult> {
    const context = this.capture(command);
    if (!context) {
      return staleResult();
    }
    return this.executeCurrent(context, command.command, false, false);
  }

  invalidate(): void {
    this.epoch += 1;
    this.inFlight.clear();
  }

  ngOnDestroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.invalidate();
  }

  private async executeCurrent(
    context: RecoveryActionContext,
    command: RecoveryCommand,
    repromptPassed: boolean,
    confirmationPassed: boolean,
  ): Promise<RecoveryPageActionResult> {
    if (!this.isCurrent(context) || !ownsCommand(context.location, command)) {
      return staleResult();
    }

    if (context.item.reprompt && !repromptPassed) {
      if (!this.requestReprompt) {
        return result(false, "Unable to verify master password.");
      }
      const requested = this.requestReprompt(context.source.id, () =>
        this.executeCurrent(context, command, true, confirmationPassed).then((): void => undefined));
      return requested ? result(false, "Verification required.")
        : result(false, "Unable to verify master password.");
    }
    if (isConfirmationCommand(command) && !confirmationPassed) {
      if (!this.requestConfirmation) return result(false, "Action cancelled.");
      const requested = this.requestConfirmation(
        command, context.item,
        () => this.executeCurrent(context, command, true, true),
        context.trigger,
      );
      return requested ? result(false, "Confirmation required.") : result(false, "Action cancelled.");
    }

    const key = `${context.location}:${context.source.id}:${command}`;
    if (this.inFlight.has(key)) {
      return result(false, "Action already in progress.");
    }
    this.inFlight.add(key);
    try {
      if (command === "view") {
        await this.router.navigateByUrl(`/view-cipher/${context.source.id}`);
        return result(false, "");
      }
      if (command === "edit" || command === "clone") {
        const type = cipherTypeQuery[context.source.type];
        if (!type) {
          return staleResult();
        }
        await this.router.navigate([command === "edit" ? "/edit-cipher" : "/clone-cipher"], {
          queryParams: { cipherId: context.source.id, type },
        });
        return result(false, "");
      }

      const outcome = await this.runLifecycle(context, command);
      if ("reason" in outcome) {
        return this.notCommitted(
          context,
          outcome,
          confirmationPassed && isConfirmationCommand(command),
        );
      }
      if (outcome.result.item !== context.source || !this.isContextCurrent(context)) {
        return staleResult();
      }

      const targetRoute = command === "restore" &&
        this.store.snapshot().archivedItems.some((candidate) => candidate === context.source)
        ? "/archive"
        : context.route;
      this.store.setStatus(outcome.status);
      this.feedback?.show(outcome.status, { kind: "success" });
      this.invalidate();
      try {
        await this.router.navigateByUrl(targetRoute);
      } catch {
        // A committed server mutation remains terminal when route refresh fails.
      }
      return result(true, outcome.status);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private runLifecycle(
    context: RecoveryActionContext,
    command: RecoveryCommand,
  ): Promise<RecoveryMutationOutcome> {
    const isCurrent = () => this.isCurrent(context);
    if (command === "unarchive") {
      return this.actions.unarchiveItemWithOutcome(context.source, isCurrent);
    }
    if (command === "soft-delete") {
      return this.actions.deleteArchivedItemWithOutcome(context.source, isCurrent);
    }
    if (command === "restore") {
      return this.actions.restoreDeletedItemWithOutcome(context.source, isCurrent);
    }
    return this.actions.permanentlyDeleteItemWithOutcome(context.source, isCurrent);
  }

  private notCommitted(
    context: RecoveryActionContext,
    outcome: RecoveryMutationNotCommitted,
    confirmationOwnsFeedback: boolean,
  ): RecoveryPageActionResult {
    if (
      !confirmationOwnsFeedback
      && outcome.reason !== "stale"
      && this.isCurrent(context)
    ) {
      this.store.setStatus(outcome.status);
    }
    return result(false, outcome.status, outcome.reason);
  }

  private capture(command: RecoveryPageCommand): RecoveryActionContext | undefined {
    const expectedRoute = command.location === "archive" ? "/archive" : "/trash";
    const state = this.store.snapshot();
    const projectedSource = resolveRetainedPopupCipherSource(command.item);
    const source = currentItems(state, command.location)
      .find((candidate) => candidate === projectedSource);
    if (
      this.destroyed ||
      !state.isUnlocked ||
      this.router.url !== expectedRoute ||
      !source ||
      toRecoveryPopupCipherView(source) !== command.item ||
      !ownsCommand(command.location, command.command)
    ) {
      return undefined;
    }
    return {
      activeSession: state.activeSession,
      email: state.email,
      epoch: this.epoch,
      item: command.item,
      location: command.location,
      route: expectedRoute,
      serverUrl: state.serverUrl,
      source,
      trigger: command.trigger,
    };
  }

  private isCurrent(context: RecoveryActionContext): boolean {
    return this.isContextCurrent(context) &&
      currentItems(this.store.snapshot(), context.location)
        .some((candidate) => candidate === context.source) &&
      resolveRetainedPopupCipherSource(context.item) === context.source &&
      toRecoveryPopupCipherView(context.source) === context.item;
  }

  private isContextCurrent(context: RecoveryActionContext): boolean {
    const state = this.store.snapshot();
    return !this.destroyed &&
      this.epoch === context.epoch &&
      this.router.url === context.route &&
      state.isUnlocked &&
      state.activeSession === context.activeSession &&
      state.email === context.email &&
      state.serverUrl === context.serverUrl;
  }
}

function currentItems(state: RecoveryStateSnapshot, location: RecoveryLocation): readonly VaultItem[] {
  return location === "archive" ? state.archivedItems : state.deletedItems;
}

function ownsCommand(location: RecoveryLocation, command: RecoveryCommand): boolean {
  return location === "archive"
    ? ["view", "edit", "clone", "unarchive", "soft-delete"].includes(command)
    : ["view", "restore", "permanent-delete"].includes(command);
}

function isConfirmationCommand(
  command: RecoveryCommand,
): command is Extract<RecoveryCommand, "soft-delete" | "permanent-delete"> {
  return command === "soft-delete" || command === "permanent-delete";
}

function result(
  terminal: boolean,
  status: string,
  reason?: RecoveryPageActionResult["reason"],
): RecoveryPageActionResult {
  return reason ? { terminal, status, reason } : { terminal, status };
}

function staleResult(): RecoveryPageActionResult {
  return result(false, "Vault changed; action not applied.", "stale");
}

const cipherTypeQuery: Partial<Record<VaultItem["type"], string>> = {
  login: "1",
  "secure-note": "2",
  card: "3",
  identity: "4",
};

interface RecoveryStateSnapshot {
  readonly activeSession: unknown;
  readonly archivedItems: readonly VaultItem[];
  readonly deletedItems: readonly VaultItem[];
  readonly email: string;
  readonly isUnlocked: boolean;
  readonly serverUrl: string;
}

interface RecoveryStatePort {
  snapshot(): RecoveryStateSnapshot;
  setStatus(status: string): void;
}

interface RecoveryMutationCommitted {
  readonly committed: true;
  readonly status: string;
  readonly result: {
    readonly kind: "removed";
    readonly item: VaultItem;
  };
}

interface RecoveryMutationNotCommitted {
  readonly committed: false;
  readonly reason: "duplicate" | "failure" | "stale";
  readonly status: string;
}

type RecoveryMutationOutcome = RecoveryMutationCommitted | RecoveryMutationNotCommitted;

interface RecoveryLifecycleActionsPort {
  unarchiveItemWithOutcome(
    item: VaultItem,
    isCurrent: () => boolean,
  ): Promise<RecoveryMutationOutcome>;
  deleteArchivedItemWithOutcome(
    item: VaultItem,
    isCurrent: () => boolean,
  ): Promise<RecoveryMutationOutcome>;
  restoreDeletedItemWithOutcome(
    item: VaultItem,
    isCurrent: () => boolean,
  ): Promise<RecoveryMutationOutcome>;
  permanentlyDeleteItemWithOutcome(
    item: VaultItem,
    isCurrent: () => boolean,
  ): Promise<RecoveryMutationOutcome>;
}
