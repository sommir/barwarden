# iOS 27 Shared Primitives and Settings/Info Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock a reusable flat iOS 27 visual contract, then migrate Settings, Settings detail, About, Update, notices, and licenses to continuous, shadowless page surfaces without changing business behavior.

**Architecture:** Reuse `PopupPageComponent`, `PopupHeaderComponent`, official `Section`/`ItemGroup`/`Item`/form controls, `MacosAlertStripComponent`, and `AppBottomSheetComponent`. New CSS hooks are presentation-only; retained Settings output files remain generated from the pinned upstream source-patch chain and then adapted by the runtime-patch chain.

**Tech Stack:** Angular 21 standalone components, TypeScript, Vitest/jsdom, CSS custom properties, retained Bitwarden Settings transform manifests.

## Global Constraints

- Target viewport is exactly 480 × 600 for representative visual evidence.
- Page horizontal padding is 16 px; group spacing is 20–24 px.
- Standard rows are 52 px; compact helper rows and every clickable icon/switch target are at least 44 × 44 px.
- Search and form controls use 10–12 px radii; ordinary groups and rows use no radius and no shadow.
- Only menus, Sheet, confirmation, danger, and permission overlays retain 12–16 px radii and one light shadow.
- Focus uses a visible 2 px ring; keyboard order follows visual order; reduced motion removes non-essential transitions.
- Do not introduce new routes, business services, PageShell, SettingsRow, Dialog, feedback components, icons, or hard-coded accent colors.
- Preserve every existing Settings input/output, route, sync, theme, language, shortcut, AutoFill permission, PIN/Touch ID, update, and external-handoff boundary.
- `apps/menubar-tauri/src/styles/global.css` already contains unrelated user changes: edit it with `apply_patch`, inspect `git diff`, and stage only the intended hunks with `git add -p`.
- Every retained Settings edit must update both provenance chains: source patch + generated authority + `official-settings.transform-manifest.json`, then runtime output + runtime patch + `official-settings.runtime-manifest.json`.

---

## File Map

- `apps/menubar-tauri/src/styles/global.css`: shared iOS 27 dimensions, continuous-surface hooks, Settings page-family presentation.
- `apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts`: computed-style contract for ordinary surfaces, actions, menus, and Sheet.
- `apps/menubar-tauri/src/app/upstream-overlays/settings/official-*.component.{ts,html}`: local runtime presentation with stable inputs/outputs.
- `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/*.patch` and `generated/**`: pinned upstream-to-generated transformation.
- `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/*.patch`: generated-to-local runtime transformation.
- `apps/menubar-tauri/src/app/settings/*-page.component.ts`: native-only Settings detail and legal-document pages.

### Task 1: Lock the shared iOS 27 surface contract

**Files:**
- Create: `apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Test: `apps/menubar-tauri/src/app/layout/popup-layout.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/official-ui/app-bottom-sheet.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/official-ui/macos-alert-strip.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/official-ui/app-feedback.component.spec.ts`

**Interfaces:**
- Consumes: `--mac-canvas`, `--mac-surface-solid`, `--mac-border-subtle`, `--mac-row-height`, `--mac-control-min-size`, `--mac-sheet-radius` from `macos-tokens.css`.
- Produces: `.macos-continuous-group`, `.macos-continuous-row`, `.macos-form-control`, `.icon-action`, `.bit-menu-panel [role="menu"]`, `.app-bottom-sheet` as stable presentation hooks.
- Does not change Angular component APIs.

- [ ] **Step 1: Write the failing computed-style test**

Create the complete file below:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

function installVisualCss(): HTMLStyleElement {
  const source = [
    "apps/menubar-tauri/src/styles/macos-tokens.css",
    "apps/menubar-tauri/src/styles/global.css",
  ]
    .map((path) => readFileSync(join(process.cwd(), path), "utf8"))
    .join("\n")
    .replace(/^@import[^;]+;\s*/gm, "");
  const rootDeclarations = source.match(/^:root\s*{([\s\S]*?)^}/m)?.[1] ?? "";
  const tokens = new Map(
    [...rootDeclarations.matchAll(/(--(?:mac|bw)-[\w-]+):\s*([^;]+);/g)]
      .map(([, name, value]) => [name, value.trim()]),
  );
  const style = document.createElement("style");
  style.textContent = source.replace(/var\((--(?:mac|bw)-[\w-]+)\)/g, (value, name) =>
    tokens.get(name) ?? value,
  );
  document.head.append(style);
  return style;
}

afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll("style[data-ios27-test]").forEach((node) => node.remove());
});

describe("iOS 27 shared primitives", () => {
  it("keeps ordinary surfaces flat while menus and Sheet remain shaped overlays", () => {
    const style = installVisualCss();
    style.dataset["ios27Test"] = "true";
    document.body.innerHTML = `
      <section class="macos-continuous-group">
        <button class="macos-continuous-row">Row</button>
      </section>
      <input class="macos-form-control" />
      <button class="icon-action">Action</button>
      <div class="bit-menu-panel"><div role="menu">Menu</div></div>
      <dialog class="app-bottom-sheet">Sheet</dialog>
    `;

    const group = getComputedStyle(document.querySelector<HTMLElement>(".macos-continuous-group")!);
    const row = getComputedStyle(document.querySelector<HTMLElement>(".macos-continuous-row")!);
    const control = getComputedStyle(document.querySelector<HTMLElement>(".macos-form-control")!);
    const action = getComputedStyle(document.querySelector<HTMLElement>(".icon-action")!);
    const menu = getComputedStyle(document.querySelector<HTMLElement>('[role="menu"]')!);
    const sheet = getComputedStyle(document.querySelector<HTMLElement>(".app-bottom-sheet")!);

    expect(group.borderRadius).toBe("0px");
    expect(group.boxShadow).toBe("none");
    expect(row.minHeight).toBe("52px");
    expect(row.borderRadius).toBe("0px");
    expect(row.borderBottomWidth).toBe("1px");
    expect(row.boxShadow).toBe("none");
    expect(control.minHeight).toBe("44px");
    expect(control.borderRadius).toBe("10px");
    expect(action.width).toBe("44px");
    expect(action.height).toBe("44px");
    expect(menu.borderRadius).toBe("12px");
    expect(menu.boxShadow).not.toBe("none");
    expect(sheet.borderTopLeftRadius).toBe("16px");
    expect(sheet.borderTopRightRadius).toBe("16px");
  });
});
```

- [ ] **Step 2: Run the RED test**

Run: `npx vitest run apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts`

Expected: FAIL because the three new hooks do not exist and `.icon-action` resolves smaller than 44 × 44 px.

- [ ] **Step 3: Add the minimal shared CSS hooks**

Append one scoped block to `global.css`; do not broaden these selectors to every `bit-item`:

```css
.macos-continuous-group {
  overflow: visible;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.macos-continuous-row {
  display: flex;
  width: 100%;
  min-height: 52px;
  align-items: center;
  border: 0;
  border-bottom: 1px solid var(--mac-border-subtle);
  border-radius: 0;
  background: var(--mac-surface-solid);
  color: var(--mac-text-primary);
  box-shadow: none;
}
.macos-continuous-row:last-child { border-bottom: 0; }
.macos-form-control {
  min-height: 44px;
  border: 1px solid var(--mac-border);
  border-radius: 10px;
  background: var(--mac-surface-solid);
  color: var(--mac-text-primary);
}
.icon-action {
  width: 44px;
  min-width: 44px;
  height: 44px;
  min-height: 44px;
}
.macos-page :is(input, select, textarea, button, a):focus-visible {
  outline: 2px solid var(--mac-focus);
  outline-offset: 2px;
}
```

Keep the existing shaped menu and Sheet rules unchanged.

- [ ] **Step 4: Run the shared GREEN gate**

```bash
npx vitest run apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts apps/menubar-tauri/src/app/layout/popup-layout.component.spec.ts apps/menubar-tauri/src/app/official-ui/app-bottom-sheet.component.spec.ts apps/menubar-tauri/src/app/official-ui/macos-alert-strip.component.spec.ts apps/menubar-tauri/src/app/official-ui/app-feedback.component.spec.ts
```

Expected: PASS with no focus-trap, Escape, focus-restoration, or scroll-owner regression.

- [ ] **Step 5: Stage only this task and commit**

```bash
git add apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git diff --cached --name-only
git commit -m "style: lock ios27 shared ui primitives"
```

### Task 2: Group Settings home into continuous General, Security, Application, and Information sections

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__tools__popup__settings__settings-v2.component.ts.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__tools__popup__settings__settings-v2.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/settings-v2.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/settings-v2.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__tools__popup__settings__settings-v2.component.ts.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__tools__popup__settings__settings-v2.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Test: `apps/menubar-tauri/src/app/settings/settings-page.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.spec.ts`

**Interfaces:**
- Consumes: `RetainedSettingsRoute` and existing launch-at-login inputs/outputs unchanged.
- Produces:

```ts
export type SettingsGroupId = "general" | "security" | "application" | "information";
export interface SettingsNavigationItem {
  readonly label: string;
  readonly route: RetainedSettingsRoute;
  readonly icon: string;
}
export interface SettingsGroup {
  readonly id: SettingsGroupId;
  readonly label: string;
  readonly items: readonly SettingsNavigationItem[];
}
```

- Exact group contents: `general` = Launch at login + Appearance; `security` = Account Security; `application` = AutoFill + Keyboard Shortcuts + Vault Options; `information` = About.

- [ ] **Step 1: Add the failing hierarchy test**

Add inside `describe("SettingsPageComponent", ...)`:

```ts
it("renders the approved four continuous Settings groups without changing navigation", async () => {
  await TestBed.configureTestingModule({
    imports: [SettingsPageComponent],
    providers: [
      provideRouter([]), OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      ...officialCurrentAccountTestProviders(), PopupStateStore, SettingsService,
      { provide: LAUNCH_AT_LOGIN_HOST, useValue: {
        getLaunchAtLogin: async () => false,
        setLaunchAtLogin: async (enabled: boolean) => enabled,
      } satisfies LaunchAtLoginHost },
      { provide: AuthFacade, useValue: { lock: () => undefined, logout: async () => undefined } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(SettingsPageComponent);
  const navigateByUrl = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockResolvedValue(true);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const groups = Array.from(fixture.nativeElement.querySelectorAll<HTMLElement>("[data-settings-group]"));
  expect(groups.map((group) => group.dataset["settingsGroup"]))
    .toEqual(["general", "security", "application", "information"]);
  expect(groups.map((group) => group.querySelectorAll("bit-item").length)).toEqual([2, 1, 3, 1]);
  expect(fixture.nativeElement.querySelectorAll("bit-card")).toHaveLength(0);
  Array.from(fixture.nativeElement.querySelectorAll<HTMLButtonElement>("button.settings-row"))
    .forEach((row) => row.click());
  expect(navigateByUrl.mock.calls.map(([route]) => route)).toEqual([
    "/appearance", "/account-security", "/autofill",
    "/keyboard-shortcut", "/vault-settings", "/about",
  ]);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/settings/settings-page.component.spec.ts -t "approved four continuous Settings groups"`

Expected: FAIL because the current template has one ungrouped list.

- [ ] **Step 3: Implement typed groups and hooks**

Replace `items` with this exact typed array; every key already exists in the retained catalog, so `official-i18n.service.ts` is not touched:

```ts
readonly groups: readonly SettingsGroup[] = [
  {
    id: "general",
    label: translateOfficialMessage("i18nGeneral"),
    items: [
      { label: translateOfficialMessage("i18nAppearance"), route: "/appearance", icon: "bwi-brush" },
    ],
  },
  {
    id: "security",
    label: translateOfficialMessage("security"),
    items: [
      { label: translateOfficialMessage("i18nAccountSecurity"), route: "/account-security", icon: "bwi-lock" },
    ],
  },
  {
    id: "application",
    label: translateOfficialMessage("app"),
    items: [
      { label: translateOfficialMessage("i18nAutofill"), route: "/autofill", icon: "bwi-globe" },
      { label: translateOfficialMessage("i18nKeyboardShortcuts"), route: "/keyboard-shortcut", icon: "bwi-key" },
      { label: translateOfficialMessage("i18nVaultOptions"), route: "/vault-settings", icon: "bwi-vault" },
    ],
  },
  {
    id: "information",
    label: translateOfficialMessage("i18nAbout"),
    items: [
      { label: translateOfficialMessage("i18nAbout"), route: "/about", icon: "bwi-info-circle" },
    ],
  },
];
```

Render:

```html
@for (group of groups; track group.id) {
  <section class="settings-group" [attr.data-settings-group]="group.id">
    <h2 bitTypography="h6" class="settings-group__title">{{ group.label }}</h2>
    <bit-item-group class="macos-continuous-group settings-group__items">
      @if (group.id === "general") {
        <bit-item>
          <label bit-item-content class="settings-row macos-continuous-row" data-testid="launch-at-login-row">
            <input slot="start" bitCheckbox id="launch-at-login" type="checkbox"
              [attr.aria-label]="'i18nLaunchAtLogin' | i18n"
              [checked]="launchAtLoginEnabled" [disabled]="launchAtLoginBusy"
              (change)="requestLaunchAtLoginChange($event)" />
            <span class="launch-at-login-row__copy tw-inline-flex tw-max-w-full tw-items-baseline tw-gap-2 tw-whitespace-nowrap">
              <span class="launch-at-login-row__title tw-font-medium">{{ "i18nLaunchAtLogin" | i18n }}</span>
              <span class="launch-at-login-row__hint tw-truncate tw-text-sm tw-text-muted">{{ "i18nLaunchAtLoginHint" | i18n }}</span>
            </span>
          </label>
        </bit-item>
      }
      @for (item of group.items; track item.route) {
        <bit-item>
          <button type="button" bit-item-content class="settings-row macos-continuous-row"
            [truncate]="false" (click)="navigate.emit(item.route)">
            <i slot="start" class="bwi" [class]="item.icon" aria-hidden="true"></i>
            {{ item.label }}
            <i slot="end" class="bwi bwi-angle-right" aria-hidden="true"></i>
          </button>
        </bit-item>
      }
    </bit-item-group>
  </section>
}
```

Apply the same TS/HTML structure to the generated authorities and encode it in both source patches. Preserve local launch-at-login state in the runtime output and regenerate both runtime patches.

```css
.macos-page--settings .settings-group + .settings-group { margin-top: 22px; }
.macos-page--settings .settings-group__title { margin: 0 16px 8px; }
.macos-page--settings .settings-group__items { margin-inline: 0; }
.macos-page--settings .settings-row { border: 0; border-radius: 0; }
.macos-page--settings bit-item + bit-item { margin-top: 0; }
```

- [ ] **Step 4: Refresh and verify both provenance chains**

```bash
npm run update:official-settings-manifest
npm run update:official-settings-runtime-manifest
npm run check:official-settings:upstream
npm run check:official-settings:runtime
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/settings/settings-overlay.guard.spec.ts
npm run typecheck:official-settings
```

Expected: every command exits 0; runtime reports provenance passed for 12 outputs. Reject any authority-path or pinned-revision change.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run apps/menubar-tauri/src/app/settings/settings-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.spec.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts
```

Expected: PASS with six retained navigation events and unchanged launch-at-login pending/error behavior.

- [ ] **Step 6: Stage and commit**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.ts apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__tools__popup__settings__settings-v2.component.ts.patch apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__tools__popup__settings__settings-v2.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/settings-v2.component.ts apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/settings-v2.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__tools__popup__settings__settings-v2.component.ts.patch apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__tools__popup__settings__settings-v2.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json apps/menubar-tauri/src/app/settings/settings-page.component.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: unify ios27 settings groups"
```

### Task 3: Flatten Settings detail forms and standardize pending/error feedback

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-account-security.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-vault-settings.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-appearance.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__auth__popup__settings__account-security.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__vault__popup__settings__vault-settings.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__vault__popup__settings__appearance.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/auth/popup/settings/account-security.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/vault/popup/settings/vault-settings.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/vault/popup/settings/appearance.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__auth__popup__settings__account-security.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__vault__popup__settings__vault-settings.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__vault__popup__settings__appearance.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json`
- Modify: `apps/menubar-tauri/src/app/settings/autofill-settings-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/settings/settings-password-page.component.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Test: `apps/menubar-tauri/src/app/settings/p1-pages.spec.ts`
- Test: `apps/menubar-tauri/src/app/settings/vault-settings-page.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/settings/account-actions-page.component.spec.ts`

**Interfaces:**
- Preserve all existing `OfficialAccountSecurityComponent`, `OfficialVaultSettingsComponent`, and `OfficialAppearanceComponent` inputs/outputs exactly.
- Local pages gain only `settings-detail-group`, `settings-detail-row`, and `macos-form-control`; no new state owner.
- `data-testid="vault-sync-row"` exposes `[attr.aria-busy]="isSyncing"` while retaining `[disabled]="isSyncing"` and `(click)="sync.emit()"`.
- Produces the stable route-initiator keys `settings:folders`, `settings:archive`, and `settings:trash` on the three navigation buttons. `PopupRouterCacheService` consumes these keys in `2026-08-17-ios27-interaction-accessibility-qa.md` to restore focus after returning from `/folders`, `/archive`, or `/trash`; this task is that interaction plan's prerequisite.

- [ ] **Step 1: Add failing structure and pending tests**

Add to `p1-pages.spec.ts`:

```ts
it.each([
  ["official-account-security.component.html", "account-security"],
  ["official-vault-settings.component.html", "vault-settings"],
  ["official-appearance.component.html", "appearance"],
] as const)("marks %s as one continuous Settings detail surface", (file, id) => {
  const html = readFileSync(resolve(process.cwd(),
    "apps/menubar-tauri/src/app/upstream-overlays/settings", file), "utf8");
  expect(html).toContain(`data-settings-detail="${id}"`);
  expect(html).toContain("macos-continuous-group");
  expect(html).toContain("macos-continuous-row");
  expect(html).not.toContain("<bit-card");
});

it("carries Vault Settings focus owners through both retained transform chains", () => {
  const root = resolve(process.cwd(), "apps/menubar-tauri/src/app/upstream-overlays/settings");
  const files = [
    "official-vault-settings.component.html",
    "generated/apps/browser/src/vault/popup/settings/vault-settings.component.html",
    "source-patches/apps__browser__src__vault__popup__settings__vault-settings.component.html.patch",
  ];
  for (const file of files) {
    const source = readFileSync(resolve(root, file), "utf8");
    expect(source, file).toContain('data-popup-focus-key="settings:folders"');
    expect(source, file).toContain('data-popup-focus-key="settings:archive"');
    expect(source, file).toContain('data-popup-focus-key="settings:trash"');
  }
  const runtimePatchPath =
    "runtime-patches/apps__browser__src__vault__popup__settings__vault-settings.component.html.patch";
  const runtimePatch = readFileSync(resolve(root, runtimePatchPath), "utf8");
  for (const key of ["settings:folders", "settings:archive", "settings:trash"]) {
    expect(runtimePatch, `runtime patch must inherit ${key} from its generated authority`)
      .not.toContain(key);
  }
  const transformManifest = JSON.parse(readFileSync(
    resolve(root, "official-settings.transform-manifest.json"), "utf8",
  )) as { authorities: Array<{
    path: string;
    patch: { path: string };
    output: { path: string };
  }> };
  expect(transformManifest.authorities.find(({ path }) =>
    path === "apps/browser/src/vault/popup/settings/vault-settings.component.html"),
  ).toMatchObject({
    patch: { path: expect.stringContaining("source-patches/apps__browser__src__vault__popup__settings__vault-settings.component.html.patch") },
    output: { path: expect.stringContaining("generated/apps/browser/src/vault/popup/settings/vault-settings.component.html") },
  });
  const runtimeManifest = JSON.parse(readFileSync(
    resolve(root, "official-settings.runtime-manifest.json"), "utf8",
  )) as { authorities: Array<{
    authority: { path: string };
    patch: { path: string };
    output: { path: string };
  }> };
  expect(runtimeManifest.authorities.find(({ authority }) =>
    authority.path === "apps/browser/src/vault/popup/settings/vault-settings.component.html"),
  ).toMatchObject({
    patch: { path: expect.stringContaining(runtimePatchPath) },
    output: { path: expect.stringContaining("official-vault-settings.component.html") },
  });
  const runtimeContract = readFileSync(resolve(root, "official-settings-runtime-transforms.ts"), "utf8");
  expect(runtimeContract).toContain('"apps/browser/src/vault/popup/settings/vault-settings.component.html", "official-vault-settings.component.html"');
});
```

Add to `vault-settings-page.component.spec.ts`, using that file's existing TestBed helper and replacing only `VaultSessionService` with the shown fake:

```ts
it("announces sync pending without allowing a duplicate", async () => {
  let resolveSync!: () => void;
  const syncNow = vi.fn(() => new Promise<void>((resolve) => { resolveSync = resolve; }));
  await TestBed.configureTestingModule({
    imports: [VaultSettingsPageComponent],
    providers: [
      provideRouter([]),
      OfficialI18nService,
      { provide: I18nService, useExisting: OfficialI18nService },
      { provide: PopupStateStore, useValue: new PopupStateStore() },
      { provide: VaultSessionService, useValue: { syncNow } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(VaultSettingsPageComponent);
  fixture.detectChanges(false);
  const button = fixture.nativeElement.querySelector<HTMLButtonElement>("[data-testid='vault-sync-row']")!;
  button.click();
  button.click();
  fixture.detectChanges();
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.disabled).toBe(true);
  expect(syncNow).toHaveBeenCalledOnce();
  const navigationRows = Array.from(fixture.nativeElement.querySelectorAll<HTMLButtonElement>("button"));
  expect(navigationRows.find((row) => row.textContent?.includes("文件夹"))?.dataset["popupFocusKey"])
    .toBe("settings:folders");
  expect(navigationRows.find((row) => row.textContent?.includes("归档"))?.dataset["popupFocusKey"])
    .toBe("settings:archive");
  expect(navigationRows.find((row) => row.textContent?.includes("回收站"))?.dataset["popupFocusKey"])
    .toBe("settings:trash");
  resolveSync();
  await fixture.whenStable();
});
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run apps/menubar-tauri/src/app/settings/p1-pages.spec.ts -t "continuous Settings detail" apps/menubar-tauri/src/app/settings/vault-settings-page.component.spec.ts -t "announces sync pending"
```

Expected: FAIL because the detail hooks, `aria-busy`, and all three `data-popup-focus-key` owners are absent from the runtime/generated/source-patch chain.

- [ ] **Step 3: Implement exact presentation hooks**

Wrap each official detail body in one `settings-detail-group macos-continuous-group` with the exact `data-settings-detail` value above. Every selection/switch/action row uses `settings-detail-row macos-continuous-row`. The sync row is:

```html
<button type="button" bit-item-content class="settings-detail-row macos-continuous-row"
  data-testid="vault-sync-row" [disabled]="isSyncing" [attr.aria-busy]="isSyncing"
  (click)="sync.emit()">
  {{ "syncNow" | i18n }}
  <span slot="secondary">{{ syncLabel }}</span>
  <span slot="end">
    <i class="bwi" [class.bwi-spinner]="isSyncing" [class.bwi-spin]="isSyncing"
      [class.bwi-refresh]="!isSyncing" aria-hidden="true"></i>
  </span>
</button>
```

In `official-vault-settings.component.html`, keep the three existing route events and add the exact literal focus-owner attributes:

```html
<button type="button" bit-item-content class="settings-detail-row macos-continuous-row"
  data-popup-focus-key="settings:folders" (click)="navigate.emit('/folders')">
  {{ "folders" | i18n }}
  <i slot="end" class="bwi bwi-angle-right" aria-hidden="true"></i>
</button>
<button type="button" bit-item-content class="settings-detail-row macos-continuous-row"
  data-test-id="archive-link" data-popup-focus-key="settings:archive"
  (click)="navigate.emit('/archive')">
  {{ "archive" | i18n }}
  <i slot="end" class="bwi bwi-angle-right" aria-hidden="true"></i>
</button>
<button type="button" bit-item-content class="settings-detail-row macos-continuous-row"
  data-popup-focus-key="settings:trash" (click)="navigate.emit('/trash')">
  {{ "trash" | i18n }}
  <i slot="end" class="bwi bwi-angle-right" aria-hidden="true"></i>
</button>
```

In `AutofillSettingsPageComponent` and `KeyboardShortcutPageComponent`, replace the ordinary `bit-card` wrapper with `<section class="settings-detail-group macos-continuous-group">` and add `macos-form-control` to selects/recorder controls. Keep `SettingsPasswordPageComponent` as one quiet explanatory section and one primary handoff action.

```css
.macos-page--settings-detail .settings-detail-group { margin: 16px; background: transparent; }
.macos-page--settings-detail .settings-detail-row { padding-inline: 16px; }
.macos-page--settings-detail :is(bit-card, .settings-password-handoff) {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.macos-page--settings-detail [aria-busy="true"] { cursor: progress; }
```

Apply identical common markup, including the three literal focus keys, to `generated/apps/browser/src/vault/popup/settings/vault-settings.component.html` and its source patch. Mirror the resulting markup in `official-vault-settings.component.html`; preserve local-only inputs/outputs and alerts, then run the runtime-manifest updater so the generated-to-runtime patch and output hashes remain an exact chain. The three keys are inherited from the generated authority and therefore must not be added a second time by the runtime patch.

- [ ] **Step 4: Verify both provenance chains**

```bash
npm run update:official-settings-manifest
npm run update:official-settings-runtime-manifest
npm run check:official-settings:upstream
npm run check:official-settings:runtime
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/settings/settings-overlay.guard.spec.ts
npm run typecheck:official-settings
```

Expected: PASS for all 12 authorities with no inventory or pinned-revision change.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run apps/menubar-tauri/src/app/settings/p1-pages.spec.ts apps/menubar-tauri/src/app/settings/vault-settings-page.component.spec.ts apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.spec.ts apps/menubar-tauri/src/app/settings/account-actions-page.component.spec.ts apps/menubar-tauri/src/app/settings/pin-setup-dialog.component.spec.ts
```

Expected: PASS; the three route initiators expose `settings:folders`, `settings:archive`, and `settings:trash`, while duplicate mutation prevention, inline failure retention, shortcut retry, PIN/Touch ID boundaries, and focus restoration remain intact.

- [ ] **Step 6: Stage and commit**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/settings/official-account-security.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/official-vault-settings.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/official-appearance.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__auth__popup__settings__account-security.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__vault__popup__settings__vault-settings.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__vault__popup__settings__appearance.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/auth/popup/settings/account-security.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/vault/popup/settings/vault-settings.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/vault/popup/settings/appearance.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__auth__popup__settings__account-security.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__vault__popup__settings__vault-settings.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__vault__popup__settings__appearance.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json apps/menubar-tauri/src/app/settings/autofill-settings-page.component.ts apps/menubar-tauri/src/app/settings/keyboard-shortcut-page.component.ts apps/menubar-tauri/src/app/settings/settings-password-page.component.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts apps/menubar-tauri/src/app/settings/vault-settings-page.component.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: unify ios27 settings details"
```

### Task 4: Flatten About, Update, notices, and license documents

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-about.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__tools__popup__settings__about-page__about-page-v2.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__tools__popup__settings__about-page__about-page-v2.component.html.patch`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json`
- Modify: `apps/menubar-tauri/src/app/settings/third-party-notices-page.component.html`
- Modify: `apps/menubar-tauri/src/app/settings/third-party-notices-page.component.css`
- Modify: `apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.css`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Test: `apps/menubar-tauri/src/app/settings/third-party-notices-page.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/updates/app-update-card.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/settings/p1-pages.spec.ts`

**Interfaces:**
- Preserve every `OfficialAboutComponent` metadata/update input and output.
- Preserve `OfficialAboutDialogComponent` as the existing AppBottomSheet-backed true overlay.
- Preserve `openCompleteLicenses()` and `<pre data-testid="third-party-license-text" tabindex="0">`.
- Produce shadowless document surfaces with no nested vertical scroll.

- [ ] **Step 1: Add failing document-layout tests**

Add to `third-party-notices-page.component.spec.ts`:

```ts
const counts = host.querySelector<HTMLElement>(".third-party-notices-counts")!;
const groups = host.querySelector<HTMLElement>(".third-party-license-groups")!;
const list = groups.querySelector<HTMLElement>("ul")!;
expect(getComputedStyle(counts).boxShadow).toBe("none");
expect(getComputedStyle(groups).borderRadius).toBe("0px");
expect(getComputedStyle(groups).boxShadow).toBe("none");
expect(getComputedStyle(list).overflowY).not.toBe("auto");
expect(getComputedStyle(list).maxHeight).toBe("none");
```

Add to `third-party-licenses-page.component.spec.ts`:

```ts
expect(getComputedStyle(content!).borderRadius).toBe("0px");
expect(getComputedStyle(content!).boxShadow).toBe("none");
expect(getComputedStyle(content!).overflowX).not.toBe("auto");
expect(content!.scrollWidth - content!.clientWidth).toBe(0);
```

Add to `p1-pages.spec.ts`:

```ts
it("keeps About metadata as a real Sheet while the About page stays flat", () => {
  const page = readFileSync(resolve(process.cwd(),
    "apps/menubar-tauri/src/app/upstream-overlays/settings/official-about.component.html"), "utf8");
  const dialog = readFileSync(resolve(process.cwd(),
    "apps/menubar-tauri/src/app/upstream-overlays/settings/official-about-dialog.component.html"), "utf8");
  expect(page).toContain("about-continuous-list");
  expect(page).not.toContain("<bit-card");
  expect(dialog).toContain("bit-dialog");
});
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run apps/menubar-tauri/src/app/settings/third-party-notices-page.component.spec.ts apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.spec.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts -t "About metadata|license"
```

Expected: FAIL on the current 12 px document radii, nested category scroll, and missing About hook.

- [ ] **Step 3: Implement quiet documents**

Add `about-continuous-list macos-continuous-group` to About's item group and `macos-continuous-row` to its item-content buttons. Apply the common classes to the generated authority/source patch; retain local update card, metadata dialog, and handoff error in the runtime output and regenerate its runtime patch.

```css
.third-party-notices-counts,
.third-party-license-groups,
.third-party-license-action,
.third-party-license-text {
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.third-party-notices-counts { gap: 0; border-block: 1px solid var(--mac-border-subtle); }
.third-party-notices-count-card { border: 0; border-radius: 0; background: transparent; }
.third-party-notices-count-card + .third-party-notices-count-card {
  border-left: 1px solid var(--mac-border-subtle);
}
.third-party-license-groups ul { max-height: none; overflow: visible; }
.third-party-license-text {
  max-width: calc(100% - 32px);
  overflow-x: hidden;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  user-select: text;
}
```

Do not change About dialog markup, update state, legal text, selection, or page scroll ownership.

- [ ] **Step 4: Refresh Settings provenance and guards**

```bash
npm run update:official-settings-manifest
npm run update:official-settings-runtime-manifest
npm run check:official-settings:upstream
npm run check:official-settings:runtime
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/settings/settings-overlay.guard.spec.ts
npm run typecheck:official-settings
```

Expected: PASS with only About HTML patch/output hashes changing.

- [ ] **Step 5: Run GREEN and build**

```bash
npx vitest run apps/menubar-tauri/src/app/settings/third-party-notices-page.component.spec.ts apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.spec.ts apps/menubar-tauri/src/app/updates/app-update-card.component.spec.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts
npm run build:web
```

Expected: PASS; update retry, true About Sheet, long-text selection, and one scroll owner remain intact.

- [ ] **Step 6: Stage and commit**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/settings/official-about.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/source-patches/apps__browser__src__tools__popup__settings__about-page__about-page-v2.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/generated/apps/browser/src/tools/popup/settings/about-page/about-page-v2.component.html apps/menubar-tauri/src/app/upstream-overlays/settings/runtime-patches/apps__browser__src__tools__popup__settings__about-page__about-page-v2.component.html.patch apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/settings/official-settings.runtime-manifest.json apps/menubar-tauri/src/app/settings/third-party-notices-page.component.html apps/menubar-tauri/src/app/settings/third-party-notices-page.component.css apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.css apps/menubar-tauri/src/app/settings/third-party-notices-page.component.spec.ts apps/menubar-tauri/src/app/settings/third-party-licenses-page.component.spec.ts apps/menubar-tauri/src/app/settings/p1-pages.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: flatten ios27 information pages"
```

## Plan Completion Gate

```bash
npm run typecheck:official-settings
npx vitest run apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts apps/menubar-tauri/src/app/settings apps/menubar-tauri/src/app/upstream-overlays/settings apps/menubar-tauri/src/app/updates/app-update-card.component.spec.ts
npm run build:web
```

Expected: all commands exit 0. Capture 480 × 600 evidence for `settings-main`, `account-security`, `vault-settings`, `vault-settings-sync-failure`, `one-field-settings`, `appearance`, `about`, `about-dialog`, and `change-password-handoff`; verify light/dark/system themes, 200% text, keyboard focus, reduced motion, one scroll owner, and no horizontal overflow.
