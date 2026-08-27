# Context-Aware Native AutoFill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect the focused username/email, password, OTP, or safe login form on macOS; show a visible caret-anchored AutoFill pill; and fill the inferred field(s) from the picker or Login detail without ever submitting the form.

**Architecture:** Rust owns bounded AX metadata collection, deterministic field/form classification, opaque target contexts, native secret release, and exact-element filling. Angular receives presentation-only context, merges existing field-scoped candidate authorizations, and renders inferred primary actions plus explicit field fallbacks. The existing Agent remains the authority for candidate policy and each secret release; whole-form fill collects all authorized secrets natively before performing one single-use AX transaction.

**Tech Stack:** Rust/Tauri 2, macOS ApplicationServices Accessibility APIs, AppKit through `objc2`, Angular standalone components, TypeScript/Vitest, Swift Agent/XCTest regression coverage, Developer ID local-smoke build.

## Global Constraints

- Live acceptance targets macOS 26. Lower macOS versions retain the existing deployment, compile-time availability, and binary-floor checks but receive no runtime promise.
- AutoFill never presses Return or Tab, invokes a submit action, clicks a login button, or otherwise submits a form.
- Classification never reads `AXValue`, selected text, clipboard contents, or screen pixels.
- Accessibility traversal is capped at 3 ancestors, 256 descendants, 20 writable text candidates, 255 Unicode scalars per semantic string, and 50 milliseconds per observation.
- Native fill contexts have a 30-second absolute lifetime and a capacity of 64.
- Whole-form fill supports exactly one password, at most one username/email, and at most one one-time-code field.
- Multiple password/new-password/confirm-password forms never receive a whole-form action.
- Candidate matching, mismatch confirmation, reprompt, account/generation/revision binding, and one-time field authorization remain authoritative and unchanged in strength.
- No application-specific names, bundle identifiers, aliases, form layouts, OCR, screen capture, cloud classification, telemetry, or learned model.
- Browser-extension DOM detection, cards, identities, addresses, arbitrary custom fields, and form submission are outside this plan.
- Production Tauri configuration and release entitlements remain unchanged.

---

## File structure

### New Rust units

- `apps/menubar-tauri/src-tauri/src/autofill_field_context.rs` — pure field scoring, form grouping, presentation model, and deterministic tests.
- `apps/menubar-tauri/src-tauri/src/autofill_ax_context.rs` — macOS AX metadata reader, caret/field fingerprints, bounded opaque context store, exact-element reacquisition, and fill port.
- `apps/menubar-tauri/src-tauri/src/autofill_detected_fill.rs` — strict Tauri command that consumes Agent authorizations, obtains secrets natively, executes one detected fill transaction, and returns metadata-only results.

### New Angular units

- `apps/menubar-tauri/src/app/autofill/autofill-fill-context.model.ts` — strict presentation and detected-fill request/response types.
- `apps/menubar-tauri/src/app/autofill/autofill-context-session.service.ts` — ephemeral picker-to-detail context and candidate authorization matrix; never persists.
- `apps/menubar-tauri/src/app/autofill/autofill-contextual-candidates.service.ts` — three field-scoped queries merged into one candidate row model.
- `apps/menubar-tauri/src/app/autofill/autofill-fill-action.service.ts` — prepares, confirms, reprompts, and invokes one native detected-fill action without exposing secrets to JavaScript.

### Focused modifications

- `apps/menubar-tauri/src-tauri/src/accessibility_focus.rs` — accept semantic/caret observations while retaining fail-closed geometry and permission policy.
- `apps/menubar-tauri/src-tauri/src/autofill_floating.rs` — use the new reader/context store and replace trailing transparent icon placement with a caret/field-anchored pill.
- `apps/menubar-tauri/src-tauri/src/autofill_reprompt.rs` — support one verified receipt bound to 1–3 exact field scopes.
- `apps/menubar-tauri/src-tauri/src/autofill_ipc.rs` and `autofill_contract.rs` — expose internal field-scoped release helpers to the detected-fill command; wire format to the Agent stays field-scoped.
- `apps/menubar-tauri/src-tauri/src/frontmost.rs` — return presentation-only detected context plus opaque token from `autofill_entry_context`.
- `apps/menubar-tauri/src-tauri/src/main.rs` — manage/register new state and command modules.
- `apps/menubar-tauri/src/host/tauri-host.service.ts` — strict decoders and native command methods.
- `apps/menubar-tauri/src/app/autofill/autofill-native.host.ts` — typed detected context, batch reprompt, and fill methods.
- `apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts` and `.css` — inferred context chip, contextual candidate actions, detail navigation, and explicit fallback icons.
- `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts` — live contextual action card and detected-fill execution.
- `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.html` — person/lock/clock field fill icons.
- `apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts` — fixed Chinese and English field/form/status copy.
- `apps/menubar-tauri/src/host/native-command-surface.guard.spec.ts` and recovery/hash guards — admit only the exact new command surface and intended runtime hashes.

---

### Task 1: Deterministic field semantics and safe form detection

**Files:**
- Create: `apps/menubar-tauri/src-tauri/src/autofill_field_context.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/main.rs`
- Test: inline `#[cfg(test)]` module in `autofill_field_context.rs`

**Interfaces:**
- Consumes: normalized AX metadata and geometry only; no native AX references.
- Produces:

```rust
pub enum DetectedFieldKind { Username, Email, Password, OneTimeCode, Unknown }
pub enum FieldConfidence { High, Medium, Low }
use crate::autofill_contract::AutoFillSecretField;

pub struct SemanticFieldObservation {
    pub role: String,
    pub subrole: Option<String>,
    pub role_description: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub help: Option<String>,
    pub placeholder: Option<String>,
    pub identifier: Option<String>,
    pub linked_title: Option<String>,
    pub frame: AxFrame,
    pub editable: bool,
    pub enabled: bool,
    pub focused: bool,
    pub container_path: Vec<u16>,
}

pub struct DetectedField {
    pub kind: DetectedFieldKind,
    pub secret_field: Option<AutoFillSecretField>,
    pub confidence: FieldConfidence,
    pub score: u16,
    pub frame: AxFrame,
    pub focused: bool,
    pub container_path: Vec<u16>,
}

pub enum DetectedAction {
    Field { field: AutoFillSecretField },
    Form { fields: Vec<AutoFillSecretField> },
    Choose,
}

pub fn classify_fields(input: &[SemanticFieldObservation]) -> Vec<DetectedField>;
pub fn detect_action(fields: &[DetectedField]) -> DetectedAction;
```

- [ ] **Step 1: Write the failing scoring and form tests**

Add table-driven tests that assert exact score bands and actions:

```rust
#[test]
fn classifies_secure_email_username_and_otp_without_reading_values() {
    let detected = classify_fields(&[
        field("AXTextField").placeholder("Email").focused(),
        field("AXSecureTextField").placeholder("Password"),
        field("AXTextField").linked_title("验证码"),
    ]);
    assert_eq!(detected[0].kind, DetectedFieldKind::Email);
    assert_eq!(detected[0].confidence, FieldConfidence::High);
    assert_eq!(detected[1].kind, DetectedFieldKind::Password);
    assert_eq!(detected[1].score, 100);
    assert_eq!(detected[2].kind, DetectedFieldKind::OneTimeCode);
}

#[test]
fn detects_only_safe_single_password_login_forms() {
    assert_eq!(
        detect_action(&classify_fields(&username_password_form())),
        DetectedAction::Form {
            fields: vec![AutoFillSecretField::Username, AutoFillSecretField::Password]
        }
    );
    assert_eq!(detect_action(&classify_fields(&new_confirm_password_form())), DetectedAction::Choose);
}
```

Cover English, Simplified Chinese, Traditional Chinese, linked title, placeholder, identifier, description/help, sibling evidence, ambiguous `account`/`passcode`, duplicate password, duplicate username, disconnected containers, input permutation, scalar bounds, and stable tie behavior.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml autofill_field_context -- --nocapture
```

Expected: compile failure because `autofill_field_context` and its public types do not exist.

- [ ] **Step 3: Implement normalization, scoring, and form rules**

Use the approved fixed weights and thresholds:

```rust
const SECURE_ROLE_SCORE: u16 = 100;
const LINKED_TITLE_SCORE: u16 = 80;
const TITLE_OR_PLACEHOLDER_SCORE: u16 = 70;
const IDENTIFIER_SCORE: u16 = 55;
const DESCRIPTION_SCORE: u16 = 45;
const SIBLING_FORM_SCORE: u16 = 35;
const ALIGNMENT_SCORE: u16 = 15;
const AMBIGUOUS_SCORE: u16 = 20;
const HIGH_SCORE: u16 = 80;
const HIGH_MARGIN: u16 = 25;
const MEDIUM_SCORE: u16 = 55;
const MEDIUM_MARGIN: u16 = 15;
```

Normalize with Unicode canonical composition and locale-stable lowercase; split identifiers at punctuation/camel-case boundaries; compare complete tokens/phrases. Cap each evidence source once per kind and each kind at 100. Secure role wins password at 100. `detect_action` must require the focused field in the group, exactly one password, no conflicting/new/confirm password semantics, and canonical field order username/password/TOTP.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all field-context tests pass with deterministic scores and no network or OS permission dependency.

- [ ] **Step 5: Commit the pure classifier**

```bash
git add apps/menubar-tauri/src-tauri/src/autofill_field_context.rs apps/menubar-tauri/src-tauri/src/main.rs
git commit -m "feat: classify native autofill fields"
```

---

### Task 2: Bounded AX reader and opaque detected-context store

**Files:**
- Create: `apps/menubar-tauri/src-tauri/src/autofill_ax_context.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/accessibility_focus.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_floating.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/frontmost.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/main.rs`
- Test: inline tests in `autofill_ax_context.rs`, `accessibility_focus.rs`, and `frontmost.rs`

**Interfaces:**
- Consumes: `classify_fields`, `detect_action`, exact `FrontmostApp`, screen frames, and the current observer generation.
- Produces:

```rust
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FillContextPresentation {
    pub fill_context_token: String,
    pub focused_field: PresentedField,
    pub action: PresentedAction,
}

pub struct CapturedFieldFingerprint {
    pub process_id: i32,
    pub role: String,
    pub frame: AxFrame,
    pub window_frame: AxFrame,
    pub kind: DetectedFieldKind,
    pub secret_field: Option<AutoFillSecretField>,
}

pub struct DetectedFillContextStore;

impl DetectedFillContextStore {
    pub fn insert(&self, target: FrontmostApp, fields: Vec<CapturedFieldFingerprint>, action: DetectedAction) -> FillContextPresentation;
    pub fn take(&self, token: &str, requested: &[AutoFillSecretField]) -> Result<CapturedFillPlan, DetectedFillError>;
    pub fn invalidate_all(&self);
}
```

- [ ] **Step 1: Write RED tests for bounded metadata, caret fallback, and token lifecycle**

Use a fake AX port that records every requested attribute. Assert:

```rust
assert_eq!(port.requested_attributes(), vec![
    "AXRole", "AXSubrole", "AXRoleDescription", "AXTitle", "AXDescription",
    "AXHelp", "AXPlaceholderValue", "AXIdentifier", "AXTitleUIElement",
    "AXParent", "AXChildren", "AXWindow", "AXPosition", "AXSize", "AXEnabled",
    "AXSelectedTextRange",
]);
assert!(!port.requested_attributes().contains(&"AXValue"));
assert!(port.requested_parameterized_attributes().contains(&"AXBoundsForRange"));
```

Add tests for 3-ancestor/256-descendant/20-field/255-scalar/50-ms bounds, wrong CF/AX types with exact-once release, field-caret fallback, 30-second expiry, 64-record capacity, wrong field subset, token replay, stale PID/app/window/frame, and context invalidation.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml autofill_ax_context -- --nocapture
```

Expected: compile failure for missing reader/store types and expanded entry-context fields.

- [ ] **Step 3: Implement the read port and native context capture**

Define a testable port and enforce the bounds before native conversion:

```rust
pub trait AxMetadataPort {
    type Element: Clone;
    fn string(&mut self, element: &Self::Element, attribute: &'static str) -> Option<String>;
    fn element(&mut self, element: &Self::Element, attribute: &'static str) -> Option<Self::Element>;
    fn elements(&mut self, element: &Self::Element, attribute: &'static str) -> Vec<Self::Element>;
    fn frame(&mut self, element: &Self::Element) -> Option<AxFrame>;
    fn value_settable(&mut self, element: &Self::Element) -> bool;
    fn caret_frame(&mut self, element: &Self::Element) -> Option<AxFrame>;
    fn now(&self) -> Instant;
}
```

On macOS, use strict `CFGetTypeID`, `AXUIElementGetTypeID`, `AXValueGetTypeID`, and `AXValueGetType` checks before every cast. Read `AXSelectedTextRange` only as `CFRange`, pass it to `AXBoundsForRange`, and never request selected text or value. Store fingerprints, not secret content or labels. Generate context tokens with random UUIDs, purge expired records before insertion, and reject rather than evict at capacity.

Update `autofill_entry_context` so `Available` contains bundle/app plus `FillContextPresentation`; when no safe detected context exists, preserve the existing application context with a `Choose` presentation only if the focused editable field itself remains valid.

- [ ] **Step 4: Run focused Rust tests and macOS compile checks**

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml autofill_ax_context accessibility_focus frontmost -- --nocapture
cargo check --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml
```

Expected: focused tests pass; macOS ApplicationServices symbols link without undefined macro symbols; only existing warning baselines remain.

- [ ] **Step 5: Commit context capture**

```bash
git add apps/menubar-tauri/src-tauri/src/autofill_ax_context.rs apps/menubar-tauri/src-tauri/src/accessibility_focus.rs apps/menubar-tauri/src-tauri/src/autofill_floating.rs apps/menubar-tauri/src-tauri/src/frontmost.rs apps/menubar-tauri/src-tauri/src/main.rs
git commit -m "feat: capture native autofill form context"
```

---

### Task 3: PopClip-style caret-anchored floating action

**Files:**
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_floating.rs`
- Add: `apps/menubar-tauri/src-tauri/icons/autofill-pill@2x.png`
- Test: inline placement/panel/observer tests in `autofill_floating.rs`

**Interfaces:**
- Consumes: caret frame, focused-field frame, `FillContextPresentation`, visible screen work area, and existing observer generation.
- Produces: a non-key/non-main 34×30 point `NSPanel` pill and the fixed `autofill-floating` entry event.

- [ ] **Step 1: Write RED placement and appearance-contract tests**

```rust
#[test]
fn prefers_caret_above_then_field_above_then_below() {
    assert_eq!(place_pill(Some(caret()), field(), work_area()), Some(expected_above_caret()));
    assert_eq!(place_pill(None, field(), work_area()), Some(expected_above_field()));
    assert_eq!(place_pill(Some(top_edge_caret()), top_edge_field(), work_area()), Some(expected_below()));
}

#[test]
fn pill_contract_is_visible_and_never_activating() {
    assert_eq!(PILL_SIZE, (34.0, 30.0));
    assert!(!PANEL_CONTRACT.can_become_key);
    assert!(!PANEL_CONTRACT.can_become_main);
    assert!(PANEL_CONTRACT.has_material_background);
    assert!(PANEL_CONTRACT.has_contrast_border);
}
```

Cover multi-display work areas, clamping, no safe placement, reduce motion, reduce transparency, increase contrast, field movement/scroll/focus/app invalidation, and stale callback/click rejection.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml autofill_floating -- --nocapture
```

Expected: placement and appearance tests fail against the old trailing 28-point transparent panel.

- [ ] **Step 3: Implement caret-first placement and pill appearance**

Use exact geometry constants:

```rust
const PILL_WIDTH: f64 = 34.0;
const PILL_HEIGHT: f64 = 30.0;
const PILL_GAP: f64 = 8.0;
const PILL_RADIUS: f64 = 9.0;
```

Center above caret; fall back above field; flip below; clamp only after selecting the current screen; return `None` when neither orientation is safe. Replace the clear square with an adaptive raised background, opaque accessibility fallback, one-point border, restrained shadow, blue non-template Barwarden glyph, and a small person/lock/clock/form badge. Retain `Borderless | NonactivatingPanel`, `canBecomeKeyWindow=false`, `canBecomeMainWindow=false`, and immediate hide on invalidation. Disable interpolation when Reduce Motion is active.

- [ ] **Step 4: Run focused tests and inspect a deterministic rendered fixture**

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml autofill_floating -- --nocapture
cargo check --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml
```

Expected: placement/panel tests pass; a test-only light/dark fixture screenshot shows a legible pill above the anchor at 1× and 2× scaling.

- [ ] **Step 5: Commit the floating action**

```bash
git add apps/menubar-tauri/src-tauri/src/autofill_floating.rs apps/menubar-tauri/src-tauri/icons/autofill-pill@2x.png
git commit -m "feat: anchor native autofill above the caret"
```

---

### Task 4: Native batch authorization and exact-element fill executor

**Files:**
- Create: `apps/menubar-tauri/src-tauri/src/autofill_detected_fill.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_ax_context.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_reprompt.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_ipc.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_contract.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/main.rs`
- Test: inline tests in those Rust modules

**Interfaces:**
- Consumes: one opaque detected context, 1–3 field-scoped candidate authorization tokens for one candidate, optional one verified batch reprompt receipt, and the existing Agent client.
- Produces:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetectedFillAuthorization {
    pub scope: AutoFillRepromptScope,
    pub mismatch_confirmed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DetectedFillRequest {
    pub fill_context_token: String,
    pub authorizations: Vec<DetectedFillAuthorization>,
    pub reprompt_receipt: Option<String>,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum DetectedFillOutcome {
    Success { fields: Vec<AutoFillSecretField> },
    Partial { filled: Vec<AutoFillSecretField>, failed: AutoFillSecretField, code: &'static str },
    Error { code: &'static str },
}
```

- [ ] **Step 1: Write RED batch receipt, native-release, and fill tests**

Assert that a receipt is bound to an exact sorted set of 1–3 unique scopes with the same account/candidate/generation; wrong scope, duplicate field, replay, expiry, cancellation, and partial verification burn it. Add an IPC seam that proves every field still receives a distinct Agent `release_secret` request and one-time context token.

Add executor tests with a fake AX fill port:

```rust
assert_eq!(execute(fields![Username, Password, Totp]), Success(vec![Username, Password, Totp]));
assert_eq!(port.actions(), vec![
    SetValue(Username), SetValue(Password), FocusAndPaste(Totp)
]);
assert!(!port.actions().iter().any(|action| matches!(action, PressReturn | PressTab | PressButton)));
```

Cover target/app/window/frame changes before each field, unsupported direct set with exact-element guarded paste, all-secret collection before the first write, zeroization on every failure, partial result after a mid-transaction AX failure, wrong webview, unknown fields, oversized values, and response serialization without secrets.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml autofill_detected_fill autofill_reprompt autofill_ipc -- --nocapture
```

Expected: missing batch receipt and detected-fill command types cause compile/test failures.

- [ ] **Step 3: Implement batch verification without weakening Agent field scope**

Change the receipt record from one scope to `Vec<AutoFillRepromptScope>`. Add:

```rust
pub fn begin_batch(&self, scopes: Vec<AutoFillRepromptScope>, verify_url: String) -> Result<String, ()>;
pub fn consume_verified_batch(&self, receipt: &str, scopes: &[AutoFillRepromptScope]) -> bool;
pub fn cancel_batch(&self, receipt: &str, scopes: &[AutoFillRepromptScope]) -> bool;
```

Keep existing single-scope methods as strict one-element wrappers. Native verification still occurs once. After verified batch consumption, issue one existing Agent reprompt grant per scope and perform one existing field-scoped release per authorization. Do not add a multi-secret Agent wire response.

- [ ] **Step 4: Implement native secret collection and one fill transaction**

Expose an internal `perform_secret_with_verified_scope` helper from `autofill_ipc.rs`. `autofill_fill_detected` must:

1. require the main picker webview;
2. sort/validate 1–3 unique canonical fields and one account/candidate/generation;
3. consume the detected context once for exactly those fields;
4. consume the optional verified batch receipt once;
5. release every field into `Zeroizing<String>` storage before writing any field;
6. reacquire and revalidate each exact AX fingerprint;
7. use direct AX value setting or exact-element guarded paste;
8. stop on the first AX failure and return only fixed status codes; and
9. zeroize every owned secret and consume the context on all exits.

Register only `autofill_fill_detected` and the batch begin/cancel wrappers as new Tauri commands.

- [ ] **Step 5: Run Rust unit, command-surface, and full Rust tests**

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml autofill_detected_fill autofill_reprompt autofill_ipc -- --nocapture
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml
```

Expected: all pass; signed IPC harness remains ignored unless its explicit environment gate is present; no plaintext secret appears in serialized outcomes or test logs.

- [ ] **Step 6: Commit native fill execution**

```bash
git add apps/menubar-tauri/src-tauri/src/autofill_detected_fill.rs apps/menubar-tauri/src-tauri/src/autofill_ax_context.rs apps/menubar-tauri/src-tauri/src/autofill_reprompt.rs apps/menubar-tauri/src-tauri/src/autofill_ipc.rs apps/menubar-tauri/src-tauri/src/autofill_contract.rs apps/menubar-tauri/src-tauri/src/main.rs
git commit -m "feat: fill detected native login forms"
```

---

### Task 5: Strict TypeScript context, candidate matrix, and fill-action services

**Files:**
- Create: `apps/menubar-tauri/src/app/autofill/autofill-fill-context.model.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-context-session.service.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-contextual-candidates.service.ts`
- Create: `apps/menubar-tauri/src/app/autofill/autofill-fill-action.service.ts`
- Create tests beside each new service
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-native.host.ts`
- Modify: `apps/menubar-tauri/src/host/tauri-host.service.ts`
- Modify: `apps/menubar-tauri/src/host/tauri-host.service.spec.ts`
- Modify: `apps/menubar-tauri/src/host/native-command-surface.guard.spec.ts`

**Interfaces:**
- Consumes: strict native detected context, `AutoFillCandidateService`, current Agent session, vault Login metadata, and native batch reprompt/fill commands.
- Produces:

```ts
export type DetectedFieldKind = "username" | "email" | "password" | "one-time-code" | "unknown";
export type FieldConfidence = "high" | "medium" | "low";
export type DetectedFillMode = "field" | "form" | "choose";

export interface LiveAutoFillContext {
  readonly bundleId: string;
  readonly appName: string;
  readonly fillContextToken: string;
  readonly focusedField: { readonly kind: DetectedFieldKind; readonly secretField?: AutoFillSecretField; readonly confidence: FieldConfidence };
  readonly action: { readonly mode: DetectedFillMode; readonly fields: readonly AutoFillSecretField[] };
}

export interface ContextualCandidate {
  readonly cipherId: string;
  readonly displayName: string;
  readonly username: string;
  readonly group: AutoFillCandidateGroup;
  readonly reason: string;
  readonly availableFields: readonly AutoFillSecretField[];
  readonly authorizations: ReadonlyMap<AutoFillSecretField, { readonly contextToken: string; readonly requiresMismatchConfirmation: boolean }>;
}
```

- [ ] **Step 1: Write RED decoder, matrix, and stale-session tests**

Test exact own-key decoding for all root/nested objects, enum bounds, 1–3 unique ordered fields, UUID/token/string bounds, unknown fields, secret-shaped smuggling, and metadata-only outcomes. Test matrix behavior:

```ts
expect(await service.queryAll(context, session, "")).toEqual([
  expect.objectContaining({
    cipherId: "login-a",
    availableFields: ["username", "password", "totp"],
  }),
]);
```

Assert strongest candidate group wins for display, every authorization keeps its own field token, the same cipher is required for a form action, unavailable fields are omitted, and app/context/session changes invalidate the ephemeral service.

- [ ] **Step 2: Run focused Vitest and verify RED**

```bash
npx vitest run apps/menubar-tauri/src/app/autofill/autofill-fill-context.model.spec.ts apps/menubar-tauri/src/app/autofill/autofill-context-session.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-contextual-candidates.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-fill-action.service.spec.ts apps/menubar-tauri/src/host/tauri-host.service.spec.ts
```

Expected: missing models/services/methods fail compilation.

- [ ] **Step 3: Implement strict native host contracts**

Extend `AutoFillNativeHost` with:

```ts
entryContext(): Promise<{ readonly status: "available"; readonly context: LiveAutoFillContext } | { readonly status: "unavailable" }>;
beginRepromptBatch(scopes: readonly AutoFillRepromptScope[]): Promise<AutoFillBeginRepromptOutcome>;
cancelRepromptBatch(scopes: readonly AutoFillRepromptScope[], receipt: string): Promise<void>;
fillDetected(request: DetectedFillRequest): Promise<DetectedFillOutcome>;
```

Decode fixed native result codes only. Reject any secret/value field in `fillDetected` outcomes. Add the exact command names to the command-surface guard without widening unrelated closures.

- [ ] **Step 4: Implement candidate and action services**

`AutoFillContextualCandidatesService.queryAll` runs existing username/password/TOTP queries concurrently, validates the live entry context again after completion, and merges by cipher ID. Sort by exact/relevant/other, then preserve the Agent's stable order.

`AutoFillContextSessionService` stores only the current context, Agent session, candidate matrix, and selected cipher ID in memory; it clears on lock, account switch, picker cancel, target mismatch, expiry, and app navigation outside picker/detail.

`AutoFillFillActionService.prepare` intersects the native requested fields with one candidate's available fields. It returns `choose` when the native mode is choose, and never silently drops a required form field. `execute` invokes batch reprompt when needed and then calls `fillDetected`; it never requests or receives plaintext secrets.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all new decoders/services and existing host tests pass.

- [ ] **Step 6: Commit typed context services**

```bash
git add apps/menubar-tauri/src/app/autofill/autofill-fill-context.model.ts apps/menubar-tauri/src/app/autofill/autofill-fill-context.model.spec.ts apps/menubar-tauri/src/app/autofill/autofill-context-session.service.ts apps/menubar-tauri/src/app/autofill/autofill-context-session.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-contextual-candidates.service.ts apps/menubar-tauri/src/app/autofill/autofill-contextual-candidates.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-fill-action.service.ts apps/menubar-tauri/src/app/autofill/autofill-fill-action.service.spec.ts apps/menubar-tauri/src/app/autofill/autofill-native.host.ts apps/menubar-tauri/src/host/tauri-host.service.ts apps/menubar-tauri/src/host/tauri-host.service.spec.ts apps/menubar-tauri/src/host/native-command-surface.guard.spec.ts
git commit -m "feat: model contextual autofill actions"
```

---

### Task 6: Replace manual field selection with contextual picker actions

**Files:**
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.css`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json` through `node scripts/update-i18n-retained-manifests.mjs`

**Interfaces:**
- Consumes: `LiveAutoFillContext`, `ContextualCandidate[]`, `AutoFillFillActionService`, existing mismatch confirmation, and existing Touch ID/master-password UI.
- Produces: context chip, candidate-body detail navigation, inferred primary action, and explicit available field icon actions.

- [ ] **Step 1: Write realistic RED picker interaction tests**

Create delayed-query tests that interact with the rendered DOM and assert:

```ts
expect(host.querySelector("[data-testid='autofill-field-switcher']")).toBeNull();
expect(host.querySelector("[data-testid='autofill-context-form']")?.textContent)
  .toContain("用户名 + 密码");
expect(actionButtons.map((button) => button.getAttribute("aria-label")))
  .toEqual(["填入用户名", "填入密码", "填入验证码"]);
```

Cover high-confidence email/password/OTP/form, low-confidence choose mode, only available item fields, body click to `/view-cipher/:id` with zero release, explicit icon action, approximate mismatch confirmation, reprompt once for a form, search preserving inferred context/focus, Enter selecting without silent fill, partial native outcome, stale target, cancel/destroy, and keyboard/ARIA behavior.

- [ ] **Step 2: Run picker tests and verify RED**

```bash
npx vitest run apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts
```

Expected: old segmented switcher/default-password behavior fails the new assertions.

- [ ] **Step 3: Implement the contextual picker layout**

Remove `selectedField`, `FIELD_ORDER`, `candidatesByField`, and the default segmented control. Render one context chip:

```html
<div class="autofill-picker__context" [attr.data-testid]="contextTestId">
  <i class="bwi" [class]="contextIconClass" aria-hidden="true"></i>
  <span>{{ contextLabel }}</span>
</div>
```

Render the row body as detail navigation and a separate trailing action group. For confident field/form context, show one labeled primary action. For choose mode or expanded secondary actions, show only available person/lock/clock icon buttons with fixed tooltips and ARIA names. Keep exact/relevant/other ordering and fixed localized match reasons.

- [ ] **Step 4: Connect mismatch and reprompt to one detected action**

Prepare the exact field list before opening a confirmation. One mismatch dialog covers the visible action, while native execution retains independent field authorization. For a reprompt Login, bind one batch receipt to the exact field scopes, verify once, then invoke `fillDetected`. Any candidate/context/selection/app change burns the receipt and action.

On success bind/record the selected Login once. On partial result show the exact localized filled/failed summary. Never fall back to the old generic `pasteText` path for a detected form.

- [ ] **Step 5: Run picker, accessibility, and i18n guard tests**

```bash
node scripts/update-i18n-retained-manifests.mjs
npx vitest run apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts apps/menubar-tauri/src/app/official-ui/official-i18n.service.spec.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/recovery-overlay.guard.spec.ts
```

Expected: contextual picker tests pass; no duplicate status regions, unlabeled icons, lost search focus, or widened recovery closure.

- [ ] **Step 6: Commit the picker redesign**

```bash
git add apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts apps/menubar-tauri/src/app/autofill/autofill-picker.component.css apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts apps/menubar-tauri/src/app/upstream-overlays/recovery/official-recovery.transform-manifest.json
git commit -m "feat: infer native autofill picker actions"
```

---

### Task 7: Add contextual whole-form fill to Login details

**Files:**
- Modify: `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts`
- Modify: `apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.html`
- Modify: `apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts`
- Modify: guarded overlay/integrity manifests only where exact hashes require it

**Interfaces:**
- Consumes: ephemeral `AutoFillContextSessionService`, the selected Login's contextual candidate row, and `AutoFillFillActionService`.
- Produces: one live-context action card plus person/lock/clock per-field fill icons.

- [ ] **Step 1: Write RED detail tests**

Assert that a detail opened from the picker with a live compatible context renders:

```html
<section data-testid="autofill-detail-context">
  <span>Termius · 登录表单</span>
  <button>填充登录表单</button>
</section>
```

Test single username/password/TOTP labels, app name, only compatible fields, explicit click before fill, one reprompt for form action, no action for normal vault navigation, archived/deleted item, wrong cipher, expired token, target/app/session change, missing secret, popout window, and stale context after returning from detail.

Assert per-field controls use `bwi-user`, `bwi-lock`, and `bwi-clock`, each with fixed labels.

- [ ] **Step 2: Run detail tests and verify RED**

```bash
npx vitest run apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.spec.ts
```

Expected: no contextual card and generic sign-in field icons cause failures.

- [ ] **Step 3: Implement ephemeral detail context and action card**

When a candidate row body is clicked, set the selected cipher in `AutoFillContextSessionService` before navigating to `/view-cipher/<encoded-id>`. In the detail component expose `contextualFillAction` only when:

- current item is active Login and equals the selected candidate;
- live context/session/candidate matrix still match;
- the native context is not expired or invalidated; and
- all required fields are available.

Render the contextual card above credentials. Its button calls the same `AutoFillFillActionService` as the picker. Opening detail does not query/release/fill by itself. Clear context when navigating outside picker/detail or after any fill outcome.

- [ ] **Step 4: Replace generic per-field fill glyphs**

Use exact icons:

```html
<button bitIconButton="bwi-user" data-testid="fill-username"></button>
<button bitIconButton="bwi-lock" data-testid="fill-password"></button>
<button bitIconButton="bwi-clock" data-testid="fill-totp"></button>
```

Retain existing copy/reveal/TOTP countdown controls and official component ordering. Do not change card/identity/note detail behavior.

- [ ] **Step 5: Run focused detail and route/cache tests**

```bash
npx vitest run apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.spec.ts apps/menubar-tauri/src/app/platform/popup-router-cache.service.spec.ts apps/menubar-tauri/src/app/app.routes.spec.ts
```

Expected: detail context is present only for the exact live picker journey; existing detail and route behavior remains green.

- [ ] **Step 6: Commit detail integration**

```bash
git add apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.ts apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.html apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-credentials.component.spec.ts apps/menubar-tauri/src/app/official-ui/official-i18n.service.ts apps/menubar-tauri/src/app/upstream-overlays/cipher-detail/official-login-detail.transform-manifest.json
git commit -m "feat: fill login forms from item details"
```

---

### Task 8: Cross-layer race, privacy, and regression gates

**Files:**
- Modify: focused Rust/TypeScript tests from Tasks 1–7
- Modify: `scripts/native-autofill-project.spec.mjs` only if the exact registered command/resource inventory changes
- Modify: `docs/autofill/native-autofill-evidence.md` with local macOS 26 evidence only; do not mark release promotion PASS
- Modify: `.superpowers/sdd/2026-08-08-native-app-autofill-first/progress.md`

**Interfaces:**
- Consumes: the completed context-aware feature.
- Produces: deterministic race/privacy evidence and a signed local macOS 26 smoke result.

- [ ] **Step 1: Add cross-layer deterministic race tests**

Use barriers/hooks to force each interleaving:

- focus/app/window changes after observation, after picker query, after authorization, and between each native field write;
- context expiry/replay/capacity exhaustion;
- account switch, projection replacement, lock, and reprompt cancellation;
- observer invalidation racing a queued panel show/click;
- detail navigation racing candidate/context invalidation; and
- first AX write success followed by second AX write failure.

Assert zero subsequent writes/releases, fixed outcomes, consumed tokens/receipts, and exact partial results.

- [ ] **Step 2: Add source/privacy contract tests**

Assert production source never requests `AXValue`, selected text, screen capture, OCR, Return, Tab, AXPress on submit controls, or application-specific identifiers. Assert entry/candidate/fill responses contain no raw AX labels, placeholders, identifiers, geometry, PID, password, TOTP seed, or released secret.

Run:

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml autofill -- --nocapture
npx vitest run apps/menubar-tauri/src/app/autofill apps/menubar-tauri/src/app/vault/vault-item-detail-page.component.spec.ts apps/menubar-tauri/src/host/native-command-surface.guard.spec.ts
```

Expected: all race/privacy/focused tests pass.

- [ ] **Step 3: Run complete automated regressions serially**

```bash
cargo fmt --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -project apps/macos-autofill/BarwardenAutoFill.xcodeproj -scheme BarwardenNativeAutoFill -destination 'platform=macOS' test CODE_SIGNING_ALLOWED=NO
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer node --test scripts/native-autofill-project.spec.mjs scripts/native-autofill-contract.spec.mjs scripts/native-autofill-identity.spec.mjs
npm test
npm run build:web
git diff --check
```

Expected: Rust, Xcode, native contracts, full Vitest, and production web build all exit 0. Run them serially so generated recovery hashes cannot race the web build.

- [ ] **Step 4: Build and install the signed local-smoke app**

Use the existing isolated Developer ID keychain workflow and exact local-only gate. Resolve the three credential/output environment variables through the already-authorized local credential workflow, keep their values out of logs, and verify them before invoking the builder:

```bash
test -n "$NATIVE_AUTOFILL_SIGNING_IDENTITY"
test -n "$NATIVE_AUTOFILL_SIGNING_KEYCHAIN"
test -n "$NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR"
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
NATIVE_AUTOFILL_LOCAL_SMOKE_ONLY=1 \
NATIVE_AUTOFILL_SIGNING_IDENTITY="$NATIVE_AUTOFILL_SIGNING_IDENTITY" \
NATIVE_AUTOFILL_SIGNING_KEYCHAIN="$NATIVE_AUTOFILL_SIGNING_KEYCHAIN" \
NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR="$NATIVE_AUTOFILL_LOCAL_OUTPUT_DIR" \
scripts/build-native-autofill-local-smoke.sh
```

Install the resulting `Barwarden Local Smoke.app` to a fresh explicit test location or replace `/Applications/Barwarden.app` only after preserving a recoverable backup. Verify the app, Provider, and Agent are signed by Team `K7LY92JY96`. Do not notarize, staple, create a DMG, update release evidence to PASS, or promote production artifacts.

- [ ] **Step 5: Execute the macOS 26 live matrix without releasing unrelated credentials**

Use a dedicated non-production test Login and verify:

1. light and dark native/Electron fields show a visible pill above the caret or field;
2. email/username, secure password, standalone OTP, and username+password form are classified correctly;
3. low-confidence and duplicate-password forms show explicit choices rather than whole-form fill;
4. candidate actions have person/lock/clock/form icons and explicit labels;
5. one whole-form click fills the expected test username/password/TOTP fields and does not submit;
6. Login detail exposes and executes the same live contextual action;
7. app switch, focus change, field/window movement, context expiry, and permission loss hide/disable the action; and
8. no repeated App Data permission dialog appears for the correctly signed test app.

Capture screenshots before fill, after fill but before submission, low-confidence fallback, and detail action. Record only app names, field kinds, fixed statuses, and artifact hashes; redact test secret values.

- [ ] **Step 6: Review implementation against the approved spec**

Check every acceptance criterion in `docs/superpowers/specs/2026-08-10-context-aware-native-autofill-design.md`. Confirm no placeholders, no Termius-specific rule, no production config/entitlement diff, and no uncommitted user-owned changes.

- [ ] **Step 7: Commit regression evidence**

```bash
git add docs/autofill/native-autofill-evidence.md .superpowers/sdd/2026-08-08-native-app-autofill-first/progress.md
git commit -m "test: verify context-aware native autofill"
```

---

## Completion definition

Implementation is complete only when Tasks 1–8 are individually reviewed, all automated suites in Task 8 pass, the signed macOS 26 live matrix demonstrates field/form inference and non-submitting fill, production configuration/entitlements remain unchanged, and the feature branch is clean.
