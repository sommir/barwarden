import type { Observable } from "rxjs";

/** Runtime token required by the pinned common state barrel. */
export abstract class ActiveUserAccessor {
  abstract readonly activeUserId$: Observable<string | null>;
}
