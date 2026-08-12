import { Component, EventEmitter, Input, OnDestroy, Output } from "@angular/core";
import { Router } from "@angular/router";
import { Subscription } from "rxjs";

import { PopupStateStore } from "../popup-state";
import type { VaultItem } from "../vault-demo";
import {
  VaultListItemsContainerComponent,
  type VaultMenuOpenChange,
} from "../upstream-overlays/vault-main/vault-list-items-container.component";
import type { VaultRowFieldAction } from "../upstream-overlays/vault-main/retained-vault-list-item.component";
import type {
  VaultHierarchyChild,
  VaultHierarchyNode,
  VaultHierarchyNodeId,
} from "./vault-hierarchy";
import type { VaultSectionView } from "./vault.facade";
import { I18nPipe } from "../official-ui/official-ui-common";
import { VaultDisclosureGroupComponent } from "./vault-disclosure-group.component";

@Component({
  selector: "bw-vault-hierarchy",
  standalone: true,
  imports: [I18nPipe, VaultDisclosureGroupComponent, VaultListItemsContainerComponent],
  template: `
    <div class="vault-hierarchy" role="list" [attr.aria-label]="'i18nVaultCategories' | i18n">
      @for (node of nodes; track node.id) {
        <bw-vault-disclosure-group
          role="listitem"
          [groupId]="node.id"
          [title]="node.title"
          [count]="node.count"
          [open]="isNodeOpen(node)"
          [rendered]="isNodeRendered(node)"
          (openChange)="setNodeOpen(node, $event)"
        >
          @if (isNodeRendered(node)) {
              @if (node.children; as children) {
                @if (children.length === 0) {
                  <p class="vault-hierarchy__empty">{{ "i18nNoFoldersYet" | i18n }}</p>
                } @else {
                  <div class="vault-hierarchy__children">
                    @for (child of children; track child.id) {
                      <button
                        type="button"
                        class="vault-hierarchy__child macos-pressable"
                        [attr.data-vault-child]="child.id"
                        [attr.aria-expanded]="child.items ? isChildOpen(child) : null"
                        [attr.aria-controls]="child.items ? 'vault-child-' + child.id : null"
                        (click)="activateChild(child)"
                      >
                        <i class="bwi {{ child.icon }}" aria-hidden="true"></i>
                        <span class="vault-hierarchy__child-title">{{ child.title }}</span>
                        <span class="vault-hierarchy__count">{{ child.count }}</span>
                        <i
                          class="bwi"
                          [class.bwi-angle-up]="child.items && isChildOpen(child)"
                          [class.bwi-angle-down]="child.items && !isChildOpen(child)"
                          [class.bwi-angle-right]="child.route"
                          aria-hidden="true"
                        ></i>
                      </button>
                      @if (child.items && isChildRendered(child)) {
                        <div
                          class="vault-hierarchy__child-content"
                          [class.is-open]="isChildOpen(child)"
                          [id]="'vault-child-' + child.id"
                          role="group"
                          [attr.aria-label]="child.title"
                          [attr.aria-hidden]="isChildOpen(child) ? 'false' : 'true'"
                          [attr.inert]="isChildOpen(child) ? null : ''"
                        >
                          <div>
                          @if (child.items.length > 0) {
                            <app-vault-list-items-container
                              class="vault-hierarchy__items"
                              [section]="section(child.items)"
                              [embedded]="true"
                              [openMenuRowId]="openMenuRowId"
                              [showQuickCopyActions]="showQuickCopyActions"
                              (view)="view.emit($event)"
                              (fill)="fill.emit($event)"
                              (edit)="edit.emit($event)"
                              (clone)="clone.emit($event)"
                              (launch)="launch.emit($event)"
                              (toggleFavorite)="toggleFavorite.emit($event)"
                              (archive)="archive.emit($event)"
                              (delete)="delete.emit($event)"
                              (menuOpenChange)="menuOpenChange.emit($event)"
                            />
                          } @else {
                            <p class="vault-hierarchy__empty">{{ "i18nNoItemsInCategory" | i18n }}</p>
                          }
                          </div>
                        </div>
                      }
                    }
                  </div>
                }
              } @else if (node.items && node.items.length > 0) {
                <app-vault-list-items-container
                  class="vault-hierarchy__items"
                  [section]="section(node.items)"
                  [embedded]="true"
                  [openMenuRowId]="openMenuRowId"
                  [showQuickCopyActions]="showQuickCopyActions"
                  (view)="view.emit($event)"
                  (fill)="fill.emit($event)"
                  (edit)="edit.emit($event)"
                  (clone)="clone.emit($event)"
                  (launch)="launch.emit($event)"
                  (toggleFavorite)="toggleFavorite.emit($event)"
                  (archive)="archive.emit($event)"
                  (delete)="delete.emit($event)"
                  (menuOpenChange)="menuOpenChange.emit($event)"
                />
              } @else {
                <p class="vault-hierarchy__empty">{{ "i18nNoItemsInNode" | i18n }}</p>
              }
          }
        </bw-vault-disclosure-group>
      }
    </div>
  `,
})
export class VaultHierarchyComponent implements OnDestroy {
  @Input({ required: true }) nodes: readonly VaultHierarchyNode[] = [];
  @Input() openMenuRowId: string | null = null;
  @Input() showQuickCopyActions = true;

  @Output() readonly view = new EventEmitter<VaultItem>();
  @Output() readonly fill = new EventEmitter<VaultRowFieldAction>();
  @Output() readonly edit = new EventEmitter<VaultItem>();
  @Output() readonly clone = new EventEmitter<VaultItem>();
  @Output() readonly launch = new EventEmitter<VaultItem>();
  @Output() readonly toggleFavorite = new EventEmitter<VaultItem>();
  @Output() readonly archive = new EventEmitter<VaultItem>();
  @Output() readonly delete = new EventEmitter<VaultItem>();
  @Output() readonly menuOpenChange = new EventEmitter<VaultMenuOpenChange>();

  private readonly renderedNodeIds = new Set<VaultHierarchyNodeId>(["all-items"]);
  private readonly renderedChildIds = new Set<string>();
  private readonly sectionCache = new WeakMap<readonly VaultItem[], VaultSectionView>();
  private readonly hierarchyStateSubscription: Subscription;

  constructor(
    private readonly router: Router,
    private readonly store: PopupStateStore,
  ) {
    this.hierarchyStateSubscription = this.store.state$.subscribe(() => {
      for (const nodeId of this.store.vaultHierarchyOpenNodeIds()) {
        this.renderedNodeIds.add(nodeId as VaultHierarchyNodeId);
      }
      for (const childId of this.store.vaultHierarchyOpenChildIds()) {
        this.renderedChildIds.add(childId);
      }
    });
  }

  isNodeOpen(node: VaultHierarchyNode): boolean {
    return this.store.vaultHierarchyOpenNodeIds().includes(node.id);
  }

  isNodeRendered(node: VaultHierarchyNode): boolean {
    return this.renderedNodeIds.has(node.id);
  }

  isChildOpen(child: VaultHierarchyChild): boolean {
    return this.store.vaultHierarchyOpenChildIds().includes(child.id);
  }

  isChildRendered(child: VaultHierarchyChild): boolean {
    return this.renderedChildIds.has(child.id);
  }

  toggleNode(node: VaultHierarchyNode): void {
    this.renderedNodeIds.add(node.id);
    this.store.toggleVaultHierarchyNode(node.id);
  }

  setNodeOpen(node: VaultHierarchyNode, open: boolean): void {
    if (this.isNodeOpen(node) !== open) this.toggleNode(node);
  }

  activateChild(child: VaultHierarchyChild): void {
    if (child.route) {
      void this.router.navigateByUrl(child.route);
      return;
    }
    this.renderedChildIds.add(child.id);
    this.store.toggleVaultHierarchyChild(child.id);
  }

  ngOnDestroy(): void {
    this.hierarchyStateSubscription.unsubscribe();
  }

  section(items: readonly VaultItem[]): VaultSectionView {
    const cached = this.sectionCache.get(items);
    if (cached !== undefined) {
      return cached;
    }
    const section: VaultSectionView = {
      id: "all-items",
      title: "",
      description: "",
      items,
      count: items.length,
      showFill: false,
      collapsible: false,
      forcedOpen: true,
    };
    this.sectionCache.set(items, section);
    return section;
  }
}
