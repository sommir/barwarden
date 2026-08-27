# iOS 27 Vault final-review fix report

## Scope

- Increased the retained title-bar `New Item` button target from 36×36 to 44×44 without changing its icon treatment, dropdown API, or `vault:new-item` focus key.
- Added a 44px minimum width to the OTP Retry button. Existing 44px minimum height, OTP row dividers, and compact 52px rows are retained.
- Replaced the stale 36px visual expectation and added computed-style coverage on real `VaultListPageComponent` and `OtpPageComponent` DOM wrappers.

## TDD evidence

RED command:

```sh
npx vitest run apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts
```

Observed failures: retained New Item width was `36px` (expected `44px`); OTP Retry `min-width` was `auto` (expected `44px`).

GREEN targeted command:

```sh
npx vitest run apps/menubar-tauri/src/app/vault/vault-list-page.component.spec.ts apps/menubar-tauri/src/app/vault/otp-page.component.spec.ts apps/menubar-tauri/src/app/vault/otp-code-row.component.spec.ts apps/menubar-tauri/src/app/vault/vault-workflows.ios27.visual.spec.ts
```

Result: 56 tests passed. The focused `app.visual.spec.ts` title-bar test also passed (1 passed, 41 skipped).

Full Vault completion:

```sh
npx vitest run apps/menubar-tauri/src/app/vault
```

Result: 49 files, 1,208 tests passed.

## QA / verification notes

- `git diff --check` passed.
- `npx tsc -p apps/menubar-tauri/tsconfig.spec.json --pretty false` remains blocked by broad pre-existing repository type errors, including missing Node type resolution and upstream/vendor contract errors. This change adds no production TypeScript and the Vault test suite passes.
- Native/browser QA was intentionally not run: final scope forbids browser/native execution.
