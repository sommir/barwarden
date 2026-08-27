# Context-Aware Native AutoFill Design

## Objective

Make native macOS AutoFill understand the focused field and its surrounding login form so the user chooses an account, not a secret type. The default path must:

1. place a visible PopClip-style AutoFill affordance above the text caret or focused field;
2. infer username/email, password, and one-time-code fields locally;
3. offer a single account action that fills the inferred field or complete login form;
4. retain explicit per-field icon actions as a low-confidence fallback;
5. expose the same context-aware fill action from an active Login item's detail view; and
6. fill detected fields without ever submitting the form.

The implementation is generic. It must not contain Termius-specific bundle identifiers, application names, labels, or layout rules.

## Confirmed product decisions

- A user action may fill every confidently identified field in one login form.
- AutoFill never presses Return or Tab, invokes a submit action, clicks a login button, or otherwise submits a form.
- High-confidence inference removes the manual username/password/TOTP selector from the default picker flow.
- Low-confidence inference does not guess. It exposes explicit username, password, and TOTP actions for the selected Login item.
- Approximate account matching remains a separate safety boundary. A field classification cannot waive an existing mismatch confirmation or reprompt requirement.
- Accessibility metadata and geometry stay on the device. No classification input, label, identifier, or form structure is uploaded or added to telemetry.

## Current-state findings

The current focused-field reader intentionally permits only role, subrole, position, size, and window. It can distinguish a secure text field from an ordinary text field, but it has no evidence for email, username, one-time code, or form membership. The picker consequently defaults to password and asks the user to choose a secret type.

The floating action is a transparent 28-point panel with a 24-point template image placed beside the field. In dark applications the template image can lose contrast, and placing it outside the trailing field edge disconnects it from the caret.

The Login detail view already has optional per-field fill controls, but `canFill` reflects item capability rather than a fresh, preserved external fill context. It does not provide a contextual whole-form action.

## Considered approaches

### 1. Keyword-only focused-field inference

Read a few strings from the focused element and map words such as `email`, `password`, and `code` directly to a field type. This is quick but weak across custom controls, localized applications, missing placeholders, and ambiguous words such as `account` or `passcode`. It also cannot reliably identify a form.

### 2. Bounded AX semantic classifier plus form graph — selected

Combine role/subrole, accessible labels, placeholder, identifier, hierarchy, writable state, and geometry in an explainable fixed-point score. Inspect a bounded set of sibling text fields to construct a login-form graph. High-confidence results drive the default action; ambiguous results retain explicit field controls.

This approach is local, deterministic, testable with synthetic AX observations, and compatible with the existing Accessibility permission and stale-target protections.

### 3. Screenshot OCR or vision classification

Infer labels and controls from pixels when AX metadata is poor. This broadens coverage but requires additional screen-capture permission, increases privacy exposure and latency, and makes target binding harder to prove. It is excluded from this implementation. A future opt-in fallback would require a separate design and threat review.

## Architecture

The feature is split into five bounded units.

### `FocusedFieldReader`

Reads a strict allowlist of accessibility metadata from the focused element and a bounded surrounding subtree. It never reads `AXValue` or selected text. It may query whether `AXValue` and `AXFocused` are settable.

Allowed focused/form metadata:

- `AXRole`, `AXSubrole`, and `AXRoleDescription`;
- `AXTitle`, `AXDescription`, `AXHelp`, `AXPlaceholderValue`, and `AXIdentifier`;
- `AXTitleUIElement` where available, followed only by its label metadata;
- `AXParent`, `AXChildren`, and `AXWindow` for bounded structure discovery;
- `AXPosition`, `AXSize`, `AXEnabled`, and writable-state queries;
- `AXSelectedTextRange` as a range only; and
- `AXBoundsForRange` for caret geometry when supported.

The reader rejects values with an unexpected Core Foundation or AX type, oversized strings, invalid geometry, stale elements, terminated applications, or work that exceeds a fixed budget.

Bounds:

- at most 3 ancestors above the focused field;
- at most 256 descendants in the selected form/window subtree;
- at most 20 writable text or secure-text candidates;
- at most 255 Unicode scalars per semantic string;
- at most 50 milliseconds for one observation; and
- one captured external application instance, PID, window, and observation generation.

### `FieldSemanticClassifier`

Produces a `DetectedField` for every inspected writable text element:

```text
DetectedField {
  kind: username | email | password | oneTimeCode | unknown
  secretField: username | password | totp | none
  confidence: high | medium | low
  score: internal fixed-point integer
  evidence: internal bounded bit set
  frame: screen-space rectangle
  isFocused: boolean
}
```

The numerical score and raw semantic strings remain native-internal. The web view receives only the kind, confidence, and safe presentation labels.

Strong evidence:

- secure-text role or subrole: password;
- unambiguous accessible terms such as `password`, `email`, `username`, `one time code`, `verification code`, `otp`, and localized equivalents;
- explicit title-element relationships; and
- a single writable text field immediately preceding a single secure field in the same bounded container: username/email form evidence.

Supporting evidence:

- identifier and placeholder tokens;
- role description and help text;
- relative order and alignment inside the same container; and
- nearby high-confidence fields.

Conflicting evidence is retained rather than overwritten. Classification is:

- high when the winning score is at least 80 and leads the next kind by at least 25;
- medium when the winning score is at least 55 and leads by at least 15; and
- low otherwise.

Evidence contributes at most once per source and field kind, and each field-kind score is capped at 100:

| Evidence source | Score |
| --- | ---: |
| Secure-text role/subrole for password | 100 |
| Exact semantic term through a linked title element | 80 |
| Exact semantic term in title or placeholder | 70 |
| Exact semantic term in identifier | 55 |
| Exact semantic term in description, help, or role description | 45 |
| Single text field immediately preceding a single secure field in the same container | 35 username/email |
| Consistent alignment/order with another high-confidence field | 15 |
| Ambiguous term without a more specific phrase | 20 |

Initial locale-stable semantic sets cover English and Simplified/Traditional Chinese:

- username: `username`, `user name`, `login`, `login id`, `用户名`, `使用者名稱`, `账号`, `帳號`;
- email: `email`, `e-mail`, `email address`, `邮箱`, `郵箱`, `电子邮件`, `電子郵件`;
- password: `password`, `passwd`, `pwd`, `密码`, `密碼`;
- one-time code: `one time code`, `one-time password`, `verification code`, `authenticator code`, `otp`, `2fa`, `验证码`, `驗證碼`, `动态码`, `動態碼`.

Matching uses normalized complete tokens/phrases, not arbitrary substring containment. Generic words such as `account`, `user`, `code`, `passcode`, `security`, `登录`, and `登入` are ambiguous evidence only. Additional locales extend the reviewed semantic sets; they do not add application-specific rules.

The weights are centralized constants covered by table-driven tests. A secure-text role is conclusive for password unless the element is invalid or not writable. Ambiguous words cannot reach medium or high confidence by themselves.

### `LoginFormDetector`

Groups detected fields by their nearest bounded shared container and window. A whole-form action is available only when:

- the focused field belongs to the group;
- the group contains exactly one password field;
- it contains at most one username/email field and at most one one-time-code field;
- every field selected for automatic fill has medium or high confidence;
- there is no second password, new-password, confirm-password, or conflicting field; and
- the application, PID, window, elements, and generation are still live.

The primary form action contains fields in semantic order: username/email, password, then one-time code. A TOTP field is included only when it exists in the detected form and the selected Login item has a TOTP secret. A standalone one-time-code page remains a single-field action.

Multiple password fields, ambiguous sign-up/password-change forms, duplicate username fields, or disconnected fields disable whole-form fill. The user can still invoke explicit field actions.

### `DetectedFillContextStore`

Keeps the external target stable while Barwarden becomes frontmost. It stores a bounded native-only context containing retained/revalidated AX element identities and issues an opaque context token to the UI.

Each context is bound to:

- bundle identifier and exact running-application instance;
- PID and window identity;
- observation generation;
- focused field and detected form fields;
- field kinds and confidence; and
- a 30-second absolute deadline.

The store has a fixed capacity of 64 contexts. Application activation, focus change, window destruction, field movement outside the accepted geometry, permission loss, or explicit cancellation invalidates the context. The token is consumed when the requested action finishes or fails; it cannot target arbitrary AX elements.

### `NativeFillExecutor`

Executes only fields included in a live detected context.

For each field:

1. revalidate application, PID, window, element identity, generation, kind, and requested secret field;
2. obtain the already-authorized secret for that exact field;
3. prefer `AXUIElementSetAttributeValue` when `AXValue` is writable;
4. otherwise focus the exact validated element and use the existing guarded paste path;
5. clear application-owned transient buffers; and
6. revalidate before continuing to the next field.

The executor never discovers the next field by sending Tab and never sends Return. It never invokes AXPress on a submit control. A partial failure stops the sequence and returns a bounded result such as `username: filled, password: unavailable`; it does not continue guessing.

## Field and form context contract

The existing entry-context response is extended with safe presentation metadata and an opaque native context token:

```text
available {
  bundleId
  appName
  fillContextToken
  focusedField: {
    kind
    secretField?
    confidence
  }
  action: {
    mode: field | form | choose
    fields: [username | password | totp]
  }
}
```

Unknown keys, oversized collections, duplicate fields, invalid combinations, and unknown enum values fail closed. AX labels, placeholders, identifiers, geometry, PIDs, and element handles do not cross into the candidate response or Agent protocol.

Candidate queries continue to run once per available secret field so the Agent preserves field-scoped, one-time authorization. The picker merges metadata by cipher ID and retains the field-specific authorization context internally. A whole-form action may proceed only when the same candidate is currently authorized for every requested field.

## Floating action design

### Placement

The preferred anchor is the insertion caret:

1. read `AXSelectedTextRange` without reading text;
2. request `AXBoundsForRange` for the zero-length insertion range;
3. place the action centered above that caret rectangle with an 8-point gap;
4. if caret bounds are unsupported or unreliable, center it above the focused field;
5. if the top placement does not fit, flip below the anchor; and
6. clamp the final frame to the current screen's visible work area.

The old trailing/leading placement is removed from the normal path. If neither top nor bottom placement is safe, the action stays hidden.

### Appearance

The action is a 34-by-30-point nonactivating pill, not a transparent square:

- adaptive raised material with an opaque high-contrast fallback;
- 9-point corner radius;
- one-pixel contrast border and restrained shadow;
- blue Barwarden glyph plus a small person, lock, clock, or form badge;
- minimum 24-point icon artwork with no template tint that can disappear on dark content;
- tooltip and accessibility label describing the inferred action; and
- stronger border/glyph treatment under Increase Contrast or Reduce Transparency.

The panel remains unable to become key or main and never steals field focus. Movement uses a short, critically damped transition only when Reduce Motion is off. Focus loss, app switch, scrolling/movement notification, stale generation, or click immediately hides it.

This follows the PopClip interaction principle of showing a compact, high-contrast action adjacent to the user's current insertion point rather than at an unrelated window location.

## Picker interaction design

### Context header

The current manual field segmented control is removed from the default layout. Under the target application card, the picker shows one contextual status chip:

- `正在填写：邮箱`;
- `正在填写：密码`;
- `正在填写：验证码`;
- `检测到登录表单：用户名 + 密码`; or
- `无法确定字段类型，请选择要填入的内容`.

This status is presentation-only. It does not reveal raw AX labels or identifiers.

### Candidate rows

Each row keeps the item name, username, group, and fixed localized match reason. The row body opens Login details. The trailing action area is separate from detail navigation.

When the context is confident, the primary action is explicit:

- person icon and `填入用户名`;
- lock icon and `填入密码`;
- clock icon and `填入验证码`; or
- combined person-and-lock icon and `填充登录表单`.

When confidence is low, or when the user expands secondary actions, the row exposes only fields that the Login item actually contains:

- person icon for username;
- lock icon for password; and
- clock icon for TOTP.

Every icon has a tooltip, accessible name, focus state, and at least a 28-point hit target. The generic `填入` label is not used without identifying what will be filled.

Search continues to cover all active Login items and preserves the current exact/relevant/other grouping. Search does not reset the inferred field or form context.

### Activation

- Clicking a candidate's primary action performs the inferred field/form action.
- Clicking the row body opens that Login item's details without releasing a secret.
- Pressing Enter on a highlighted row selects/opens actions; it does not silently fill.
- Approximate candidates require the existing mismatch confirmation before any field is released.
- Reprompt-protected items retain the existing Touch ID/master-password flow.

## Login detail interaction design

When a Login detail is opened from the picker and a live fill context remains valid, the detail page shows a contextual action card above credentials:

```text
Termius · 登录表单
[person] 用户名  [lock] 密码
[填充登录表单]
```

For a single field, the button reads `填入用户名`, `填入密码`, or `填入验证码`. The card includes the target application name and never claims a form action when the native context is low confidence.

The existing per-field fill buttons remain beside username, password, and TOTP. They use person, lock, and clock icons respectively instead of a generic sign-in icon.

The contextual card is absent when the item is archived/deleted, the detail was opened without a preserved external context, the context has expired, the target application changed, or the Login item lacks every requested secret. Opening details never triggers filling by itself.

## End-to-end data flow

1. A third-party application focuses an editable text element.
2. The observer invalidates the previous generation and `FocusedFieldReader` captures bounded semantic metadata and caret/field geometry.
3. `FieldSemanticClassifier` classifies fields; `LoginFormDetector` creates a field, form, or choose action.
4. `DetectedFillContextStore` retains the exact native target and issues an opaque token.
5. The PopClip-style action appears above the caret/field with the inferred field badge.
6. The user clicks it. Barwarden opens the picker using the preserved target and context token.
7. The picker queries field-scoped candidates and presents one inferred primary action plus explicit available field icons.
8. The user chooses an action. Mismatch confirmation and reprompt occur when required.
9. The Agent atomically authorizes/releases each exact requested field; the native executor revalidates and fills the corresponding captured AX element.
10. The executor stops on the first failure, reports a bounded partial result, clears transient buffers, consumes the context, and never submits.

## Error and fallback behavior

| Condition | Behavior |
| --- | --- |
| Secure role only | High-confidence password action |
| Semantic label but no safe form | Inferred single-field action |
| Unknown/ambiguous field | Explicit username/password/TOTP icons |
| Multiple password fields | No whole-form action |
| Caret bounds unavailable | Anchor above focused field |
| No safe top/bottom placement | Hide floating action |
| AX metadata read/type failure | Fail closed; no raw diagnostic in UI |
| Direct AX write unsupported | Exact-element guarded paste fallback |
| Target/focus/generation changed | Stop and report target changed |
| One field in a form fails | Stop; report filled and unfilled fields |
| Candidate lacks an inferred secret | Disable/omit that action |
| Context expires in picker/detail | Remove contextual action and require reopening AutoFill |

Diagnostics remain fixed codes plus a validated bundle identifier where already permitted. Labels, placeholders, identifiers, field values, and secrets never appear in logs.

## Security and privacy invariants

- Classification never reads `AXValue`, selected text, clipboard contents, or screen pixels.
- A fill context can reference only elements discovered in its bounded observation.
- Tauri commands remain restricted to the main Barwarden webview and require an opaque live context token.
- Candidate authorization remains bound to account, generation, vault revision, policy, candidate, field, and one-time context token.
- Whole-form fill does not combine candidates; every field comes from the same selected Login item.
- A single mismatch confirmation may cover one visible whole-form action, but every field release independently enforces the candidate's mismatch policy.
- Reprompt authorization remains field-scoped and one-time. A multi-field action requests only the grants it needs.
- No action auto-submits, synthesizes navigation keys, or presses unrelated controls.
- All application-owned secret buffers are cleared on success, error, cancellation, and stale-target paths to the extent allowed by existing Foundation/JavaScript boundaries.

## Accessibility and motion

- The floating pill exposes a descriptive accessibility label and remains reachable through the existing keyboard shortcut even if the visual fallback is unavailable.
- Picker icon buttons have textual names and visible focus rings; meaning never depends on color alone.
- Context chips and partial-fill outcomes are announced through a single polite status region.
- Reduce Motion disables position interpolation. Reduce Transparency uses an opaque surface. Increase Contrast strengthens border and glyph contrast.
- The picker retains Arrow-key list navigation, nearest-item scrolling, and dialog focus trapping.

## Test strategy

### Native classifier and form tests

- Secure field classifies as password without semantic strings.
- `Email`, `E-mail address`, `用户名`, and equivalent metadata map to username/email.
- `OTP`, `2FA`, `verification code`, and `验证码` map to one-time code.
- Ambiguous `account` and `passcode` fixtures do not become high confidence alone.
- Title-element, placeholder, identifier, sibling order, and container evidence combine deterministically.
- Missing/malformed/wrong-type/oversized AX metadata fails closed and releases copied objects exactly once.
- A username plus one password produces a form; duplicate password/new-confirm fixtures do not.
- Input order permutations produce the same classification and form action.
- Traversal/time/candidate bounds stop work without exposing partial unsafe context.

### Placement and panel tests

- Caret bounds place the pill above the caret with the expected gap.
- Unsupported caret bounds fall back above the field.
- Top-edge placement flips below; multi-display placement uses the correct visible frame.
- Offscreen or unsafe geometry hides the panel.
- Dark/light, Increase Contrast, Reduce Transparency, and Reduce Motion contracts are represented in native appearance tests.
- App/focus/window/scroll/move/destroy notifications invalidate and hide before stale callbacks can show or click the panel.

### Picker and detail tests

- High-confidence context has no manual segmented selector.
- Username/password/TOTP/form contexts show the correct primary label and icon.
- Unknown context shows explicit available field icons.
- Candidate body navigation does not release; an explicit action releases only requested fields.
- Whole-form fill uses one candidate and fills fields in username/password/TOTP order without submit, Tab, or Return.
- Approximate candidates still require confirmation.
- Detail contextual action appears only for a live compatible context and disappears when stale.
- Archived/deleted items and missing secrets never expose an invalid fill action.
- Keyboard and screen-reader names cover every icon action and partial-fill status.

### Deterministic race and security tests

- Focus/app/window changes between observation, picker opening, release, and each field write stop the action.
- Context expiry, replay, capacity exhaustion, mismatched field kind, and wrong webview fail closed.
- Projection replacement, vault lock, account switch, or reprompt cancellation invalidates pending form actions.
- One field failing after a prior success returns an exact partial result and does not continue.
- Candidate and wire responses remain free of AX labels, identifiers, geometry, URI secrets, passwords, and TOTP seeds.

### Live macOS 26 verification

- Verify caret-above and field-above fallback placement in a native AppKit field and an Electron field.
- Verify username/email, secure password, standalone OTP, and username-plus-password forms.
- Verify high-contrast pill visibility over light and dark applications.
- Verify one-click whole-form fill populates the expected fields and does not submit.
- Verify explicit username/password/TOTP icon actions and the detail contextual action.
- Verify stale focus, window movement, app switch, and permission loss hide/disable the flow.

Lower macOS versions retain the deployment and availability checks already present, but this feature's live acceptance is macOS 26 only.

## Implementation boundaries

- Browser-extension DOM form detection is not part of this change. When the future browser extension provides stronger field semantics, it may implement the same safe `fillContext` presentation contract.
- No OCR, screenshot capture, cloud classification, telemetry, or learned model.
- No application-specific adapters or hardcoded product aliases.
- No form submission or login-button automation.
- No card, identity, address, or arbitrary custom-field form filling in this iteration.
- No change to account-match scoring except consuming its existing groups, reasons, confirmation, and field-scoped authorization.

## Acceptance criteria

The feature is acceptable when all of the following are true on macOS 26:

1. The floating affordance is visibly anchored above the caret or focused field and remains legible over light and dark content.
2. A normal email/username, password, or OTP field opens the picker with the correct inferred action and no default manual field selector.
3. A safe username-plus-password form offers one explicit whole-form action and fills both fields without submitting.
4. Ambiguous contexts expose explicit field icons rather than silently guessing.
5. Every candidate action states and visually indicates what it will fill.
6. A Login detail opened with a live context exposes the compatible single-field or whole-form action.
7. No Termius-specific rule is present; synthetic and live applications exercise the same generic classifier.
8. Existing mismatch confirmation, reprompt, projection, stale-target, and one-time authorization tests remain green.
