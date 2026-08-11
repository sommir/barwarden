# Vault-integrated AutoFill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the standalone AutoFill destination with a context-aware “自动填充建议” section in the normal vault list and matching AutoFill actions in Login detail, while preserving the native matching, authorization, reprompt, and exact-write security chain.

**Architecture:** A root-provided `AutoFillVaultContextService` becomes the single UI-facing owner of the short-lived native target context, Agent session, ranked candidates, selection, and invalidation epoch. Entry sources initialize that service and navigate to `/tabs/vault`; the vault list renders at most five eligible suggestions, while Login detail consumes the same exact selected candidate binding. `AutoFillFillActionService` remains the only authority that prepares and executes detected-field/form writes.

**Tech Stack:** Angular standalone components and signals/change detection, Vitest + Angular TestBed, existing Bitwarden official UI/BWI icons/tokens, Tauri native host interfaces, Rust/Swift native AutoFill chain (unchanged).

## Global Constraints

- Keep the existing native field detection, encrypted projection, ranking, authorization, mismatch confirmation, reprompt receipts, and exact-write path unchanged.
- Do not add a multi-secret wire response, application-specific adapter, OCR/pixel inspection, Return/Tab submission, browser-extension behavior, entitlement, signing, or production configuration change.
- An ordinary vault open must issue zero AutoFill context, session, or candidate queries.
- Floating action, tray AutoFill, and global shortcut must land on `/tabs/vault`; `/autofill-picker` is compatibility-only and redirects to `/tabs/vault`.
- The suggestion section is absent when there is no valid live context or no eligible match; it never renders an empty-state card and never blocks the normal vault.
- Render at most five candidates in Agent order after eligibility filtering. Preserve native exact/relevant/other ordering and deterministic tie-breaking.
- Fuzzy/name matches may appear only when the native Agent returned them as candidates; they keep `requiresMismatchConfirmation` and may never silently fill.
- Rows use existing official UI tokens and BWI icons. Do not add custom SVG, CSS art, gradients, emoji, or new image assets.
- A generic “填充” action derives the exact username/password/TOTP/form scope from the live native context. Low-confidence `choose` mode does not guess.
- All asynchronous publication and execution must be bound to context, account, generation, revision, candidate, target app/window/field fingerprint, epoch, and 30-second lifetime; stale work burns its session/action and performs no write.
- Detail AutoFill UI is visible only for the exact selected suggestion and exact live route/session/context. Ordinary detail browsing and pop-out windows do not show it.
- Preserve existing mismatch confirmation and reprompt UI; never expose plaintext secrets to Angular.
- Use TDD for every behavior change: observe the intended RED before editing production code.

---

### Task 1: Create the vault-scoped contextual AutoFill state owner

**Files:**
- Create: `apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.spec.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-context-session.service.ts`
- Test: `apps/menubar-tauri/src/app/autofill/autofill-context-session.service.spec.ts`

**Interfaces:**
- Consumes: `AutoFillNativeHost.entryContext()`, `AutoFillNativeHost.agentSession()`, `AutoFillContextualCandidatesService.queryAll(context, session, query)`, `AutoFillContextSessionService.begin(...)`, `AutoFillSetupService.enableFromEntry()`.
- Produces:

```ts
export type AutoFillVaultContextState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly epoch: number }
  | {
      readonly status: "ready";
      readonly epoch: number;
      readonly context: LiveAutoFillContext;
      readonly session: AutoFillAgentSession;
      readonly candidates: readonly ContextualCandidate[];
    }
  | { readonly status: "unavailable"; readonly reason: "setup" | "context" | "session" | "account" };

@Injectable({ providedIn: "root" })
export class AutoFillVaultContextService {
  snapshot(): AutoFillVaultContextState;
  subscribe(listener: () => void): () => void;
  beginFromEntry(): Promise<AutoFillVaultContextState>;
  select(cipherId: string): ContextualCandidate | null;
  selected(cipherId: string): { context: LiveAutoFillContext; session: AutoFillAgentSession; candidate: ContextualCandidate } | null;
  invalidate(reason?: "navigation" | "target" | "lock" | "account" | "cancel" | "destroy"): void;
}
```

- `AutoFillContextSessionService.navigationChanged(url)` must retain context on `/tabs/vault` and exact `/view-cipher/:id` only; all other routes clear it.

- [ ] **Step 1: Write failing state-owner tests**

Add tests proving:

```ts
it("publishes immutable top-level state only after setup, context, session, owner, and all field queries agree");
it("keeps ordinary construction idle and performs zero native calls");
it("drops a late candidate result when entry context changes in flight");
it("drops a late candidate result when account, generation, or revision changes in flight");
it("invalidates and burns the old selected candidate on replacement, lock, account change, cancel, and expiry");
it("returns an exact selected candidate binding only while the session is live");
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm test -- --run apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-context-session.service.spec.ts
```

Expected: FAIL because `AutoFillVaultContextService` does not exist and `/tabs/vault` currently invalidates the session.

- [ ] **Step 3: Implement the minimal immutable state owner**

Implement one monotonic `epoch`, one frozen state value, and a listener set. In `beginFromEntry()`:

```ts
const epoch = this.beginOperation();
const setup = await this.setup.enableFromEntry();
if (!this.owns(epoch) || setup !== "ready") return this.fail(epoch, "setup");
const entry = await this.native.entryContext();
const session = await this.native.agentSession();
// Strictly decode, verify active vault owner, query all fields, then re-read
// entry/session before publishing. Every failed comparison invalidates.
```

Use existing strict projection helpers. Store no plaintext and no local vault Login objects. On ready publication, call `contextSession.begin(context, session, candidates)`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS with no unhandled promise rejection.

- [ ] **Step 5: Commit the state-owner slice**

```bash
git add apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.ts apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-context-session.service.ts apps/menubar-tauri/src/app/autofill/autofill-context-session.service.spec.ts
git commit -m "refactor: expose vault autofill context"
```

### Task 2: Move every AutoFill entry source to the normal vault route

**Files:**
- Modify: `apps/menubar-tauri/src/app/app.component.ts`
- Modify: `apps/menubar-tauri/src/app/app.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/app.routes.ts`
- Modify: `apps/menubar-tauri/src/app/app.routes.spec.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts`
- Test: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts`

**Interfaces:**
- Consumes: `AutoFillVaultContextService.beginFromEntry()` from Task 1.
- Produces: `AppComponent.openAutoFillInVault(): Promise<void>` and a route-level redirect from `autofill-picker` to `tabs/vault`.

- [ ] **Step 1: Write failing entry and routing tests**

Add tests proving:

```ts
it("floating, tray AutoFill, and shortcut initialize context then replace-navigate to /tabs/vault");
it("does not navigate when setup/context initialization is unavailable");
it("ordinary vault restoration never calls beginFromEntry");
it("redirects /autofill-picker to /tabs/vault without instantiating the picker");
```

- [ ] **Step 2: Run the focused entry tests and verify RED**

Run:

```bash
npm test -- --run apps/menubar-tauri/src/app/app.component.spec.ts apps/menubar-tauri/src/app/app.routes.spec.ts
```

Expected: FAIL because current entry code navigates to `/autofill-picker`.

- [ ] **Step 3: Implement the route migration**

Replace `openAutoFillPicker()` with `openAutoFillInVault()`:

```ts
private async openAutoFillInVault(): Promise<void> {
  const state = await this.autoFillVaultContext.beginFromEntry();
  if (state.status !== "ready") return;
  await this.router.navigateByUrl("/tabs/vault", { replaceUrl: true });
}
```

Change `app.routes.ts` to `{ path: "autofill-picker", redirectTo: "tabs/vault", pathMatch: "full" }` and remove its component import. Leave the old component source temporarily for regression coverage and later deletion; no production route may instantiate it.

- [ ] **Step 4: Run focused entry tests and verify GREEN**

Run the Step 2 command plus the existing picker spec. Expected: PASS; old picker behavior remains testable but unreachable from production routes.

- [ ] **Step 5: Commit the entry migration**

```bash
git add apps/menubar-tauri/src/app/app.component.ts apps/menubar-tauri/src/app/app.component.spec.ts apps/menubar-tauri/src/app/app.routes.ts apps/menubar-tauri/src/app/app.routes.spec.ts
git commit -m "feat: open autofill in the vault"
```

### Task 3: Build the reusable vault suggestion section

**Files:**
- Create: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.ts`
- Create: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.css`
- Create: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/official-i18n.service.spec.ts`

**Interfaces:**
- Consumes: `AutoFillVaultContextService.snapshot/subscribe/select`, `AutoFillFillActionService.prepare/execute/cancel`, `PopupStateStore.snapshot().items`, existing `VaultRepromptDialogComponent`, and existing mismatch confirmation presentation.
- Produces:

```ts
@Component({ selector: "bw-vault-autofill-suggestions", standalone: true })
export class VaultAutoFillSuggestionsComponent implements OnDestroy {
  readonly visibleCandidates: readonly ContextualCandidate[]; // eligible first five
  openDetails(candidate: ContextualCandidate): Promise<void>;
  fill(candidate: ContextualCandidate): Promise<void>;
}
```

- [ ] **Step 1: Write failing projection and DOM tests**

Add tests proving:

```ts
it("renders no host content for idle, loading before anti-flicker, unavailable, or zero eligible candidates");
it("renders an 自动填充建议 heading, accessible count, and at most five candidates in Agent order");
it("keeps exact, relevant, and native fuzzy candidates while hiding missing-field and invalid local Login rows");
it("shows bwi-user, bwi-lock, and bwi-clock capability icons in canonical order without making them controls");
it("uses a generic 填充 button whose accessible name includes the Login name");
it("keeps one continuous hover, focus-within, keyboard-highlight, and selected surface without split borders");
it("opens exact Login detail from the row body without executing fill");
it("prepares the native detected scope and never guesses in choose mode");
it("requires confirmation for mismatch candidates and uses the existing reprompt flow");
it("burns an in-flight action when target/session/context changes or the component is destroyed");
```

- [ ] **Step 2: Run the component spec and verify RED**

Run:

```bash
npm test -- --run apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts
```

Expected: FAIL because the component is missing.

- [ ] **Step 3: Implement the suggestion projection and template**

Filter only live candidates whose `cipherId` resolves to one active local Login owned by the Agent account and whose detected required fields are present in `candidate.availableFields`. Slice after filtering:

```ts
return Object.freeze(state.candidates
  .filter((candidate) => this.isEligible(candidate, state))
  .slice(0, 5));
```

Render a semantic section/list. Use `bwi-globe` or the existing retained favicon/type component for the item icon, existing BWI capability icons, and official button/focus tokens. The row body is one button-like detail target; trailing `填充` is a separate button with event propagation stopped. Do not introduce a second page header, target-app card, search box, or field switcher.

- [ ] **Step 4: Implement action state using existing security services**

For generic fill:

```ts
const binding = this.context.select(candidate.cipherId);
const localLogin = this.resolveLogin(binding);
const prepared = this.fillActions.prepare(binding.context, binding.session, binding.candidate);
```

Handle only `ready`; `choose` is fail-closed with fixed “无法确定要填入的字段” feedback. For `confirmation-required` and `reprompt-required`, reuse the existing fixed confirmation and reprompt components. On success, record the existing binding/history event, invalidate context, and close/hide through the established popup behavior.

- [ ] **Step 5: Add exact localized strings**

Add fixed Chinese/English keys for section title, candidate count announcement, generic fill accessible label, no-confident-field feedback, and retained native reason labels. Do not display raw Agent reason strings.

- [ ] **Step 6: Run component and i18n tests and verify GREEN**

Run:

```bash
npm test -- --run apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/official-ui/official-i18n.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the suggestion component**

```bash
git add apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.ts apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.css apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts apps/menubar-tauri/src/app/official-ui/official-i18n.service.spec.ts
git commit -m "feat: add vault autofill suggestions"
```

### Task 4: Integrate suggestions into the retained vault hierarchy

**Files:**
- Modify: `apps/menubar-tauri/src/app/vault/vault-list-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/app.visual.spec.ts`
- Modify: `apps/menubar-tauri/src/app/styles.css`

**Interfaces:**
- Consumes: `<bw-vault-autofill-suggestions />` from Task 3.
- Produces: the normal vault list layout with optional suggestions between root search/filter controls and favorites/all-items hierarchy.

- [ ] **Step 1: Replace the old absence contract with failing integration tests**

Add tests proving:

```ts
it("keeps the ordinary vault DOM unchanged and makes zero AutoFill calls without an entry context");
it("places suggestions above favorites/all items when live matches exist");
it("removes the entire section when candidate results become empty or stale");
it("keeps vault search results and AutoFill suggestions as separate, nonduplicated regions");
it("does not replace loading, unavailable, empty-vault, or sync-warning behavior");
```

Delete assertions whose intended behavior was “the vault must never show AutoFill suggestions.”

- [ ] **Step 2: Run vault integration specs and verify RED**

Run:

```bash
npm test -- --run apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/app.visual.spec.ts
```

Expected: FAIL because the suggestion component is not mounted.

- [ ] **Step 3: Mount the section without disturbing retained hierarchy**

Import `VaultAutoFillSuggestionsComponent` and render it only in the ready vault branch, before the existing search sections/hierarchy. Keep the suggestion component self-hiding, so the parent does not duplicate eligibility logic. Add only spacing hooks required to align with retained list containers.

- [ ] **Step 4: Run vault integration specs and verify GREEN**

Run the Step 2 command. Expected: PASS across compact/light/dark evidence states.

- [ ] **Step 5: Commit vault integration**

```bash
git add apps/menubar-tauri/src/app/vault/vault-list-page.component.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/app.visual.spec.ts apps/menubar-tauri/src/app/styles.css
git commit -m "feat: integrate autofill with vault list"
```

### Task 5: Bind Login detail AutoFill to the vault-selected suggestion

**Files:**
- Modify: `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-view/login/official-login-credentials.component.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-view/login/official-login-credentials.component.spec.ts`

**Interfaces:**
- Consumes: `AutoFillVaultContextService.selected(routeCipherId)` and existing `AutoFillFillActionService`.
- Produces: a detail-level full-width “自动填充” action and contextual field icons limited to the native detected scope.

- [ ] **Step 1: Write failing detail contracts**

Add tests proving:

```ts
it("shows AutoFill only for the exact selected suggestion, exact route, active account/generation/revision, main popup, and live target context");
it("hides AutoFill for ordinary detail browsing, popout, another cipher, expired context, lock, account switch, revision change, and A→B→A navigation");
it("shows only username/password/TOTP field actions present in both native scope and candidate authorization");
it("executes the full detected action from the primary button and one detected field from a field icon");
it("cancels an in-flight action and burns a late reprompt receipt on route change, back, destroy, or context invalidation");
```

- [ ] **Step 2: Run detail specs and verify RED**

Run:

```bash
npm test -- --run apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-view/login/official-login-credentials.component.spec.ts
```

Expected: FAIL where current detail reads the old picker session rather than the vault context service and where the new primary layout is absent.

- [ ] **Step 3: Implement exact detail binding**

On route/item refresh, read `selected(cipherId)` and then revalidate native entry/session after each await before publishing the card. Use a detail-local epoch and cancel the prior prepared action before replacing presentation. Never recreate a candidate from the vault item; use the selected projected candidate only.

- [ ] **Step 4: Implement primary and field actions in the official Login composition**

Render the full-width primary action inside the existing Login card, with BWI user/lock/clock field actions only for the valid intersection. Reuse the same mismatch and reprompt flows as Task 3. Preserve ordinary reveal/copy/edit behavior.

- [ ] **Step 5: Run detail specs and verify GREEN**

Run the Step 2 command. Expected: PASS with no late fill after route invalidation.

- [ ] **Step 6: Commit detail integration**

```bash
git add apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-view/login/official-login-credentials.component.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-view/login/official-login-credentials.component.spec.ts
git commit -m "feat: integrate autofill with login details"
```

### Task 6: Remove standalone picker ownership and close lifecycle gaps

**Files:**
- Delete: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts`
- Delete: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.css`
- Delete: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-context-session.service.ts`
- Modify: `apps/menubar-tauri/src/app/app.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-list-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/recovery/recovery-runtime.manifest.json`

**Interfaces:**
- Consumes: Task 1–5 production flows.
- Produces: no standalone picker production code; all context ownership and invalidation are vault/detail scoped.

- [ ] **Step 1: Write lifecycle regression tests before deleting picker code**

Add cross-component tests proving:

```ts
it("burns context on popup close, non-vault navigation, lock, logout, account switch, revision replacement, target change, and expiry");
it("keeps context across /tabs/vault -> exact /view-cipher/:id -> /tabs/vault only while the same selected binding is live");
it("never republishes suggestions or detail actions from late initialization, query, mismatch, reprompt, or fill completion");
```

- [ ] **Step 2: Run lifecycle tests and verify RED for any uncovered path**

Run the focused app, context, vault-list, and detail specs. Each new regression must fail for the lifecycle path it covers before production changes.

- [ ] **Step 3: Wire invalidation at authoritative lifecycle points**

Call `AutoFillVaultContextService.invalidate(...)` from existing lock/logout/account/navigation/popup close hooks rather than creating component-local guesses. Ensure every invalidation reaches `AutoFillContextSessionService`, which in turn cancels all active fill actions.

- [ ] **Step 4: Delete standalone picker files and update recovery hashes**

Remove only after route and all consumers no longer import the component. Update exact recovery manifest hashes using the repository updater; do not widen recovery closure or add an allowlist exception.

- [ ] **Step 5: Run focused lifecycle and guard tests and verify GREEN**

Run:

```bash
npm test -- --run apps/menubar-tauri/src/app/app.component.spec.ts apps/menubar-tauri/src/app/app.routes.spec.ts apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-context-session.service.spec.ts apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/recovery/recovery-runtime-manifest.spec.ts
```

Expected: PASS and `rg "AutoFillPickerComponent|bw-autofill-picker" apps/menubar-tauri/src/app` returns no production match.

- [ ] **Step 6: Commit lifecycle cleanup**

```bash
git add -A apps/menubar-tauri/src/app
git commit -m "refactor: remove standalone autofill picker"
```

### Task 7: Full regression, rendered design QA, and signed local handoff

**Files:**
- Create: `docs/superpowers/specs/2026-08-11-vault-integrated-autofill-design-qa.md`
- Create: `docs/superpowers/specs/2026-08-11-vault-integrated-autofill-implementation.png`
- Create: `docs/superpowers/specs/2026-08-11-vault-integrated-autofill-comparison.png`
- Modify: `docs/superpowers/specs/2026-08-11-vault-integrated-autofill-design.md` only if implementation reveals a corrected factual constraint.

**Interfaces:**
- Consumes: completed feature and the three selected reference screenshots supplied by the user.
- Produces: passing automated gates, same-state rendered evidence, design-QA report with `final result: passed`, and a signed local application replacement only after automated verification.

- [ ] **Step 1: Run the focused AutoFill and vault suites serially**

Run all AutoFill context/candidate/action/setup, app entry/route, vault list, detail, overlay, i18n, accessibility, and recovery specs. Expected: all PASS.

- [ ] **Step 2: Run full web and native regression gates**

Run serially:

```bash
cargo fmt --check --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml
cargo check --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml
npm test -- --run
npm run build:web
git diff --check
```

Run the existing unsigned Xcode AutoFill suite if Swift/protocol files changed; otherwise record that native sources were unchanged and rely on the fresh Rust/full-web gates plus the last known native baseline.

- [ ] **Step 3: Render the real Angular states at 480×600**

Use the repository’s existing deterministic browser harness pattern to render:

1. Vault with one exact suggestion above favorites/all items.
2. Vault with five suggestions and scrolling retained below.
3. Vault with no match, proving the section is absent.
4. Login detail with the selected exact candidate and AutoFill primary action.

Do not commit the temporary harness. Capture the real component, not a manually redrawn HTML mock.

- [ ] **Step 4: Run blocking design QA against the selected references**

Open the selected reference images and implementation captures at the same viewport/state. Create a combined comparison image and inspect hierarchy, retained row geometry, section spacing, typography, icons, continuous hover/focus surface, button placement, scrolling, detail action placement, light/dark tokens, high contrast, keyboard focus, and console warnings/errors. Fix every P0/P1/P2 issue and repeat until the QA report contains:

```md
final result: passed
```

- [ ] **Step 5: Build and replace the signed local smoke app**

Use the already-approved isolated signing Keychain workflow and local-only builder. Verify the installed app’s Team ID and designated requirements, replace only the prior local smoke build, retain a recoverable previous copy until launch succeeds, and grant permissions only to that stable signed identity. Do not notarize, staple, build a DMG, or promote production evidence.

- [ ] **Step 6: Perform a bounded macOS 26 interaction smoke**

On dedicated non-production Login data, verify:

- Floating pill opens the normal vault with suggestions.
- Exact and fuzzy candidates order correctly; fuzzy requires confirmation.
- Generic Fill uses detected username/password/TOTP/form scope.
- Row body opens detail and detail AutoFill works.
- No-match vault is unchanged.
- Target/focus/route changes invalidate and produce no late write.

Record only redacted outcomes; never capture or log passwords, TOTP seeds/codes, master-password values, private keys, or raw secret frames.

- [ ] **Step 7: Final commit**

```bash
git add docs/superpowers/specs/2026-08-11-vault-integrated-autofill-design-qa.md docs/superpowers/specs/2026-08-11-vault-integrated-autofill-implementation.png docs/superpowers/specs/2026-08-11-vault-integrated-autofill-comparison.png
git commit -m "test: verify vault-integrated autofill"
```

