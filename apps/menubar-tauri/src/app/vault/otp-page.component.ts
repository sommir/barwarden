import { Component, OnDestroy } from "@angular/core";

import { PopupPageComponent } from "../layout/popup-page.component";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { RootSearchComponent } from "../layout/root-search.component";
import { PopupHeaderActionsComponent } from "../popup-header-actions.component";
import { PopupStateStore } from "../popup-state";
import type { VaultField } from "../vault-demo";
import { OtpCodeRowComponent } from "./otp-code-row.component";
import { buildOtpEntries } from "./otp-items";
import { VaultActionsService } from "./vault-actions.service";
import { I18nPipe } from "../official-ui/official-ui-common";

@Component({
  selector: "bw-otp-page",
  standalone: true,
  imports: [
    OtpCodeRowComponent,
    PopupHeaderActionsComponent,
    PopupHeaderComponent,
    PopupPageComponent,
    RootSearchComponent,
    I18nPipe,
  ],
  template: `
    <popup-page class="macos-page macos-page--otp">
      <popup-header slot="header" [pageTitle]="'verificationCode' | i18n">
        <ng-container slot="end">
          <bw-popup-header-actions [showNew]="false" />
        </ng-container>
      </popup-header>
      <bw-root-search
        slot="above-scroll-area"
        [searchAriaLabel]="'i18nSearchVerificationCodes' | i18n"
        [query]="query"
        (queryChange)="setSearch($event)"
      />

      <section class="otp-page" aria-labelledby="otp-page-count">
        <h2 id="otp-page-count" class="otp-page__heading">{{ "i18nItemsCount" | i18n: entries.length }}</h2>
        @if (entries.length > 0) {
          <div class="otp-page__list">
            @for (entry of entries; track entry.item.id) {
              <bw-otp-code-row
                [item]="entry.item"
                [field]="entry.field"
                [copied]="copiedItemId === entry.item.id"
                (copy)="copyCode(entry.item.id, $event)"
              />
            }
          </div>
        } @else {
          <div class="otp-page__empty">
            <i class="bwi bwi-clock" aria-hidden="true"></i>
            <p>{{ query ? ("i18nNoMatchingVerificationCodes" | i18n) : ("i18nNoVerificationCodes" | i18n) }}</p>
          </div>
        }
      </section>
    </popup-page>
  `,
})
export class OtpPageComponent implements OnDestroy {
  protected query = "";
  protected copiedItemId: string | null = null;
  private copiedResetTimer?: ReturnType<typeof setTimeout>;
  private entriesCache?: {
    readonly items: ReturnType<PopupStateStore["snapshot"]>["items"];
    readonly query: string;
    readonly result: ReturnType<typeof buildOtpEntries>;
  };

  constructor(
    private readonly store: PopupStateStore,
    private readonly actions: VaultActionsService,
  ) {}

  protected get entries() {
    const items = this.store.snapshot().items;
    if (this.entriesCache?.items === items && this.entriesCache.query === this.query) {
      return this.entriesCache.result;
    }

    const result = buildOtpEntries(items, this.query);
    this.entriesCache = { items, query: this.query, result };
    return result;
  }

  protected setSearch(query: string): void {
    this.query = query;
  }

  ngOnDestroy(): void {
    if (this.copiedResetTimer) {
      clearTimeout(this.copiedResetTimer);
    }
  }

  protected async copyCode(itemId: string, field: VaultField): Promise<void> {
    const context = this.store.snapshot();
    const accountKey = context.activeSession?.accountId ?? context.email;
    const isCurrent = () => {
      const latest = this.store.snapshot();
      return latest.isUnlocked &&
        (latest.activeSession?.accountId ?? latest.email) === accountKey;
    };
    const outcome = await this.actions.copyFieldWithOutcome(field, isCurrent);
    if (isCurrent()) {
      this.store.setStatus(outcome.status);
      if (outcome.committed) {
        this.showCopiedFeedback(itemId);
      }
    }
  }

  private showCopiedFeedback(itemId: string): void {
    if (this.copiedResetTimer) {
      clearTimeout(this.copiedResetTimer);
    }
    this.copiedItemId = itemId;
    this.copiedResetTimer = setTimeout(() => {
      this.copiedItemId = null;
      this.copiedResetTimer = undefined;
    }, 1_200);
  }
}
