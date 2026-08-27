# iOS 27 Generator and Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Generator, Generator History, and all Text Send routes to the approved flat iOS 27 hierarchy while preserving retained behavior and adding consistent keyboard, focus, validation, compact-mode, and VoiceOver contracts.

**Architecture:** Route components remain state/command owners; retained overlays remain typed presentation inputs/outputs. Generator templates stay reproducible through `generatorTemplateContracts`. Send list/list-row/created HTML stay reproducible through static `sendTemplateContracts`, while Send TypeScript and form/detail/options HTML continue through existing bounded unified patches. CSS is scoped to Generator/Send hooks.

**Tech Stack:** Angular standalone components, retained Bitwarden overlays, RxJS, Vitest/JSDOM, native Tauri QA, CSS custom properties, exact transform contracts, SHA-256 manifests. Playwright/Chromium is an optional supplement only after explicit user authorization.

## Global Constraints

- Baseline viewport: exactly 480 × 600 px.
- Horizontal padding: 16 px; group gap: 20–24 px; rows: 52 px; compact auxiliary rows: at least 44 px.
- Every icon/action hit target is at least 44 × 44 px.
- Inputs/segmented controls use 10–12 px radii; ordinary groups have no shadow or row gaps.
- Only menus, Sheets, confirmations, and danger dialogs use 12–16 px radii and one light shadow.
- Blue is primary, red is danger, and color is never the sole state indicator.
- Motion is 150–220 ms; reduced-motion and `data-bw-animations="false"` remove nonessential motion.
- Do not add routes/assets or move generator persistence, Send mutation, clipboard, stale-result, security, or ownership logic into presentation components.
- Generator templates are guarded by `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts`; refresh with `npm run update:official-generator-manifest`.
- Send list/list-item/created **HTML** are static transforms in `official-send-member-transforms.ts`; do not create HTML patches for them.
- Send list/list-item/created **TypeScript** use existing `source-patches/*.ts.patch`; the Send manifest updater regenerates them.
- Send add/edit/details/text-details/options HTML and TypeScript use their existing source patches; never replace them with whole-file transforms.
- Preserve all loading, pending, retry, dirty, policy, expiry, duplicate, account/lock/route teardown, and same-ID stale branches.
- The worktree contains unrelated user changes. Review per-file diffs and stage only paths in the current task.
- Every task that touches `apps/menubar-tauri/src/styles/global.css` must stage it with `git add -p`, then inspect both `git diff --cached --name-only` and `git diff --cached -- apps/menubar-tauri/src/styles/global.css`; abort the commit if the name list or CSS hunks contain anything outside that task.
- Do not execute or modify Playwright/Chromium workflows unless the user explicitly authorizes Chromium for that QA run. Native Tauri is the default visual and interaction acceptance environment.
- New QA images under ignored documentation paths must be staged with `git add -f` and their exact file paths, never with a directory-wide add.
- Native evidence must start with `VITE_BW_VAULT_EVIDENCE=true` and one of the fixed synthetic queries documented in Task 7. It must never reuse a personal account, password, Send body, Send URL, or previously authenticated vault as fixture input.
- Main-tab focus restoration remains memory-only in the authoritative `PopupRouterCacheService.tabSnapshots` contract from `2026-08-17-ios27-interaction-accessibility-qa.md`. Producer keys may contain fixed action names, synthetic record IDs, or timestamps, but never a generated credential, password, Send text, Send URL, label, or translated visible text. Do not introduce a second registry or focus-key attribute.

---

## File Ownership

| Family | Responsibility | Pipeline |
|---|---|---|
| `app/generator/*.ts` | Generator route/state ownership | direct local source |
| `upstream-overlays/generator/official-*` | Generator presentation | member/template transforms + manifest |
| `send-page.component.ts` | list commands/delete Sheet/link copy | direct local source |
| `send-add-edit-page.component.ts` | form reveal/focus/dirty/pending ownership | direct local source |
| `retained-text-send-form.service.ts` | values/errors/valid/draft | direct local source |
| Send list/list-items/created HTML | retained presentation | static template transforms |
| Send list/list-items/created TS | typed inputs/outputs | existing TS patches |
| Send form/detail/options HTML/TS | retained form presentation | existing HTML/TS patches |
| `global.css` | page-family visual rules | direct; edit serially |
| `PopupRouterCacheService.tabSnapshots` | five-main-tab scroll/focus capture and restoration | owned by the interaction/accessibility plan; this plan only publishes Generator/Send producers |

Implement Tasks 1–7 in order.

### Task 1: Put Generator result first and flatten settings

**Files:**
- Create: `apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.html:1-14`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-core.component.html:1-107`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts:618-668`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts:53-64`
- Modify: `apps/menubar-tauri/src/app/generator/generator-page.component.spec.ts:18-29`
- Modify: `apps/menubar-tauri/src/styles/global.css:2790-2818,2963-2990`

**Interfaces:**
- Consumes unchanged `value$`, `root$`, `rootOptions$`, `algorithm$`, dynamic copy/generate labels, `bwGeneratorClipboard`, and `/generator-history`.
- Produces `.macos-generator`, `__result`, `__mode`, `__settings`, `__history-link`; no business output.

- [ ] **Step 1: Write RED hierarchy and visual tests**

Add to `official-credential-generator.component.spec.ts`:

```ts
it("puts a labelled result before mode/settings with one primary copy action", async () => {
  const { fixture } = await createFixture();
  await render(fixture);
  const host = fixture.nativeElement as HTMLElement;
  const result = host.querySelector<HTMLElement>(".macos-generator__result")!;
  const mode = host.querySelector<HTMLElement>(".macos-generator__mode")!;
  const settings = host.querySelector<HTMLElement>(".macos-generator__settings")!;
  const copy = host.querySelector<HTMLButtonElement>('[data-testid="generator-copy"]')!;
  const regenerate = host.querySelector<HTMLButtonElement>('[data-testid="generator-regenerate"]')!;
  expect(result.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(mode.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(result.getAttribute("aria-labelledby")).toBe("generator-result-title");
  expect(copy.getAttribute("aria-label")).toBeTruthy();
  expect(copy.getAttribute("buttontype")).toBe("primary");
  expect(regenerate.getAttribute("buttontype")).toBe("primaryGhost");
  expect(host.querySelectorAll(".macos-generator__mode bit-toggle-group")).toHaveLength(1);
  expect(host.querySelector('.macos-generator__history-link[routerlink="/generator-history"]')).not.toBeNull();
});
```

Create `generator-send-ios27.visual.spec.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const css = readFileSync(resolve(process.cwd(), "apps/menubar-tauri/src/styles/global.css"), "utf8");
describe("iOS 27 Generator and Send visual contract", () => {
  it("keeps Generator ordinary surfaces flat and controls touch-safe", () => {
    expect(css).toMatch(/\.macos-generator__result\s*\{[^}]*border-radius:\s*0[^}]*box-shadow:\s*none/s);
    expect(css).toMatch(/\.macos-generator__settings\s+:is\(bit-card,\s*bit-section\)\s*\{[^}]*box-shadow:\s*none/s);
    expect(css).toMatch(/\.macos-generator\s+:is\(button,\s*a\)[^{]*\{[^}]*min-height:\s*44px/s);
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`

Expected: FAIL on absent hooks/CSS and old toggle-before-result order.

- [ ] **Step 3: Implement the minimal hierarchy**

Use this wrapper runtime:

```html
<popup-page class="macos-generator">
  <popup-header slot="header" [pageTitle]="'generator' | i18n">
    <ng-container slot="end"><bw-popup-header-actions /></ng-container>
  </popup-header>
  <bw-official-generator-core />
  <bit-item class="macos-generator__history-row">
    <a class="macos-generator__history-link" bit-item-content routerLink="/generator-history">
      {{ "generatorHistory" | i18n }}
      <i slot="end" class="bwi bwi-angle-right" aria-hidden="true"></i>
    </a>
  </bit-item>
</popup-page>
```

Reorder the core into these exact regions, retaining the existing algorithm/settings bodies inside the last section:

```html
<section class="macos-generator__result" aria-labelledby="generator-result-title">
  <h2 id="generator-result-title" class="tw-sr-only">{{ "generator" | i18n }}</h2>
  <div class="macos-generator__value">
    @let generatedValue = value$ | async;
    @if (generatedValue) { <bit-color-password class="tw-font-mono" [password]="generatedValue" /> }
    @else { <p class="macos-generator-preparing" role="status">{{ "i18nGenerating" | i18n }}</p> }
  </div>
  <div class="macos-generator__result-actions">
    <button data-testid="generator-copy" type="button" bitIconButton="bwi-clone" buttonType="primary"
      [label]="credentialTypeCopyLabel$ | async" [valueLabel]="credentialTypeLabel$ | async"
      [disabled]="!(algorithm$ | async)" [bwGeneratorClipboard]="value$ | async"></button>
    <button data-testid="generator-regenerate" type="button" bitIconButton="bwi-generate"
      buttonType="primaryGhost" (click)="generate(USER_REQUEST)"
      [label]="credentialTypeGenerateLabel$ | async" [disabled]="!(algorithm$ | async)"></button>
  </div>
</section>
<section class="macos-generator__mode">
  <bit-toggle-group fullWidth [selected]="(root$ | async).nav"
    (selectedChange)="onRootChanged({ nav: $event })" attr.aria-label="{{ 'type' | i18n }}">
    @for (option of rootOptions$ | async; track option) {
      <bit-toggle [value]="option.value">{{ option.label }}</bit-toggle>
    }
  </bit-toggle-group>
</section>
```

Insert `<section class="macos-generator__settings">` immediately before the existing `@let showAlgorithm = showAlgorithm$ | async;` line and insert `</section>` immediately after the closing brace of the existing `@if ((category$ | async) !== "password")` block. Do not change the contents of lines 47–107 or any `(onUpdated)` event. In `generatorTemplateContracts`, update only the core and popup HTML contracts with bounded operations around the changed blocks; never search/replace the complete authority file.

Add scoped CSS:

```css
.macos-generator__result { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; margin:0 16px 20px; border:0; border-bottom:1px solid var(--mac-border-subtle); border-radius:0; padding:16px 0 20px; background:transparent; box-shadow:none; }
.macos-generator__value { min-width:0; overflow-wrap:anywhere; }
.macos-generator__result-actions { display:flex; align-items:center; gap:4px; }
.macos-generator__mode { margin:0 16px 20px; }
.macos-generator__settings { margin:0 16px; }
.macos-generator__settings :is(bit-card, bit-section) { border:0; border-radius:0; background:transparent; box-shadow:none; }
.macos-generator :is(button, a) { min-width:44px; min-height:44px; }
.macos-generator__history-row { border-radius:0; box-shadow:none; }
.macos-generator__history-link { min-height:52px; }
:root[data-bw-compact-mode="true"] .macos-generator__history-link { min-height:44px; }
```

- [ ] **Step 4: GREEN, guards, typecheck**

```bash
npm run update:official-generator-manifest
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/generator/generator-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/generator/generator-source-direct-correction.spec.ts apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts apps/menubar-tauri/src/app/generator/generator-page.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
npm run typecheck:official-generator
```

Expected: PASS, including exact template reproduction and `build:web` inside typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.html apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-core.component.html apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts apps/menubar-tauri/src/app/generator/generator-page.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --name-only
git diff --cached -- apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: flatten ios27 generator"
```

### Task 2: Flatten Generator History and focus Cancel first

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.html:1-73`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.ts:43-115`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history-rows.component.html:1-22`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts:391-539,670-712`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts:61-343`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.spec.ts:129-142`
- Modify: `apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`

**Interfaces:** Consumes `AppBottomSheetComponent.open(trigger, initialFocus)` and current history adapter streams; produces `__content`, `__row`, and `#clearCancel`; preserves retry, focus restoration, sanitization, and stale ownership.

- [ ] **Step 1: Write RED tests**

```ts
it("renders continuous rows and opens clear confirmation on Cancel", async () => {
  const { fixture } = await setup(generatorService({ history: vi.fn(async () => [credential("password", "value")]) }));
  await render(fixture);
  const host = fixture.nativeElement as HTMLElement;
  expect(host.querySelector(".macos-generator-history__content")).not.toBeNull();
  expect(host.querySelector(".macos-generator-history__row button")?.getAttribute("aria-label")).toBe("复制密码");
  useDialogFallback(dialog(host));
  const trigger = clearButton(host); trigger.focus(); trigger.click(); await settle(fixture);
  const cancel = button(host, "取消", "dialog");
  expect(document.activeElement).toBe(cancel);
  cancel.click(); await settle(fixture);
  expect(document.activeElement).toBe(trigger);
});
```

Extend visual spec with assertions for a 52 px radius-0 row, 44 px row button, and shadowless content.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`

Expected: FAIL on hooks and current `clearConfirm` initial focus.

- [ ] **Step 3: Implement**

Wrap loaded content with `<section class="macos-generator-history__content" aria-live="polite">`, add `class="macos-generator-history__row"` to each retained row, and change the component to:

```ts
@ViewChild("clearCancel", { read: ElementRef }) private clearCancel?: ElementRef<HTMLButtonElement>;
clear = async (): Promise<void> => {
  const sheet = this.clearDialog;
  if (!sheet || sheet.nativeElement.open || this.history.loading.value || this.history.clearing.value) return;
  if (this.history.credentials.value.length === 0) return;
  this.history.statusMessage.next(null);
  sheet.open(this.clearTrigger?.nativeElement, this.clearCancel?.nativeElement);
};
```

Order Sheet footer Cancel then danger Clear, with `#clearCancel` on Cancel. Update the history parent member contract plus parent/row template contracts. Add:

```css
.macos-generator-history__content { margin:0 16px; background:transparent; box-shadow:none; }
.macos-generator-history__row { min-height:52px; border:0; border-bottom:1px solid var(--mac-border-subtle); border-radius:0; background:transparent; box-shadow:none; }
.macos-generator-history__row button { min-width:44px; min-height:44px; }
:root[data-bw-compact-mode="true"] .macos-generator-history__row { min-height:44px; }
```

- [ ] **Step 4: Run GREEN verification**

```bash
npm run update:official-generator-manifest
npx vitest run apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts apps/menubar-tauri/src/app/generator/generator-history.store.spec.ts apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/generator/generator-overlay.guard.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
npm run typecheck:official-generator
```

Expected: PASS, including history retry/concurrency/focus restoration and exact transform guards.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.html apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.ts apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history-rows.component.html apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.spec.ts apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --name-only
git diff --cached -- apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: flatten ios27 generator history"
```

### Task 3: Send Copy link plus keyboard More menu

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.html:1-89`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.html:1-61`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.ts:1-58`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-member-transforms.ts:1-303,363-376,547-568`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-list-items-container.component.ts.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.spec.ts:29-94`
- Modify: `apps/menubar-tauri/src/app/send/send-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css:3015-3031,4267-4301`

**Interfaces:** Preserve exactly `open`, `copyLink`, `delete`, `queryChange`, `toggleFilters`, and `filterChange` output types currently declared in the two official components.

- [ ] **Step 1: Write RED isolation/menu test**

```ts
it("isolates row, Copy link, and danger Delete in More", async () => {
  const fixture = await createFixture({ sends: [textSend()], state: "ready" });
  const commands = outputCommands(fixture.componentInstance); fixture.detectChanges();
  const row = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(".macos-send-row")!;
  row.querySelector<HTMLButtonElement>("[bit-item-content]")!.click();
  row.querySelector<HTMLButtonElement>('[aria-label^="复制链接"]')!.click();
  const more = row.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  expect(more.getAttribute("aria-label")).toContain("Payroll token");
  expect(row.querySelector('[biticonbutton="bwi-trash"]')).toBeNull();
  more.click(); await fixture.whenStable();
  const danger = document.querySelector<HTMLButtonElement>('.bit-menu-panel [role="menuitem"].tw-text-fg-danger')!;
  danger.click();
  expect(commands).toEqual(["open:send-1", "copy:send-1", "delete:send-1"]);
});
```

Add visual assertions for `.macos-send-list` shadow none, `.macos-send-row` 52 px/radius 0, and action buttons 44 × 44.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`

Expected: FAIL on direct trash, absent menu/hooks, 12 px list gap, and 72 px legacy row.

- [ ] **Step 3: Implement with official Menu components**

Import `MenuComponent`, `MenuItemComponent`, and `MenuTriggerForDirective` from `../../official-ui/official-components` and register them in `imports`. Keep row navigation and Copy, replace direct Delete with:

```html
<bit-item-action class="macos-send-row__actions">
  <button type="button" bitIconButton="bwi-ellipsis-v" size="small"
    [label]="(('i18nMore' | i18n) + ' - ' + send.name)" [bitMenuTriggerFor]="sendActions"></button>
  <bit-menu #sendActions [ariaLabel]="(('i18nMore' | i18n) + ' - ' + send.name)">
    <button type="button" bitMenuItem variant="danger" (click)="delete.emit(send)">
      {{ "i18nDelete" | i18n }}
    </button>
  </bit-menu>
</bit-item-action>
```

Add `.macos-send-list` to `bit-item-group`, `.macos-send-row` to `bit-item`, and CSS:

```css
.macos-send-list { display:block; border:0; border-radius:0; background:transparent; box-shadow:none; }
.macos-send-row { min-height:52px; border:0; border-bottom:1px solid var(--mac-border-subtle); border-radius:0; background:transparent; box-shadow:none; }
.macos-send-row__actions button { min-width:44px; min-height:44px; }
:root[data-bw-compact-mode="true"] .macos-send-row { min-height:44px; }
```

Update `sendListTemplateTransforms`/`sendRowTemplateTransforms` for HTML. Update `sendTypeScriptContracts.requiredImports`; let the manifest updater regenerate the existing list-items TS patch. Do not create list/list-items HTML patches.

- [ ] **Step 4: Run GREEN verification**

```bash
npm run update:official-send-manifest
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/send/send-overlay.guard.spec.ts apps/menubar-tauri/src/app/send/send-page.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
npm run typecheck:official-send
```

Expected: PASS; list/list-item HTML reproduce through static transforms and list-item TypeScript through its generated patch.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.html apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.html apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-member-transforms.ts apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-list-items-container.component.ts.patch apps/menubar-tauri/src/app/upstream-overlays/send/official-send.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.spec.ts apps/menubar-tauri/src/app/send/send-page.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --name-only
git diff --cached -- apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "feat: add accessible send row actions"
```

### Task 4: Blur validation, submit-all errors, first-error focus, flat form groups

**Files:**
- Modify: `apps/menubar-tauri/src/app/send/retained-text-send-form.service.ts:1-94`
- Modify: `apps/menubar-tauri/src/app/send/retained-text-send-form.service.spec.ts:1-126`
- Modify: `apps/menubar-tauri/src/app/send/send-add-edit-page.component.ts:1-334`
- Modify: `apps/menubar-tauri/src/app/send/send-page.component.spec.ts:903-1637`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-add-edit.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-add-edit.component.ts.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-details.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-details.component.ts.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-text-details.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-text-details.component.ts.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-options.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-options.component.ts.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-member-transforms.ts:383-619`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.spec.ts:17-60`
- Modify: `apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`

**Interfaces:**

```ts
export type RetainedTextSendField = "name" | "text" | "password" | "maxAccessCount";
export type RetainedTextSendError = "required" | "invalid-positive-integer";
export type RetainedTextSendErrors = Readonly<Partial<Record<RetainedTextSendField, RetainedTextSendError>>>;
```

`RetainedTextSendFormService.errors(): RetainedTextSendErrors`; official add/edit consumes `errors` and `touched`, emits `fieldBlur`, and exposes `focusFirstError(errors): void`.

- [ ] **Step 1: Write RED tests**

```ts
it("returns stable field errors in visual focus order", () => {
  const form = new RetainedTextSendFormService({ hideEmailAllowed: true });
  form.initialize({ ...validValue(), name:" ", text:"", authType:"password", password:"", maxAccessCount:"1.5" });
  expect(form.errors()).toEqual({ name:"required", text:"required", password:"required", maxAccessCount:"invalid-positive-integer" });
  form.patch({ name:"Name", text:"Body", password:"secret", maxAccessCount:"2" });
  expect(form.errors()).toEqual({});
});
```

Add to Send page tests:

```ts
it("reveals all submit errors, focuses name first, and clears a corrected blur error", async () => {
  const fixture = await createAddEditFixture("text", { session: fakeAuthSession() });
  fixture.detectChanges(); const host = fixture.nativeElement as HTMLElement;
  host.querySelector<HTMLButtonElement>('[data-testid="save-send"]')!.click();
  fixture.detectChanges(); await fixture.whenStable();
  const name = host.querySelector<HTMLInputElement>("#send-name")!;
  expect(document.activeElement).toBe(name);
  expect(host.querySelector('#send-text[aria-invalid="true"]')).not.toBeNull();
  expect(host.querySelectorAll('[data-testid^="send-error-"]')).toHaveLength(2);
  name.value="Valid"; name.dispatchEvent(new Event("input", { bubbles:true }));
  name.dispatchEvent(new FocusEvent("blur", { bubbles:true })); fixture.detectChanges();
  expect(host.querySelector('[data-testid="send-error-name"]')).toBeNull();
});
```

Update the existing add-form test: Save is enabled when invalid so submit can reveal errors.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run apps/menubar-tauri/src/app/send/retained-text-send-form.service.spec.ts apps/menubar-tauri/src/app/send/send-page.component.spec.ts`

Expected: FAIL on missing error API/bindings/ids/focus and disabled Save.

- [ ] **Step 3: Implement service and page ownership**

```ts
errors(): RetainedTextSendErrors {
  const errors: Partial<Record<RetainedTextSendField, RetainedTextSendError>> = {};
  if (!this.current.name.trim()) errors.name = "required";
  if (!this.current.text.trim()) errors.text = "required";
  if (this.current.authType === "password" && this.original.authType !== "password" && !this.current.password.trim()) errors.password = "required";
  if (this.maxAccessCount() === null) errors.maxAccessCount = "invalid-positive-integer";
  return errors;
}
valid(): boolean { return Object.keys(this.errors()).length === 0; }
```

In the page:

```ts
@ViewChild(OfficialSendAddEditComponent) private presentation?: OfficialSendAddEditComponent;
readonly touched = new Set<RetainedTextSendField>();
get errors(): RetainedTextSendErrors { return this.form.errors(); }
fieldBlur(field: RetainedTextSendField): void { this.touched.add(field); this.changeDetectorRef.markForCheck(); }
```

At the start of `save()` after destroyed/ownership/pending gates:

```ts
const errors = this.form.errors();
if (Object.keys(errors).length > 0) {
  for (const field of Object.keys(errors) as RetainedTextSendField[]) this.touched.add(field);
  this.changeDetectorRef.detectChanges();
  this.presentation?.focusFirstError(errors);
  return;
}
```

Pass `[errors]`, `[touched]`, and `(fieldBlur)` through add/edit → details → text-details/options. Add to add/edit TS:

```ts
readonly errors = input.required<RetainedTextSendErrors>();
readonly touched = input.required<ReadonlySet<RetainedTextSendField>>();
readonly fieldBlur = output<RetainedTextSendField>();
focusFirstError(errors: RetainedTextSendErrors): void {
  const first = (["name","text","password","maxAccessCount"] as const).find((field) => errors[field]);
  if (first) document.getElementById(`send-${first}`)?.focus();
}
```

Each field uses stable id, blur, `aria-invalid`, `aria-describedby`, and error. Name pattern:

```html
<input id="send-name" bitInput [value]="value().name"
  [attr.aria-invalid]="touched().has('name') && errors().name ? 'true' : null"
  [attr.aria-describedby]="touched().has('name') && errors().name ? 'send-error-name' : null"
  (input)="valueChange.emit({ name: inputValue($event) })" (blur)="fieldBlur.emit('name')" />
@if (touched().has("name") && errors().name) {
  <p id="send-error-name" data-testid="send-error-name" role="alert" class="macos-send-form__error">{{ "inputRequired" | i18n }}</p>
}
```

Repeat with `send-text`, `send-password`, `send-maxAccessCount`. Maximum count is `type="number" min="1" step="1" inputmode="numeric"`; its error uses `{{ "inputMinValue" | i18n: 1 }}`. Save locks only policy/pending and sets `aria-busy`; pending values stay readable. Replace ordinary `bit-card` form shells with `.macos-send-form__group` divs.

```css
.macos-send-form__group { margin:0; border:0; border-radius:0; background:transparent; box-shadow:none; }
.macos-send-form__field { padding-block:10px; border-bottom:1px solid var(--mac-border-subtle); }
.macos-send-form__error { margin:4px 0 0; color:var(--mac-destructive); font-size:12px; line-height:1.35; }
.macos-send-form__field :is(input,textarea,select) { border-radius:10px; }
.macos-send-form__field :is(input,textarea,select):focus-visible { outline:2px solid var(--mac-focus); outline-offset:2px; }
```

All form/detail/options files remain source-patch owned. Run updater to regenerate existing patches; update required members/imports in TS contracts. Do not introduce a new transform mode.

- [ ] **Step 4: Run GREEN verification**

```bash
npm run update:official-send-manifest
npx vitest run apps/menubar-tauri/src/app/send/retained-text-send-form.service.spec.ts apps/menubar-tauri/src/app/send/send-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/send/send-overlay.guard.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
npm run typecheck:official-send
```

Expected: PASS; existing dirty-decline, duplicate-submit, password, failure-retention, stale-owner, policy, and mutation tests remain green.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/menubar-tauri/src/app/send/retained-text-send-form.service.ts apps/menubar-tauri/src/app/send/retained-text-send-form.service.spec.ts apps/menubar-tauri/src/app/send/send-add-edit-page.component.ts apps/menubar-tauri/src/app/send/send-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.html apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.html apps/menubar-tauri/src/app/upstream-overlays/send/official-send-details.component.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.html apps/menubar-tauri/src/app/upstream-overlays/send/official-send-text-details.component.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.html apps/menubar-tauri/src/app/upstream-overlays/send/official-send-options.component.ts apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-add-edit.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-add-edit.component.ts.patch apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-details.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-details.component.ts.patch apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-text-details.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-text-details.component.ts.patch apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-options.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-options.component.ts.patch apps/menubar-tauri/src/app/upstream-overlays/send/official-send-member-transforms.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/send/official-send-add-edit.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --name-only
git diff --cached -- apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "feat: validate send forms on blur and submit"
```

### Task 5: Quiet Send Created success with read-only link

**Files:**
- Modify: `apps/menubar-tauri/src/app/send/send-created-page.component.ts:27-147`
- Modify: `apps/menubar-tauri/src/app/send/send-page.component.spec.ts:1749-1774`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-member-transforms.ts:304-414,569-578`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-created.component.ts.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css:2971-2977`

**Interfaces:** Add `link = input.required<string>()`; preserve `send`, `formattedExpiration`, `copyLink`, `close`, `popOut`, `backAction`. Page derives `link` only through existing `SendLinkBuilder`.

- [ ] **Step 1: Write RED test**

```ts
it("renders one quiet summary, readonly link, Copy, Close, and pop-out", async () => {
  const fixture = await createFixture(false);
  fixture.componentRef.setInput("link", "https://vault.example.test/#/send/access/key");
  const commands:string[]=[];
  fixture.componentInstance.copyLink.subscribe(()=>commands.push("copy"));
  fixture.componentInstance.close.subscribe(()=>commands.push("close"));
  fixture.componentInstance.popOut.subscribe(()=>commands.push("popOut"));
  fixture.detectChanges(); const host=fixture.nativeElement as HTMLElement;
  const link=host.querySelector<HTMLInputElement>('[data-testid="created-link"]')!;
  expect(host.querySelector(".macos-send-created__summary")).not.toBeNull();
  expect(link.readOnly).toBe(true); expect(link.value).toContain("/#/send/");
  expect(host.querySelectorAll('[data-testid="created-copy"]')).toHaveLength(1);
  host.querySelector<HTMLButtonElement>('[data-testid="created-copy"]')!.click();
  host.querySelector<HTMLButtonElement>('[data-testid="created-close"]')!.click();
  host.querySelector<HTMLButtonElement>('[aria-label="弹出到新窗口"]')!.click();
  expect(commands).toEqual(["copy","close","popOut"]);
});
```

Update fixture to always set `link`; update page test from three `button[bitbutton]` controls to two.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.spec.ts apps/menubar-tauri/src/app/send/send-page.component.spec.ts`

Expected: FAIL on missing link, duplicate Copy, and 95 px celebration layout.

- [ ] **Step 3: Implement**

Page:

```ts
get link(): string { const send=this.currentSend(); return send ? this.linkBuilder.linkFor(send) : ""; }
```

Pass `[link]="link"`. Retained template content:

```html
<section class="macos-send-created__summary" aria-labelledby="send-created-title">
  <div class="macos-send-created__icon" aria-hidden="true"><bit-svg [content]="sendCreatedIcon" /></div>
  <h2 id="send-created-title" tabindex="-1">{{ "i18nSendCreatedSuccess" | i18n }}</h2>
  <p>@if (send().hasPassword) { {{ "i18nSendPasswordExpires" | i18n: formattedExpiration() }} }
     @else { {{ "i18nSendExpires" | i18n: formattedExpiration() }} }</p>
  <label for="send-created-link">{{ "i18nCopySendLink" | i18n }}</label>
  <input id="send-created-link" data-testid="created-link" type="text" readonly [value]="link()"
    [attr.aria-label]="'i18nCopySendLink' | i18n" />
</section>
<popup-footer slot="footer">
  <button data-testid="created-copy" bitButton type="button" buttonType="primary" (click)="copyLink.emit($event)">{{ "i18nCopySendLink" | i18n }}</button>
  <button data-testid="created-close" bitButton type="button" buttonType="secondary" (click)="close.emit()">{{ "close" | i18n }}</button>
</popup-footer>
```

Add the exact scoped CSS:

```css
.macos-send-created__summary { display:grid; justify-items:start; gap:12px; margin:0 16px; padding:24px 0; border:0; border-radius:0; background:transparent; box-shadow:none; }
.macos-send-created__icon { width:44px; height:44px; color:var(--mac-success); }
.macos-send-created__summary :is(h2,p) { margin:0; }
.macos-send-created__summary input { width:100%; min-height:44px; border-radius:10px; }
```

Created HTML remains `sendCreatedTemplateTransforms`; TypeScript remains `official-send-created.component.ts.patch`. Add `link` to `sendTypeScriptContracts.requiredRuntimeMembers`, run the updater, and do not create a created HTML patch.

- [ ] **Step 4: Run GREEN verification**

```bash
npm run update:official-send-manifest
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/send/send-overlay.guard.spec.ts apps/menubar-tauri/src/app/send/send-page.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
npm run typecheck:official-send
```

Expected: PASS; created HTML is exact-transformed, created TypeScript exact-applies its patch, and stale/locked/replaced Send tests still prevent link exposure.

- [ ] **Step 5: Commit Task 5**

```bash
git add apps/menubar-tauri/src/app/send/send-created-page.component.ts apps/menubar-tauri/src/app/send/send-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.html apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-created.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-member-transforms.ts apps/menubar-tauri/src/app/upstream-overlays/send/source-patches/official-send-created.component.ts.patch apps/menubar-tauri/src/app/upstream-overlays/send/official-send.transform-manifest.json apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --name-only
git diff --cached -- apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: simplify ios27 send success"
```

### Task 6: Publish Generator and Send focus producers for the authoritative tab snapshots

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-core.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history-rows.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-member-transforms.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.spec.ts`

**Interfaces:** Publish only the global `data-popup-focus-key` producer contract consumed by `PopupRouterCacheService.tabSnapshots` in `docs/superpowers/plans/2026-08-17-ios27-interaction-accessibility-qa.md`. That interaction plan exclusively owns `NavigationStart` capture, `NavigationEnd`/`afterNextRender` restoration, `CSS.escape`, descendant-focus fallback, the five main-tab snapshots, and tests that a target tab key is not mistaken for the prior content key. This task must not create `PopupTabFocusRegistryService`, modify `FloatingTabSwitcherComponent`, or introduce `data-bw-focus-key`.

The Generator/Send producers are exactly:

| Surface | `data-popup-focus-key` value |
|---|---|
| Generator Copy | `generator:copy` |
| Generator History link | `generator:history` |
| History row Copy | `generator-history:<generation-epoch>:<row-index>` |
| Send search | `send:search` |
| Send row open | `send-item:<send.id>` |
| Send row Copy | `send-item:<send.id>:copy` |
| Send row More | `send-item:<send.id>:more` |

`generation-epoch`, row index, and `send.id` are structural identifiers. Never derive a key from `credential.credential`, `send.name`, link, password, Send text, i18n output, or DOM text.

- [ ] **Step 1: Write RED producer tests**

Add these focused assertions to the existing Generator and Send component tests after rendering fixed synthetic values:

```ts
const generatorKeys = [...host.querySelectorAll<HTMLElement>("[data-popup-focus-key]")]
  .map((node) => node.getAttribute("data-popup-focus-key"));
expect(generatorKeys).toContain("generator:copy");
expect(generatorKeys).toContain("generator:history");
expect(generatorKeys.some((key) => /^generator-history:\d{1,16}:\d{1,4}$/.test(key ?? ""))).toBe(true);
expect(generatorKeys.join("\n")).not.toContain("orbit-lantern-copper-signal");

const sendKeys = [...host.querySelectorAll<HTMLElement>("[data-popup-focus-key]")]
  .map((node) => node.getAttribute("data-popup-focus-key"));
expect(sendKeys).toEqual(expect.arrayContaining([
  "send:search",
  "send-item:m12-text-send",
  "send-item:m12-text-send:copy",
  "send-item:m12-text-send:more",
]));
expect(sendKeys.join("\n")).not.toMatch(/Example Send|secret body|https?:\/\//);
expect(host.querySelector("[data-bw-focus-key]")).toBeNull();
```

Keep the Generator page and Generator History assertions in their owning specs, because those producers render on separate routes. The Send list spec owns search, row, Copy, and More. Do not add state-restoration assertions here; `PopupRouterCacheService` tests in the interaction plan consume these hooks.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.spec.ts
```

Expected: FAIL because the required `data-popup-focus-key` producers are absent.

- [ ] **Step 3: Add producers through the owning transform pipelines**

```html
<button data-testid="generator-copy" data-popup-focus-key="generator:copy" ...></button>
<a class="macos-generator__history-link" data-popup-focus-key="generator:history" ...></a>

@for (credential of credentials$ | async; track credential; let historyIndex = $index) {
  <button
    [attr.data-popup-focus-key]="'generator-history:' + credential.generationDate.getTime() + ':' + historyIndex"
    ...
  ></button>
}

<bit-search data-popup-focus-key="send:search" ... />
<button [attr.data-popup-focus-key]="'send-item:' + send.id" ...></button>
<button [attr.data-popup-focus-key]="'send-item:' + send.id + ':copy'" ...></button>
<button [attr.data-popup-focus-key]="'send-item:' + send.id + ':more'" ...></button>
```

The `bit-search` host is the keyed owner; the authoritative cache restores its first enabled visible focusable descendant. Update only `generatorTemplateContracts` plus the Generator History rows template transform in `official-generator-member-transforms.ts`, and `sendListTemplateTransforms` plus `sendRowTemplateTransforms` in `official-send-member-transforms.ts`. These HTML files remain exact transforms; do not create HTML patches. No TypeScript patch changes are required because keys use template-visible structural fields only.

- [ ] **Step 4: GREEN, transform guards, manifests, and typechecks**

```bash
npm run update:official-generator-manifest
npm run update:official-send-manifest
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/generator/generator-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/send/send-overlay.guard.spec.ts
npm run typecheck:official-generator
npm run typecheck:official-send
```

Expected: PASS. Both manifests reproduce the runtime HTML, producer tests prove no visible secret/value enters a key, and no second focus registry or attribute exists.

- [ ] **Step 5: Commit Task 6**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-core.component.html apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.html apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history-rows.component.html apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.html apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list-items-container.component.html apps/menubar-tauri/src/app/upstream-overlays/send/official-send-member-transforms.ts apps/menubar-tauri/src/app/upstream-overlays/send/official-send.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/send/official-send-list.component.spec.ts
git diff --cached --name-only
git diff --cached --check
git commit -m "feat: publish generator and send focus keys"
```

### Task 7: Native Tauri compact, accessibility, keyboard, and deterministic 480 × 600 acceptance

**Files:**
- Modify: `apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-generator-native-implementation.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-generator-history-native-implementation.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-send-list-native-implementation.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-send-form-native-implementation.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-send-created-native-implementation.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-generator-send-native-provenance.md`

**Interfaces:** Consume the production Tauri routes through the existing compile-time-gated credential-free providers in `apps/menubar-tauri/src/app/evidence/evidence-providers.ts`, `generator-workflow-evidence.ts`, and `send-evidence-preview.ts`. The only permitted startup gate is `VITE_BW_VAULT_EVIDENCE=true`. Produce five normalized 480 × 600 PNGs plus a provenance record containing the source commit and SHA-256 of each PNG. Accessible names remain enforced by the Angular component tests in Tasks 1–6; this task validates native keyboard order, focus restoration, focus visibility, compact geometry, and visible hierarchy.

- [ ] **Step 1: Add the final source-level compact and reduced-motion gate**

Append to `generator-send-ios27.visual.spec.ts`:

```ts
it("keeps compact rows touch-safe and removes nonessential motion", () => {
  expect(css).toMatch(/:root\[data-bw-compact-mode="true"\][\s\S]*?\.macos-generator__history-link\s*\{[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/:root\[data-bw-compact-mode="true"\][\s\S]*?\.macos-generator-history__row\s*\{[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/:root\[data-bw-compact-mode="true"\][\s\S]*?\.macos-send-row\s*\{[^}]*min-height:\s*44px/s);
  expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.bit-menu-panel \[role="menu"\][\s\S]*?animation:\s*none/s);
});
```

- [ ] **Step 2: Run the automated non-browser acceptance gate**

```bash
npm run update:official-generator-manifest
npm run update:official-send-manifest
npx vitest run apps/menubar-tauri/src/app/generator apps/menubar-tauri/src/app/send apps/menubar-tauri/src/app/upstream-overlays/generator apps/menubar-tauri/src/app/upstream-overlays/send
npm run typecheck:official-generator
npm run typecheck:official-send
npm run build:web
```

Expected: all commands PASS. This is the default automated gate and does not launch Chromium or any other browser.

Run `git rev-parse HEAD` and confirm it is the Task 6 commit. Review `git status --short` and `git diff`; apart from the Task 7 visual-spec assertion, no Generator, Send, popup-shell, transform, manifest, or `global.css` implementation change may remain uncommitted when capture starts. Uncommitted runtime UI makes the source SHA non-reproducible and must block capture.

- [ ] **Step 3: Start one isolated evidence dev server**

From the repository root, start the frontend and leave it running in its own terminal:

```bash
VITE_BW_VAULT_EVIDENCE=true npm run dev:web
```

Expected: Vite listens on `http://127.0.0.1:1420`. This compile-time gate selects `createEvidenceProviders`; production provider aliases remain unchanged. Do not log in, unlock an existing account, import data, or use a normal `npm run tauri:dev` session for these captures.

For every native launch below, run the command with working directory `apps/menubar-tauri`. The JSON overlay merges with `src-tauri/tauri.conf.json`, disables its duplicate `beforeDevCommand`, and supplies the exact evidence query while retaining the configured 480 × 600 Barwarden window:

```bash
npx tauri dev --config '{"build":{"beforeDevCommand":null,"devUrl":"http://127.0.0.1:1420/?vaultEvidence=populated&generatorEvidence=history-copy-retry"}}' --no-dev-server-wait --no-watch
```

The first launch must route to synthetic Vault without asking for credentials. Use keyboard navigation to Settings → Appearance and explicitly select Light and Compact, even if they already appear selected; these two selections deterministically overwrite any prior global appearance preference at the same synthetic origin. Return to Generator. This is the only permitted persisted input; it contains no account or secret data. Quit and restart the native process between different query rows below so state cannot leak across fixtures.

- [ ] **Step 4: Exercise the exact state/route/interaction matrix**

| Evidence state and native `devUrl` query | Required route and keyboard interaction | Capture file |
|---|---|---|
| `vaultEvidence=populated&generatorEvidence=history-copy-retry` | Evidence startup → `/tabs/vault`; activate Generator → `/tabs/generator`; focus `generator:copy`; switch to another main tab and back and verify focus restores to Copy; then Tab through Regenerate, mode, settings, and History | `docs/superpowers/specs/assets/barwarden-ios27-generator-native-implementation.png` |
| same query and same native launch | From `/tabs/generator`, activate `generator:history` → `/generator-history`; focus the first `generator-history:<epoch>:0` Copy; verify visible focus; activate Clear, verify the Sheet initially focuses Cancel, press Escape, and verify focus returns to Clear | `docs/superpowers/specs/assets/barwarden-ios27-generator-history-native-implementation.png` |
| `sendEvidence=list-populated` | Evidence startup routes directly to `/tabs/send`; focus `send:search`, then first `send-item:m12-text-send`, `:copy`, and `:more`; switch tabs and return and verify the last content producer, not the Send tab, regains focus; open More, verify Delete is the only danger item, press Escape, and verify More regains focus | `docs/superpowers/specs/assets/barwarden-ios27-send-list-native-implementation.png` |
| `sendEvidence=form-add` | Evidence startup routes directly to `/add-send?type=text`; activate Save without entering values; verify Name is focused and both Name/Text errors are visible; correct and blur Name and verify only its error clears | `docs/superpowers/specs/assets/barwarden-ios27-send-form-native-implementation.png` |
| `sendEvidence=created` | Evidence startup routes directly to `/send-created?sendId=m12-text-send&type=text`; select the readonly synthetic link; Tab to Copy then Close and verify neither is clipped | `docs/superpowers/specs/assets/barwarden-ios27-send-created-native-implementation.png` |

For the three Send launches, use the same command shape as Step 3 and replace only `devUrl` with one of these exact values:

```text
http://127.0.0.1:1420/?sendEvidence=list-populated
http://127.0.0.1:1420/?sendEvidence=form-add
http://127.0.0.1:1420/?sendEvidence=created
```

Expected: all visible account IDs, Send IDs, credentials, names, link domains, and dates come from the fixed synthetic providers. If any route opens Login/Lock or shows non-`example.test`/fixture data, stop and reject the evidence; do not continue with personal state.

Do not enable or drive VoiceOver automatically. If VoiceOver is already enabled, confirm the names asserted by Tasks 1–6; otherwise rely on those semantic DOM tests and record native keyboard/focus evidence.

- [ ] **Step 5: Capture, normalize, and verify five native PNGs**

At the state named by each matrix row, select only the Barwarden window in the macOS picker:

```bash
screencapture -x -w docs/superpowers/specs/assets/barwarden-ios27-generator-native-implementation.png
screencapture -x -w docs/superpowers/specs/assets/barwarden-ios27-generator-history-native-implementation.png
screencapture -x -w docs/superpowers/specs/assets/barwarden-ios27-send-list-native-implementation.png
screencapture -x -w docs/superpowers/specs/assets/barwarden-ios27-send-form-native-implementation.png
screencapture -x -w docs/superpowers/specs/assets/barwarden-ios27-send-created-native-implementation.png
```

Retina window capture may write 960 × 1200 physical pixels. Normalize each exact file, never crop it, so the committed evidence is reproducibly 480 × 600:

```bash
sips --resampleHeightWidth 600 480 docs/superpowers/specs/assets/barwarden-ios27-generator-native-implementation.png
sips --resampleHeightWidth 600 480 docs/superpowers/specs/assets/barwarden-ios27-generator-history-native-implementation.png
sips --resampleHeightWidth 600 480 docs/superpowers/specs/assets/barwarden-ios27-send-list-native-implementation.png
sips --resampleHeightWidth 600 480 docs/superpowers/specs/assets/barwarden-ios27-send-form-native-implementation.png
sips --resampleHeightWidth 600 480 docs/superpowers/specs/assets/barwarden-ios27-send-created-native-implementation.png
```

Verify every output explicitly:

```bash
sips -g pixelWidth -g pixelHeight docs/superpowers/specs/assets/barwarden-ios27-generator-native-implementation.png docs/superpowers/specs/assets/barwarden-ios27-generator-history-native-implementation.png docs/superpowers/specs/assets/barwarden-ios27-send-list-native-implementation.png docs/superpowers/specs/assets/barwarden-ios27-send-form-native-implementation.png docs/superpowers/specs/assets/barwarden-ios27-send-created-native-implementation.png
```

Expected: each file reports `pixelWidth: 480` and `pixelHeight: 600`. Capture the Send form only after invalid Save so errors and first-error focus are visible.

Place `docs/superpowers/specs/assets/barwarden-ios27-ui-visual-target.png` and each normalized native capture together in the same Product Design comparison input. Reject and fix cropped actions, wrong 16 px margins, card shadows, per-row gaps, wrong radii, low-contrast focus, horizontal overflow, or semantic colors that diverge from the target. After any fix, rerun the owning guard/typecheck and recapture the affected image.

- [ ] **Step 6: Record source revision and SHA-256 provenance**

Run these read-only commands after the final recapture:

```bash
git rev-parse HEAD
shasum -a 256 docs/superpowers/specs/assets/barwarden-ios27-generator-native-implementation.png docs/superpowers/specs/assets/barwarden-ios27-generator-history-native-implementation.png docs/superpowers/specs/assets/barwarden-ios27-send-list-native-implementation.png docs/superpowers/specs/assets/barwarden-ios27-send-form-native-implementation.png docs/superpowers/specs/assets/barwarden-ios27-send-created-native-implementation.png
```

Using `apply_patch`, create `barwarden-ios27-generator-send-native-provenance.md` with this exact shape, replacing brackets with the literal command outputs:

```md
# iOS 27 Generator and Send native evidence provenance

- Source commit: `[40-character git rev-parse HEAD]`
- Runtime: native Tauri/WebKit, Barwarden window 480 × 600
- Fixture gate: `VITE_BW_VAULT_EVIDENCE=true`
- Fixture queries: `vaultEvidence=populated&generatorEvidence=history-copy-retry`, `sendEvidence=list-populated`, `sendEvidence=form-add`, `sendEvidence=created`
- Data policy: fixed credential-free synthetic providers only; no personal login or vault state

| File | SHA-256 |
|---|---|
| `barwarden-ios27-generator-native-implementation.png` | `[hash]` |
| `barwarden-ios27-generator-history-native-implementation.png` | `[hash]` |
| `barwarden-ios27-send-list-native-implementation.png` | `[hash]` |
| `barwarden-ios27-send-form-native-implementation.png` | `[hash]` |
| `barwarden-ios27-send-created-native-implementation.png` | `[hash]` |
```

Re-run `git rev-parse HEAD` and all five `shasum` commands and compare them byte-for-byte with the Markdown. Reject stale provenance or any source commit other than the Task 6 commit at which the captures were made.

- [ ] **Step 7: Stage ignored QA evidence explicitly and commit**

```bash
git diff --check
git add apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
git add -f docs/superpowers/specs/assets/barwarden-ios27-generator-native-implementation.png
git add -f docs/superpowers/specs/assets/barwarden-ios27-generator-history-native-implementation.png
git add -f docs/superpowers/specs/assets/barwarden-ios27-send-list-native-implementation.png
git add -f docs/superpowers/specs/assets/barwarden-ios27-send-form-native-implementation.png
git add -f docs/superpowers/specs/assets/barwarden-ios27-send-created-native-implementation.png
git add -f docs/superpowers/specs/assets/barwarden-ios27-generator-send-native-provenance.md
git diff --cached --name-only
git diff --cached --check
git commit -m "test: verify native ios27 generator and send"
```

Expected staged names: the visual spec, exactly the five PNG paths, and the provenance Markdown above. No other file or documentation directory may be staged.

**Optional browser supplement:** Do not modify or execute Playwright/Chromium tests unless the user explicitly authorizes Chromium for this QA run. After that explicit authorization only, the implementer may add focused tests to `apps/menubar-tauri/e2e/official-generator-workflows.spec.ts` and `apps/menubar-tauri/e2e/official-send-workflows.spec.ts`, then run them with `--project=chromium`. Browser screenshots remain read-only unless the user separately authorizes rewriting their evidence authority.

## Completion Checklist

- Result precedes Generator mode/settings; Copy is primary; Regenerate is ghost.
- History is continuous; Clear Sheet initially focuses Cancel and restores the trigger.
- Send rows expose Copy plus More; Delete exists only as a labelled danger menu item.
- Blur reveals field errors; invalid submit reveals all and focuses Name → Text → Password → Maximum count.
- Pending blocks duplicates without clearing values; failures and dirty confirmation preserve edits.
- Created Send has one quiet icon, expiry, selectable readonly URL, one Copy, and Close.
- The interaction plan's authoritative `PopupRouterCacheService.tabSnapshots` restores the last `data-popup-focus-key` Generator/Send content owner; the destination tab segment is only a fallback, and no producer key contains a generated value, password, Send text, URL, or visible label.
- Compact targets are ≥44 × 44; rows are 44–52 px; VoiceOver names and 480 × 600 overflow gates pass.
- Native evidence uses only the compile-time synthetic providers, records the Task 6 source commit, is exactly 480 × 600, and has matching SHA-256 provenance for all five PNGs.
- Generator exact transforms and Send static-transform/source-patch guards use the correct pipelines; manifests/closures/typechecks/build are current.
