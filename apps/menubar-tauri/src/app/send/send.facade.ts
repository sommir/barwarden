import { Injectable } from "@angular/core";

import { PopupStateStore } from "../popup-state";
import { sendItemTypeLabel, type SendItem, type SendItemType } from "./send-item.model";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

export type SendState = "empty" | "no-results" | "ready";

@Injectable({ providedIn: "root" })
export class SendFacade {
  private query = "";
  private filteredSendsCache?: {
    readonly sends: readonly SendItem[];
    readonly query: string;
    readonly type: SendItemType | "";
    readonly result: readonly SendItem[];
  };

  constructor(private readonly store: PopupStateStore) {}

  setSearch(query: string): void {
    this.query = query;
  }

  resetSearch(): void {
    this.query = "";
  }

  queryValue(): string {
    return this.query;
  }

  setTypeFilter(type: SendItemType | ""): void {
    this.store.setSendTypeFilter(type);
  }

  toggleFilters(): void {
    this.store.setSendFilterVisible(!this.store.snapshot().isSendFilterVisible);
  }

  filtersVisible(): boolean {
    return this.store.snapshot().isSendFilterVisible;
  }

  sendDisabled(): boolean {
    return this.store.snapshot().isSendDisabled;
  }

  showSkeletons(): boolean {
    const state = this.store.snapshot();
    return state.isSyncing && state.sends.length === 0;
  }

  filterType(): SendItemType | "" {
    return this.store.snapshot().sendTypeFilter;
  }

  availableTypeFilters(): readonly { id: SendItemType; label: string }[] {
    return [{ id: "text", label: sendItemTypeLabel("text") }];
  }

  filteredSends(): readonly SendItem[] {
    const state = this.store.snapshot();
    const normalizedQuery = this.query.trim().toLocaleLowerCase();
    const cached = this.filteredSendsCache;
    if (
      cached?.sends === state.sends &&
      cached.query === normalizedQuery &&
      cached.type === state.sendTypeFilter
    ) {
      return cached.result;
    }

    const result = state.sends.filter((send) => {
      if (state.sendTypeFilter && send.type !== state.sendTypeFilter) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [
        send.name,
        send.text ?? "",
        send.notes,
        sendItemTypeLabel(send.type),
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
    });
    this.filteredSendsCache = {
      sends: state.sends,
      query: normalizedQuery,
      type: state.sendTypeFilter,
      result,
    };
    return result;
  }

  sendState(): SendState {
    const state = this.store.snapshot();
    if (state.sends.length === 0) {
      return "empty";
    }

    return this.filteredSends().length === 0 ? "no-results" : "ready";
  }

  sectionTitle(): string {
    const type = this.store.snapshot().sendTypeFilter;
    return type ? sendItemTypeLabel(type) : translateOfficialMessage("i18nAllSends");
  }
}
