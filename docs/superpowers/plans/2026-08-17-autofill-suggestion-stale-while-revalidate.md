# AutoFill Suggestion Stale-While-Revalidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the current AutoFill suggestions visually stable while an ordinary popup open revalidates them asynchronously, and update the UI only when the visible candidate presentation changes.

**Architecture:** Add a passive-refresh path inside `AutoFillVaultContextService`; the existing initial/explicit entry path stays fail-closed and continues publishing `loading`. Passive refresh stages native and Agent results under the existing epoch guard, blocks selection while staged data is in flight, then atomically commits the new authoritative snapshot with a subscriber notification only when the visible candidate presentation differs.

**Tech Stack:** Angular 20, TypeScript, Vitest, Tauri 2, existing `AutoFillContextSessionService`.

## Global Constraints

- Ordinary vault open must not clear an existing ready suggestion presentation.
- An unchanged visible result must not notify UI subscribers.
- Changed candidates must replace the previous presentation atomically without an intermediate empty state.
- Selection must fail closed during passive revalidation.
- Initial setup, explicit AutoFill entry, lock, account change, navigation invalidation, and unavailable-context behavior must remain fail-closed.
- No UI template or CSS changes.

---

### Task 1: Passive AutoFill Context Refresh

**Files:**
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.spec.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.ts`

**Interfaces:**
- Consumes: `AutoFillVaultContextService.beginFromVaultOpen(): Promise<AutoFillVaultContextState>` and its existing epoch ownership checks.
- Produces: passive refresh semantics for `beginFromVaultOpen()`; private candidate-presentation equality used only to decide whether subscribers need notification.

- [ ] **Step 1: Add the failing pending-refresh test**

Add a test that first establishes `ready`, starts a second `beginFromVaultOpen()` with a deferred `queryAll`, and asserts the prior `ready` snapshot remains visible while `select("login-a")` returns `null` during the pending refresh.

```ts
it("keeps ready suggestions visible but non-actionable during a passive refresh", async () => {
  const next = deferred<readonly ContextualCandidate[]>();
  const harness = createHarness();
  await harness.service.beginFromVaultOpen();
  vi.mocked(harness.contextual.queryAll).mockImplementationOnce(() => next.promise);

  const refresh = harness.service.beginFromVaultOpen();
  await vi.waitFor(() => expect(harness.contextual.queryAll).toHaveBeenCalledTimes(2));

  expect(harness.service.snapshot()).toMatchObject({ status: "ready", candidates: [CANDIDATE] });
  expect(harness.service.select("login-a")).toBeNull();
  next.resolve([CANDIDATE]);
  await refresh;
});
```

- [ ] **Step 2: Run the pending-refresh test and verify RED**

Run: `npx vitest run apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.spec.ts`

Expected: FAIL because the current implementation publishes `{ status: "loading" }` and clears the context session immediately.

- [ ] **Step 3: Add failing notification tests**

Add one test for unchanged candidates expecting zero subscriber calls during and after the passive refresh, and one test with a second candidate expecting exactly one `ready` notification and no `loading` notification.

```ts
const states: string[] = [];
harness.service.subscribe(() => states.push(harness.service.snapshot().status));
await harness.service.beginFromVaultOpen();
expect(states).toEqual([]); // unchanged presentation
```

For the changed case, use a candidate with a different `cipherId` and expect `states` to equal `["ready"]`.

- [ ] **Step 4: Run notification tests and verify RED**

Run: `npx vitest run apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.spec.ts`

Expected: FAIL because the current implementation publishes both `loading` and `ready` on every refresh.

- [ ] **Step 5: Implement passive staging and atomic commit**

In `beginFromVaultOpen()`, detect whether the current state is `ready` and pass that snapshot into `begin` as the passive-refresh baseline. In `begin`, do not clear/publish loading for the passive path. Track the passive epoch so `select` and `selected` reject while that refresh owns the epoch. After all existing validation succeeds, install the new context session and ready snapshot; assign it silently when the visible candidate presentation is equal, otherwise call `publish` once.

Candidate presentation equality must compare ordered `cipherId`, `displayName`, `username`, `group`, `reason`, and ordered `availableFields`. Authorization tokens are deliberately excluded from presentation equality but remain updated in the silently replaced authoritative snapshot.

- [ ] **Step 6: Run the service test and verify GREEN**

Run: `npx vitest run apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.spec.ts`

Expected: all service tests PASS.

- [ ] **Step 7: Run suggestion and App integration tests**

Run: `npx vitest run apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/app.component.spec.ts`

Expected: all tests PASS; no UI template change is required.

### Task 2: Full Verification and Signed Build

**Files:**
- Verify only: all frontend and native test suites.
- Package only: existing `scripts/build-native-autofill-local-smoke.sh` workflow.

**Interfaces:**
- Consumes: completed passive refresh behavior from Task 1.
- Produces: a Developer ID signed `/Applications/Barwarden.app` verified against the built artifact.

- [ ] **Step 1: Run repository consistency and full frontend tests**

Run: `git diff --check`

Run: `npm test`

Expected: no whitespace errors; all non-skipped tests PASS.

- [ ] **Step 2: Build and strictly verify the signed local smoke app**

Use the repository's existing Developer ID smoke build workflow with the configured signing identity and keychain. Require `NATIVE_AUTOFILL_LOCAL_SMOKE_BUILD_PASS`, then run `codesign --verify --deep --strict --verbose=4` in the system signing environment.

- [ ] **Step 3: Install with a recoverable backup and compare hashes**

Quit Barwarden, move the current `/Applications/Barwarden.app` to a unique `/private/tmp/Barwarden-before-stable-suggestions-*.app` backup, copy the verified build into `/Applications`, and confirm the installed `Contents/MacOS/barwarden` SHA-256 equals the build artifact.

- [ ] **Step 4: Verify the real popup behavior**

Open the installed app, unlock by user handoff if required, then use read-only Computer Use inspection to confirm repeated popup opening keeps the suggestion section rendered without an intermediate collapsed state and still replaces candidates after a real foreground-context change.
