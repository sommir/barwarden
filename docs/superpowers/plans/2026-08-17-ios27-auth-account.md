# iOS 27 Authentication and Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give login, password hint, environment, two-factor, new-device, lock, and account-switching routes one flat iOS 27 form/list language while preserving every authentication and security boundary.

**Architecture:** Keep all retained auth templates, transform manifests, adapters, route guards, and services byte-stable. Implement this batch through scoped `global.css` page-family rules plus source/computed-style and existing behavior tests; shaped self-hosted, provider, and logout overlays remain real menus/Sheet/confirmation layers.

**Tech Stack:** Angular 21 reactive forms, retained Bitwarden auth overlays, Vitest/jsdom, Playwright 480 × 600 evidence, CSS custom properties.

## Global Constraints

- Preserve `/login`, `/lock`, `/2fa`, `/new-device-verification`, `/hint`, and `/account-switcher` route/guard semantics.
- Do not change login completion, challenge expiry, paste submit, cancellation, PIN/Touch ID availability, master-password, environment, or account-selection logic.
- Authentication pages use one canvas; ordinary `.macos-auth-card` and `.macos-auth-identity` surfaces have zero radius, zero shadow, and no enclosing card border.
- Inputs remain 10–12 px; primary and secondary controls and every clickable target remain at least 44 px; focus ring is 2 px.
- Menus, self-hosted Sheet, provider Sheet, and logout confirmation retain 12–16 px radius and one light shadow.
- Errors stay adjacent to the corrected field/region; pending prevents duplicate mutation without clearing readable values.
- `apps/menubar-tauri/src/styles/global.css` is a dirty hot file: use `apply_patch`, inspect the diff, and stage only intended hunks with `git add -p`.
- Auth transform manifests have external digest pins and no update script. This plan does not edit retained auth TS/HTML, so do not edit any auth manifest or digest constant; every task runs the exact guard for the unchanged overlay.
- Native Tauri QA is the default visual gate. Run Playwright or launch Chromium only after the user explicitly authorizes that browser for this task; absence of browser authorization does not block native completion.

---

## File Map

- `apps/menubar-tauri/src/styles/global.css`: all auth/account visual changes in this batch.
- `apps/menubar-tauri/src/app/auth/*.spec.ts`: route behavior, focus, pending, cancellation, and source-style contracts.
- `apps/menubar-tauri/src/app/upstream-overlays/auth/**/**guard.spec.ts`: retained authority and transform-manifest integrity.
- `apps/menubar-tauri/e2e/official-auth-accounts.spec.ts`: deterministic 480 × 600 keyboard, overflow, theme, and evidence checks.

### Task 1: Flatten login, password hint, and environment selection

**Files:**
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Test: `apps/menubar-tauri/src/app/auth/login-page.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/auth/password-hint-page.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-environment-selector.component.spec.ts`
- Guard: `apps/menubar-tauri/src/app/upstream-overlays/auth/login/auth-login-overlay.guard.spec.ts`
- Guard: `apps/menubar-tauri/src/app/upstream-overlays/auth/auth-environment-overlay.guard.spec.ts`

**Interfaces:**
- Preserve `OfficialPasswordLoginComponent.formGroup`, `LoginUiState`, `continuePressed()`, `submit`, `backButtonClicked()`, `selectEnvironment(serverUrl: string)`, and password-focus restoration.
- Preserve `OfficialEnvironmentSelectorComponent` outputs `serverUrlChange`, `environmentValidChange`, `interactionStarted`, `interactionCompleted`; preserve `toggle(region: "US" | "EU" | "SelfHosted", trigger?: HTMLElement)` and `selectSelfHosted(serverUrl: string)`.
- Produces CSS hooks `.macos-auth-card`, `bw-login-environment-selector`, and `.official-login-environment-menu` with no component API change.

- [ ] **Step 1: Replace the existing visual expectation with a RED flat-surface contract**

In `login-page.component.spec.ts`, replace the current “centered secondary control” CSS assertions with:

```ts
it("uses a flat auth form and a continuous 52px environment row", () => {
  const styles = readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"), "utf8");
  expect(styles).toMatch(/\.macos-auth-card\s*{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/s);
  expect(styles).toMatch(/bw-login-environment-selector\s*{[^}]*width:\s*min\(100%,\s*360px\);/s);
  expect(styles).toMatch(/bw-login-environment-selector\s+\[bitTypography="body2"\]\s*{[^}]*min-height:\s*52px;[^}]*border-radius:\s*0;/s);
  expect(styles).toMatch(/\.macos-auth-card\s+:is\(input, select, textarea\)\s*{[^}]*border-radius:\s*10px;/s);
  expect(styles).toMatch(/\.macos-auth-card\s+:is\(button, \[role="button"\], a\):focus-visible\s*{[^}]*outline:\s*2px solid/s);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/auth/login-page.component.spec.ts -t "flat auth form"`

Expected: FAIL because `.macos-auth-card` still has a border/radius/shadow, the environment control is pill-shaped, and focus is 3 px.

- [ ] **Step 3: Apply the scoped auth CSS**

```css
.macos-auth-card {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
.macos-auth-card :is(input, select, textarea) { border-radius: 10px; }
.macos-auth-card :is(button, [role="button"], a):focus-visible {
  outline: 2px solid var(--mac-focus);
  outline-offset: 2px;
}
bw-login-environment-selector {
  display: block;
  width: min(100%, 360px);
  margin: 12px auto 0;
}
bw-login-environment-selector [bitTypography="body2"] {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: center;
  border-block: 1px solid var(--mac-border-subtle);
  border-radius: 0;
  color: var(--mac-text-secondary);
}
bw-login-environment-selector [bitTypography="body2"] button { min-height: 44px; }
```

Do not alter `.bit-menu-panel [role="menu"]` or `.app-bottom-sheet`.

- [ ] **Step 4: Run GREEN plus unchanged-overlay guards**

```bash
npx vitest run apps/menubar-tauri/src/app/auth/login-page.component.spec.ts apps/menubar-tauri/src/app/auth/password-hint-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/auth/environment/official-environment-selector.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/auth/login/auth-login-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/auth/auth-environment-overlay.guard.spec.ts
npm run typecheck:official-login
```

Expected: PASS; invalid email/URL, password focus, environment Sheet Escape/focus restoration, and external manifest digests remain unchanged.

- [ ] **Step 5: Stage and commit**

```bash
git add apps/menubar-tauri/src/app/auth/login-page.component.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: flatten ios27 login surfaces"
```

### Task 2: Unify two-factor and new-device challenge hierarchy

**Files:**
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Test: `apps/menubar-tauri/src/app/auth/auth-challenge-pages.spec.ts`
- Guard: `apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/auth-two-factor-overlay.guard.spec.ts`
- Guard: `apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/auth-new-device-overlay.guard.spec.ts`
- Guard: `apps/menubar-tauri/src/app/auth/official-two-factor-production-boundary.spec.ts`

**Interfaces:**
- Preserve `OfficialTwoFactorComponent.submit`, `back()`, `selectOtherTwoFactorMethod(event: Event)`, `selectProvider(provider: RetainedTwoFactorProvider)`, expiry ownership, paste submit, and provider Sheet focus behavior.
- Preserve `OfficialNewDeviceVerificationComponent.submit`, `resendOTP()`, `goBack()`, `onPaste(event: ClipboardEvent)`, `disableRequestOTP`, and `activeAction: "submit" | "resend" | null` semantics.
- Produces `.macos-auth-actions`, selected by the existing test ids `two-factor-continue`, `two-factor-other-method`, `two-factor-back`, `new-device-continue`, `new-device-resend`, `new-device-back`.

- [ ] **Step 1: Add a failing challenge-action CSS test**

Add to `auth-challenge-pages.spec.ts`:

```ts
it("gives challenge secondary actions continuous 44px rows without changing the primary", () => {
  const css = readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"), "utf8");
  for (const testId of ["two-factor-other-method", "two-factor-back", "new-device-resend", "new-device-back"]) {
    expect(css).toMatch(new RegExp(`\\[data-testid="${testId}"\\]\\s*\\{[^}]*min-height:\\s*44px;[^}]*border-radius:\\s*0;`, "s"));
  }
  expect(css).toMatch(/\.macos-auth-card\s+\.macos-primary-action\s*{[^}]*min-height:\s*44px;/s);
  expect(css).toMatch(/\.macos-auth-validation\s*{[^}]*min-height:\s*0;/s);
});
```

Add `readFileSync` from `node:fs` and `join` from `node:path` imports at the top.

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/auth/auth-challenge-pages.spec.ts -t "continuous 44px rows"`

Expected: FAIL because no test-id-specific continuous-row rules exist.

- [ ] **Step 3: Add the exact secondary-action hierarchy**

```css
.macos-auth-card .macos-primary-action { min-height: 44px; }
.macos-auth-card :is(
  [data-testid="two-factor-other-method"],
  [data-testid="two-factor-back"],
  [data-testid="new-device-resend"],
  [data-testid="new-device-back"]
) {
  min-height: 44px;
  border: 0;
  border-bottom: 1px solid var(--mac-border-subtle);
  border-radius: 0;
  background: transparent;
  color: var(--mac-accent);
  box-shadow: none;
}
.macos-auth-card :is([data-testid="two-factor-back"], [data-testid="new-device-back"]) {
  color: var(--mac-text-secondary);
}
.macos-auth-validation { min-height: 0; }
```

Keep Continue as the only filled blue action. Do not change template spacing utilities in guarded HTML.

- [ ] **Step 4: Run GREEN and guards**

```bash
npx vitest run apps/menubar-tauri/src/app/auth/auth-challenge-pages.spec.ts apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/auth-two-factor-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/auth-new-device-overlay.guard.spec.ts apps/menubar-tauri/src/app/auth/official-two-factor-production-boundary.spec.ts
npm run typecheck:official-login
```

Expected: PASS for paste submission, duplicate-submit blocking, resend loading, expiry, cancellation, late completion, provider selection, and fixed error text.

- [ ] **Step 5: Stage and commit**

```bash
git add apps/menubar-tauri/src/app/auth/auth-challenge-pages.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: unify ios27 authentication challenges"
```

### Task 3: Convert lock alternatives into one method hierarchy

**Files:**
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Test: `apps/menubar-tauri/src/app/auth/lock-page.component.spec.ts`
- Guard: `apps/menubar-tauri/src/app/upstream-overlays/auth/lock/auth-lock-overlay.guard.spec.ts`

**Interfaces:**
- Preserve `type ActiveUnlockMethod = "biometric" | "pin" | "masterPassword"`.
- Preserve `UnlockMethodAvailability`, `selectMethod(method: ActiveUnlockMethod)`, `unlockWithPin(pin: string)`, `unlockWithBiometric()`, logout, attempt limits, cancellation, and credential reset epoch.
- Existing test ids are the presentation contract: `lock-biometric-button`, `lock-switch-pin`, `lock-switch-master-password`, `lock-logout-button`, `lock-switch-account`.

- [ ] **Step 1: Add the failing lock CSS contract**

Add to `lock-page.component.spec.ts`:

```ts
it("renders identity and alternative methods as flat continuous rows", () => {
  const css = readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"), "utf8");
  expect(css).toMatch(/\.macos-auth-identity\s*{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/s);
  for (const testId of ["lock-switch-pin", "lock-switch-master-password", "lock-logout-button", "lock-switch-account"]) {
    expect(css).toMatch(new RegExp(`\\[data-testid="${testId}"\\]\\s*\\{[^}]*min-height:\\s*44px;[^}]*border-radius:\\s*0;`, "s"));
  }
});
```

Add these imports at the top of `lock-page.component.spec.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/auth/lock-page.component.spec.ts -t "flat continuous rows"`

Expected: FAIL because identity is outlined/rounded and alternative actions lack the new rules.

- [ ] **Step 3: Apply the lock hierarchy CSS**

```css
.macos-auth-identity {
  border: 0;
  border-radius: 0;
  border-bottom: 1px solid var(--mac-border-subtle);
  background: transparent;
  box-shadow: none;
}
[data-testid="lock-switch-pin"],
[data-testid="lock-switch-master-password"],
[data-testid="lock-logout-button"],
[data-testid="lock-switch-account"] {
  min-height: 44px;
  border: 0;
  border-bottom: 1px solid var(--mac-border-subtle);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
[data-testid="lock-logout-button"] { color: var(--mac-destructive); }
```

Touch ID remains the only filled primary action when available; PIN and master password remain ordered alternatives; logout is written red danger text, not an equal primary button.

- [ ] **Step 4: Run GREEN and guard**

```bash
npx vitest run apps/menubar-tauri/src/app/auth/lock-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/auth/lock/auth-lock-overlay.guard.spec.ts
npm run typecheck:official-login
```

Expected: PASS for default-method selection, automatic biometric prompt ownership, incorrect-PIN limits, master-password fallback, navigation failure, and manifest digest.

After the user explicitly authorizes Chromium, run this additional browser-only regression:

```bash
npx playwright test apps/menubar-tauri/e2e/pin-biometric-unlock.spec.ts --project=chromium --workers=1 --reporter=line
```

Without that explicit authorization, record `browser regression: not run — Chromium not authorized` and continue with the native Task 4 QA.

- [ ] **Step 5: Stage and commit**

```bash
git add apps/menubar-tauri/src/app/auth/lock-page.component.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git diff --cached --check
git commit -m "style: unify ios27 unlock methods"
```

### Task 4: Flatten account switching and verify native auth evidence

**Files:**
- Modify: `apps/menubar-tauri/src/styles/global.css`
- Test: `apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.spec.ts`
- Test: `apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.spec.ts`
- Guard: `apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/auth-account-switching-overlay.guard.spec.ts`
- Evidence: `apps/menubar-tauri/e2e/official-auth-accounts.spec.ts`
- Native evidence directory: `docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/`
- Optional Chromium authority directory: `docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/`

**Interfaces:**
- Preserve `OfficialAvailableAccount`, `OfficialAccountSwitcherAdapter`, `ActiveAccountAuthorization = "unlocked" | "locked" | "signed-out" | "recovery-required"`, `presentAvailableAccounts(...)`, and add/select/lock/lockAll/recover/logout behavior.
- Status must remain written text plus icon; row navigation remains the single account button; logout remains `DialogService.openSimpleDialog(...)` confirmation.
- Produces flat 52 px `auth-account bit-item` rows with wrapping `.macos-account-label` and no card gaps.

- [ ] **Step 1: Add the failing account-list visual test**

Add to `official-account.component.spec.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("defines continuous account rows and wrapping written status", () => {
  const css = readFileSync(join(process.cwd(), "apps/menubar-tauri/src/styles/global.css"), "utf8");
  expect(css).toMatch(/\.macos-page--account-switcher\s+auth-account\s+bit-item\s*{[^}]*min-height:\s*52px;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/s);
  expect(css).toMatch(/auth-account\s+\.macos-account-label\s*{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/s);
  expect(css).toMatch(/\.macos-page--account-switcher\s+auth-account\s*\+\s*auth-account\s*{[^}]*margin-top:\s*0;/s);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.spec.ts -t "continuous account rows"`

Expected: FAIL because account rows lack scoped continuous-list rules.

- [ ] **Step 3: Apply exact account-list CSS**

```css
.macos-page--account-switcher auth-account bit-item {
  min-height: 52px;
  border: 0;
  border-bottom: 1px solid var(--mac-border-subtle);
  border-radius: 0;
  background: var(--mac-surface-solid);
  box-shadow: none;
}
.macos-page--account-switcher auth-account + auth-account { margin-top: 0; }
auth-account .macos-account-label {
  max-width: 100%;
  overflow: visible;
  overflow-wrap: anywhere;
  text-overflow: clip;
  white-space: normal;
}
.macos-page--account-switcher auth-account button[bit-item-content] { min-height: 52px; }
```

Do not change `.account-switcher-dialog` or `DialogService`; the confirmation remains shaped.

- [ ] **Step 4: Run unit GREEN, guard, typecheck, and build**

```bash
npx vitest run apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.spec.ts apps/menubar-tauri/src/app/auth/official-account-switcher.adapter.spec.ts apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/auth-account-switching-overlay.guard.spec.ts
npm run typecheck:official-login
npm run build:web
```

Expected: PASS for written current/locked/recovery status, account limit/add row, recovery retry, action isolation, and digest-pinned manifest.

- [ ] **Step 5: Capture the default native Tauri evidence from deterministic states**

Create the output directory, then capture one state at a time. Do not add a production route or persist evidence state. For each row below, replace `STATE` and `FILE`, wait for the 480 × 600 Barwarden window, then click that window when `screencapture` requests a target. The `-o` flag excludes the native window shadow. Retina capture may still produce 960 × 1200 physical pixels, so inspect the uncropped raw capture, require the exact 4:5 window ratio, and normalize every accepted raw image to 480 × 600 with the existing macOS `sips` tool:

```bash
mkdir -p docs/superpowers/specs/assets/ios27-auth-native-2026-08-17
VITE_BW_VAULT_EVIDENCE=true npm run tauri:dev -- --config '{"build":{"devUrl":"http://127.0.0.1:1420/?authEvidence=STATE"}}'
screencapture -x -o -w /private/tmp/FILE
sips -g pixelWidth -g pixelHeight /private/tmp/FILE
sips -z 600 480 /private/tmp/FILE --out docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/FILE
sips -g pixelWidth -g pixelHeight docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/FILE
```

The raw `sips -g` output must be exactly `pixelWidth: 480, pixelHeight: 600` or `pixelWidth: 960, pixelHeight: 1200`. Both are the uncropped 4:5 window; any other size is a failed capture and must be recaptured rather than cropped. The final `sips -g` output must be exactly `pixelWidth: 480, pixelHeight: 600`.

Use this exact reproducible state/file mapping:

| State/query | Route and deterministic interaction | Native file |
| --- | --- | --- |
| `email` | `/login`, untouched email phase | `auth-email-light-480x600.png` |
| `email` | enter `auth-evidence@example.test`, activate Continue; do not use `master-password` as a direct entry | `auth-master-password-480x600.png` |
| `hint` | `/hint`, untouched | `auth-password-hint-480x600.png` |
| `environment` | `/login`, open environment menu, choose self-hosted, enter `http://invalid.example.test`, activate Save | `auth-environment-invalid-480x600.png` |
| `authenticator` | `/2fa`, untouched authenticator provider | `auth-two-factor-authenticator-480x600.png` |
| `email-two-factor` | `/2fa`, untouched email provider | `auth-two-factor-email-480x600.png` |
| `offline` | `/2fa`, fixed offline error | `auth-offline-480x600.png` |
| `error` | `/2fa`, fixed verification error | `auth-error-480x600.png` |
| `new-device` | `/new-device-verification`, enter `654321` so Continue is enabled | `auth-new-device-enabled-480x600.png` |
| `loading` | `/new-device-verification`, enter `654321`; Continue remains disabled | `auth-new-device-loading-480x600.png` |
| `lock-error` | `/lock`, enter `synthetic-invalid-password`, activate Unlock | `auth-lock-error-480x600.png` |
| `account-switcher` | `/account-switcher`, mixed locked/unlocked accounts | `auth-account-switcher-mixed-locks-480x600.png` |
| `long-text` | `/account-switcher`, long self-hosted hostname visible | `auth-account-switcher-long-text-480x600.png` |
| `light` | `/login`, explicit light theme | `auth-theme-light-480x600.png` |
| `dark` | `/login`, explicit dark theme | `auth-theme-dark-480x600.png` |
| `system-theme` | `/login`, capture after changing macOS appearance once and confirming the app updates without relaunch | `auth-theme-system-change-480x600.png` |

After each capture, stop the current Tauri dev process before launching the next state. Verify the inventory and dimensions:

```bash
find docs/superpowers/specs/assets/ios27-auth-native-2026-08-17 -maxdepth 1 -name 'auth-*-480x600.png' -print | sort
sips -g pixelWidth -g pixelHeight docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/*.png
```

Expected: 16 PNG paths and every normalized image reports 480 × 600. Normalization is a whole-image Retina downsample only; no crop, padding, or aspect-ratio change is allowed.

- [ ] **Step 6: Run Chromium evidence only with explicit user authorization**

Do not start Chromium or run Playwright unless the user has explicitly authorized Chromium for this task. After authorization, inspect the existing authority inventory:

```bash
find docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14 -maxdepth 1 -name 'auth-*-480x600.png' -print | sort
```

Expected: 16 PNG paths. If fewer than 16 exist, run the five exact writer cases only under the same explicit Chromium authorization:

```bash
UPDATE_EVIDENCE=true npx playwright test apps/menubar-tauri/e2e/official-auth-accounts.spec.ts --project=chromium --workers=1 --reporter=line --grep "proves official environment|proves retained authenticator|proves new-device|proves lock error|proves explicit and changing"
```

Expected: 5 tests pass and 16 named 480 × 600 PNGs exist. Never use `authEvidence=master-password` as a direct entry; the first Playwright case enters email then continues to the password phase.

Still under explicit Chromium authorization, run the complete read-only suite:

```bash
UPDATE_EVIDENCE=false npx playwright test apps/menubar-tauri/e2e/official-auth-accounts.spec.ts --project=chromium --workers=1 --reporter=line
```

Expected: all tests pass with exact evidence bytes, one scroll owner, zero horizontal overflow, focus order, Sheet focus restoration, light/dark/system themes, and 480 × 600 geometry.

If Chromium is not authorized, skip every command in this step and record `Chromium evidence: not run — browser not authorized`; the 16 native captures from Step 5 remain the required visual evidence.

- [ ] **Step 7: Stage and commit**

```bash
git add apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/official-account.component.spec.ts
git add -p apps/menubar-tauri/src/styles/global.css
git add -f \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-email-light-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-master-password-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-password-hint-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-environment-invalid-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-two-factor-authenticator-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-two-factor-email-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-offline-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-error-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-new-device-enabled-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-new-device-loading-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-lock-error-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-account-switcher-mixed-locks-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-account-switcher-long-text-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-theme-light-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-theme-dark-480x600.png \
  docs/superpowers/specs/assets/ios27-auth-native-2026-08-17/auth-theme-system-change-480x600.png
git add -f \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-email-light-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-master-password-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-password-hint-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-environment-invalid-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-two-factor-authenticator-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-two-factor-email-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-offline-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-error-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-new-device-enabled-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-new-device-loading-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-lock-error-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-account-switcher-mixed-locks-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-account-switcher-long-text-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-theme-light-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-theme-dark-480x600.png \
  docs/superpowers/screenshots/m3-m4-official-auth-accounts-2026-07-14/auth-theme-system-change-480x600.png
git diff --cached --check
git diff --cached --name-only
git commit -m "style: flatten ios27 account switching"
```

If Step 6 was not authorized or did not rewrite Chromium evidence, omit its second `git add -f` line. Always stage new native PNGs with `git add -f` because the evidence directories are ignored.

## Plan Completion Gate

```bash
npx vitest run apps/menubar-tauri/src/app/auth apps/menubar-tauri/src/app/upstream-overlays/auth/account-switching/auth-account-switching-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/auth/auth-environment-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/auth/lock/auth-lock-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/auth/login/auth-login-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/auth/new-device/auth-new-device-overlay.guard.spec.ts apps/menubar-tauri/src/app/upstream-overlays/auth/two-factor/auth-two-factor-overlay.guard.spec.ts
npm run typecheck:official-login
npm run build:web
```

Expected: all commands exit 0; all six auth overlay guards pass; retained auth manifests and digest constants have no diff; the 16 mapped native PNGs are 480 × 600; all representative routes remain usable with light/dark/system, reduced motion, keyboard-only navigation, and no horizontal overflow.

Only after explicit user authorization for Chromium, append this optional gate:

```bash
UPDATE_EVIDENCE=false npx playwright test apps/menubar-tauri/e2e/official-auth-accounts.spec.ts --project=chromium --workers=1 --reporter=line
```
