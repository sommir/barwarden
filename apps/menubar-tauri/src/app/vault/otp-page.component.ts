import { Component, OnDestroy } from "@angular/core";

import { PopupPageComponent } from "../layout/popup-page.component";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { RootSearchComponent } from "../layout/root-search.component";
import { PopupHeaderActionsComponent } from "../popup-header-actions.component";
import { PopupStateStore } from "../popup-state";
import type { VaultField } from "../vault-demo";
import { OtpCodeRowComponent } from "./otp-code-row.component";
import { OtpFacade } from "./otp.facade";
import { buildOtpEntries } from "./otp-items";
import { VaultActionsService } from "./vault-actions.service";
import { I18nPipe } from "../official-ui/official-ui-common";
import { translateOfficialMessage } from "../official-ui/official-i18n.service";

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
      <span
        class="tw-sr-only"
        data-testid="result-announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        @for (publication of resultAnnouncementPublications; track publication.revision) {
          <span [attr.data-result-announcement-revision]="publication.revision">{{ resultAnnouncement }}</span>
        }
      </span>

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
  resultAnnouncement = "";
  resultAnnouncementPublications: readonly { readonly revision: number }[] = [];
  protected copiedItemId: string | null = null;
  private copiedResetTimer?: ReturnType<typeof setTimeout>;
  private resultAnnouncementRevision = 0;
  private entriesCache?: {
    readonly items: ReturnType<PopupStateStore["snapshot"]>["items"];
    readonly query: string;
    readonly result: ReturnType<typeof buildOtpEntries>;
  };

  constructor(
    private readonly store: PopupStateStore,
    private readonly actions: VaultActionsService,
    private readonly otp: OtpFacade,
  ) {}

  protected get query(): string {
    return this.otp.query();
  }

  protected get entries() {
    const items = this.store.snapshot().items;
    const query = this.otp.query();
    if (this.entriesCache?.items === items && this.entriesCache.query === query) {
      return this.entriesCache.result;
    }

    const result = buildOtpEntries(items, query);
    this.entriesCache = { items, query, result };
    return result;
  }

  protected setSearch(query: string): void {
    const previousIdentity = visibleOtpResultIdentity(this.entries);
    this.otp.setSearch(query);
    this.updateResultAnnouncement(previousIdentity, visibleOtpResultIdentity(this.entries));
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

  private updateResultAnnouncement(
    previousIdentity: readonly string[],
    identity: readonly string[],
  ): void {
    if (sameResultIdentity(previousIdentity, identity)) {
      return;
    }
    this.resultAnnouncement = translateOfficialMessage("i18nItemsCount", identity.length);
    this.resultAnnouncementRevision += 1;
    this.resultAnnouncementPublications = [{ revision: this.resultAnnouncementRevision }];
  }
}

function visibleOtpResultIdentity(
  entries: ReturnType<typeof buildOtpEntries>,
): readonly string[] {
  return entries.map((entry) => entry.item.id);
}

function sameResultIdentity(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
