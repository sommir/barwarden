# Smart AutoFill Row Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each AutoFill candidate show all available username/password/TOTP capabilities, offer one context-aware “填入” action, remove the redundant visible detected-field chip, and keep row hover/selection visually continuous.

**Architecture:** Keep native context detection and `AutoFillFillActionService` as the only authority for the field scope that is released. Split the picker’s current context-filtered field helper into a read-only candidate capability projection and a detected-action intersection, then let the outer row own pointer hover, focus-within, keyboard highlight, and selected styling.

**Tech Stack:** Angular standalone component, TypeScript, Angular/Vitest component tests, existing Bitwarden icon font, existing CSS tokens, existing native AutoFill context/action services.

## Global Constraints

- Do not change Agent authorization, receipt, release, projection, or native field-detection semantics.
- Use only `bwi-user`, `bwi-lock`, and `bwi-clock`; do not add handcrafted SVG, emoji, or CSS-drawn icons.
- Candidate capability order is exactly username → password → TOTP.
- Capability icons are read-only and never release secrets.
- The generic “填入” action is unavailable in low-confidence `choose` mode; existing explicit fallback actions remain fail-closed.
- The visible detected-field chip is removed, but the existing polite live region still announces detected context.
- The outer candidate row owns one continuous hover, focus-within, keyboard-highlight, and selected treatment across body, capabilities, and action.
- The final visual gate uses a real Angular picker render at exactly 480×600.

---

### Task 1: Lock the candidate capability and automatic action contract

**Files:**
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts`

**Interfaces:**
- Consumes: `ContextualCandidate.availableFields`, `ContextualCandidate.authorizations`, and `DetectedAutoFillContext.action.fields`.
- Produces: `candidateCapabilityFields(candidate): readonly AutoFillSecretField[]`, `actionableFields(candidate): readonly AutoFillSecretField[]`, and a generic localized `primaryActionLabel`.

- [ ] **Step 1: Write the failing component tests**

Add tests that render username, password, TOTP, and form contexts and assert:

```ts
expect(host.querySelector("[data-testid^='autofill-context-']")).toBeNull();
expect(liveRegion.textContent).toContain("已识别用户名");
expect(capabilityFields(row)).toEqual(["username", "password", "totp"]);
expect(primary.getAttribute("aria-label")).toBe("填入");
```

Add a missing-field case whose candidate has only username/password and assert that no TOTP icon is rendered. Click the generic primary action in each confident context and assert the existing `nativeHost.fillDetected` request contains exactly the detected canonical field sequence. Keep the current `choose` test asserting no generic primary action exists.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts
```

Expected: FAIL because the context chip remains, `availableFields` is context-filtered, capability icons do not exist, and the primary label is field-specific.

- [ ] **Step 3: Implement the minimal picker projection**

Remove the visible context-chip block from the ready template. Add a decorative capability group before the primary action:

```html
<span
  class="autofill-picker__capabilities"
  [attr.data-testid]="'autofill-capabilities-' + candidate.cipherId"
  [attr.aria-label]="capabilityLabel(candidate)"
>
  @for (field of candidateCapabilityFields(candidate); track field) {
    <i class="bwi" [class.bwi-user]="field === 'username'" [class.bwi-lock]="field === 'password'" [class.bwi-clock]="field === 'totp'" aria-hidden="true"></i>
  }
</span>
```

Keep the context-filtered authorization check separate:

```ts
candidateCapabilityFields(candidate: PickerCandidate): readonly AutoFillSecretField[] {
  if (!this.isDetectedCandidate(candidate)) return Object.freeze(["password"]);
  return Object.freeze(FIELD_ORDER.filter((field) => (
    candidate.availableFields.includes(field) && candidate.authorizations.has(field)
  )));
}

actionableFields(candidate: PickerCandidate): readonly AutoFillSecretField[] {
  const capabilities = this.candidateCapabilityFields(candidate);
  return Object.freeze((this.detectedContext?.action.fields ?? []).filter((field) => capabilities.includes(field)));
}
```

Use `actionableFields` for primary eligibility and explicit fallback execution. Return `translateOfficialMessage("i18nAutofillFill")` from `primaryActionLabel`. Keep `contextLabel` only for the live-region announcement.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same Vitest command. Expected: all picker component tests PASS, including exact field scopes and low-confidence fail-closed behavior.

- [ ] **Step 5: Commit the behavior contract**

```bash
git add apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts
git commit -m "feat: add smart autofill row actions"
```

---

### Task 2: Make candidate hover and selection one continuous surface

**Files:**
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.css`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts`
- Modify: `apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts`

**Interfaces:**
- Consumes: `.autofill-picker__candidate-row--highlighted`, the candidate body focus event, and the existing listbox keyboard highlight.
- Produces: a single outer row state for `:hover`, `:focus-within`, keyboard highlight, and `[aria-selected="true"]`.

- [ ] **Step 1: Write the failing row-state interaction test**

Render two candidates, dispatch `mouseenter` and focus events on both the body and trailing “填入” button, and assert the matching outer row receives the highlighted state while child surfaces remain transparent. Verify ArrowDown changes the same outer row class and Enter selects without triggering fill.

```ts
const row = primary.closest(".autofill-picker__candidate-row")!;
primary.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
expect(row.classList).toContain("autofill-picker__candidate-row--highlighted");
expect(row.querySelector(".autofill-picker__candidate")?.classList)
  .not.toContain("autofill-picker__option--highlighted");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run the picker Vitest command. Expected: FAIL because action hover/focus does not update candidate highlight and the body still owns a second highlighted/focus treatment.

- [ ] **Step 3: Move interaction state to the outer row**

Bind candidate highlighting on the outer row with bubbling-safe `mouseenter`/`focusin`. Remove the child `autofill-picker__option--highlighted` visual class. In CSS:

```css
.autofill-picker__candidate-row:hover,
.autofill-picker__candidate-row:focus-within,
.autofill-picker__candidate-row--highlighted,
.autofill-picker__candidate-row:has([aria-selected="true"]) {
  background: var(--mac-hover);
  box-shadow: inset 0 0 0 2px var(--mac-focus);
}

.autofill-picker__candidate,
.autofill-picker__candidate-actions {
  background: transparent;
}
```

Keep the outer group border and radius intact, keep child focus rings inset, and ensure neither body nor actions create a seam. Style `.autofill-picker__capabilities` as a compact noninteractive icon group using current text-secondary/accent tokens.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the picker Vitest command. Expected: all tests PASS; pointer and keyboard interaction use the same outer row.

- [ ] **Step 5: Commit the continuous row surface**

```bash
git add apps/menubar-tauri/src/app/autofill/autofill-picker.component.css apps/menubar-tauri/src/app/autofill/autofill-picker.component.ts apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts
git commit -m "fix: unify autofill row interaction states"
```

---

### Task 3: Rendered design QA and regression gate

**Files:**
- Create: `.superpowers/sdd/2026-08-11-smart-autofill-row-actions/design-qa.md`
- Create: `.superpowers/sdd/2026-08-11-smart-autofill-row-actions/autofill-row-actions.png`
- Create: `.superpowers/sdd/2026-08-11-smart-autofill-row-actions/autofill-row-actions-comparison.png`
- Modify only if required by exact hash guards: `.superpowers/recovery/official-recovery.transform-manifest.json`

**Interfaces:**
- Consumes: the real Angular `AutoFillPickerComponent` and a deterministic synthetic Termius fixture with username/password/TOTP metadata.
- Produces: actual 480×600 rendered evidence and a same-state side-by-side comparison against the selected reference.

- [ ] **Step 1: Build a temporary deterministic visual harness**

Use the existing Task 6/7 harness pattern to render the real picker component at 480×600 with synthetic, non-secret values. The fixture must show a confident detected field, a Termius candidate with all three capability icons, a generic “填入” action, and a highlighted candidate row. Do not commit the harness.

- [ ] **Step 2: Capture and compare the real component**

Capture `autofill-row-actions.png` at exactly 480×600. Build `autofill-row-actions-comparison.png` with the selected screenshot and implementation in the same state. Inspect spacing, truncation, icon order, continuous hover outline/background, popup crop, focus treatment, and contrast. Record zero unresolved P0/P1/P2 issues in `design-qa.md` and end it with `final result: passed` only after the comparison passes.

- [ ] **Step 3: Remove the temporary harness and run focused guards**

Run:

```bash
npx vitest run \
  apps/menubar-tauri/src/app/autofill/autofill-picker.component.spec.ts \
  apps/menubar-tauri/src/app/autofill/autofill-fill-action.service.spec.ts \
  apps/menubar-tauri/src/app/autofill/autofill-context-session.service.spec.ts \
  apps/menubar-tauri/src/app/tauri-host.service.spec.ts \
  apps/menubar-tauri/src/app/recovery-overlay-integrity.spec.ts
```

Expected: PASS with no temporary harness files remaining.

- [ ] **Step 4: Run production and broad regression verification**

Run serially:

```bash
npm run build:web
npx vitest run
git diff --check
```

Expected: production build PASS, all Vitest suites PASS (repository-declared skips allowed), and diff check PASS.

- [ ] **Step 5: Commit QA evidence and any exact manifest update**

```bash
git add -f .superpowers/sdd/2026-08-11-smart-autofill-row-actions \
  .superpowers/recovery/official-recovery.transform-manifest.json
git commit -m "test: verify smart autofill row design"
```

## Self-review

- Spec coverage: visible chip removal, full candidate capabilities, generic context-aware fill, fail-closed choose mode, continuous hover/focus/highlight, accessibility, and 480×600 visual QA are each mapped to a task.
- Placeholder scan: no TBD/TODO/“similar to” placeholders remain.
- Type consistency: `candidateCapabilityFields` is read-only display metadata; `actionableFields` is the detected authorization intersection used by fill eligibility and field actions.
