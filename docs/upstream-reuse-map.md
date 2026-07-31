# Upstream Reuse Map

This project vendors official Bitwarden client source at `vendor/bitwarden-clients` and keeps local app code outside the vendor tree whenever possible.

Pinned upstream revision:

```text
f47b6946e01aed474875789081966d311d5b8289
```

## Allowed Reuse Candidates

These roots are candidates for direct imports or adapter-backed reuse:

- `vendor/bitwarden-clients/libs/common`
- `vendor/bitwarden-clients/libs/auth`
- `vendor/bitwarden-clients/libs/angular`
- `vendor/bitwarden-clients/libs/tools/generator`
- `vendor/bitwarden-clients/libs/vault`
- `vendor/bitwarden-clients/apps/browser/src/popup`
- `vendor/bitwarden-clients/apps/browser/src/platform/popup`
- `vendor/bitwarden-clients/apps/browser/src/vault/popup`
- `vendor/bitwarden-clients/apps/browser/src/tools/popup`

## Runtime Exclusions

The menubar app must not import browser-extension runtime features:

- `vendor/bitwarden-clients/apps/browser/src/autofill/content`
- `vendor/bitwarden-clients/apps/browser/src/autofill/background`
- `vendor/bitwarden-clients/apps/browser/src/vault/content`
- Browser tab or current URL detection.
- DOM autofill and content-script messaging.
- `webRequest`, `webNavigation`, and native messaging.
- Browser background runtime.

## Adapter Policy

Use Tauri adapters for host behavior:

- Storage: Tauri local encrypted storage plus macOS Keychain for secrets.
- Clipboard: Tauri command API.
- Fill: one selected field through clipboard plus Cmd+V.
- Windowing: Tauri popup window and status bar integration.

If an upstream file requires browser APIs, do not import it directly. Create a local adapter under `apps/menubar-tauri/src/host` or a small local facade under `apps/menubar-tauri/src/app`.

## Plan A Reachability Boundary

The source map records provenance, not product scope. A mapped local module may remain dormant without being a supported or complete Plan A feature.

Reachable Plan A surfaces are limited to standard password authentication; Login, Card, Identity, Secure Note, folders, favorites, archive, trash, and password history; password/passphrase/username generation; account lifecycle; essential native settings; text Send; and one-field clipboard paste.

The following implementations may remain in the repository but must have no route, menu item, row action, filter, create option, handoff, or required parity-manifest entry:

- Cipher attachments and native file-transfer helpers.
- Organization collection assignment.
- Import and export components.
- File Send crypto, transport, and models.
- SSH Key form and request helpers.
- Device, domain, notification, forwarded-email, and entitlement-report pages.

Synced deferred records may be preserved in raw state for compatibility, but Plan A presentation omits them and cleanup must never mutate, delete, or rewrite them.

## Startup And Account Routing Sources

The current startup/account restoration behavior maps to these official popup sources:

- `vendor/bitwarden-clients/apps/browser/src/popup/app-routing.module.ts`
- `vendor/bitwarden-clients/apps/browser/src/auth/popup/account-switching/account-switcher.component.ts`

The current local ownership for that adaptation is:

- `apps/menubar-tauri/src/app/auth/auth.facade.ts`
- `apps/menubar-tauri/src/app/app.component.ts`
- `apps/menubar-tauri/src/app/app.routes.ts`

Focused verification for the adapted startup/account flow lives in:

- `apps/menubar-tauri/src/app/auth/auth.facade.spec.ts`
- `apps/menubar-tauri/src/app/app.component.spec.ts`

Remaining `auth.startup` gaps are still:

- Locked `480x600` route visual evidence from a current bundle.
- Unlocked `480x600` route visual evidence from a current bundle.
- Native current-bundle startup evidence for the routed locked and unlocked outcomes.
- Live multi-account restore and switch evidence that proves the current startup/account flow end to end.

The retained standard authentication surface is split into the 12 Authentication/Accounts acceptance rows.

- `auth.login-email`: `partial`
- `auth.login-password`: `partial`
- `auth.environment`: `partial`
- `auth.lock`: `partial`
- `auth.two-factor-select`: `partial`
- `auth.two-factor-code`: `partial`
- `auth.new-device`: `partial`
- `auth.password-hint`: `partial`
- `auth.account-menu`: `partial`
- `auth.account-switch`: `partial`
- `auth.offline-restore`: `partial`

## Generator Evidence Status

No surface currently meets every completion gate. The generator routes remain partial despite their source-aligned implementation.

- `generator.main` local module: `apps/menubar-tauri/src/app/generator/generator-page.component.ts`; official sources: `vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator.component.html` and `vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator.component.html`; tests: `apps/menubar-tauri/src/app/generator/generator-page.component.spec.ts`; current visual/audit evidence: `docs/superpowers/screenshots/generator-source-fidelity-2026-07-10/` and `docs/superpowers/specs/2026-07-10-popup-completeness-audit.md`; remaining gap: current native Tauri bundle evidence for Generator sync and generation.
- `generator.history` local module: `apps/menubar-tauri/src/app/generator/generator-history-page.component.ts`; official sources: `vendor/bitwarden-clients/apps/browser/src/tools/popup/generator/credential-generator-history.component.html` and `vendor/bitwarden-clients/libs/tools/generator/components/src/credential-generator-history.component.html`; tests: `apps/menubar-tauri/src/app/generator/generator-history-page.component.spec.ts`; current visual/audit evidence: `docs/superpowers/screenshots/generator-source-fidelity-2026-07-10/` and `docs/superpowers/specs/2026-07-10-popup-completeness-audit.md`; remaining gaps: empty-history `480x600` evidence from a current bundle, plus native Tauri evidence for Generator history sync and clear behavior.
