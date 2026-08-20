import { Component, ViewChild } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { map } from "rxjs";

import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { VaultFolderDialogComponent } from "./vault-folder-dialog.component";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";

interface NewItemOption {
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly link: string;
  readonly focusKey: "new-item:type:1" | "new-item:type:2" |
    "new-item:type:3" | "new-item:type:4" | "new-item:folder";
  readonly queryParams?: Record<string, string>;
  readonly opensFolderDialog?: boolean;
}

interface NewItemOptionSource extends Omit<NewItemOption, "label" | "description"> {
  readonly labelKey: string;
  readonly descriptionKey: string;
}

const NEW_ITEM_OPTIONS: readonly NewItemOptionSource[] = [
  {
    labelKey: "typeLogin",
    descriptionKey: "i18nLoginDescription",
    icon: "bwi-globe",
    link: "/add-cipher",
    focusKey: "new-item:type:1",
    queryParams: { type: "1" },
  },
  {
    labelKey: "typeCard",
    descriptionKey: "i18nSaveCardDescription",
    icon: "bwi-credit-card",
    link: "/add-cipher",
    focusKey: "new-item:type:3",
    queryParams: { type: "3" },
  },
  {
    labelKey: "typeIdentity",
    descriptionKey: "i18nSaveIdentityDescription",
    icon: "bwi-id-card",
    link: "/add-cipher",
    focusKey: "new-item:type:4",
    queryParams: { type: "4" },
  },
  {
    labelKey: "i18nSecureNote",
    descriptionKey: "i18nSaveSecureNoteDescription",
    icon: "bwi-sticky-note",
    link: "/add-cipher",
    focusKey: "new-item:type:2",
    queryParams: { type: "2" },
  },
  {
    labelKey: "folder",
    descriptionKey: "i18nFolderDescription",
    icon: "bwi-folder",
    link: "",
    focusKey: "new-item:folder",
    opensFolderDialog: true,
  },
];

@Component({
  selector: "bw-new-item-page",
  host: { class: "macos-page macos-page--secondary macos-page--vault-form" },
  standalone: true,
  imports: [I18nPipe, PopupHeaderComponent, PopupPageComponent, RouterLink, VaultFolderDialogComponent],
  template: `
    <popup-page>
      <popup-header slot="header" [pageTitle]="'i18nChooseItemToAdd' | i18n" [showBackButton]="true" [backAction]="backAction" />

      <section class="new-item-page" [attr.aria-label]="'i18nChooseItemToAdd' | i18n">
        <div class="new-item-grid" role="list">
          @for (item of items; track item.focusKey) {
            <div class="new-item-option-row" role="listitem">
              @if (item.opensFolderDialog) {
                <button class="new-item-option macos-row macos-row--double macos-pressable macos-hit-target" type="button"
                  [attr.aria-label]="'i18nNewFolder' | i18n"
                  [attr.data-popup-focus-key]="item.focusKey"
                  [attr.aria-describedby]="item.focusKey + '-description'"
                  (click)="openFolderDialog($event.currentTarget)">
                  <span class="new-item-icon" aria-hidden="true"><i class="bwi {{ item.icon }}" aria-hidden="true"></i></span>
                  <span class="new-item-text"><span class="new-item-label">{{ item.label }}</span>
                    <span class="new-item-description" [id]="item.focusKey + '-description'">{{ item.description }}</span>
                  </span>
                </button>
              } @else {
                <a class="new-item-option macos-row macos-row--double macos-pressable macos-hit-target" [routerLink]="item.link" [queryParams]="item.queryParams ?? null"
                  [attr.data-popup-focus-key]="item.focusKey"
                  [attr.aria-describedby]="item.focusKey + '-description'">
                  <span class="new-item-icon" aria-hidden="true"><i class="bwi {{ item.icon }}" aria-hidden="true"></i></span>
                  <span class="new-item-text"><span class="new-item-label">{{ item.label }}</span>
                    <span class="new-item-description" [id]="item.focusKey + '-description'">{{ item.description }}</span>
                  </span>
                </a>
              }
            </div>
          }
        </div>
      </section>
      <bw-vault-folder-dialog (folderCreated)="onFolderCreated()" />
    </popup-page>
  `,
})
export class NewItemPageComponent {
  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () => this.back();
  @ViewChild(VaultFolderDialogComponent) private folderDialog?: VaultFolderDialogComponent;
  private folderId = "";

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly routeCache: PopupRouterCacheService,
  ) {
    this.folderId = this.route.snapshot.queryParamMap.get("folderId") ?? "";
    this.route.queryParamMap
      .pipe(map((params) => params.get("folderId") ?? ""))
      .subscribe((folderId) => this.folderId = folderId);
  }

  get items(): readonly NewItemOption[] {
    return NEW_ITEM_OPTIONS.map((item) => {
      const localized = {
        ...item,
        label: translateOfficialMessage(item.labelKey),
        description: translateOfficialMessage(item.descriptionKey),
      };
      return item.queryParams && this.folderId
        ? { ...localized, queryParams: { ...item.queryParams, folderId: this.folderId } }
        : localized;
    });
  }

  openFolderDialog(trigger: EventTarget | null): void {
    this.folderDialog?.openFor(undefined, trigger instanceof HTMLElement ? trigger : null);
  }

  async onFolderCreated(): Promise<void> {
    await this.router.navigateByUrl("/tabs/vault");
  }

  async back(): Promise<void> {
    await this.routeCache.back();
  }
}
