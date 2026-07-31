import type { OnDestroy } from "@angular/core";
import type { Router } from "@angular/router";

import type { AppFeedbackService } from "../official-ui/app-feedback.service";
import { PopupStateStore, type PopupState } from "../popup-state";
import type { VaultField, VaultItem } from "../vault-demo";
import {
  VaultActionsService,
  type VaultMutationNotCommitted,
  type VaultRemovalMutationOutcome,
} from "./vault-actions.service";
import { VaultSessionService } from "./vault-session.service";

export class VaultRowActionsAdapter implements OnDestroy {
  private destroyed = false;
  private lifecycleEpoch = 0;
  private navigationOperation = 0;

  constructor(
    private readonly store: PopupStateStore,
    private readonly router: Router,
    private readonly actions: VaultActionsService,
    private readonly session: VaultSessionService,
    private readonly feedback?: AppFeedbackService,
  ) {}

  async view(item: VaultItem): Promise<void> {
    const context = this.capture(item);
    if (!this.isCurrent(context)) {
      return;
    }
    const operation = ++this.navigationOperation;
    await this.router.navigateByUrl(`/view-cipher/${item.id}`);
    if (!this.isCurrentNavigation(operation, context)) {
      return;
    }
  }

  async edit(item: VaultItem): Promise<void> {
    await this.navigateToCipher("/edit-cipher", item);
  }

  async clone(item: VaultItem): Promise<void> {
    await this.navigateToCipher("/clone-cipher", item);
  }

  async copy(item: VaultItem, field: VaultField): Promise<string | null> {
    if (!this.isOwnedField(item, field)) {
      return null;
    }
    return this.commitAction(item, () => this.actions.copyField(field));
  }

  async fill(item: VaultItem, field: VaultField): Promise<string | null> {
    if (!this.isOwnedField(item, field)) {
      return null;
    }
    return this.commitAction(item, () => this.actions.fillField(field));
  }

  async launch(item: VaultItem): Promise<void> {
    await this.commitAction(item, () => this.actions.launchItem(item));
  }

  async favorite(item: VaultItem): Promise<void> {
    const context = this.capture(item);
    if (!this.isCurrent(context)) {
      return;
    }
    const outcome = await this.actions.toggleFavoriteWithOutcome(
      item,
      () => this.isCurrent(context),
    );
    if (!outcome.committed) {
      this.commitNotCommitted(context, outcome);
      return;
    }
    if (
      this.isContextCurrent(context) &&
      this.currentItem(item.id) === outcome.result.item
    ) {
      this.store.setStatus(outcome.status);
    }
  }

  async archive(item: VaultItem): Promise<void> {
    await this.commitRemoval(
      item,
      (isCurrent) => this.actions.archiveItemWithOutcome(item, isCurrent),
    );
  }

  async delete(item: VaultItem): Promise<void> {
    await this.commitRemoval(
      item,
      (isCurrent) => this.actions.deleteItemWithOutcome(item, isCurrent),
    );
  }

  async retrySync(): Promise<void> {
    const context = this.capture();
    if (!this.isCurrent(context)) {
      return;
    }
    await this.session.syncNow(() => this.isCurrent(context));
  }

  ngOnDestroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.lifecycleEpoch += 1;
    this.navigationOperation += 1;
  }

  captureGuard(item: VaultItem): () => boolean {
    const context = this.capture(item);
    return () => this.isCurrent(context);
  }

  private async navigateToCipher(route: "/edit-cipher" | "/clone-cipher", item: VaultItem): Promise<void> {
    const context = this.capture(item);
    const type = CIPHER_QUERY_TYPES[item.type];
    if (!type || !this.isCurrent(context)) {
      return;
    }
    const operation = ++this.navigationOperation;
    await this.router.navigate([route], { queryParams: { cipherId: item.id, type } });
    if (!this.isCurrentNavigation(operation, context)) {
      return;
    }
  }

  private async commitAction(
    item: VaultItem,
    action: () => Promise<string>,
  ): Promise<string | null> {
    const context = this.capture(item);
    if (!this.isCurrent(context)) {
      return null;
    }
    const status = await action();
    if (this.isCurrent(context)) {
      this.store.setStatus(status);
      this.feedback?.show(status, { kind: "success" });
      return status;
    }
    return null;
  }

  private async commitRemoval(
    item: VaultItem,
    action: (isCurrent: () => boolean) => Promise<VaultRemovalMutationOutcome>,
  ): Promise<void> {
    const context = this.capture(item);
    if (!this.isCurrent(context)) {
      return;
    }
    const outcome = await action(() => this.isCurrent(context));
    if (!outcome.committed) {
      this.commitNotCommitted(context, outcome);
      return;
    }
    if (outcome.result.item === item && this.isCurrent(context, true)) {
      this.store.setStatus(outcome.status);
      this.feedback?.show(outcome.status, { kind: "success" });
    }
  }

  private commitNotCommitted(
    context: VaultActionContext,
    outcome: VaultMutationNotCommitted,
  ): void {
    if (outcome.reason !== "stale" && this.isCurrent(context)) {
      this.store.setStatus(outcome.status);
    }
  }

  private isOwnedField(item: VaultItem, field: VaultField): boolean {
    return field.value.length > 0 && item.fields.includes(field) && this.currentItem(item.id) === item;
  }

  private capture(item?: VaultItem): VaultActionContext {
    const state = this.store.snapshot();
    return {
      activeSession: state.activeSession,
      email: state.email,
      isUnlocked: state.isUnlocked,
      item,
      lifecycleEpoch: this.lifecycleEpoch,
      route: this.router.url,
    };
  }

  private isCurrent(context: VaultActionContext, allowRemovedItem = false): boolean {
    if (!this.isContextCurrent(context)) {
      return false;
    }
    return !context.item ||
      this.currentItem(context.item.id) === context.item ||
      (allowRemovedItem && this.currentItem(context.item.id) === undefined);
  }

  private isContextCurrent(context: VaultActionContext): boolean {
    const state = this.store.snapshot();
    return !this.destroyed &&
      this.lifecycleEpoch === context.lifecycleEpoch &&
      this.router.url === context.route &&
      state.isUnlocked === context.isUnlocked &&
      state.activeSession === context.activeSession &&
      state.email === context.email;
  }

  private isCurrentNavigation(operation: number, context: VaultActionContext): boolean {
    return operation === this.navigationOperation && this.isCurrent(context);
  }

  private currentItem(itemId: string): VaultItem | undefined {
    return this.store.snapshot().items.find((candidate) => candidate.id === itemId);
  }
}

interface VaultActionContext {
  readonly activeSession: PopupState["activeSession"];
  readonly email: string;
  readonly isUnlocked: boolean;
  readonly item?: VaultItem;
  readonly lifecycleEpoch: number;
  readonly route: string;
}

const CIPHER_QUERY_TYPES: Partial<Record<VaultItem["type"], string>> = {
  login: "1",
  "secure-note": "2",
  card: "3",
  identity: "4",
};
