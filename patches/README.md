# Patches

Keep local app code outside `vendor/bitwarden-clients` whenever possible.

When a vendored Bitwarden change is unavoidable:

1. Make the smallest change in `vendor/bitwarden-clients`.
2. Generate a patch with `git -C vendor/bitwarden-clients diff > patches/<short-name>.patch`.
3. Explain why the adapter approach was not enough.
4. Keep the patch applicable to pinned commit `f47b6946e01aed474875789081966d311d5b8289`.
