# iOS 27 Foundation and Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate visible geometry from 44px interaction geometry and make Header, scroll region, icon actions, and bottom navigation one compact shell contract for all routes.

**Architecture:** Add semantic tokens to `macos-tokens.css`, then consume them only through shared role classes in `global.css`. Existing Angular layout components keep their APIs; tests mount their real DOM and load production CSS. Family migrations consume these roles instead of adding page-name dimensions.

**Tech Stack:** CSS custom properties, Angular standalone layout components, Vitest/jsdom computed-style fixtures.

**Spec:** `docs/superpowers/specs/2026-08-20-ios27-full-ui-harmonization-design.md`

## Global Constraints

- Exact popup viewport is 480 × 600.
- Interactive owners remain at least 44 × 44px in normal and compact modes.
- Header and bottom navigation paint exactly 52px.
- Visible controls paint 40px normal and 36px compact; visible icon plates paint 32px normal and 28px compact.
- Shared shell owns safe areas; route pages do not calculate tab-bar overlap.
- Menus and Sheets retain their shaped material; ordinary groups remain flat.
- Preserve route/focus ownership and existing `FloatingTabSwitcherComponent.activate()` behavior.
- `global.css` and `app.visual.spec.ts` are hot files; stage only task hunks.

---

### Task 1: Define semantic visible and interaction tokens

**Files:**
- Modify: `apps/menubar-tauri/src/styles/macos-tokens.css`
- Modify: `apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts`
- Test: `apps/menubar-tauri/src/app/app.visual.spec.ts`

**Interfaces:**
- Consumes: existing `--mac-control-min-size`, `--mac-row-height`, `--mac-compact-row-height` compatibility tokens.
- Produces: `--mac-hit-size`, `--mac-header-height`, `--mac-tabbar-height`, `--mac-row-single`, `--mac-row-double`, `--mac-row-double-compact`, `--mac-control-visible`, `--mac-control-visible-compact`, `--mac-icon-plate`, `--mac-icon-plate-compact`, `--mac-page-inset`, `--mac-group-gap`, `--mac-group-gap-compact`.

- [ ] **Step 1: Replace the shared primitive expectations with a RED semantic-token test**

Add this test before the existing surface test in `ios27-shared-primitives.visual.spec.ts`:

```ts
it("separates 44px owners from compact visible geometry", () => {
  const style = installVisualCss(document);
  style.dataset["ios27Test"] = "true";
  document.body.innerHTML = `
    <button class="macos-hit-target"><span class="macos-icon-plate">Copy</span></button>
    <button class="macos-button-owner macos-primary-action">Save</button>
    <label class="macos-field-owner"><input class="macos-control-visible" /></label>
    <div class="macos-row macos-row--double">Row</div>
  `;
  const owner = getComputedStyle(document.querySelector<HTMLElement>(".macos-hit-target")!);
  const plate = getComputedStyle(document.querySelector<HTMLElement>(".macos-icon-plate")!);
  const fieldOwner = getComputedStyle(document.querySelector<HTMLElement>(".macos-field-owner")!);
  const input = getComputedStyle(document.querySelector<HTMLInputElement>("input")!);
  const row = getComputedStyle(document.querySelector<HTMLElement>(".macos-row")!);
  const primary = getComputedStyle(document.querySelector<HTMLElement>(".macos-button-owner")!);
  expect(owner.minWidth).toBe("44px");
  expect(owner.minHeight).toBe("44px");
  expect(plate.width).toBe("32px");
  expect(plate.height).toBe("32px");
  expect(fieldOwner.minHeight).toBe("44px");
  expect(input.height).toBe("40px");
  expect(row.minHeight).toBe("48px");
  expect(primary.minHeight).toBe("44px");
  expect(primary.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(style.textContent).toMatch(/\.macos-button-owner::before\s*{[^}]*inset-block:\s*2px/s);
  expect(style.textContent).toMatch(/data-bw-compact-mode="true"[^}]*\.macos-button-owner::before\s*{[^}]*inset-block:\s*4px/s);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts -t "separates 44px"`

Expected: FAIL because semantic tokens/classes do not exist and the existing universal row is 52px.

- [ ] **Step 3: Add the exact token contract**

Add inside the root token block in `macos-tokens.css`:

```css
--mac-hit-size: 44px;
--mac-header-height: 52px;
--mac-tabbar-height: 52px;
--mac-row-single: 44px;
--mac-row-double: 48px;
--mac-row-double-compact: 44px;
--mac-control-visible: 40px;
--mac-control-visible-compact: 36px;
--mac-icon-plate: 32px;
--mac-icon-plate-compact: 28px;
--mac-page-inset: 16px;
--mac-group-gap: 20px;
--mac-group-gap-compact: 16px;
```

Add role classes to `global.css`:

```css
.macos-hit-target { min-width:var(--mac-hit-size); min-height:var(--mac-hit-size); }
.macos-icon-plate { display:grid; width:var(--mac-icon-plate); height:var(--mac-icon-plate); place-items:center; border-radius:var(--mac-control-radius); }
.macos-field-owner { display:flex; min-height:var(--mac-hit-size); align-items:center; }
.macos-control-visible { width:100%; height:var(--mac-control-visible); min-height:var(--mac-control-visible); }
.macos-button-owner { position:relative; isolation:isolate; min-height:var(--mac-hit-size); border:0; background:transparent; }
.macos-button-owner::before { content:""; position:absolute; inset-block:2px; inset-inline:0; z-index:-1; border-radius:var(--mac-control-radius); background:var(--mac-accent); }
.macos-row { min-height:var(--mac-row-single); }
.macos-row--double { min-height:var(--mac-row-double); }
:root[data-bw-compact-mode="true"] .macos-icon-plate { width:var(--mac-icon-plate-compact); height:var(--mac-icon-plate-compact); }
:root[data-bw-compact-mode="true"] .macos-control-visible { height:var(--mac-control-visible-compact); min-height:var(--mac-control-visible-compact); }
:root[data-bw-compact-mode="true"] .macos-button-owner::before { inset-block:4px; }
:root[data-bw-compact-mode="true"] .macos-row--double { min-height:var(--mac-row-double-compact); }
```

Do not redefine `--mac-control-min-size`; it remains a compatibility alias until every family migrates.

- [ ] **Step 4: Run GREEN and token regression**

```bash
npx vitest run apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts apps/menubar-tauri/src/app/app.visual.spec.ts
```

Expected: PASS with the new geometry and unchanged theme/material tokens.

- [ ] **Step 5: Commit only semantic tokens and tests**

```bash
git add apps/menubar-tauri/src/styles/macos-tokens.css apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css apps/menubar-tauri/src/app/app.visual.spec.ts
git diff --cached --check
git commit -m "style: separate ios27 visible and hit geometry"
```

### Task 2: Compact Header and page safe areas

**Files:**
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Modify: `apps/menubar-tauri/src/app/layout/popup-layout.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/popup-shell/popup-shell.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/app.routes.spec.ts`
- Test: `apps/menubar-tauri/src/app/route-shell.guard.spec.ts`

**Interfaces:**
- Consumes: `PopupHeaderComponent` and `PopupPageComponent` vendor exports without API changes.
- Produces: a 52px `popup-header > header`, a 16px page inset, and `--mac-page-bottom-safe` set by shell context.

- [ ] **Step 1: Add a RED mounted shell geometry test**

Add to `popup-layout.component.spec.ts` using its existing real `PopupPageComponent` fixture:

```ts
it("gives header one 52px slot and keeps the scroll owner above navigation", async () => {
  installAccessibilityCss();
  await TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const header = getComputedStyle(host.querySelector<HTMLElement>("popup-header > header")!);
  const scroller = getComputedStyle(host.querySelector<HTMLElement>('[data-testid="popup-layout-scroll-region"]')!);
  expect(header.height).toBe("52px");
  expect(scroller.paddingInlineStart).toBe("16px");
  expect(scroller.paddingInlineEnd).toBe("16px");
  expect(scroller.paddingBottom).toBe("64px");
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/layout/popup-layout.component.spec.ts -t "one 52px slot"`

Expected: FAIL on the current taller header or route-local safe-area padding.

- [ ] **Step 3: Implement shared shell geometry**

Add/replace the shared rules in `global.css`:

```css
popup-header > header { height:var(--mac-header-height); min-height:var(--mac-header-height); padding-inline:4px; }
popup-header > header :is(button,a) { min-width:var(--mac-hit-size); min-height:var(--mac-hit-size); }
popup-header > header h1 { font-size:17px; line-height:22px; font-weight:650; letter-spacing:-.01em; }
popup-page { --mac-page-bottom-safe:16px; }
.popup-shell popup-page { --mac-page-bottom-safe:calc(var(--mac-tabbar-height) + 12px); }
popup-page [data-testid="popup-layout-scroll-region"] { padding-inline:var(--mac-page-inset); padding-bottom:var(--mac-page-bottom-safe); }
```

Delete the existing `:root` declarations for `--mac-floating-navigation-height`,
`--mac-floating-navigation-bottom-offset`, and `--mac-floating-navigation-safe-gap`, then replace
the single `.popup-shell popup-page [data-testid="popup-layout-scroll-region"]` padding/scroll-padding
block with the `--mac-page-bottom-safe` rule above. Leave all other route-local `padding-bottom`
rules unchanged in this task.

- [ ] **Step 4: Run Header/shell GREEN**

```bash
npx vitest run apps/menubar-tauri/src/app/layout/popup-layout.component.spec.ts apps/menubar-tauri/src/app/popup-shell/popup-shell.component.spec.ts apps/menubar-tauri/src/app/app.routes.spec.ts apps/menubar-tauri/src/app/route-shell.guard.spec.ts
npm run build:web
```

Expected: PASS; no route gains two headers, and secondary routes remain without bottom tabs.

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/layout/popup-layout.component.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: compact ios27 popup header"
```

### Task 3: Compact bottom navigation without shrinking its targets

**Files:**
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Modify: `apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/popup-shell/popup-shell.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts`

**Interfaces:**
- Consumes: `FloatingTabSwitcherComponent.tabs`, `selectedIndex`, `activate(tab, event)` unchanged.
- Produces: `.floating-tab-switcher` 52px, `.floating-tab-switcher__segment` 44px target, 18px icon, 10–11px label, and a quiet selection indicator.

- [ ] **Step 1: Add RED computed-style assertions to the real tab fixture**

```ts
it("paints a 52px tab bar with 44px segments and a quiet indicator", async () => {
  await TestBed.configureTestingModule({
    imports: [FloatingTabSwitcherComponent],
    providers: [
      provideRouter(routes),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
    ],
  }).compileComponents();
  const router = TestBed.inject(Router);
  const fixture = TestBed.createComponent(FloatingTabSwitcherComponent);
  fixture.componentRef.setInput("tabs", tabs);
  await router.navigateByUrl("/tabs/vault");
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;
  const nav = getComputedStyle(host.querySelector<HTMLElement>("nav")!);
  const segment = getComputedStyle(host.querySelector<HTMLButtonElement>("button")!);
  const icon = getComputedStyle(host.querySelector<HTMLElement>(".floating-tab-switcher__icon")!);
  expect(nav.height).toBe("52px");
  expect(segment.minHeight).toBe("44px");
  expect(icon.fontSize).toBe("18px");
  expect(host.querySelectorAll(".floating-tab-switcher__indicator")).toHaveLength(1);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.spec.ts -t "52px tab bar"`

Expected: FAIL because the current bar and selected capsule are larger.

- [ ] **Step 3: Implement compact tab geometry**

```css
.floating-tab-switcher { height:var(--mac-tabbar-height); min-height:var(--mac-tabbar-height); padding:4px 8px; border-radius:12px 12px 0 0; }
.floating-tab-switcher__segment { min-width:var(--mac-hit-size); min-height:var(--mac-hit-size); gap:1px; padding:2px 4px; border-radius:9px; }
.floating-tab-switcher__icon { font-size:18px; line-height:20px; }
.floating-tab-switcher__label { font-size:10.5px; line-height:12px; font-weight:550; }
.floating-tab-switcher__indicator { inset-block:4px; border-radius:9px; background:var(--mac-selected); box-shadow:none; }
```

Keep `data-popup-focus-key` and post-navigation focus unchanged.

- [ ] **Step 4: GREEN and focus regression**

```bash
npx vitest run apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.spec.ts apps/menubar-tauri/src/app/popup-shell/popup-shell.component.spec.ts apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts
npm run build:web
```

Expected: PASS including semantic focus restoration after tab switches.

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: compact ios27 popup navigation"
```

### Task 4: Normalize focus, press, motion, and accessibility variants

**Files:**
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Modify: `apps/menubar-tauri/src/app/official-ui/ios27-accessibility.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/ios27-production-accessibility.visual.spec.ts`
- Test: `apps/menubar-tauri/src/app/official-ui/app-bottom-sheet.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/official-ui/app-feedback.component.spec.ts`

**Interfaces:**
- Produces one 2px focus-visible ring, 160/180/200ms motion roles, and opaque fallbacks for reduced transparency/contrast.
- Preserves overlay focus trap, Escape ownership, and feedback announcement behavior.

- [ ] **Step 1: Write RED assertions against real controls**

In `ios27-production-accessibility.visual.spec.ts`, extend the existing `mountHost()`,
`productionFocusPairs()`, `exposeFocusVisible()` and `visibleOutlineCount()` fixture contract. Add this
exact loop instead of introducing a synthetic focus helper:

```ts
const fixture = await mountHost();
const host = fixture.nativeElement as HTMLElement;
for (const { input, owner } of productionFocusPairs(host)) {
  input.focus();
  expect(visibleOutlineCount(getComputedStyle(input), getComputedStyle(owner))).toBe(0);
  input.blur();

  exposeFocusVisible(input);
  expect(visibleOutlineCount(getComputedStyle(input), getComputedStyle(owner))).toBe(1);
  expect(getComputedStyle(owner).outlineWidth).toBe("2px");
  clearFocusVisible(input);
}
```

Keep reduced-motion and forced-colors assertions in
`ios27-accessibility.visual.spec.ts`, using its existing `mountHost({ reducedMotion: true })` and
`mountHost({ forcedColors: true })` helpers; do not create a second media-query fixture.

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/official-ui/ios27-accessibility.visual.spec.ts apps/menubar-tauri/src/app/official-ui/ios27-production-accessibility.visual.spec.ts`

Expected: FAIL on any remaining 3px/double focus ring or motion duration that is not tokenized.

- [ ] **Step 3: Add only semantic state rules**

```css
:root { --mac-motion-fast:160ms; --mac-motion-navigation:180ms; --mac-motion-sheet:200ms; }
.macos-pressable { transition:background-color var(--mac-motion-fast) ease, color var(--mac-motion-fast) ease, opacity var(--mac-motion-fast) ease; }
.macos-pressable:active { background:var(--mac-pressed); }
.macos-page :is(button,a,input,select,textarea,[tabindex]):focus:not(:focus-visible) { outline:0; }
.macos-page :is(button,a,input,select,textarea,[tabindex]):focus-visible { outline:2px solid var(--mac-focus); outline-offset:2px; }
@media (prefers-reduced-motion:reduce) { .macos-pressable, .floating-tab-switcher__indicator, .app-bottom-sheet { transition-duration:0s !important; transform:none !important; } }
@media (prefers-reduced-transparency:reduce), (prefers-contrast:more) { .macos-glass-navigation { background:var(--mac-surface-solid); backdrop-filter:none; border-color:var(--mac-border); } }
```

- [ ] **Step 4: Run the complete foundation gate**

```bash
npx vitest run apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts apps/menubar-tauri/src/app/official-ui/ios27-accessibility.visual.spec.ts apps/menubar-tauri/src/app/official-ui/ios27-production-accessibility.visual.spec.ts apps/menubar-tauri/src/app/layout/popup-layout.component.spec.ts apps/menubar-tauri/src/app/popup-shell/floating-tab-switcher.component.spec.ts apps/menubar-tauri/src/app/official-ui/app-bottom-sheet.component.spec.ts apps/menubar-tauri/src/app/official-ui/app-feedback.component.spec.ts
npm run typecheck:m14
npm run build:web
```

Expected: PASS. If an unrelated dirty file breaks the broad typecheck, prove the same failure from committed baseline and run a strict temporary tsconfig containing every touched TypeScript file; do not call the broad gate green.

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/official-ui/ios27-accessibility.visual.spec.ts apps/menubar-tauri/src/app/official-ui/ios27-production-accessibility.visual.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: normalize ios27 shell interaction states"
```
