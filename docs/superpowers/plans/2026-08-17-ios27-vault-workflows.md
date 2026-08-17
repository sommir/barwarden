# iOS 27 Vault Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert OTP, Vault detail/forms, New Item, folders, Archive, Trash, and password history to the approved flat iOS 27 system without changing Vault security or data behavior.

**Architecture:** Retain the current Angular page wrappers, official retained overlays, adapters, reprompt, dirty-form, and stale-operation owners. Make visual changes with route-scoped CSS, put deterministic focus keys on the real initiating controls, and change guarded runtimes only for first-invalid focus, pending feedback, and retryable danger Sheets.

**Tech Stack:** Angular 21 standalone components, Bitwarden official components/icon font, RxJS, Vitest/jsdom, Playwright, Tauri WebKit, CSS custom properties.

## Global Constraints

- The baseline popup is exactly 480 × 600 px; page padding is 16 px and group spacing is 20–24 px.
- Standard rows are 52 px; compact auxiliary rows and every interactive target remain at least 44 × 44 px.
- Ordinary groups have 0 px radius and no shadow. Inputs retain 10–12 px radius. Only menus, Sheets, confirmations, and danger dialogs retain 12–16 px radius and one light shadow.
- Keep username/password/TOTP actions capability-driven and preserve their blue/indigo/orange semantics, row-navigation isolation, reprompt, contextual-fill authorization, native-host boundaries, exact-item ownership, operation epochs, dirty confirmation, and stale-result rejection.
- Keep existing routes and dependencies. Use the Bitwarden icon font; no handcrafted SVG/CSS icon, emoji, or replacement asset.
- VoiceOver names include item/field context. Copy/save/error changes use `role="status"` or `role="alert"`; the once-per-second OTP countdown is never live.
- Compact mode is `body.tw-bit-compact`; it may reduce padding, never hit-target size.
- `apps/menubar-tauri/src/styles/global.css`, `apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts`, and `apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json` contain user-owned work. Inspect first, use `git add -p`, and reject unrelated hunks.
- After guarded runtime edits run `npm run update:i18n-retained-manifests`, inspect every output, and stage only hashes produced by the current task. Never stage the pre-existing recovery/i18n hunk.

## Exact focus-key producers

This table is the authoritative focus-key registry for the Vault/OTP/New Item/folder/recovery scope. The global iOS 27 interaction/accessibility plan and every sibling implementation plan must reuse these values verbatim; they may link to this table but must not rename, alias, or independently redefine them. A cross-plan conflict is resolved in favor of this table, then the sibling/global plan is corrected before implementation.

| Journey | `data-popup-focus-key` | Actual initiating control/file |
|---|---|---|
| Vault → New Item | `vault:new-item` | Real retained `app-new-item-dropdown > button[bitbutton]`, decorated in `apps/menubar-tauri/src/app/vault/retained-new-item-dropdown.component.ts` |
| Main nav → OTP | `tab:/tabs/otp` | Segment button in `apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.ts` |
| Active row → detail/edit/clone | `vault-item:<id>` | Row and View/Edit/Clone menu items in `apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.html` and `item-more-options.component.html` |
| New Item → form/folder | `new-item:type:<1|2|3|4>`, `new-item:folder` | Anchors/button in `apps/menubar-tauri/src/app/vault/new-item-page.component.ts` |
| Detail → edit/history | `detail-edit:<id>`, `detail-history:<id>` | Footer link in `vault-item-detail-page.component.ts`; history button in `upstream-overlays/cipher-detail/official-item-history.component.html` |
| Hierarchy → recovery | `vault-child:archive`, `vault-child:trash` | Child buttons in `apps/menubar-tauri/src/app/vault/vault-hierarchy.component.ts` |
| Settings → recovery | `settings:folders|archive|trash` | Rows in `apps/menubar-tauri/src/app/upstream-overlays/settings/official-vault-settings.component.html`; owned by the Settings plan |
| Folders controls | `folders:new`, `folder:<id>` | Buttons in `apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.html` |
| Archive/Trash row | `archive-item:<id>`, `trash-item:<id>` | Row, More trigger, and route-changing menu items in the retained Archive/Trash templates |

---

### Task 1: Flat OTP with compact and VoiceOver contracts

**Files:**
- Create: `apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/otp-code-row.component.ts`
- Test: `apps/menubar-tauri/src/app/vault/otp-code-row.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.ts`
- Test: `apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`

**Interfaces:**
- Consumes unchanged `OtpCodeRowComponent.copy: EventEmitter<VaultField>` and `TOTP_CODE_SOURCE.generate(seed, now)`.
- Produces `tab:/tabs/otp`, flat `.otp-page__list`, 44 px copy/retry targets, and one copy-receipt live region.

- [ ] **Step 1: Write failing tests**

Create the visual spec with this complete harness and OTP test:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let style: HTMLStyleElement;
beforeAll(() => {
  style = document.createElement("style");
  style.textContent = ["macos-tokens.css", "global.css"]
    .map((file) => readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles", file), "utf8"))
    .join("\n");
  document.head.append(style);
});
afterAll(() => { style.remove(); document.body.className = ""; document.body.replaceChildren(); });

describe("iOS 27 Vault workflows", () => {
  it("renders OTP as a flat continuous list with accessible actions", () => {
    document.body.innerHTML = `<main class="macos-page--otp"><div class="otp-page__list">
      <article class="otp-code-row"><button class="otp-code-row__copy"><span class="otp-code-row__code">123 456</span></button><button class="otp-code-row__retry">Retry</button></article>
    </div><div class="otp-page__empty">Empty</div></main>`;
    const group = getComputedStyle(document.querySelector<HTMLElement>(".otp-page__list")!);
    const row = getComputedStyle(document.querySelector<HTMLElement>(".otp-code-row")!);
    expect(group.borderRadius).toBe("0px");
    expect(group.boxShadow).toBe("none");
    expect(row.borderBottomWidth).toBe("1px");
    expect(getComputedStyle(document.querySelector<HTMLElement>(".otp-code-row__copy")!).minHeight).toBe("44px");
    expect(getComputedStyle(document.querySelector<HTMLElement>(".otp-code-row__retry")!).minHeight).toBe("44px");
    expect(getComputedStyle(document.querySelector<HTMLElement>(".otp-page__empty")!).borderRadius).toBe("0px");
    document.body.className = "tw-bit-compact";
    expect(getComputedStyle(document.querySelector<HTMLElement>(".otp-code-row")!).minHeight).toBe("52px");
  });
});
```

Extend the existing `"renders item identity, formatted code..."` test in `otp-code-row.component.spec.ts` immediately after `const host = ...` (reuse that test's real `fixture`, `item`, and providers):

```ts
fixture.componentRef.setInput("copied", true);
fixture.detectChanges();
expect(host.querySelector("[data-testid='otp-copy-status']")?.getAttribute("aria-live")).toBe("polite");
expect(host.querySelector("[data-testid='otp-copy-status']")?.textContent).toContain("GitHub");
expect(host.querySelector(".otp-code-row__countdown")?.getAttribute("aria-live")).toBeNull();
```

Add this self-contained test to `floating-tab-switcher.component.spec.ts`:

```ts
it("marks the actual OTP segment as the route focus trigger", async () => {
  await TestBed.configureTestingModule({
    imports: [FloatingTabSwitcherComponent],
    providers: [provideRouter(routes), OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService }],
  }).compileComponents();
  const fixture = TestBed.createComponent(FloatingTabSwitcherComponent);
  fixture.componentRef.setInput("tabs", tabs);
  fixture.detectChanges();
  const otp = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.includes("OTP"));
  expect(otp?.dataset["popupFocusKey"]).toBe("tab:/tabs/otp");
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts apps/menubar-tauri/src/app/vault/otp-code-row.component.spec.ts apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.spec.ts
```

Expected: FAIL on 12 px group/empty radius, 40/32 px actions, absent compact rule/live region/focus key.

- [ ] **Step 3: Implement the minimum change**

Add `[attr.data-popup-focus-key]="'tab:' + tab.path"` to each tab button. Add to the OTP row:

```html
<span class="tw-sr-only" data-testid="otp-copy-status" role="status" aria-live="polite" aria-atomic="true">
  {{ copied ? ("i18nCopiedOtpForItem" | i18n: item.name) : "" }}
</span>
```

Apply these route-scoped declarations while keeping the existing countdown/icon colors:

```css
.otp-page__list { overflow: hidden; border: 0; border-radius: 0; background: var(--mac-surface-solid); box-shadow: none; }
.otp-code-row { min-height: 56px; border: 0; border-bottom: 1px solid var(--mac-border-subtle); border-radius: 0; box-shadow: none; }
.otp-code-row__copy, .otp-code-row__retry { min-height: 44px; }
.otp-page__empty { border: 0; border-radius: 0; background: transparent; box-shadow: none; }
body.tw-bit-compact .otp-code-row { min-height: 52px; padding-block: 4px; }
```

- [ ] **Step 4: Verify GREEN**

Re-run Step 2; expected PASS including existing timer cleanup, retry/backoff, seed secrecy, search, and copy ownership tests.

- [ ] **Step 5: Commit exact hunks**

```bash
git add apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts apps/menubar-tauri/src/app/vault/otp-code-row.component.ts apps/menubar-tauri/src/app/vault/otp-code-row.component.spec.ts apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.ts apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: flatten ios27 otp workflow"
```

### Task 2: Flat detail hierarchy and focus-return producers

**Files:**
- Modify: `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts`
- Test: `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.component.html`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.html`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-details.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.html`
- Create: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-detail.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.html`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.html`
- Create: `apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`

**Interfaces:** Preserve all official detail inputs/outputs, `LoginContextualFillPresentation`, `LoginRevealRequest`, reprompt, reveal/copy/fill/launch. Add `detailHeading` and `detailMetadata` getters only.

- [ ] **Step 1: Write failing tests**

Append to the `VaultItemDetailPageComponent` describe block and use its existing `createFixture()` helper:

```ts
it("uses item h1, type-folder metadata, contextual Fill first, and exact keys", async () => {
  const fixture = await createFixture();
  const host = fixture.nativeElement as HTMLElement;
  expect(host.querySelector("popup-header h1")?.textContent?.trim()).toBe(demoVaultItems[0]!.name);
  expect(host.querySelector(".vault-detail-heading__metadata")?.textContent).toMatch(/登录.*·/);
  expect(host.querySelector("[data-testid='official-item-identity']")?.getAttribute("aria-hidden")).toBe("true");
  const visible = Array.from(host.querySelectorAll<HTMLElement>(".cipher-view section"))
    .filter((node) => getComputedStyle(node).display !== "none");
  expect(visible[0]?.querySelector("[data-testid='autofill-detail-primary-action']")).not.toBeNull();
  expect(host.querySelector(`[data-popup-focus-key='detail-edit:${demoVaultItems[0]!.id}']`)).not.toBeNull();
});
```

Add assertions to retained row/menu and history specs:

```ts
expect(host.querySelector("[data-testid='vault-item-content']")?.getAttribute("data-popup-focus-key"))
  .toBe("vault-item:github");
expect(historyButton.getAttribute("data-popup-focus-key")).toBe(`detail-history:${cipher.id}`);
```

Append a computed-style test asserting `.macos-page--vault-detail bit-card` has `borderRadius: 0px`, `boxShadow: none`, while `.official-read-only-control` has `borderRadius: 10px`.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
```

Expected: FAIL on generic h1, missing metadata/keys, visible duplicate identity, and rounded ordinary cards.

- [ ] **Step 3: Implement exact detail contract**

```ts
get detailHeading(): string { return this.item?.name || translateOfficialMessage("i18nItem"); }
get detailMetadata(): string { return `${this.typeLabel} · ${this.folderLabel}`; }
```

Bind `[pageTitle]="detailHeading"`, add `<p class="vault-detail-heading__metadata">{{ detailMetadata }}</p>`, and set the Edit link key to `'detail-edit:' + item.id`. Keep `official-item-details` for traceability but add `class="official-detail-identity-duplicate" aria-hidden="true"`; add `data-testid="official-item-identity"` to its root. Add `'detail-history:' + cipher.id` to the history button. Add `'vault-item:' + cipher.id` to row navigation and only View/Edit/Clone menu items.

```css
.macos-page--vault-detail .official-detail-identity-duplicate { display: none; }
.vault-detail-heading__metadata { margin: 2px 0 0; color: var(--mac-text-secondary); font-size: 12px; line-height: 1.25; }
.macos-page--vault-detail .cipher-view bit-card { border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.macos-page--vault-detail .cipher-view section + section { border-top: 1px solid var(--mac-border-subtle); padding-top: var(--mac-space-4); }
.macos-page--vault-detail :is(input, textarea, select, .official-read-only-control) { border-radius: 10px; }
body.tw-bit-compact .macos-page--vault-detail .cipher-view section + section { padding-top: var(--mac-space-3); }
```

Do not move contextual Fill: it is already first in `official-login-credentials.component.html`; hiding the duplicate identity makes it the first visible section.

Run `npm run update:i18n-retained-manifests` and inspect detail/form/recovery/i18n outputs.

- [ ] **Step 4: Verify GREEN/guards**

```bash
npx vitest run apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/cipher-detail-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/personal-cipher-detail-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
npm run typecheck:official-login
npm run typecheck:official-personal
```

- [ ] **Step 5: Commit exact hunks**

```bash
git add apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-details.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-item-history.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.html apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.html apps/menubar-tauri/src/app/upstream-overlays/vault-main/item-more-options.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.transform-manifest.json
git add -p apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-detail.transform-manifest.json
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: flatten ios27 vault details"
```

### Task 3: First-invalid focus, pending state, and flat forms

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.html`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.html`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-form.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-form.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/vault/personal-cipher-save-operation.ts`
- Test: `apps/menubar-tauri/src/app/vault/personal-cipher-save-operation.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.ts`
- Test: `apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`

**Interfaces:** Add public `focusFirstInvalidControl(): HTMLElement | null` to both official forms; add `PersonalCipherSaveOperation.pending: boolean`; add `VaultAddEditPageComponent.savePending: boolean`. Keep every existing config/submit/result interface unchanged.

- [ ] **Step 1: Write failing tests**

Add this complete test to `official-login-cipher-form.component.spec.ts`:

```ts
it("focuses and centers the first invalid Login control", async () => {
  const fixture = await render("add", CipherView.fromJSON({ type: CipherType.Login })!, true);
  const name = (fixture.nativeElement as HTMLElement)
    .querySelector<HTMLInputElement>('input[formcontrolname="name"]')!;
  name.scrollIntoView = vi.fn();
  await fixture.componentInstance.submit();
  fixture.detectChanges();
  await settle(fixture);
  expect(name.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(name);
  expect(name.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
});
```

Add this complete test to `official-personal-cipher-form.component.spec.ts`:

```ts
it("focuses and centers the first invalid personal-item control", async () => {
  const empty = personalView(CipherType.Card);
  empty.name = "";
  const fixture = await render("add", CipherType.Card, empty);
  const name = (fixture.nativeElement as HTMLElement)
    .querySelector<HTMLInputElement>('input[formcontrolname="name"]')!;
  name.scrollIntoView = vi.fn();
  await fixture.componentInstance.submit();
  fixture.detectChanges(false);
  expect(name.getAttribute("aria-invalid")).toBe("true");
  expect(document.activeElement).toBe(name);
  expect(name.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
});
```

Add to the page spec a deferred write assertion that `.cipher-form-scroll[aria-busy=true]`, `[data-testid=vault-save-status]` contains `保存中`, a second submit does not issue another write, failure retains the typed name, and busy clears. Add a visual assertion that form `bit-card` is radius 0/shadow none while inputs are radius 10/min-height 44.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.spec.ts apps/menubar-tauri/src/app/vault/personal-cipher-save-operation.spec.ts apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
```

Expected: FAIL on focus/scroll, pending getters/live status, and rounded form groups.

- [ ] **Step 3: Implement**

Add `#formElement` to both forms, import `ElementRef`, and implement:

```ts
@ViewChild("formElement", { read: ElementRef }) private formElement?: ElementRef<HTMLFormElement>;
focusFirstInvalidControl(): HTMLElement | null {
  this.changeDetectorRef.detectChanges();
  const target = this.formElement?.nativeElement.querySelector<HTMLElement>(
    'input[aria-invalid="true"],textarea[aria-invalid="true"],select[aria-invalid="true"],[role="combobox"][aria-invalid="true"],.ng-invalid[tabindex]:not(form)',
  ) ?? null;
  target?.focus({ preventScroll: true });
  target?.scrollIntoView({ block: "center", behavior: "auto" });
  return target;
}
```

Call it immediately after the existing `markAllAsTouched()`. Add `pending` as `return this.operationToken !== null`; add `savePending` as `loginOperationToken !== null || personalOperation.pending`. Bind wrapper/button `aria-busy`, existing Button `[loading]`, and:

```html
<span class="tw-sr-only" data-testid="vault-save-status" role="status" aria-live="polite" aria-atomic="true">
  {{ savePending ? ("i18nSaving" | i18n) : "" }}
</span>
```

```css
.macos-page--vault-form .cipher-form-scroll bit-card, .macos-page--vault-form .official-form-section { border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.macos-page--vault-form :is(input,textarea,select,[role="combobox"]) { min-height: 44px; border-radius: 10px; }
body.tw-bit-compact .macos-page--vault-form .cipher-form-scroll section { margin-bottom: 16px; }
```

Run manifest updater and inspect all output.

- [ ] **Step 4: Verify GREEN/guards**

```bash
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/cipher-form-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/personal-cipher-form-overlay.guard.spec.ts apps/menubar-tauri/src/app/vault/personal-cipher-save-operation.spec.ts apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
npm run typecheck:official-login
npm run typecheck:official-personal
```

- [ ] **Step 5: Commit exact hunks**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.spec.ts apps/menubar-tauri/src/app/vault/personal-cipher-save-operation.ts apps/menubar-tauri/src/app/vault/personal-cipher-save-operation.spec.ts apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.ts apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-form.transform-manifest.json
git add -p apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-form.transform-manifest.json
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "feat: unify ios27 vault form feedback"
```

### Task 4: Continuous New Item and folder flows

**Files:**
- Modify: `apps/menubar-tauri/src/app/vault/retained-new-item-dropdown.component.ts`
- Test: `apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/new-item-page.component.ts`
- Test: `apps/menubar-tauri/src/app/vault/new-item-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/folders-page.component.ts`
- Test: `apps/menubar-tauri/src/app/vault/folders-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.ts`
- Test: `apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-hierarchy.component.ts`
- Test: `apps/menubar-tauri/src/app/vault/vault-hierarchy.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.html`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`

**Interfaces:** `VaultFolderDialogComponent.openFor(folder?: VaultFolder, trigger?: HTMLElement | null): void`; `NewItemOption.focusKey` is one of the keys in the producer table.

- [ ] **Step 1: Write failing tests**

In `apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts`, replace the final trigger assertion in the existing `"keeps the title-bar add control available when the unlocked vault is empty"` test with:

```ts
const newItemTrigger = host.querySelector<HTMLButtonElement>(
  "popup-header bw-retained-new-item-dropdown app-new-item-dropdown button[bitbutton]",
)!;
expect(newItemTrigger).not.toBeNull();
expect(newItemTrigger.dataset["popupFocusKey"]).toBe("vault:new-item");
```

```ts
it("renders a continuous semantic list with exact keys", async () => {
  await TestBed.configureTestingModule({
    imports: [NewItemPageComponent],
    providers: [provideRouter([]), OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService }],
  }).compileComponents();
  const fixture = TestBed.createComponent(NewItemPageComponent);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  expect(host.querySelector(".new-item-grid")?.getAttribute("role")).toBe("list");
  expect(host.querySelector("[data-popup-focus-key='new-item:type:1']")?.tagName).toBe("A");
  expect(host.querySelector("[data-popup-focus-key='new-item:folder']")?.tagName).toBe("BUTTON");
  expect(Array.from(host.querySelectorAll(".new-item-option"))
    .every((node) => node.getAttribute("aria-describedby"))).toBe(true);
});
```

Append this complete return-focus test to the same `new-item-page.component.spec.ts` describe block:

```ts
it("returns focus to the New Item folder trigger when the Sheet is cancelled", async () => {
  await TestBed.configureTestingModule({
    imports: [NewItemPageComponent],
    providers: [provideRouter([]), OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService }],
  }).compileComponents();
  const fixture = TestBed.createComponent(NewItemPageComponent);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const trigger = host.querySelector<HTMLButtonElement>(
    "[data-popup-focus-key='new-item:folder']",
  )!;
  trigger.focus();
  trigger.click();
  fixture.detectChanges();
  await Promise.resolve();
  const cancel = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === "取消")!;
  cancel.click();
  fixture.detectChanges();
  await Promise.resolve();
  expect(document.activeElement).toBe(trigger);
});
```

Append this complete focus test to `apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.spec.ts`, beside the existing Escape cancellation test:

```ts
it("focuses Cancel in delete confirmation and returns to the invoking Delete button", async () => {
  const store = unlockedStore();
  const folder = store.saveFolder({ id: "work", name: "Work" });
  const fixture = await setup(store, { create: vi.fn(), update: vi.fn(), delete: vi.fn() });
  const host = fixture.nativeElement as HTMLElement;
  const opener = document.createElement("button");
  document.body.append(opener);
  fixture.componentInstance.openFor(folder, opener);
  fixture.detectChanges(false);
  await Promise.resolve();

  const deleteButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.getAttribute("aria-label") === "删除文件夹")!;
  deleteButton.focus();
  deleteButton.click();
  fixture.detectChanges(false);
  await Promise.resolve();

  const cancel = host.querySelector<HTMLButtonElement>("[data-testid='delete-folder-cancel']")!;
  expect(document.activeElement).toBe(cancel);
  cancel.click();
  fixture.detectChanges(false);
  await Promise.resolve();
  expect(document.activeElement).toBe(deleteButton);
  opener.remove();
});
```

In the existing `"navigates hidden child nodes..."` test in `apps/menubar-tauri/src/app/vault/vault-hierarchy.component.spec.ts`, insert these assertions immediately after `const host = ...`:

```ts
expect(host.querySelector('[data-vault-child="archive"]')?.getAttribute("data-popup-focus-key"))
  .toBe("vault-child:archive");
expect(host.querySelector('[data-vault-child="trash"]')?.getAttribute("data-popup-focus-key"))
  .toBe("vault-child:trash");
```

Append this complete compact visual case inside `describe("iOS 27 Vault workflows", ...)` in `apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts`:

```ts
it("keeps New Item and folder rows flat and touchable in compact mode", () => {
  document.body.className = "tw-bit-compact";
  document.body.innerHTML = `<main class="macos-page--vault-form"><div class="new-item-grid">
    <div class="new-item-option-row"><button class="new-item-option">Folder</button></div>
  </div></main>`;
  const group = getComputedStyle(document.querySelector<HTMLElement>(".new-item-grid")!);
  const row = getComputedStyle(document.querySelector<HTMLElement>(".new-item-option")!);
  expect(group.borderRadius).toBe("0px");
  expect(group.boxShadow).toBe("none");
  expect(row.borderRadius).toBe("0px");
  expect(row.minHeight).toBe("52px");
});
```

In `apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.spec.ts`, append these assertions immediately after `const host = ...` in `"renders the official row..."`, and append the final assertion immediately after switching `folders` to `[]`:

```ts
expect(host.querySelector("[data-testid='new-folder-button']")?.getAttribute("data-popup-focus-key"))
  .toBe("folders:new");
expect(host.querySelector("[data-testid='edit-folder-work']")?.getAttribute("data-popup-focus-key"))
  .toBe("folder:work");
```

Immediately after the existing empty-state `fixture.detectChanges()` call, insert:

```ts
expect(host.querySelector("[data-testid='empty-new-folder-button']")?.getAttribute("data-popup-focus-key"))
  .toBe("folders:new");
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/new-item-page.component.spec.ts apps/menubar-tauri/src/app/vault/folders-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.spec.ts apps/menubar-tauri/src/app/vault/vault-hierarchy.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
```

- [ ] **Step 3: Implement**

In `apps/menubar-tauri/src/app/vault/retained-new-item-dropdown.component.ts`, import `ElementRef`, add this query beside the existing folder-dialog `ViewChild`, and append the trigger assignment to `ngAfterViewInit` after the existing folder-dialog binding:

```ts
@ViewChild(NewItemDropdownComponent, { read: ElementRef })
private newItemDropdownHost?: ElementRef<HTMLElement>;

const trigger = this.newItemDropdownHost?.nativeElement
  .querySelector<HTMLButtonElement>("button[bitbutton]");
if (!trigger) throw new Error("Retained New Item trigger is unavailable.");
trigger.dataset["popupFocusKey"] = "vault:new-item";
```

In `apps/menubar-tauri/src/app/vault/new-item-page.component.ts`, add `focusKey` to `NewItemOption`, map the four types to `new-item:type:1|2|3|4` and Folder to `new-item:folder`, then replace the grid/item bindings with:

```ts
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
```

Add these exact properties to the existing `NEW_ITEM_OPTIONS` records, in current Login/Card/Identity/Secure Note/Folder order:

```ts
focusKey: "new-item:type:1",
focusKey: "new-item:type:3",
focusKey: "new-item:type:4",
focusKey: "new-item:type:2",
focusKey: "new-item:folder",
```

```html
<div class="new-item-grid" role="list">
  @for (item of items; track item.focusKey) {
    <div class="new-item-option-row" role="listitem">
      @if (item.opensFolderDialog) {
        <button class="new-item-option" type="button"
          [attr.data-popup-focus-key]="item.focusKey"
          [attr.aria-describedby]="item.focusKey + '-description'"
          (click)="openFolderDialog($event.currentTarget)">
          <span class="new-item-icon" aria-hidden="true"><i class="bwi {{ item.icon }}" aria-hidden="true"></i></span>
          <span class="new-item-text"><span class="new-item-label">{{ item.label }}</span>
            <span class="new-item-description" [id]="item.focusKey + '-description'">{{ item.description }}</span>
          </span>
        </button>
      } @else {
        <a class="new-item-option" [routerLink]="item.link" [queryParams]="item.queryParams ?? null"
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
```

Change the New Item method at its current declaration to:

```ts
openFolderDialog(trigger: EventTarget | null): void {
  this.folderDialog?.openFor(undefined, trigger instanceof HTMLElement ? trigger : null);
}
```

In `apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.ts`, add `#deleteCancel`, its test id, its `ViewChild`, and replace the two open calls exactly:

```html
<button #deleteCancel bitButton buttonType="secondary" type="button"
  data-testid="delete-folder-cancel" [disabled]="isSaving" (click)="closeDeleteDialog()">
  {{ "cancel" | i18n }}
</button>
```

```ts
@ViewChild("deleteCancel", { read: ElementRef }) private deleteCancel?: ElementRef<HTMLButtonElement>;
```

Replace the existing method signature with `openFor(folder?: VaultFolder, trigger?: HTMLElement | null): void {`. Inside that existing body, replace only `this.folderDialog?.open(undefined, folderName)` with `this.folderDialog?.open(trigger, folderName)`. Inside the existing `requestDelete` body, replace only `this.deleteDialog?.open()` with `this.deleteDialog?.open(this.deleteTrigger, this.deleteCancel?.nativeElement ?? null)`.

In `apps/menubar-tauri/src/app/vault/folders-page.component.ts`, replace `openFolderDialog` with:

```ts
openFolderDialog(folder?: FolderView): void {
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  this.folderDialog?.openFor(folder ? fromFolderView(folder) : undefined, trigger);
}
```

In `apps/menubar-tauri/src/app/vault/vault-hierarchy.component.ts`, add this binding to every child button:

```html
[attr.data-popup-focus-key]="child.id === 'archive' || child.id === 'trash' ? 'vault-child:' + child.id : null"
```

In `apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.html`, add `[attr.data-popup-focus-key]="'folders:new'"` to both `new-folder-button` and `empty-new-folder-button`, and add `[attr.data-popup-focus-key]="'folder:' + folder.id"` to each `bit-item` plus its `edit-folder-...` button. Leave the current click/output handlers unchanged.

```css
.new-item-grid { display: grid; gap: 0; overflow: hidden; border: 0; border-radius: 0; background: var(--mac-surface-solid); box-shadow: none; }
.new-item-option-row + .new-item-option-row { border-top: 1px solid var(--mac-border-subtle); }
.new-item-option { display: grid; width: 100%; min-height: 52px; grid-template-columns: 32px minmax(0,1fr); align-items: center; gap: 12px; border: 0; border-radius: 0; padding: 8px 12px; background: transparent; box-shadow: none; text-align: left; }
body.tw-bit-compact .new-item-option { min-height: 52px; padding-block: 4px; }
```

Run manifest updater; stage only intentional recovery hash changes.

- [ ] **Step 4: Verify GREEN/guard**

```bash
npx vitest run apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/new-item-page.component.spec.ts apps/menubar-tauri/src/app/vault/folders-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.spec.ts apps/menubar-tauri/src/app/vault/vault-hierarchy.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-overlay.guard.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
npm run typecheck:official-recovery
```

- [ ] **Step 5: Commit exact hunks**

```bash
git add apps/menubar-tauri/src/app/vault/retained-new-item-dropdown.component.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/new-item-page.component.ts apps/menubar-tauri/src/app/vault/new-item-page.component.spec.ts apps/menubar-tauri/src/app/vault/folders-page.component.ts apps/menubar-tauri/src/app/vault/folders-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.ts apps/menubar-tauri/src/app/vault/vault-folder-dialog.component.spec.ts apps/menubar-tauri/src/app/vault/vault-hierarchy.component.ts apps/menubar-tauri/src/app/vault/vault-hierarchy.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.html apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: unify ios27 new item and folders"
```

### Task 5: Continuous recovery/history and retryable danger Sheets

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-command.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.ts`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.ts`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.ts`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.ts`
- Test: `apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/archive-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/trash-page.component.ts`
- Test: `apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/vault/vault-password-history-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`

**Interfaces:** Extend `RecoveryPageCommand` with optional `trigger?: HTMLElement`. Change `RecoveryConfirmationRequest` continuation to `() => Promise<RecoveryPageActionResult>` and pass trigger as its fourth argument. Wrapper pending continuation uses the same return type. Keep required command/location/exact item unchanged.

- [ ] **Step 1: Write failing tests**

Add `import type { RecoveryPageCommand } from "../recovery-command";` beside the existing recovery imports in `apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.spec.ts`, then append this test inside its existing `describe` block:

```ts
it("marks permanent delete dangerous and emits its real More trigger", async () => {
  const fixture = await createList(); const commands: RecoveryPageCommand[] = [];
  fixture.componentInstance.command.subscribe((value) => commands.push(value));
  const host = fixture.nativeElement as HTMLElement;
  const trigger = host.querySelector<HTMLButtonElement>("[aria-label='回收站选项 GitHub']")!;
  expect(trigger.dataset["popupFocusKey"]).toBe("trash-item:github");
  trigger.click(); fixture.detectChanges();
  const danger = Array.from(document.body.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
    .find((button) => button.textContent?.includes("永久删除"))!;
  expect(danger.getAttribute("variant")).toBe("danger"); danger.click();
  expect(commands[0]?.trigger).toBe(trigger);
});
```

Add `import type { RecoveryPageCommand } from "../recovery-command";` beside the existing recovery imports in `apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.spec.ts`, then append this complete test inside its existing `describe` block:

```ts
it("emits the real Archive More trigger and stable focus key", async () => {
  const fixture = await createArchive();
  const commands: RecoveryPageCommand[] = [];
  fixture.componentInstance.command.subscribe((value) => commands.push(value));
  const host = fixture.nativeElement as HTMLElement;
  const trigger = host.querySelector<HTMLButtonElement>("[aria-label='归档选项 GitHub']")!;
  expect(trigger.dataset["popupFocusKey"]).toBe("archive-item:github");
  trigger.click();
  fixture.detectChanges();
  clickMenuAction("删除");
  expect(commands.at(-1)).toEqual({
    command: "soft-delete", location: "archive",
    item: fixture.componentInstance.items[0], trigger,
  });
});
```

Append this retry case to `apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts`:

```ts
it("keeps a failed permanent-delete Sheet open and permits retry", async () => {
  const store = new PopupStateStore();
  const item = { ...demoVaultItems[0], id: "deleted-retry", name: "Retry login" };
  unlock(store);
  store.setDeletedItems([item]);
  const actions = {
    permanentlyDeleteItemWithOutcome: vi.fn()
      .mockResolvedValueOnce({ committed: false, reason: "failure", status: "无法永久删除项目，请重试。" })
      .mockResolvedValueOnce(committed(item, "Item permanently deleted")),
  };
  await TestBed.configureTestingModule({
    imports: [TrashPageComponent],
    providers: [provideRouter([]), { provide: Router, useValue: routeRouter("/trash") },
      { provide: PopupStateStore, useValue: store },
      { provide: VaultActionsService, useValue: actions }],
  }).compileComponents();
  const fixture = TestBed.createComponent(TrashPageComponent);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  host.querySelector<HTMLButtonElement>("[aria-label='回收站选项 Retry login']")!.click();
  clickMenuAction("永久删除");
  await fixture.whenStable();
  fixture.detectChanges();
  const sheet = host.querySelector<HTMLDialogElement>("[data-testid='permanent-delete-confirmation']")!;
  const submit = sheet.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const cancel = sheet.querySelector<HTMLButtonElement>("[data-testid='permanent-delete-cancel']")!;
  expect(document.activeElement).toBe(cancel);
  submit.click();
  await fixture.whenStable();
  fixture.detectChanges();
  expect(sheet.open).toBe(true);
  expect(sheet.closest("bw-app-bottom-sheet")?.getAttribute("aria-busy")).toBe("false");
  expect(sheet.querySelectorAll("[role='alert']")).toHaveLength(1);
  expect(sheet.textContent).toContain("无法永久删除项目，请重试。");
  submit.click();
  await fixture.whenStable();
  fixture.detectChanges();
  expect(sheet.open).toBe(false);
  expect(actions.permanentlyDeleteItemWithOutcome).toHaveBeenCalledTimes(2);
});
```

In `apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.spec.ts`, import `RecoveryPageActionResult` from the adapter export, change confirmation continuation annotations to `(() => Promise<RecoveryPageActionResult>) | undefined`, and replace the existing `"shows the destructive warning before reprompting..."` test with:

```ts
it("reprompts before opening permanent-delete confirmation and forwards the trigger", async () => {
  const sequence: string[] = [];
  const trigger = document.createElement("button");
  let confirmationTrigger: HTMLElement | undefined;
  let confirmationContinuation: (() => Promise<RecoveryPageActionResult>) | undefined;
  let repromptContinuation: (() => Promise<void>) | undefined;
  const harness = setup({
    location: "trash",
    reprompt: true,
    requestReprompt: (_itemId, next) => {
      sequence.push("reprompt");
      repromptContinuation = next;
      return true;
    },
    requestConfirmation: (_command, _item, next, invokingTrigger) => {
      sequence.push("confirmation");
      confirmationContinuation = next;
      confirmationTrigger = invokingTrigger;
      return true;
    },
  });
  await expect(harness.adapter.execute({
    command: "permanent-delete", location: "trash", item: harness.view, trigger,
  })).resolves.toEqual({ terminal: false, status: "Verification required." });
  expect(sequence).toEqual(["reprompt"]);
  expect(harness.server.deleteCipher).not.toHaveBeenCalled();
  await repromptContinuation!();
  expect(sequence).toEqual(["reprompt", "confirmation"]);
  expect(confirmationTrigger).toBe(trigger);
  await expect(confirmationContinuation!())
    .resolves.toEqual({ terminal: true, status: "Item permanently deleted" });
  expect(harness.server.deleteCipher).toHaveBeenCalledOnce();
});
```

Append this complete semantic/VoiceOver case to `apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.spec.ts`:

```ts
it("exposes a semantic history list and contextual copy name without the secret", async () => {
  await TestBed.configureTestingModule({
    imports: [OfficialPasswordHistoryViewComponent],
    providers: [OfficialI18nService, { provide: I18nService, useExisting: OfficialI18nService }],
  }).compileComponents();
  const fixture = TestBed.createComponent(OfficialPasswordHistoryViewComponent);
  fixture.componentRef.setInput("cipher", projectLoginDetail(loginItem()).cipher);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const list = host.querySelector("bit-item-group");
  const copy = host.querySelector<HTMLButtonElement>("[data-testid='history-copy-0']")!;
  expect(list?.getAttribute("role")).toBe("list");
  expect(copy.getAttribute("aria-label")).toContain("Example Login");
  expect(copy.getAttribute("aria-label")).not.toContain("old-secret-1");
});
```

Append to the visual spec:

```ts
it("keeps recovery rows flat and actions 44 pixels in compact mode", () => {
  document.body.className = "tw-bit-compact";
  document.body.innerHTML = `<main class="macos-page--vault-recovery"><bit-item-group>
    <bit-item><button data-testid="history-copy-0">Copy</button></bit-item>
  </bit-item-group></main>`;
  const row = getComputedStyle(document.querySelector<HTMLElement>("bit-item")!);
  const action = getComputedStyle(document.querySelector<HTMLElement>("button")!);
  expect(row.borderRadius).toBe("0px");
  expect(row.boxShadow).toBe("none");
  expect(row.minHeight).toBe("52px");
  expect(action.minHeight).toBe("44px");
  expect(action.minWidth).toBe("44px");
});
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.spec.ts apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.spec.ts apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-password-history-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
```

- [ ] **Step 3: Implement**

```ts
export interface RecoveryPageCommand {
  readonly command: RecoveryCommand;
  readonly location: RecoveryLocation;
  readonly item: RetainedPopupCipherView;
  readonly trigger?: HTMLElement;
}
export type RecoveryConfirmationRequest = (
  command: Extract<RecoveryCommand, "soft-delete" | "permanent-delete">,
  item: RetainedPopupCipherView,
  continuation: () => Promise<RecoveryPageActionResult>,
  trigger?: HTMLElement,
) => boolean;
```

In both retained Archive/Trash templates, name each More button `#moreTrigger`; bind the row content, More trigger, and every View/Edit/Clone route-changing menu item to `archive-item:`/`trash-item:` plus item id; add `variant="danger"` to permanent delete; and call `emit('soft-delete', item, moreTrigger)` or `emit('permanent-delete', item, moreTrigger)`. Restore/unarchive/destructive commands pass `moreTrigger` but do not receive a route-return key because they remain in the recovery flow. Replace each component emitter method with the location-appropriate form:

```ts
emit(
  command: RecoveryPageCommand["command"],
  item: RetainedPopupCipherView,
  trigger?: HTMLElement,
): void {
  this.command.emit({ command, location: "archive", item, trigger });
}
```

```ts
emit(
  command: RecoveryPageCommand["command"],
  item: RetainedPopupCipherView,
  trigger?: HTMLElement,
): void {
  this.command.emit({ command, location: "trash", item, trigger });
}
```

Add `readonly trigger?: HTMLElement;` to `RecoveryActionContext`, and add `trigger: command.trigger` to the context object returned by `RecoveryPageActionsAdapter.capture`. In `executeCurrent`, place the reprompt branch before the confirmation branch and use this exact continuation:

```ts
if (context.item.reprompt && !repromptPassed) {
  if (!this.requestReprompt) return result(false, "Unable to verify master password.");
  const requested = this.requestReprompt(context.source.id, () =>
    this.executeCurrent(context, command, true, confirmationPassed).then(() => undefined));
  return requested ? result(false, "Verification required.")
    : result(false, "Unable to verify master password.");
}
if (isConfirmationCommand(command) && !confirmationPassed) {
  if (!this.requestConfirmation) return result(false, "Action cancelled.");
  const requested = this.requestConfirmation(
    command, context.item,
    () => this.executeCurrent(context, command, true, true),
    context.trigger,
  );
  return requested ? result(false, "Confirmation required.") : result(false, "Action cancelled.");
}
```

In both wrapper components import `ElementRef`, `signal`, and `MacosAlertStripComponent`; add the alert component to `imports`. Add `#confirmationCancel`/`data-testid="archive-delete-cancel"` or `data-testid="permanent-delete-cancel"` to Cancel and bind `[disabled]="confirmationBusy"` to both actions. Bind `[attr.aria-busy]="confirmationBusy"` to the Sheet and add this immediately before the footer:

```html
@if (confirmationError()) {
  <bw-macos-alert-strip kind="danger" urgency="assertive"
    [message]="confirmationError()" testId="recovery-confirmation-error" />
}
```

Replace wrapper confirmation state and submit logic with the same typed implementation (use the wrapper's existing close method name):

```ts
@ViewChild("confirmationCancel", { read: ElementRef })
private confirmationCancel?: ElementRef<HTMLButtonElement>;
readonly confirmationError = signal("");
confirmationBusy = false;
private pendingConfirmation: (() => Promise<RecoveryPageActionResult>) | null = null;

private openConfirmation(
  continuation: () => Promise<RecoveryPageActionResult>,
  trigger?: HTMLElement,
): boolean {
  this.pendingConfirmation = continuation;
  this.confirmationError.set("");
  this.confirmationBusy = false;
  this.deleteDialog?.open(trigger, this.confirmationCancel?.nativeElement ?? null);
  return true;
}

async confirmDelete(event?: Event): Promise<void> {
  event?.preventDefault();
  const continuation = this.pendingConfirmation;
  if (!continuation || this.confirmationBusy) return;
  this.confirmationBusy = true;
  this.confirmationError.set("");
  const outcome = await continuation();
  if (this.pendingConfirmation !== continuation) return;
  this.confirmationBusy = false;
  if (outcome.terminal || outcome.status === "Vault changed; action not applied.") {
    this.closeDeleteDialog();
    return;
  }
  this.confirmationError.set(outcome.status);
}
```

For `TrashPageComponent`, rename `deleteDialog`/`confirmDelete`/`closeDeleteDialog` in this snippet to `permanentDeleteDialog`/`confirmPermanentDelete`/`closePermanentDelete`. Change password history outer div to `<bit-item-group role="list">` and import `ItemGroupComponent`.

Replace the Archive wrapper constructor's confirmation callback with:

```ts
(command, _item, continuation, trigger) =>
  command === "soft-delete" ? this.openConfirmation(continuation, trigger) : false
```

Replace the Trash wrapper constructor's confirmation callback with:

```ts
(command, _item, continuation, trigger) =>
  command === "permanent-delete" ? this.openConfirmation(continuation, trigger) : false
```

Replace the Archive close method and Trash close method with the matching reset form so cancellation, stale completion, and destroy cannot leak busy/error state:

```ts
closeDeleteDialog(): void {
  this.pendingConfirmation = null;
  this.confirmationBusy = false;
  this.confirmationError.set("");
  this.deleteDialog?.close();
}
```

```ts
closePermanentDelete(): void {
  this.pendingConfirmation = null;
  this.confirmationBusy = false;
  this.confirmationError.set("");
  this.permanentDeleteDialog?.close();
}
```

```css
.macos-page--vault-recovery :is(bit-section,bit-item-group) { overflow: hidden; border: 0; border-radius: 0; background: var(--mac-surface-solid); box-shadow: none; }
.macos-page--vault-recovery bit-item { min-height: 52px; margin: 0; border: 0; border-bottom: 1px solid var(--mac-border-subtle); border-radius: 0; background: transparent; box-shadow: none; }
.macos-page--vault-recovery bit-item:last-child { border-bottom: 0; }
.macos-page--vault-recovery bit-item-action button, .macos-page--vault-recovery [data-testid^="history-copy-"] { min-width: 44px; min-height: 44px; }
body.tw-bit-compact .macos-page--vault-recovery bit-item { min-height: 52px; }
```

Run manifest updater and inspect every generated diff.

- [ ] **Step 4: Verify GREEN/guard/build**

```bash
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-overlay.guard.spec.ts apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.spec.ts apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-password-history-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
npm run typecheck:official-recovery
npm run build:web
```

- [ ] **Step 5: Commit exact hunks**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-command.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.html apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.html apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.html apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.spec.ts apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.ts apps/menubar-tauri/src/app/vault/recovery-page-actions.adapter.spec.ts apps/menubar-tauri/src/app/vault/archive-page.component.ts apps/menubar-tauri/src/app/vault/trash-page.component.ts apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-password-history-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "feat: unify ios27 vault recovery flows"
```

### Task 6: 480 × 600, compact, and VoiceOver acceptance

**Files:**
- Modify only after explicit user authorization to run Chromium: `apps/menubar-tauri/e2e/installed-ui-regressions.spec.ts`
- Modify only after explicit user authorization to run Chromium: `apps/menubar-tauri/e2e/official-login-workflow.spec.ts`
- Modify only after explicit user authorization to run Chromium: `apps/menubar-tauri/e2e/official-personal-cipher-workflows.spec.ts`
- Modify only after explicit user authorization to run Chromium: `apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts`
- Create: `docs/superpowers/specs/2026-08-17-ios27-vault-workflow-design-qa.md`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-light.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-dark.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-compact.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-detail.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-invalid-form.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-new-item.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-folder-danger.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-archive.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-trash-danger.png`
- Create: `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-password-history.png`

**Interfaces:** The default acceptance authority is the real native Tauri WebKit status popup. Deterministic states include OTP populated, contextual detail, form add/compact/invalid, New Item, folders danger, archive list/menu, Trash list/menu/danger, password-history populated/empty/reprompt. No real credentials enter evidence. Playwright/Chromium is an optional diagnostic only and must not be launched unless the user explicitly authorizes Chromium execution in the active session.

- [ ] **Step 1: Run deterministic source tests before native QA**

Run these non-browser commands and paste their exit codes into the QA record under `Preflight commands`:

```bash
npx vitest run apps/menubar-tauri/src/app/vault apps/menubar-tauri/src/app/upstream-overlays/vault-main apps/menubar-tauri/src/app/upstream-overlays/cipher-detail apps/menubar-tauri/src/app/upstream-overlays/cipher-form apps/menubar-tauri/src/app/upstream-overlays/recovery apps/menubar-tauri/src/app/evidence/recovery-workflow-evidence.spec.ts
npm run typecheck:official-login
npm run typecheck:official-personal
npm run typecheck:official-recovery
npm run build:web
```

- [ ] **Step 2: Launch the native Tauri WebKit popup**

In Terminal A run and leave the process attached:

```bash
npm run tauri:dev 2>&1 | tee /tmp/barwarden-ios27-vault-native.log
```

Open the real status item popup; do not substitute the Vite preview. Confirm the visible popup is 480 × 600 logical pixels using macOS Accessibility Inspector. Record the inspector-reported position, size, app version, commit (`git rev-parse HEAD`), macOS version (`sw_vers`), and display scale in the QA file. Use only the synthetic `.test` fixture account and redacted OTP/history values.

In Terminal B capture the immutable run metadata:

```bash
git rev-parse HEAD
node -p "require('./package.json').version"
sw_vers
```

If the synthetic fixture cannot be loaded into the native app, record the exact blocker and stop Task 6; do not silently substitute Chromium, Vite preview, or live credentials.

- [ ] **Step 3: Capture the exact native state inventory**

For every row below, navigate the native popup to the named state, run `screencapture -x -i` with that row's literal output path, drag exactly the 480 × 600 popup bounds reported by Accessibility Inspector, then run `sips -g pixelWidth -g pixelHeight` and `shasum -a 256` on that file. A 2× display may produce 960 × 1200 pixels; record both logical 480 × 600 and physical pixel size.

| Output file | Native state before capture | Required interaction assertion |
|---|---|---|
| `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-light.png` | OTP populated, light | Copy action ≥44 px; countdown changes without VoiceOver announcement |
| `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-dark.png` | same fixture, dark | Same ordering/color semantics; no gray washout |
| `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-compact.png` | same fixture, compact | 52 px row and ≥44 px actions |
| `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-detail.png` | contextual Login detail | item-name h1; Fill is first visible section; edit/history focus returns |
| `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-invalid-form.png` | empty required-name submit | first invalid field focused/centered; one error announcement |
| `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-new-item.png` | New Item chooser | continuous list; type and folder keys restore focus |
| `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-folder-danger.png` | folder delete Sheet | Cancel initially focused; Escape/cancel returns to Delete |
| `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-archive.png` | Archive list, More opened | flat 52 px rows; menu returns to exact More trigger |
| `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-trash-danger.png` | permanent-delete Sheet after one synthetic failure | alert remains in Sheet; busy clears; retry succeeds |
| `docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-password-history.png` | populated history | contextual copy name; no password spoken or captured |

Run each capture command only after the popup is in the corresponding table state:

```bash
screencapture -x -i docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-light.png
screencapture -x -i docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-dark.png
screencapture -x -i docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-compact.png
screencapture -x -i docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-detail.png
screencapture -x -i docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-invalid-form.png
screencapture -x -i docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-new-item.png
screencapture -x -i docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-folder-danger.png
screencapture -x -i docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-archive.png
screencapture -x -i docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-trash-danger.png
screencapture -x -i docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-password-history.png
```

After all ten captures exist, verify every file and paste every command's output into the corresponding QA row:

```bash
for evidence_file in \
  docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-light.png \
  docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-dark.png \
  docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-compact.png \
  docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-detail.png \
  docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-invalid-form.png \
  docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-new-item.png \
  docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-folder-danger.png \
  docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-archive.png \
  docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-trash-danger.png \
  docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-password-history.png; do
  sips -g pixelWidth -g pixelHeight "$evidence_file"
  shasum -a 256 "$evidence_file"
done
```

- [ ] **Step 4: Record keyboard and VoiceOver evidence state by state**

Turn VoiceOver on with Command-F5. For each state, record `start focus`, literal `expected utterance`, literal `observed utterance`, `live-region count`, `end focus`, and `pass/fail`. Required records are:

| State/action | Expected VoiceOver record |
|---|---|
| OTP row → Copy | item name + “复制验证码”; exactly one copied status; zero countdown announcements during 5 seconds |
| Detail → Edit → Back | item-name heading, type/folder metadata, Fill first; focus returns to `detail-edit:<id>` |
| Detail → History → Back | history heading and contextual copy name without secret; focus returns to `detail-history:<id>` |
| Empty form → Save | required-name error exactly once; first invalid control owns focus |
| New Item → folder → Cancel | Folder action name; focus returns to `new-item:folder` |
| Folder delete | Cancel owns initial focus; Escape returns to exact Delete button |
| Archive/Trash More | item-context menu name; close returns to `archive-item:<id>`/`trash-item:<id>` |
| Permanent delete failure → Retry | one assertive failure; no duplicate announcement; retry success closes Sheet and returns focus |

For keyboard-only evidence, Tab through the state in visual order, use Escape to close the top layer, and record the focus-key value before navigation and after return. Compact mode must retain ≥44 px targets and must not introduce horizontal scrolling at 200% text.

- [ ] **Step 5: Write the reproducible QA record and compare visuals**

Create `docs/superpowers/specs/2026-08-17-ios27-vault-workflow-design-qa.md` with this exact structure and one completed row per screenshot:

```md
# iOS 27 Vault Workflow Native QA

Commit:
macOS:
Native command: npm run tauri:dev
Popup logical size: 480x600
Display scale / physical capture size:
Playwright/Chromium authorized: no

## Preflight commands
| Command | Exit code | Timestamp |
|---|---:|---|

## Native state evidence
| File | State | Logical/physical size | SHA-256 | Start focus key | End focus key | Visual result |
|---|---|---|---|---|---|---|

## VoiceOver and keyboard
| State/action | Expected utterance | Observed utterance | Live-region count | Start focus | End focus | Result |
|---|---|---|---:|---|---|---|

## Comparison findings
P0: 0
P1: 0
P2: 0
final result: passed
```

Compare each capture beside `docs/superpowers/specs/assets/barwarden-ios27-ui-visual-target.png` at the same scale. Check flat ordinary groups, overlay-only radius/shadow, dividers, semantic icon colors, typography, 16 px edge spacing, clipping, focus rings, light/dark contrast, and compact density. Do not write `final result: passed` until every row and VoiceOver field is filled and every P0/P1/P2 is fixed and recaptured.

- [ ] **Step 6: Optional Chromium diagnostic — only after explicit user authorization**

If and only if the user explicitly authorizes Chromium in the current session, add the DOM assertions to the four E2E files listed above at their matching state captures, then run:

| Optional E2E file | Exact states/assertions to add before its existing capture call |
|---|---|
| `apps/menubar-tauri/e2e/installed-ui-regressions.spec.ts` | OTP list/empty radius 0; copy/retry ≥44 px; compact row 52 px; `tab:/tabs/otp`; New Item exact five focus keys |
| `apps/menubar-tauri/e2e/official-login-workflow.spec.ts` | item-name h1; metadata; contextual Fill first; `detail-edit:calendar`; first-invalid focus; save busy/live status |
| `apps/menubar-tauri/e2e/official-personal-cipher-workflows.spec.ts` | flat form group; input radius 10 px/min-height 44 px; compact target size; first-invalid focus |
| `apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts` | Folder Cancel focus return; `archive-item:calendar`/`trash-item:calendar`; retryable Sheet alert/busy; semantic history list and contextual copy name |

```bash
npx playwright test apps/menubar-tauri/e2e/installed-ui-regressions.spec.ts apps/menubar-tauri/e2e/official-login-workflow.spec.ts apps/menubar-tauri/e2e/official-personal-cipher-workflows.spec.ts apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts --project=chromium --workers=1 --reporter=line
```

Record the authorization and command result in the QA file. Without authorization, leave all four E2E files unchanged, do not run `npx playwright`, and record `Playwright/Chromium authorized: no`; native Tauri evidence remains the acceptance authority.

- [ ] **Step 7: Final verification and commit QA**

```bash
npx vitest run apps/menubar-tauri/src/app/vault apps/menubar-tauri/src/app/upstream-overlays/vault-main apps/menubar-tauri/src/app/upstream-overlays/cipher-detail apps/menubar-tauri/src/app/upstream-overlays/cipher-form apps/menubar-tauri/src/app/upstream-overlays/recovery apps/menubar-tauri/src/app/evidence/recovery-workflow-evidence.spec.ts
npm run typecheck:official-login
npm run typecheck:official-personal
npm run typecheck:official-recovery
npm run build:web
```

Expected: all exit 0; native QA record is complete; VoiceOver speaks row context and one copy/save/error receipt; countdown ticks remain silent; compact targets stay 44 px; menus/Sheets return focus.

```bash
git add -f docs/superpowers/specs/2026-08-17-ios27-vault-workflow-design-qa.md
git add -f docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-light.png docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-dark.png docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-otp-compact.png docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-detail.png docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-invalid-form.png docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-new-item.png docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-folder-danger.png docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-archive.png docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-trash-danger.png docs/superpowers/specs/assets/barwarden-ios27-vault-workflow-password-history.png
git add -p apps/menubar-tauri/e2e/installed-ui-regressions.spec.ts apps/menubar-tauri/e2e/official-login-workflow.spec.ts apps/menubar-tauri/e2e/official-personal-cipher-workflows.spec.ts apps/menubar-tauri/e2e/official-recovery-workflows.spec.ts
git diff --cached --check
git commit -m "test: verify ios27 vault workflows"
```

Skip the E2E `git add -p` line when Chromium was not authorized and those files remain unchanged.

## Final self-review gate

- Run `rg -n "T[B]D|implement l[a]ter|fill in d[e]tails|similar to T[a]sk|add appr[o]priate|add valid[a]tion|handle edge c[a]ses" docs/superpowers/plans/2026-08-17-ios27-vault-workflows.md`; expected output is empty.
- Confirm every focus key matches the producer table and contains no username, password, TOTP seed, server URL, or email.
- Confirm the global iOS 27 interaction/accessibility plan links to this focus registry and does not redefine any Vault/OTP/New Item/folder/recovery value.
- Confirm `RecoveryPageCommand.trigger`, confirmation continuation, and both wrappers use the same types.
- Confirm ordinary Vault groups are radius 0/no shadow; real menus/Sheets retain overlay shape.
- Confirm native Tauri WebKit evidence and the per-file/per-state VoiceOver record are complete; Chromium was either explicitly authorized and recorded or was not launched and its E2E files stayed unchanged.
- Inspect `git status --short` and the staged diff before every commit; no unrelated user-owned hunk is staged.
