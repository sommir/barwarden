import { Injectable } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder } from "@angular/forms";
import {
  combineLatest,
  distinctUntilChanged,
  map,
  of,
  shareReplay,
  startWith,
} from "rxjs";

import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";

import { PopupStateStore, type PopupState } from "../../../../../../popup-state";
import type { VaultFolder, VaultItemType } from "../../../../../../vault/vault-item.model";
import { VaultFacade } from "../../../../../../vault/vault.facade";

type RetainedCipherType = 1 | 2 | 3 | 4;

type RetainedFolderFilter = Pick<VaultFolder, "id" | "name">;

type RetainedChipFilterOption<T> = {
  value: T;
  label: string;
  icon: "bwi-credit-card" | "bwi-folder" | "bwi-globe" | "bwi-id-card" | "bwi-sticky-note";
};

type RetainedPopupListFilter = {
  organization: null;
  collection: null;
  folder: RetainedFolderFilter | null;
  cipherType: RetainedCipherType | null;
};

const vaultTypeByCipherType: Readonly<Record<RetainedCipherType, VaultItemType>> = {
  1: "login",
  2: "secure-note",
  3: "card",
  4: "identity",
};

const cipherTypeByVaultType: Readonly<Partial<Record<VaultItemType, RetainedCipherType>>> = {
  login: 1,
  "secure-note": 2,
  card: 3,
  identity: 4,
};

@Injectable({ providedIn: "root" })
export class VaultPopupListFiltersService {
  readonly filterForm = this.formBuilder.group({
    organization: this.formBuilder.control<null>(null),
    collection: this.formBuilder.control<null>(null),
    folder: this.formBuilder.control<RetainedFolderFilter | null>(
      this.folderFilterFromState(this.store.snapshot()),
    ),
    cipherType: this.formBuilder.control<RetainedCipherType | null>(
      this.cipherTypeFromState(this.store.snapshot()),
    ),
  });

  readonly filters$ = this.filterForm.valueChanges.pipe(
    map(() => this.filterForm.getRawValue()),
    startWith(this.filterForm.getRawValue()),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly organizations$ = of<RetainedChipFilterOption<never>[]>([]);
  readonly collections$ = of<RetainedChipFilterOption<never>[]>([]);

  readonly folders$ = this.store.state$.pipe(
    map((state) => this.folderOptions(state.folders)),
    distinctUntilChanged((previous, current) => JSON.stringify(previous) === JSON.stringify(current)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly cipherTypes$ = of<RetainedChipFilterOption<RetainedCipherType>[]>([
    { value: 1, label: this.i18nService.t("typeLogin"), icon: "bwi-globe" },
    { value: 3, label: this.i18nService.t("typeCard"), icon: "bwi-credit-card" },
    { value: 4, label: this.i18nService.t("typeIdentity"), icon: "bwi-id-card" },
    { value: 2, label: this.i18nService.t("typeNote"), icon: "bwi-sticky-note" },
  ]);

  readonly allFilters$ = combineLatest([
    this.organizations$,
    this.collections$,
    this.folders$,
  ]);

  readonly numberOfAppliedFilters$ = this.filters$.pipe(
    map((filters) => Object.values(filters).filter(Boolean).length),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly filterVisibilityState$ = this.store.state$.pipe(
    map((state) => state.isFilterVisible),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  constructor(
    private readonly formBuilder: FormBuilder,
    private readonly i18nService: I18nService,
    private readonly store: PopupStateStore,
    private readonly vault: VaultFacade,
  ) {
    this.filterForm.valueChanges
      .pipe(
        map(() => this.filterForm.getRawValue()),
        takeUntilDestroyed(),
      )
      .subscribe((filters) => this.applyFilters(filters));

    this.store.state$
      .pipe(
        map((state) => ({
          folder: this.folderFilterFromState(state),
          cipherType: this.cipherTypeFromState(state),
        })),
        distinctUntilChanged(
          (previous, current) =>
            previous.folder?.id === current.folder?.id &&
            previous.folder?.name === current.folder?.name &&
            previous.cipherType === current.cipherType,
        ),
        takeUntilDestroyed(),
      )
      .subscribe((filters) => this.filterForm.patchValue(filters, { emitEvent: false }));
  }

  async updateFilterVisibility(isShown: boolean): Promise<void> {
    if (this.store.snapshot().isFilterVisible !== isShown) {
      this.store.setFilterVisible(isShown);
    }
  }

  private applyFilters(filters: RetainedPopupListFilter): void {
    const folderId = filters.folder === null ? "" : filters.folder.id || "__none";
    const cipherType = filters.cipherType === null ? "" : vaultTypeByCipherType[filters.cipherType];
    const state = this.store.snapshot();

    if (state.filterFolderId !== folderId) {
      this.vault.setFolderFilter(folderId);
    }
    if (state.filterType !== cipherType) {
      this.vault.setTypeFilter(cipherType);
    }
  }

  private folderFilterFromState(state: PopupState): RetainedFolderFilter | null {
    if (!state.filterFolderId) {
      return null;
    }
    if (state.filterFolderId === "__none") {
      return this.noFolderFilter();
    }
    return state.folders.find((folder) => folder.id === state.filterFolderId) ?? null;
  }

  private cipherTypeFromState(state: PopupState): RetainedCipherType | null {
    return state.filterType ? (cipherTypeByVaultType[state.filterType] ?? null) : null;
  }

  private folderOptions(
    folders: readonly VaultFolder[],
  ): RetainedChipFilterOption<RetainedFolderFilter>[] {
    const folderOptions = [...folders]
      .sort((left, right) => this.i18nService.collator.compare(left.name, right.name))
      .map((folder) => ({
        value: folder,
        label: folder.name,
        icon: "bwi-folder" as const,
      }));

    return [
      ...folderOptions,
      {
        value: this.noFolderFilter(),
        label: this.i18nService.t("itemsWithNoFolder"),
        icon: "bwi-folder",
      },
    ];
  }

  private noFolderFilter(): RetainedFolderFilter {
    return { id: "", name: this.i18nService.t("itemsWithNoFolder") };
  }
}
