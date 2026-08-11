# Vault AutoFill Reference Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle vault-integrated AutoFill suggestions and the contextual detail card to faithfully match the selected Bitwarden-style references while preserving the secure fill pipeline.

**Architecture:** Keep `VaultAutoFillSuggestionsComponent` as the contextual action owner, but replace its custom row markup with official vault item primitives and the existing `VaultItemIconComponent`. Keep the existing context/session/action services unchanged. Update only contextual presentation, its exact DOM contract, visual evidence, and packaging.

**Tech Stack:** Angular standalone components, official Bitwarden UI primitives and BWI icons, CSS tokens, Vitest/TestBed, Product Design browser QA, existing signed local-smoke builder.

## Global Constraints

- Preserve native matching, authorization, reprompt, receipt, and exact-write behavior.
- Never call the retained row's legacy quick-fill output from the contextual suggestion section.
- Use only official components, existing CSS tokens, `VaultItemIconComponent`, and BWI icons.
- Target 480 × 600 CSS px and prevent horizontal overflow from 420–520 px.
- Follow TDD: every production behavior or DOM change must have a focused failing test first.
- No native, entitlement, provider-profile, browser-extension, or production Tauri configuration change.

---

### Task 1: Lock the reference row contract

**Files:**
- Modify: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-autofill-page.component.spec.ts`

**Interfaces:**
- Consumes: the existing ready `AutoFillVaultContextState` and active `VaultItem` fixtures.
- Produces: an executable DOM contract for official item-group composition and secure contextual actions.

- [ ] **Step 1: Add failing DOM tests**

Add assertions that the suggestion section renders `bit-item-group`, one `bit-item` per candidate, `bit-item-content` for detail navigation, `bw-vault-item-icon`, a `bit-item-action` Fill control, and the fixed capability icon order `bwi-user`, `bwi-key`, `bwi-clock`. Assert the section contains no `app-item-more-options`, legacy quick-copy labels, custom left selection bar, or split row border class.

- [ ] **Step 2: Add failing layout and accessibility tests**

Assert one named section/list, one hidden localized capability summary per row, one Fill label containing the Login name, stable DOM order `details -> capabilities -> fill`, and long content using the retained truncation classes. Assert the Fill click performs zero navigation while row-body click performs zero fill.

- [ ] **Step 3: Run focused tests and verify RED**

Run `npm test -- --run apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/vault/vault-autofill-page.component.spec.ts`.

Expected: FAIL because the current component uses custom list/row elements and `bwi-lock` rather than official item primitives and the retained `bwi-key` password glyph.

- [ ] **Step 4: Commit the RED contract**

Stage the two spec files and commit with `test: define autofill reference row contract`.

### Task 2: Recompose suggestions with official vault primitives

**Files:**
- Modify: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.css`
- Modify: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts`

**Interfaces:**
- Consumes: `PopupStateStore`, `VaultItemIconComponent`, official `ItemGroupComponent`, `ItemComponent`, `ItemContentComponent`, `ItemActionComponent`, `ButtonComponent`, and the existing contextual Fill service.
- Produces: the same public `visibleCandidates`, `openDetails`, and `requestFill` behavior with reference-faithful DOM and CSS.

- [ ] **Step 1: Import official item primitives and vault icon**

Add the official item components and `VaultItemIconComponent` to the standalone imports. Resolve each candidate's already-validated local `VaultItem` for icon presentation without exposing secrets in the template.

- [ ] **Step 2: Replace custom row markup**

Render a semantic section header followed by one official item group. Each official item contains a `bit-item-content` details button, the retained 28 px icon slot, name and secondary copy, a read-only capability summary/glyph group, and one compact outlined `填入` action. Keep dialogs outside the list.

- [ ] **Step 3: Replace custom row CSS with retained rhythm**

Use the vault section inset, official group radius and border, 59 px row height, retained primary and secondary typography, `min-width: 0`, ellipsis, and stable trailing tracks. Remove the custom blue left bar and standalone row box shadow. Add only scoped responsive rules required to keep the action visible at 420 px.

- [ ] **Step 4: Run the Task 1 command and verify GREEN**

Expected: all suggestion and page tests pass with unchanged action counts and navigation behavior.

- [ ] **Step 5: Run focused action regressions**

Run `npm test -- --run apps/menubar-tauri/src/app/autofill/autofill-fill-action.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-context-session.service.spec.ts apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts`.

Expected: PASS; contextual action and detail behavior are unchanged.

- [ ] **Step 6: Commit the official-row implementation**

Stage the component, CSS, and spec; commit with `style: match vault autofill reference rows`.

### Task 3: Visual QA, regression, and signed replacement

**Files:**
- Modify: `design-qa.md`
- Replace: `docs/superpowers/specs/2026-08-11-vault-autofill-list.png`
- Replace: `docs/superpowers/specs/2026-08-11-vault-autofill-comparison.png`
- Modify: `docs/superpowers/specs/2026-08-11-vault-integrated-autofill-report.md`

**Interfaces:**
- Consumes: the selected source image and the real Angular vault implementation.
- Produces: passing visual evidence, fresh automated evidence, and one installed signed app.

- [ ] **Step 1: Render the real vault at 480 × 600**

Use the in-app Browser and a temporary deterministic entry that mounts the real `VaultListPageComponent` and production suggestion component. Capture the same light-theme, multi-suggestion state as the source. Delete the temporary entry after capture.

- [ ] **Step 2: Run blocking design QA**

Normalize the source and implementation to 480 × 600, create a 960 × 600 side-by-side comparison, inspect the full view and focused suggestion rows, and update `design-qa.md`. Fix every P0/P1/P2 and repeat capture until `final result: passed`.

- [ ] **Step 3: Run the full regression and build gate**

Run `npx vitest run`, `npm run build:web`, `node --test scripts/native-autofill-contract.spec.mjs`, and `git diff --check` serially.

Expected: zero failures and only documented baseline build warnings.

- [ ] **Step 4: Build and install the signed local version**

Use the existing isolated Developer ID local-smoke builder and Apple Developer ID G2 public certificate chain. Strictly verify the produced app, back up the installed app, replace `/Applications/Barwarden.app`, restart the Agent, register the current Provider path, and verify one installed app, main process, Agent process/socket, and current Provider path.

- [ ] **Step 5: Commit evidence and report**

Force-add the QA ledger and PNG evidence, stage the implementation report, and commit with `docs: verify autofill reference restyle`.

## Self-review

- Spec coverage: reference source, official primitives, row density, action security, accessibility, responsive behavior, detail preservation, visual QA, regression, and signed replacement each have a task.
- Placeholder scan: no TODO, TBD, or unspecified implementation step remains.
- Type consistency: the plan keeps the existing `ContextualCandidate`, `VaultItem`, `AutoFillVaultContextService`, and `AutoFillFillActionService` interfaces unchanged.
