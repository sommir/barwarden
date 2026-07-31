import type { Provider } from "@angular/core";

export function createEvidenceProviders(_search: string, _evidenceEnabled?: boolean): Provider[] {
  // The production Vite alias terminates every synthetic evidence path at this empty boundary.
  return [];
}
