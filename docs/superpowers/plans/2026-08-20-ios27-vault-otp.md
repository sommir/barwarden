# iOS 27 Vault and OTP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harmonize Vault list, AutoFill suggestions, OTP, New Item, recovery pages, detail, and add/edit/clone into compact rows and forms while preserving all three credential quick actions.

**Architecture:** Local route owners retain state, commands, focus, and dirty navigation. Retained Vault presentation stays generated through its exact member/template transforms and recovery manifests. Shared row/form roles replace universal 52px and card rules; username/password/TOTP remain separate capability-based actions with item-plus-field accessible names.

**Tech Stack:** Angular, retained Vault overlays, Vitest real component fixtures, CSS tokens, manifest updaters.

**Spec:** `docs/superpowers/specs/2026-08-20-ios27-full-ui-harmonization-design.md`

## Global Constraints

- Routes: `/tabs/vault`, `/tabs/otp`, `/new-item`, `/folders`, `/archive`, `/trash`, `/view-cipher/:id`, `/add-cipher`, `/edit-cipher`, `/clone-cipher`, `/cipher-password-history`.
- Vault/OTP information rows are 48px normal, 44px compact.
- Username, password, and TOTP quick actions remain distinct, ordered, capability-gated, isolated from row navigation, and named with item plus field.
- Action owners are 44px; plates are 32/28px; semantic colors remain username blue, password purple, TOTP amber.
- Forms paint 40/36px controls and use 12/10px field gaps; textarea minimum is 72px.
- Preserve stale, loading, empty, no-results, unavailable, pending, reprompt, retry, recovery, and destructive confirmation behavior.
- Do not stage any unrelated current AutoFill/Vault worktree hunk.

---

### Task 1: Compact Vault rows and the AutoFill suggestion region

**Files:**
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-overlay.guard.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.css`
- Modify: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Modify: `apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts`

**Interfaces:**
- Preserve `copyAndFillUsername`, `copyAndFillPassword`, `copyAndFillTotp`, menu, row navigation, `viewPassword`, and `availableFields`/`FIELD_ORDER`.
- Produces `.macos-row--double`, `data-field="username|password|totp"`, and `.macos-icon-plate` on the real glyph node.

- [ ] **Step 1: Add RED real-row tests**

```ts
const row = host.querySelector<HTMLElement>(".vault-list-row")!;
expect(getComputedStyle(row).minHeight).toBe("48px");
const actions = [...host.querySelectorAll<HTMLButtonElement>('[data-field]')];
expect(actions.map((button) => button.dataset["field"])).toEqual(["username", "password", "totp"]);
for (const action of actions) {
  expect(getComputedStyle(action).minWidth).toBe("44px");
  expect(getComputedStyle(action.querySelector<HTMLElement>(".bwi")!).width).toBe("32px");
  expect(action.getAttribute("aria-label")).toContain("GitHub");
}
```

Add a suggestion fixture with only username and TOTP and assert exactly those two actions precede the generic Fill action; no password action is fabricated.

- [ ] **Step 2: Run RED**

```bash
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
```

Expected: FAIL on 52px rows and oversized permanently filled action geometry.

- [ ] **Step 3: Add semantic role classes and scoped CSS**

Append `macos-row macos-row--double` to the existing `.vault-list-row`. Append `macos-hit-target` to each existing field button and `macos-icon-plate` to its existing `.bwi` glyph through the retained transform; do not add or replace the click/label expressions.

```css
.macos-page--vault-list .vault-list-row { min-height:var(--mac-row-double); padding-block:2px; }
.macos-page--vault-list .vault-list-row [data-field] { min-width:var(--mac-hit-size); min-height:var(--mac-hit-size); padding:6px; border:0; background:transparent; }
.macos-page--vault-list .vault-list-row [data-field] > .bwi { display:grid; width:var(--mac-icon-plate); height:var(--mac-icon-plate); place-items:center; border-radius:var(--mac-control-radius); }
.macos-page--vault-list [data-field="username"] > .bwi { color:var(--mac-action-username); }
.macos-page--vault-list [data-field="password"] > .bwi { color:var(--mac-action-password); }
.macos-page--vault-list [data-field="totp"] > .bwi { color:var(--mac-action-totp); }
:root[data-bw-compact-mode="true"] .macos-page--vault-list .vault-list-row { min-height:var(--mac-row-double-compact); }
:root[data-bw-compact-mode="true"] .macos-page--vault-list .vault-list-row [data-field] > .bwi { width:var(--mac-icon-plate-compact); height:var(--mac-icon-plate-compact); }
```

Apply the same action roles inside `VaultAutofillSuggestionsComponent`; keep its contextual tint limited to the suggestion region and remove per-row white cards.

- [ ] **Step 4: GREEN, guard, and capability regression**

```bash
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-overlay.guard.spec.ts
npm run build:web
```

Expected: missing capabilities stay missing; action clicks do not navigate the row.

- [ ] **Step 5: Commit exact task hunks**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.html apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-item.component.spec.ts apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.css apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/app/upstream-overlays/vault-main/retained-vault-list-overlay.guard.spec.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.ts apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: compact ios27 vault rows"
```

### Task 2: Compact OTP list, search, countdown, and copy feedback

**Files:**
- Modify: `apps/menubar-tauri/src/app/vault/otp-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/otp-code-row.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/otp-code-row.component.spec.ts`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Modify: `apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts`

**Interfaces:**
- Preserve `otp-item:<id>` focus keys, query restoration, copy command, countdown refresh, and count-only live announcements.

- [ ] **Step 1: Add RED production DOM tests**

```ts
const row = host.querySelector<HTMLElement>("bw-otp-code-row article")!;
const copy = row.querySelector<HTMLButtonElement>('button[data-testid="otp-code"]')!;
expect(row.dataset["popupFocusKey"]).toMatch(/^otp-item:/);
expect(getComputedStyle(row).minHeight).toBe("48px");
expect(getComputedStyle(copy).minWidth).toBe("44px");
expect(row.querySelector<HTMLElement>(".otp-code-row__code")!.textContent).toMatch(/^\d{6}$/);
expect(host.querySelector('[aria-live="polite"]')!.textContent).not.toMatch(/\d{6}/);
```

Also assert compact row 44px, countdown plate ≤32px, and OTP→Generator→OTP restores the same copy descendant.

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts apps/menubar-tauri/src/app/vault/otp-code-row.component.spec.ts`

- [ ] **Step 3: Add row roles and CSS**

Add `macos-row macos-row--double` to the existing article, `macos-hit-target` to Copy, and `macos-icon-plate` to the countdown/copy glyph wrappers.

```css
.macos-page--otp .otp-code-row { min-height:var(--mac-row-double); padding:2px 0 2px 12px; border-bottom:1px solid var(--mac-border-subtle); border-radius:0; box-shadow:none; }
.macos-page--otp .otp-code-row__code { font-size:20px; line-height:24px; font-variant-numeric:tabular-nums; }
.macos-page--otp .otp-code-row button { min-width:var(--mac-hit-size); min-height:var(--mac-hit-size); }
.macos-page--otp .otp-code-row__countdown { width:var(--mac-icon-plate); height:var(--mac-icon-plate); }
:root[data-bw-compact-mode="true"] .macos-page--otp .otp-code-row { min-height:var(--mac-row-double-compact); padding-block:0; }
```

- [ ] **Step 4: GREEN and result-announcement regression**

```bash
npx vitest run apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts apps/menubar-tauri/src/app/vault/otp-code-row.component.spec.ts apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/menubar-tauri/src/app/vault/otp-page.component.ts apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts apps/menubar-tauri/src/app/vault/otp-code-row.component.ts apps/menubar-tauri/src/app/vault/otp-code-row.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: compact ios27 otp rows"
```

### Task 3: Unify New Item, folders, archive, trash, and password history

**Files:**
- Modify: `apps/menubar-tauri/src/app/vault/new-item-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/new-item-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/folders-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/folders-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/archive-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/trash-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-password-history-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-password-history-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery-member-transforms.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.html`
- Modify: `apps/menubar-tauri/src/styles/global.css`

**Interfaces:**
- Preserve five new-item types, folder Sheet focus stack, archive/trash typed confirmation/retry, password-history copy and reprompt behavior.

- [ ] **Step 1: Add RED row consistency tests**

For real fixtures assert all New Item choices and recovery list rows use `macos-row--double`, min-height 48/44, no shadow/gap, and 44px action owners. Assert New Item order remains Login, Card, Identity, Secure Note, Folder.

- [ ] **Step 2: Run RED**

```bash
npx vitest run apps/menubar-tauri/src/app/vault/new-item-page.component.spec.ts apps/menubar-tauri/src/app/vault/folders-page.component.spec.ts apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-password-history-page.component.spec.ts
```

- [ ] **Step 3: Adopt shared row roles**

Append `macos-row macos-row--double macos-pressable` to each existing `.new-item-option`
and retained recovery/password-history row owner; append `macos-hit-target` to row action buttons.
Use:

```css
.macos-page--vault-form .new-item-option,
.macos-page--vault-recovery :is(bit-item,.password-history-row) { min-height:var(--mac-row-double); margin:0; border-radius:0; box-shadow:none; }
.macos-page--vault-recovery :is(button,a) { min-width:var(--mac-hit-size); min-height:var(--mac-hit-size); }
.macos-page--vault-form .new-item-option { min-width:var(--mac-hit-size); min-height:var(--mac-row-double); }
:root[data-bw-compact-mode="true"] .macos-page--vault-form .new-item-option,
:root[data-bw-compact-mode="true"] .macos-page--vault-recovery :is(bit-item,.password-history-row) { min-height:var(--mac-row-double-compact); }
```

Do not change AppBottomSheet calls or focus-trigger arguments.

- [ ] **Step 4: GREEN, updater, guards**

```bash
npm run update:i18n-retained-manifests
npm run update:i18n-retained-manifests
npx vitest run apps/menubar-tauri/src/app/vault/new-item-page.component.spec.ts apps/menubar-tauri/src/app/vault/folders-page.component.spec.ts apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-password-history-page.component.spec.ts apps/menubar-tauri/src/app/vault/recovery-feedback-ownership.integration.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-overlay.guard.spec.ts
npm run typecheck:official-recovery
```

- [ ] **Step 5: Commit exact route, transform, and manifest hunks**

Stage the route/spec and recovery files explicitly, then stage only the task CSS hunk:

```bash
git add apps/menubar-tauri/src/app/vault/new-item-page.component.ts apps/menubar-tauri/src/app/vault/new-item-page.component.spec.ts apps/menubar-tauri/src/app/vault/folders-page.component.ts apps/menubar-tauri/src/app/vault/folders-page.component.spec.ts apps/menubar-tauri/src/app/vault/archive-page.component.ts apps/menubar-tauri/src/app/vault/trash-page.component.ts apps/menubar-tauri/src/app/vault/archive-trash-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-password-history-page.component.ts apps/menubar-tauri/src/app/vault/vault-password-history-page.component.spec.ts
git add apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery-member-transforms.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/folders/official-folders.component.html apps/menubar-tauri/src/app/upstream-overlays/recovery/archive/official-archive.component.html apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash.component.html apps/menubar-tauri/src/app/upstream-overlays/recovery/trash/official-trash-list-items-container.component.html apps/menubar-tauri/src/app/upstream-overlays/recovery/password-history/official-password-history-view.component.html
git add -p apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: harmonize ios27 vault management"
```

### Task 4: Harmonize Vault detail and add/edit/clone forms

**Files:**
- Modify: `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-detail-field.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-detail-field.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-edit-field.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-form-section.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-form-member-transforms.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-form.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-form-member-transforms.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-form.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-detail.transform-manifest.json`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-read-only-cipher-card.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-item-details.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-item-details.component.html`
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Modify: `apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts`

**Interfaces:**
- Preserve detail Copy/Fill/Edit/History/Archive/Delete actions; dirty owner continuation; first-invalid focus; pending/busy/live state; typed failure retention.

- [ ] **Step 1: Add RED real detail/form geometry tests**

```ts
for (const valueRow of detail.querySelectorAll<HTMLElement>(".official-read-only-field")) {
  expect(parseFloat(getComputedStyle(valueRow).minHeight)).toBeGreaterThanOrEqual(44);
  expect(getComputedStyle(valueRow).boxShadow).toBe("none");
}
for (const owner of form.querySelectorAll<HTMLElement>("[bitfieldcontainer]")) {
  expect(parseFloat(getComputedStyle(owner).minHeight)).toBeGreaterThanOrEqual(44);
}
for (const control of form.querySelectorAll<HTMLElement>("input,select,[role=combobox]")) {
  expect(getComputedStyle(control).height).toBe("40px");
}
expect(getComputedStyle(form.querySelector("textarea")!).minHeight).toBe("72px");
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
```

- [ ] **Step 3: Add shared form/detail roles**

Add `macos-field-owner` to real field containers, `macos-control-visible` to input/select/combobox, `macos-hit-target` to suffix actions, `macos-button-owner` to the single Save action, and keep textareas separate.

```css
.macos-page--vault-detail .official-read-only-field { min-height:var(--mac-row-single); padding:4px 0; border-bottom:1px solid var(--mac-border-subtle); border-radius:0; box-shadow:none; }
.macos-page--vault-form .cipher-form-scroll { display:grid; gap:var(--mac-group-gap); padding:0; }
.macos-page--vault-form [bitfieldcontainer] { min-height:var(--mac-hit-size); margin:0; }
.macos-page--vault-form :is(input,select,[role="combobox"]) { height:var(--mac-control-visible); min-height:var(--mac-control-visible); border-radius:var(--mac-control-radius); }
.macos-page--vault-form textarea { min-height:72px; border-radius:var(--mac-control-radius); }
:root[data-bw-compact-mode="true"] .macos-page--vault-form :is(input,select,[role="combobox"]) { height:var(--mac-control-visible-compact); min-height:var(--mac-control-visible-compact); }
```

- [ ] **Step 4: Full Vault gate**

Run `npm run update:i18n-retained-manifests` twice and require no second-run diff, then:

```bash
npx vitest run apps/menubar-tauri/src/app/vault apps/menubar-tauri/src/app/upstream-overlays/vault-main apps/menubar-tauri/src/app/upstream-overlays/cipher-detail apps/menubar-tauri/src/app/upstream-overlays/cipher-form apps/menubar-tauri/src/app/upstream-overlays/recovery
npm run typecheck:official-login
npm run typecheck:official-personal
npm run typecheck:official-recovery
npm run build:web
```

- [ ] **Step 5: Commit**

Stage only the listed direct/runtime/manifest files and task CSS hunk:

```bash
git add apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-detail-field.component.ts apps/menubar-tauri/src/app/vault/vault-detail-field.component.spec.ts apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.ts apps/menubar-tauri/src/app/vault/vault-add-edit-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-edit-field.component.ts apps/menubar-tauri/src/app/vault/vault-form-section.component.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
git add apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-form-member-transforms.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-form-member-transforms.ts
git add apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-cipher-detail.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-read-only-cipher-card.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-cipher-form.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-item-details.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-cipher-form.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-item-details.component.html
git add -p apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-login-form.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/cipher-form/official-personal-form.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.transform-manifest.json apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-personal-detail.transform-manifest.json apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: harmonize ios27 vault workflows"
```
