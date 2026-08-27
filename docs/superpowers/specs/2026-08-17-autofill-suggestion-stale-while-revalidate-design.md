# AutoFill Suggestion Stale-While-Revalidate Design

## Problem

Opening the menu-bar vault currently clears the ready AutoFill context, publishes a loading state, and then queries the native context again. The suggestion component consequently renders an empty list before rendering the refreshed candidates, producing a visible collapse-and-expand motion even when nothing changed.

## Desired behavior

- An ordinary vault open keeps the last ready suggestion presentation visible while refresh work runs asynchronously.
- A refresh with the same visible candidates does not notify the UI or rebuild the suggestion section.
- A refresh with different candidates replaces the previous presentation atomically, without an intermediate empty state.
- Old candidates cannot start a fill action while their context is being revalidated.
- Initial setup, explicit AutoFill entry, lock, account change, navigation invalidation, and unavailable-context behavior remain fail-closed.

## Design

`AutoFillVaultContextService.beginFromVaultOpen()` uses a passive refresh mode when a ready snapshot already exists. Passive refresh increments the operation epoch but does not clear the published snapshot or context session and does not publish `loading`.

While passive refresh is in flight, selection APIs reject candidate selection. After native context, website context, Agent session, and ranked candidates are validated, the service atomically installs the new context session and ready snapshot.

The service compares the old and new visible candidate presentation: ordered cipher ID, display name, username, group, reason, and available fields. If the presentation is unchanged, it replaces the private authoritative snapshot silently so fresh authorization tokens are retained without waking Angular subscribers. If the presentation differs, it publishes the new ready snapshot once.

Refresh failure remains a real state change and publishes the existing unavailable state. Concurrent refreshes continue to use the epoch guard so late results cannot overwrite newer context.

## Testing

- A passive refresh keeps the previous ready snapshot observable while candidate lookup is pending.
- Candidate selection is rejected during passive refresh.
- An unchanged result publishes no intermediate or final subscriber notification while updating the authoritative snapshot.
- A changed result publishes exactly one ready notification and never publishes loading.
- Existing initial-load, invalidation, account, context-change, and session-change tests continue to pass.
