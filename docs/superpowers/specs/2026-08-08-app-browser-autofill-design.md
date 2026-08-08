# App and Browser AutoFill Design

## Decision

Barwarden will support password AutoFill in native macOS applications and in
Safari, Chrome, and Edge while retaining macOS 13 as the minimum supported
version.

The design uses three complementary integrations:

1. An AutoFill Credential Provider extension for system-supported fields in
   Safari and native applications.
2. A Safari WebExtension and a shared Chromium Manifest V3 extension for
   browser URL detection, form understanding, inline icons, and full-form fill.
3. Accessibility-assisted field actions plus the existing menu-bar and global
   shortcut flow as ordered fallbacks for applications that do not expose a
   system AutoFill field.

All integrations use a new encrypted AutoFill projection. They do not reuse the
current in-process `SessionBroker` as a credential broker.

## Feasibility Verdict

The product is feasible, subject to a mandatory packaging and signing proof of
concept. The current build assumes a single Tauri app with empty entitlements.
The new product requires two embedded app extensions, an App Group, a signed
AutoFill Agent and native messaging helper, nested code signing, and
notarization.

No browser or native AutoFill implementation begins until the proof of concept
demonstrates that a signed and notarized DMG can install, discover, enable, and
update the embedded extensions on macOS 13 and on the current macOS release.

## Goals

- Offer credentials for the current website or native application, ordered by
  match confidence.
- Show a Barwarden inline icon and candidate list in supported browsers.
- Always allow the person to search all Login items and select an account that
  was not initially recommended.
- Fill username and password together only when the system or a browser content
  script has identified a login form.
- In Accessibility and shortcut fallbacks, fill only the focused field and
  expose separate username, password, and TOTP actions.
- Preserve one account selection, one lock policy, and one source of
  synchronized vault data under Barwarden's control.
- Keep passwords, TOTP seeds, and unlock material out of browser extension
  persistent storage.
- Keep the existing single-field copy-and-paste path as the final fallback.

## Non-Goals for the First Release

- Firefox and Gecko-specific packaging or distribution.
- Automatic form submission.
- Automatic filling based only on fuzzy matches, window titles, address-bar
  text, screenshots, or OCR.
- Password capture, save-password prompts, or update-password prompts.
- Passkey creation or assertion.
- Card, identity, secure-note, or arbitrary text AutoFill.
- Organization administration, enterprise deployment policy, or forced browser
  extension installation.
- Silent installation that bypasses Safari, Chrome, or Edge confirmation UI.

## Supported Clients

| Client | First-release support |
| --- | --- |
| macOS | 13 and later |
| Safari | Embedded Safari WebExtension plus system AutoFill |
| Chrome | Published Manifest V3 extension |
| Edge | Published Manifest V3 extension using the shared Chromium source |
| Other Chromium browsers | Best-effort compatibility, not a release gate |
| Firefox | Excluded |

## User Experience

### Browser Integration Setup

Settings contains a Browser Integration page that detects installed browsers
and reports `not installed`, `installed but disabled`, `bridge unavailable`,
`permission required`, `connected`, or `version incompatible`.

- Safari: the extension is embedded in `Barwarden.app`. Barwarden detects its
  enabled state and opens Safari's extension settings for the final user
  confirmation.
- Chrome and Edge: Barwarden opens the corresponding official extension-store
  listing. The browser owns the final installation and permission confirmation.
- After browser installation, the extension and Barwarden complete a native
  messaging handshake. Barwarden then reports the connected extension version
  and granted website-access state.
- Enabling integration explicitly registers the per-user native messaging host
  manifests. Disabling integration removes Barwarden-owned registrations
  without attempting to uninstall the browser extension.

### Browser Fill

On a supported login field, the extension displays a Barwarden icon. Selecting
the icon opens one candidate list shared with the toolbar popup:

1. Exact matches.
2. High-relevance matches.
3. Other suggestions.
4. Search across all Login items.

Each suggested item explains why it matched, such as `exact domain`, `explicit
app binding`, `built-in app preset`, or `recently used here`. The UI does not
display synthetic confidence percentages.

Selecting a matching login fills the recognized username and password fields.
TOTP is a separate action unless the page exposes a recognized one-time-code
field. The extension never submits the form.

If the selected item does not match the current origin, the extension shows a
clear mismatch confirmation before requesting any secret.

### Native Application Fill

Entry points form an automatic fallback chain rather than a user-selected mode:

1. macOS system AutoFill when the focused field supports it.
2. A Barwarden floating icon when Accessibility permission is granted and the
   focused field can be positioned reliably.
3. The menu-bar icon or global shortcut in every other case.

All entry points open the same ranked candidate list and all-Login search.
System AutoFill may provide domain or URL identifiers on macOS 13 and later. An
App identifier becomes an additional exact system signal on macOS 26.2 and
later. On macOS 13 through 26.1, Barwarden combines associated domains, the
previously focused application's bundle identifier, built-in presets, explicit
bindings, and history.

The floating-icon and shortcut fallbacks never simulate a username-to-password
`Tab` sequence. They fill only the focused field through an explicit username,
password, or TOTP action.

## Matching Model

The ranking order is:

1. A user-created exact application-to-login binding.
2. An exact system service identifier, URL, or associated domain.
3. A verified built-in application-to-service preset.
4. An exact vault URI rule using Bitwarden-compatible match semantics.
5. Host and registrable-domain matches.
6. Application name, vendor, and service-name fuzzy matches.
7. Prior selections in the same application or origin.
8. Favorites and recent items.

Built-in presets map an application identifier to a canonical service or domain;
they never select a specific person's account. Presets ship with a Barwarden
release and are not remotely downloaded. User bindings override presets.

Fuzzy signals affect display order only. They cannot authorize secret release,
trigger a fill, suppress an origin mismatch warning, or cause automatic fill.

## Components

### Barwarden Main Application

The existing app remains responsible for authentication, server sync, account
selection, vault mutation, and master-password, PIN, and Touch ID workflows.

When the vault is unlocked, an AutoFill Projection Writer converts supported
Login items into the dedicated encrypted AutoFill Store. It writes a complete,
versioned transaction so readers never observe a partially updated projection.

The existing `SessionBroker` continues to coordinate Tauri windows only. It is
not exposed to app extensions or browser extensions and is not modified to
become a password transport.

### Encrypted AutoFill Store

The AutoFill Store contains only the fields required for first-release Login
AutoFill:

- Account and cipher identifiers.
- Display name and username.
- Login URIs and match types.
- Password and TOTP seed.
- Reprompt requirement.
- User application bindings and local ranking history.
- Projection schema version, source vault revision, and creation time.

Each unlock generation creates a new random projection key. The main app uses
that key to write the projection transaction and transfers it to the AutoFill
Agent over authenticated local IPC. The key is never written to disk or placed
in a shared Keychain item. Store files reside in an App Group container, but
embedded extensions have no projection key and cannot decrypt them directly.
Plaintext records are never written to disk.

The projection is a derived cache, not a new source of truth. A successful vault
sync or mutation replaces it while unlocked. Logout or account removal deletes
the projection, matching history for that account, identity-store entries, and
all Barwarden-owned integration sessions for that account.

### AutoFill Agent

The AutoFill Agent is a signed native companion process and the sole
cross-process reader of decrypted projection data. It validates callers,
evaluates lock and reprompt policy, queries the encrypted projection, ranks
candidates, and releases only the fields required by one approved fill action.
The main app provisions the current projection key after unlock. The agent holds
it only in memory, zeroes it on lock or account change, and treats a restart or
lost main-app lease as locked.

Local IPC authenticates the connecting process by code-signing identity and an
allowlist of Barwarden bundle identifiers. The packaging proof of concept must
choose and validate the concrete macOS 13-compatible transport and agent
lifecycle before protocol implementation. App Group files or socket names are
discovery mechanisms, not authorization.

On Chrome and Edge, a signed native messaging host inside `Barwarden.app`
forwards bounded messages to the agent. The browser manifests allow only the
published Barwarden extension IDs.

On Safari and the Credential Provider extension, signed embedded components
connect to the agent through the authenticated local transport. A small shared
native client library implements protocol framing and caller context; it does
not contain projection decryption keys or a second authorization policy.

### AutoFill Credential Provider Extension

An Xcode-built extension subclasses `ASCredentialProviderViewController`. It
publishes password identities to `ASCredentialIdentityStore` and handles system
password requests on macOS 13 and later. System one-time-code identities and
completion are enabled only on macOS 15 and later; on macOS 13 and 14, TOTP
remains available through browser content scripts and explicit focused-field
fallback actions.

The Apple identity store may retain service and username identities after
Barwarden locks, as required for system suggestions, but it never contains the
password. Selecting an identity must pass the AutoFill Agent's unlock and
reprompt policy before the extension returns a credential.

### Safari WebExtension

The Safari extension is embedded in the signed app. It shares the Chromium
content, matching, and popup packages where Safari's WebExtension APIs permit,
with a small Safari-native messaging handler for the containing app.

Safari may show both system AutoFill and the Barwarden inline icon. Barwarden
does not suppress system UI. A Safari-specific setting allows the person to
disable the branded inline icon while retaining toolbar and system AutoFill.

### Chromium WebExtension

Chrome and Edge use one Manifest V3 source tree with store-specific manifests,
IDs, and native-host allowlists. The extension contains:

- A service worker for tab lifecycle, bridge state, and commands.
- Content scripts for form discovery, inline icons, candidate UI, and fill.
- A toolbar popup for current-origin candidates and all-Login search.
- A native messaging adapter with disconnect and protocol-version recovery.

No password, TOTP seed, device key, or complete decrypted vault is stored in
`chrome.storage`, IndexedDB, local storage, logs, crash reports, or telemetry.

### Shared Browser AutoFill Core

A focused shared package owns form discovery, field classification, URI match
semantics, candidate presentation models, and fill orchestration. It selectively
adapts the vendored Bitwarden browser AutoFill implementation instead of
importing the entire browser application or disabling the current source guards
globally.

## Lock and Authorization Policy

- When Barwarden is signed out, all integrations return `signed-out` and no
  candidate metadata.
- When Barwarden is locked, Chrome and Edge show an unlock action rather than
  candidate metadata. Safari follows the same rule in branded extension UI.
- A system identity may remain visible in Apple's protected identity store, but
  selecting it cannot return a password while the projection key is unavailable.
- PIN or Touch ID unlock follows the existing configured vault-timeout policy.
- Items requiring master-password reprompt always invoke the existing reprompt
  flow before secret release.
- Locking revokes active integration sessions and zeroes in-memory projection
  keys. Logout additionally deletes the encrypted projection and account-local
  matching history.
- Extension requests have short deadlines and are not replayable across a lock,
  account switch, tab navigation, or process generation change.

### Unlock and Reprompt Handoff

Browser extensions never collect a master password or PIN. When Chrome, Edge,
or branded Safari UI encounters a locked projection, it asks the native helper
to bring Barwarden's existing unlock UI to the foreground. If Touch ID unlock is
enabled, the signed native adapter may instead perform a LocalAuthentication
request under the same vault-timeout policy. A successful native unlock rotates
the lock generation, rebuilds the encrypted projection under a new in-memory
key, provisions the agent, and allows the extension to issue a fresh candidate
request; an earlier request is never resumed.

The Credential Provider may perform the same Touch ID authorization when the
configured policy permits it. If master-password or PIN entry is required, the
provider explains that Barwarden must be unlocked, hands off to the containing
app when the system permits, and cancels the current system request. The user
selects AutoFill again after unlock. The first release does not embed a second
master-password or PIN form inside an extension.

For a master-password-reprompt item, Barwarden's existing reprompt UI creates a
single-use grant bound to the caller, account generation, cipher, requested
fields, origin or application context, and a short expiry. The extension retries
with that grant. Reprompt success never unlocks unrelated items or outlives a
lock, navigation, or account switch.

## Browser Request Protocol

Every request has a protocol version, request ID, caller instance, account
generation, action type, and bounded payload. Responses contain an expiry and
the context that they authorize.

### Candidate Request

The extension sends the top-level origin, frame origin, page lifecycle token,
recognized field types, and whether the action was user initiated. The agent
returns metadata-only candidates and match reasons.

### Secret Request

After the person selects a candidate, the extension sends the candidate ID,
requested fields, and the original context token. Immediately before releasing
a secret, the agent verifies the lock generation and candidate authorization.
Immediately before filling, the content script verifies that the tab, document,
frame, origins, and target fields still match the request.

Cross-origin frames do not receive credentials merely because the top-level
page matched. A frame must independently satisfy the URI policy or receive an
explicit mismatch confirmation.

## Native Application Request Flow

1. macOS supplies service identifiers to the Credential Provider, or Barwarden
   captures the previous frontmost bundle identifier for a fallback action.
2. The agent ranks exact bindings, service identifiers, presets, URI matches,
   history, and fuzzy hints.
3. The user selects a Login and, for fallback entry points, a specific field.
4. The agent performs unlock or reprompt if required.
5. System AutoFill returns an `ASPasswordCredential` or TOTP credential. The
   latter is version-gated to macOS 15 and later. The fallback path uses the
   existing guarded clipboard-and-paste command for one field.

## Error and Recovery Behavior

| Condition | Behavior |
| --- | --- |
| Extension missing | Browser Integration shows an official install action |
| Extension disabled or lacks site permission | Open the browser's extension or website-permission settings |
| Native host missing | Offer a user-initiated repair that rewrites Barwarden-owned manifests |
| Protocol version mismatch | Refuse secret requests and require app/extension update |
| Barwarden locked | Show unlock; do not return browser candidates or secrets |
| Projection stale | Label results stale, request sync, and never silently select a changed credential |
| Projection corrupt or authentication fails | Quarantine the projection, return unavailable, and rebuild after unlock |
| Page navigated during selection | Cancel the request and rediscover the form |
| Origin mismatch | Require explicit confirmation; never fill automatically |
| Unsupported native field | Fall back to focused-field actions or copy only |
| Accessibility denied | Preserve copied-value fallback and explain how to grant permission |
| Agent unavailable | Keep the vault locked from the caller's perspective and expose repair diagnostics |

Errors and diagnostics never include usernames, URLs with sensitive query
strings, passwords, TOTP seeds, access tokens, keys, or decrypted payloads.

## Packaging and Signing Gate

Before feature implementation, build a minimal non-production spike that proves:

1. An Xcode sidecar project can build a Safari WebExtension and AutoFill
   Credential Provider for macOS 13.
2. Both `.appex` bundles can be embedded under `Barwarden.app/Contents/PlugIns`.
3. The app, extensions, and native helper carry the intended bundle IDs,
   application group and AutoFill entitlement, with no unplanned shared
   Keychain access group.
4. The signed AutoFill Agent can be started, reached by both embedded
   extensions and the Chromium native host, and can authenticate every caller
   on macOS 13 without exposing its projection key.
5. Inner components are signed before the outer app, and strict signature
   verification passes without relying on `codesign --deep` as the signing
   strategy.
6. The app can be notarized, stapled, placed in a DMG, installed by drag and
   drop, and discovered by Safari and macOS AutoFill.
7. App updates preserve extension discovery, App Group data, native-host
   registration, and rollback safety.
8. Chrome and Edge can connect only through their published extension IDs.

The current release verifier's empty-entitlement assumption and single-bundle
inventory must be replaced with an exact entitlement and nested-code inventory.
The gate fails closed if any extension or helper is unsigned, unexpectedly
entitled, missing, duplicated, or outside the sealed app bundle.

## Source and Scope Changes

This feature intentionally changes the current product boundary. The following
guards and documents must be updated narrowly rather than deleted:

- `docs/upstream-reuse-map.md` will permit selected browser AutoFill and native
  messaging modules in the new extension package while continuing to forbid
  them in the menu-bar WebView runtime.
- Standard-auth and upstream-import guards will distinguish extension targets
  from the Tauri app target.
- Release verification will recognize the exact embedded extension and helper
  inventory and their exact entitlements.
- The existing window `SessionBroker` remains credential-free and process-local.

## Implementation Order

1. Packaging, entitlement, signing, notarization, and update proof of concept.
2. Protocol schemas, encrypted AutoFill Store, transactional projection writer,
   lock lifecycle, and security tests.
3. Shared matching engine, presets, explicit bindings, ranking history, and
   all-Login search model.
4. Chrome and Edge extension with Native Messaging, inline icon, candidate UI,
   complete-form fill, and mismatch protection.
5. Embedded Safari WebExtension and Browser Integration management UI.
6. AutoFill Credential Provider, identity-store lifecycle, system password fill,
   and version-gated system TOTP.
7. Accessibility field detection, floating icon, and menu/shortcut fallback
   integration.
8. Store publication, privacy disclosures, upgrade compatibility, and signed
   release validation.

Each step must leave Barwarden's current copy-and-paste behavior usable.

## Verification

### Automated

- Matching tests cover exact bindings, URI match types, public-suffix handling,
  punycode, presets, history, fuzzy ordering, and mismatch warnings.
- Protocol tests reject unknown callers, oversized or malformed payloads,
  replay, stale generations, version mismatch, field overreach, and requests
  after lock or navigation.
- Store tests cover authenticated encryption, transaction recovery, corrupt
  data, rollback, account switching, lock, logout deletion, agent restart,
  expired main-app lease, and concurrent readers.
- Chromium browser tests cover top-level forms, multi-step login, iframes,
  cross-origin frames, shadow DOM where supported, dynamically inserted fields,
  username-only pages, password-only pages, TOTP, full search, locked state,
  permissions, navigation races, and no auto-submit.
- Component tests cover browser-integration status and repair actions.
- Native tests cover Credential Provider request filtering, identity lifecycle,
  biometric and reprompt gates, Accessibility fallback, and clipboard safety.
- Bundle tests verify exact nested inventory, bundle IDs, minimum OS,
  entitlements, designated requirements, hardened runtime, signatures,
  notarization, and DMG contents.

### Live Release Gates

- Fresh macOS 13 and current-macOS installations.
- Safari extension discovery, enablement, per-site permission, and update.
- Chrome and Edge store installation, native-host pairing, repair, and update.
- Native applications with and without standard AutoFill fields.
- Accessibility permission denied and granted.
- Multiple browser profiles, private browsing disabled by default, account
  switching, lock timeout, logout, app restart, browser restart, and offline use.
- Phishing and navigation-race scenarios confirm that fuzzy results never fill
  without explicit selection and that origin changes cancel secret release.

## Acceptance Criteria

- A user can start browser extension setup from Barwarden and see an accurate
  status for Safari, Chrome, and Edge.
- A supported browser login field shows the Barwarden icon and a ranked list
  with search across all Login items.
- A matching browser selection fills the intended fields but never submits.
- A native system AutoFill request can provide a selected Login on macOS 13+.
- A native system TOTP request is supported on macOS 15+; macOS 13 and 14 retain
  explicit TOTP field actions.
- An unsupported native field follows the ordered floating-icon and
  shortcut/menu fallback and fills only one explicit field.
- Fuzzy matching only changes ordering and never authorizes automatic fill.
- Lock, reprompt, account switch, logout, origin change, extension mismatch, or
  protocol failure prevents secret release.
- Browser extensions persist no plaintext password, TOTP seed, master password,
  device key, or decrypted vault.
- Signed and notarized release verification proves the exact nested extension,
  helper, entitlement, and native-host inventory.
