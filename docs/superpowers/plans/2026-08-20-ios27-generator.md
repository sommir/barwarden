# iOS 27 Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Generator and Generator History compact, result-first, and visually consistent while keeping generated credentials actively readable and never automatically announced.

**Architecture:** Route/state owners remain unchanged. Retained Generator presentation changes only through `official-generator-member-transforms.ts` and the exact manifest. Shared geometry roles replace page-local 44px filled blocks; the history content remains non-live while its values remain in the accessibility tree.

**Tech Stack:** Angular, retained Generator overlays, Vitest real-DOM fixtures, CSS tokens, exact closure manifest.

**Spec:** `docs/superpowers/specs/2026-08-20-ios27-full-ui-harmonization-design.md`

## Global Constraints

- Routes: `/tabs/generator`, `/generator-history`.
- Result block visible height target is 68–72px; Copy is the only filled action.
- Copy/Regenerate owners are 44px; visible plates are 32/28px.
- Segmented control is 40/36px and remains one radiogroup-like control.
- Option fields paint 40/36px inside 44px owners.
- History rows are 48px normal, 44px compact; values remain accessible but no live/status/alert region may contain a credential.
- Run `npm run update:official-generator-manifest` twice; authority pins/revision stay unchanged.

---

### Task 1: Compact the result and mode regions

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-core.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Modify: `apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts`
- Guard: `apps/menubar-tauri/src/app/upstream-overlays/generator/generator-overlay.guard.spec.ts`

**Interfaces:**
- Preserve `value$`, `generate(USER_REQUEST)`, `bwGeneratorClipboard`, root selection, labels, and `/generator-history` navigation.
- Produces `.macos-generator__result`, `__value`, `__result-actions`, `__mode`, and shared hit/plate roles.

- [ ] **Step 1: Add RED real-DOM geometry and hierarchy assertions**

```ts
const result = host.querySelector<HTMLElement>(".macos-generator__result")!;
const copy = host.querySelector<HTMLButtonElement>('[data-testid="generator-copy"]')!;
const regenerate = host.querySelector<HTMLButtonElement>('[data-testid="generator-regenerate"]')!;
expect(result.compareDocumentPosition(host.querySelector(".macos-generator__mode")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(parseFloat(getComputedStyle(result).minHeight)).toBeGreaterThanOrEqual(68);
expect(parseFloat(getComputedStyle(result).minHeight)).toBeLessThanOrEqual(72);
expect(getComputedStyle(copy).minWidth).toBe("44px");
expect(getComputedStyle(copy.querySelector<HTMLElement>(".bwi")!).width).toBe("32px");
expect(copy.getAttribute("buttontype")).toBe("primary");
expect(regenerate.getAttribute("buttontype")).toBe("primaryGhost");
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`

Expected: FAIL because action plates and result region still use the old oversized geometry.

- [ ] **Step 3: Apply exact presentation hooks**

Keep all current event bindings and apply these two bounded opening-tag edits:

```diff
 <button
+  class="macos-hit-target"
   data-testid="generator-copy"
   data-popup-focus-key="generator:copy"
@@
 <button
+  class="macos-hit-target"
   data-testid="generator-regenerate"
```

Place the visible plate on the Bitwarden icon-button's real generated `.bwi` glyph via the scoped selector `.macos-generator__result-actions button > .bwi`; the test queries that production glyph node.

Use this CSS:

```css
.macos-generator__result { min-height:68px; margin:0; padding:8px 0 12px; border:0; border-bottom:1px solid var(--mac-border-subtle); border-radius:0; background:transparent; box-shadow:none; }
.macos-generator__result-actions { display:flex; gap:4px; align-items:center; }
.macos-generator__result-actions button { min-width:var(--mac-hit-size); min-height:var(--mac-hit-size); padding:6px; }
.macos-generator__result-actions button > .bwi { display:grid; width:var(--mac-icon-plate); height:var(--mac-icon-plate); place-items:center; border-radius:var(--mac-control-radius); }
.macos-generator__mode bit-toggle-group { min-height:var(--mac-hit-size); }
.macos-generator__mode bit-toggle { height:var(--mac-control-visible); min-height:var(--mac-control-visible); }
:root[data-bw-compact-mode="true"] .macos-generator__mode bit-toggle { height:var(--mac-control-visible-compact); min-height:var(--mac-control-visible-compact); }
```

Update the core-template operation in `official-generator-member-transforms.ts` that already owns `official-generator-core.component.html`, then run the updater twice.

- [ ] **Step 4: GREEN and exact guard**

```bash
npm run update:official-generator-manifest
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts apps/menubar-tauri/src/app/upstream-overlays/generator/generator-overlay.guard.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-core.component.html apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.html apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts apps/menubar-tauri/src/app/upstream-overlays/generator/official-credential-generator.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: compact ios27 generator result"
```

### Task 2: Normalize Generator option fields and character choices

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-core.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Modify: `apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`
- Guard: `apps/menubar-tauri/src/app/upstream-overlays/generator/generator-overlay.guard.spec.ts`

**Interfaces:**
- Preserve every algorithm option and `(onUpdated)` expression.
- Character sets remain independent checkboxes; Length/word-count/numeric fields use `.macos-field-owner > .macos-control-visible`.

- [ ] **Step 1: Add RED option geometry tests**

```ts
for (const field of host.querySelectorAll<HTMLElement>(".macos-generator__settings [bitfieldcontainer]")) {
  expect(parseFloat(getComputedStyle(field).minHeight)).toBeGreaterThanOrEqual(44);
  const visible = field.querySelector<HTMLElement>("input,select,[role=combobox]");
  if (visible) expect(["40px", "36px"]).toContain(getComputedStyle(visible).height);
}
expect(host.querySelectorAll('.macos-generator__character-choice input[type="checkbox"]').length).toBeGreaterThanOrEqual(4);
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts -t "option fields"`

- [ ] **Step 3: Add role classes without changing option bindings**

For each retained `bit-form-field`, add `class="macos-field-owner"`; for its input/select add `class="macos-control-visible"`. Add `macos-generator__character-choice` to the existing A–Z/a–z/0–9/symbol form-control wrappers. Use:

```css
.macos-generator__settings { display:grid; gap:12px; margin:0; }
.macos-generator__settings [bitfieldcontainer] { min-height:var(--mac-hit-size); margin:0; }
.macos-generator__settings :is(input,select,[role="combobox"]) { height:var(--mac-control-visible); min-height:var(--mac-control-visible); border-radius:var(--mac-control-radius); }
.macos-generator__character-choice { min-height:var(--mac-hit-size); margin:0; }
:root[data-bw-compact-mode="true"] .macos-generator__settings :is(input,select,[role="combobox"]) { height:var(--mac-control-visible-compact); min-height:var(--mac-control-visible-compact); }
```

- [ ] **Step 4: GREEN, updater, typecheck**

```bash
npm run update:official-generator-manifest
npm run update:official-generator-manifest
npx vitest run apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts apps/menubar-tauri/src/app/upstream-overlays/generator/generator-overlay.guard.spec.ts
npm run typecheck:official-generator
```

Expected: second updater run has no diff; all Generator options retain their values/events.

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-core.component.html apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: compact ios27 generator options"
```

### Task 3: Compact Generator History without hiding credentials

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history-rows.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Modify: `apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`
- Guard: `apps/menubar-tauri/src/app/upstream-overlays/generator/generator-overlay.guard.spec.ts`

**Interfaces:**
- History container is not live. Rows are `role=listitem`; visible credential components remain in the accessibility tree. Copy actions keep safe accessible names.

- [ ] **Step 1: Add RED accessible/geometry assertions**

```ts
const content = host.querySelector<HTMLElement>('[data-testid="generator-history-content"]')!;
expect(content.hasAttribute("aria-live")).toBe(false);
for (const row of host.querySelectorAll<HTMLElement>('[role="listitem"]')) {
  expect(getComputedStyle(row).minHeight).toBe("48px");
  expect(row.querySelector("bit-color-password")?.hasAttribute("aria-hidden")).toBe(false);
}
for (const live of host.querySelectorAll('[aria-live],[role="status"],[role="alert"]')) {
  expect(live.textContent).not.toContain("correct horse battery staple");
}
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts`

- [ ] **Step 3: Apply history row roles and CSS**

Apply these exact wrapper/row class edits without changing the existing value, timestamp, or Copy child nodes:

```diff
-<section class="macos-generator-history__content">
+<section class="macos-generator-history__content" data-testid="generator-history-content">
@@
-  class="macos-generator-history__row"
+  class="macos-generator-history__row macos-row macos-row--double"
```

Do not add `aria-hidden` to `bit-color-password`. Add:

```css
.macos-generator-history__row { min-height:var(--mac-row-double); padding:4px 0 4px 12px; border-bottom:1px solid var(--mac-border-subtle); border-radius:0; box-shadow:none; }
.macos-generator-history__row button { min-width:var(--mac-hit-size); min-height:var(--mac-hit-size); }
:root[data-bw-compact-mode="true"] .macos-generator-history__row { min-height:var(--mac-row-double-compact); }
```

- [ ] **Step 4: Complete Generator gate**

```bash
npm run update:official-generator-manifest
npm run update:official-generator-manifest
npx vitest run apps/menubar-tauri/src/app/generator apps/menubar-tauri/src/app/upstream-overlays/generator
npm run typecheck:official-generator
npm run build:web
```

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history.component.html apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-history-rows.component.html apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator-member-transforms.ts apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts apps/menubar-tauri/src/app/generator/generator-send-ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/app/upstream-overlays/generator/official-generator.transform-manifest.json apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: compact ios27 generator history"
```
