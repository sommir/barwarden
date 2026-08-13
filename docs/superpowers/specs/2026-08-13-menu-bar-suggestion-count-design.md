# Menu Bar Suggestion Count Design

## Decision

Barwarden will display the number of currently reliable AutoFill suggestions as
plain text immediately to the right of its existing macOS menu-bar template
icon. The count is derived from the same Agent-ranked candidate source and the
same eligibility policy as the visible **AutoFill Suggestions** section, and is
clamped to that section's existing maximum of five.

Context monitoring runs in the Rust/Tauri process so it continues while the
popup WebView is hidden or suspended. macOS application activation and
termination notifications trigger immediate refreshes. While a supported
browser is the frontmost external application, a one-second native poll detects
active-tab URL changes; non-browser applications are not polled.

## Goals

- Show `1` through `5` next to the existing tray icon when the current external
  application has that many visible AutoFill suggestions.
- Update immediately after a frontmost-application change and within one second
  after a supported browser's active tab or active window changes URL.
- Use the existing Agent ranking, full browser URL context, field-availability
  queries, reliable-candidate gate, ordering, and five-item limit.
- Clear stale counts before resolving a newly activated application or changed
  browser URL.
- Continue updating when the popup is closed, hidden, or WebKit throttles the
  frontend.
- Preserve the current signed, sandboxed, extension-free browser integration.

## Non-Goals

- Rendering a custom badge, colored bubble, overlay, or replacement tray icon.
- Displaying a zero, loading spinner, error indicator, domain, application name,
  account name, or any secret metadata in the menu bar.
- Inspecting browser DOM, Accessibility address-bar UI, screenshots, or page
  contents.
- Adding a second matching algorithm or changing existing ranking weights.
- Turning the monitoring snapshot into authorization for filling a field.

## User Experience

The existing template icon remains unchanged. macOS renders a short tray title
beside it:

| Current state | Tray title |
| --- | --- |
| One to five eligible suggestions | Decimal count, for example `4` |
| No eligible suggestions | No title |
| Vault locked, logged out, Agent unavailable, or projection stale | No title |
| Unsupported browser, unreadable tab, internal page, or invalid URL | No title |
| Context refresh in progress | No title |

The title always represents the most recently validated current context. A
frontmost-application or browser-URL change clears the previous title before a
new Agent query begins, so an old count is never attributed to a new target.

The popup suggestion section keeps its current UI without duplication or
restyling. On opening the popup, its visible count and the menu-bar count use the
same Agent projection and candidate eligibility rules. A concurrent target,
session, or projection change invalidates both results rather than allowing an
old count to remain visible.

## Architecture

### Native Suggestion Count Monitor

A new Rust-owned monitor starts after tray construction. It owns:

- a monotonic observation generation;
- the last observed application identity;
- the last normalized HTTP(S) browser URL;
- the last Agent session/projection identity used for a successful count;
- a cancellation/staleness check for every asynchronous read and query; and
- the last tray title applied, to avoid redundant AppKit updates.

The monitor uses a dedicated read-only observation target. It must not call
`replace_target_app`, mutate the captured target used by AutoFill actions, reuse
fill tokens, or create a fill context. Clicking the tray icon continues to
capture a separate exact target through the existing `frontmost` flow.

The observation state reducer is platform-neutral and unit tested. macOS event
registration, active-tab reading, Agent IPC, and tray title mutation sit behind
small side-effect boundaries.

### Application Activation

On macOS, the monitor subscribes to
`NSWorkspaceDidActivateApplicationNotification` and
`NSWorkspaceDidTerminateApplicationNotification` on the AppKit main thread. A
notification schedules refresh work outside the notification callback. Refresh
performs these steps:

1. Increment the observation generation and clear the tray title.
2. Capture and validate the exact frontmost external application identity.
3. If Barwarden itself became active because its popup opened, retain the last
   validated external target and title; Barwarden activation is not a new
   AutoFill target.
4. If the observed external target terminated, or the new target is absent or
   malformed, remain empty.
5. For a supported browser, read and validate the active HTTP(S) URL.
6. For a non-browser application, query with its existing application metadata
   and no service identifier.
7. Query the Agent and publish only if the application, observation generation,
   Agent session, and projection revision are still current.

Notifications are coalesced so a burst does not create overlapping Agent
queries. If a newer generation exists, older work may finish but cannot update
the tray.

### Browser URL Polling

The monitor has one one-second timer. A tick performs work only when the last
validated frontmost application belongs to the existing Safari or Chromium
browser registry.

Each active-browser tick:

1. Revalidates that the same browser process is still frontmost.
2. Reads the current active-tab URL through the existing isolated, bounded
   macOS reader.
3. Normalizes and accepts only HTTP(S) URLs with a host.
4. Does nothing when the normalized URL is unchanged.
5. On a changed or unavailable URL, increments the observation generation and
   clears the old count immediately.
6. Queries the Agent only for a new valid URL and publishes a still-current
   result.

No timer queries the Agent for an unchanged URL. No browser reader runs while a
normal application is frontmost. The existing two-second hard reader timeout
and subprocess isolation remain in effect, so a browser scripting failure
cannot block or crash the host process.

### Candidate Count Source

The native monitor obtains the current Agent session, then issues the same three
field-scoped candidate queries used by
`AutoFillContextualCandidatesService`: username, password, and TOTP.

For browsers, the native query context contains the exact application metadata
and current full normalized URL in `service_identifiers`. The existing Agent
browser-only policy remains authoritative: browser bundle or application-name
fallback cannot create a suggestion when there is no reliable URL match. The
Agent continues to match against complete hostnames and its current URL rules;
this feature does not reduce a URL to its registrable/root domain.

For non-browser applications, the query context contains the current
application metadata and an empty service-identifier list, preserving current
application matching.

Responses are merged by cipher ID in Agent order. A cipher is eligible when at
least one field query returned it and either:

- its group is `exact` or `relevant`; or
- its group is `other` with one of the existing explicitly allowed application
  reasons: `application_name`, `application_name_similar`, or `fuzzy_name`.

This is the same gate used by the existing suggestion component. Because each
query is field-scoped, membership in the merged set also proves that at least
one displayable secret field exists in the Agent projection. The unique eligible
IDs are truncated to five after Agent ordering; only the resulting length is
published. Candidate names, usernames, reasons, URLs, and identifiers never
reach the tray API.

The merge-and-eligibility policy is represented by explicit tests in both Rust
and the existing frontend suite. A contract fixture covers identical response
groups, reasons, deduplication, and the five-item cap so the two consumers
cannot silently drift.

### Session and Projection Refresh

Application and URL changes are not the only invalidation sources. The monitor
also refreshes after lifecycle signals that can change the suggestion set while
the target stays constant:

- projection replacement after sync;
- projection clear, lock, or reprojection reset;
- account/session handoff;
- Agent lock or logout; and
- a successful unlock or reprojection.

The Rust commands that already perform these transitions notify the monitor
after success. An unavailable or changed Agent generation/revision clears the
title. A successful projection replacement schedules one coalesced refresh for
the still-current target.

This avoids continuous Agent polling. The browser timer detects only target URL
changes; explicit lifecycle notifications handle vault data changes.

### Tray Title

The tray remains identified as `main`. A small tray helper formats the state:

- `None` for zero, unavailable, loading, or stale;
- `Some("1")` through `Some("5")` for eligible counts; and
- values above five are defensively clamped to `5`.

Title changes use Tauri's tray-title API on the main thread. The title is plain
system text so macOS controls spacing, scale, contrast, light/dark appearance,
and menu-bar accessibility. The icon remains a template image.

## Concurrency and Failure Handling

- Only the newest observation generation may publish.
- Application identity includes bundle ID, PID, and native running-application
  instance; PID reuse or application relaunch creates a new context.
- URL equality uses normalized full URLs, not page titles or roots.
- A read timeout, Automation denial, missing window/tab, browser termination,
  malformed URL, internal URL, Agent error, locked session, malformed payload,
  or partial field-query failure clears the title and exposes no diagnostic
  text in the menu bar.
- All three field queries must succeed before a count is accepted, matching the
  current frontend's fail-closed behavior.
- Errors use fixed reason codes in diagnostics and never log raw URLs or
  candidate metadata.
- Shutdown drops notification observers and stops the timer without waiting for
  in-flight browser or Agent work.

## Performance Budget

- Non-browser foreground: no periodic browser read and no periodic Agent query.
- Supported browser foreground: at most one active-tab read per second.
- Unchanged browser URL: zero Agent candidate queries.
- Changed context: one session read plus three bounded candidate queries, run
  outside the AppKit notification callback.
- Tray mutation occurs only when the formatted title changes.

The one-second interval is the accepted balance between visible responsiveness
and the cost of the extension-free browser scripting boundary.

## Testing Strategy

Implementation follows test-driven development.

### Rust Tests

- Count formatting hides zero/unavailable states and clamps above five.
- Exact/relevant candidates count; unrelated `other` reasons do not.
- Allowed application-name reasons count for non-browser application matching.
- Candidates returned for multiple fields are deduplicated while preserving
  Agent order.
- Any failed field query fails closed.
- External application changes clear before asynchronous refresh and reject
  late results; Barwarden popup activation retains the captured external count.
- Termination of the observed external application clears the count even while
  Barwarden is frontmost.
- Browser ticks run only for supported frontmost browsers.
- Unchanged normalized URLs do not query the Agent or mutate the tray.
- Changed, invalid, internal, unreadable, and stale URLs clear the old count.
- Agent generation or projection revision changes reject late results.
- Projection and lock lifecycle events schedule refresh or clear as specified.
- Source guards preserve bounded browser execution and prevent URL/candidate
  logging.

### Frontend Contract Tests

- The visible section remains capped at five.
- Its eligibility fixture matches the native count fixture for groups, reasons,
  duplicate field results, and field availability.
- The existing section remains the only AutoFill suggestion UI.
- Search and presentation state do not create a second native matching path.

### Signed macOS Verification

After automated Rust, Swift Agent, and targeted frontend suites pass, build and
sign the production application using the repository's existing packaging
workflow. Verify with the installed signed application:

1. Switch between a matched normal application and an unmatched application;
   the title updates immediately and clears without showing the previous count.
2. Open Barwarden from the matched application; its popup activation retains the
   number and the popup section shows the same count.
3. In each supported available browser family, switch between matched and
   unmatched HTTP(S) tabs; the title updates within one second.
4. Switch browser windows and confirm the active window URL drives the count.
5. Open an internal browser page or deny/unavailable automation access; the
   title disappears.
6. Lock and unlock the vault; the title clears and returns only after a valid
   projection is available.
7. Open the popup and confirm the tray number equals the visible suggestion
   section count, with the same first-ranked item and a maximum of five.
8. Keep the popup closed for several minutes and confirm updates continue with
   bounded CPU use and no host or Agent crash.

## Privacy and Security

Monitoring observes only exact foreground application identity and, for a
supported foreground browser, its active-tab URL. Values remain transient and
in memory. No browsing history is accumulated. URLs and candidate metadata are
not persisted, logged, sent to telemetry, placed in crash text, or rendered in
the menu bar.

The count is informational only. It grants no secret access and is not a fill
authorization. Existing generation-, account-, projection-, application-,
window-, field-, and user-presence checks remain mandatory for every action.
