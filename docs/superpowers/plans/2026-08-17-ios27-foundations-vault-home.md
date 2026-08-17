# iOS 27 Foundations and Vault Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved luminous, flat iOS 27 visual foundation and apply it to the Vault home, contextual AutoFill suggestions, search results, and credential quick actions.

**Architecture:** Keep the existing Angular, Bitwarden component adapters, vault state, AutoFill candidate services, and security flows. Centralize the new palette and interaction dimensions in `macos-tokens.css`, let `VaultListPageComponent` give active search precedence over the contextual outlet, and use shared CSS/data attributes to style continuous list rows and semantic field-action colors without duplicating behavior.

**Tech Stack:** Angular 21 standalone components, TypeScript 5.9, Vitest 4, Bitwarden retained UI components, CSS custom properties, Tauri 2/WebKit.

## Global Constraints

- The menu-bar viewport is exactly `480 × 600`; popout mode remains responsive within existing maximum widths.
- Light canvas is `#F4F8FF`, main surface is `#FBFDFF`, contextual surface is `#EAF2FF`, primary text is `#111827`, and secondary text is `#536784`.
- Username actions use `#0A66FF`, password actions use `#6657D9`, and TOTP actions use `#E98A15` in light mode.
- Dark canvas is `#101621`, main surface is `#151D2A`, contextual surface is `#1A2638`, primary text is `#F4F7FB`, and secondary text is `#A9B7CC`.
- Every icon control keeps an `18–20 px` glyph inside a hit target of at least `44 × 44 px`.
- Normal rows are `52 px`; a two-line row may be `56 px`, but rows in one group must stay consistent.
- Normal lists, settings groups, and field groups have no shadow; only menus, sheets, and bottom navigation may retain one light shadow.
- Login rows expose username, password, and TOTP actions only when the corresponding field exists; non-login rows never receive invented credential actions.
- Do not change vault data, encryption, sync, candidate ranking, native AutoFill contracts, reprompt, or domain-mismatch rules.
- Do not add a UI framework, new page, custom SVG system, filter chips, or result-count control.
- Preserve unrelated changes in the dirty worktree and stage only files named by each task.
- The user explicitly authorized implementation directly on the current `main` branch; do not create a worktree or switch branches.
- New visual regressions must assert computed styles or rendered component behavior, not grep source text. Existing source-inspection tests may remain when unrelated to this slice.

## Scope Boundary

The approved specification spans several independent surfaces. This plan deliberately finishes the shared visual foundation and Vault home as one testable release slice. Vault detail/generator, settings/appearance, and authentication/sheets will each receive a separate follow-on implementation plan after this slice establishes the shared pattern.

## File Map

- `apps/menubar-tauri/src/styles/macos-tokens.css`: single source of truth for light/dark surfaces, semantic action colors, target sizes, and accessibility fallbacks.
- `apps/menubar-tauri/src/styles/global.css`: shared Vault header, search, disclosure, continuous list, row state, and 44 px action-target styling.
- `apps/menubar-tauri/src/app/vault/vault-list-page.component.ts`: page ordering and search-precedence rule for contextual suggestions.
- `apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts`: behavior contract for suggestion visibility across search transitions.
- `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.ts`: existing field-action attributes and accessible behavior; no candidate or security logic changes.
- `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.css`: contextual section tint and local field-action presentation.
- `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts`: suggestion action order, availability, accessibility, and click-isolation tests.
- `apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.html`: semantic `data-field` hooks for ordinary Vault quick actions.
- `apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts`: ordinary row capability and attribute contracts.
- `apps/menubar-tauri/src/app/app.visual.spec.ts`: exact visual-token and shared CSS regression contracts.

---

### Task 1: Install the approved light/dark token system

**Files:**
- Modify: `apps/menubar-tauri/src/styles/macos-tokens.css`
- Test: `apps/menubar-tauri/src/app/app.visual.spec.ts`

**Interfaces:**
- Consumes: existing `--mac-*` and `--bw-*` custom-property consumers.
- Produces: `--mac-surface-contextual`, `--mac-action-username`, `--mac-action-password`, `--mac-action-totp`, `--mac-icon-website`, and `--mac-icon-card`; raises `--mac-control-min-size` to `44px`.

- [ ] **Step 1: Write the failing light-theme computed-style test**

Add this test helper and test to `app.visual.spec.ts`:

```ts
function installVisualCss(...paths: readonly string[]): () => void {
  const style = document.createElement("style");
  style.textContent = paths
    .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  document.head.append(style);
  return () => style.remove();
}

it("resolves the approved luminous palette and semantic field colors", () => {
  const cleanup = installVisualCss("apps/menubar-tauri/src/styles/macos-tokens.css");
  const root = document.documentElement;
  root.removeAttribute("data-bw-theme");
  const style = getComputedStyle(root);

  expect(style.getPropertyValue("--mac-canvas").trim()).toBe("#f4f8ff");
  expect(style.getPropertyValue("--mac-surface-solid").trim()).toBe("#fbfdff");
  expect(style.getPropertyValue("--mac-surface-contextual").trim()).toBe("#eaf2ff");
  expect(style.getPropertyValue("--mac-text-primary").trim()).toBe("#111827");
  expect(style.getPropertyValue("--mac-text-secondary").trim()).toBe("#536784");
  expect(style.getPropertyValue("--mac-action-username").trim()).toBe("#0a66ff");
  expect(style.getPropertyValue("--mac-action-password").trim()).toBe("#6657d9");
  expect(style.getPropertyValue("--mac-action-totp").trim()).toBe("#e98a15");
  expect(style.getPropertyValue("--mac-control-min-size").trim()).toBe("44px");

  cleanup();
});
```

- [ ] **Step 2: Run the light-theme test to verify it fails**

Run:

```bash
npx vitest run apps/menubar-tauri/src/app/app.visual.spec.ts
```

Expected: FAIL because the contextual and semantic action variables do not exist and the current canvas is gray.

- [ ] **Step 3: Replace the light palette and add semantic variables**

Change the light `:root` variables in `macos-tokens.css` to this contract, retaining spacing aliases and `--bw-*` mappings below them:

```css
:root {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;

  --mac-canvas: #f4f8ff;
  --mac-popup-material: #f4f8ff;
  --mac-auth-background: #f4f8ff;
  --mac-surface-solid: #fbfdff;
  --mac-surface-raised: #ffffff;
  --mac-surface-contextual: #eaf2ff;
  --mac-text-primary: #111827;
  --mac-text-secondary: #536784;
  --mac-text-tertiary: #71819a;
  --mac-border: #b9cbe3;
  --mac-border-subtle: #d4e1f2;
  --mac-hover: rgb(10 102 255 / 6%);
  --mac-pressed: rgb(10 102 255 / 11%);
  --mac-selected: rgb(10 102 255 / 10%);
  --mac-focus: #0a66ff;
  --mac-disabled: rgb(83 103 132 / 42%);
  --mac-scrim: rgb(17 24 39 / 30%);
  --mac-shadow: rgb(24 52 88 / 16%);
  --mac-destructive: #d70015;
  --mac-warning: #9a6700;
  --mac-success: #248a3d;
  --mac-accent: #0a66ff;
  --mac-action-username: #0a66ff;
  --mac-action-password: #6657d9;
  --mac-action-totp: #e98a15;
  --mac-icon-website: #2196c9;
  --mac-icon-card: #159a8a;
  --mac-control-min-size: 44px;
}
```

Replace the menu-bar-only light overrides with `--mac-canvas: rgb(244 248 255 / 94%)`, `--mac-surface-raised: rgb(255 255 255 / 92%)`, and `--mac-popup-material: rgb(244 248 255 / 94%)` so native transparency does not reintroduce the gray cast.

- [ ] **Step 4: Write the failing dark-theme computed-style test**

Add to the same test file:

```ts
it("defines a solid dark surface ladder and brighter semantic actions", () => {
  const cleanup = installVisualCss("apps/menubar-tauri/src/styles/macos-tokens.css");
  const root = document.documentElement;
  root.setAttribute("data-bw-theme", "dark");
  const style = getComputedStyle(root);

  expect(style.getPropertyValue("--mac-canvas").trim()).toBe("#101621");
  expect(style.getPropertyValue("--mac-surface-solid").trim()).toBe("#151d2a");
  expect(style.getPropertyValue("--mac-surface-contextual").trim()).toBe("#1a2638");
  expect(style.getPropertyValue("--mac-action-username").trim()).toBe("#4c8dff");
  expect(style.getPropertyValue("--mac-action-password").trim()).toBe("#9b8cff");
  expect(style.getPropertyValue("--mac-action-totp").trim()).toBe("#ffb454");

  root.removeAttribute("data-bw-theme");
  cleanup();
});
```

- [ ] **Step 5: Run the dark-theme test to verify it fails**

Run the same focused Vitest command. Expected: FAIL on the old gray dark surfaces and missing semantic variables.

- [ ] **Step 6: Implement the dark and system-theme equivalents**

Apply these values to both explicit dark mode and the `prefers-color-scheme: dark` system branch:

```css
--mac-canvas: #101621;
--mac-surface-solid: #151d2a;
--mac-surface-raised: #1b2534;
--mac-surface-contextual: #1a2638;
--mac-text-primary: #f4f7fb;
--mac-text-secondary: #a9b7cc;
--mac-text-tertiary: #8797af;
--mac-border: rgb(197 216 241 / 30%);
--mac-border-subtle: rgb(197 216 241 / 18%);
--mac-hover: rgb(76 141 255 / 9%);
--mac-pressed: rgb(76 141 255 / 15%);
--mac-selected: rgb(76 141 255 / 16%);
--mac-focus: #4c8dff;
--mac-accent: #4c8dff;
--mac-action-username: #4c8dff;
--mac-action-password: #9b8cff;
--mac-action-totp: #ffb454;
--mac-icon-website: #5cc8e8;
--mac-icon-card: #43cdba;
--mac-popup-material: #101621;
--mac-auth-background: #101621;
```

- [ ] **Step 7: Run the visual token tests**

Run the focused Vitest command. Expected: PASS.

- [ ] **Step 8: Commit the token slice**

```bash
git add apps/menubar-tauri/src/styles/macos-tokens.css apps/menubar-tauri/src/app/app.visual.spec.ts
git commit -m "style: add luminous ios27 surface tokens"
```

---

### Task 2: Make active search take precedence over AutoFill suggestions

**Files:**
- Modify: `apps/menubar-tauri/src/app/vault/vault-list-page.component.ts`
- Test: `apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts`

**Interfaces:**
- Consumes: `VaultListPageComponent.hasSearchQuery` and the existing `VAULT_CONTEXTUAL_SECTION` provider.
- Produces: template rule `showContextualSection: boolean`; no change to the contextual section injection token or candidate service.

- [ ] **Step 1: Write the failing search-precedence test**

Add a ready Vault test using the same `PopupStateStore`, `VaultFacade`, router, and `VaultActionsService` providers already used in the file:

```ts
it("shows contextual suggestions only while the Vault search is empty", async () => {
  const store = new PopupStateStore();
  store.setUnlocked("user@example.com");
  store.setItems(demoVaultItems, demoFolders);
  await TestBed.configureTestingModule({
    imports: [VaultListPageComponent],
    providers: [
      provideRouter([]),
      { provide: PopupStateStore, useValue: store },
      VaultFacade,
      { provide: VaultActionsService, useValue: {} },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(VaultListPageComponent);
  fixture.detectChanges();
  const host = fixture.nativeElement as HTMLElement;

  expect(host.querySelector("bw-vault-contextual-section-outlet")).not.toBeNull();

  fixture.componentInstance.setSearch("github");
  fixture.detectChanges();
  expect(host.querySelector("bw-vault-contextual-section-outlet")).toBeNull();

  fixture.componentInstance.setSearch("   ");
  fixture.detectChanges();
  expect(host.querySelector("bw-vault-contextual-section-outlet")).not.toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts
```

Expected: FAIL because the outlet remains mounted while a search query is active.

- [ ] **Step 3: Add one explicit visibility getter**

Add to `VaultListPageComponent`:

```ts
get showContextualSection(): boolean {
  return !this.hasSearchQuery && this.vaultState === "ready";
}
```

Replace the current contextual outlet condition with:

```html
@if (showContextualSection) {
  <bw-vault-contextual-section-outlet />
}
```

Do not pass search state into the dynamic component and do not mutate or invalidate AutoFill candidates when search starts.

- [ ] **Step 4: Run the component tests**

Run the same focused Vitest command. Expected: PASS, including existing empty/no-results/sync behavior.

- [ ] **Step 5: Commit the search-intent slice**

```bash
git add apps/menubar-tauri/src/app/vault/vault-list-page.component.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts
git commit -m "feat: prioritize vault search over suggestions"
```

---

### Task 3: Apply semantic colors and 44 px targets to credential actions

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.html`
- Modify: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.css`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/app.visual.spec.ts`

**Interfaces:**
- Consumes: existing `usernameField`, `passwordField`, `otpField`, `capabilityFields()`, `data-field` on suggestion actions, and existing accessible labels.
- Produces: `data-field="username" | "password" | "totp"` on ordinary row actions and CSS selectors keyed to those values.

- [ ] **Step 1: Write the failing ordinary-row capability test**

Extend `retained-vault-list-item.component.spec.ts`:

```ts
it("marks credential actions with stable semantic field names", async () => {
  const fixture = await createLoginRow();
  const host = fixture.nativeElement as HTMLElement;

  expect(host.querySelector('[data-field="username"] .bwi-user')).not.toBeNull();
  expect(host.querySelector('[data-field="password"] .bwi-key')).not.toBeNull();
  expect(host.querySelector('[data-field="totp"] .bwi-clock')).not.toBeNull();
  expect([...host.querySelectorAll("[data-field]")].map((node) => node.getAttribute("data-field")))
    .toEqual(["username", "password", "totp"]);
});
```

- [ ] **Step 2: Run the row test to verify it fails**

```bash
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts
```

Expected: FAIL because ordinary row action buttons do not expose `data-field`.

- [ ] **Step 3: Add data attributes without changing action behavior**

Add the matching attribute to the three existing buttons in `retained-vault-list-item.component.html`:

```html
data-field="username"
data-field="password"
data-field="totp"
```

Keep the existing `bitIconButton`, `label`, field capability checks, and `(click)="fillField(field, $event)"` bindings unchanged.

- [ ] **Step 4: Strengthen the suggestion action-order test**

In `vault-autofill-suggestions.component.spec.ts`, add:

```ts
const actionFields = [...row!.querySelectorAll<HTMLElement>(
  '[data-testid="vault-autofill-field-action"]',
)].map((button) => button.dataset["field"]);
expect(actionFields).toEqual(["username", "password", "totp"]);
```

Also dispatch a click on the password action and assert the row-body router navigation spy remains untouched before the existing field-action expectation.

- [ ] **Step 5: Write the failing semantic-color and target-size computed-style test**

Add to `app.visual.spec.ts`:

```ts
it("uses unboxed semantic field glyphs inside 44px action targets", () => {
  const cleanup = installVisualCss(
    "apps/menubar-tauri/src/styles/macos-tokens.css",
    "apps/menubar-tauri/src/styles/global.css",
  );
  const row = document.createElement("bit-item");
  row.className = "vault-list-row";
  row.innerHTML = `
    <bit-item-action><button biticonbutton data-field="username"><i class="bwi"></i></button></bit-item-action>
    <bit-item-action><button biticonbutton data-field="password"><i class="bwi"></i></button></bit-item-action>
    <bit-item-action><button biticonbutton data-field="totp"><i class="bwi"></i></button></bit-item-action>
  `;
  document.body.append(row);

  const username = row.querySelector<HTMLElement>('[data-field="username"]')!;
  const usernameGlyph = username.querySelector<HTMLElement>(".bwi")!;
  const passwordGlyph = row.querySelector<HTMLElement>('[data-field="password"] .bwi')!;
  const totpGlyph = row.querySelector<HTMLElement>('[data-field="totp"] .bwi')!;
  const target = getComputedStyle(username);

  expect(target.width).toBe("44px");
  expect(target.minWidth).toBe("44px");
  expect(target.height).toBe("44px");
  expect(target.borderTopWidth).toBe("0px");
  expect(target.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(getComputedStyle(usernameGlyph).color).toBe("rgb(10, 102, 255)");
  expect(getComputedStyle(passwordGlyph).color).toBe("rgb(102, 87, 217)");
  expect(getComputedStyle(totpGlyph).color).toBe("rgb(233, 138, 21)");

  row.remove();
  cleanup();
});
```

- [ ] **Step 6: Run the visual test to verify it fails**

Run the focused `app.visual.spec.ts` command. Expected: FAIL on 36 px targets and missing semantic selectors.

- [ ] **Step 7: Implement one shared action style**

Add to the Vault section of `global.css`:

```css
.vault-list-row bit-item-action button[biticonbutton] {
  width: var(--mac-control-min-size);
  min-width: var(--mac-control-min-size);
  height: var(--mac-control-min-size);
  min-height: var(--mac-control-min-size);
  border: 0 !important;
  border-radius: 10px;
  padding: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

.vault-list-row bit-item-action button[biticonbutton]:hover {
  background: var(--mac-hover) !important;
}

.vault-list-row bit-item-action button[biticonbutton]:active {
  background: var(--mac-pressed) !important;
}

.vault-list-row [data-field="username"] .bwi {
  color: var(--mac-action-username);
}

.vault-list-row [data-field="password"] .bwi {
  color: var(--mac-action-password);
}

.vault-list-row [data-field="totp"] .bwi {
  color: var(--mac-action-totp);
}
```

Do not add a persistent colored shape behind the glyph. Keep existing focus-visible treatment and disabled semantics.

- [ ] **Step 8: Add the contextual section tint**

Replace `vault-autofill-suggestions.component.css` with focused local styling that preserves `:host { display: contents; }` and adds:

```css
.vault-autofill-suggestions {
  display: block;
  width: 100%;
  background: color-mix(in srgb, var(--mac-surface-contextual) 62%, transparent);
}

.vault-autofill-suggestions__layout {
  padding-bottom: 0;
}
```

Retain `.vault-autofill-suggestions__fill` because generic detected-form filling is existing functionality; semantic field actions must appear before it whenever their fields are available.

- [ ] **Step 9: Run all three targeted test files**

```bash
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/app.visual.spec.ts
```

Expected: PASS.

- [ ] **Step 10: Commit the action slice**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.html apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.css apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/styles/global.css apps/menubar-tauri/src/app/app.visual.spec.ts
git commit -m "style: color vault credential actions semantically"
```

---

### Task 4: Flatten the Vault header, disclosures, and result groups

**Files:**
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Modify: `apps/menubar-tauri/src/app/vault/vault-list-page.component.ts`
- Test: `apps/menubar-tauri/src/app/app.visual.spec.ts`
- Test: `apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts`

**Interfaces:**
- Consumes: approved tokens from Task 1 and current `.vault-root-header*`, `.vault-hierarchy*`, `.vault-list-row`, and `.vault-sections` selectors.
- Produces: one continuous Vault content surface with 12 px search radius, 52 px rows, fine separators, and no ordinary-list shadow.

- [ ] **Step 1: Replace the old card-oriented assertions with a computed-style contract**

Update the existing “styles the Vault hierarchy” test in `app.visual.spec.ts`. Install tokens and global CSS with `installVisualCss()`, mount `.vault-root-header__search`, `.vault-hierarchy__trigger[aria-expanded="true"]`, `.vault-hierarchy__items bit-item-group`, and `.vault-list-row`, then assert these computed values:

```ts
expect(getComputedStyle(search).minHeight).toBe("44px");
expect(getComputedStyle(search).borderRadius).toBe("12px");
expect(getComputedStyle(search).backgroundColor).toBe("rgb(234, 242, 255)");
expect(getComputedStyle(search).boxShadow).toBe("none");
expect(getComputedStyle(trigger).minHeight).toBe("44px");
expect(getComputedStyle(trigger).backgroundColor).toBe("rgba(0, 0, 0, 0)");
expect(getComputedStyle(trigger).borderTopWidth).toBe("0px");
expect(getComputedStyle(group).borderTopWidth).toBe("0px");
expect(getComputedStyle(group).borderRadius).toBe("0px");
expect(getComputedStyle(row).minHeight).toBe("52px");
expect(getComputedStyle(row).borderBottomWidth).toBe("1px");
expect(getComputedStyle(row).borderRadius).toBe("0px");
expect(getComputedStyle(row).boxShadow).toBe("none");
```

- [ ] **Step 2: Run the visual test to verify it fails**

Run the focused `app.visual.spec.ts` command. Expected: FAIL on the pill search, bordered disclosure headers, and card-shaped groups.

- [ ] **Step 3: Flatten the search control**

Update `.vault-root-header__search` to:

```css
.vault-root-header__search {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: var(--mac-space-2);
  margin: 0 var(--mac-space-4) var(--mac-space-1);
  border: 1px solid color-mix(in srgb, var(--mac-accent) 18%, var(--mac-border-subtle));
  border-radius: 12px;
  padding: 0 14px;
  background: var(--mac-surface-contextual);
  color: var(--mac-text-secondary);
  box-shadow: none;
}
```

Keep the existing focus ring, but make it a 2 px ring using `color-mix(in srgb, var(--mac-focus) 22%, transparent)`.

- [ ] **Step 4: Flatten disclosure groups and continuous rows**

Apply these rules in `global.css` while retaining disclosure animation and virtual-scroll paint fixes:

```css
.vault-hierarchy {
  padding: 0 var(--mac-space-4) var(--mac-space-4);
}

.vault-hierarchy__trigger {
  min-height: 44px;
  padding: 0 var(--mac-space-2);
}

.vault-hierarchy__trigger[aria-expanded="true"] {
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--mac-text-primary);
}

.vault-hierarchy__children,
.vault-hierarchy__items bit-item-group {
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: var(--mac-surface-solid);
  box-shadow: none;
}

.vault-hierarchy__items .vault-list-row {
  min-height: var(--mac-row-height);
  border-bottom: 1px solid var(--mac-border-subtle);
  border-radius: 0;
  background: var(--mac-surface-solid);
  box-shadow: none;
}
```

Keep the last-row border removal selectors and use inset spacing rather than adding gaps between rows.

- [ ] **Step 5: Remove the search-result card gap**

Replace the search-results wrapper classes in `vault-list-page.component.ts`:

```html
<div class="tw-flex tw-flex-col tw-px-4 tw-pb-4 vault-sections macos-list">
```

The wrapper must not include `tw-gap-3`; section boundaries come from headers and separators.

- [ ] **Step 6: Run Vault visual and component tests**

```bash
npx vitest run apps/menubar-tauri/src/app/app.visual.spec.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-hierarchy.component.spec.ts
```

Expected: PASS. The disclosure remains functional and the 229-item virtual-scroll test remains bounded.

- [ ] **Step 7: Commit the continuous-list slice**

```bash
git add apps/menubar-tauri/src/styles/global.css apps/menubar-tauri/src/app/app.visual.spec.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts
git commit -m "style: flatten vault into a continuous surface"
```

---

### Task 5: Verify the complete Vault-home slice against the selected visual

**Files:**
- Modify only if a verified defect is found: files already listed in Tasks 1–4.
- Reference: `docs/superpowers/specs/assets/barwarden-ios27-ui-visual-target.png`
- Reference: `docs/ui-audit-2026-08-17/04-vault-main.png`
- Reference: `docs/ui-audit-2026-08-17/09-search-results.png`
- Reference: `docs/ui-audit-2026-08-17/10-vault-dark.png`

**Interfaces:**
- Consumes: the completed token, behavior, semantic-action, and continuous-list slices.
- Produces: a buildable Vault home with passing regressions and visual evidence for light, dark, and search states.

- [ ] **Step 1: Run the focused regression suite**

```bash
npx vitest run apps/menubar-tauri/src/app/app.visual.spec.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/vault/vault-hierarchy.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts
```

Expected: all tests PASS.

- [ ] **Step 2: Run the full Angular/Vitest suite**

```bash
npm test
```

Expected: exit code 0. If an unrelated pre-existing failure appears, record its exact test name and confirm it also fails on the pre-task revision before changing unrelated code.

- [ ] **Step 3: Build the web bundle**

```bash
npm run build:web
```

Expected: exit code 0 and no new warning beyond the repository's recorded warning baseline.

- [ ] **Step 4: Open the real 480 × 600 Tauri surface**

Run:

```bash
npm run tauri:dev
```

Use the existing evidence states `light`, `dark`, and `search-results`. Capture the full application content at 480 × 600 without a device frame. Do not use Playwright or another browser unless the user has explicitly selected that browser.

- [ ] **Step 5: Perform the required side-by-side Product Design comparison**

For the light Vault screen, compare the implementation screenshot and `barwarden-ios27-ui-visual-target.png` together in one visual review. Verify all of the following:

- search is a quiet 12 px rounded contextual surface, not a gray pill;
- AutoFill suggestions appear directly below search and disappear during active search;
- rows are 52 px continuous surfaces with fine separators and no card gaps;
- username/password/TOTP glyphs are blue/indigo/orange with no persistent button boxes;
- header and bottom navigation do not compete with list content;
- secondary text is blue-gray and readable;
- the last visible row is not obscured by bottom navigation.

Repeat the comparison for dark mode using the audit screenshot as a structural reference and the dark token contract as the color reference.

- [ ] **Step 6: Fix only observed mismatches and rerun the smallest affected test**

For every visual correction, first add or adjust a focused assertion in `app.visual.spec.ts`, run it to see it fail, change the smallest CSS rule, and rerun it to PASS. Do not change data flow, candidate ranking, or security behavior during visual QA.

- [ ] **Step 7: Run final verification after visual fixes**

```bash
npx vitest run apps/menubar-tauri/src/app/app.visual.spec.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/vault/vault-hierarchy.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts
npm run build:web
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit verified visual corrections, if any**

Stage only the files changed during Step 6:

```bash
git add apps/menubar-tauri/src/styles/macos-tokens.css apps/menubar-tauri/src/styles/global.css apps/menubar-tauri/src/app/app.visual.spec.ts apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.css
git commit -m "test: verify ios27 vault visual target"
```

If Step 6 made no changes, skip this commit.

## Completion Criteria

- All Task 1–5 checkboxes are complete.
- Focused tests, `npm test`, and `npm run build:web` pass, or any unrelated pre-existing failure is evidenced without changing unrelated code.
- Light, dark, and search-result screenshots have been compared against the selected target/audit references at 480 × 600.
- AutoFill suggestions remain driven by existing context services and are hidden only while a non-empty search is active.
- Login rows keep capability-based username/password/TOTP actions with semantic colors and accessible 44 px targets.
- No ordinary Vault list, result row, or disclosure group is presented as a shadowed card.
- Follow-on plans remain: Vault detail/generator; settings/appearance; authentication/sheets; final cross-app accessibility QA.
