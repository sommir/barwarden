# iOS 27 Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Settings home and all five Settings detail routes into compact native preference groups with consistent 44px rows, 40/36px visible controls, and Switch semantics for boolean preferences.

**Architecture:** Settings route components keep state and command ownership. Retained Settings home/account output stays reproducible through source patch → generated authority → runtime patch → local output and both manifests. Local detail pages consume shared `.macos-preference-group`, `.macos-preference-row`, and `.macos-control-visible` roles.

**Tech Stack:** Angular standalone components, retained Bitwarden Settings overlays, Vitest, CSS custom properties, exact patch/manifests.

**Spec:** `docs/superpowers/specs/2026-08-20-ios27-full-ui-harmonization-design.md`

## Global Constraints

- Routes: `/tabs/settings`, `/vault-settings`, `/account-security`, `/settings-password`, `/autofill`, `/keyboard-shortcut`, `/appearance`.
- Every secondary Settings host includes `macos-page--settings-detail`; page inset is 16px.
- Single-line preference row is 44px; descriptive row grows from 48px and may wrap at 200% text.
- Boolean preferences use Switch semantics; multi-select choices remain checkboxes.
- Preserve theme, language, compact, animation, website-icon, launch-at-login, PIN, timeout, AutoFill permission, shortcut, and external handoff behavior.
- Retained changes must update both Settings provenance chains; authority pins must not change.

---

### Task 1: Lock the preference-row primitive on real Settings DOM

**Files:**
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Modify: `apps/menubar-tauri/src/app/settings/settings-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/settings/p1-pages.spec.ts`
- Test: `apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts`

**Interfaces:**
- Produces `.macos-preference-group`, `.macos-preference-row`, `__copy`, `__value`, and `.macos-switch-owner`.

- [ ] **Step 1: Add RED real-DOM geometry assertions**

Mount `SettingsPageComponent` with the existing retained component fixture and assert:

```ts
const groups = host.querySelectorAll<HTMLElement>(".macos-preference-group");
expect(groups.length).toBeGreaterThan(0);
const row = groups[0]!.querySelector<HTMLElement>(".macos-preference-row")!;
const style = getComputedStyle(row);
expect(style.minHeight).toBe("44px");
expect(style.borderRadius).toBe("0px");
expect(style.boxShadow).toBe("none");
expect(getComputedStyle(row.querySelector<HTMLElement>(".macos-hit-target")!).minWidth).toBe("44px");
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/settings/settings-page.component.spec.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts`

Expected: FAIL because current groups/rows use mixed retained wrappers and 52px universal rows.

- [ ] **Step 3: Add exact shared preference CSS**

```css
.macos-preference-group { margin:0; border:0; border-radius:0; background:transparent; box-shadow:none; }
.macos-preference-group + .macos-preference-group { margin-top:var(--mac-group-gap); }
.macos-preference-row { display:grid; grid-template-columns:minmax(0,1fr) auto; min-height:var(--mac-row-single); align-items:center; gap:12px; padding-inline:12px; border:0; border-bottom:1px solid var(--mac-border-subtle); border-radius:0; background:var(--mac-surface-solid); box-shadow:none; }
.macos-preference-row:last-child { border-bottom:0; }
.macos-preference-row__copy { min-width:0; padding-block:7px; }
.macos-preference-row__copy > :first-child { font-size:14px; line-height:18px; font-weight:600; }
.macos-preference-row__copy > :not(:first-child) { margin-top:2px; color:var(--mac-text-secondary); font-size:12px; line-height:16px; }
.macos-switch-owner { display:grid; min-width:var(--mac-hit-size); min-height:var(--mac-hit-size); padding:0; place-items:center; border:0; background:transparent; }
.macos-switch-owner > span { position:relative; width:34px; height:20px; border:1px solid var(--mac-border); border-radius:999px; background:var(--mac-surface-contextual); transition:background-color var(--mac-motion-fast) ease; }
.macos-switch-owner > span::after { content:""; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:var(--mac-surface-solid); box-shadow:0 1px 2px rgb(0 0 0 / 18%); transition:transform var(--mac-motion-fast) ease; }
.macos-switch-owner[aria-checked="true"] > span { border-color:var(--mac-accent); background:var(--mac-accent); }
.macos-switch-owner[aria-checked="true"] > span::after { transform:translateX(14px); }
.macos-switch-owner:focus-visible { outline:0; }
.macos-switch-owner:focus-visible > span { outline:2px solid var(--mac-focus); outline-offset:2px; }
:root[data-bw-compact-mode="true"] .macos-preference-group + .macos-preference-group { margin-top:var(--mac-group-gap-compact); }
@media (min-resolution:2dppx) { .macos-preference-row { border-bottom-width:.5px; } }
```

- [ ] **Step 4: GREEN**

```bash
npx vitest run apps/menubar-tauri/src/app/settings/settings-page.component.spec.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/settings/settings-page.component.spec.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: define ios27 preference rows"
```

### Task 2: Migrate Settings home through the retained pipeline

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings-member-transforms.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__tools__popup__settings__settings-v2.component.ts.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__tools__popup__settings__settings-v2.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__tools__popup__settings__settings-v2.component.ts.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__tools__popup__settings__settings-v2.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.spec.ts`
- Guard: `apps/menubar-tauri/src/app/upstream-overlays/settings/settings-overlay.guard.spec.ts`

**Interfaces:**
- Preserve the six existing `RetainedSettingsRoute` values, `navigate` output, `launchAtLoginEnabled`,
  `launchAtLoginEnabledChange`, and launch-at-login busy/error behavior.
- Produces four groups: General, Security, Application, Information; each navigation item is `.macos-preference-row`.

- [ ] **Step 1: Add RED group/order/geometry tests**

```ts
const groupTitles = Array.from(
  host.querySelectorAll<HTMLElement>(".settings-group__title"),
  (title) => title.dataset["settingsGroupTitle"],
);
const routeOrder = Array.from(
  host.querySelectorAll<HTMLButtonElement>("button.macos-preference-row"),
  (button) => button.dataset["settingsRoute"],
);
expect(groupTitles).toEqual(["general", "security", "application", "information"]);
expect(routeOrder).toEqual([
  "/appearance", "/account-security", "/autofill", "/keyboard-shortcut",
  "/vault-settings", "/about",
]);
for (const item of host.querySelectorAll(".macos-preference-row")) {
  expect(getComputedStyle(item).minHeight).toBe("44px");
}
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.spec.ts`

Expected: FAIL on missing preference roles and current visual grouping.

- [ ] **Step 3: Apply the retained transformation**

Use this exact runtime shape for each group; retain the existing labels/icons/routes inside the loop:

```html
<section class="macos-preference-group" [attr.aria-labelledby]="group.id + '-title'"
  [attr.data-settings-group]="group.id">
  <h2 class="settings-group__title" [id]="group.id + '-title'"
    [attr.data-settings-group-title]="group.id">{{ group.label }}</h2>
  <bit-item-group class="settings-group__items">
    @if (group.id === "general") {
      <bit-item>
        <div bit-item-content class="macos-preference-row" data-testid="launch-at-login-row">
          <span id="launch-at-login-label" class="macos-preference-row__copy">{{ "i18nLaunchAtLogin" | i18n }}</span>
          <button type="button" class="macos-switch-owner macos-hit-target" role="switch"
            aria-labelledby="launch-at-login-label" [attr.aria-checked]="launchAtLoginEnabled"
            [disabled]="launchAtLoginBusy"
            (click)="requestLaunchAtLoginChange(!launchAtLoginEnabled)">
            <span aria-hidden="true"></span>
          </button>
        </div>
      </bit-item>
    }
    @for (item of group.items; track item.route) {
      <bit-item>
        <button type="button" bit-item-content class="macos-preference-row macos-hit-target macos-pressable"
          [attr.data-settings-route]="item.route" (click)="navigate.emit(item.route)">
          <i slot="start" class="bwi" [class]="item.icon" aria-hidden="true"></i>
          <span class="macos-preference-row__copy">{{ item.label }}</span>
          <i slot="end" class="bwi bwi-angle-right" aria-hidden="true"></i>
        </button>
      </bit-item>
    }
  </bit-item-group>
</section>
```

Replace the event-shaped method in `OfficialSettingsComponent` with:

```ts
requestLaunchAtLoginChange(requested: boolean): void {
  this.launchAtLoginEnabledChange.emit(requested);
}
```

Because the launch preference no longer renders `bitCheckbox`, remove `CheckboxComponent` from the
official Settings component's import declaration and standalone `imports` array. Keep Item,
ItemContent, ItemGroup, i18n, Header/Page, alert, and typography imports unchanged.

Run the repository generators:

```bash
npm run update:official-settings-manifest
npm run update:official-settings-runtime-manifest
```

Run each command a second time and require zero diff.

- [ ] **Step 4: GREEN and provenance**

```bash
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.spec.ts apps/menubar-tauri/src/app/settings/settings-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/settings/settings-overlay.guard.spec.ts
npm run typecheck:official-settings
```

- [ ] **Step 5: Stage all and only updater-owned outputs and commit**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.ts apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings-member-transforms.ts
git add apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__tools__popup__settings__settings-v2.component.ts.patch apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__tools__popup__settings__settings-v2.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/settings-v2.component.ts apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/settings-v2.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__tools__popup__settings__settings-v2.component.ts.patch apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__tools__popup__settings__settings-v2.component.html.patch
git add -p apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: harmonize ios27 settings home"
```

### Task 3: Rebuild Appearance as native preference rows

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-appearance.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-appearance.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__vault__popup__settings__appearance.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/vault/popup/settings/appearance.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__vault__popup__settings__appearance.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__vault__popup__settings__appearance.component.ts.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json`
- Modify: `apps/menubar-tauri/src/app/settings/p1-pages.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Test: `apps/menubar-tauri/src/app/settings/settings.service.spec.ts`

**Interfaces:**
- Preserve `SettingsService.setLocale()`, `setTheme()`, `setCompactMode()`, `setAnimations()`, and website-icon setter signatures.
- Produces Select rows for Language/Theme and Switch rows for Compact/Motion/Website Icons.

- [ ] **Step 1: Write RED semantics and computed geometry**

```ts
expect(host.querySelectorAll('select.macos-control-visible')).toHaveLength(2);
const switchLabels = Array.from(
  host.querySelectorAll<HTMLElement>('[role="switch"]'),
  (control) => control.dataset["setting"],
);
expect(switchLabels).toEqual([
  "compactMode", "animations", "showFavicons", "showQuickCopyActions",
]);
expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
for (const owner of host.querySelectorAll<HTMLElement>(".macos-switch-owner")) {
  expect(getComputedStyle(owner).minHeight).toBe("44px");
}
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/settings/p1-pages.spec.ts -t "appearance"`

Expected: FAIL because the current page uses large white blocks and checkbox presentation.

- [ ] **Step 3: Replace only the template presentation**

Keep the wrapper `AppearancePageComponent` unchanged. Replace the presentation in
`official-appearance.component.html` with the following exact structure; the existing outputs and
value helpers already have these names:

```html
<section class="macos-preference-group" aria-labelledby="appearance-interface">
  <h2 id="appearance-interface" class="settings-group__title">{{ "i18nInterface" | i18n }}</h2>
  <bit-form-field class="macos-preference-row" disableMargin>
    <bit-label class="macos-preference-row__copy">{{ "i18nLanguage" | i18n }}</bit-label>
    <bit-select class="macos-control-visible" [attr.aria-label]="'i18nLanguage' | i18n"
      [items]="languageOptions" [ngModel]="language ?? ''" (ngModelChange)="setLanguageValue($event)" />
  </bit-form-field>
  <bit-form-field class="macos-preference-row" disableMargin>
    <bit-label class="macos-preference-row__copy">{{ "i18nTheme" | i18n }}</bit-label>
    <bit-select class="macos-control-visible" [attr.aria-label]="'i18nTheme' | i18n"
      [items]="themeOptions" [ngModel]="settings.theme" (ngModelChange)="setThemeValue($event)" />
  </bit-form-field>
</section>
<section class="macos-preference-group" aria-labelledby="appearance-behavior">
  <h2 id="appearance-behavior" class="settings-group__title">{{ "general" | i18n }}</h2>
  <div class="macos-preference-row">
    <span id="appearance-compact-label" class="macos-preference-row__copy">{{ "i18nCompactMode" | i18n }}</span>
    <button type="button" class="macos-switch-owner macos-hit-target" role="switch" data-setting="compactMode"
      aria-labelledby="appearance-compact-label" [attr.aria-checked]="settings.compactMode"
      (click)="toggle(compactModeChange, settings.compactMode)"><span aria-hidden="true"></span></button>
  </div>
  <div class="macos-preference-row">
    <span id="appearance-animations-label" class="macos-preference-row__copy">{{ "i18nAnimations" | i18n }}</span>
    <button type="button" class="macos-switch-owner macos-hit-target" role="switch" data-setting="animations"
      aria-labelledby="appearance-animations-label" [attr.aria-checked]="settings.animations"
      (click)="toggle(animationsChange, settings.animations)"><span aria-hidden="true"></span></button>
  </div>
</section>
<section class="macos-preference-group" aria-labelledby="appearance-vault">
  <h2 id="appearance-vault" class="settings-group__title">{{ "vault" | i18n }}</h2>
  <div class="macos-preference-row">
    <span id="appearance-favicons-label" class="macos-preference-row__copy">{{ "i18nShowFavicons" | i18n }}</span>
    <button type="button" class="macos-switch-owner macos-hit-target" role="switch" data-setting="showFavicons"
      aria-labelledby="appearance-favicons-label" [attr.aria-checked]="settings.showFavicons"
      (click)="toggle(showFaviconsChange, settings.showFavicons)"><span aria-hidden="true"></span></button>
  </div>
  <div class="macos-preference-row">
    <span id="appearance-quick-actions-label" class="macos-preference-row__copy">{{ "i18nShowQuickCopyActions" | i18n }}</span>
    <button type="button" class="macos-switch-owner macos-hit-target" role="switch" data-setting="showQuickCopyActions"
      aria-labelledby="appearance-quick-actions-label" [attr.aria-checked]="settings.showQuickCopyActions"
      (click)="toggle(showQuickCopyActionsChange, settings.showQuickCopyActions)"><span aria-hidden="true"></span></button>
  </div>
</section>
```

Add this exact component method and keep `emitChecked()` only for any retained control that still
uses a native checkbox:

```ts
toggle(output: EventEmitter<boolean>, current: boolean): void {
  output.emit(!current);
}
```

Remove now-unused `CardComponent`, `CheckboxComponent`, `FormControlComponent`, `SectionComponent`,
`SectionHeaderComponent`, and `TypographyDirective` imports from both the TypeScript import and the
standalone `imports` array. Keep `BitFormFieldComponent`, `BitLabelComponent`, `SelectComponent`,
`FormsModule`, i18n, Header, and Page imports.

The `general` key is already present in the pinned Settings section catalog; add a source-audit assertion for that exact key and do not add a new translation key. Regenerate the runtime patch/manifest with `npm run update:official-settings-runtime-manifest`, rerun it, and require zero second-run diff.

- [ ] **Step 4: GREEN**

```bash
npx vitest run apps/menubar-tauri/src/app/settings/p1-pages.spec.ts apps/menubar-tauri/src/app/settings/settings.service.spec.ts apps/menubar-tauri/src/app/settings/settings-evidence-preview.spec.ts apps/menubar-tauri/src/app/upstream-overlays/settings/settings-overlay.guard.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/settings/official-appearance.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/official-appearance.component.ts apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__vault__popup__settings__appearance.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/vault/popup/settings/appearance.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__vault__popup__settings__appearance.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__vault__popup__settings__appearance.component.ts.patch apps/menubar-tauri/src/app/settings/p1-pages.spec.ts
git add -p apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: rebuild ios27 appearance settings"
```

### Task 4: Harmonize Vault Options, Account Security, AutoFill, Shortcut, and Change Password

**Files:**
- Modify: `apps/menubar-tauri/src/app/settings/vault-settings-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/settings/account-security-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/settings/autofill-settings-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/settings/settings-password-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-account-security.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-vault-settings.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__auth__popup__settings__account-security.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__vault__popup__settings__vault-settings.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/auth/popup/settings/account-security.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/vault/popup/settings/vault-settings.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__auth__popup__settings__account-security.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__vault__popup__settings__vault-settings.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Test: `apps/menubar-tauri/src/app/settings/vault-settings-page.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/settings/account-actions-page.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-account-security-unlock-options.spec.ts`
- Test: `apps/menubar-tauri/src/app/settings/p1-pages.spec.ts`
- Test: `apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.spec.ts`
- Create: `apps/menubar-tauri/src/app/settings/settings-password-page.component.spec.ts`
- Guard: `apps/menubar-tauri/src/app/upstream-overlays/settings/settings-overlay.guard.spec.ts`

**Interfaces:**
- Preserve all existing commands, busy states, status/live regions, retry actions, permission Sheet, shortcut recording, external handoff, and `data-popup-focus-key` values.
- Produces the same preference-row roles across all five routes.

- [ ] **Step 1: Add one RED mounted contract per page**

Each real fixture must assert:

```ts
expect(host.matches(".macos-page--settings-detail")).toBe(true);
expect(host.querySelectorAll(".macos-preference-group").length).toBeGreaterThan(0);
for (const row of host.querySelectorAll<HTMLElement>(".macos-preference-row")) {
  expect(parseFloat(getComputedStyle(row).minHeight)).toBeGreaterThanOrEqual(44);
  expect(getComputedStyle(row).boxShadow).toBe("none");
}
expect(host.querySelectorAll('[aria-busy="true"] [role="progressbar"]').length).toBeLessThanOrEqual(1);
```

Keyboard Shortcut additionally asserts recorder/clear owners ≥44 and visible recorder field 40/36. AutoFill asserts the permission action is secondary, not another filled primary.

- [ ] **Step 2: Run RED**

```bash
npx vitest run apps/menubar-tauri/src/app/settings/vault-settings-page.component.spec.ts apps/menubar-tauri/src/app/settings/account-actions-page.component.spec.ts apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.spec.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts
```

Expected: FAIL on mixed rows, oversized controls, or missing role classes.

- [ ] **Step 3: Wrap existing controls without changing behavior**

For the two retained pages, change their existing outer group/row classes through the runtime patch so the generated-to-runtime diff remains bounded:

```diff
-<section class="settings-detail-group macos-continuous-group">
+<section class="settings-detail-group macos-preference-group">
-<bit-item class="settings-detail-row macos-continuous-row">
+<bit-item class="settings-detail-row macos-preference-row">
```

For AutoFill, make these exact class/semantic edits without changing any model or change handler:

```diff
-<section class="settings-detail-group macos-continuous-group">
+<section class="settings-detail-group macos-preference-group">
-<bit-form-field class="settings-detail-row macos-continuous-row">
+<bit-form-field class="settings-detail-row macos-preference-row">
-<bit-select class="macos-form-control"
+<bit-select class="macos-control-visible"
-<bit-form-control class="settings-detail-row macos-continuous-row" disableMargin>
-  <input id="show-input-field-icon" bitCheckbox type="checkbox"
-    [checked]="settings.showInputFieldIcon" (change)="setShowInputFieldIcon($event)" />
-  <bit-label>{{ "i18nShowInputFieldIcon" | i18n }}</bit-label>
-  <bit-hint>{{ "i18nShowInputFieldIconHint" | i18n }}</bit-hint>
-</bit-form-control>
+<div class="settings-detail-row macos-preference-row">
+  <span id="autofill-field-icon-label" class="macos-preference-row__copy">
+    {{ "i18nShowInputFieldIcon" | i18n }}
+    <small>{{ "i18nShowInputFieldIconHint" | i18n }}</small>
+  </span>
+  <button type="button" class="macos-switch-owner macos-hit-target" role="switch"
+    aria-labelledby="autofill-field-icon-label" [attr.aria-checked]="settings.showInputFieldIcon"
+    (click)="setShowInputFieldIconValue(!settings.showInputFieldIcon)">
+    <span aria-hidden="true"></span>
+  </button>
+</div>
```

Replace the event-shaped handler with this value-shaped method so both mouse and keyboard
activation share one path:

```ts
setShowInputFieldIconValue(enabled: boolean): void {
  this.settingsService.setShowInputFieldIcon(enabled);
  const update = this.setup?.setFloatingIconPreference(enabled)
    ?? this.accessibility?.setFloatingIconEnabled(enabled);
  void update?.catch(() => undefined);
}
```

Remove `CheckboxComponent` and `FormControlComponent` from the AutoFill component import declaration
and standalone `imports` array after the last checkbox/form-control node is removed.

For Keyboard Shortcut, keep `startRecording()`, `record($event)`, and `clear()` unchanged; add `macos-preference-group` to the section, `macos-preference-row` to the form field, `macos-control-visible` to the recorder, and `macos-hit-target` to the clear button.

For Change Password, replace the component-scoped `gap:16px`/full-width button presentation with:

```css
.settings-password-handoff { display:grid; gap:12px; padding:12px; }
.settings-password-handoff .empty-inline { margin:0; font-size:14px; line-height:20px; }
.web-vault-action { min-height:var(--mac-hit-size); margin:0; justify-self:start; }
.web-vault-action::before { inset-block:2px; }
```

Append `macos-button-owner` to the existing `.web-vault-action` button so the shared pseudo-element paints the 40/36px fill.

Then regenerate both Settings manifests for the retained Vault/Account edits and require a zero-diff second updater run.

- [ ] **Step 4: Run the complete Settings gate**

```bash
npx vitest run apps/menubar-tauri/src/app/settings apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/settings/settings-overlay.guard.spec.ts
npm run typecheck:official-settings
npm run build:web
```

Expected: PASS; compact mode is visually denser while all owners remain 44px.

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/settings/vault-settings-page.component.ts apps/menubar-tauri/src/app/settings/account-security-page.component.ts apps/menubar-tauri/src/app/settings/autofill-settings-page.component.ts apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.ts apps/menubar-tauri/src/app/settings/settings-password-page.component.ts
git add apps/menubar-tauri/src/app/settings/vault-settings-page.component.spec.ts apps/menubar-tauri/src/app/settings/account-actions-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/settings/official-account-security-unlock-options.spec.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.spec.ts apps/menubar-tauri/src/app/settings/settings-password-page.component.spec.ts
git add apps/menubar-tauri/src/app/upstream-overlays/settings/official-account-security.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/official-vault-settings.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__auth__popup__settings__account-security.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__vault__popup__settings__vault-settings.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/auth/popup/settings/account-security.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/vault/popup/settings/vault-settings.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__auth__popup__settings__account-security.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__vault__popup__settings__vault-settings.component.html.patch
git add -p apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: harmonize ios27 settings details"
```
