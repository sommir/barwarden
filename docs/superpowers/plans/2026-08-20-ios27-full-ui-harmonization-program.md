# Barwarden Full UI Harmonization Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply one compact, flat, iOS 27–inspired visual and interaction contract to all 34 Barwarden production routes without changing product capability, security, or retained-overlay ownership.

**Architecture:** Establish semantic geometry tokens and shared shell primitives first, then migrate each independent route family against real mounted DOM. Retained Bitwarden templates continue through their existing transform/manifest pipelines; page-local CSS is removed only after shared semantic roles cover the production hierarchy. Native 480 × 600 WebKit comparison closes the program.

**Tech Stack:** Angular 21 standalone components, TypeScript 5.9, Vitest 4/jsdom, CSS custom properties, retained Bitwarden overlays and SHA-256 manifests, Tauri 2/WebKit.

**Spec:** `docs/superpowers/specs/2026-08-20-ios27-full-ui-harmonization-design.md`

## Global Constraints

- Work directly on `main`; do not create a worktree.
- Preserve every unrelated dirty-worktree change. Use `apply_patch`; use exact-path staging for clean files and `git add -p` for `global.css`, `app.visual.spec.ts`, `app.component.ts`, retained manifests, and any file already modified before the task.
- Minimum interactive owner is 44 × 44px in normal and compact modes.
- Header and bottom navigation are exactly 52px visible height.
- Single-line rows are 44px; double-line rows are 48px normal and 44px compact.
- Visible inputs, selects, segmented controls, and filled buttons are 40px normal and 36px compact inside 44px interactive/layout owners.
- Visible icon plates are 32px normal and 28px compact inside transparent 44px owners.
- Page horizontal inset is 16px; semantic group gaps are 20px normal and 16px compact.
- Ordinary page, list, form, and settings surfaces are flat and shadowless. Only menus, Sheets, confirmations, and danger overlays retain shaped material and a light shadow.
- Keep exactly one filled primary action per page/region. Preserve username → password → TOTP quick actions, capability gating, semantic colors, and item-plus-field accessible names.
- Preserve routing, transient Back, dirty-form confirmation, focus restoration, overlay stack, status ownership, security, clipboard, sync, reprompt, and stale-result behavior.
- Do not add routes, a new UI library, approximate icons, placeholder assets, or browser-only QA.
- Every production change follows RED → GREEN → focused regression → strict typecheck/build → exact commit.
- Native Tauri WebKit is the visual authority. Browser/Playwright may be used only after explicit user authorization.

---

## File and Ownership Map

| Plan | Production ownership | Guarded/generated ownership |
|---|---|---|
| Foundation and shell | `macos-tokens.css`, `global.css`, Popup Header/Page/Footer, tab switcher | official shared component behavior guard when menu timing changes |
| Settings | Settings route components and retained Settings runtime | source patches → generated authority → runtime patches → transform/runtime manifests |
| Generator | Generator route/history owners | member/template transforms → Generator manifest and exact closure guard |
| Vault and OTP | Vault/OTP page owners, retained Vault list/detail/forms | retained Vault member/template transforms and recovery manifests |
| Send | Send route/form owners | static HTML transforms, bounded TS/HTML patches, Send manifest |
| Auth | Auth route owners and retained Auth presentation | per-family transforms/manifests and exact auth guards |
| Documents/About | About/update plus notice/license readers | Settings/About retained transforms where touched |
| Acceptance | evidence providers, visual specs, audit/provenance docs | no production transform ownership |

## Execution Order

- [ ] **Phase 1:** Execute [Foundation and Shell](./2026-08-20-ios27-foundation-shell.md).
- [ ] **Phase 2:** Execute [Settings](./2026-08-20-ios27-settings.md).
- [ ] **Phase 3:** Execute [Generator](./2026-08-20-ios27-generator.md).
- [ ] **Phase 4:** Execute [Vault and OTP](./2026-08-20-ios27-vault-otp.md).
- [ ] **Phase 5:** Execute [Send](./2026-08-20-ios27-send.md).
- [ ] **Phase 6:** Execute [Authentication and Accounts](./2026-08-20-ios27-auth.md).
- [ ] **Phase 7:** Execute [Documents and About](./2026-08-20-ios27-documents-about.md).
- [ ] **Phase 8:** Execute [Full Native Acceptance](./2026-08-20-ios27-native-acceptance.md).

## Dirty-worktree updater protocol

Every task that runs an official updater uses this exact sequence; updater commands must never read
unrelated working-tree hunks such as the current AutoFill/i18n work:

1. Stage only the task's non-manifest files and exact hot-file hunks. Confirm
   `git diff --cached --name-only` is a subset of the task's **Files** list.
2. Create a clean source snapshot from `HEAD`, then apply only the staged task delta:

   ```bash
   task_snapshot=$(mktemp -d /private/tmp/barwarden-ios27-update.XXXXXX)
   git archive HEAD | tar -x -C "$task_snapshot"
   git diff --cached --binary | git -C "$task_snapshot" apply -
   ln -s "$(pwd)/node_modules" "$task_snapshot/node_modules"
   ```

3. Run the task's updater inside `"$task_snapshot"` twice. The second run must leave every updater
   output byte-identical. Use `shasum -a 256` and `diff -u` to compare each named output with the
   worktree.
4. Apply only the updater-owned diff to the named manifest/patch/runtime output with `apply_patch`,
   then stage that exact hunk with `git add -p`. Do not copy a whole manifest over a dirty worktree.
5. Recreate the snapshot from the final staged index and rerun the updater once. Require zero diff,
   run the exact guard, and only then commit.

If a clean updater exposes a stale closure member outside the task's **Files** list, stop that commit
and create a separate owner follow-up plan/commit; do not silently widen the visual task.

## Spec Coverage

| Design specification section | Implementation owner |
|---|---|
| Shared geometry, typography, color | Foundation Tasks 1 and 4; family computed-style tests |
| Header, scroll region, bottom navigation | Foundation Tasks 2 and 3 |
| Continuous groups and forms | Foundation Task 1; Settings Task 1; Vault Task 4; Send Task 2 |
| Auth | Auth Tasks 1–4 |
| Vault and OTP | Vault/OTP Tasks 1–4 |
| Generator | Generator Tasks 1–3 |
| Send | Send Tasks 1–3 |
| Settings | Settings Tasks 1–4 |
| Document and About | Documents/About Tasks 1–3 |
| Pointer, keyboard, motion, feedback | Foundation Task 4 plus every family behavior gate |
| Accessibility variants | Foundation Task 4 and Native Acceptance Task 3 |
| Retained provenance and dirty worktree | Every family staging/updater step and Native Acceptance Task 1 |
| Final 34-route matrix | Native Acceptance Tasks 2–4 |

## Program Checkpoints

### Checkpoint A: Shared contract is stable

- [ ] Foundation tests prove visible geometry separately from hit geometry in normal and compact modes.
- [ ] Header, scroll region, and bottom navigation own all safe-area calculations.
- [ ] Focus-visible has one 2px owner ring; pointer focus does not paint a persistent ring.
- [ ] `npm run build:web` passes before family work begins.

### Checkpoint B: Route families are independently shippable

- [ ] Each family passes its focused component/visual suites and exact retained guards.
- [ ] Each retained updater is run twice in a clean staged-index snapshot; second output is byte-stable.
- [ ] Each task is an independent commit; no family waits on an uncommitted `global.css` hunk.
- [ ] The 34-route authority still maps every component route to exactly one family and layer.

### Checkpoint C: Final completion

- [ ] `npm test` passes from the current workspace and a clean committed-source validation environment; any infrastructure-only deviation is documented without calling it green.
- [ ] `npm run typecheck:m14` and all relevant official typechecks pass.
- [ ] `npm run build:web` passes.
- [ ] Every official updater is byte-idempotent and every closure guard is green.
- [ ] All 34 routes receive fresh 480 × 600 native WebKit evidence in normal mode; compact/theme/accessibility matrices cover the state families in the design spec.
- [ ] Reference and implementation images are compared together at the same viewport and state.
- [ ] `design-qa.md` changes to `final result: passed` only when no P0/P1 remains and all unassessed states are resolved.

## Commit Sequence

Use these commit subjects in order unless a RED finding requires a narrowly named follow-up:

```text
style: separate ios27 visible and hit geometry
style: compact ios27 popup shell
style: harmonize ios27 settings
style: harmonize ios27 generator
style: harmonize ios27 vault and otp
style: harmonize ios27 send
style: harmonize ios27 authentication
style: harmonize ios27 documents and about
test: accept full ios27 route matrix
```

Never amend a reviewed commit on `main`; add a follow-up commit for review fixes.

## Plan Self-review Record

Validated on 2026-08-20 before implementation:

- all 34 component routes from `app.routes.ts` occur in the program or a family plan; redirects and
  the wildcard are correctly excluded from the page count;
- all referenced existing source/test/guard paths exist; the five absent paths are explicitly marked
  **Create** (`document-search*` and `settings-password-page.component.spec.ts`);
- every `npm run` command exists in the root package scripts;
- all Markdown code fences are balanced and no undefined convenience test helper remains;
- native queries match the committed evidence-state parser/harness literals, except Generator History
  intentionally uses the richer valid `history-copy-retry` scenario;
- retained manifests are staged only by hunk after clean-index updater verification; no screenshot,
  source directory, or dirty manifest glob is staged;
- each production task contains a real mounted RED assertion, exact implementation shape, GREEN gate,
  typecheck/build boundary, and an independent commit command.
