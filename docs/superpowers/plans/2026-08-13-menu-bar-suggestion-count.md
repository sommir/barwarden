# Menu Bar Suggestion Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the current reliable AutoFill suggestion count beside Barwarden's macOS menu-bar icon and keep it current across foreground-application, browser-tab, vault-session, and projection changes.

**Architecture:** A Rust-owned `SuggestionCountMonitor` keeps a read-only observation target independent from fill authorization state. Native workspace notifications refresh external applications immediately, a one-second loop reads URLs only for the observed supported browser, and a native Agent client performs the same three field-scoped queries and eligibility merge as the popup. Generation and Agent-session validation make every result stale-safe; the existing tray icon receives only an empty string or a clamped decimal title.

**Tech Stack:** Rust 1.88, Tauri 2.11 tray API, objc2 AppKit/Foundation workspace notifications, existing isolated macOS browser reader, existing Unix-socket AutoFill Agent protocol, Vitest/Node contract tests, Swift XCTest, repository native signed-release scripts.

## Global Constraints

- The tray shows only `1` through `5`; zero, loading, locked, stale, and unavailable states show no title.
- External application activation updates immediately; a supported browser active-tab URL change updates within the accepted one-second interval.
- Browser matching receives the complete normalized HTTP(S) URL and must not reduce it to a registrable/root domain.
- Browser bundle/application-name fallback remains forbidden when no reliable URL match exists.
- The native count and visible suggestion section use the same Agent ordering, three secret fields, eligible groups/reasons, deduplication, and maximum of five.
- Barwarden popup activation preserves the last validated external target; it never becomes an AutoFill matching target.
- The monitor is read-only and must not mutate `TargetAppStore`, fill contexts, reprompt receipts, or fill authorization tokens.
- Raw URLs and candidate metadata remain transient and must not be logged, persisted, placed in errors, or sent to the tray API.
- No browser extension, DOM inspection, Accessibility address-bar inspection, screenshot, OCR, new visual component, or custom tray badge is added.
- Existing uncommitted browser/domain feature work must be preserved; stage only files or exact hunks introduced by this plan.

---

## File Structure

- Create `apps/menubar-tauri/src-tauri/src/suggestion_count.rs`: platform-neutral count policy, Agent query/merge boundary, monitor state reducer, refresh worker, lifecycle notification entry points, and unit tests.
- Create `apps/menubar-tauri/src-tauri/src/suggestion_count_macos.rs`: AppKit workspace observer installation and one-second browser-aware monitoring loop.
- Modify `apps/menubar-tauri/src-tauri/src/frontmost.rs`: expose read-only application name/capture age needed by the monitor without touching fill-target storage.
- Modify `apps/menubar-tauri/src-tauri/src/browser_context.rs`: expose URL normalization for reuse and add a read-only URL helper for an observed browser target.
- Modify `apps/menubar-tauri/src-tauri/src/tray.rs`: retain tray ID, expose tested title formatting/application, and return the built tray handle only if required by the monitor.
- Modify `apps/menubar-tauri/src-tauri/src/main.rs`: register/manage/start the monitor and macOS observer.
- Modify `apps/menubar-tauri/src-tauri/src/autofill_projection.rs`: notify the monitor after projection replace/clear/lock/reset outcomes.
- Modify `apps/menubar-tauri/src-tauri/src/autofill_ipc.rs`: clear/refresh the monitor after Agent lock when needed.
- Modify `apps/menubar-tauri/src-tauri/src/session_broker.rs`: invalidate or refresh on authorization/account lifecycle mutations.
- Create `scripts/menu-bar-suggestion-count-contract.spec.mjs`: source-level parity/privacy/performance guard between native count policy and visible popup policy.
- Modify `package.json`: expose the focused Node contract test if the existing test discovery does not already include it.

---

### Task 1: Agent-Backed Suggestion Count Policy

**Files:**
- Create: `apps/menubar-tauri/src-tauri/src/suggestion_count.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/main.rs`
- Test: `apps/menubar-tauri/src-tauri/src/suggestion_count.rs`

**Interfaces:**
- Consumes: `AgentClient::perform`, `AgentClient::perform_request`, `AgentRequest::candidate_query`, `AgentSessionPayload`, `NativeAutoFillContext`, `RankedCandidate`, `CandidateGroup`, and `AutoFillSecretField`.
- Produces: `pub(crate) const MAX_VISIBLE_SUGGESTIONS: usize = 5`, `pub(crate) fn count_agent_suggestions(client: &dyn SuggestionAgentPort, context: NativeAutoFillContext) -> Result<SuggestionCountSnapshot, AgentErrorCode>`, and `pub(crate) trait SuggestionAgentPort`.

- [ ] **Step 1: Write failing merge and fail-closed tests**

Add tests that construct three field responses and assert:

```rust
#[test]
fn candidate_count_deduplicates_fields_uses_strongest_group_and_caps_at_five() {
    let count = count_eligible_candidates(&[
        response(Username, vec![candidate("a", Exact, "uri_exact"), candidate("b", Other, "favorite")]),
        response(Password, vec![candidate("b", Relevant, "uri_host"), candidate("c", Other, "application_name")]),
        response(Totp, vec![candidate("d", Exact, "uri_exact"), candidate("e", Exact, "uri_exact"), candidate("f", Exact, "uri_exact"), candidate("g", Exact, "uri_exact")]),
    ]).unwrap();
    assert_eq!(count, 5);
}

#[test]
fn candidate_count_rejects_unrelated_other_reasons_and_partial_field_failure() {
    assert_eq!(eligible(CandidateGroup::Other, "favorite"), false);
    assert_eq!(eligible(CandidateGroup::Other, "application_name_similar"), true);
    assert_eq!(count_eligible_candidates(&[ok_username(), failed_password(), ok_totp()]), None);
}
```

Add a port test that verifies status is read before and after the three field queries and that a changed generation, account ID, or vault revision rejects the result.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml suggestion_count::tests -- --nocapture
```

Expected: compilation fails because `suggestion_count` and its policy functions do not exist.

- [ ] **Step 3: Implement the minimal policy and Agent port**

Implement these exact rules:

```rust
pub(crate) const MAX_VISIBLE_SUGGESTIONS: usize = 5;
const ALLOWED_OTHER_REASONS: &[&str] = &[
    "application_name",
    "application_name_similar",
    "fuzzy_name",
];

fn eligible(group: CandidateGroup, reason: &str) -> bool {
    group != CandidateGroup::Other || ALLOWED_OTHER_REASONS.contains(&reason)
}
```

Query `Username`, `Password`, and `Totp` with identical session/context data. Merge by cipher ID, replace evidence only when the new group is stronger (`Exact`, `Relevant`, `Other`), sort by group then first Agent order, filter through `eligible`, and truncate before counting. Require all three responses and require a second Agent status equal to the first status.

Ensure `SuggestionAgentPort` accepts/returns only existing protocol structures and provide an `AgentClient` implementation without logging request context or response metadata.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 1 command again.

Expected: all `suggestion_count::tests` pass.

- [ ] **Step 5: Review the task diff**

Run:

```bash
git diff --check
git diff -- apps/menubar-tauri/src-tauri/src/suggestion_count.rs apps/menubar-tauri/src-tauri/src/main.rs
```

Expected: only the module registration plus tested count policy/Agent seam; no URL or candidate logging.

---

### Task 2: Stale-Safe Monitor State and Tray Title

**Files:**
- Modify: `apps/menubar-tauri/src-tauri/src/suggestion_count.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/tray.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/frontmost.rs`
- Test: `apps/menubar-tauri/src-tauri/src/suggestion_count.rs`
- Test: `apps/menubar-tauri/src-tauri/src/tray.rs`

**Interfaces:**
- Consumes: Task 1 `count_agent_suggestions`, Tauri tray ID `main`, `frontmost::current_frontmost_app`, `frontmost::target_is_running`, and `brand::BUNDLE_IDENTIFIER`.
- Produces: cloneable `pub(crate) struct SuggestionCountMonitor`, `request_context_refresh`, `clear`, `projection_available`, `projection_unavailable`, `format_tray_title(count: Option<usize>) -> String`, and a read-only `ObservedTarget` generation.

- [ ] **Step 1: Write failing reducer and title tests**

Cover:

```rust
assert_eq!(format_tray_title(None), "");
assert_eq!(format_tray_title(Some(0)), "");
assert_eq!(format_tray_title(Some(4)), "4");
assert_eq!(format_tray_title(Some(99)), "5");
```

Use a fake title sink and fake Agent port to prove:

- changing external target publishes `""` before query completion;
- generation 7 cannot publish after generation 8 starts;
- Barwarden becoming frontmost preserves the last external target/title;
- a terminated observed target clears while Barwarden is frontmost;
- identical titles do not call the sink twice.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml suggestion_count::tests tray::tests -- --nocapture
```

Expected: failures for the missing monitor/reducer/title APIs.

- [ ] **Step 3: Implement the monitor reducer and title sink**

Store all mutable observation data behind one `Arc<Mutex<MonitorState>>` and use a monotonic `u64` generation. Define a side-effect-free transition that returns actions such as `ClearTitle`, `QueryApplication`, `ReadBrowserUrl`, or `NoChange`; run I/O after releasing the state lock.

Apply tray titles with:

```rust
let title = format_tray_title(count);
if let Some(tray) = app.tray_by_id("main") {
    tray.set_title(Some(title))?;
}
```

Use `Some("")`, not `None`, when clearing because the resolved macOS `tray-icon` backend only invokes `setTitle` for `Some`.

Expose `FrontmostApp::app_name()` and any read-only identity comparison needed by the reducer. Do not expose or call target-store replacement functions.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 2 command again.

Expected: all focused tests pass and the existing tray click tests remain green.

- [ ] **Step 5: Review the task diff**

Run `git diff --check` and inspect only Task 2 paths. Confirm no fill-context mutation and no title value other than empty or `1`–`5`.

---

### Task 3: macOS Activation/Termination Events and Browser Polling

**Files:**
- Create: `apps/menubar-tauri/src-tauri/src/suggestion_count_macos.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/suggestion_count.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/browser_context.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/main.rs`
- Test: `apps/menubar-tauri/src-tauri/src/suggestion_count.rs`
- Test: `apps/menubar-tauri/src-tauri/src/browser_context.rs`

**Interfaces:**
- Consumes: Task 2 monitor and existing `browser_family`, `MacActiveTabReader`, `CapturedBrowserTarget`, `ActiveTabReader`, and URL validation.
- Produces: `suggestion_count_macos::start(app, monitor)`, one retained activation observer, one retained termination observer, and one one-second loop that calls `monitor.browser_tick()`.

- [ ] **Step 1: Write failing scheduling/browser tests**

Add fake-reader tests proving:

- unsupported and non-browser targets never invoke the browser reader;
- supported browser ticks invoke it at most once per tick;
- identical normalized full URL produces no Agent query/title mutation;
- changed full URL clears first and schedules exactly one query;
- `chrome://`, empty, malformed, permission denied, no-tab, timeout, and stale results clear;
- different paths on the same hostname count as a changed URL because full normalized URL equality is used;
- a late read cannot publish after an external application change.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml suggestion_count browser_context -- --nocapture
```

Expected: new scheduling tests fail for missing observer/tick behavior.

- [ ] **Step 3: Implement native observers and the one-second loop**

Install `NSWorkspaceDidActivateApplicationNotification` and `NSWorkspaceDidTerminateApplicationNotification` on the main thread using the repository's established `RcBlock`/`notificationCenter` pattern. Retain observer tokens for process lifetime. The callbacks only signal/coalesce refresh; they do not read URLs or call the Agent.

Start one named background thread using `park_timeout(Duration::from_secs(1))`. Every tick asks monitor state whether a supported browser is observed. Only then call the existing bounded `MacActiveTabReader`; unchanged URLs stop before Agent IPC.

Refactor `normalized_website_url` to `pub(crate)` and reuse it rather than creating another URL parser. Preserve the full normalized URL in memory and send that exact value as the sole service identifier.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 3 command again.

Expected: all monitor/browser tests pass.

- [ ] **Step 5: Compile the real macOS boundary**

Run:

```bash
cargo check --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml
```

Expected: `objc2` notification callbacks, retained tokens, `AppHandle`, and background work satisfy thread/lifetime constraints.

---

### Task 4: Vault Session and Projection Lifecycle Accuracy

**Files:**
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_projection.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/autofill_ipc.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/session_broker.rs`
- Modify: `apps/menubar-tauri/src-tauri/src/suggestion_count.rs`
- Test: relevant inline Rust test modules.

**Interfaces:**
- Consumes: Task 2 `SuggestionCountMonitor::{projection_available, projection_unavailable, request_context_refresh, clear}` as Tauri managed state.
- Produces: lifecycle notifications after successful projection replace, before/after clear/lock/reset as appropriate, after Agent lock, and after session authorization/account mutations.

- [ ] **Step 1: Write failing lifecycle notification tests**

Use a recording notifier seam to assert:

- successful projection replacement requests refresh;
- failed replacement does not publish a count;
- clear, lock, reset, logout, account change, recovery-required, or Agent lock clear immediately;
- unlock alone stays empty until successful projection replacement;
- sync-only mutations do not cause redundant refresh unless projection replacement succeeds.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml autofill_projection autofill_ipc session_broker suggestion_count -- --nocapture
```

Expected: notification expectations fail before lifecycle integration.

- [ ] **Step 3: Inject and call the managed monitor without changing command outcomes**

Add `tauri::State<'_, SuggestionCountMonitor>` only to affected command signatures. Preserve existing return types and error mapping. Clear before destructive lifecycle operations so old numbers disappear immediately; request refresh only after a successful projection replace/provision. Session `Unlocked` does not query until projection replacement confirms Agent availability.

Do not emit URLs, candidates, or secret values in lifecycle events. Do not let monitor notification failure turn a successful projection/session command into an error.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 4 command again.

Expected: lifecycle tests and existing command tests pass.

- [ ] **Step 5: Review overlapping dirty files carefully**

Run:

```bash
git diff --check
git diff -- apps/menubar-tauri/src-tauri/src/autofill_projection.rs apps/menubar-tauri/src-tauri/src/autofill_ipc.rs apps/menubar-tauri/src-tauri/src/session_broker.rs
```

Expected: existing domain/browser changes remain intact; only monitor notification parameters/calls are added by this task.

---

### Task 5: Native/Popup Policy Drift Guard

**Files:**
- Create: `scripts/menu-bar-suggestion-count-contract.spec.mjs`
- Modify: `package.json` only if focused script registration is needed.
- Test: `apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts`

**Interfaces:**
- Consumes: native `MAX_VISIBLE_SUGGESTIONS`/allowed-other reasons and frontend `visibleCandidates`/`CONTEXTUAL_OTHER_REASONS`.
- Produces: a static contract test that fails if maximum, field set, allowed reasons, browser fail-closed policy, or privacy/performance guards drift.

- [ ] **Step 1: Write the failing Node contract test**

Read the Rust monitor, frontend contextual-candidate service/component, browser reader, and tray source. Assert exact shared constants:

```js
assert.deepEqual(nativeAllowedOtherReasons, [
  "application_name",
  "application_name_similar",
  "fuzzy_name",
]);
assert.equal(nativeMaximum, 5);
assert.match(frontend, /\.slice\(0, 5\)/u);
assert.match(native, /Username[\s\S]*Password[\s\S]*Totp/u);
```

Also reject URL/candidate logging, unconditional non-browser polling, tray metadata beyond the formatted count, and mutation of `TargetAppStore` from the monitor.

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
node --test scripts/menu-bar-suggestion-count-contract.spec.mjs
```

Expected: failure until the native source contains the complete implementation markers.

- [ ] **Step 3: Complete exact contract markers without changing UI**

Make constants and field ordering explicit enough for deterministic source validation. Keep the existing `VaultAutoFillSuggestionsComponent` markup and styles unchanged. Add a frontend behavioral test only if an uncovered eligibility case is found; do not add a second suggestion component.

- [ ] **Step 4: Run Node and targeted Vitest suites**

Run:

```bash
node --test scripts/menu-bar-suggestion-count-contract.spec.mjs
npx vitest run apps/menubar-tauri/src/app/autofill/autofill-contextual-candidates.service.spec.ts apps/menubar-tauri/src/app/vault/vault-autofill-suggestions.component.spec.ts apps/menubar-tauri/src/app/vault/vault-autofill-page.component.spec.ts
```

Expected: all pass; UI snapshots/DOM still contain exactly one existing suggestion section.

---

### Task 6: Full Verification, Signed Packaging, and Live Switching

**Files:**
- Verify all files changed by Tasks 1–5.
- Update no product UI or evidence file unless the repository packaging workflow generates an already-defined artifact.

**Interfaces:**
- Consumes: complete monitor, existing signed release builder, installed `/Applications/Barwarden.app`, current Agent registration, and supported local browsers.
- Produces: verified signed installed build and observed real-time count behavior.

- [ ] **Step 1: Run formatting and complete automated tests**

Run:

```bash
cargo fmt --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml -- --check
cargo test --manifest-path apps/menubar-tauri/src-tauri/Cargo.toml
npm test -- --runInBand
npm run build:web
swift test --package-path apps/macos-autofill
node --test scripts/menu-bar-suggestion-count-contract.spec.mjs
git diff --check
```

If the repository's npm runner does not accept `--runInBand`, run its existing unmodified `npm test` command. Expected: all non-live tests pass; pre-existing ignored native tests remain ignored and are reported.

- [ ] **Step 2: Build with the repository's signed native AutoFill workflow**

Use `scripts/build-native-autofill-release.sh` with the repository's configured Developer ID inputs, then run `scripts/verify-native-autofill-bundle.sh` against the produced app/DMG. Do not ad-hoc resign, use `codesign --deep` for signing, remove quarantine recursively, or bypass notarization/signature policy.

Expected: Agent, Credential Provider, outer app, and DMG pass strict signature and exact identifier/team checks.

- [ ] **Step 3: Replace the installed app recoverably**

Resolve the exact new `.app`, verify it read-only, copy the current `/Applications/Barwarden.app` to a unique `/private/tmp/Barwarden-before-suggestion-count-...` backup, then atomically install the verified build. Restart only the exact Barwarden main/Agent processes if required and verify the Agent executable resolves under `/Applications/Barwarden.app/Contents/Helpers/`.

Expected: one installed signed app and the current v2 Agent protocol endpoint.

- [ ] **Step 4: Perform live context switching**

Verify observable behavior:

1. Matched external application shows `1`–`5`; unmatched application clears immediately.
2. Clicking the tray icon preserves the number and the popup displays the same suggestion count/first item.
3. Chrome/Chromium-family matched and unmatched HTTP(S) tabs update within one second using the full URL.
4. Safari-family behavior matches when available and authorized.
5. Internal/unreadable tabs clear; no application-name fallback suggestions appear for browsers.
6. Lock clears immediately; unlock returns only after projection refresh.
7. Popup closed/hidden monitoring continues and the process remains alive.

- [ ] **Step 5: Inspect efficiency and process stability**

With a non-browser frontmost, confirm no repeated `osascript` child appears. With a supported browser frontmost, confirm at most one bounded browser read per second and no Agent query for an unchanged URL using fixed, metadata-free diagnostics or test counters—not raw URL logging. Confirm Barwarden and Agent PIDs stay alive through repeated switches.

- [ ] **Step 6: Final diff and completion audit**

Run `git status --short`, `git diff --check`, inspect every changed path, and report:

- automated test totals and ignored tests;
- signed artifact verification result;
- installed main/Agent paths;
- live application/browser/lock observations;
- any browser family not available for real testing;
- the untouched pre-existing dirty-file set.

Do not claim completion until fresh outputs from all applicable checks are available.
