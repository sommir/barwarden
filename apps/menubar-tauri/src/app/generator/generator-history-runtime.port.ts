import { InjectionToken } from "@angular/core";

import type { GeneratedCredential } from "./generator-history.store";

export interface GeneratorHistoryRuntimePort {
  activeSettings(): Promise<{ readonly accountId: string }>;
  history(
    requestedAccountId?: string,
    isCurrent?: () => Promise<boolean>,
  ): Promise<readonly GeneratedCredential[]>;
  clearHistory(
    requestedAccountId?: string,
    isCurrent?: () => Promise<boolean>,
  ): Promise<void>;
}

export interface GeneratorHistoryStatePort {
  snapshot(): {
    readonly isUnlocked: boolean;
    readonly email: string;
    readonly serverUrl: string;
    readonly activeSession: object | null;
  };
}

export const GENERATOR_HISTORY_RUNTIME = new InjectionToken<GeneratorHistoryRuntimePort>(
  "GENERATOR_HISTORY_RUNTIME",
);
export const GENERATOR_HISTORY_STATE = new InjectionToken<GeneratorHistoryStatePort>(
  "GENERATOR_HISTORY_STATE",
);
