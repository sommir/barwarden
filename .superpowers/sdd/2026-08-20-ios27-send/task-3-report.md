# Send Task 3 report

- Base: `8fdaf5875e7bd0dad6370d74de23d3c7ac84d686`; `main`; empty index.
- Real `SendCreatedPageComponent` route owns the retained created wrapper.
- Summary is flat with one 12px inset. The link has a 44px owner and exact
  40/36px visible control, a localized accessible name, selectable long value,
  ellipsis reading treatment, and unclipped 200% owner growth.
- Copy is the sole filled primary with a 44px owner and 40/36px inset paint;
  Close is secondary in the real footer. Pointer, disabled, focus, Reduced
  Motion, and Forced Colors use the visible paint layer.
- Builder-derived links and exact-once Copy/Close/Back/Escape/pop-out remain
  intact. Mounted Close and Escape consume `/add-send`, retain only
  `/tabs/send`, and preserve the `send:search` focus key.
- Existing bounded static transforms were updated; authority pins did not move.
- Updater ran twice and the final staged run produced zero diff.
- Full Send/overlay/visual gate passed 185/185. Official Send typecheck and
  independent web build passed with only accepted baseline warnings.

## Review fix

- JS and Rust popout allowlists now retain the production
  `/send-created?sendId=<id>&type=text` URL; the Rust window unit passed.
- Copy paint excludes native/ARIA-disabled hover and pressed rules, clears its
  transform while disabled, and preserves enabled/disabled system colors.
- The link uses auto height with exact 40/36px minima, rem typography and
  scalable padding, so a long selectable URL grows vertically at 200%.
- Close and Escape are verified through real Angular NavigationStart/End
  transitions for Send → Add Send → Created → Send; Add Send is absent from
  retained history and focus returns to the real `send:search` owner.
- Final full JS gate passed 225/225; official typecheck/build, independent web
  build, Rust popout unit, updater stability and final zero-diff passed.
