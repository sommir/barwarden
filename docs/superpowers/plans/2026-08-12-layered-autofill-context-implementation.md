# Layered AutoFill Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show application-ranked AutoFill suggestions whenever a live frontmost application is known, while exposing direct Fill only when an exact writable field/form context is validated and retaining explicit username/password/TOTP actions.

**Architecture:** Split the existing flattened native entry result into an always-usable application context plus an optional, short-lived fill capability. Candidate query and session ownership bind to the application context; native fill authorization continues to bind to the optional AX context. Explicit field actions use the same candidate authorization and either fill the exact focused field or copy when no fill capability exists.

**Tech Stack:** Rust/Tauri 2, macOS Accessibility/AppKit, Angular standalone components/signals, Swift Agent IPC, Vitest, Cargo test, XCTest, Developer ID local-smoke signing.

## Global Constraints

- Application matching never depends on successful AX field capture.
- Exact application instance, PID, window, field identity, observer generation, account, projection generation, vault revision, candidate, and requested field remain fail-closed.
- AX reads remain restricted to the existing semantic/geometry allowlist; never read AXValue, pixels, OCR, or selected text content.
- Never press Return/Tab, click submit, invoke AXPress, or add application-specific adapters.
- Field-specific actions expose only one username/password/TOTP value per authorization.
- A missing fill capability copies after authorization; it never performs an unbound paste.
- macOS deployment target remains 13.0 and production configuration/entitlements remain unchanged.

---

### Task 1: Native Application Context Independent of AX Fill Capture

**Files:**
- Modify: `apps/menubar-tauri/src-tauri/src/frontmost.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_ax_context.rs`
- Test: inline `frontmost::tests` and `autofill_ax_context::tests`

**Interfaces:**
- Produces: `AutoFillApplicationContext { bundle_id, app_name }`
- Produces: `AutoFillEntryContextOutcome::Available { application, fill_context: Option<FillContextPresentation> }`
- Preserves: `DetectedFillContextStore::try_insert(...) -> Result<FillContextPresentation, DetectedFillError>`

- [ ] **Step 1: Write failing native outcome tests**

Add tests proving an exact live `FrontmostApp` serializes as available even when capture returns `AxContextError::NoWritableField`, and proving a valid field serializes the same application plus `fillContext`.

```rust
assert_eq!(
    entry_context_with(Some(target), None, |_| true),
    AutoFillEntryContextOutcome::Available {
        application: AutoFillApplicationContext {
            bundle_id: "com.example.target".into(),
            app_name: "Example".into(),
        },
        fill_context: None,
    },
);
```

- [ ] **Step 2: Run the RED test**

Run: `cargo test frontmost::tests -- --nocapture`

Expected: FAIL because the current outcome maps missing fill context to `Unavailable`.

- [ ] **Step 3: Implement the layered native result**

Refactor `autofill_entry_context` and `autofill_context_with` so target liveness decides application availability and `FillContextPresentation` is optional. Keep the target stored before popup presentation. Retain the bounded three-attempt `StaleGeneration` retry, but do not retry permanent AX or store validation errors.

```rust
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoFillApplicationContext {
    bundle_id: String,
    app_name: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum AutoFillEntryContextOutcome {
    Available {
        application: AutoFillApplicationContext,
        #[serde(skip_serializing_if = "Option::is_none")]
        fill_context: Option<FillContextPresentation>,
    },
    Unavailable,
}
```

- [ ] **Step 4: Add explicit focused-field binding support**

Add `DetectedFillContextStore::take_explicit(token, requested_field)` which requires exactly one requested field, consumes the token, revalidates the exact target/window/focused field/generation, and returns a `CapturedFillPlan` bound only to the focused field. It must not infer or broaden a form action.

```rust
pub(crate) fn take_explicit(
    &self,
    token: &str,
    requested: AutoFillSecretField,
) -> Result<CapturedFillPlan, DetectedFillError>;
```

Test password-explicit-on-username-focus success, duplicate/replay failure, target/window/focus/generation mismatch failure, and rejection of more than one explicit field.

- [ ] **Step 5: Run focused native tests and commit**

Run: `cargo test frontmost::tests -- --nocapture`

Run: `cargo test autofill_ax_context::tests -- --nocapture`

Expected: PASS.

Commit files from this task with message: `feat: separate autofill application and field contexts`.

---

### Task 2: Strict Frontend Layered Context and Application Candidate Session

**Files:**
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-native.host.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-fill-context.model.ts`
- Modify: `apps/menubar-tauri/src/host/tauri-host.service.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-contextual-candidates.service.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-context-session.service.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.ts`
- Test: matching `*.spec.ts` files beside each service

**Interfaces:**
- Consumes: native `application` plus optional `fillContext`
- Produces: `AutoFillApplicationContext { bundleId, appName }`
- Produces: `LayeredAutoFillContext { application, fillContext: LiveAutoFillContext | null }`
- Produces: ready vault state containing application, optional fill context, Agent session, and candidates

- [ ] **Step 1: Write strict decoder RED tests**

Cover application-only, application+fill, unknown keys, accessors, overlong strings, malformed optional fill, and mismatched application/fill bundle or app name.

```ts
expect(decodeEntryContext({
  status: "available",
  application: { bundleId: "com.example.app", appName: "Example" },
})).toEqual({
  status: "available",
  application: { bundleId: "com.example.app", appName: "Example" },
  fillContext: null,
});
```

- [ ] **Step 2: Run decoder and service tests to verify RED**

Run: `npm test -- apps/menubar-tauri/src/host/tauri-host.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-fill-context.model.spec.ts apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.spec.ts`

Expected: FAIL because `available` currently requires `LiveAutoFillContext`.

- [ ] **Step 3: Implement explicit projections**

Add strict `decodeAutoFillApplicationContext` and `decodeLayeredAutoFillContext`; do not spread untrusted records. Make `AutoFillContextualCandidatesService.queryAll` accept application context, use it for bundle/app query data, and revalidate the exact application plus Agent session after all requests settle. Revalidate fill context only when one existed initially.

```ts
export interface AutoFillApplicationContext {
  readonly bundleId: string;
  readonly appName: string;
}

export interface LayeredAutoFillContext {
  readonly application: AutoFillApplicationContext;
  readonly fillContext: LiveAutoFillContext | null;
}
```

- [ ] **Step 4: Refactor session ownership**

Store application, optional fill context, Agent session, candidates, and selected cipher. Application equality controls ranking/session identity. Fill-context expiry or invalidation clears only `fillContext` and pending fill actions; it does not erase candidates while the exact application remains current.

- [ ] **Step 5: Refactor vault context readiness**

`beginFromEntry` returns ready for application-only context, queries candidates, and publishes no candidates only when the Agent query is empty. A genuinely missing external application still returns `reason: "context"`.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm test -- apps/menubar-tauri/src/app/autofill/autofill-fill-context.model.spec.ts apps/menubar-tauri/src/app/autofill/autofill-context-session.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-contextual-candidates.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-vault-context.service.spec.ts apps/menubar-tauri/src/host/tauri-host.service.spec.ts`

Expected: PASS.

Commit with message: `feat: keep autofill candidates without field detection`.

---

### Task 3: Unified Explicit Field Action and Capability Decision

**Files:**
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-fill-action.service.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-field-action.service.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-field-action.service.spec.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-fill-context.model.ts`
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_detected_fill.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/main.rs`
- Test: native inline detected-fill tests and Angular action tests

**Interfaces:**
- Produces: `AutoFillCapabilityDecision { primary: "hidden" | "auto" | "choose"; explicitMode: "fill" | "copy" }`
- Produces: `AutoFillFieldActionService.execute(layered, session, candidate, item, field)`
- Extends: `DetectedFillRequest` with `intent: "auto" | "explicit"`

- [ ] **Step 1: Write capability and field-action RED tests**

Test these exact cases:

```ts
expect(decideCapabilities({ fillContext: null })).toEqual({
  primary: "hidden",
  explicitMode: "copy",
});
expect(decideCapabilities({ fillContext: usernameField })).toEqual({
  primary: "auto",
  explicitMode: "fill",
});
```

Also test single-field release, mismatch confirmation, reprompt, cancellation, replay, copy success, explicit fill success, and no multi-secret response.

- [ ] **Step 2: Run RED tests**

Run: `npm test -- apps/menubar-tauri/src/app/autofill/autofill-fill-action.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-field-action.service.spec.ts`

Expected: FAIL because field actions currently require a complete detected action.

- [ ] **Step 3: Implement capability decision and explicit action state machine**

The new service prepares one authorization scope. With `fillContext`, call `fillDetected` using `intent: "explicit"`; without one, call `releaseSecret`, then `copyText`, and report a fixed copied success. Reuse the existing receipt/mismatch rules and burn receipts/tokens on every failure, cancel, navigation, lock, or destroy.

- [ ] **Step 4: Implement strict native intent decoding**

Add a strict enum to the Tauri request. `auto` uses existing action subset validation. `explicit` requires one authorization and calls `take_explicit`. Both paths release only the requested field and run the same zeroizing native executor.

```rust
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum DetectedFillIntent { Auto, Explicit }
```

- [ ] **Step 5: Run native and Angular action tests and commit**

Run: `cargo test autofill_detected_fill::tests -- --nocapture`

Run: `npm test -- apps/menubar-tauri/src/app/autofill/autofill-fill-action.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-field-action.service.spec.ts`

Expected: PASS.

Commit with message: `feat: add explicit autofill field actions`.

---

### Task 4: Vault List and Login Detail UI

**Files:**
- Modify: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.css`
- Modify: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/vault/official-login-credentials.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/official-login-credentials.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts`
- Modify: exact recovery/i18n hash manifests required by repository guards

**Interfaces:**
- Consumes: layered ready state and `AutoFillCapabilityDecision`
- Consumes: primary auto action and explicit field action service

- [ ] **Step 1: Write realistic rendered RED tests**

Cover application-only suggestions, three available field icons, hidden primary Fill, recognized field/form primary Fill, detail single AutoFill button, explicit copy/fill outcomes, search focus, hover/focus continuity, and keyboard activation.

```ts
expect(screen.getByTestId("vault-autofill-candidate")).toHaveTextContent("Termius");
expect(screen.queryByTestId("vault-autofill-fill")).toBeNull();
expect(screen.getByLabelText("复制用户名")).toBeVisible();
```

- [ ] **Step 2: Run rendered tests to verify RED**

Run: `npm test -- apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/vault/official-login-credentials.component.spec.ts`

Expected: FAIL because application-only candidates are currently filtered out and the primary Fill is unconditional.

- [ ] **Step 3: Implement list behavior**

Always render actual candidate fields as individual buttons with fixed labels. Render primary Fill only for `primary !== "hidden"`. Preserve the current integrated vault section, continuous row hover/focus outline, maximum five suggestions, exact/relevant ordering, and details navigation.

- [ ] **Step 4: Implement detail behavior**

Render one `自动填充` primary button when a fill capability is live, with no field-specific description in the card. Keep field icons as explicit alternatives. If the application remains exact but fill context expires, remove only the primary button and leave explicit copy icons.

- [ ] **Step 5: Update fixed copy and manifests**

Add fixed messages for `复制用户名`, `复制密码`, `复制验证码`, `已复制`, and unavailable/cancelled states. Update only exact hashes required by the i18n/recovery guards.

- [ ] **Step 6: Run UI, guard, and build gates and commit**

Run: `npm test -- apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/vault/official-login-credentials.component.spec.ts apps/menubar-tauri/src/app/app.component.spec.ts apps/menubar-tauri/src/app/recovery-overlay-integrity.spec.ts`

Run: `npm run build:web`

Expected: PASS.

Commit with message: `feat: show layered autofill actions in vault`.

---

### Task 5: Full Regression, Signed macOS 26 Live Verification, and Installation

**Files:**
- Modify: `.superpowers/sdd/2026-08-10-context-aware-native-autofill/task-8-report.md` or create a dated live-verification report beside the existing plan reports
- No production config or entitlement changes

**Interfaces:**
- Consumes all prior task outputs
- Produces a verified signed `/Applications/Barwarden.app` local-smoke installation

- [ ] **Step 1: Run serial automated gates**

Run in order:

```text
cargo fmt --check
cargo check
cargo test
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild test (existing unsigned native test command)
node --test scripts/native-autofill-contract.spec.mjs scripts/native-autofill-identity.spec.mjs scripts/native-autofill-project.spec.mjs
npm test
npm run build:web
git diff --check
```

Expected: all applicable tests pass; only documented live-only tests remain ignored.

- [ ] **Step 2: Build with the authorized Developer ID in an isolated keychain**

Use `scripts/build-native-autofill-local-smoke.sh` with `NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY=1`, the user-authorized certificate/key imported into a temporary keychain, and an empty mode-0700 output directory. Delete the temporary keychain after signing. Do not notarize, staple, create a DMG, or promote production evidence.

- [ ] **Step 3: Verify before installation**

Verify Agent, Provider, and outer app with `codesign --verify --strict --deep`, Team `K7LY92JY96`, and exact identifiers. Copy the existing application to a recoverable `/private/tmp` backup before atomic replacement.

- [ ] **Step 4: Run the real Termius matrix without automation focus gaps**

Perform foreground selection and shortcut trigger as one uninterrupted desktop action. Verify:

1. Termius frontmost with no writable field: Termius suggestions render, field icons copy, primary Fill hidden.
2. Termius Email focused: Termius suggestion renders, primary Fill shown, username icon shown.
3. Primary Fill changes only Email; no submit occurs.
4. Password focus shows/fills password only.
5. Changing frontmost application invalidates the old fill capability and reranks suggestions.

Do not echo field or secret values in logs or the report; record only changed/unchanged booleans and fixed result codes.

- [ ] **Step 5: Record evidence and commit**

Record exact automated counts, signed bundle identifiers/Team, macOS 26 runtime result, and any honest blocker. Commit with message: `test: verify layered native autofill on macOS 26`.
