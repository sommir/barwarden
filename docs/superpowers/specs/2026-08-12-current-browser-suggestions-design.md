# Current Browser Suggestions Design

## Decision

Barwarden will read the active tab URL from the browser that was frontmost when
the menu-bar popup opened and show up to five reliable Login matches in the
existing **AutoFill Suggestions** section. Full hostname matches rank above
registrable-domain matches, but related subdomains may still recommend one
another.

The browser URL is read in the Rust/Tauri backend through native macOS Apple
Events. The implementation does not launch `osascript`, require a browser
extension, poll the browser, or inspect the address bar through Accessibility.

## Goals

- Detect the active HTTP(S) page when the captured frontmost application is a
  supported browser.
- Rank active Login items using their complete URI collection and saved URI
  match types.
- Prefer the most specific reliable matches and return no more than five items.
- Reuse the current vault section, row, icon, disclosure, and row-action UI.
- Preserve the existing captured-application identity used by one-field paste.
- Keep URL capture asynchronous, bounded, in memory, and stale-result safe.

## Non-Goals

- Reading page DOM, identifying fields, filling multiple fields, or submitting
  forms.
- Installing or communicating with a browser extension.
- Firefox support through Accessibility address-bar inspection.
- Matching from page titles, screenshots, OCR, or fuzzy item-name similarity.
- Persisting browsing history or current URLs.
- Redesigning the vault list or AutoFill Suggestions UI.

## Supported Browsers

The first release supports two Apple Event object models:

| Family | Browsers |
| --- | --- |
| Safari | Safari and Safari Technology Preview |
| Chromium | Chrome release channels, Edge release channels, Brave release channels, Arc, Chromium, Vivaldi, and Opera |

Exact application bundle identifiers live in one declarative Rust registry.
New release-channel identifiers may be added without creating a new reader when
they use an existing family object model.

Firefox is intentionally excluded. Without an extension it does not expose an
active-tab Apple Event interface comparable to Safari or Chromium. Reading its
address bar through Accessibility would add a separate permission and depend on
unstable browser UI structure.

## Architecture

### Captured Target Context

The current `frontmost` module remains the authority for the application that
was active before Barwarden opened. Its stored value becomes a captured target
context with a monotonically increasing generation:

```text
CapturedTargetContext
  generation
  application bundle ID
  application process ID and native instance identity
```

Opening the popup captures a new generation before Barwarden takes focus. URL
capture does not delay showing or focusing the popup.

The frontend requests the captured context through one Tauri command after the
vault page loads. For a recognized browser, Rust targets the captured process
with a background Apple Event request and returns:

```text
WebsiteContext
  generation
  browser bundle ID
  full HTTP(S) URL
```

For a normal application, the command returns the captured application context
used by the existing one-field paste path. A recognized browser whose URL
cannot be read does not fall back to application-name matching.

Every result is accepted only when its generation is still current. A late
result from a closed or previously opened popup is discarded.

### Native Browser Reader

The macOS implementation uses the CoreServices Apple Event API directly from
Rust with a bounded send timeout:

- Safari resolves `front window -> current tab -> URL`.
- Chromium resolves `front window -> active tab -> URL`.

Both family readers share target addressing, descriptor ownership, result
decoding, timeout handling, and error normalization. Platform-specific code is
compiled only on macOS. Other targets return an unsupported result without
attempting browser access.

The application bundle declares an Apple Events usage description. macOS owns
the first-use Automation prompt and the System Settings permission state.

### Suggestion Matching

The frontend owns matching because it already holds the unlocked, decrypted
vault projection and imports Bitwarden's official URI model. Decrypted Login
data is not copied into a second Rust-side matching implementation.

A single suggestion service consumes a website context and emits ranked
candidates with explicit match evidence. It considers active, non-deleted,
non-archived Login items only. Each Login's strongest matching URI becomes the
item's evidence.

The matcher uses Bitwarden URI normalization and public-suffix/domain utilities
where applicable. It preserves explicit URI modes while adding specificity to
the default Domain result.

## Website Match Semantics

### Reliable Candidate Gate

A Login is a reliable website candidate only when at least one saved URI
satisfies its effective match rule:

- `Exact`: the complete current URL equals the saved URI.
- `StartsWith`: the complete current URL starts with the saved URI.
- `Host`: hostname and any explicit port match according to Bitwarden Host
  semantics.
- `Default` or `Domain`: the current URL and saved URI have either the same full
  hostname or the same registrable domain.
- `RegularExpression`: the user supplied a valid expression that matches the
  current URL.
- `Never`: never produces a candidate.

Invalid, empty, non-website, or non-HTTP(S) current URLs produce no website
suggestions. Invalid saved URIs and invalid regular expressions do not throw and
do not match.

### Specificity Order

Candidates are sorted by a deterministic evidence tuple rather than an opaque
percentage:

1. Exact complete URL.
2. Explicit starts-with match, with the longer matched prefix first.
3. Exact Host match, including an explicit port when present.
4. Exact normalized full hostname.
5. Same registrable domain.
6. Explicit regular-expression match.

For example, while visiting `https://login.example.com/account`, an item saved
for `login.example.com` ranks above items saved for `admin.example.com` or
`example.com`; all three remain eligible under Default/Domain matching.

Hostnames are compared case-insensitively after URL parsing and IDN
normalization. A terminal DNS dot does not create a different hostname. The
registrable-domain fallback uses public-suffix-aware parsing, so unrelated
sites under a suffix such as `co.uk` do not match each other.

Within the same evidence level, sorting uses:

1. Greater matched URL or prefix specificity.
2. Favorite items first.
3. Locale-aware item name.
4. Item ID as a final stable tie-breaker.

The result is truncated to five items only after all reliable candidates have
been ranked.

### Application Context Boundary

The current repository recognizes the captured application by bundle and
process identity so one-field paste can return to the correct process; it does
not currently contain a production application-to-Login suggestion scorer.
This feature extends the same captured-context boundary with website evidence
but does not invent an application-name fuzzy matcher or an application binding
model. The existing application capture and paste behavior remains unchanged.

Browser bundle identifiers never participate as native-application match
evidence. A recognized browser whose URL is unavailable therefore produces no
suggestions rather than suggestions for an item named Chrome or Safari.

## Vault UI Integration

No new visual component is introduced. `VaultListItemsContainerComponent` and
the retained vault row remain the rendering and interaction authorities.

When the vault has no search query and reliable candidates exist, the page
inserts one section before the normal vault hierarchy:

```text
id: autofill-suggestions
title: existing localized AutoFill Suggestions message
items: ranked candidates, maximum five
count: candidate count
collapsible: true
initial state: open
```

The section uses the existing disclosure state, quick-copy buttons, one-field
fill actions, item navigation, reprompt handling, menus, favicons, compact mode,
themes, and row heights. Clicking an action retains the existing meaning: it
copies or pastes one selected field into the captured target. This work does not
claim DOM or multi-field browser AutoFill.

The section is absent when:

- there are no reliable candidates;
- the person is searching;
- the vault is locked, empty, unavailable, or still in its initial load;
- the captured website context is invalid or stale.

Folder and type filters apply before website ranking. A non-Login type filter
therefore produces no website suggestions, while a folder filter limits the
candidate set to that folder.

Normal Favorites, type/folder hierarchy, All Items, search, empty, stale, and
unavailable behavior remains intact.

## Error, Permission, and Privacy Behavior

Browser context failure never prevents the popup from opening or the vault from
being used. The native command returns a typed unavailable reason for tests and
diagnostics, but the normal vault page simply omits the suggestion section.

Unavailable reasons include:

- unsupported application or browser;
- no browser window or active tab;
- non-HTTP(S) browser page;
- malformed or non-text Apple Event result;
- Automation permission denied;
- browser timeout or termination;
- stale captured-context generation.

URLs and derived hosts remain in memory only. They are excluded from logs,
configuration, process snapshots, evidence artifacts, crash messages, and
telemetry. A new context generation, lock, account switch, or logout invalidates
the prior value.

## Testing Strategy

Implementation follows test-driven development.

### Rust Unit and Contract Tests

- Bundle identifiers resolve to the correct Safari or Chromium family.
- Unknown identifiers and Firefox are unsupported.
- Captured generations replace and invalidate prior contexts.
- Only the captured process identity may supply the result.
- Empty, malformed, non-text, non-HTTP(S), timed-out, denied, and stale results
  are normalized without leaking URLs into error strings.
- macOS source guards forbid `Command`, `osascript`, Accessibility APIs, URL
  logging, and unbounded Apple Event sends in the browser reader.

Apple Event descriptor construction and decoding are isolated behind a small
backend trait so unit tests do not automate a real browser.

### Frontend Unit Tests

- Exact URL, longer prefix, Host, full hostname, registrable domain, regex, and
  Never rules produce the documented order.
- `login.example.com` outranks but does not suppress `admin.example.com` under
  the same registrable domain.
- Public suffixes, mixed case, IDNs, trailing dots, ports, paths, malformed
  URLs, invalid regexes, duplicate URIs, and multiple URIs per item are covered.
- Archived, deleted, non-Login, and `Never` items are excluded.
- Favorite, name, and ID tie-breakers are deterministic.
- Results are truncated after sorting, not before.
- A stale generation cannot replace current suggestions.

### Component and Visual Tests

- Zero matches renders no suggestion heading or empty placeholder.
- One through five matches render the existing section and row components in
  ranked order.
- More than five matches still renders five.
- Search suppresses suggestions and clearing search restores the current
  context result.
- Collapse state, quick-copy actions, reprompt, row menus, compact mode, light
  mode, and dark mode continue to use existing behavior.
- Existing tests that previously asserted browser suggestions were excluded are
  updated narrowly to reflect this now-supported native context.

### Live macOS Verification

On a signed development or release app, verify at least Safari, Chrome, Edge,
Brave, Arc, Vivaldi, and Opera where installed. Each check records only pass/fail
and browser identity, never the visited URL. Verification covers:

- first-use Automation approval;
- permission denial and later re-enabling in System Settings;
- no window, private window, multiple windows, and active-tab switching;
- exact-host and related-subdomain ordering against synthetic vault items;
- popup latency and a non-responsive browser timeout;
- one-field copy/paste returning to the originally captured browser.

## Acceptance Criteria

- Opening Barwarden over a supported browser can show up to five reliable Login
  suggestions for the captured active HTTP(S) page without a browser extension.
- A full-hostname match ranks above another Login sharing only the registrable
  domain.
- Related subdomains remain eligible under Default/Domain matching.
- No reliable match means no AutoFill Suggestions section.
- The existing vault section and row UI is reused without a parallel design.
- Browser context capture does not block popup presentation, persist or log the
  URL, use `osascript`, or depend on Accessibility.
- Permission denial, browser errors, and stale async results do not disrupt the
  rest of the vault.
