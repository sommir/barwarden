# iOS 27 Documents and About Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make About, update status, third-party notices, and full licenses compact, readable, searchable, and consistent with the shared Header/row contract.

**Architecture:** About remains a retained Settings presentation with local command ownership. A small local document-search utility/component provides bounded case-insensitive search and next/previous navigation without changing route data. Notice/license readers use 14/20px typography and restore scroll/focus through the existing route cache.

**Tech Stack:** Angular, retained About overlay, Vitest, CSS tokens, raw license assets.

**Spec:** `docs/superpowers/specs/2026-08-20-ios27-full-ui-harmonization-design.md`

## Global Constraints

- Routes: `/about`, `/third-party-notices`, `/third-party-licenses`.
- About metadata rows are 44/48px; update status has one compact owner and one accessible announcement.
- Document text is 14px/20px and wraps at 200% without horizontal clipping.
- Search controls keep 44px owners and 40/36px visible fields.
- Search never inserts HTML from license text; render segments as Angular text bindings.
- Preserve update, handoff, Copy revision, notices navigation, Back, scroll, and focus behavior.

---

### Task 1: Compact About metadata and update status

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-about.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-about.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__tools__popup__settings__about-page__about-page-v2.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__tools__popup__settings__about-page__about-page-v2.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json`
- Modify: `apps/menubar-tauri/src/app/settings/about-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/settings/p1-pages.spec.ts`
- Modify: `apps/menubar-tauri/src/app/updates/app-update-notice.component.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Guard: `apps/menubar-tauri/src/app/upstream-overlays/settings/settings-overlay.guard.spec.ts`

**Interfaces:**
- Preserve all existing About outputs, `metadataView`, Copy revision states, update check/download/retry/dismiss, and external handoffs.

- [ ] **Step 1: Add RED real About geometry tests**

```ts
for (const row of host.querySelectorAll<HTMLElement>(".about-metadata-row")) {
  expect(parseFloat(getComputedStyle(row).minHeight)).toBeGreaterThanOrEqual(44);
  expect(getComputedStyle(row).boxShadow).toBe("none");
}
const update = host.querySelector<HTMLElement>(".app-update-card")!;
expect(getComputedStyle(update).borderRadius).toBe("0px");
expect(getComputedStyle(update).boxShadow).toBe("none");
expect(update.querySelectorAll('[aria-live],[role="status"],[role="alert"]')).toHaveLength(1);
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/settings/p1-pages.spec.ts apps/menubar-tauri/src/app/updates/app-update-notice.component.spec.ts`

- [ ] **Step 3: Add shared roles and compact CSS**

Append `macos-preference-group` to the metadata list, `macos-preference-row about-metadata-row` to its rows, and `macos-hit-target` to row actions through the existing retained Settings pipeline.

```css
.macos-page--about .about-version-summary { padding:8px 12px 12px; }
.macos-page--about .about-metadata-row { min-height:var(--mac-row-single); border-bottom:1px solid var(--mac-border-subtle); border-radius:0; box-shadow:none; }
.macos-page--about .app-update-card { margin:0; padding:10px 12px; border:0; border-block:1px solid var(--mac-border-subtle); border-radius:0; background:transparent; box-shadow:none; }
.macos-page--about :is(button,a) { min-height:var(--mac-hit-size); }
```

Run both Settings updaters twice and require no second-run diff.

- [ ] **Step 4: GREEN and Settings provenance**

```bash
npx vitest run apps/menubar-tauri/src/app/settings/p1-pages.spec.ts apps/menubar-tauri/src/app/updates/app-update-notice.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/settings/settings-overlay.guard.spec.ts
npm run typecheck:official-settings
```

- [ ] **Step 5: Commit**

Stage the direct and updater-owned files explicitly, then stage only the About CSS hunk:

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/settings/official-about.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/official-about.component.ts apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__tools__popup__settings__about-page__about-page-v2.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__tools__popup__settings__about-page__about-page-v2.component.html.patch
git add apps/menubar-tauri/src/app/settings/about-page.component.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts apps/menubar-tauri/src/app/updates/app-update-notice.component.spec.ts
git add -p apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: compact ios27 about and updates"
```

### Task 2: Add a safe reusable document search control

**Files:**
- Create: `apps/menubar-tauri/src/app/settings/document-search.ts`
- Create: `apps/menubar-tauri/src/app/settings/document-search.spec.ts`
- Create: `apps/menubar-tauri/src/app/settings/document-search.component.ts`
- Create: `apps/menubar-tauri/src/app/settings/document-search.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/official-i18n.service.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`

**Interfaces:**
- Produces:

```ts
export interface DocumentSearchMatch { readonly start: number; readonly end: number; }
export interface DocumentSegment { readonly text: string; readonly matchIndex: number | null; }
export function findDocumentMatches(text: string, query: string, limit?: number): readonly DocumentSearchMatch[];
export function segmentDocument(text: string, matches: readonly DocumentSearchMatch[]): readonly DocumentSegment[];
```

- `DocumentSearchComponent` inputs: `query: string`, `matchCount: number`, `activeIndex: number`; outputs: `queryChange`, `previous`, `next`.

- [ ] **Step 1: Write RED utility tests**

```ts
expect(findDocumentMatches("MIT\nmitochondria\nMIT", "mit")).toEqual([
  { start: 0, end: 3 }, { start: 4, end: 7 }, { start: 17, end: 20 },
]);
expect(findDocumentMatches("abcdef", "", 500)).toEqual([]);
expect(findDocumentMatches("aaaa", "aa", 2)).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
expect(segmentDocument("MIT License", [{ start: 0, end: 3 }])).toEqual([
  { text: "MIT", matchIndex: 0 }, { text: " License", matchIndex: null },
]);
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/settings/document-search.spec.ts`

Expected: FAIL because utility and component do not exist.

- [ ] **Step 3: Implement bounded literal search**

```ts
export function findDocumentMatches(text: string, query: string, limit = 500): readonly DocumentSearchMatch[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle.length === 0 || limit <= 0) return [];
  const haystack = text.toLocaleLowerCase();
  const matches: DocumentSearchMatch[] = [];
  for (let start = 0; matches.length < limit;) {
    const index = haystack.indexOf(needle, start);
    if (index < 0) break;
    matches.push({ start: index, end: index + needle.length });
    start = index + needle.length;
  }
  return matches;
}

export function segmentDocument(text: string, matches: readonly DocumentSearchMatch[]): readonly DocumentSegment[] {
  const segments: DocumentSegment[] = [];
  let cursor = 0;
  matches.forEach((match, matchIndex) => {
    if (cursor < match.start) segments.push({ text: text.slice(cursor, match.start), matchIndex: null });
    segments.push({ text: text.slice(match.start, match.end), matchIndex });
    cursor = match.end;
  });
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matchIndex: null });
  return segments;
}
```

Add these exact entries to `translations` and `englishTranslations` in `official-i18n.service.ts`, respectively, and assert both locales in its spec:

```ts
// translations
i18nPreviousSearchResult: "上一个搜索结果",
i18nNextSearchResult: "下一个搜索结果",

// englishTranslations
i18nPreviousSearchResult: "Previous search result",
i18nNextSearchResult: "Next search result",
```

The standalone component template is:

```html
<search class="document-search" role="search">
  <label class="macos-field-owner">
    <span class="tw-sr-only">{{ "i18nSearch" | i18n }}</span>
    <input class="macos-control-visible" data-testid="document-search-input" type="search" [value]="query"
      (input)="queryChange.emit(asInput($event).value)" />
  </label>
  <output aria-live="polite">{{ matchCount === 0 ? "0" : (activeIndex + 1) + "/" + matchCount }}</output>
  <button class="macos-hit-target" data-testid="document-search-previous" type="button" [disabled]="matchCount === 0" (click)="previous.emit()" [attr.aria-label]="'i18nPreviousSearchResult' | i18n"><i class="bwi bwi-angle-up" aria-hidden="true"></i></button>
  <button class="macos-hit-target" data-testid="document-search-next" type="button" [disabled]="matchCount === 0" (click)="next.emit()" [attr.aria-label]="'i18nNextSearchResult' | i18n"><i class="bwi bwi-angle-down" aria-hidden="true"></i></button>
</search>
```

Implement the component class exactly as:

```ts
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { I18nPipe } from "../official-ui/official-ui-common";

@Component({
  selector: "bw-document-search",
  standalone: true,
  imports: [I18nPipe],
  template: `
    <search class="document-search" role="search">
      <label class="macos-field-owner">
        <span class="tw-sr-only">{{ "i18nSearch" | i18n }}</span>
        <input class="macos-control-visible" data-testid="document-search-input" type="search" [value]="query"
          (input)="queryChange.emit(asInput($event).value)" />
      </label>
      <output aria-live="polite">{{ matchCount === 0 ? "0" : (activeIndex + 1) + "/" + matchCount }}</output>
      <button class="macos-hit-target" data-testid="document-search-previous" type="button" [disabled]="matchCount === 0"
        (click)="previous.emit()" [attr.aria-label]="'i18nPreviousSearchResult' | i18n">
        <i class="bwi bwi-angle-up" aria-hidden="true"></i>
      </button>
      <button class="macos-hit-target" data-testid="document-search-next" type="button" [disabled]="matchCount === 0"
        (click)="next.emit()" [attr.aria-label]="'i18nNextSearchResult' | i18n">
        <i class="bwi bwi-angle-down" aria-hidden="true"></i>
      </button>
    </search>
  `,
})
export class DocumentSearchComponent {
  @Input() query = "";
  @Input() matchCount = 0;
  @Input() activeIndex = 0;
  @Output() readonly queryChange = new EventEmitter<string>();
  @Output() readonly previous = new EventEmitter<void>();
  @Output() readonly next = new EventEmitter<void>();

  asInput(event: Event): HTMLInputElement {
    if (!(event.target instanceof HTMLInputElement)) {
      throw new TypeError("Document search input target must be an HTMLInputElement");
    }
    return event.target;
  }
}
```

Add:

```css
.document-search { display:grid; grid-template-columns:minmax(0,1fr) auto 44px 44px; align-items:center; gap:4px; }
.document-search output { min-width:44px; color:var(--mac-text-secondary); font-size:12px; text-align:center; }
```

- [ ] **Step 4: GREEN component/geometry tests**

```bash
npx vitest run apps/menubar-tauri/src/app/settings/document-search.spec.ts apps/menubar-tauri/src/app/settings/document-search.component.spec.ts apps/menubar-tauri/src/app/official-ui/official-i18n-source-audit.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/settings/document-search.ts apps/menubar-tauri/src/app/settings/document-search.spec.ts apps/menubar-tauri/src/app/settings/document-search.component.ts apps/menubar-tauri/src/app/settings/document-search.component.spec.ts
git add -p apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts apps/menubar-tauri/src/app/official-ui/official-i18n.service.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "feat: add accessible document search"
```

### Task 3: Apply compact reader and search to notices/licenses

**Files:**
- Modify: `apps/menubar-tauri/src/app/settings/third-party-notices-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/settings/third-party-notices-page.component.html`
- Modify: `apps/menubar-tauri/src/app/settings/third-party-notices-page.component.css`
- Modify: `apps/menubar-tauri/src/app/settings/third-party-notices-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.html`
- Modify: `apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.css`
- Modify: `apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts`

**Interfaces:**
- `ThirdPartyLicensesPageComponent` owns `query`, `matches`, `segments`, `activeIndex`, `setQuery`, `previousMatch`, `nextMatch` and `focusActiveMatch`.
- Notice groups filter by literal expression; complete-license route remains unchanged.

- [ ] **Step 1: Add RED behavior/reader tests**

```ts
const component = fixture.componentInstance;
const search = host.querySelector<HTMLInputElement>('[data-testid="document-search-input"]')!;
search.value = "Apache";
search.dispatchEvent(new Event("input", { bubbles: true }));
fixture.detectChanges();
expect(component.matches.length).toBeGreaterThan(0);
expect(host.querySelectorAll("mark[data-document-match]").length).toBe(component.matches.length);
host.querySelector<HTMLButtonElement>('[data-testid="document-search-next"]')!.click();
await fixture.whenStable();
fixture.detectChanges();
expect(document.activeElement).toBe(host.querySelector('[data-document-match="1"]'));
expect(getComputedStyle(host.querySelector(".third-party-license-text")!).fontSize).toBe("14px");
expect(getComputedStyle(host.querySelector(".third-party-license-text")!).lineHeight).toBe("20px");
```

At 200% fixture scaling assert `scrollWidth <= clientWidth` and wrapped text remains visible.

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/settings/third-party-notices-page.component.spec.ts apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.spec.ts`

- [ ] **Step 3: Wire search with text-only segment bindings**

Replace the raw license `<pre>` body with:

```html
<bw-document-search [query]="query" [matchCount]="matches.length" [activeIndex]="activeIndex"
  (queryChange)="setQuery($event)" (previous)="previousMatch()" (next)="nextMatch()" />
<pre class="third-party-license-text" data-testid="third-party-license-text" tabindex="0">@for (segment of segments; track $index) {@if (segment.matchIndex === null) {<ng-container>{{ segment.text }}</ng-container>} @else {<mark [attr.data-document-match]="segment.matchIndex" [attr.tabindex]="segment.matchIndex === activeIndex ? 0 : -1">{{ segment.text }}</mark>}}</pre>
```

Implement navigation with modulo arithmetic and `queueMicrotask(() => focusActiveMatch())`; `focusActiveMatch` calls `scrollIntoView({ block: "center" })` and `focus({ preventScroll: true })` on the active mark.

Add these exact members to `ThirdPartyLicensesPageComponent`, inject
`ElementRef<HTMLElement>` as `elementRef`, and import the utility/component:

```ts
query = "";
matches: readonly DocumentSearchMatch[] = [];
segments: readonly DocumentSegment[] = [{ text: this.licenseText, matchIndex: null }];
activeIndex = 0;

setQuery(query: string): void {
  this.query = query;
  this.matches = findDocumentMatches(this.licenseText, query);
  this.segments = segmentDocument(this.licenseText, this.matches);
  this.activeIndex = 0;
}

previousMatch(): void {
  if (this.matches.length === 0) return;
  this.activeIndex = (this.activeIndex - 1 + this.matches.length) % this.matches.length;
  queueMicrotask(() => this.focusActiveMatch());
}

nextMatch(): void {
  if (this.matches.length === 0) return;
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
```

For notices, add the search control and filter `licenseGroups` by `expression.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())`; retain count values and route action.

```css
.third-party-license-text { margin:0; padding:12px 0; max-width:100%; overflow-wrap:anywhere; white-space:pre-wrap; font:400 14px/20px ui-monospace,SFMono-Regular,Menlo,monospace; }
.third-party-license-text mark { color:inherit; background:var(--mac-selected); border-radius:3px; }
.third-party-notices-counts { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.third-party-notices-count-card { padding:8px 12px; border:0; border-radius:0; background:transparent; box-shadow:none; }
```

- [ ] **Step 4: Complete document gate**

```bash
npx vitest run apps/menubar-tauri/src/app/settings/third-party-notices-page.component.spec.ts apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.spec.ts apps/menubar-tauri/src/app/settings/document-search.spec.ts apps/menubar-tauri/src/app/settings/document-search.component.spec.ts apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts
npm run typecheck:official-settings
npm run build:web
```

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/settings/document-search.component.ts apps/menubar-tauri/src/app/settings/third-party-notices-page.component.ts apps/menubar-tauri/src/app/settings/third-party-notices-page.component.html apps/menubar-tauri/src/app/settings/third-party-notices-page.component.css apps/menubar-tauri/src/app/settings/third-party-notices-page.component.spec.ts apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.ts apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.html apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.css apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.spec.ts
git diff --cached --check
git commit -m "style: harmonize ios27 document readers"
```
