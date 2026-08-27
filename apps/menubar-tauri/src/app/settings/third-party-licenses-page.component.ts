import { Component, ElementRef } from "@angular/core";

import completeLicenseText from "../../../../../THIRD_PARTY_LICENSES.txt?raw";
import { PopupHeaderComponent } from "../layout/popup-header.component";
import { PopupPageComponent } from "../layout/popup-page.component";
import { I18nPipe } from "../official-ui/official-ui-common";
import { PopupRouterCacheService } from "../platform/popup-router-cache.service";
import { DocumentSearchComponent } from "./document-search.component";
import {
  findDocumentMatches,
  segmentDocument,
  type DocumentSearchMatch,
  type DocumentSegment,
} from "./document-search";

@Component({
  selector: "bw-third-party-licenses-page",
  host: {
    class: "macos-page macos-page--secondary macos-page--third-party-licenses",
  },
  standalone: true,
  imports: [DocumentSearchComponent, I18nPipe, PopupHeaderComponent, PopupPageComponent],
  templateUrl: "./third-party-licenses-page.component.html",
  styleUrl: "./third-party-licenses-page.component.css",
})
export class ThirdPartyLicensesPageComponent {
  readonly licenseText = completeLicenseText;
  query = "";
  matches: readonly DocumentSearchMatch[] = [];
  segments: readonly DocumentSegment[] = [{ text: this.licenseText, matchIndex: null }];
  activeIndex = 0;

  readonly backAction: import("@bitwarden/components").FunctionReturningAwaitable = () =>
    this.routeCache.back();

  constructor(
    private readonly routeCache: PopupRouterCacheService,
    private readonly elementRef: ElementRef<HTMLElement>,
  ) {}

  setQuery(query: string): void {
    this.query = query;
    this.matches = findDocumentMatches(this.licenseText, query);
    this.segments = segmentDocument(this.licenseText, this.matches);
    this.activeIndex = 0;
  }

  previousMatch(): void {
    if (this.matches.length === 0) {
      return;
    }
    this.activeIndex = (this.activeIndex - 1 + this.matches.length) % this.matches.length;
    queueMicrotask(() => this.focusActiveMatch());
  }

  nextMatch(): void {
    if (this.matches.length === 0) {
      return;
    }
    this.activeIndex = (this.activeIndex + 1) % this.matches.length;
    queueMicrotask(() => this.focusActiveMatch());
  }

  private focusActiveMatch(): void {
    const match = this.elementRef.nativeElement.querySelector<HTMLElement>(
      `[data-document-match="${this.activeIndex}"]`,
    );
    match?.scrollIntoView({ block: "center" });
    match?.focus({ preventScroll: true });
  }
}
