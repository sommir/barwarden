# Contributing to Barwarden

Thanks for helping improve Barwarden.

## Before opening a pull request

1. Keep Barwarden-specific code outside `vendor/bitwarden-clients` whenever possible.
2. Do not add passwords, access tokens, recovery codes, private URLs, local paths,
   generated bundles, or internal work records to the repository.
3. Keep the product name as `Barwarden`; do not present the project as an official
   Bitwarden product.
4. Preserve applicable upstream license and copyright notices.
5. Run the relevant checks before requesting review:

   ```bash
   npm run test:brand
   npm test
   npm run build:web
   ```

## Changes to vendored source

Avoid editing `vendor/bitwarden-clients`. If an upstream change is unavoidable,
record a minimal patch in `patches/`, retain upstream notices, and document why a
local adapter was insufficient.

## Commit messages

Use concise, imperative messages such as `fix: preserve vault lock state` or
`docs: clarify macOS installation`.
