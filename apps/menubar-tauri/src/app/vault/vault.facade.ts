import { Injectable, signal } from "@angular/core";

import { PopupStateStore } from "../popup-state";
import type { VaultFolder, VaultItem } from "../vault-demo";
import { filterVaultItems } from "./vault-filter.service";
import { buildVaultHierarchy, type VaultHierarchyNode } from "./vault-hierarchy";
import { type VaultItemType, vaultItemTypeLabel, vaultItemTypes } from "./vault-item.model";
import {
  activeOfficialLocale,
  translateOfficialMessage,
  type OfficialLocale,
} from "../official-ui/official-i18n.service";
import { rankWebsiteSuggestions } from "./website-suggestion-matcher";

export interface VaultSectionView {
  readonly id: "autofill-suggestions" | "favorites" | "all-items" | "search-results";
  readonly title: string;
  readonly description: string;
  readonly items: readonly VaultItem[];
  readonly count: number;
  readonly showFill: boolean;
  readonly collapsible: boolean;
  readonly forcedOpen: boolean;
}

export type VaultMainState = "loading" | "empty" | "no-results" | "ready" | "stale" | "unavailable";
export type VaultItemLocation = "active" | "archived" | "deleted";

@Injectable({ providedIn: "root" })
export class VaultFacade {
  private readonly query = signal("");
  private filteredItemsCache?: {
    readonly items: readonly VaultItem[];
    readonly query: string;
    readonly folderId: string;
    readonly type: VaultItemType | "";
    readonly result: readonly VaultItem[];
  };
  private sectionsCache?: {
    readonly matchingItems: readonly VaultItem[];
    readonly query: string;
    readonly folderId: string;
    readonly type: VaultItemType | "";
    readonly locale: OfficialLocale;
    readonly result: readonly VaultSectionView[];
  };
  private websiteSuggestionCache?: {
    readonly matchingItems: readonly VaultItem[];
    readonly query: string;
    readonly url: string | null;
    readonly locale: OfficialLocale;
    readonly result: VaultSectionView | null;
  };
  private hierarchyCache?: {
    readonly items: readonly VaultItem[];
    readonly folders: readonly VaultFolder[];
    readonly archivedItems: readonly VaultItem[];
    readonly deletedItems: readonly VaultItem[];
    readonly locale: OfficialLocale;
    readonly result: readonly VaultHierarchyNode[];
  };
  private itemIndexCache?: {
    readonly items: readonly VaultItem[];
    readonly archivedItems: readonly VaultItem[];
    readonly deletedItems: readonly VaultItem[];
    readonly itemsById: ReadonlyMap<string, VaultItem>;
    readonly locationsById: ReadonlyMap<string, VaultItemLocation>;
  };

  constructor(private readonly store: PopupStateStore) {}

  setSearch(query: string | null | undefined): void {
    this.query.set(query ?? "");
  }

  resetSearch(): void {
    this.query.set("");
  }

  search(query: string | null | undefined): void {
    this.setSearch(query);
  }

  queryValue(): string {
    return this.query();
  }

  setFolderFilter(id: string): void {
    this.store.setFilterFolderId(id);
  }

  setTypeFilter(type: VaultItemType | ""): void {
    this.store.setFilterType(type);
  }

  toggleFilters(): void {
    this.store.setFilterVisible(!this.store.snapshot().isFilterVisible);
  }

  filtersVisible(): boolean {
    return this.store.snapshot().isFilterVisible;
  }

  filterFolderId(): string {
    return this.store.snapshot().filterFolderId;
  }

  filterType(): VaultItemType | "" {
    return this.store.snapshot().filterType;
  }

  availableTypeFilters(): readonly { id: VaultItemType; label: string }[] {
    return vaultItemTypes
      .filter((id) => id !== "ssh-key")
      .map((id) => ({ id, label: vaultItemTypeLabel(id) }));
  }

  availableFolderFilters(): readonly VaultFolder[] {
    return this.store.snapshot().folders;
  }

  filteredItems(): readonly VaultItem[] {
    const state = this.store.snapshot();
    const query = this.query();
    const cached = this.filteredItemsCache;
    if (
      cached?.items === state.items &&
      cached.query === query &&
      cached.folderId === state.filterFolderId &&
      cached.type === state.filterType
    ) {
      return cached.result;
    }

    const folderFilter = state.filterFolderId === "__none" ? "" : state.filterFolderId;
    const filtered = filterVaultItems(state.items.filter((item) => item.type !== "ssh-key"), {
      query,
      folderId: folderFilter,
      type: state.filterType,
    });

    const result = state.filterFolderId === "__none"
      ? filtered.filter((item) => item.folderId.length === 0)
      : filtered;
    this.filteredItemsCache = {
      items: state.items,
      query,
      folderId: state.filterFolderId,
      type: state.filterType,
      result,
    };

    return result;
  }

  vaultState(): VaultMainState {
    const state = this.store.snapshot();
    const hasRetainedItems = state.items.some((item) => item.type !== "ssh-key");
    if (state.vaultSyncStatus === "unavailable" && !hasRetainedItems) {
      return "unavailable";
    }
    if (state.isSyncing && !hasRetainedItems) {
      return "loading";
    }
    if (!hasRetainedItems) {
      return "empty";
    }

    if (this.filteredItems().length === 0) {
      return "no-results";
    }

    return state.vaultSyncStatus === "stale" ? "stale" : "ready";
  }

  sections(): readonly VaultSectionView[] {
    const matchingItems = this.filteredItems();
    const state = this.store.snapshot();
    const query = this.query();
    const locale = activeOfficialLocale();
    const cached = this.sectionsCache;
    if (
      cached?.matchingItems === matchingItems &&
      cached.query === query &&
      cached.folderId === state.filterFolderId &&
      cached.type === state.filterType &&
      cached.locale === locale
    ) {
      return cached.result;
    }

    const result: readonly VaultSectionView[] = query.trim().length > 0
      ? [
        {
          id: "search-results",
          title: translateOfficialMessage("searchResults"),
          description: "",
          items: matchingItems,
          count: matchingItems.length,
          showFill: false,
          collapsible: matchingItems.length > 0,
          forcedOpen: true,
        },
      ]
      : this.buildDefaultSections(matchingItems, state.filterFolderId, state.filterType);
    this.sectionsCache = {
      matchingItems,
      query,
      folderId: state.filterFolderId,
      type: state.filterType,
      locale,
      result,
    };

    return result;
  }

  websiteSuggestionSection(url: string | null): VaultSectionView | null {
    const matchingItems = this.filteredItems();
    const query = this.query();
    const locale = activeOfficialLocale();
    const cached = this.websiteSuggestionCache;
    if (
      cached?.matchingItems === matchingItems &&
      cached.query === query &&
      cached.url === url &&
      cached.locale === locale
    ) {
      return cached.result;
    }

    let result: VaultSectionView | null = null;
    if (url !== null && query.trim().length === 0) {
      const items = rankWebsiteSuggestions(matchingItems, url);
      if (items.length > 0) {
        result = {
          id: "autofill-suggestions",
          title: translateOfficialMessage("autofillSuggestions"),
          description: "",
          items,
          count: items.length,
          showFill: false,
          collapsible: true,
          forcedOpen: false,
        };
      }
    }
    this.websiteSuggestionCache = {
      matchingItems,
      query,
      url,
      locale,
      result,
    };
    return result;
  }

  hierarchy(): readonly VaultHierarchyNode[] {
    const state = this.store.snapshot();
    const locale = activeOfficialLocale();
    const cached = this.hierarchyCache;
    if (
      cached?.items === state.items &&
      cached.folders === state.folders &&
      cached.archivedItems === state.archivedItems &&
      cached.deletedItems === state.deletedItems &&
      cached.locale === locale
    ) {
      return cached.result;
    }

    const result = buildVaultHierarchy(state);
    this.hierarchyCache = {
      items: state.items,
      folders: state.folders,
      archivedItems: state.archivedItems,
      deletedItems: state.deletedItems,
      locale,
      result,
    };
    return result;
  }

  itemById(id: string): VaultItem | undefined {
    return this.itemIndex().itemsById.get(id);
  }

  itemLocation(id: string): VaultItemLocation | undefined {
    return this.itemIndex().locationsById.get(id);
  }

  private buildDefaultSections(
    matchingItems: readonly VaultItem[],
    folderId: string,
    type: VaultItemType | "",
  ): readonly VaultSectionView[] {
    const favorites = matchingItems.filter((item) => item.favorite);
    const hasAppliedFilters = Boolean(folderId || type);
    return [
      {
        id: "favorites",
        title: translateOfficialMessage("favorites"),
        description: "",
        items: favorites,
        count: favorites.length,
        showFill: false,
        collapsible: favorites.length > 0,
        forcedOpen: hasAppliedFilters,
      },
      {
        id: "all-items",
        title: translateOfficialMessage(hasAppliedFilters ? "items" : "i18nAllItems"),
        description: "",
        items: matchingItems,
        count: matchingItems.length,
        showFill: false,
        collapsible: matchingItems.length > 0,
        forcedOpen: hasAppliedFilters,
      },
    ];
  }

  private itemIndex(): NonNullable<VaultFacade["itemIndexCache"]> {
    const state = this.store.snapshot();
    const cached = this.itemIndexCache;
    if (
      cached?.items === state.items &&
      cached.archivedItems === state.archivedItems &&
      cached.deletedItems === state.deletedItems
    ) {
      return cached;
    }

    const itemsById = new Map<string, VaultItem>();
    const locationsById = new Map<string, VaultItemLocation>();
    for (const [items, location] of [
      [state.items, "active"],
      [state.archivedItems, "archived"],
      [state.deletedItems, "deleted"],
    ] as const) {
      for (const item of items) {
        if (!itemsById.has(item.id)) {
          itemsById.set(item.id, item);
          locationsById.set(item.id, location);
        }
      }
    }

    this.itemIndexCache = {
      items: state.items,
      archivedItems: state.archivedItems,
      deletedItems: state.deletedItems,
      itemsById,
      locationsById,
    };
    return this.itemIndexCache;
  }
}
