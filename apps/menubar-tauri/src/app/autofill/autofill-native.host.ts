import { InjectionToken } from "@angular/core";

import type { BiometricOperationStatus } from "../../host/biometric-host";
import type { AutoFillSecretField } from "./autofill-candidate.service";
export type AutoFillEntryContextOutcome =
  | { readonly status: "available"; readonly bundleId: string; readonly appName: string }
  | { readonly status: "unavailable" };
export type AutoFillAgentSessionOutcome =
  | { readonly status: "success"; readonly generation: string; readonly accountId: string; readonly vaultRevision: number }
  | { readonly status: "error"; readonly code: string };
export interface AutoFillRepromptScope {
  readonly accountId: string;
  readonly candidateId: string;
  readonly field: AutoFillSecretField;
  readonly generation: string;
  readonly contextToken: string;
}
export type AutoFillBeginRepromptOutcome =
  | { readonly status: "pending"; readonly receipt: string }
  | { readonly status: "unavailable" };
export interface AutoFillSecretCommandRequest {
  readonly scope: AutoFillRepromptScope;
  readonly mismatchConfirmed: boolean;
  readonly repromptReceipt?: string;
}
export type AutoFillSecretCommandOutcome =
  | { readonly status: "success"; readonly field: AutoFillSecretField; readonly value: string }
  | { readonly status: "error"; readonly code: string };

export interface AutoFillNativeHost {
  entryContext(): Promise<AutoFillEntryContextOutcome>;
  agentSession(): Promise<AutoFillAgentSessionOutcome>;
  beginReprompt(scope: AutoFillRepromptScope): Promise<AutoFillBeginRepromptOutcome>;
  biometricReprompt(accountId: string, receipt: string): Promise<BiometricOperationStatus>;
  releaseSecret(request: AutoFillSecretCommandRequest): Promise<AutoFillSecretCommandOutcome>;
  pasteText(value: string, clearAfterSeconds?: number): Promise<void>;
  copyText(value: string, clearAfterSeconds?: number): Promise<void>;
}

export const AUTOFILL_NATIVE_HOST = new InjectionToken<AutoFillNativeHost>(
  "AUTOFILL_NATIVE_HOST",
);
