# Layered AutoFill Context Design

## Goal

AutoFill suggestions must remain useful whenever Barwarden can identify the frontmost external application. Detecting a writable field or form improves the available actions, but must never be a prerequisite for showing application-matched vault items.

## Context Model

The native boundary exposes two independently valid layers:

1. **Application context** identifies the exact frontmost application instance using bundle identifier, process identifier, native running-application identity, and a bounded capture time. This context is sufficient for candidate ranking.
2. **Fill context** optionally describes a currently focused writable field or detected form. It remains bound to the exact application, window, field identities, and observer generation. This context authorizes direct native filling.

An application context may be available while its fill context is unavailable. That state is successful degraded operation, not a target-unavailable error.

## Entry and Refresh Flow

When AutoFill is opened from the shortcut, menu, or floating action:

1. Capture the frontmost external application before Barwarden becomes frontmost.
2. Persist the exact application context even if Accessibility field capture fails.
3. Query Agent candidates using application metadata in every application-available state.
4. Attach fill capabilities only when a live fill context was captured and still validates.
5. If the application changes, recapture and rerank. Never reuse a fill context across application, process, window, focus, or observer-generation changes.

The vault suggestions section is hidden only when no external application context exists, the vault is locked/stale, the Agent is unavailable, or there are no ranked candidates. A field-detection failure alone does not hide it.

## Candidate Actions

Each suggested Login row always exposes field-specific actions for every value the item actually contains:

- username icon,
- password icon,
- one-time-code icon when a TOTP seed exists.

If a live writable field exists, a field-specific action authorizes and fills that selected value into the focused field. If no live writable field exists, the same action copies the selected value and shows a fixed “copied” confirmation. It must not synthesize an unbound paste or write into an unknown target.

The primary **Fill** button is capability driven:

- hidden when there is no validated fill context;
- shown for a recognized single field and fills the inferred value;
- shown for a recognized form and fills the detected fields in canonical order;
- shown for a writable but unknown field only when the native action is an explicit safe choice, in which case the UI asks which value to fill instead of guessing.

The list row and item detail use the same capability model and authorization path. The item detail displays a single “AutoFill” primary button without explaining a hard-coded field; the detected context decides what will be filled. Field icons remain available as explicit alternatives.

## Ranking

Candidate ranking starts from the application context and uses the existing ordered signals: explicit binding, exact service identifier, reviewed preset, vault URI rules, safe host/domain match, normalized application/item-name similarity, successful history, favorite, recent use, and stable ties.

Field detection does not affect whether an item is a candidate. It affects only which actions are available for that candidate.

## Failure and Safety Rules

- Application identity is exact and fail closed; PID reuse or instance replacement forces recapture.
- Fill tokens remain short-lived, single use, and bound to application, account, generation, revision, candidate, field set, window, and AX element identity.
- A fill-context validation failure removes the primary Fill capability but preserves freshly reranked application suggestions.
- A field-specific action without a fill context copies only after normal reprompt/mismatch authorization. It never returns another field or multiple secrets.
- Lock, logout, account switch, projection replacement, application change, and popup destruction burn pending fill and reprompt state.
- UI and diagnostics expose only fixed state/reason codes; they never expose field contents, labels, geometry, passwords, TOTP seeds, or raw Accessibility values.

## UI States

1. **No application**: no suggestion section; show the existing fixed target-unavailable guidance only for an explicit AutoFill entry.
2. **Application, no writable field**: show application-ranked suggestions and field icons; omit primary Fill; field icons copy.
3. **Application and recognized field**: show suggestions, field icons, and primary Fill for the inferred field.
4. **Application and recognized form**: show suggestions, field icons, and primary Fill for the form.
5. **Application and unknown writable field**: show suggestions and field icons; primary Fill opens an explicit value choice only when the native context authorizes that choice.
6. **Stale/changed target**: cancel the action, recapture application context, rerank, and do not silently reuse the prior field context.

## Testing

Automated tests must cover:

- application-only entry still queries and renders ranked suggestions;
- field capture failure does not become target unavailable;
- exact application switch invalidates old ranking and fill context;
- field icons fill with a valid field context and copy without one;
- primary Fill visibility for absent, field, form, and choose contexts;
- detail and list use identical capability decisions;
- reprompt, mismatch, cancellation, token replay, popup destroy, lock, account switch, and projection replacement;
- deterministic ranking and metadata-only candidate responses;
- real signed macOS test with an Electron application: foreground window recognized, suggestion shown without relying on field detection, recognized Email field enables Fill, and Fill changes only the intended field.

## Scope

This change does not weaken AX privacy rules, add OCR/pixel inspection, add application-specific adapters, submit forms, press Return/Tab, or change system Credential Provider behavior. It restructures the existing main-application AutoFill flow so application matching and field authorization are independent.
