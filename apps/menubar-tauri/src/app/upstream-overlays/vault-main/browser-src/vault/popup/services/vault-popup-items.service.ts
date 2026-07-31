import { Injectable } from "@angular/core";
import { BehaviorSubject, map, type Observable } from "rxjs";

import { PopupStateStore } from "../../../../../../popup-state";
import { VaultFacade } from "../../../../../../vault/vault.facade";

@Injectable({ providedIn: "root" })
export class VaultPopupItemsService {
  private readonly searchText: BehaviorSubject<string>;

  readonly searchText$: Observable<string>;
  readonly loading$ = this.store.state$.pipe(
    map((state) => state.isSyncing && state.items.length === 0),
  );

  constructor(
    private readonly store: PopupStateStore,
    private readonly vault: VaultFacade,
  ) {
    this.searchText = new BehaviorSubject(this.vault.queryValue());
    this.searchText$ = this.searchText.asObservable();
  }

  applyFilter(text: string): void {
    this.searchText.next(text);
    this.vault.setSearch(text);
  }
}
