# Smart AutoFill row actions — design QA

final result: passed

## Verified state

- Real Angular `AutoFillPickerComponent`, rendered at 480 × 600.
- Locale: `zh-CN`.
- Target application: Termius.
- Detected action: confident form with username and password fields.
- Exact candidate: highlighted; username, password, and TOTP capabilities available.
- Browser console: 0 warnings and 0 errors (development connection/info logs only).

## Evidence

- Implementation capture: `autofill-row-actions.png` (480 × 600, genuine browser PNG).
- The user-provided reference and the implementation capture were normalized to the same 480 × 600 state and inspected side by side. That comparison was kept ephemeral because the reference contains private account data.

## Visual and interaction checks

- The old visible detected-field chip is absent.
- Each Login row shows the available username, password, and TOTP BWI icons immediately before the action.
- The row exposes one generic `填入` action; confident field/form selection remains automatic.
- The highlighted row uses one outer background and one inset outline across the account body, capability icons, and `填入`; child regions stay transparent, so hover and keyboard highlight have no seams.
- Low-confidence choose mode still exposes explicit field choices; the confident form state does not show a redundant ellipsis or secondary field chooser.
- Search, candidate grouping, target application context, and keyboard semantics remain intact.

## Review result

- P0: none.
- P1: none.
- P2: none.
