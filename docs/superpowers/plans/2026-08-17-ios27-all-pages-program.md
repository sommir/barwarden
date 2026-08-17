# Barwarden iOS 27 All-Pages Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the approved flat, luminous iOS 27 visual language and interaction contract from Vault home to every production route in the 480 × 600 Barwarden popup.

**Architecture:** Preserve Angular page ownership, retained Bitwarden runtimes, Tauri services, guards, and manifests. Implement one shared visual/interaction contract, migrate page families in dependency order, and close with route metadata, accessibility, native visual comparison, full tests, and an independent range review.

**Tech Stack:** Angular 21 standalone components, TypeScript 5.9, Vitest 4, retained Bitwarden overlays, CSS custom properties, Tauri 2/WebKit.

## Global Constraints

- Implement directly on the current `main` branch; do not create a worktree.
- Preserve all unrelated dirty-worktree changes. `global.css`, `app.component.ts`, `app.component.spec.ts`, `app.visual.spec.ts`, `official-i18n.service.ts`, and the recovery manifest are shared hot files; stage only task-owned hunks.
- Do not change authentication, encryption, candidate ranking, native AutoFill, sync, reprompt, or security rules.
- Ordinary pages, groups, fields, and rows are flat and shadowless. Only menus, Sheets, confirmations, and danger dialogs may use 12–16 px radii and one light shadow.
- Keep credential quick actions capability-based and ordered username → password → TOTP; their events must remain isolated from row navigation.
- Use existing PopupPage, PopupHeader, Section/Item, AppBottomSheet, AppFeedback, MacosAlertStrip, router cache, and official icon components.
- Each implementation task follows RED → GREEN → focused review → exact-file commit. Never weaken or bypass retained-overlay guards.
- Do not launch Playwright or another browser until the user has selected that browser. Native Tauri WebKit is the default visual QA surface.

## Execution Order

- [ ] **Phase 1:** Execute [Shared primitives and Settings/Info](./2026-08-17-ios27-shared-settings.md).
- [ ] **Phase 2:** Execute [Authentication and Accounts](./2026-08-17-ios27-auth-account.md).
- [ ] **Phase 3:** Execute [Vault Workflows](./2026-08-17-ios27-vault-workflows.md).
- [ ] **Phase 4:** Execute [Generator and Send](./2026-08-17-ios27-generator-send.md).
- [ ] **Phase 5:** Execute [Global Interaction, Accessibility, and QA](./2026-08-17-ios27-interaction-accessibility-qa.md).
- [ ] **Phase 6:** Run `npm test`, `npm run build:web`, required official typechecks, `git diff --check cfe371a6..HEAD`, and an independent requirements/range review.
- [ ] **Phase 7:** Capture 480 × 600 native representative states, compare each implementation and reference in the same image input, resolve every P0/P1/P2, and set root `design-qa.md` to `final result: passed` only after the matrix is clean.

## Completion Contract

- Every non-redirect production route has one explicit iOS 27 page family and base/secondary layer.
- Five main tabs alone own bottom navigation; all secondary pages have one header, one scroll owner, and deterministic back/focus restoration.
- Light, dark, system, forced-colors, reduced-transparency, reduced-motion, keyboard, and 200% text states pass.
- All retained overlay manifests and guards pass with reviewed hashes.
- All automated tests and the Web build pass from a fresh run.
