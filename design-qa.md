# AutoFill integrated vault — visual QA

## Grounding

- List reference: `/var/folders/7t/mr61cc1x54s6t56gf074z6980000gn/T/codex-clipboard-f6281f22-aea8-4ec5-ad18-1588cf372d67.png`
- Detail reference: `/var/folders/7t/mr61cc1x54s6t56gf074z6980000gn/T/codex-clipboard-4026f695-c952-4445-a734-db89dc195121.png`
- Actual list capture: `.superpowers/sdd/2026-08-11-autofill-popup-context/task-list-actual.png`
- Actual detail capture: `.superpowers/sdd/2026-08-11-autofill-popup-context/task-detail-actual.png`
- Side-by-side list comparison: `.superpowers/sdd/2026-08-11-autofill-popup-context/task-list-comparison.png`
- Side-by-side detail comparison: `.superpowers/sdd/2026-08-11-autofill-popup-context/task-detail-comparison.png`

The actual captures come from the signed `/Applications/Barwarden.app` build at the same 480 px popup width. Credential values were redacted or cropped from QA artifacts.

## Review

- Layout: the suggestion group is integrated directly beneath vault search and before normal groups; no separate AutoFill route is exposed.
- Hierarchy: section label/count, one compact candidate row, field-availability glyphs, and a single outlined Fill action follow the selected reference.
- Detail: the Login card keeps the existing product composition and exposes one full-width primary `自动填充` action without field-specific explanatory copy.
- Typography and spacing: existing Barwarden/Bitwarden tokens are preserved; headings, row rhythm, radii, and bottom navigation remain consistent with adjacent vault content.
- Color and borders: the selected row uses the existing cool-blue surface and continuous outline; the primary detail action uses the product blue token.
- Interaction: a signed live run recognized Termius, opened the integrated suggestion, and the generic list Fill wrote the detected Email field. The detail state rendered one generic AutoFill button and no username/password/TOTP-specific fill button.
- Privacy: the suggestion response remained metadata-only, and the QA images do not retain the live username, password, or TOTP value.

## Severity check

- P0: none.
- P1: none.
- P2: none.

final result: passed
