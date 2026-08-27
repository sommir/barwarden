# iOS 27 Full Native Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the complete UI harmonization across all 34 production routes, required interaction states, themes, compact mode, and accessibility variants in real 480 × 600 Tauri WebKit.

**Architecture:** Automated gates establish behavior/provenance first. A clean committed-source evidence runtime then drives deterministic route states through existing evidence providers; Computer Use captures AX state and screenshots. Each implementation image is compared with its same-state audit reference in one visual comparison. No browser substitute is accepted.

**Tech Stack:** Vitest, TypeScript, Vite, Tauri/WebKit, repository evidence providers, Computer Use, `sips`, SHA-256 provenance.

**Spec:** `docs/superpowers/specs/2026-08-20-ios27-full-ui-harmonization-design.md`

## Global Constraints

- Final authority is exactly 480 × 600 content pixels, not a decorated 480 × 600 outer window.
- Use a clean committed-source archive/snapshot and document any ignored evidence overlay by exact path and SHA-256.
- Do not use a real password, account, Send body, URL, clipboard secret, or system permission mutation.
- Do not use Chrome, Playwright, browser DOM injection, or synthetic screenshots.
- Use only existing evidence states and route navigation. Capture-only harness changes must be isolated, env-gated, hashed, and excluded from production commits.
- A screenshot is not acceptance by itself: record route, query, AX title/actions, keyboard order, final-row visibility, reference image, implementation image, and defect decision.
- If Computer Use hangs or cannot attach, stop the attempt, clean processes/artifacts, and mark the affected matrix rows BLOCKED/NOT ASSESSED; never call the matrix passed.

---

### Task 1: Run fresh automated preflight and closure idempotence

**Files:**
- Create: `.superpowers/sdd/2026-08-20-ios27-full-ui-harmonization/task-acceptance-report.md`
- Modify only on failure: the owner plan's production/test/manifest files in a separate reviewed fix commit

**Interfaces:**
- Consumes all family commits and exact updater commands.
- Produces a timestamped gate record with command, exit status, test totals, HEAD, tree hash, and dirty overlay inventory.

- [ ] **Step 1: Record source identity and dirty boundary**

Run:

```bash
git rev-parse HEAD
git rev-parse HEAD^{tree}
git status --short --branch
git diff --check
```

Write exact output to the report; do not stage unrelated dirty changes.

- [ ] **Step 2: Run fresh tests/typechecks/build**

```bash
npm test
npm run typecheck:m14
npm run typecheck:official-settings
npm run typecheck:official-generator
npm run typecheck:official-send
npm run typecheck:official-login
npm run typecheck:official-personal
npm run typecheck:official-recovery
npm run build:web
```

Expected: every command exits 0. If a shared dirty overlay breaks a command, repeat from a clean `git archive HEAD` environment with the repository's required ignored evidence files copied by exact path; report both results.

- [ ] **Step 3: Prove all official updaters are byte-idempotent**

Run each command twice in the clean committed-source validation environment:

```bash
npm run update:official-settings-manifest
npm run update:official-settings-runtime-manifest
npm run update:official-generator-manifest
npm run update:official-send-manifest
npm run update:i18n-retained-manifests
```

After each run record `shasum -a 256` for every changed manifest. Expected: first and second output sets are empty and hashes match committed files.

- [ ] **Step 4: Run route and accessibility authority gates**

```bash
npx vitest run apps/menubar-tauri/src/app/app.routes.spec.ts apps/menubar-tauri/src/app/route-shell.guard.spec.ts apps/menubar-tauri/src/app/official-ui/ios27-shared-primitives.visual.spec.ts apps/menubar-tauri/src/app/official-ui/ios27-accessibility.visual.spec.ts apps/menubar-tauri/src/app/official-ui/ios27-production-accessibility.visual.spec.ts
```

Expected: all 34 route cases and all normal/compact/forced-colors/reduced-motion assertions pass.

- [ ] **Step 5: Commit only a reviewed automated fix, or record green**

If a failure exists, return to the owning plan, establish RED/GREEN, commit the fix, rerun Tasks 1–4, and update HEAD in the report. If all gates are green, do not create a code commit for this task.

### Task 2: Build the deterministic native route matrix

**Files:**
- Create: `docs/ui-audit-2026-08-20/implementation/route-matrix.md`
- Create: `docs/ui-audit-2026-08-20/implementation/provenance.md`
- Create: the 34 `route-01-login.png` through `route-34-third-party-licenses.png` files listed in Task 4 Step 4, only through native capture

**Interfaces:**
- Uses existing query keys `authEvidence`, `vaultEvidence`, `sendEvidence`, `settingsEvidence`, and `generatorEvidence`.
- Produces exactly one base screenshot per route plus state screenshots required below.

- [ ] **Step 1: Create the exact 34-route capture table**

Put these rows in `route-matrix.md` with columns Route, Query/entry action, Expected title, Required AX actions, Reference, Implementation, Result:

| Route | Query/entry action |
|---|---|
| `/login` | `?authEvidence=email#/login` |
| `/lock` | `?authEvidence=alternative-unlock-startup#/lock` |
| `/2fa` | `?authEvidence=authenticator#/2fa` |
| `/new-device-verification` | `?authEvidence=new-device#/new-device-verification` |
| `/hint` | `?authEvidence=hint#/hint` |
| `/tabs` | `?vaultEvidence=populated#/tabs` |
| `/tabs/vault` | `?vaultEvidence=populated#/tabs/vault` |
| `/tabs/otp` | `?vaultEvidence=populated#/tabs/otp` |
| `/tabs/generator` | `?vaultEvidence=populated#/tabs/generator` |
| `/tabs/send` | `?sendEvidence=list-populated#/tabs/send` |
| `/tabs/settings` | `?settingsEvidence=settings-main#/tabs/settings` |
| `/account-switcher` | `?authEvidence=account-switcher#/account-switcher` |
| `/vault-settings` | `?settingsEvidence=vault-settings#/vault-settings` |
| `/account-security` | `?settingsEvidence=account-security#/account-security` |
| `/settings-password` | `?settingsEvidence=change-password-handoff#/settings-password` |
| `/autofill` | `?settingsEvidence=one-field-settings#/autofill` |
| `/keyboard-shortcut` | `?settingsEvidence=settings-main#/keyboard-shortcut` |
| `/appearance` | `?settingsEvidence=appearance#/appearance` |
| `/new-item` | `?vaultEvidence=populated#/new-item` |
| `/folders` | `?vaultEvidence=folders-list#/folders` |
| `/archive` | `?vaultEvidence=archive-list#/archive` |
| `/trash` | `?vaultEvidence=trash-list#/trash` |
| `/view-cipher/:id` | `?vaultEvidence=login-workflow-detail-default#/view-cipher/calendar` |
| `/add-cipher` | `?vaultEvidence=login-workflow-form-add#/add-cipher?type=1` |
| `/edit-cipher` | `?vaultEvidence=login-workflow-form-edit#/edit-cipher?cipherId=calendar&type=1` |
| `/clone-cipher` | `?vaultEvidence=login-workflow-form-clone#/clone-cipher?cipherId=calendar&type=1` |
| `/cipher-password-history` | `?vaultEvidence=password-history-populated#/cipher-password-history?cipherId=calendar` |
| `/generator-history` | `?generatorEvidence=history-copy-retry#/generator-history` after the initial retry is resolved |
| `/add-send` | `?sendEvidence=form-add#/add-send?type=text` |
| `/edit-send` | `?sendEvidence=form-edit#/edit-send?sendId=m12-text-send&type=text` |
| `/send-created` | `?sendEvidence=created#/send-created?sendId=m12-text-send&type=text` |
| `/about` | `?settingsEvidence=about#/about` |
| `/third-party-notices` | `?settingsEvidence=about#/third-party-notices` |
| `/third-party-licenses` | `?settingsEvidence=about#/third-party-licenses` |

Before capture, validate every literal query against the matching evidence-state parser spec; if a route-format assertion disagrees, update this table to the exact tested route and commit only the documentation correction.

- [ ] **Step 2: Build one clean capture app identity**

Use the repository's native evidence config and a unique bundle identifier/title derived from HEAD. Any visibility-only harness must:

- be applied only in the clean temporary snapshot;
- set `decorations(false)`, exact 480 × 600 inner size, Regular activation, show, and focus;
- be gated by `VITE_BW_UI_ACCEPTANCE_CAPTURE=true`;
- have its patch SHA-256, compiled binary SHA-256, bundle identifier, and codesign result recorded.

- [ ] **Step 3: Capture all route rows with Computer Use**

For each row:

1. Open the unique app from Finder or exact bundle path.
2. Confirm `sky.list_apps()` returns the unique bundle and `get_app_state` returns a window.
3. Record WebKit URL, AX title, primary actions, Back/tab ownership, and focused element.
4. Capture the screenshot to its exact route filename.
5. Run `sips -g pixelWidth -g pixelHeight` and require 480 × 600.
6. Record SHA-256.
7. Stop the app before building/launching the next query state.

No single Computer Use call may be allowed to block the user without an update for more than 60 seconds. If a call cannot be externally bounded, stop after the first hang and mark remaining rows blocked.

- [ ] **Step 4: Compare same-state reference and implementation**

For each route, provide the original audit screenshot/current approved reference and new implementation screenshot together in the visual comparison input. Record P0/P1/P2 findings for crop, padding, size, hierarchy, radius, shadow, typography, focus, final-row overlap, and theme.

- [ ] **Step 5: Fix all P0/P1 before continuing**

Return each defect to its owner plan, add a real mounted RED test, commit the fix, rerun the family gate, rebuild the exact affected capture state, and replace only that implementation image. P2 defects may remain only with explicit user acceptance.

### Task 3: Run compact, theme, and accessibility matrices

**Files:**
- Modify: `docs/ui-audit-2026-08-20/implementation/route-matrix.md`
- Modify: `docs/ui-audit-2026-08-20/implementation/provenance.md`
- Create: the nine `compact-*` and eighteen `theme-*` PNG files listed in Task 4 Step 4

**Interfaces:**
- Consumes the 34-route base matrix.
- Produces normal/compact, system/light/dark, 200% text, Increased Contrast, Reduced Transparency, Reduced Motion, keyboard, and VoiceOver evidence.

- [ ] **Step 1: Capture normal versus compact on density representatives**

Required routes: Appearance, Generator, Vault populated, OTP populated, Add Cipher, Send list, Add Send, Account Security, Notices. Toggle compact through the real Appearance Switch, record 0→1→0 restoration, and require every interactive owner to remain ≥44px.

- [ ] **Step 2: Capture theme matrix**

Capture System/Light/Dark for Login, Vault, Generator, Send, Settings, and a Sheet. Change theme only through the real Appearance control and restore the original value. Require text, divider, selected, danger, and focus distinctions in every state.

- [ ] **Step 3: Capture system accessibility variants**

Only when the environment permits safe change-and-restore, capture 200% text, Increased Contrast, Reduced Transparency, and Reduced Motion for Header, long form, long document, bottom navigation, menu, Sheet, and alert. Record the original system values before any change and restoration evidence afterward. If safe restoration cannot be proved, mark the row NOT ASSESSED rather than inferring from CSS tests.

- [ ] **Step 4: Record keyboard and VoiceOver evidence**

For every family, record Tab order, visible focus, Escape/Back, overlay trap, and trigger restoration. For VoiceOver, record spoken names/order only through an authorized native VoiceOver control path; AX trees are supporting evidence and cannot be labeled spoken traces. Confirm live regions never expose password, OTP, URL, Send content, notes, or raw IDs.

- [ ] **Step 5: Resolve defects and update provenance**

Every failure follows RED/GREEN in its owner plan. Record before/after screenshot hashes, fix commit, rerun command, and affected matrix rows.

### Task 4: Finalize the acceptance record

**Files:**
- Modify: `design-qa.md`
- Modify: `docs/ui-audit-2026-08-20/README.md`
- Modify: `docs/ui-audit-2026-08-20/implementation/route-matrix.md`
- Modify: `docs/ui-audit-2026-08-20/implementation/provenance.md`
- Modify: `.superpowers/sdd/2026-08-20-ios27-full-ui-harmonization/task-acceptance-report.md`

**Interfaces:**
- Produces final `Design Ready` and `final result` decisions.

- [ ] **Step 1: Audit inventory completeness**

Verify exactly 34 route rows, every required state family, every screenshot link, 480 × 600 dimensions, SHA-256, reference pairing, and result. A script must fail on missing/duplicate routes or unlinked screenshots.

- [ ] **Step 2: Run final fresh gates**

Repeat Task 1 commands from final HEAD and record new totals/hashes.

- [ ] **Step 3: Set the truthful decision**

Set `final result: passed` and `Design Ready: Yes` only if:

- all automated gates exit 0;
- all 34 base routes have valid native evidence;
- compact/theme/accessibility required rows are assessed;
- no P0/P1 remains;
- any P2 is explicitly accepted by the user.

Otherwise set `final result: blocked` or `needs fixes` and list every exact missing row.

- [ ] **Step 4: Stage exact evidence files**

Use exact paths, never screenshot globs:

```bash
git add design-qa.md docs/ui-audit-2026-08-20/README.md docs/ui-audit-2026-08-20/implementation/route-matrix.md docs/ui-audit-2026-08-20/implementation/provenance.md
git add -f \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-01-login.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-02-lock.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-03-2fa.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-04-new-device.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-05-hint.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-06-tabs.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-07-vault.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-08-otp.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-09-generator.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-10-send.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-11-settings.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-12-account-switcher.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-13-vault-settings.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-14-account-security.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-15-settings-password.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-16-autofill.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-17-keyboard-shortcut.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-18-appearance.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-19-new-item.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-20-folders.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-21-archive.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-22-trash.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-23-vault-detail.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-24-add-cipher.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-25-edit-cipher.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-26-clone-cipher.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-27-password-history.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-28-generator-history.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-29-add-send.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-30-edit-send.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-31-send-created.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-32-about.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-33-third-party-notices.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/route-34-third-party-licenses.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/compact-appearance.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/compact-generator.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/compact-vault.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/compact-otp.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/compact-add-cipher.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/compact-send.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/compact-add-send.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/compact-account-security.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/compact-notices.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-light-login.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-dark-login.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-system-login.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-light-vault.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-dark-vault.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-system-vault.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-light-generator.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-dark-generator.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-system-generator.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-light-send.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-dark-send.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-system-send.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-light-settings.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-dark-settings.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-system-settings.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-light-sheet.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-dark-sheet.png \
  docs/ui-audit-2026-08-20/implementation/screenshots/theme-system-sheet.png
git diff --cached --check
```

If a system accessibility variant is safely assessed, add its explicitly named file in a separate exact `git add -f` command using the prefix `a11y-text200-`, `a11y-increased-contrast-`, `a11y-reduced-transparency-`, or `a11y-reduced-motion-`; record the exact name in `route-matrix.md` before staging. Abort if cached names differ from the validated inventory output.

- [ ] **Step 5: Commit final acceptance only when truthful**

```bash
git commit -m "test: accept full ios27 route matrix"
```
