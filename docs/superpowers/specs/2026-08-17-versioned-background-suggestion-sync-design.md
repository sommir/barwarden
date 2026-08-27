# Versioned Background Suggestion Sync Design

## Problem

The native suggestion monitor and the Angular suggestion list currently have separate refresh lifecycles. Rust publishes the tray count in the background, but `refresh_visible_popup_suggestions` discards the corresponding frontend notification whenever the popup is hidden. The list therefore remains stale until the popup opens and performs another candidate query.

The existing context callback also fires before the native count query settles. That means simply allowing hidden-window events would still not give the count and list a shared publication boundary, and a count-preserving candidate change could be missed if publication were tied only to title changes.

## Desired behavior

- A completed native background suggestion observation advances one monotonic revision whether or not the displayed count changed.
- The tray title and frontend refresh notification are published from the same accepted observation.
- A hidden, unlocked vault refreshes its authoritative suggestion snapshot in the background.
- Opening the popup does not query again when the frontend already consumed the current revision.
- If WebKit suspended the hidden page and dropped the event, popup entry carries the current revision and performs exactly one catch-up refresh.
- Stale native observations, duplicate revisions, and superseded frontend queries cannot overwrite newer results.
- Initial open and unavailable-context behavior remain fail-closed.

## Native publication protocol

`SuggestionCountMonitor` retains its existing observation generation as the suggestion revision. A query result is publishable only when its generation still matches the current observed target.

For both `PublishDecision::Apply` and `PublishDecision::Unchanged`, the monitor publishes a revision notification after applying any required tray-title change. A current-generation error or an explicit target/browser clear also publishes its revision so the frontend can remove stale suggestions. Stale results publish neither title nor revision.

The context sink changes from `Fn()` to `Fn(u64)`. Early pre-query notifications are removed; publication occurs only after the accepted query or clear decision. This ensures same-count candidate changes still advance the frontend because the revision is based on the observation generation rather than title text.

## Hidden delivery and popup fallback

The window layer dispatches `barwarden:suggestion-context-changed` even when the main WebView is hidden. Event detail carries the revision as a decimal string, avoiding JavaScript precision loss for Rust `u64` values.

The popup-entry event also carries the monitor's current revision. Hidden WebKit delivery is therefore an optimization, not a reliability dependency: if it runs, the list is already current when opened; if it is suspended or drops the event, popup entry supplies the missed revision.

## Frontend revision coordinator

`AppComponent` tracks the highest pending and consumed suggestion revisions. It coalesces duplicate or rapidly increasing revisions into one serialized refresh loop.

When the app is unlocked, on `/tabs/vault`, and not in a pop-out window, the coordinator calls `AutoFillVaultContextService.beginFromVaultOpen()`. It marks a revision consumed only after that refresh settles for the latest pending revision. A newer revision arriving during an in-flight refresh supersedes the earlier result through the service's existing epoch guard and is processed next.

Ordinary popup entry no longer unconditionally refreshes an already-ready suggestion context. It refreshes only for an unconsumed native revision or for the initial uninitialized state. The previously implemented stale-while-revalidate behavior remains the UI safety net for actual changes.

## Testing

- Native monitor tests prove accepted same-count observations notify their revision, stale observations do not, and tray-title publication precedes revision notification.
- Window tests prove hidden windows are eligible for revision delivery and popup-entry scripts carry the current revision string.
- App tests prove duplicate revisions do not requery, missed revisions catch up on popup entry, and a newer revision arriving in flight is eventually consumed.
- Existing passive-refresh tests continue proving no intermediate empty suggestion state.
- Full Rust, frontend, signed-build, and real popup verification remain required.
