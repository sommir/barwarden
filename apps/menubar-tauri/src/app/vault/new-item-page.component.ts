import { Component, ViewChild } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { map } from "rxjs";

import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { VaultFolderDialogComponent } from "./vault-folder-dialog.component";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";
import { I18nPipe } from "../official-ui/official-ui-common";

interface NewItemOption {
  readonly label: string;
  readonly description: string;
  readonly icon: string;
  readonly link: string;
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
    queryParams: { type: "1" },
  },
  {
    labelKey: "typeCard",
    descriptionKey: "i18nSaveCardDescription",
    icon: "bwi-credit-card",
    link: "/add-cipher",
    queryParams: { type: "3" },
  },
  {
    labelKey: "typeIdentity",
    descriptionKey: "i18nSaveIdentityDescription",
    icon: "bwi-id-card",
    link: "/add-cipher",
    queryParams: { type: "4" },
  },
  {
    labelKey: "i18nSecureNote",
    descriptionKey: "i18nSaveSecureNoteDescription",
    icon: "bwi-sticky-note",
    link: "/add-cipher",
    queryParams: { type: "2" },
  },
  {
    labelKey: "folder",
    descriptionKey: "i18nFolderDescription",
    icon: "bwi-folder",
    link: "",
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
        <div class="new-item-grid">
          @for (item of items; track item.label) {
            @if (item.opensFolderDialog) {
              <button class="new-item-option" type="button" [attr.aria-label]="'i18nNewFolder' | i18n" (click)="openFolderDialog()">
                <span class="new-item-icon" aria-hidden="true">
                  <i class="bwi {{ item.icon }}" aria-hidden="true"></i>
                </span>
                <span class="new-item-text">
                  <span class="new-item-label">{{ item.label }}</span>
                  <span class="new-item-description">{{ item.description }}</span>
                </span>
              </button>
            } @else {
              <a class="new-item-option" [routerLink]="item.link" [queryParams]="item.queryParams ?? null">
                <span class="new-item-icon" aria-hidden="true">
                  <i class="bwi {{ item.icon }}" aria-hidden="true"></i>
                </span>
                <span class="new-item-text">
                  <span class="new-item-label">{{ item.label }}</span>
                  <span class="new-item-description">{{ item.description }}</span>
                </span>
              </a>
            }
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

  openFolderDialog(): void {
    this.folderDialog?.openFor();
  }

  async onFolderCreated(): Promise<void> {
    await this.router.navigateByUrl("/tabs/vault");
  }

  async back(): Promise<void> {
    await this.router.navigateByUrl("/tabs/vault");
  }
}
